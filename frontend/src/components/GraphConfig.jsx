import { useGraph } from '../context/GraphContext';
import { useState, useEffect, useRef } from 'react';

const GraphConfig = ({ showTctj = true, isGraphTitleReadOnly = false, isCurveNameReadOnly = false, initialCurveName = '', initialGraphTitle = '', isAxisMappingConfirmed = false, isEditingCurve = false, onConfirmAxisMapping = () => {}, onRetakeAxis = () => {}, children = null }) => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const isConfigLocked = Boolean(isEditingCurve);
  
  // Apply initial values from props when component mounts
  useEffect(() => {
    if (initialCurveName || initialGraphTitle) {
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        curveName: initialCurveName || prevConfig.curveName,
        graphTitle: initialGraphTitle || prevConfig.graphTitle,
      }));
    }
  }, [initialCurveName, initialGraphTitle, setGraphConfig]);
  

  
  // Debounce timers for each field
  const debounceTimers = useRef({
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  });

  // Validate min/max values
  useEffect(() => {
    let xErr = '', yErr = '';
    
    // Check if min > max for X-axis
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    if (graphConfig.xScale === 'Logarithmic') {
      if ((!isNaN(xMin) && xMin <= 0) || (!isNaN(xMax) && xMax <= 0)) {
        xErr = '⚠️ Logarithmic axis values must be greater than 0';
      }
    }
    if (!isNaN(xMin) && !isNaN(xMax) && xMin >= xMax) {
      xErr = '⚠️ Min value must be less than Max value';
    }
    
    // Check if min > max for Y-axis
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    if (graphConfig.yScale === 'Logarithmic') {
      if ((!isNaN(yMin) && yMin <= 0) || (!isNaN(yMax) && yMax <= 0)) {
        yErr = '⚠️ Logarithmic axis values must be greater than 0';
      }
    }
    if (!isNaN(yMin) && !isNaN(yMax) && yMin >= yMax) {
      yErr = '⚠️ Min value must be less than Max value';
    }
    
    setLogError({ x: xErr, y: yErr });
  }, [graphConfig.xScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yScale, graphConfig.yMin, graphConfig.yMax]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // Helper function to round exponent to reasonable precision (avoid floating-point errors like 4.999999999)
  const roundExponent = (exp, decimals = 10) => {
    if (!Number.isFinite(exp)) return exp;
    // Round to N decimals to avoid floating-point precision artifacts
    return Math.round(exp * Math.pow(10, decimals)) / Math.pow(10, decimals);
  };

  const LOG_FIELDS = ['xMin', 'xMax', 'yMin', 'yMax'];

  const EMPTY_LOG_PAIR_INPUTS = {
    xMin: { exponent: '', value: '' },
    xMax: { exponent: '', value: '' },
    yMin: { exponent: '', value: '' },
    yMax: { exponent: '', value: '' },
  };

  const EMPTY_LOG_INPUT_SOURCE = {
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
  };

  const getUnitLabel = (value) => {
    const unitLabels = {
      '1e-12': 'pico (1e-12)',
      '1e-9': 'nano (1e-9)',
      '1e-6': 'micro (1e-6)',
      '1e-3': 'milli (1e-3)',
      '1': '1',
      '1e3': 'kilo (1e3)',
      '1e6': 'mega (1e6)',
      '1e9': 'giga (1e9)',
      '1e12': 'tera (1e12)',
    };
    return unitLabels[value] || value || '-';
  };

  // Helper function to format actual values (avoid unnecessary trailing zeros)
  const formatActual = (val) => {
    if (!Number.isFinite(val)) return '';
    // For very large/small numbers, use exponential notation
    if (Math.abs(val) >= 1e10 || (Math.abs(val) < 1e-4 && val !== 0)) {
      return val.toExponential(6);
    }
    // Otherwise use fixed format, removing trailing zeros
    return String(val);
  };

  const formatAxisDisplay = (value, scale) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return '?';
    return String(num);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Keep raw string value for numeric inputs to allow typing decimals like "0." or "1.2"
    // Parsing will happen when the value is actually used in calculations
    setGraphConfig({
      ...graphConfig,
      [name]: value,
    });
  };

  const [logPairInputs, setLogPairInputs] = useState(EMPTY_LOG_PAIR_INPUTS);
  const [logInputSource, setLogInputSource] = useState(EMPTY_LOG_INPUT_SOURCE);

  const updateGraphConfigField = (field, value) => {
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [field]: value,
    }));
  };

  // Keep dual log inputs synchronized from graphConfig when source is not currently user-driven.
  useEffect(() => {
    const migratedRealValues = {};

    setLogPairInputs((prev) => {
      const next = {
        ...prev,
        xMin: { ...prev.xMin },
        xMax: { ...prev.xMax },
        yMin: { ...prev.yMin },
        yMax: { ...prev.yMax },
      };

      LOG_FIELDS.forEach((field) => {
        const isXField = field.startsWith('x');
        const axisScale = isXField ? graphConfig.xScale : graphConfig.yScale;
        if (axisScale !== 'Logarithmic') return;
        if (logInputSource[field]) return;

        const raw = graphConfig[field];
        const rawText = String(raw ?? '').trim();
        if (rawText === '') {
          next[field].exponent = '';
          next[field].value = '';
          return;
        }

        const numericValue = Number(rawText);
        if (!Number.isFinite(numericValue)) {
          next[field].exponent = '';
          next[field].value = rawText;
          return;
        }

        // If existing data comes from older exponent-only mode (<= 0), migrate to real value.
        if (numericValue <= 0) {
          const convertedReal = Math.pow(10, numericValue);
          next[field].exponent = String(roundExponent(numericValue, 10));
          next[field].value = formatActual(convertedReal);
          migratedRealValues[field] = String(convertedReal);
          return;
        }

        const exponent = Math.log10(numericValue);
        next[field].exponent = String(roundExponent(exponent, 10));
        next[field].value = formatActual(numericValue);
      });

      return next;
    });

    if (Object.keys(migratedRealValues).length > 0) {
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        ...migratedRealValues,
      }));
    }
  }, [graphConfig.xScale, graphConfig.yScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, logInputSource]);

  const handleLogExponentChange = (field, value) => {
    setLogInputSource((prev) => ({
      ...prev,
      [field]: value.trim() === '' ? '' : 'exponent',
    }));

    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        exponent: value,
      },
    }));

    const exponentNumber = parseFloat(value);
    if (value.trim() === '' || !Number.isFinite(exponentNumber)) {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          value: '',
        },
      }));
      updateGraphConfigField(field, '');
      return;
    }

    const actualValue = Math.pow(10, exponentNumber);
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        exponent: String(roundExponent(exponentNumber, 10)),
        value: formatActual(actualValue),
      },
    }));
    updateGraphConfigField(field, String(actualValue));
  };

  const handleLogActualValueChange = (field, value) => {
    setLogInputSource((prev) => ({
      ...prev,
      [field]: value.trim() === '' ? '' : 'value',
    }));

    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        value,
      },
    }));

    const actualNumber = parseFloat(value);
    if (value.trim() === '') {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          exponent: '',
        },
      }));
      updateGraphConfigField(field, '');
      return;
    }

    if (!Number.isFinite(actualNumber) || actualNumber <= 0) {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          exponent: '',
        },
      }));
      updateGraphConfigField(field, value);
      return;
    }

    const exponent = Math.log10(actualNumber);
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        exponent: String(roundExponent(exponent, 10)),
        value: formatActual(actualNumber),
      },
    }));
    updateGraphConfigField(field, String(actualNumber));
  };

  return (
    <div
      className="w-full p-5 bg-white rounded-lg mt-5 shadow"
      style={{
        opacity: isConfigLocked ? 0.55 : 1,
        pointerEvents: isConfigLocked ? 'none' : 'auto',
      }}
    >
      <h3 className="text-gray-900 text-lg font-semibold mb-5">Graph Configuration</h3>

      <div className="mb-5">
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Graph Title:</span>
          <input
            type="text"
            name="graphTitle"
            value={graphConfig.graphTitle || ''}
            onChange={handleChange}
            placeholder="Enter graph title"
            className={`w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 ${
              isGraphTitleReadOnly || isConfigLocked
                ? 'bg-gray-100 cursor-not-allowed opacity-70'
                : 'bg-white'
            }`}
            readOnly={isGraphTitleReadOnly || isConfigLocked}
            disabled={isGraphTitleReadOnly || isConfigLocked}
          />
        </label>
        {showTctj && (
          <label className="block mb-3 font-medium text-gray-800">
            <span className="block mb-1 text-sm text-gray-800">TC/TJ (Temperature):</span>
            <input
              type="text"
              name="temperature"
              value={graphConfig.temperature}
              onChange={handleChange}
              disabled={isConfigLocked}
              placeholder="e.g., -40°C, 25°C"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </label>
        )}
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Curve/Line Name:</span>
          <input
            type="text"
            name="curveName"
            value={graphConfig.curveName}
            onChange={handleChange}
            placeholder="Enter curve name"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isConfigLocked || isCurveNameReadOnly}
            disabled={isConfigLocked || isCurveNameReadOnly}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6" style={{ opacity: (isAxisMappingConfirmed || isEditingCurve) ? 0.5 : 1, pointerEvents: (isAxisMappingConfirmed || isEditingCurve) ? 'none' : 'auto' }}>
        <div>
          <h4 className="text-gray-800 font-semibold mb-3">Y-Axis {isAxisMappingConfirmed && '🔒'} {isEditingCurve && '(disabled during edit)'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="yScale" value={graphConfig.yScale} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.yScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">Enter exponent or real value. 10^exponent = value</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="yUnitPrefix" value={graphConfig.yUnitPrefix} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="">-select-</option>
              <option value="1e-12">pico (p) = 1e-12</option>
              <option value="1e-9">nano (n) = 1e-9</option>
              <option value="1e-6">micro (μ) = 1e-6</option>
              <option value="1e-3">milli (m) = 1e-3</option>
              <option value="1">1</option>
              <option value="1e3">Kilo (k) = 1e3</option>
              <option value="1e6">Mega (M) = 1e6</option>
              <option value="1e9">Giga (G) = 1e9</option>
              <option value="1e12">Tera (T) = 1e12</option>
            </select>
          </label>
          
          {graphConfig.yScale === 'Logarithmic' ? (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center flex-1">
                    <span className="px-3 py-2 border border-r-0 border-gray-300 rounded-l text-sm text-gray-700 bg-gray-50">10^</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logPairInputs.yMin.exponent}
                      onChange={(e) => handleLogExponentChange('yMin', e.target.value)}
                      disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.yMin === 'value'}
                      placeholder="-2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Exponent"
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">=</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={logPairInputs.yMin.value}
                    onChange={(e) => handleLogActualValueChange('yMin', e.target.value)}
                    disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.yMin === 'exponent'}
                    placeholder="0.01"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Real value"
                  />
                </div>
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center flex-1">
                    <span className="px-3 py-2 border border-r-0 border-gray-300 rounded-l text-sm text-gray-700 bg-gray-50">10^</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logPairInputs.yMax.exponent}
                      onChange={(e) => handleLogExponentChange('yMax', e.target.value)}
                      disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.yMax === 'value'}
                      placeholder="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Exponent"
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">=</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={logPairInputs.yMax.value}
                    onChange={(e) => handleLogActualValueChange('yMax', e.target.value)}
                    disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.yMax === 'exponent'}
                    placeholder="100"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Real value"
                  />
                </div>
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
            </>
          ) : (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <input
                  type="number"
                  name="yMin"
                  value={graphConfig.yMin}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="yMax"
                  value={graphConfig.yMax}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
            </>
          )}
        </div>

        <div>
          <h4 className="text-gray-800 font-semibold mb-3">X-Axis {isAxisMappingConfirmed && '🔒'} {isEditingCurve && '(disabled during edit)'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="xScale" value={graphConfig.xScale} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.xScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">Enter exponent or real value. 10^exponent = value</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="xUnitPrefix" value={graphConfig.xUnitPrefix} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="">-select-</option>
              <option value="1e-12">pico (p) = 1e-12</option>
              <option value="1e-9">nano (n) = 1e-9</option>
              <option value="1e-6">micro (μ) = 1e-6</option>
              <option value="1e-3">milli (m) = 1e-3</option>
              <option value="1">1</option>
              <option value="1e3">Kilo (k) = 1e3</option>
              <option value="1e6">Mega (M) = 1e6</option>
              <option value="1e9">Giga (G) = 1e9</option>
              <option value="1e12">Tera (T) = 1e12</option>
            </select>
          </label>
          
          {graphConfig.xScale === 'Logarithmic' ? (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center flex-1">
                    <span className="px-3 py-2 border border-r-0 border-gray-300 rounded-l text-sm text-gray-700 bg-gray-50">10^</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logPairInputs.xMin.exponent}
                      onChange={(e) => handleLogExponentChange('xMin', e.target.value)}
                      disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.xMin === 'value'}
                      placeholder="-2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Exponent"
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">=</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={logPairInputs.xMin.value}
                    onChange={(e) => handleLogActualValueChange('xMin', e.target.value)}
                    disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.xMin === 'exponent'}
                    placeholder="0.01"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Real value"
                  />
                </div>
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center flex-1">
                    <span className="px-3 py-2 border border-r-0 border-gray-300 rounded-l text-sm text-gray-700 bg-gray-50">10^</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logPairInputs.xMax.exponent}
                      onChange={(e) => handleLogExponentChange('xMax', e.target.value)}
                      disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.xMax === 'value'}
                      placeholder="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Exponent"
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">=</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={logPairInputs.xMax.value}
                    onChange={(e) => handleLogActualValueChange('xMax', e.target.value)}
                    disabled={isAxisMappingConfirmed || isEditingCurve || logInputSource.xMax === 'exponent'}
                    placeholder="100"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Real value"
                  />
                </div>
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
            </>
          ) : (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <input
                  type="number"
                  name="xMin"
                  value={graphConfig.xMin}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="xMax"
                  value={graphConfig.xMax}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
            </>
          )}
        </div>
      </div>

      {children ? <div className="mt-4">{children}</div> : null}

      {/* Axis Mapping Status & Controls (Issue 5 & 7) */}
      <div className="mt-6 p-4 border-2 rounded-lg" style={{ borderColor: isAxisMappingConfirmed ? '#4caf50' : '#ffc107', backgroundColor: isAxisMappingConfirmed ? '#e8f5e9' : '#fff3e0' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isAxisMappingConfirmed ? (
              <>
                <span className="text-2xl">🔒</span>
                <span className="text-sm font-semibold text-green-700">Axis Mapping: CONFIRMED</span>
              </>
            ) : (
              <>
                <span className="text-2xl">⚠️</span>
                <span className="text-sm font-semibold text-orange-700">Axis Mapping: PENDING</span>
              </>
            )}
          </div>
          {isAxisMappingConfirmed && (
            <button
              onClick={() => {
                // Clear input tracking refs when redrawn
                setLogPairInputs(EMPTY_LOG_PAIR_INPUTS);
                setLogInputSource(EMPTY_LOG_INPUT_SOURCE);
                onRetakeAxis();
              }}
              className="px-3 py-1 rounded bg-orange-600 text-white text-xs font-medium hover:bg-orange-700"
              title="Unlock axis mapping (will clear captured points)"
            >
              Unlock Axis Mapping
            </button>
          )}
        </div>
        
        {/* Always Display Current Axis Values */}
        <div className="text-xs text-gray-700 bg-white p-2 rounded mb-3" style={{ border: '1px solid #ccc' }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <strong>X-Axis:</strong> [{formatAxisDisplay(graphConfig.xMin, graphConfig.xScale)}, {formatAxisDisplay(graphConfig.xMax, graphConfig.xScale)}] ({graphConfig.xScale})
            </div>
            <div>
              <strong>Y-Axis:</strong> [{formatAxisDisplay(graphConfig.yMin, graphConfig.yScale)}, {formatAxisDisplay(graphConfig.yMax, graphConfig.yScale)}] ({graphConfig.yScale})
            </div>
          </div>
        </div>
        
        {!isAxisMappingConfirmed && (
          <>
            {/* Validation messaging */}
            {(() => {
              const missing = [];
              if (!graphConfig.xMin && graphConfig.xMin !== 0) missing.push('X Min');
              if (!graphConfig.xMax && graphConfig.xMax !== 0) missing.push('X Max');
              if (!graphConfig.yMin && graphConfig.yMin !== 0) missing.push('Y Min');
              if (!graphConfig.yMax && graphConfig.yMax !== 0) missing.push('Y Max');
              
              const xMin = parseFloat(graphConfig.xMin);
              const xMax = parseFloat(graphConfig.xMax);
              const yMin = parseFloat(graphConfig.yMin);
              const yMax = parseFloat(graphConfig.yMax);
              
              const hasErrors = logError.x || logError.y;
              const isDisabled = missing.length > 0 || hasErrors;
              
              return (
                <>
                  {missing.length > 0 && (
                    <div className="mb-2 p-2 rounded bg-red-50 border border-red-300 text-xs text-red-700">
                      ❌ Required: Set {missing.join(', ')}
                    </div>
                  )}
                  {hasErrors && (
                    <div className="mb-2 p-2 rounded bg-red-50 border border-red-300 text-xs text-red-700">
                      {logError.x}{logError.x && logError.y && ' | '}{logError.y}
                    </div>
                  )}
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isDisabled}
                    className={`w-full px-4 py-2 rounded font-medium text-sm transition ${
                      isDisabled
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                    title={isDisabled ? 'All axis values must be set and valid' : 'Review axis configuration before locking'}
                  >
                    ✓ Confirm Axis Mapping
                  </button>
                </>
              );
            })()}
          </>
        )}
      </div>

      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              color: '#213547',
              borderRadius: 10,
              width: 'min(520px, 90vw)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
              padding: 20,
            }}
          >
            <div className="text-base font-semibold mb-3">Proceed with this axis configuration?</div>
            <div className="text-sm mb-4" style={{ color: '#4b5563' }}>
              Confirm the values below. If you continue, axis mapping is locked and point capture begins.
            </div>
            <div className="text-sm" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div className="mb-2"><strong>X Min:</strong> {formatAxisDisplay(graphConfig.xMin, graphConfig.xScale)}</div>
              <div className="mb-2"><strong>X Max:</strong> {formatAxisDisplay(graphConfig.xMax, graphConfig.xScale)}</div>
              <div className="mb-2"><strong>X Scale:</strong> {graphConfig.xScale || '-'}</div>
              <div className="mb-3"><strong>X Unit:</strong> {getUnitLabel(graphConfig.xUnitPrefix)}</div>
              <div className="mb-2"><strong>Y Min:</strong> {formatAxisDisplay(graphConfig.yMin, graphConfig.yScale)}</div>
              <div className="mb-2"><strong>Y Max:</strong> {formatAxisDisplay(graphConfig.yMax, graphConfig.yScale)}</div>
              <div className="mb-2"><strong>Y Scale:</strong> {graphConfig.yScale || '-'}</div>
              <div><strong>Y Unit:</strong> {getUnitLabel(graphConfig.yUnitPrefix)}</div>
            </div>
            <div className="text-xs mt-3" style={{ color: '#6b7280' }}>
              Need to change values? Click “Unlock Axis Mapping” to edit the configuration.
            </div>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded bg-gray-800 text-white font-medium"
                onClick={() => setShowConfirmModal(false)}
              >
                No, go back
              </button>
              <button
                className="px-4 py-2 rounded bg-green-600 text-white font-medium"
                onClick={() => {
                  setShowConfirmModal(false);
                  onConfirmAxisMapping();
                }}
              >
                Yes, proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphConfig;

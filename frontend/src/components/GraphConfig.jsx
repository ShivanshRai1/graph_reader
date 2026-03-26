import { useGraph } from '../context/GraphContext';
import { useState, useEffect, useRef } from 'react';

const LOG_FIELDS = ['xMin', 'xMax', 'yMin', 'yMax'];

const EMPTY_LOG_PAIR_INPUTS = {
  xMin: { exponent: '', value: '' },
  xMax: { exponent: '', value: '' },
  yMin: { exponent: '', value: '' },
  yMax: { exponent: '', value: '' },
};

const DEFAULT_LOG_INPUT_MODE = {
  xMin: 'exponent',
  xMax: 'exponent',
  yMin: 'exponent',
  yMax: 'exponent',
};

const formatTemperatureNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1000) / 1000).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const parseTemperatureValue = (rawValue) => {
  const text = String(rawValue || '').trim();
  if (!text) {
    return { value: '', unit: 'C' };
  }

  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:deg\s*)?(c|f|k)?\s*$/i);
  if (!match) {
    return { value: text, unit: 'C' };
  }

  return {
    value: match[1],
    unit: String(match[2] || 'C').toUpperCase(),
  };
};

const convertTemperatureToCelsius = (rawValue, unit) => {
  const numericValue = Number.parseFloat(String(rawValue || '').trim());
  if (!Number.isFinite(numericValue)) return '';

  if (unit === 'F') {
    return formatTemperatureNumber((numericValue - 32) * (5 / 9));
  }

  if (unit === 'K') {
    return formatTemperatureNumber(numericValue - 273.15);
  }

  return formatTemperatureNumber(numericValue);
};

const GraphConfig = ({ showTctj = true, isGraphTitleReadOnly = false, isCurveNameReadOnly = false, isXTitleReadOnly = false, isYTitleReadOnly = false, initialCurveName = '', initialGraphTitle = '', initialXTitle = '', initialYTitle = '', isAxisMappingConfirmed = false, isEditingCurve = false, onConfirmAxisMapping = () => {}, onRetakeAxis = () => {}, children = null }) => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [logPairInputs, setLogPairInputs] = useState(EMPTY_LOG_PAIR_INPUTS);
  const [logInputMode, setLogInputMode] = useState(DEFAULT_LOG_INPUT_MODE);
  const [temperatureValue, setTemperatureValue] = useState('');
  const [temperatureUnit, setTemperatureUnit] = useState('C');
  const skipTemperatureSyncRef = useRef(false);
  const isConfigLocked = Boolean(isEditingCurve);
  
  // Apply initial values from props when component mounts
  useEffect(() => {
    if (initialCurveName || initialGraphTitle || initialXTitle || initialYTitle) {
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        curveName: initialCurveName || prevConfig.curveName,
        graphTitle: initialGraphTitle || prevConfig.graphTitle,
        xLabel: initialXTitle || prevConfig.xLabel,
        yLabel: initialYTitle || prevConfig.yLabel,
      }));
    }
  }, [initialCurveName, initialGraphTitle, initialXTitle, initialYTitle, setGraphConfig]);
  

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

  // Helper function to round exponent to reasonable precision (avoid floating-point errors like 4.999999999)
  const roundExponent = (exp, decimals = 10) => {
    if (!Number.isFinite(exp)) return exp;
    // Round to N decimals to avoid floating-point precision artifacts
    return Math.round(exp * Math.pow(10, decimals)) / Math.pow(10, decimals);
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
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [name]: value,
    }));
  };

  const updateGraphConfigField = (field, value) => {
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [field]: value,
    }));
  };

  // Keep dual log inputs synchronized from graphConfig.
  useEffect(() => {
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

        const raw = graphConfig[field];
        const rawText = String(raw ?? '').trim();
        if (rawText === '') {
          next[field].exponent = '';
          next[field].value = '';
          return;
        }

        const numericValue = Number(rawText);
        if (!Number.isFinite(numericValue)) {
          next[field].value = rawText;
          return;
        }

        if (numericValue <= 0) {
          next[field].exponent = '';
          next[field].value = rawText;
          return;
        }

        const exponent = Math.log10(numericValue);
        next[field].exponent = String(roundExponent(exponent, 10));
        next[field].value = formatActual(numericValue);
      });

      return next;
    });
  }, [graphConfig.xScale, graphConfig.yScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax]);

  useEffect(() => {
    if (skipTemperatureSyncRef.current) {
      skipTemperatureSyncRef.current = false;
      return;
    }

    const parsedTemperature = parseTemperatureValue(graphConfig.temperature);
    setTemperatureValue(parsedTemperature.value);
    setTemperatureUnit(parsedTemperature.unit);
  }, [graphConfig.temperature]);

  const handleLogInputModeChange = (field, mode) => {
    setLogInputMode((prev) => ({
      ...prev,
      [field]: mode,
    }));
  };

  const handleLogExponentChange = (field, value) => {
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
        exponent: value,
        value: formatActual(actualValue),
      },
    }));
    updateGraphConfigField(field, String(actualValue));
  };

  const handleLogActualValueChange = (field, value) => {
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

  const handleTemperatureValueChange = (value) => {
    setTemperatureValue(value);
    const normalizedTemperature = value.trim() === ''
      ? ''
      : convertTemperatureToCelsius(value, temperatureUnit);

    skipTemperatureSyncRef.current = true;
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      temperature: normalizedTemperature,
    }));
  };

  const handleTemperatureUnitChange = (unit) => {
    setTemperatureUnit(unit);
    const normalizedTemperature = temperatureValue.trim() === ''
      ? ''
      : convertTemperatureToCelsius(temperatureValue, unit);

    skipTemperatureSyncRef.current = true;
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      temperature: normalizedTemperature,
    }));
  };

  const renderLogField = (field, label, placeholderExponent, placeholderValue, error) => {
    const activeMode = logInputMode[field] || 'exponent';

    return (
      <label className="block mb-3">
        <span className="block text-sm font-medium text-gray-800 mb-1">{label}:</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center flex-1">
            <span className={`px-3 py-2 border border-r-0 rounded-l text-sm text-gray-700 ${activeMode === 'exponent' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}>10^</span>
            <input
              type="text"
              inputMode="decimal"
              value={logPairInputs[field].exponent}
              onChange={(e) => handleLogExponentChange(field, e.target.value)}
              onFocus={() => !isAxisMappingConfirmed && !isEditingCurve && handleLogInputModeChange(field, 'exponent')}
              disabled={isAxisMappingConfirmed || isEditingCurve}
              placeholder={placeholderExponent}
              className={`w-full px-3 py-2 border rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed ${activeMode === 'exponent' ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-300 opacity-50'}`}
              title="Exponent (click to use)"
            />
          </div>
          <span className="text-sm font-semibold text-gray-700">=</span>
          <input
            type="text"
            inputMode="decimal"
            value={logPairInputs[field].value}
            onChange={(e) => handleLogActualValueChange(field, e.target.value)}
            onFocus={() => !isAxisMappingConfirmed && !isEditingCurve && handleLogInputModeChange(field, 'value')}
            disabled={isAxisMappingConfirmed || isEditingCurve}
            placeholder={placeholderValue}
            className={`flex-1 px-3 py-2 border rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed ${activeMode === 'value' ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-300 opacity-50'}`}
            title="Real value (click to use)"
          />
        </div>
        {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
      </label>
    );
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
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={temperatureValue}
                onChange={(e) => handleTemperatureValueChange(e.target.value)}
                disabled={isConfigLocked}
                placeholder="Enter numeric temperature"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <select
                value={temperatureUnit}
                onChange={(e) => handleTemperatureUnitChange(e.target.value)}
                disabled={isConfigLocked}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="C">deg C</option>
                <option value="F">F</option>
                <option value="K">K</option>
              </select>
            </div>
            <span className="block text-xs text-gray-500 mt-1">
              If left empty, room temperature is assumed: 25 deg C. Stored in the database as deg C.
            </span>
          </label>
        )}
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Curve or Line Name:</span>
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
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">X Title:</span>
          <input
            type="text"
            name="xLabel"
            value={graphConfig.xLabel || ''}
            onChange={handleChange}
            placeholder="Enter X title"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isConfigLocked || isXTitleReadOnly}
            disabled={isConfigLocked || isXTitleReadOnly}
          />
        </label>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Y Title:</span>
          <input
            type="text"
            name="yLabel"
            value={graphConfig.yLabel || ''}
            onChange={handleChange}
            placeholder="Enter Y title"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isConfigLocked || isYTitleReadOnly}
            disabled={isConfigLocked || isYTitleReadOnly}
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
          
          <div className="block mb-3 p-2 bg-blue-50 border border-blue-300 rounded text-xs text-blue-700" style={{ visibility: graphConfig.yScale === 'Logarithmic' ? 'visible' : 'hidden' }}>
            Enter either exponent or number value
          </div>
          
          {graphConfig.yScale === 'Logarithmic' ? (
            <>
              {renderLogField('yMin', 'Min', '-2', '0.01', logError.y)}
              {renderLogField('yMax', 'Max', '2', '100', logError.y)}
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
          
          <div className="block mb-3 p-2 bg-blue-50 border border-blue-300 rounded text-xs text-blue-700" style={{ visibility: graphConfig.xScale === 'Logarithmic' ? 'visible' : 'hidden' }}>
            Enter either exponent or number value
          </div>
          
          {graphConfig.xScale === 'Logarithmic' ? (
            <>
              {renderLogField('xMin', 'Min', '-2', '0.01', logError.x)}
              {renderLogField('xMax', 'Max', '2', '100', logError.x)}
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

      {/* Axis Mapping Status & Controls */}
      <div className="mt-6 p-4 border-2 rounded-lg" style={{ borderColor: isAxisMappingConfirmed ? '#4caf50' : '#ffc107', backgroundColor: isAxisMappingConfirmed ? '#e8f5e9' : '#fff3e0' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isAxisMappingConfirmed ? (
              <>
                <span className="text-2xl">🔒</span>
                <span className="text-sm font-semibold text-green-700">Axis Mapping - Final Check: CONFIRMED</span>
              </>
            ) : (
              <>
                <span className="text-2xl">⚠️</span>
                <span className="text-sm font-semibold text-orange-700">Axis Mapping - Final Check: PENDING</span>
              </>
            )}
          </div>
          {isAxisMappingConfirmed && (
            <button
              onClick={() => {
                setLogPairInputs(EMPTY_LOG_PAIR_INPUTS);
                setLogInputMode(DEFAULT_LOG_INPUT_MODE);
                onRetakeAxis();
              }}
              className="px-3 py-1 rounded bg-orange-600 text-white text-xs font-medium hover:bg-orange-700"
              title="Unlock configuration (will clear captured points)"
            >
              Unlock Configuration
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
              if (!String(graphConfig.graphTitle || '').trim()) missing.push('Graph Title');
              if (!String(graphConfig.curveName || '').trim()) missing.push('Curve or Line Name');
              if (!String(graphConfig.xLabel || '').trim()) missing.push('X Title');
              if (!String(graphConfig.yLabel || '').trim()) missing.push('Y Title');
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
                    Final Check
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
            <div className="text-base font-semibold mb-3">Proceed with this final axis mapping check?</div>
            <div className="text-sm mb-4" style={{ color: '#4b5563' }}>
              Confirm the values below. If you continue, axis mapping is locked and point capture begins.
            </div>
            <div className="text-sm" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div className="mb-2"><strong>Graph Title:</strong> {graphConfig.graphTitle || '-'}</div>
              <div className="mb-2"><strong>Curve or Line Name:</strong> {graphConfig.curveName || '-'}</div>
              <div className="mb-2"><strong>X Title:</strong> {graphConfig.xLabel || '-'}</div>
              <div className="mb-3"><strong>Y Title:</strong> {graphConfig.yLabel || '-'}</div>
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
              Need to change values? Click "Unlock Configuration" to edit the configuration.
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

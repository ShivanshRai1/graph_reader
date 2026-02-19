import { useGraph } from '../context/GraphContext';
import { useState, useEffect, useRef } from 'react';

const GraphConfig = ({ showTctj = true, isGraphTitleReadOnly = false, isCurveNameReadOnly = false, initialCurveName = '', initialGraphTitle = '', isAxisMappingConfirmed = false, onConfirmAxisMapping = () => {}, onRetakeAxis = () => {} }) => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
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
    if (!isNaN(xMin) && !isNaN(xMax) && xMin >= xMax) {
      xErr = '⚠️ Min value must be less than Max value';
    }
    
    // Check if min > max for Y-axis
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
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
    if (scale !== 'Logarithmic') return String(num);
    const actual = Math.pow(10, num);
    if (!Number.isFinite(actual)) return '?';
    return formatActual(actual);
  };

  // Helper to get conversion display text
  const getConversionText = (expStr) => {
    const exp = parseFloat(expStr);
    if (isNaN(exp)) return '';
    const actual = Math.pow(10, exp);
    if (!Number.isFinite(actual)) return '';
    return `(10^${roundExponent(exp, 2)} ≈ ${formatActual(actual)})`;
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

  // Track input values separately to show user's typed value while converting
  const [logInputs, setLogInputs] = useState({ yMin: '', yMax: '', xMin: '', xMax: '' });

  // Initialize input values from graphConfig exponents on mount
  useEffect(() => {
    // Only synchronize on first mount, not on redraw
    const fields = ['yMin', 'yMax', 'xMin', 'xMax'];
    
    setLogInputs((prev) => {
      const next = { ...prev };
      fields.forEach((field) => {
        const expValue = graphConfig[field];
        if (expValue && !isNaN(expValue) && next[field] === '') {
          // Only populate if field is empty and graphConfig has a value
          const actualValue = Math.pow(10, parseFloat(expValue));
          next[field] = actualValue.toString();
        }
      });
      return next;
    });
  }, []); // Empty dependency array - only run on mount

  // When switching to logarithmic scale, ensure inputValuesRef is populated from graphConfig
  useEffect(() => {
    if (graphConfig.yScale === 'Logarithmic' || graphConfig.xScale === 'Logarithmic') {
      const fields = ['yMin', 'yMax', 'xMin', 'xMax'];
      setLogInputs((prev) => {
        const next = { ...prev };
        fields.forEach((field) => {
          const expValue = graphConfig[field];
          // If graphConfig has a value but input is empty, populate it
          if (expValue && !isNaN(expValue) && next[field] === '') {
            const actualValue = Math.pow(10, parseFloat(expValue));
            next[field] = actualValue.toString();
          }
        });
        return next;
      });
    }
  }, [graphConfig.yScale, graphConfig.xScale]);

  // Handler for logarithmic input - shows typed value, converts to exponent immediately
  const handleLogValueChange = (field, value) => {
    // Store what user is typing
    setLogInputs((prev) => ({ ...prev, [field]: value }));

    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) return;

    // Convert actual value to exponent immediately
    const exp = Math.log10(numValue);
    const roundedExp = roundExponent(exp, 10);

    // Update config with the exponent
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [field]: String(roundedExp),
    }));
  };

  return (
    <div className="w-full p-5 bg-white rounded-lg mt-5 shadow">
      {/* Axis Mapping Status & Controls (Issue 5 & 7) - MOVED ABOVE */}
      <div className="mt-0 mb-6 p-4 border-2 rounded-lg" style={{ borderColor: isAxisMappingConfirmed ? '#4caf50' : '#ffc107', backgroundColor: isAxisMappingConfirmed ? '#e8f5e9' : '#fff3e0' }}>
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
                setLogInputs({ yMin: '', yMax: '', xMin: '', xMax: '' });
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
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
            readOnly={false}
            disabled={false}
          />
        </label>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Curve/Line Name:</span>
          <input
            type="text"
            name="curveName"
            value={graphConfig.curveName}
            onChange={handleChange}
            placeholder="Enter curve name"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
            readOnly={false}
            disabled={false}
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
              placeholder="e.g., -40°C, 25°C"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
            />
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6" style={{ opacity: isAxisMappingConfirmed ? 0.6 : 1, pointerEvents: isAxisMappingConfirmed ? 'none' : 'auto' }}>
        <div>
          <h4 className="text-gray-800 font-semibold mb-3">Y-Axis {isAxisMappingConfirmed && '🔒'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="yScale" value={graphConfig.yScale} onChange={handleChange} disabled={isAxisMappingConfirmed} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.yScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">Enter actual value (e.g., 100000 or 1e5)</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="yUnitPrefix" value={graphConfig.yUnitPrefix} onChange={handleChange} disabled={isAxisMappingConfirmed} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
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
                <input
                  type="text"
                  inputMode="decimal"
                  value={logInputs.yMin}
                  onChange={(e) => handleLogValueChange('yMin', e.target.value)}
                  disabled={isAxisMappingConfirmed}
                  placeholder="e.g., 100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Enter actual value (e.g., 100000 or 1e5)"
                />
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={logInputs.yMax}
                  onChange={(e) => handleLogValueChange('yMax', e.target.value)}
                  disabled={isAxisMappingConfirmed}
                  placeholder="e.g., 100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Enter actual value (e.g., 100000 or 1e5)"
                />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="yMax"
                  value={graphConfig.yMax}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                />
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
            </>
          )}
        </div>

        <div>
          <h4 className="text-gray-800 font-semibold mb-3">X-Axis {isAxisMappingConfirmed && '🔒'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="xScale" value={graphConfig.xScale} onChange={handleChange} disabled={isAxisMappingConfirmed} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.xScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">Enter actual value (e.g., 100000 or 1e5)</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="xUnitPrefix" value={graphConfig.xUnitPrefix} onChange={handleChange} disabled={isAxisMappingConfirmed} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
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
                <input
                  type="text"
                  inputMode="decimal"
                  value={logInputs.xMin}
                  onChange={(e) => handleLogValueChange('xMin', e.target.value)}
                  disabled={isAxisMappingConfirmed}
                  placeholder="e.g., 100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Enter actual value (e.g., 100000 or 1e5)"
                />
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={logInputs.xMax}
                  onChange={(e) => handleLogValueChange('xMax', e.target.value)}
                  disabled={isAxisMappingConfirmed}
                  placeholder="e.g., 100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Enter actual value (e.g., 100000 or 1e5)"
                />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="xMax"
                  value={graphConfig.xMax}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                />
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
            </>
          )}
        </div>
      </div>

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
                setLogInputs({ yMin: '', yMax: '', xMin: '', xMax: '' });
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

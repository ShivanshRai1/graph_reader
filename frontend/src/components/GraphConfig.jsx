import { useGraph } from '../context/GraphContext';
import { useState, useEffect } from 'react';

const GraphConfig = ({ showTctj = true, isGraphTitleReadOnly = false, isCurveNameReadOnly = false, initialCurveName = '', initialGraphTitle = '' }) => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  
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
  
  // Synced values for logarithmic inputs (exponent <-> actual)
  const [logValues, setLogValues] = useState({
    xMin: { exp: '', actual: '', actualRaw: '' },
    xMax: { exp: '', actual: '', actualRaw: '' },
    yMin: { exp: '', actual: '', actualRaw: '' },
    yMax: { exp: '', actual: '', actualRaw: '' },
  });
  
  // Track which input field is being used for logarithmic values
  const [logInputMode, setLogInputMode] = useState({
    xMin: 'exponent', // 'exponent' or 'actual'
    xMax: 'exponent',
    yMin: 'exponent',
    yMax: 'exponent',
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

  // Keep local synced values up-to-date from graphConfig
  useEffect(() => {
    const toActual = (expStr) => {
      const exp = parseFloat(expStr);
      if (isNaN(exp)) return '';
      const val = Math.pow(10, exp);
      return Number.isFinite(val) ? String(val) : '';
    };
    setLogValues({
      xMin: { exp: String(graphConfig.xMin ?? ''), actual: toActual(graphConfig.xMin), actualRaw: '' },
      xMax: { exp: String(graphConfig.xMax ?? ''), actual: toActual(graphConfig.xMax), actualRaw: '' },
      yMin: { exp: String(graphConfig.yMin ?? ''), actual: toActual(graphConfig.yMin), actualRaw: '' },
      yMax: { exp: String(graphConfig.yMax ?? ''), actual: toActual(graphConfig.yMax), actualRaw: '' },
    });
  }, [graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Keep raw string value for numeric inputs to allow typing decimals like "0." or "1.2"
    // Parsing will happen when the value is actually used in calculations
    setGraphConfig({
      ...graphConfig,
      [name]: value,
    });
  };

  // Handle logarithmic input for exponent field
  const handleLogExponentChange = (field, value) => {
    setLogInputMode({ ...logInputMode, [field]: 'exponent' });
    // Update config with exponent
    setGraphConfig({
      ...graphConfig,
      [field]: value,
    });
    // Sync actual value locally
    const exp = parseFloat(value);
    const actual = !isNaN(exp) ? Math.pow(10, exp) : '';
    setLogValues((prev) => ({
      ...prev,
      [field]: { exp: String(value), actual: actual !== '' ? String(actual) : '' },
    }));
  };

  // Handle logarithmic input for actual value field - convert on every keystroke
  const handleLogActualChange = (field, value) => {
    setLogInputMode({ ...logInputMode, [field]: 'actual' });
    const numValue = parseFloat(value);
    
    // Accept scientific notation (e.g., "1e5") and positive values
    const exp = !isNaN(numValue) && numValue > 0 ? Math.log10(numValue) : NaN;
    
    // Update config with exponent immediately if valid
    if (!Number.isNaN(exp)) {
      setGraphConfig({
        ...graphConfig,
        [field]: String(exp),
      });
    }
    
    // Update local display values - store both raw input and calculated actual
    setLogValues((prev) => ({
      ...prev,
      [field]: {
        exp: Number.isNaN(exp) ? prev[field].exp : String(exp),
        actual: Number.isNaN(exp) ? '' : String(numValue),
        actualRaw: value,
      },
    }));
  };

  // Handle focus on exponent field
  const handleExponentFocus = (field) => {
    setLogInputMode({ ...logInputMode, [field]: 'exponent' });
  };

  // Handle focus on actual value field
  const handleActualFocus = (field) => {
    setLogInputMode({ ...logInputMode, [field]: 'actual' });
  };

  return (
    <div className="w-full p-5 bg-white rounded-lg mt-5 shadow">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div>
          <h4 className="text-gray-800 font-semibold mb-3">Y-Axis</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="yScale" value={graphConfig.yScale} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.yScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">For Logarithmic values Enter EITHER the exponent OR the actual value (not both)</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="yUnitPrefix" value={graphConfig.yUnitPrefix} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white">
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
                <span className="block text-sm font-medium text-gray-800 mb-1">Min (10^x):</span>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <span className="text-xs text-blue-600 font-medium text-center">Log Exponent</span>
                  <span className="text-xs text-blue-600 font-medium text-center">Graph Scale Value</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMin.exp}
                      onChange={(e) => handleLogExponentChange('yMin', e.target.value)}
                      onFocus={() => handleExponentFocus('yMin')}
                      placeholder="e.g., 5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.yMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMin.actualRaw || logValues.yMin.actual}
                      onChange={(e) => handleLogActualChange('yMin', e.target.value)}
                      onFocus={() => handleActualFocus('yMin')}
                      placeholder="e.g., 1e5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.yMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent automatically."
                    />
                  </div>
                </div>
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max (10^x):</span>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <span className="text-xs text-blue-600 font-medium text-center">Log Exponent</span>
                  <span className="text-xs text-blue-600 font-medium text-center">Graph Scale Value</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMax.exp}
                      onChange={(e) => handleLogExponentChange('yMax', e.target.value)}
                      onFocus={() => handleExponentFocus('yMax')}
                      placeholder="e.g., 5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.yMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMax.actualRaw || logValues.yMax.actual}
                      onChange={(e) => handleLogActualChange('yMax', e.target.value)}
                      onFocus={() => handleActualFocus('yMax')}
                      placeholder="e.g., 1e5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.yMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent automatically."
                    />
                  </div>
                </div>
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
          <h4 className="text-gray-800 font-semibold mb-3">X-Axis</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="xScale" value={graphConfig.xScale} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.xScale === 'Logarithmic' && (
            <small className="block text-xs text-blue-600 font-medium mb-3 italic">For Logarithmic values Enter EITHER the exponent OR the actual value (not both)</small>
          )}
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
            <select name="xUnitPrefix" value={graphConfig.xUnitPrefix} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white">
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
                <span className="block text-sm font-medium text-gray-800 mb-1">Min (10^x):</span>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <span className="text-xs text-blue-600 font-medium text-center">Log Exponent</span>
                  <span className="text-xs text-blue-600 font-medium text-center">Graph Scale Value</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMin.exp}
                      onChange={(e) => handleLogExponentChange('xMin', e.target.value)}
                      onFocus={() => handleExponentFocus('xMin')}
                      placeholder="e.g., 5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.xMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMin.actualRaw || logValues.xMin.actual}
                      onChange={(e) => handleLogActualChange('xMin', e.target.value)}
                      onFocus={() => handleActualFocus('xMin')}
                      placeholder="e.g., 1e5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.xMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent automatically."
                    />
                  </div>
                </div>
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max (10^x):</span>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <span className="text-xs text-blue-600 font-medium text-center">Log Exponent</span>
                  <span className="text-xs text-blue-600 font-medium text-center">Graph Scale Value</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMax.exp}
                      onChange={(e) => handleLogExponentChange('xMax', e.target.value)}
                      onFocus={() => handleExponentFocus('xMax')}
                      placeholder="e.g., 5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.xMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMax.actualRaw || logValues.xMax.actual}
                      onChange={(e) => handleLogActualChange('xMax', e.target.value)}
                      onFocus={() => handleActualFocus('xMax')}
                      placeholder="e.g., 1e5"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 bg-white"
                      style={{ opacity: logInputMode.xMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent automatically."
                    />
                  </div>
                </div>
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
    </div>
  );
};

export default GraphConfig;

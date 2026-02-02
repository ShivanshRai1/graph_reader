import { useGraph } from '../context/GraphContext';
import './GraphConfig.css';
import { useState, useEffect } from 'react';

const GraphConfig = () => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  // Synced values for logarithmic inputs (exponent <-> actual)
  const [logValues, setLogValues] = useState({
    xMin: { exp: '', actual: '' },
    xMax: { exp: '', actual: '' },
    yMin: { exp: '', actual: '' },
    yMax: { exp: '', actual: '' },
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
      xMin: { exp: String(graphConfig.xMin ?? ''), actual: toActual(graphConfig.xMin) },
      xMax: { exp: String(graphConfig.xMax ?? ''), actual: toActual(graphConfig.xMax) },
      yMin: { exp: String(graphConfig.yMin ?? ''), actual: toActual(graphConfig.yMin) },
      yMax: { exp: String(graphConfig.yMax ?? ''), actual: toActual(graphConfig.yMax) },
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

  // Handle logarithmic input for actual value field
  const handleLogActualChange = (field, value) => {
    setLogInputMode({ ...logInputMode, [field]: 'actual' });
    const numValue = parseFloat(value);
    // Accept scientific notation (e.g., "1e5") and positive values
    const exp = !isNaN(numValue) && numValue > 0 ? Math.log10(numValue) : NaN;
    // Update config with exponent (if valid); otherwise keep current
    setGraphConfig({
      ...graphConfig,
      [field]: Number.isNaN(exp) ? graphConfig[field] : String(exp),
    });
    // Sync local pair values - keep the user's input as-is in actual field
    setLogValues((prev) => ({
      ...prev,
      [field]: {
        exp: Number.isNaN(exp) ? prev[field].exp : String(exp),
        actual: String(value),
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
    <div className="graph-config-container">
      <h3>Graph Configuration</h3>
      
      <div className="config-section">
        <label>
          Curve/Line Name:
          <input
            type="text"
            name="curveName"
            value={graphConfig.curveName}
            onChange={handleChange}
            placeholder="Enter curve name"
          />
        </label>
        <label>
          TC/TJ (Temperature):
          <input
            type="text"
            name="temperature"
            value={graphConfig.temperature}
            onChange={handleChange}
            placeholder="e.g., -40°C, 25°C"
          />
        </label>
        <label>
          Part Number (optional):
          <input
            type="text"
            name="partNumber"
            value={graphConfig.partNumber}
            onChange={handleChange}
            placeholder="Enter part number"
          />
        </label>
      </div>

      <div className="config-row">
        <div className="config-section">
          <h4>Y-Axis</h4>
          <label>
            Scale:
            <select name="yScale" value={graphConfig.yScale} onChange={handleChange}>
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.yScale === 'Logarithmic' && (
            <small className="helper-text">For Logarithmic values Enter EITHER the exponent OR the actual value (not both)</small>
          )}
          <label>
            Unit:
            <select name="yUnitPrefix" value={graphConfig.yUnitPrefix} onChange={handleChange}>
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
              <label>
                Min (10^x):
                <div style={{ display: 'flex', gap: '8px', fontSize: 12, color: '#1976d2', marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>Log Exponent</span>
                  <span style={{ flex: 1 }}>Graph Scale Value</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMin.exp}
                      onChange={(e) => handleLogExponentChange('yMin', e.target.value)}
                      onFocus={() => handleExponentFocus('yMin')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.yMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMin.actual}
                      onChange={(e) => handleLogActualChange('yMin', e.target.value)}
                      onFocus={() => handleActualFocus('yMin')}
                      placeholder="e.g., 100k or 1e5"
                      style={{ width: '100%', opacity: logInputMode.yMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent."
                    />
                  </div>
                </div>
                {logError.y && <span style={{ color: '#d32f2f', fontSize: 12 }}>{logError.y}</span>}
              </label>
              <label>
                Max (10^x):
                <div style={{ display: 'flex', gap: '8px', fontSize: 12, color: '#1976d2', marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>Log Exponent</span>
                  <span style={{ flex: 1 }}>Graph Scale Value</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMax.exp}
                      onChange={(e) => handleLogExponentChange('yMax', e.target.value)}
                      onFocus={() => handleExponentFocus('yMax')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.yMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.yMax.actual}
                      onChange={(e) => handleLogActualChange('yMax', e.target.value)}
                      onFocus={() => handleActualFocus('yMax')}
                      placeholder="e.g., 100k or 1e5"
                      style={{ width: '100%', opacity: logInputMode.yMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent."
                    />
                  </div>
                </div>
              </label>
            </>
          ) : (
            <>
              <label>
                Min:
                <input
                  type="number"
                  name="yMin"
                  value={graphConfig.yMin}
                  onChange={handleChange}
                />
              </label>
              <label>
                Max:
                <input
                  type="number"
                  name="yMax"
                  value={graphConfig.yMax}
                  onChange={handleChange}
                />
                {logError.y && <span style={{ color: '#d32f2f', fontSize: 12, display: 'block', marginTop: 4 }}>{logError.y}</span>}
              </label>
            </>
          )}
        </div>

        <div className="config-section">
          <h4>X-Axis</h4>
          <label>
            Scale:
            <select name="xScale" value={graphConfig.xScale} onChange={handleChange}>
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {graphConfig.xScale === 'Logarithmic' && (
            <small className="helper-text">For Logarithmic values Enter EITHER the exponent OR the actual value (not both)</small>
          )}
          <label>
            Unit:
            <select name="xUnitPrefix" value={graphConfig.xUnitPrefix} onChange={handleChange}>
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
              <label>
                Min (10^x):
                <div style={{ display: 'flex', gap: '8px', fontSize: 12, color: '#1976d2', marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>Log Exponent</span>
                  <span style={{ flex: 1 }}>Graph Scale Value</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMin.exp}
                      onChange={(e) => handleLogExponentChange('xMin', e.target.value)}
                      onFocus={() => handleExponentFocus('xMin')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.xMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMin.actual}
                      onChange={(e) => handleLogActualChange('xMin', e.target.value)}
                      onFocus={() => handleActualFocus('xMin')}
                      placeholder="e.g., 100k or 1e5"
                      style={{ width: '100%', opacity: logInputMode.xMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent."
                    />
                  </div>
                </div>
                {logError.x && <span style={{ color: '#d32f2f', fontSize: 12 }}>{logError.x}</span>}
              </label>
              <label>
                Max (10^x):
                <div style={{ display: 'flex', gap: '8px', fontSize: 12, color: '#1976d2', marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>Log Exponent</span>
                  <span style={{ flex: 1 }}>Graph Scale Value</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMax.exp}
                      onChange={(e) => handleLogExponentChange('xMax', e.target.value)}
                      onFocus={() => handleExponentFocus('xMax')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.xMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={logValues.xMax.actual}
                      onChange={(e) => handleLogActualChange('xMax', e.target.value)}
                      onFocus={() => handleActualFocus('xMax')}
                      placeholder="e.g., 100k or 1e5"
                      style={{ width: '100%', opacity: logInputMode.xMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000 or 1e5). It will be converted to exponent."
                    />
                  </div>
                </div>
              </label>
            </>
          ) : (
            <>
              <label>
                Min:
                <input
                  type="number"
                  name="xMin"
                  value={graphConfig.xMin}
                  onChange={handleChange}
                />
              </label>
              <label>
                Max:
                <input
                  type="number"
                  name="xMax"
                  value={graphConfig.xMax}
                  onChange={handleChange}
                />
                {logError.x && <span style={{ color: '#d32f2f', fontSize: 12, display: 'block', marginTop: 4 }}>{logError.x}</span>}
              </label>
            </>
          )}
        </div>
      </div>

      {/* Temperature input moved above */}
    </div>
  );
};

export default GraphConfig;

import { useGraph } from '../context/GraphContext';
import './GraphConfig.css';
import { useState, useEffect } from 'react';

const GraphConfig = () => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [logError, setLogError] = useState({ x: '', y: '' });
  
  // Track which input field is being used for logarithmic values
  const [logInputMode, setLogInputMode] = useState({
    xMin: 'exponent', // 'exponent' or 'actual'
    xMax: 'exponent',
    yMin: 'exponent',
    yMax: 'exponent',
  });

  // Validate log min/max
  useEffect(() => {
    let xErr = '', yErr = '';
    // Removed validation for log scale min/max > 0 to allow negative exponents
    setLogError({ x: xErr, y: yErr });
  }, [graphConfig.xScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yScale, graphConfig.yMin, graphConfig.yMax]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setGraphConfig({
      ...graphConfig,
      [name]: value,
    });
  };

  // Handle logarithmic input for exponent field
  const handleLogExponentChange = (field, value) => {
    setLogInputMode({ ...logInputMode, [field]: 'exponent' });
    setGraphConfig({
      ...graphConfig,
      [field]: value,
    });
  };

  // Handle logarithmic input for actual value field
  const handleLogActualChange = (field, value) => {
    setLogInputMode({ ...logInputMode, [field]: 'actual' });
    const numValue = parseFloat(value);
    if (numValue > 0 && !isNaN(numValue)) {
      const exponent = Math.log10(numValue);
      setGraphConfig({
        ...graphConfig,
        [field]: exponent.toString(),
      });
    } else {
      setGraphConfig({
        ...graphConfig,
        [field]: value,
      });
    }
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
          <small className="helper-text">Linear: evenly spaced values. Logarithmic: spans powers of 10 (decades).</small>
          {graphConfig.yScale === 'Logarithmic' && (
            <small className="helper-text">Enter EITHER the exponent OR the actual value (not both)</small>
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      value={logInputMode.yMin === 'exponent' ? graphConfig.yMin : ''}
                      onChange={(e) => handleLogExponentChange('yMin', e.target.value)}
                      onFocus={() => handleExponentFocus('yMin')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.yMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      onChange={(e) => handleLogActualChange('yMin', e.target.value)}
                      onFocus={() => handleActualFocus('yMin')}
                      placeholder="e.g., 100k"
                      style={{ width: '100%', opacity: logInputMode.yMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000). It will be converted to exponent."
                    />
                  </div>
                </div>
                {logError.y && <span style={{ color: '#d32f2f', fontSize: 12 }}>{logError.y}</span>}
              </label>
              <label>
                Max (10^x):
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      value={logInputMode.yMax === 'exponent' ? graphConfig.yMax : ''}
                      onChange={(e) => handleLogExponentChange('yMax', e.target.value)}
                      onFocus={() => handleExponentFocus('yMax')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.yMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      onChange={(e) => handleLogActualChange('yMax', e.target.value)}
                      onFocus={() => handleActualFocus('yMax')}
                      placeholder="e.g., 100k"
                      style={{ width: '100%', opacity: logInputMode.yMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000). It will be converted to exponent."
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
          <small className="helper-text">Linear: evenly spaced values. Logarithmic: spans powers of 10 (decades).</small>
          {graphConfig.xScale === 'Logarithmic' && (
            <small className="helper-text">Enter EITHER the exponent OR the actual value (not both)</small>
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      value={logInputMode.xMin === 'exponent' ? graphConfig.xMin : ''}
                      onChange={(e) => handleLogExponentChange('xMin', e.target.value)}
                      onFocus={() => handleExponentFocus('xMin')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.xMin === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      onChange={(e) => handleLogActualChange('xMin', e.target.value)}
                      onFocus={() => handleActualFocus('xMin')}
                      placeholder="e.g., 100k"
                      style={{ width: '100%', opacity: logInputMode.xMin === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000). It will be converted to exponent."
                    />
                  </div>
                </div>
                {logError.x && <span style={{ color: '#d32f2f', fontSize: 12 }}>{logError.x}</span>}
              </label>
              <label>
                Max (10^x):
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      value={logInputMode.xMax === 'exponent' ? graphConfig.xMax : ''}
                      onChange={(e) => handleLogExponentChange('xMax', e.target.value)}
                      onFocus={() => handleExponentFocus('xMax')}
                      placeholder="e.g., 5 for 10^5"
                      style={{ width: '100%', opacity: logInputMode.xMax === 'actual' ? 0.5 : 1 }}
                      title="Enter the exponent (e.g., 5 for 10^5 = 100000)"
                    />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="number"
                      onChange={(e) => handleLogActualChange('xMax', e.target.value)}
                      onFocus={() => handleActualFocus('xMax')}
                      placeholder="e.g., 100k"
                      style={{ width: '100%', opacity: logInputMode.xMax === 'exponent' ? 0.5 : 1 }}
                      title="Enter the actual value (e.g., 100000). It will be converted to exponent."
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
              </label>
            </>
          )}
        </div>
      </div>

      <div className="config-section">
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
      </div>
    </div>
  );
};

export default GraphConfig;

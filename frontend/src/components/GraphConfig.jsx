import { useGraph } from '../context/GraphContext';
import './GraphConfig.css';

const GraphConfig = () => {
  const { graphConfig, setGraphConfig } = useGraph();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setGraphConfig({
      ...graphConfig,
      [name]: value,
    });
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
            <small className="helper-text">Enter min/max as exponents for 10^x (e.g., -5 for 10^-5, 2 for 10^2)</small>
          )}
          <label>
            Unit:
            <input
              type="text"
              name="yUnit"
              value={graphConfig.yUnit}
              onChange={handleChange}
              placeholder="e.g., A, V"
            />
          </label>
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
            <small className="helper-text">Enter min/max as exponents for 10^x (e.g., -5 for 10^-5, 2 for 10^2)</small>
          )}
          <label>
            Unit:
            <input
              type="text"
              name="xUnit"
              value={graphConfig.xUnit}
              onChange={handleChange}
              placeholder="e.g., V, Hz"
            />
          </label>
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

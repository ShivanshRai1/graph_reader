import { createContext, useContext, useState } from 'react';

const GraphContext = createContext();

export const useGraph = () => {
  const context = useContext(GraphContext);
  if (!context) {
    throw new Error('useGraph must be used within GraphProvider');
  }
  return context;
};

export const GraphProvider = ({ children }) => {
  // Image state
  const [uploadedImage, setUploadedImage] = useState(null);
  
  // Graph configuration state
  const [graphConfig, setGraphConfig] = useState({
    partNumber: '',
    curveName: '',
    xScale: 'Linear',
    yScale: 'Linear',
    xUnit: '',
    yUnit: '',
    xUnitPrefix: '',
    yUnitPrefix: '',
    xMin: 0,
    xMax: 100,
    yMin: 0,
    yMax: 100,
    temperature: '',
  });
  
  // Graph area selection (coordinates)
  const [graphArea, setGraphArea] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  
  // Data points captured from the graph
  const [dataPoints, setDataPoints] = useState([]);
  
  // Saved curves
  const [savedCurves, setSavedCurves] = useState([]);

  // Normalize logarithmic value - convert actual value to exponent if needed
  const normalizeLogValue = (value) => {
    const num = parseFloat(value);
    if (isNaN(num)) return 0; // Return 0 for invalid input
    
    // For log scale, values entered are already exponents, so just return them
    // (Users enter exponents like -2, 0, 2.8, etc.)
    return num;
  };

  // Get normalized min/max for calculations
  const getNormalizedMinMax = () => {
    let xMin = parseFloat(graphConfig.xMin);
    let xMax = parseFloat(graphConfig.xMax);
    let yMin = parseFloat(graphConfig.yMin);
    let yMax = parseFloat(graphConfig.yMax);

    // Handle NaN
    if (isNaN(xMin)) xMin = 0;
    if (isNaN(xMax)) xMax = 100;
    if (isNaN(yMin)) yMin = 0;
    if (isNaN(yMax)) yMax = 100;

    // Apply unit prefix multipliers only for linear scales (not for exponents in log scales)
    if (graphConfig.xScale !== 'Logarithmic') {
      const xMultiplier = graphConfig.xUnitPrefix ? parseFloat(graphConfig.xUnitPrefix) : 1;
      xMin = xMin * xMultiplier;
      xMax = xMax * xMultiplier;
    }
    if (graphConfig.yScale !== 'Logarithmic') {
      const yMultiplier = graphConfig.yUnitPrefix ? parseFloat(graphConfig.yUnitPrefix) : 1;
      yMin = yMin * yMultiplier;
      yMax = yMax * yMultiplier;
    }

    if (graphConfig.xScale === 'Logarithmic') {
      xMin = normalizeLogValue(xMin);
      xMax = normalizeLogValue(xMax);
    }
    if (graphConfig.yScale === 'Logarithmic') {
      yMin = normalizeLogValue(yMin);
      yMax = normalizeLogValue(yMax);
    }

    return { xMin, xMax, yMin, yMax };
  };

  // Convert canvas coordinates to graph coordinates
  const convertCanvasToGraphCoordinates = (canvasX, canvasY) => {
    if (graphArea.width === 0 || graphArea.height === 0) {
      return { x: 0, y: 0 };
    }

    const { xMin, xMax, yMin, yMax } = getNormalizedMinMax();

    let graphX = xMin + 
      ((canvasX - graphArea.x) / graphArea.width) * (xMax - xMin);
    
    let graphY = yMax - 
      ((canvasY - graphArea.y) / graphArea.height) * (yMax - yMin);
    
    // Convert back from exponent to actual value for logarithmic scales
    if (graphConfig.xScale === 'Logarithmic') {
      graphX = Math.pow(10, graphX);
    }
    if (graphConfig.yScale === 'Logarithmic') {
      graphY = Math.pow(10, graphY);
    }
    
    return { x: graphX, y: graphY };
  };

  const addDataPoint = (point) => {
    // Convert canvas coordinates to graph coordinates
    const graphCoords = convertCanvasToGraphCoordinates(point.canvasX, point.canvasY);
    
    const dataPoint = {
      canvasX: point.canvasX,
      canvasY: point.canvasY,
      x: graphCoords.x,
      y: graphCoords.y,
    };
    
    setDataPoints([...dataPoints, dataPoint]);
  };

  const clearDataPoints = () => {
    setDataPoints([]);
  };

  const saveCurve = async () => {
    // TODO: Call API to save curve
    const newCurve = {
      ...graphConfig,
      x_unit: graphConfig.xUnitPrefix,
      y_unit: graphConfig.yUnitPrefix,
      points: dataPoints,
      timestamp: new Date().toISOString(),
    };
    setSavedCurves([...savedCurves, newCurve]);
    return newCurve;
  };

  const value = {
    uploadedImage,
    setUploadedImage,
    graphConfig,
    setGraphConfig,
    graphArea,
    setGraphArea,
    dataPoints,
    addDataPoint,
    clearDataPoints,
    savedCurves,
    setSavedCurves,
    saveCurve,
  };

  return (
    <GraphContext.Provider value={value}>
      {children}
    </GraphContext.Provider>
  );
};

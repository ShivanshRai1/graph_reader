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
    curveName: '',
    xScale: 'Linear',
    yScale: 'Linear',
    xUnit: '',
    yUnit: '',
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
    // If value is between -10 and 10, assume it's an exponent
    // Otherwise, assume it's an actual value and convert to exponent
    if (Math.abs(num) <= 10 && Number.isInteger(num)) {
      return num; // It's an exponent
    } else if (num > 0) {
      return Math.log10(num); // Convert actual value to exponent
    }
    return num; // Fallback
  };

  // Get normalized min/max for calculations
  const getNormalizedMinMax = () => {
    let xMin = parseFloat(graphConfig.xMin);
    let xMax = parseFloat(graphConfig.xMax);
    let yMin = parseFloat(graphConfig.yMin);
    let yMax = parseFloat(graphConfig.yMax);

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

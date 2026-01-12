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

  // Convert canvas coordinates to graph coordinates
  const convertCanvasToGraphCoordinates = (canvasX, canvasY) => {
    if (graphArea.width === 0 || graphArea.height === 0) {
      return { x: 0, y: 0 };
    }

    const graphX = graphConfig.xMin + 
      ((canvasX - graphArea.x) / graphArea.width) * (graphConfig.xMax - graphConfig.xMin);
    
    const graphY = graphConfig.yMax - 
      ((canvasY - graphArea.y) / graphArea.height) * (graphConfig.yMax - graphConfig.yMin);
    
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

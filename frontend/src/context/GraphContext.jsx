import { createContext, useContext, useState, useEffect } from 'react';

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
    graphTitle: '',
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

    // User enters min/max in display units (e.g., 0-100 μJ)
    // Do NOT multiply by unit prefix - keep values in display units

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
    
    // For logarithmic scales, keep the exponent value (don't convert to actual)
    // This prevents database overflow and is the correct representation for log data
    
    return { x: graphX, y: graphY };
  };

  // Convert graph coordinates to canvas coordinates
  // Optional boundsOverride lets us map using updated bounds before state flushes
  const convertGraphToCanvasCoordinates = (graphX, graphY, boundsOverride) => {
    if (graphArea.width === 0 || graphArea.height === 0) {
      return { canvasX: 0, canvasY: 0 };
    }

    const { xMin, xMax, yMin, yMax } = boundsOverride || getNormalizedMinMax();

    // Avoid divide-by-zero and handle edge cases
    const dx = Math.max(xMax - xMin, 1e-9);
    const dy = Math.max(yMax - yMin, 1e-9);
    let x = graphX;
    let y = graphY;

    // For log scales, clamp to positive range and convert to exponent
    if (graphConfig.xScale === 'Logarithmic') {
      x = Math.max(x, 1e-12);
      x = Math.log10(x);
    }
    if (graphConfig.yScale === 'Logarithmic') {
      y = Math.max(y, 1e-12);
      y = Math.log10(y);
    }

    const canvasX = graphArea.x + ((x - xMin) / dx) * graphArea.width;
    const canvasY = graphArea.y + ((yMax - y) / dy) * graphArea.height;

    return { canvasX, canvasY };
  };

  const addDataPoint = (point) => {
    // Convert canvas coordinates to graph coordinates
    const graphCoords = convertCanvasToGraphCoordinates(point.canvasX, point.canvasY);
    // Debug: Log the captured graph coordinates
    console.log('Captured point:', {
      canvasX: point.canvasX,
      canvasY: point.canvasY,
      x: graphCoords.x,
      y: graphCoords.y,
      xScale: graphConfig.xScale,
      yScale: graphConfig.yScale,
      note: graphConfig.yScale === 'Logarithmic' ? 'y value is log/exponent (prevents DB overflow)' : '',
    });
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

  const replaceDataPoints = (points) => {
    setDataPoints(Array.isArray(points) ? points : []);
  };

  const importDataPoints = (newPoints) => {
    if (!newPoints || newPoints.length === 0) return;

    // Use user's configured min/max values directly (no expansion)
    // This ensures points plot correctly within their configured range
    const pointsWithCanvas = newPoints.map(point => {
      const canvasCoords = convertGraphToCanvasCoordinates(point.x, point.y);
      return {
        x: point.x,
        y: point.y,
        canvasX: canvasCoords.canvasX,
        canvasY: canvasCoords.canvasY,
        imported: true, // mark imported so we can choose whether to render
      };
    });

    // Deduplicate: remove duplicate points within the batch and against existing points
    const seenCoordinates = new Set();
    dataPoints.forEach(point => {
      const key = `${point.x.toFixed(10)},${point.y.toFixed(10)}`;
      seenCoordinates.add(key);
    });

    const deduplicatedPoints = pointsWithCanvas.filter(point => {
      const key = `${point.x.toFixed(10)},${point.y.toFixed(10)}`;
      if (seenCoordinates.has(key)) {
        return false;
      }
      seenCoordinates.add(key);
      return true;
    });

    // Append deduplicated points to existing data points
    setDataPoints([...dataPoints, ...deduplicatedPoints]);
  };

  const updateDataPoint = (index, newX, newY) => {
    if (index < 0 || index >= dataPoints.length) return;
    
    const point = dataPoints[index];
    const canvasCoords = convertGraphToCanvasCoordinates(newX, newY);
    
    const updatedPoint = {
      ...point,
      x: newX,
      y: newY,
      canvasX: canvasCoords.canvasX,
      canvasY: canvasCoords.canvasY,
    };
    
    const updatedPoints = [...dataPoints];
    updatedPoints[index] = updatedPoint;
    setDataPoints(updatedPoints);
  };

  const deleteDataPoint = (index) => {
    if (index < 0 || index >= dataPoints.length) return;
    
    const updatedPoints = dataPoints.filter((_, i) => i !== index);
    setDataPoints(updatedPoints);
  };

  // Recalculate canvas coordinates for imported points when scale/unit/min-max changes
  useEffect(() => {
    // Only recalculate if there are imported points
    const hasImportedPoints = dataPoints.some(p => p.imported);
    if (!hasImportedPoints || graphArea.width === 0 || graphArea.height === 0) {
      return;
    }

    const updatedPoints = dataPoints.map(point => {
      if (!point.imported) {
        return point; // Keep user-captured points as-is
      }

      // Recalculate canvas coordinates for imported points
      const canvasCoords = convertGraphToCanvasCoordinates(point.x, point.y);
      return {
        ...point,
        canvasX: canvasCoords.canvasX,
        canvasY: canvasCoords.canvasY,
      };
    });

    setDataPoints(updatedPoints);
  }, [graphConfig.xScale, graphConfig.yScale, graphConfig.xUnitPrefix, graphConfig.yUnitPrefix, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphArea.width, graphArea.height]);

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
    replaceDataPoints,
    importDataPoints,
    updateDataPoint,
    deleteDataPoint,
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

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

  const importDataPoints = (newPoints) => {
    if (!newPoints || newPoints.length === 0) return;

    // Compute data extents from imported points
    let dataXMin = Number.POSITIVE_INFINITY;
    let dataXMax = Number.NEGATIVE_INFINITY;
    let dataYMin = Number.POSITIVE_INFINITY;
    let dataYMax = Number.NEGATIVE_INFINITY;

    newPoints.forEach(point => {
      if (typeof point.x === 'number' && !isNaN(point.x)) {
        dataXMin = Math.min(dataXMin, point.x);
        dataXMax = Math.max(dataXMax, point.x);
      }
      if (typeof point.y === 'number' && !isNaN(point.y)) {
        dataYMin = Math.min(dataYMin, point.y);
        dataYMax = Math.max(dataYMax, point.y);
      }
    });

    // Fallback if all invalid
    if (!isFinite(dataXMin) || !isFinite(dataXMax) || !isFinite(dataYMin) || !isFinite(dataYMax)) {
      return;
    }

    // Current bounds (already normalized for units/log)
    const { xMin: currXMin, xMax: currXMax, yMin: currYMin, yMax: currYMax } = getNormalizedMinMax();

    // Expand bounds to fit imported data (with small padding) for canvas mapping only
    let newXMin = Math.min(currXMin, dataXMin);
    let newXMax = Math.max(currXMax, dataXMax);
    let newYMin = Math.min(currYMin, dataYMin);
    let newYMax = Math.max(currYMax, dataYMax);

    const padX = Math.max((newXMax - newXMin) * 0.05, 1e-6);
    const padY = Math.max((newYMax - newYMin) * 0.05, 1e-6);
    newXMin -= padX;
    newXMax += padX;
    newYMin -= padY;
    newYMax += padY;

    // Use expanded bounds ONLY for converting imported points to canvas coordinates
    // Do NOT modify graphConfig - keep user's original bounds
    const boundsOverride = { xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax };
    const pointsWithCanvas = newPoints.map(point => {
      const canvasCoords = convertGraphToCanvasCoordinates(point.x, point.y, boundsOverride);
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
    importDataPoints,
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

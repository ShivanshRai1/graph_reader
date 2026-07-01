import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { 
  getAnnotationsForCurve, 
  saveAnnotationsForCurve, 
  clearAnnotationsForCurve,
  convertAnnotationsToPoints 
} from '../utils/annotationStorage';

const GraphContext = createContext();

export const MANUAL_CAPTURE_OVERLAY_ID = '__manual_capture__';

export const isManualCapturePoint = (point) => {
  if (!point) return false;
  if (point.overlayCurveId === MANUAL_CAPTURE_OVERLAY_ID) return true;
  if (point.imported === true) return false;
  return true;
};

export const getManualCapturePoints = (points = []) =>
  (Array.isArray(points) ? points : []).filter(isManualCapturePoint);

const getSafeLogBoundsStatic = (minValue, maxValue) => {
  const safeMin = Number.isFinite(minValue) && minValue > 0 ? minValue : 1e-12;
  const candidateMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : safeMin * 10;
  const safeMax = candidateMax > safeMin ? candidateMax : safeMin * 10;
  return {
    min: safeMin,
    max: safeMax,
    logMin: Math.log10(safeMin),
    logMax: Math.log10(safeMax),
  };
};

const getAxisBoundsFromConfig = (graphConfig = {}) => {
  let xMin = parseFloat(graphConfig.xMin);
  let xMax = parseFloat(graphConfig.xMax);
  let yMin = parseFloat(graphConfig.yMin);
  let yMax = parseFloat(graphConfig.yMax);

  if (Number.isNaN(xMin)) xMin = graphConfig.xScale === 'Logarithmic' ? 1 : 0;
  if (Number.isNaN(xMax)) xMax = 100;
  if (Number.isNaN(yMin)) yMin = graphConfig.yScale === 'Logarithmic' ? 1 : 0;
  if (Number.isNaN(yMax)) yMax = 100;

  return { xMin, xMax, yMin, yMax };
};

export const graphToCanvasWithBounds = (graphX, graphY, graphArea, graphConfig = {}) => {
  if (!graphArea || graphArea.width === 0 || graphArea.height === 0) {
    return { canvasX: 0, canvasY: 0 };
  }

  const { xMin, xMax, yMin, yMax } = getAxisBoundsFromConfig(graphConfig);

  let canvasX;
  if (graphConfig.xScale === 'Logarithmic') {
    const xBounds = getSafeLogBoundsStatic(xMin, xMax);
    const xLog = Math.log10(Math.max(Number(graphX), 1e-12));
    const xRange = Math.max(xBounds.logMax - xBounds.logMin, 1e-9);
    canvasX = graphArea.x + ((xLog - xBounds.logMin) / xRange) * graphArea.width;
  } else {
    const dx = Math.max(xMax - xMin, 1e-9);
    canvasX = graphArea.x + ((graphX - xMin) / dx) * graphArea.width;
  }

  let canvasY;
  if (graphConfig.yScale === 'Logarithmic') {
    const yBounds = getSafeLogBoundsStatic(yMin, yMax);
    const yLog = Math.log10(Math.max(Number(graphY), 1e-12));
    const yRange = Math.max(yBounds.logMax - yBounds.logMin, 1e-9);
    canvasY = graphArea.y + ((yBounds.logMax - yLog) / yRange) * graphArea.height;
  } else {
    const dy = Math.max(yMax - yMin, 1e-9);
    canvasY = graphArea.y + ((yMax - graphY) / dy) * graphArea.height;
  }

  return { canvasX, canvasY };
};

export const canvasToGraphWithBounds = (canvasX, canvasY, graphArea, graphConfig = {}) => {
  if (!graphArea || graphArea.width === 0 || graphArea.height === 0) {
    return { x: 0, y: 0 };
  }

  const { xMin, xMax, yMin, yMax } = getAxisBoundsFromConfig(graphConfig);
  const xRatio = (canvasX - graphArea.x) / graphArea.width;
  const yRatio = (canvasY - graphArea.y) / graphArea.height;

  let graphX;
  if (graphConfig.xScale === 'Logarithmic') {
    const xBounds = getSafeLogBoundsStatic(xMin, xMax);
    const exponent = xBounds.logMin + xRatio * (xBounds.logMax - xBounds.logMin);
    graphX = Math.pow(10, exponent);
  } else {
    graphX = xMin + xRatio * (xMax - xMin);
  }

  let graphY;
  if (graphConfig.yScale === 'Logarithmic') {
    const yBounds = getSafeLogBoundsStatic(yMin, yMax);
    const exponent = yBounds.logMax - yRatio * (yBounds.logMax - yBounds.logMin);
    graphY = Math.pow(10, exponent);
  } else {
    graphY = yMax - yRatio * (yMax - yMin);
  }

  return { x: graphX, y: graphY };
};

const unionGraphAreas = (baseArea, nextArea) => {
  const base = baseArea && baseArea.width > 0 && baseArea.height > 0 ? baseArea : null;
  const next = nextArea && nextArea.width > 0 && nextArea.height > 0 ? nextArea : null;
  if (!base) return next ? { ...next } : { x: 0, y: 0, width: 0, height: 0 };
  if (!next) return { ...base };
  const minX = Math.min(base.x, next.x);
  const minY = Math.min(base.y, next.y);
  const maxX = Math.max(base.x + base.width, next.x + next.width);
  const maxY = Math.max(base.y + base.height, next.y + next.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

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
    manufacturer: '',
    username: '',
    curveName: '',
    graphTitle: '',
    xLabel: '',
    yLabel: '',
    xScale: 'Linear',
    yScale: 'Linear',
    xUnit: '',
    yUnit: '',
    xUnitPrefix: '1',
    yUnitPrefix: '1',
    xMin: 0,
    xMax: 100,
    yMin: 0,
    yMax: 100,
    temperature: '',
  });
  
  // Capture zone (blue box) — user-resizable; may be smaller than plot reference after confirm.
  const [graphArea, setGraphAreaState] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  // Plot reference — full axis alignment on image; drives coordinate math once locked.
  const [plotReferenceArea, setPlotReferenceArea] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [isPlotReferenceLocked, setIsPlotReferenceLocked] = useState(false);
  const isPlotReferenceLockedRef = useRef(false);

  const getMappingArea = useCallback(() => {
    if (isPlotReferenceLockedRef.current) {
      if (graphArea.width > 0 && graphArea.height > 0) {
        return graphArea;
      }
    }

    const plot = plotReferenceArea.width > 0 && plotReferenceArea.height > 0 ? plotReferenceArea : null;
    const capture = graphArea.width > 0 && graphArea.height > 0 ? graphArea : null;

    if (plot) return plot;
    if (capture) return capture;
    return graphArea;
  }, [graphArea, plotReferenceArea]);

  const setCaptureGraphArea = useCallback((value) => {
    setGraphAreaState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (!isPlotReferenceLockedRef.current) {
        setPlotReferenceArea({ ...next });
      }
      return next;
    });
  }, []);

  const expandPlotReference = useCallback((area) => {
    if (!area || area.width <= 0 || area.height <= 0) return;
    setPlotReferenceArea((prevPlot) => unionGraphAreas(prevPlot, area));
  }, []);

  const establishPlotReference = useCallback((area) => {
    if (!area || area.width <= 0 || area.height <= 0) return;
    setPlotReferenceArea({ ...area });
  }, []);

  const setGraphArea = useCallback((value) => {
    setGraphAreaState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (!isPlotReferenceLockedRef.current) {
        setPlotReferenceArea({ ...next });
      }
      return next;
    });
  }, []);

  const lockPlotReference = useCallback(() => {
    isPlotReferenceLockedRef.current = true;
    setIsPlotReferenceLocked(true);
    setGraphAreaState((currentCaptureBox) => {
      if (currentCaptureBox.width > 0 && currentCaptureBox.height > 0) {
        setPlotReferenceArea({ ...currentCaptureBox });
      }
      return currentCaptureBox;
    });
  }, []);

  const unlockPlotReference = useCallback(() => {
    isPlotReferenceLockedRef.current = false;
    setIsPlotReferenceLocked(false);
    setGraphAreaState((currentCaptureBox) => {
      if (currentCaptureBox.width > 0 && currentCaptureBox.height > 0) {
        setPlotReferenceArea({ ...currentCaptureBox });
      }
      return currentCaptureBox;
    });
  }, []);

  const restorePlotReferenceArea = useCallback((area, { locked = false } = {}) => {
    const normalized = area && area.width > 0 && area.height > 0 ? { ...area } : null;
    if (normalized) {
      setPlotReferenceArea(normalized);
    }
    isPlotReferenceLockedRef.current = Boolean(locked && normalized);
    setIsPlotReferenceLocked(Boolean(locked && normalized));
  }, []);
  
  // Data points captured from the graph
  const [dataPoints, setDataPoints] = useState([]);
  
  // Saved curves
  const [savedCurves, setSavedCurves] = useState([]);
  
  // Track current curve being viewed (for annotation persistence)
  const [currentCurveId, setCurrentCurveId] = useState(null);

  const getSafeLogBounds = (minValue, maxValue) => {
    const safeMin = Number.isFinite(minValue) && minValue > 0 ? minValue : 1e-12;
    const candidateMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : safeMin * 10;
    const safeMax = candidateMax > safeMin ? candidateMax : safeMin * 10;
    return {
      min: safeMin,
      max: safeMax,
      logMin: Math.log10(safeMin),
      logMax: Math.log10(safeMax),
    };
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

    return { xMin, xMax, yMin, yMax };
  };

  // Convert canvas coordinates to graph coordinates
  const convertCanvasToGraphCoordinates = useCallback((canvasX, canvasY) => {
    const mappingArea = getMappingArea();
    return canvasToGraphWithBounds(canvasX, canvasY, mappingArea, graphConfig);
  }, [
    getMappingArea,
    graphConfig.xMin,
    graphConfig.xMax,
    graphConfig.yMin,
    graphConfig.yMax,
    graphConfig.xScale,
    graphConfig.yScale,
  ]);

  // Convert graph coordinates to canvas coordinates
  // Optional boundsOverride lets us map using updated bounds before state flushes
  const convertGraphToCanvasCoordinates = (graphX, graphY, boundsOverride) => {
    const configForConversion = boundsOverride
      ? {
          ...graphConfig,
          xMin: boundsOverride.xMin,
          xMax: boundsOverride.xMax,
          yMin: boundsOverride.yMin,
          yMax: boundsOverride.yMax,
        }
      : graphConfig;

    return graphToCanvasWithBounds(graphX, graphY, getMappingArea(), configForConversion);
  };

  const addDataPoint = (point, curveId = null) => {
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
      note: graphConfig.yScale === 'Logarithmic' ? 'y value is real value mapped by logarithmic axis' : '',
    });
    
    const targetCurveId = curveId || currentCurveId;
    const dataPoint = {
      canvasX: point.canvasX,
      canvasY: point.canvasY,
      x: graphCoords.x,
      y: graphCoords.y,
      overlayCurveId: point.overlayCurveId || MANUAL_CAPTURE_OVERLAY_ID,
      // Mark this as an annotation if we know which curve we're working on
      isAnnotation: !!targetCurveId,
    };

    // Check for duplicate point (same x, y coordinates within precision 6)
    const isDuplicate = dataPoints.some((existing) => {
      const existingXKey = Number(existing.x).toFixed(6);
      const existingYKey = Number(existing.y).toFixed(6);
      const newXKey = Number(dataPoint.x).toFixed(6);
      const newYKey = Number(dataPoint.y).toFixed(6);
      return existingXKey === newXKey && existingYKey === newYKey;
    });

    if (isDuplicate) {
      console.warn('[DEDUP] Duplicate point detected, skipping:', { x: dataPoint.x.toFixed(6), y: dataPoint.y.toFixed(6) });
      return;
    }

    const newDataPoints = [...dataPoints, dataPoint];
    setDataPoints(newDataPoints);
    
    // Auto-save annotation if we know which curve we're working on
    if (targetCurveId) {
      saveAnnotationsForCurve(targetCurveId, newDataPoints);
      console.log(`[ANNOTATIONS] Auto-saved annotation for curve ${targetCurveId}`);
    }
  };

  const clearDataPoints = () => {
    setDataPoints([]);
    // Also clear saved annotations for this curve
    if (currentCurveId) {
      clearAnnotationsForCurve(currentCurveId);
      console.log(`[ANNOTATIONS] Cleared annotations for curve ${currentCurveId}`);
    }
  };

  const clearAnnotationsOnly = () => {
    // Remove only annotation points, keep imported points
    const importedPointsOnly = dataPoints.filter(p => p.imported === true);
    setDataPoints(importedPointsOnly);
    
    // Clear saved annotations from storage
    if (currentCurveId) {
      clearAnnotationsForCurve(currentCurveId);
      console.log(`[ANNOTATIONS] Cleared annotations only for curve ${currentCurveId}`);
    }
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
        overlayCurveId: MANUAL_CAPTURE_OVERLAY_ID,
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
    setDataPoints((prev) => {
      if (index < 0 || index >= prev.length) return prev;

      const point = prev[index];
      const canvasCoords = convertGraphToCanvasCoordinates(newX, newY);

      const updatedPoint = {
        ...point,
        x: newX,
        y: newY,
        canvasX: canvasCoords.canvasX,
        canvasY: canvasCoords.canvasY,
      };

      const updatedPoints = [...prev];
      updatedPoints[index] = updatedPoint;
      return updatedPoints;
    });
  };

  const updateDataPointFromCanvas = (index, canvasX, canvasY) => {
    setDataPoints((prev) => {
      if (index < 0 || index >= prev.length) return prev;

      const graphCoords = convertCanvasToGraphCoordinates(canvasX, canvasY);
      if (!Number.isFinite(graphCoords.x) || !Number.isFinite(graphCoords.y)) return prev;

      const point = prev[index];
      const updatedPoint = {
        ...point,
        x: graphCoords.x,
        y: graphCoords.y,
        canvasX,
        canvasY,
      };

      const updatedPoints = [...prev];
      updatedPoints[index] = updatedPoint;
      return updatedPoints;
    });
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
    const mappingArea = getMappingArea();
    if (!hasImportedPoints || mappingArea.width === 0 || mappingArea.height === 0) {
      return;
    }

    const updatedPoints = dataPoints.map((point) => {
      if (!point.imported) {
        return point;
      }

      const canvasCoords = graphToCanvasWithBounds(point.x, point.y, mappingArea, graphConfig);
      if (
        Number.isFinite(point.canvasX) &&
        Number.isFinite(point.canvasY) &&
        Math.abs(point.canvasX - canvasCoords.canvasX) < 0.01 &&
        Math.abs(point.canvasY - canvasCoords.canvasY) < 0.01
      ) {
        return point;
      }

      return {
        ...point,
        canvasX: canvasCoords.canvasX,
        canvasY: canvasCoords.canvasY,
      };
    });

    const changed = updatedPoints.some((point, index) => point !== dataPoints[index]);
    if (changed) {
      setDataPoints(updatedPoints);
    }
  }, [graphConfig.xScale, graphConfig.yScale, graphConfig.xUnitPrefix, graphConfig.yUnitPrefix, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphArea, plotReferenceArea, isPlotReferenceLocked, dataPoints.length]);

  /**
   * Load saved annotations for a curve and add them to current data points
   * Used when user views a saved curve to restore their annotations
   */
  const loadAnnotationsForCurve = (curveId) => {
    if (!curveId) return;
    
    setCurrentCurveId(curveId);
    const savedAnnotations = getAnnotationsForCurve(curveId);
    
    if (savedAnnotations.length > 0) {
      const annotationPoints = convertAnnotationsToPoints(savedAnnotations);
      // Add annotations to current data points (they already have canvas coordinates)
      setDataPoints(prevPoints => {
        const dedupPrecision = 6;
        // Only add annotations that aren't already there (avoid duplicates on rescale)
        const existingCoords = new Set();
        prevPoints.forEach(p => {
          existingCoords.add(`${p.x.toFixed(dedupPrecision)},${p.y.toFixed(dedupPrecision)}`);
        });
        
        const newAnnotations = annotationPoints.filter(ann => {
          const key = `${ann.x.toFixed(dedupPrecision)},${ann.y.toFixed(dedupPrecision)}`;
          return !existingCoords.has(key);
        });
        
        console.log(`[ANNOTATIONS] Loaded ${newAnnotations.length} saved annotations for curve ${curveId}`);
        return [...prevPoints, ...newAnnotations];
      });
    } else {
      console.log(`[ANNOTATIONS] No saved annotations found for curve ${curveId}`);
    }
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
    setCaptureGraphArea,
    plotReferenceArea,
    isPlotReferenceLocked,
    getMappingArea,
    lockPlotReference,
    unlockPlotReference,
    restorePlotReferenceArea,
    expandPlotReference,
    establishPlotReference,
    dataPoints,
    addDataPoint,
    clearDataPoints,
    clearAnnotationsOnly,
    replaceDataPoints,
    importDataPoints,
    updateDataPoint,
    updateDataPointFromCanvas,
    deleteDataPoint,
    savedCurves,
    setSavedCurves,
    saveCurve,
    currentCurveId,
    setCurrentCurveId,
    loadAnnotationsForCurve,
    convertCanvasToGraphCoordinates,
    convertGraphToCanvasCoordinates,
  };

  return (
    <GraphContext.Provider value={value}>
      {children}
    </GraphContext.Provider>
  );
};

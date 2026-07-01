import { useRef, useState, useEffect, useMemo } from 'react';
import { useGraph, isManualCapturePoint, getManualCapturePoints, canvasToGraphWithBounds } from '../context/GraphContext';
import { buildDefaultGraphArea, graphAreasAreSimilar } from '../utils/graphAreaHelpers';
import {
  shouldShowScaleAndUnitCrossCheck,
  SCALE_AND_UNIT_CROSS_CHECK_MESSAGE,
} from '../utils/quantityUnitGuidance';

const GraphCanvas = ({ isReadOnly = false, partNumber = '', manufacturer = '', isAxisMappingConfirmed = false, hasReturnUrl = false, isEditingCurve = false, editingCurveOverlayId = '', savedCurveViewActive = false, hasAiSavedCurves = false, showAiCaptureGuidance = false, useInsetDefaultAxisBox = false, onGraphAreaManuallyAdjusted }) => {
  const { uploadedImage, graphArea, setGraphArea, setCaptureGraphArea, plotReferenceArea, isPlotReferenceLocked, getMappingArea, establishPlotReference, dataPoints, addDataPoint, clearDataPoints, graphConfig, deleteDataPoint, convertGraphToCanvasCoordinates, convertCanvasToGraphCoordinates, replaceDataPoints, updateDataPointFromCanvas } = useGraph();
  const [showRedrawMsg, setShowRedrawMsg] = useState(false);
  const canvasRef = useRef(null);
  const magnifierRef = useRef(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showCoords, setShowCoords] = useState(false);
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const [showFixPoints, setShowFixPoints] = useState(false);
  const [connectSortByX, setConnectSortByX] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const [previewMousePos, setPreviewMousePos] = useState({ x: null, y: null });
  const imageRef = useRef(null);
  const coordinateUpdateTimeoutRef = useRef(null);
  const [resizeMode, setResizeMode] = useState(null);
  const [initialArea, setInitialArea] = useState(null);
  const [initialMouse, setInitialMouse] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const justFinishedResizingRef = useRef(false);
  const prevIsResizingRef = useRef(false);
  const graphAreaRef = useRef(graphArea);
  const plotReferenceLockedRef = useRef(isPlotReferenceLocked);
  const dataPointsRef = useRef(dataPoints);
  const [removedPointsMsg, setRemovedPointsMsg] = useState('');
  const removedMsgTimeoutRef = useRef(null);
  const [hoveredHandle, setHoveredHandle] = useState(null);
  const prevCanvasPosRef = useRef(null);
  const prevGraphPosRef = useRef(null);
  const stuckFramesRef = useRef(0);
  const [zeroWarnActive, setZeroWarnActive] = useState(false);
  const [stuckWarnActive, setStuckWarnActive] = useState(false);
  const warningHoldTimeoutRef = useRef(null);
  const lastCaptureClickRef = useRef({ x: null, y: null, ts: 0 });
  const [boxTransparent, setBoxTransparent] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const lastUserBoxRef = useRef(null); // Store last manually set box dimensions
  const potentialResizeHandleRef = useRef(null); // Track which handle was clicked
  const clickedOnHandleRef = useRef(false); // Track if this click originated on a handle
  const [editDragPointIndex, setEditDragPointIndex] = useState(null);
  const editDragPointIndexRef = useRef(null);
  const editDragMovedRef = useRef(false);
  const plotRefLegacyExpandedRef = useRef(false);

  const MARGIN = 6; // Margin from edges for resize handles visibility

  const hasValidAxisForOverlay = () => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    return (
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax) &&
      xMax !== xMin &&
      yMax !== yMin
    );
  };

  const hasImportedCurvePoints = () => dataPoints.some((point) => point.imported);

  /**
   * Datasheet plots with step-4 ticks often label only up to max−4 (e.g. 16 on a 0–20 scale).
   * Returns the inner fraction where that last printed tick sits, or null when not applicable.
   */
  const resolveLastLabeledTickFraction = (axisMin, axisMax) => {
    const min = Number(axisMin);
    const max = Number(axisMax);
    if (min !== 0 || !Number.isFinite(max) || max < 20 || max % 4 !== 0) return null;
    const lastLabeled = max - 4;
    if (lastLabeled <= 0) return null;
    return lastLabeled / max;
  };

  const getAxisTickGuideContext = () => {
    if (graphConfig.xScale === 'Logarithmic' || graphConfig.yScale === 'Logarithmic') return null;
    const xMin = parseFloat(graphConfig.xMin);
    const yMin = parseFloat(graphConfig.yMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMax = parseFloat(graphConfig.yMax);
    if (xMin !== 0 || yMin !== 0 || xMax !== yMax) return null;
    const fraction = resolveLastLabeledTickFraction(xMin, xMax);
    if (!fraction) return null;
    return { axisMax: xMax, lastLabeled: xMax - 4, fraction };
  };

  const drawLastLabeledTickGuides = (ctx, area, fraction) => {
    if (!fraction || fraction <= 0 || fraction >= 1) return;
    const xGuide = area.x + area.width * fraction;
    const yGuide = area.y + area.height * (1 - fraction);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(234, 88, 12, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xGuide, area.y);
    ctx.lineTo(xGuide, area.y + area.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(area.x, yGuide);
    ctx.lineTo(area.x + area.width, yGuide);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  const canShowImportedCurveOverlay = () => {
    if (isEditingCurve) return true;
    return savedCurveViewActive && hasValidAxisForOverlay() && graphArea.width > 0 && graphArea.height > 0;
  };

  const showAiAlignmentGuidance = () =>
    showAiCaptureGuidance && hasImportedCurvePoints() && !canShowImportedCurveOverlay();

  const showScaleAndUnitCrossCheck = useMemo(
    () =>
      shouldShowScaleAndUnitCrossCheck({
        graphTitle: graphConfig.graphTitle,
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
      }),
    [graphConfig.graphTitle, graphConfig.xLabel, graphConfig.yLabel]
  );

  const isSavedViewCrosscheckActive = () =>
    savedCurveViewActive &&
    isReadOnly &&
    !isEditingCurve &&
    canShowImportedCurveOverlay();

  // Allow capture-zone resize before/after confirm; plot reference locks separately on confirm.
  const canAdjustCaptureBox = () => !(isReadOnly && !isEditingCurve);
  const EDGE_GAP = 12; // Hysteresis for edge checks to reduce flicker
  const EPS = 1e-6;
  const WARN_CLEAR_DELAY = 180; // ms to hold warning before clearing
  const DRAG_THRESHOLD = 50; // Threshold to distinguish between click and drag
  const RESIZE_ACTIVATION_THRESHOLD = 10; // pixels to move before activating resize (vs point capture)
  const DOUBLE_CLICK_GUARD_MS = 140; // Only suppress very rapid repeat clicks
  const DOUBLE_CLICK_GUARD_PX = 2; // Only suppress near-identical click locations
  const BOX_STROKE_HALF_PX = 2; // blue box lineWidth is 4, stroke extends outside the rect
  const CAPTURE_EDGE_TOLERANCE_PX = BOX_STROKE_HALF_PX + 4; // cover border stroke + slight aim error
  const CAPTURE_ZONE_INSIDE_COLOR = '#e53935';
  const CAPTURE_ZONE_OUTSIDE_COLOR = '#ff9800';
  const EDIT_POINT_HIT_RADIUS = 12;

  const normalizeArea = (area) => {
    if (!area || typeof area !== 'object') {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    let { x, y, width, height } = area;
    if (width < 0) {
      x = x + width;
      width = Math.abs(width);
    }
    if (height < 0) {
      y = y + height;
      height = Math.abs(height);
    }
    return { x, y, width, height };
  };

  const createInitialAxisBox = (canvasW, canvasH) => {
    const raw = buildDefaultGraphArea(canvasW, canvasH, { useInset: useInsetDefaultAxisBox });
    return constrainAreaToMargin(raw, canvasW, canvasH);
  };

  const constrainAreaToMargin = (area, canvasW, canvasH) => {
    const normalized = normalizeArea(area);
    const minX = MARGIN;
    const minY = MARGIN;
    const maxX = Math.max(minX, canvasW - MARGIN);
    const maxY = Math.max(minY, canvasH - MARGIN);

    let x = Math.min(Math.max(normalized.x, minX), maxX);
    let y = Math.min(Math.max(normalized.y, minY), maxY);
    let width = normalized.width;
    let height = normalized.height;

    const maxWidth = Math.max(0, canvasW - MARGIN - x);
    const maxHeight = Math.max(0, canvasH - MARGIN - y);

    if (width > maxWidth) width = maxWidth;
    if (height > maxHeight) height = maxHeight;

    return { x, y, width, height };
  };

  const findPointIndexAtCanvasPosition = (canvasX, canvasY, hitRadius = EDIT_POINT_HIT_RADIUS) => {
    let bestIndex = -1;
    let bestDistance = hitRadius;

    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;

      const { canvasX: drawX, canvasY: drawY } = convertGraphToCanvasCoordinates(point.x, point.y);
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) continue;

      const dx = canvasX - drawX;
      const dy = canvasY - drawY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    return bestIndex;
  };

  const clampCanvasPointToGraphArea = (canvasX, canvasY) => {
    return { canvasX, canvasY };
  };

  const updatePointFromCanvasPosition = (index, canvasX, canvasY) => {
    const clamped = clampCanvasPointToGraphArea(canvasX, canvasY);
    updateDataPointFromCanvas(index, clamped.canvasX, clamped.canvasY);
  };

  useEffect(() => {
    if (isEditingCurve) {
      setShowFixPoints(true);
    }
  }, [isEditingCurve]);

  useEffect(() => {
    if (!isEditingCurve) {
      editDragPointIndexRef.current = null;
      setEditDragPointIndex(null);
      editDragMovedRef.current = false;
    }
  }, [isEditingCurve]);

  useEffect(() => {
    if (uploadedImage && canvasRef.current) {
      setImageLoadFailed(false);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        setImageLoadFailed(false);
        canvas.width = img.width;
        canvas.height = img.height;
        setImageSize({ width: img.width, height: img.height });
        imageRef.current = img; // Store image reference

        const drawLoadedImage = () => {
          ctx.drawImage(img, 0, 0);
          drawSelection(ctx);
          drawCurveOverlayLayers(ctx);
        };

        // Defer one frame so persisted graphArea from parent can sync into graphAreaRef first.
        requestAnimationFrame(() => {
          const currentArea = normalizeArea(graphAreaRef.current);
          if (currentArea.width === 0 || currentArea.height === 0) {
            const rememberedBox = normalizeArea(lastUserBoxRef.current);
            const initialBox =
              rememberedBox.width > 0 && rememberedBox.height > 0
                ? rememberedBox
                : createInitialAxisBox(img.width, img.height);
            setGraphArea(initialBox);
            lastUserBoxRef.current = initialBox;
            setBoxTransparent(false);
          }

          drawLoadedImage();
        });
      };

      img.onerror = () => {
        console.warn('[GraphCanvas] Failed to load graph image:', uploadedImage);
        setImageLoadFailed(true);
      };
      
      img.src = uploadedImage;
    } else {
      setImageLoadFailed(false);
    }
  }, [uploadedImage]);

  // Ensure a visible default axis box whenever the image is ready but no box exists yet.
  useEffect(() => {
    if (!uploadedImage || imageSize.width <= 0 || imageSize.height <= 0) return;

    const area = normalizeArea(graphArea);
    if (area.width > 0 && area.height > 0) return;

    const rememberedBox = normalizeArea(lastUserBoxRef.current);
    if (rememberedBox.width > 0 && rememberedBox.height > 0) {
      setGraphArea(rememberedBox);
      setBoxTransparent(false);
      return;
    }

    const initialBox = createInitialAxisBox(imageSize.width, imageSize.height);
    setGraphArea(initialBox);
    lastUserBoxRef.current = initialBox;
    setBoxTransparent(false);
  }, [uploadedImage, imageSize.width, imageSize.height, graphArea.width, graphArea.height, graphArea.x, graphArea.y, setGraphArea, useInsetDefaultAxisBox]);

  // Repair plot reference corrupted by prior auto-expand-to-full-image logic.
  useEffect(() => {
    plotRefLegacyExpandedRef.current = false;
  }, [uploadedImage]);

  useEffect(() => {
    if (plotRefLegacyExpandedRef.current) return;
    if (!isAxisMappingConfirmed || !isPlotReferenceLocked) return;
    if (!uploadedImage || imageSize.width <= 0 || imageSize.height <= 0) return;

    const plot = normalizeArea(plotReferenceArea);
    const capture = normalizeArea(graphArea);
    if (plot.width <= 0 || capture.width <= 0) return;

    const plotRefWasAutoExpandedToFullImage =
      plot.width >= imageSize.width * 0.92 && capture.width < plot.width * 0.88;

    if (plotRefWasAutoExpandedToFullImage) {
      establishPlotReference(capture);
      plotRefLegacyExpandedRef.current = true;
      console.log('[PLOT REF] Repaired plot reference to match axis-aligned capture box.');
    }
  }, [
    uploadedImage,
    imageSize.width,
    imageSize.height,
    isAxisMappingConfirmed,
    isPlotReferenceLocked,
    plotReferenceArea,
    graphArea,
    establishPlotReference,
  ]);

  // Separate effect to redraw selection box and points without reloading image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);
    drawSelection(ctx);
    drawCurveOverlayLayers(ctx);
  }, [graphArea, dataPoints, showFixPoints, hoveredHandle, resizeMode, previewMousePos, connectSortByX, isAxisMappingConfirmed, isEditingCurve, savedCurveViewActive, editDragPointIndex, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphConfig.xScale, graphConfig.yScale]);

  // Keep live refs always in sync with latest state
  const graphConfigRef = useRef(graphConfig);
  useEffect(() => { graphAreaRef.current = graphArea; }, [graphArea]);
  useEffect(() => { plotReferenceLockedRef.current = isPlotReferenceLocked; }, [isPlotReferenceLocked]);
  useEffect(() => {
    const area = normalizeArea(graphArea);
    if (area.width > 0 && area.height > 0) {
      lastUserBoxRef.current = area;
    }
  }, [graphArea.x, graphArea.y, graphArea.width, graphArea.height]);
  useEffect(() => { dataPointsRef.current = dataPoints; }, [dataPoints]);
  useEffect(() => { graphConfigRef.current = graphConfig; }, [graphConfig]);

  // Hide the box border only after capture is underway (manual points or confirmed AI overlay).
  useEffect(() => {
    if (dataPoints.length === 0) {
      setBoxTransparent(false);
      return;
    }

    if (isEditingCurve) {
      setBoxTransparent(false);
      return;
    }

    const hasOnlyImported = dataPoints.every((point) => point.imported);
    if (hasOnlyImported && !canShowImportedCurveOverlay()) {
      setBoxTransparent(false);
      return;
    }

    setBoxTransparent(true);
  }, [dataPoints, isAxisMappingConfirmed, isEditingCurve, savedCurveViewActive, graphArea.width, graphArea.height]);

  useEffect(() => {
    if (savedCurveViewActive && dataPoints.some((point) => point.imported)) {
      setShowFixPoints(true);
    }
  }, [savedCurveViewActive, dataPoints]);

  // After resize finishes, recalculate graph values when plot reference is not locked yet.
  useEffect(() => {
    if (prevIsResizingRef.current === true && isResizing === false) {
      if (plotReferenceLockedRef.current) {
        prevIsResizingRef.current = isResizing;
        return;
      }

      const box = normalizeArea(getMappingArea?.() || graphAreaRef.current);
      const pts = dataPointsRef.current;
      const cfg = graphConfigRef.current;

      const kept = pts.filter(
        (p) => p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY) ||
          (p.canvasX >= box.x && p.canvasX <= box.x + box.width &&
           p.canvasY >= box.y && p.canvasY <= box.y + box.height)
      );
      const removedCount = pts.length - kept.length;

      const updated = kept.map((p) => {
        if (p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY)) return p;
        const { x, y } = canvasToGraphWithBounds(p.canvasX, p.canvasY, box, cfg);
        return { ...p, x, y };
      });

      replaceDataPoints(updated);

      if (removedCount > 0) {
        const msg = `${removedCount} point${removedCount > 1 ? 's' : ''} removed — outside the resized box`;
        setRemovedPointsMsg(msg);
        if (removedMsgTimeoutRef.current) clearTimeout(removedMsgTimeoutRef.current);
        removedMsgTimeoutRef.current = setTimeout(() => setRemovedPointsMsg(''), 4000);
      }
    }
    prevIsResizingRef.current = isResizing;
  }, [isResizing, getMappingArea, replaceDataPoints]);

  // When axis config changes (min/max/scale), recalculate point graph values from original
  // canvas positions so dots stay on the curve regardless of axis range changes.
  // Uses only refs — no stale closure issues.
  useEffect(() => {
    if (isAxisMappingConfirmed || isEditingCurve) return;
    const pts = dataPointsRef.current;
    if (pts.length === 0) return;
    const box = normalizeArea(getMappingArea?.() || graphAreaRef.current);
    if (box.width === 0 || box.height === 0) return;
    const cfg = graphConfigRef.current;

    const updated = pts.map((p) => {
      if (p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY)) return p;
      const { x, y } = canvasToGraphWithBounds(p.canvasX, p.canvasY, box, cfg);
      return { ...p, x, y };
    });
    replaceDataPoints(updated);
  }, [graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphConfig.xScale, graphConfig.yScale, isAxisMappingConfirmed, isEditingCurve, getMappingArea, replaceDataPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (coordinateUpdateTimeoutRef.current) {
      clearTimeout(coordinateUpdateTimeoutRef.current);
    }
    if (warningHoldTimeoutRef.current) {
      clearTimeout(warningHoldTimeoutRef.current);
    }
  }, []);

  const drawSelection = (ctx) => {
    const area = normalizeArea(graphArea);
    if (area.width > 0 && area.height > 0) {
      // Set opacity based on boxTransparent state
      ctx.globalAlpha = boxTransparent ? 0.3 : 0.6;
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 4;
      ctx.strokeRect(area.x, area.y, area.width, area.height);
      const tickGuide = getAxisTickGuideContext();
      if (tickGuide) drawLastLabeledTickGuides(ctx, area, tickGuide.fraction);
      ctx.globalAlpha = 1; // Reset for handles
      
      // Draw resize handles
      const handleSize = 8;
      const handles = [
        { x: area.x, y: area.y, key: 'top-left' },
        { x: area.x + area.width, y: area.y, key: 'top-right' },
        { x: area.x, y: area.y + area.height, key: 'bottom-left' },
        { x: area.x + area.width, y: area.y + area.height, key: 'bottom-right' },
        { x: area.x + area.width / 2, y: area.y, key: 'top' },
        { x: area.x + area.width / 2, y: area.y + area.height, key: 'bottom' },
        { x: area.x, y: area.y + area.height / 2, key: 'left' },
        { x: area.x + area.width, y: area.y + area.height / 2, key: 'right' },
      ];
      
      handles.forEach(handle => {
        const isHovered = hoveredHandle === handle.key;
        const isActive = resizeMode === handle.key;
        const currentSize = (isHovered || isActive) ? handleSize + 2 : handleSize;
        
        // Always show handles, make them more visible by default
        ctx.globalAlpha = 1;
        
        if (isHovered || isActive) {
          // Hovered/Active state: Transparent circle with border and glow
          ctx.strokeStyle = '#666666'; // Gray border
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = 'rgba(255,255,255,0)'; // Fully transparent fill
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, currentSize, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.shadowColor = '#666666';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, currentSize, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        } else {
          // Normal state: Transparent circle with thin border
          ctx.strokeStyle = '#666666'; // Gray border
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = 'rgba(255,255,255,0)'; // Fully transparent fill
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, currentSize, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        
        ctx.globalAlpha = 1; // Reset opacity
      });
    }
  };

  const drawCurveOverlayLayers = (ctx) => {
    if (showFixPoints) drawFixPoints(ctx);
    drawDataPoints(ctx);
    drawSavedViewCrosshair(ctx);
  };

  const drawSavedViewCrosshair = (ctx) => {
    if (!isSavedViewCrosscheckActive()) return;
    if (previewMousePos.x === null || previewMousePos.y === null) return;
    const area = normalizeArea(getMappingArea());
    if (area.width <= 0 || area.height <= 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(previewMousePos.x, area.y);
    ctx.lineTo(previewMousePos.x, area.y + area.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(area.x, previewMousePos.y);
    ctx.lineTo(area.x + area.width, previewMousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  const drawDataPoints = (ctx) => {
    if (dataPoints.length === 0) return;

    const hasImportedPoints = dataPoints.some((point) => point.imported);
    if (hasImportedPoints && !canShowImportedCurveOverlay()) return;

    const inSavedView = savedCurveViewActive && canShowImportedCurveOverlay();
    const showCaptureZoneColors =
      isAxisMappingConfirmed &&
      isPlotReferenceLocked &&
      !inSavedView &&
      !isEditingCurve;
    let manualPointLabel = 0;

    dataPoints.forEach((point, index) => {
      // Use graph value -> canvas position so dots update when box is resized
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const { canvasX: drawX, canvasY: drawY } = convertGraphToCanvasCoordinates(point.x, point.y);
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) return;
      
      const isAnnotation = point.isAnnotation === true;
      const isActiveEditPoint = isEditingCurve && editDragPointIndex === index;
      const pointRadius = isActiveEditPoint ? 3 : 2;
      const strokeWidth = isActiveEditPoint ? 1.5 : 1;

      // Different colors for different point types:
      // - Red for imported points
      // - Yellow/Orange for annotations (user-captured points)
      const fillColor = isActiveEditPoint
        ? '#FFD700'
        : (isAnnotation
          ? '#FFD700'
          : (showCaptureZoneColors && isManualCapturePoint(point)
            ? (isCanvasPointInsideGraphArea(drawX, drawY, CAPTURE_EDGE_TOLERANCE_PX)
              ? CAPTURE_ZONE_INSIDE_COLOR
              : CAPTURE_ZONE_OUTSIDE_COLOR)
            : (point.overlayColor || 'red')));
      
      ctx.strokeStyle = isActiveEditPoint ? '#1976d2' : '#ffffff';
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointRadius, 0, 2 * Math.PI);
      ctx.stroke();
      
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointRadius, 0, 2 * Math.PI);
      ctx.fill();

      if (isManualCapturePoint(point) && !inSavedView) {
        manualPointLabel += 1;
        const label = String(manualPointLabel);
        const labelX = drawX + 8;
        const labelY = drawY - 8;
        ctx.font = 'bold 10px sans-serif';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(label, labelX, labelY);
        ctx.fillText(label, labelX, labelY);
      }
    });
  };

  // Draw lines connecting all captured points
  const drawFixPoints = (ctx) => {
    const hasImportedPoints = dataPoints.some((point) => point.imported);
    if (hasImportedPoints && !canShowImportedCurveOverlay()) return;

    // Only draw if there are at least 2 valid points with graph values
    const validPoints = dataPoints
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => {
        const { canvasX, canvasY } = convertGraphToCanvasCoordinates(p.x, p.y);
        return { ...p, canvasX, canvasY };
      })
      .filter(p => Number.isFinite(p.canvasX) && Number.isFinite(p.canvasY));
    if (validPoints.length < 2) return;

    const curveGroups = new Map();
    validPoints.forEach((point, index) => {
      const groupKey = point.overlayCurveId ?? '__single__';
      if (!curveGroups.has(groupKey)) {
        curveGroups.set(groupKey, []);
      }
      curveGroups.get(groupKey).push({ point, index });
    });

    const inSavedView = savedCurveViewActive && canShowImportedCurveOverlay();

    ctx.save();
    curveGroups.forEach((entries) => {
      const orderedPoints = connectSortByX
        ? [...entries].sort((a, b) => {
          if (a.point.canvasX !== b.point.canvasX) return a.point.canvasX - b.point.canvasX;
          return a.index - b.index;
        }).map((entry) => entry.point)
        : entries.map((entry) => entry.point);

      if (orderedPoints.length < 2) return;

      ctx.strokeStyle = orderedPoints[0].overlayColor || '#1976d2';
      ctx.lineWidth = inSavedView ? 2.5 : 4;
      // Transparent when dragging, translucent when idle in edit mode, normal otherwise
      const isActiveDrag = isEditingCurve && editDragPointIndex !== null;
      ctx.globalAlpha = isActiveDrag ? 0.1 : (isEditingCurve ? 0.35 : (inSavedView ? 0.85 : 1));
      ctx.beginPath();
      ctx.moveTo(orderedPoints[0].canvasX, orderedPoints[0].canvasY);
      for (let i = 1; i < orderedPoints.length; i++) {
        ctx.lineTo(orderedPoints[i].canvasX, orderedPoints[i].canvasY);
      }
      ctx.stroke();
    });

    // Draw dashed preview line from last manual-capture point to current mouse position
    const manualCapturePoints = validPoints.filter(isManualCapturePoint);
    if (
      !isEditingCurve &&
      !savedCurveViewActive &&
      manualCapturePoints.length > 0 &&
      previewMousePos.x !== null &&
      previewMousePos.y !== null
    ) {
      const lastPoint = manualCapturePoints[manualCapturePoints.length - 1];
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(lastPoint.canvasX, lastPoint.canvasY);
      ctx.lineTo(previewMousePos.x, previewMousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };

  const getCanvasCoordinatesFromEvent = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      canvasX: (e.clientX - rect.left) * scaleX,
      canvasY: (e.clientY - rect.top) * scaleY,
    };
  };

  const isCanvasPointInsideArea = (area, canvasX, canvasY, edgeTolerancePx = 0) => {
    if (!area || area.width === 0 || area.height === 0) return false;
    const normalized = normalizeArea(area);
    const tol = Math.max(0, edgeTolerancePx);
    return (
      canvasX >= normalized.x - tol &&
      canvasX <= normalized.x + normalized.width + tol &&
      canvasY >= normalized.y - tol &&
      canvasY <= normalized.y + normalized.height + tol
    );
  };

  const isCanvasPointInsideGraphArea = (canvasX, canvasY, edgeTolerancePx = 0) =>
    isCanvasPointInsideArea(graphArea, canvasX, canvasY, edgeTolerancePx);

  const isCanvasPointInsidePlotReference = (canvasX, canvasY, edgeTolerancePx = 0) => {
    const mappingArea = getMappingArea();
    return isCanvasPointInsideArea(mappingArea, canvasX, canvasY, edgeTolerancePx);
  };

  const isGraphCoordCaptureValid = (graphX, graphY) => {
    if (!Number.isFinite(graphX) || !Number.isFinite(graphY)) return false;
    if (graphConfig.xScale === 'Logarithmic' && graphX <= 0) return false;
    if (graphConfig.yScale === 'Logarithmic' && graphY <= 0) return false;
    return isGraphValueWithinAxisBounds(graphX, graphY);
  };

  const clampGraphCoordsToAxisBounds = (graphX, graphY) => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    return {
      x: Number.isFinite(xMin) && Number.isFinite(xMax) ? Math.min(xMax, Math.max(xMin, graphX)) : graphX,
      y: Number.isFinite(yMin) && Number.isFinite(yMax) ? Math.min(yMax, Math.max(yMin, graphY)) : graphY,
    };
  };

  const hasConfiguredAxisBounds = () => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    return (
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax) &&
      xMax > xMin &&
      yMax > yMin
    );
  };

  const getAxisBoundTolerance = (min, max) => {
    const span = Math.abs(max - min);
    if (!Number.isFinite(span) || span <= 0) return 1e-6;
    return Math.max(1e-6, span * 1e-6);
  };

  const isGraphValueWithinAxisBounds = (graphX, graphY) => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    const xTol = getAxisBoundTolerance(xMin, xMax);
    const yTol = getAxisBoundTolerance(yMin, yMax);

    if (Number.isFinite(xMin) && graphX < xMin - xTol) return false;
    if (Number.isFinite(xMax) && graphX > xMax + xTol) return false;
    if (Number.isFinite(yMin) && graphY < yMin - yTol) return false;
    if (Number.isFinite(yMax) && graphY > yMax + yTol) return false;
    return true;
  };

  const tryAddCapturedPoint = (canvasX, canvasY, { requireAxisConfirmed = true, applyDoubleClickGuard = true } = {}) => {
    const mappingArea = getMappingArea();
    if (mappingArea.width === 0 || mappingArea.height === 0) {
      setShowRedrawMsg(true);
      return false;
    }

    const captureX = canvasX;
    const captureY = canvasY;

    if (!isCanvasPointInsidePlotReference(captureX, captureY, CAPTURE_EDGE_TOLERANCE_PX)) {
      return false;
    }

    const { x: graphX, y: graphY } = convertCanvasToGraphCoordinates(captureX, captureY);
    if (!isGraphCoordCaptureValid(graphX, graphY)) {
      return false;
    }

    if (requireAxisConfirmed && !isAxisMappingConfirmed) {
      alert('⚠️ Please confirm the axis mapping first before capturing data points.');
      return false;
    }

    if (applyDoubleClickGuard) {
      const now = Date.now();
      const last = lastCaptureClickRef.current;
      const hasLastPoint = Number.isFinite(last.x) && Number.isFinite(last.y);
      if (hasLastPoint) {
        const dx = captureX - last.x;
        const dy = captureY - last.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const deltaMs = now - Number(last.ts || 0);
        if (distance <= DOUBLE_CLICK_GUARD_PX && deltaMs <= DOUBLE_CLICK_GUARD_MS) {
          console.warn('[CAPTURE_GUARD] Ignored near-identical rapid click:', { distance, deltaMs });
          return false;
        }
      }
      lastCaptureClickRef.current = { x: captureX, y: captureY, ts: now };
    }

    addDataPoint({
      canvasX: captureX,
      canvasY: captureY,
      ...(editingCurveOverlayId ? { overlayCurveId: editingCurveOverlayId } : {}),
    });
    setBoxTransparent(true);
    return true;
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;

    if (isReadOnly && !isEditingCurve) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Account for canvas scaling (CSS size vs actual resolution)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Reset drag distance for new interaction
    setDragDistance(0);

    if (isEditingCurve && !isReadOnly) {
      const hitIndex = findPointIndexAtCanvasPosition(x, y);
      if (hitIndex >= 0) {
        editDragMovedRef.current = false;
        editDragPointIndexRef.current = hitIndex;
        setEditDragPointIndex(hitIndex);
        return;
      }
    }

    const area = normalizeArea(graphArea);
    const handleRadius = 12; // Same as in handleMouseMoveOnCanvas
    
    // Define all handle positions (same as in handleMouseMoveOnCanvas)
    const handles = [
      { x: area.x, y: area.y, key: 'top-left' },
      { x: area.x + area.width, y: area.y, key: 'top-right' },
      { x: area.x, y: area.y + area.height, key: 'bottom-left' },
      { x: area.x + area.width, y: area.y + area.height, key: 'bottom-right' },
      { x: area.x + area.width / 2, y: area.y, key: 'top' },
      { x: area.x + area.width / 2, y: area.y + area.height, key: 'bottom' },
      { x: area.x, y: area.y + area.height / 2, key: 'left' },
      { x: area.x + area.width, y: area.y + area.height / 2, key: 'right' },
    ];
    
    // Check if clicking on any handle using distance-based detection
    let mode = null;
    for (const handle of handles) {
      const dx = x - handle.x;
      const dy = y - handle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= handleRadius) {
        mode = handle.key;
        break;
      }
    }

    if (mode) {
      if (!canAdjustCaptureBox()) {
        return;
      }
      // Store that a handle was clicked, but don't resize yet
      potentialResizeHandleRef.current = mode;
      clickedOnHandleRef.current = true;
      setInitialArea(area);
      setInitialMouse({ x, y });
      return;
    }

    if (graphArea.width > 0 && graphArea.height > 0) {
      // Let click place a point instead of starting a box drag.
      return;
    }

    setIsSelecting(true);
    setStartPos({ x, y });
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (isEditingCurve && editDragPointIndexRef.current !== null) {
      editDragMovedRef.current = true;
      updatePointFromCanvasPosition(editDragPointIndexRef.current, x, y);
      return;
    }

    // Check if we need to activate resize mode based on potential handle
    if (!resizeMode && potentialResizeHandleRef.current && initialArea && canAdjustCaptureBox()) {
      const dx = x - initialMouse.x;
      const dy = y - initialMouse.y;
      const moveDistance = Math.sqrt(dx * dx + dy * dy);
      
      // Only activate resize if mouse moved enough
      if (moveDistance > RESIZE_ACTIVATION_THRESHOLD) {
        setResizeMode(potentialResizeHandleRef.current);
        setIsResizing(true);
        setBoxTransparent(false);
        // Clear the handle click flag since this is now a drag/resize, not a quick click
        clickedOnHandleRef.current = false;
      }
    }

    if (resizeMode && initialArea && canAdjustCaptureBox()) {
      const dx = x - initialMouse.x;
      const dy = y - initialMouse.y;
      const minSize = 20;
      const canvasW = canvas.width;
      const canvasH = canvas.height;

      let { x: nx, y: ny, width: nw, height: nh } = initialArea;

      if (resizeMode.includes('left')) {
        nx = initialArea.x + dx;
        nw = initialArea.width - dx;
      }
      if (resizeMode.includes('right')) {
        nw = initialArea.width + dx;
      }
      if (resizeMode.includes('top')) {
        ny = initialArea.y + dy;
        nh = initialArea.height - dy;
      }
      if (resizeMode.includes('bottom')) {
        nh = initialArea.height + dy;
      }

      // Apply constraints
      if (nw < minSize) nw = minSize;
      if (nh < minSize) nh = minSize;
      const constrained = constrainAreaToMargin(
        { x: nx, y: ny, width: nw, height: nh },
        canvasW,
        canvasH
      );

      setCaptureGraphArea(constrained);
      return;
    }

    // Draw new box
    if (!isSelecting) return;
    
    // Calculate distance moved
    const distX = x - startPos.x;
    const distY = y - startPos.y;
    const distance = Math.sqrt(distX * distX + distY * distY);
    setDragDistance(distance);
    
    // Only start drawing box after DRAG_THRESHOLD to prevent accidental redraw
    if (distance > DRAG_THRESHOLD && !isDrawingBox) {
      setIsDrawingBox(true);
    }
    
    // Only update graphArea if actively drawing a box
    if (isDrawingBox) {
      const width = x - startPos.x;
      const height = y - startPos.y;
      const normalized = normalizeArea({
        x: startPos.x,
        y: startPos.y,
        width,
        height,
      });
      const constrained = constrainAreaToMargin(normalized, canvas.width, canvas.height);
      setCaptureGraphArea(constrained);
    }
  };

  const handleMouseUp = () => {
    // If a handle was clicked but not dragged far enough, allow point capture
    if (potentialResizeHandleRef.current && !resizeMode) {
      potentialResizeHandleRef.current = null;
      // Don't prevent point capture if user just clicked on a handle
    } else if (isResizing) {
      justFinishedResizingRef.current = true;
      lastUserBoxRef.current = { ...graphArea };
      setBoxTransparent(true);
      onGraphAreaManuallyAdjusted?.();
      setTimeout(() => {
        justFinishedResizingRef.current = false;
      }, 100);
    } else if (isDrawingBox) {
      const finalizedArea = normalizeArea(graphAreaRef.current);
      if (finalizedArea.width > 0 && finalizedArea.height > 0) {
        setGraphArea(finalizedArea);
        lastUserBoxRef.current = finalizedArea;
      } else {
        lastUserBoxRef.current = { ...graphArea };
      }
      setBoxTransparent(true);
      onGraphAreaManuallyAdjusted?.();
    }
    
    if (editDragPointIndexRef.current !== null) {
      editDragPointIndexRef.current = null;
      setEditDragPointIndex(null);
    }

    // Always clean up on mouse up
    potentialResizeHandleRef.current = null;
    setIsSelecting(false);
    setIsDrawingBox(false);
    setResizeMode(null);
    setInitialArea(null);
    setIsResizing(false);
    setDragDistance(0);
  };

  const handleCanvasClick = (e) => {
    if (isReadOnly) {
      return;
    }

    const { canvasX, canvasY } = getCanvasCoordinatesFromEvent(e);

    if (isEditingCurve) {
      if (editDragMovedRef.current) {
        editDragMovedRef.current = false;
        return;
      }
      if (findPointIndexAtCanvasPosition(canvasX, canvasY) >= 0) {
        return;
      }
      tryAddCapturedPoint(canvasX, canvasY, {
        requireAxisConfirmed: false,
        applyDoubleClickGuard: false,
      });
      return;
    }

    // Track if this click came from a handle
    const isHandleClick = clickedOnHandleRef.current;
    clickedOnHandleRef.current = false;

    // Skip point capture after resize/box draw (even when the interaction started on a handle).
    if (justFinishedResizingRef.current || isResizing) {
      setDragDistance(0);
      justFinishedResizingRef.current = false;
      return;
    }

    if (isSelecting && dragDistance > DRAG_THRESHOLD) {
      setDragDistance(0);
      return;
    }

    if (isHandleClick) {
      tryAddCapturedPoint(canvasX, canvasY);
      setDragDistance(0);
      return;
    }

    tryAddCapturedPoint(canvasX, canvasY);
  };

  const handleClearPoints = () => {
    clearDataPoints();
  };

  const handleCanvasContextMenu = (e) => {
    e.preventDefault(); // Prevent browser context menu

    if (isReadOnly) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    if (isEditingCurve) {
      const hitIndex = findPointIndexAtCanvasPosition(canvasX, canvasY);
      if (hitIndex >= 0) {
        editDragPointIndexRef.current = null;
        editDragMovedRef.current = false;
        setEditDragPointIndex(null);
        deleteDataPoint(hitIndex);
      }
      return;
    }

    // Check if right-click is on any data point (manual points only)
    const clickRadius = 8; // Detection radius for point click

    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];

      // Skip imported points - can't delete them by right-click
      if (point.imported) continue;
      
      // Use live draw position (same as what drawDataPoints uses) for hit test
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const { canvasX: drawX, canvasY: drawY } = convertGraphToCanvasCoordinates(point.x, point.y);
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) continue;

      const dx = canvasX - drawX;
      const dy = canvasY - drawY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= clickRadius) {
        // Found a point - delete it
        deleteDataPoint(i);
        return;
      }
    }
  };

  const handleMouseMoveOnCanvas = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Account for canvas scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    
    // Preview crosshair follows the cursor anywhere on the canvas while capturing.
    setPreviewMousePos({ x: canvasX, y: canvasY });
    
    // Check if mouse is directly over any resize handle
    const area = normalizeArea(graphArea);
    if (area.width > 0 && area.height > 0) {
      const handleRadius = 12; // Detection radius for hover
      
      // Define all handle positions
      const handles = [
        { x: area.x, y: area.y, key: 'top-left' },
        { x: area.x + area.width, y: area.y, key: 'top-right' },
        { x: area.x, y: area.y + area.height, key: 'bottom-left' },
        { x: area.x + area.width, y: area.y + area.height, key: 'bottom-right' },
        { x: area.x + area.width / 2, y: area.y, key: 'top' },
        { x: area.x + area.width / 2, y: area.y + area.height, key: 'bottom' },
        { x: area.x, y: area.y + area.height / 2, key: 'left' },
        { x: area.x + area.width, y: area.y + area.height / 2, key: 'right' },
      ];
      
      // Find which handle the mouse is over (distance-based)
      let hovered = null;
      for (const handle of handles) {
        const dx = canvasX - handle.x;
        const dy = canvasY - handle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= handleRadius) {
          hovered = handle.key;
          break; // Only one handle can be hovered at a time
        }
      }
      
      setHoveredHandle(hovered);

      if (isEditingCurve) {
        if (editDragPointIndexRef.current !== null) {
          canvas.style.cursor = 'grabbing';
        } else {
          const hitIndex = findPointIndexAtCanvasPosition(canvasX, canvasY);
          canvas.style.cursor = hitIndex >= 0 ? 'grab' : 'default';
        }
      } else if (hovered) {
        canvas.style.cursor = 'default';
      } else {
        canvas.style.cursor = 'default';
      }
    }
    
    // Show coordinates from plot reference mapping when available.
    const mappingArea = normalizeArea(getMappingArea());
    if (mappingArea.width <= 0 || mappingArea.height <= 0) {
      if (!uploadedImage || imageSize.width <= 0) {
        return;
      }
    }

    const hoverCoords = convertCanvasToGraphCoordinates(canvasX, canvasY);
    const graphX = hoverCoords.x;
    const graphY = hoverCoords.y;

    let xMin = parseFloat(graphConfig.xMin);
    let xMax = parseFloat(graphConfig.xMax);
    let yMin = parseFloat(graphConfig.yMin);
    let yMax = parseFloat(graphConfig.yMax);
    if (Number.isNaN(xMin)) xMin = graphConfig.xScale === 'Logarithmic' ? 1 : 0;
    if (Number.isNaN(xMax)) xMax = 100;
    if (Number.isNaN(yMin)) yMin = graphConfig.yScale === 'Logarithmic' ? 1 : 0;
    if (Number.isNaN(yMax)) yMax = 100;
    
    // Throttle coordinate updates to reduce flickering
    if (coordinateUpdateTimeoutRef.current) {
      clearTimeout(coordinateUpdateTimeoutRef.current);
    }
    
    coordinateUpdateTimeoutRef.current = setTimeout(() => {
      setMousePos({ x: graphX, y: graphY });
      setShowCoords(true);
    }, 16); // ~60fps

    // Detect if values are stuck (any constant value, positive or negative) while cursor moves
    const prevCanvas = prevCanvasPosRef.current;
    const prevGraph = prevGraphPosRef.current;
    const areaForWarn = normalizeArea(getMappingArea());
    let nextStuckWarn = false;
    if (prevCanvas && prevGraph) {
      const canvasDelta = Math.hypot(canvasX - prevCanvas.x, canvasY - prevCanvas.y);
      const graphDeltaX = Math.abs(graphX - prevGraph.x);
      const graphDeltaY = Math.abs(graphY - prevGraph.y);
      const graphDelta = Math.max(graphDeltaX, graphDeltaY);
      const spanX = Math.abs(xMax - xMin);
      const spanY = Math.abs(yMax - yMin);
      const spanMax = Math.max(spanX, spanY, 1);
      const movedEnough = canvasDelta > 20; // pixels
      const graphBarelyChanges = (graphDelta / spanMax) < 0.002; // 0.2% of axis span
      nextStuckWarn = movedEnough && graphBarelyChanges && areaForWarn.width > 0 && areaForWarn.height > 0;
    }

    // Debounce stuck warning across frames to avoid blips
    if (!prevGraphPosRef.current || !prevCanvasPosRef.current) {
      prevCanvasPosRef.current = { x: canvasX, y: canvasY };
      prevGraphPosRef.current = { x: graphX, y: graphY };
    }

    prevCanvasPosRef.current = { x: canvasX, y: canvasY };
    prevGraphPosRef.current = { x: graphX, y: graphY };

    if (nextStuckWarn) {
      stuckFramesRef.current = (stuckFramesRef.current || 0) + 1;
    } else {
      stuckFramesRef.current = 0;
    }

    const showStuck = stuckFramesRef.current >= 2;

    if (!isSavedViewCrosscheckActive()) {
      // Zero detection: only warn if truly stuck at zero, not near-zero on log scales
      // Require strictly inside box (further from edges)
      const strictInsideX = canvasX > areaForWarn.x + EDGE_GAP * 2 && canvasX < areaForWarn.x + areaForWarn.width - EDGE_GAP * 2;
      const strictInsideY = canvasY > areaForWarn.y + EDGE_GAP * 2 && canvasY < areaForWarn.y + areaForWarn.height - EDGE_GAP * 2;
      const nextZeroWarn = areaForWarn.width > 0 && areaForWarn.height > 0 && (
        (strictInsideX && Math.abs(graphX) < EPS * 10) ||
        (strictInsideY && Math.abs(graphY) < EPS * 10)
      );

      // Apply a brief hold when clearing to prevent flicker on edge jitters
      // Suppress stuck warning if zero warning is already showing
      if (warningHoldTimeoutRef.current) {
        clearTimeout(warningHoldTimeoutRef.current);
      }
      if (nextZeroWarn || (showStuck && !nextZeroWarn)) {
        setZeroWarnActive(nextZeroWarn);
        setStuckWarnActive(showStuck && !nextZeroWarn);
      } else {
        warningHoldTimeoutRef.current = setTimeout(() => {
          setZeroWarnActive(false);
          setStuckWarnActive(false);
        }, WARN_CLEAR_DELAY);
      }
    }

    // Update magnifier
    setShowMagnifier(true);
    drawMagnifier(canvasX, canvasY);
  };

  const handleMouseLeaveCanvas = () => {
    if (coordinateUpdateTimeoutRef.current) {
      clearTimeout(coordinateUpdateTimeoutRef.current);
    }
    if (warningHoldTimeoutRef.current) {
      clearTimeout(warningHoldTimeoutRef.current);
    }
    setShowCoords(false);
    setShowMagnifier(false);
    setZeroWarnActive(false);
    setStuckWarnActive(false);
    setPreviewMousePos({ x: null, y: null }); // Hide preview line when mouse leaves
    
    // Clean up potential resize handle and flag
    potentialResizeHandleRef.current = null;
    clickedOnHandleRef.current = false;
    
    // Cancel any active resize operation when mouse leaves canvas
    if (isResizing) {
      setResizeMode(null);
      setInitialArea(null);
      setIsResizing(false);
      setBoxTransparent(true);
    }
    
    // Cancel any active box drawing operation
    if (isDrawingBox) {
      setIsDrawingBox(false);
      setIsSelecting(false);
    }
  };

  const drawMagnifier = (canvasX, canvasY) => {
    const magnifier = magnifierRef.current;
    if (!magnifier || !canvasRef.current) return;
    
    const mainCanvas = canvasRef.current;
    const ctx = magnifier.getContext('2d');
    const magnifierSize = 250; // Size of magnifier canvas
    const zoomLevel = 3; // 3x zoom
    const sourceSize = magnifierSize / zoomLevel; // Area to copy from main canvas
    
    // Set magnifier canvas size
    magnifier.width = magnifierSize;
    magnifier.height = magnifierSize;
    
    // Calculate source rectangle (area to magnify from main canvas)
    const sourceX = Math.max(0, canvasX - sourceSize / 2);
    const sourceY = Math.max(0, canvasY - sourceSize / 2);
    const actualSourceWidth = Math.min(sourceSize, mainCanvas.width - sourceX);
    const actualSourceHeight = Math.min(sourceSize, mainCanvas.height - sourceY);
    
    // Clear magnifier
    ctx.clearRect(0, 0, magnifierSize, magnifierSize);
    
    // Draw zoomed section
    ctx.drawImage(
      mainCanvas,
      sourceX, sourceY, actualSourceWidth, actualSourceHeight,
      0, 0, magnifierSize, magnifierSize
    );
    
    // Draw crosshair at center
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(magnifierSize / 2 - 10, magnifierSize / 2);
    ctx.lineTo(magnifierSize / 2 + 10, magnifierSize / 2);
    ctx.moveTo(magnifierSize / 2, magnifierSize / 2 - 10);
    ctx.lineTo(magnifierSize / 2, magnifierSize / 2 + 10);
    ctx.stroke();
    
    // Draw border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, magnifierSize, magnifierSize);
  };

  if (!uploadedImage) {
    return (
      <div className="graph-canvas-placeholder">
        <p>Upload an image to start capturing graph data</p>
      </div>
    );
  }

  const axisTickGuideContext = getAxisTickGuideContext();
  const manualCapturePoints = getManualCapturePoints(dataPoints);
  const savedViewCrosscheckActive = isSavedViewCrosscheckActive();
  const showCapturePointStatus =
    !isReadOnly &&
    !isEditingCurve &&
    !savedCurveViewActive &&
    isAxisMappingConfirmed;
  const captureHudVisible = showCapturePointStatus || showCoords || savedViewCrosscheckActive;
  const xAxisHoverLabel = formatAxisHoverLabel('X', graphConfig.xLabel);
  const yAxisHoverLabel = formatAxisHoverLabel('Y', graphConfig.yLabel);

  return (
    <div className="w-full p-5 bg-white rounded-lg mt-5">
      <div className="bg-blue-50 p-4 rounded mb-4">
        <p className="text-blue-700 font-medium mb-2"><strong>Instructions:</strong></p>
        <ul className="list-disc pl-5 text-gray-700">
          <li>Drag to select the graph area (blue box). Before confirming, align it to the full printed axis range.</li>
          <li>After confirm, you can resize the blue box as a capture zone; coordinates still use the full axis.</li>
          <li>In Graph Configuration, set axis min/max, scale, and unit, then confirm axis mapping</li>
          <li>Click on the plot to add data points (orange = outside capture zone, red = inside)</li>
          <li>Right-click on a captured point to remove it</li>
          <li>Use the buttons below to adjust the box or clear points; hover to see the magnifier</li>
        </ul>
      </div>
      

      {(partNumber || manufacturer) ? (
        <div className="mb-4 p-3 bg-gray-100 rounded font-semibold text-gray-800 max-w-xs">
          Part Number: {partNumber && manufacturer ? `${partNumber}(${manufacturer})` : partNumber || ''}
        </div>
      ) : null}
      <div className="border border-gray-200 rounded mb-4 overflow-auto">
        <div
          className="sticky top-0 z-10 px-3 py-2 bg-gray-900 bg-opacity-90 text-white border-b border-green-500 font-mono text-sm font-bold"
          style={{ visibility: captureHudVisible ? 'visible' : 'hidden', opacity: showCapturePointStatus || showCoords || savedViewCrosscheckActive ? 1 : 0.35 }}
        >
          {showCapturePointStatus ? (
            <div className="text-yellow-300 text-xs font-semibold mb-1">
              {manualCapturePoints.length > 0
                ? `Captured: ${manualCapturePoints.length} point${manualCapturePoints.length === 1 ? '' : 's'} · Next: #${manualCapturePoints.length + 1}`
                : 'Next point: #1'}
            </div>
          ) : null}
          {savedViewCrosscheckActive ? (
            <div className="text-green-300 text-xs font-semibold mb-1">
              {showCoords
                ? 'Cross-check · hover coordinates'
                : 'Hover over the graph to cross-check coordinates'}
            </div>
          ) : null}
          {savedViewCrosscheckActive ? (
            showCoords ? (
              <>
                <div>{xAxisHoverLabel}={formatCoord(mousePos.x)}</div>
                <div>{yAxisHoverLabel}={formatCoord(mousePos.y)}</div>
              </>
            ) : (
              <div className="text-gray-300 text-xs">Move cursor over the graph image below</div>
            )
          ) : (
            <div>x={formatCoord(mousePos.x)} y={formatCoord(mousePos.y)}</div>
          )}
        </div>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={(e) => {
            handleMouseMove(e);
            handleMouseMoveOnCanvas(e);
          }}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeaveCanvas}
          onClick={handleCanvasClick}
          onContextMenu={handleCanvasContextMenu}
          className="w-full block cursor-default max-w-full"
        />
      </div>
      {imageLoadFailed && (
        <div className="mb-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The graph image could not be loaded from the server. Re-upload the screenshot, or open this graph after it was saved once in this tool (stored copy).
        </div>
      )}
      <div className="flex items-center gap-4 mt-4 mb-6">
        <div className="relative">
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white font-medium"
            onClick={() => setShowFixPoints((prev) => !prev)}
          >
            {showFixPoints ? 'Hide points' : 'Connect points'}
          </button>
          {showFixPoints && (
            <div className="absolute left-0 top-full mt-3 z-10 min-w-max">
              <div className="inline-flex rounded border border-blue-400 overflow-hidden text-xs font-semibold">
                <button
                  type="button"
                  className={`px-2 py-1 ${connectSortByX ? 'bg-slate-600 text-white' : 'bg-blue-700 text-yellow-300'}`}
                  onClick={() => setConnectSortByX(false)}
                >
                  Capture Order
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 border-l border-blue-400 ${connectSortByX ? 'bg-blue-700 text-yellow-300' : 'bg-slate-600 text-white'}`}
                  onClick={() => setConnectSortByX(true)}
                >
                  X-Sorted
                </button>
              </div>
              <div className="mt-2 text-xs font-bold text-blue-800 bg-blue-100 border border-blue-300 rounded px-2 py-1 whitespace-nowrap">
                {connectSortByX
                  ? 'Points are connected after sorting by X value (left to right).'
                  : 'Points are connected in capture time order (first click to last click).'}
              </div>
            </div>
          )}
        </div>
        <button
          className="px-4 py-2 rounded bg-gray-700 text-white font-medium"
          onClick={() => {
            if (lastUserBoxRef.current?.width > 0 && lastUserBoxRef.current?.height > 0) {
              const restored = { ...lastUserBoxRef.current };
              setCaptureGraphArea(restored);
              if (!isPlotReferenceLocked) {
                establishPlotReference(restored);
              }
            } else if (imageSize.width && imageSize.height) {
              const newBox = createInitialAxisBox(imageSize.width, imageSize.height);
              setCaptureGraphArea(newBox);
              if (!isPlotReferenceLocked) {
                establishPlotReference(newBox);
              }
              lastUserBoxRef.current = newBox;
            }
            setBoxTransparent(false);
            setShowRedrawMsg(false);
            onGraphAreaManuallyAdjusted?.();
          }}
          title="Redraw/retake the bounding box for the axis (clears only the box, not captured points)"
        >
          Redraw Axis Box
        </button>
        <button
          className="px-4 py-2 rounded bg-red-700 text-white font-medium"
          onClick={handleClearPoints}
          title="Clear all captured data points (keeps axis mapping)"
        >
          Retake Points
        </button>
        {showRedrawMsg && (
          <div className="text-red-600 font-bold mt-2">
            Please redraw the axis box
          </div>
        )}
        {showAiAlignmentGuidance() && (
          <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2 text-sm">
            <p className="font-semibold mb-1.5">AI points loaded — follow these steps:</p>
            {showScaleAndUnitCrossCheck ? (
              <div className="mb-2 flex items-start gap-2 rounded border-2 border-orange-400 bg-orange-50 px-2.5 py-2">
                <span className="text-lg font-bold leading-none text-orange-500" aria-hidden="true">
                  !
                </span>
                <p className="text-sm font-semibold text-orange-900 leading-snug m-0">
                  {SCALE_AND_UNIT_CROSS_CHECK_MESSAGE}
                </p>
              </div>
            ) : null}
            <ol className="list-decimal list-inside space-y-1 m-0 pl-0.5">
              <li>Set <strong>X/Y min and max</strong> to match the graph axis labels.</li>
              <li>
                Verify <strong>scale (Linear/Logarithmic)</strong> and <strong>unit</strong> in the configuration panel match the printed graph axes.
              </li>
              <li>
                Drag the <strong>blue box</strong> to align with the plot area
                (bottom-left near ({graphConfig.xMin}, {graphConfig.yMin}), top-right near ({graphConfig.xMax}, {graphConfig.yMax})).
                {axisTickGuideContext ? (
                  <span className="block mt-1 text-xs">
                    Orange dashed lines mark the last printed tick ({axisTickGuideContext.lastLabeled}) — place the blue corner on the outer plot border at {axisTickGuideContext.axisMax}, not on that inner grid line.
                  </span>
                ) : null}
              </li>
            </ol>
          </div>
        )}
        {savedViewCrosscheckActive && (
          <div className="text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-2 text-sm">
            Hover over the graph image to read live axis coordinates and use the magnifier (top-right) to cross-check captured points against the datasheet.
          </div>
        )}
        {showAiCaptureGuidance && hasImportedCurvePoints() && canShowImportedCurveOverlay() && isAxisMappingConfirmed && !isEditingCurve && !savedViewCrosscheckActive && (
          <div className="text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-2 text-sm">
            <p className="font-semibold mb-1.5">AI points loaded — fine-tune and save:</p>
            {showScaleAndUnitCrossCheck ? (
              <div className="mb-2 flex items-start gap-2 rounded border-2 border-orange-400 bg-orange-50 px-2.5 py-2">
                <span className="text-lg font-bold leading-none text-orange-500" aria-hidden="true">
                  !
                </span>
                <p className="text-sm font-semibold text-orange-900 leading-snug m-0">
                  {SCALE_AND_UNIT_CROSS_CHECK_MESSAGE}
                </p>
              </div>
            ) : null}
            <ol className="list-decimal list-inside space-y-1 m-0 pl-0.5">
              <li>Drag the <strong>blue box</strong> if the plot area needs alignment (AI points move with the box).
                {axisTickGuideContext ? (
                  <span className="block mt-1 text-xs">
                    If points cross the top or right edge, drag the top-right corner outward past the orange dashed lines (past the {axisTickGuideContext.lastLabeled} tick to the {axisTickGuideContext.axisMax} border).
                  </span>
                ) : null}
              </li>
              <li>In <strong>Saved Graphs</strong>, click <strong>Edit</strong> — curve name and axis mapping are already set.</li>
              <li>Drag points onto the curve if placement is off.</li>
              <li>Click <strong>Update Data</strong> to save.</li>
            </ol>
          </div>
        )}
        {removedPointsMsg && (
          <div className="text-orange-600 font-bold mt-2">
            ⚠️ {removedPointsMsg}
          </div>
        )}
      </div>
      {showMagnifier && (
        <canvas
          ref={magnifierRef}
          className={`fixed border-4 border-gray-800 rounded shadow bg-white top-12 right-5 ${savedViewCrosscheckActive ? 'z-[1100]' : 'z-50'}`}
        />
      )}
    </div>
  );
};

export default GraphCanvas;

// Helper to format coordinates for display (exponential for small, fixed for normal)
function formatCoord(val) {
  if (typeof val !== 'number' || isNaN(val)) return 'N/A';
  if (Math.abs(val) > 0 && Math.abs(val) < 0.0001) {
    return val.toExponential(3);
  }
  return val.toFixed(3);
}

function formatAxisHoverLabel(axisFallback, axisTitle) {
  const title = String(axisTitle || '').trim();
  return title ? `${axisFallback}[${title}]` : axisFallback;
}

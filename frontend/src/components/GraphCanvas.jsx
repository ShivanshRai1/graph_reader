import { useRef, useState, useEffect } from 'react';
import { useGraph } from '../context/GraphContext';

const GraphCanvas = ({ isReadOnly = false, partNumber = '', manufacturer = '', isAxisMappingConfirmed = false, hasReturnUrl = false }) => {
  const { uploadedImage, graphArea, setGraphArea, dataPoints, addDataPoint, clearDataPoints, graphConfig, deleteDataPoint, convertGraphToCanvasCoordinates, convertCanvasToGraphCoordinates, replaceDataPoints } = useGraph();
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
  const lastUserBoxRef = useRef(null); // Store last manually set box dimensions
  const potentialResizeHandleRef = useRef(null); // Track which handle was clicked
  const clickedOnHandleRef = useRef(false); // Track if this click originated on a handle

  const MARGIN = 6; // Margin from edges for resize handles visibility
  const EDGE_GAP = 12; // Hysteresis for edge checks to reduce flicker
  const EPS = 1e-6;
  const WARN_CLEAR_DELAY = 180; // ms to hold warning before clearing
  const DRAG_THRESHOLD = 50; // Threshold to distinguish between click and drag
  const RESIZE_ACTIVATION_THRESHOLD = 3; // pixels to move before activating resize
  const DOUBLE_CLICK_GUARD_MS = 140; // Only suppress very rapid repeat clicks
  const DOUBLE_CLICK_GUARD_PX = 2; // Only suppress near-identical click locations

  const normalizeArea = (area) => {
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

  useEffect(() => {
    if (uploadedImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        setImageSize({ width: img.width, height: img.height });
        imageRef.current = img; // Store image reference
        
        // Auto-draw blue selection box covering entire image only on first load (no points captured yet)
        if (graphArea.width === 0 && graphArea.height === 0 && dataPoints.length === 0) {
          const initialBox = constrainAreaToMargin(
            {
              x: 0,
              y: 0,
              width: img.width,
              height: img.height,
            },
            img.width,
            img.height
          );
          setGraphArea(initialBox);
          lastUserBoxRef.current = initialBox;
        }
        
        ctx.drawImage(img, 0, 0);
        drawSelection(ctx);
        drawDataPoints(ctx);
        if (showFixPoints) drawFixPoints(ctx);
      };
      
      img.src = uploadedImage;
    }
  }, [uploadedImage]);

  // Separate effect to redraw selection box and points without reloading image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);
    drawSelection(ctx);
    drawDataPoints(ctx);
    if (showFixPoints) drawFixPoints(ctx);
  }, [graphArea, dataPoints, showFixPoints, hoveredHandle, resizeMode, previewMousePos, connectSortByX, isAxisMappingConfirmed, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphConfig.xScale, graphConfig.yScale]);

  // Keep live refs always in sync with latest state
  const graphConfigRef = useRef(graphConfig);
  useEffect(() => { graphAreaRef.current = graphArea; }, [graphArea]);
  useEffect(() => { dataPointsRef.current = dataPoints; }, [dataPoints]);
  useEffect(() => { graphConfigRef.current = graphConfig; }, [graphConfig]);

  // Set box to transparent when points are captured (manually or imported)
  useEffect(() => {
    if (dataPoints.length > 0) {
      setBoxTransparent(true);
    }
  }, [dataPoints.length]);

  // After resize finishes, recalculate graph values from original canvas positions and remove out-of-bounds points.
  // All values are read from refs (never from stale closures) so timing with React renders is irrelevant.
  useEffect(() => {
    if (prevIsResizingRef.current === true && isResizing === false) {
      const box = normalizeArea(graphAreaRef.current);
      const pts = dataPointsRef.current;
      const cfg = graphConfigRef.current;

      // Inline canvasToGraph using only refs — no function ref timing issues
      const canvasToGraph = (cx, cy) => {
        if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
        let xMin = parseFloat(cfg.xMin); if (isNaN(xMin)) xMin = 0;
        let xMax = parseFloat(cfg.xMax); if (isNaN(xMax)) xMax = 100;
        let yMin = parseFloat(cfg.yMin); if (isNaN(yMin)) yMin = 0;
        let yMax = parseFloat(cfg.yMax); if (isNaN(yMax)) yMax = 100;
        const xRatio = (cx - box.x) / box.width;
        const yRatio = (cy - box.y) / box.height;
        let gx, gy;
        if (cfg.xScale === 'Logarithmic') {
          const safeXMin = xMin > 0 ? xMin : 1e-12;
          const safeXMax = (xMax > 0 && xMax > safeXMin) ? xMax : safeXMin * 10;
          gx = Math.pow(10, Math.log10(safeXMin) + xRatio * (Math.log10(safeXMax) - Math.log10(safeXMin)));
        } else {
          gx = xMin + xRatio * (xMax - xMin);
        }
        if (cfg.yScale === 'Logarithmic') {
          const safeYMin = yMin > 0 ? yMin : 1e-12;
          const safeYMax = (yMax > 0 && yMax > safeYMin) ? yMax : safeYMin * 10;
          const logYMin = Math.log10(safeYMin);
          const logYMax = Math.log10(safeYMax);
          gy = Math.pow(10, logYMax - yRatio * (logYMax - logYMin));
        } else {
          gy = yMax - yRatio * (yMax - yMin);
        }
        return { x: gx, y: gy };
      };

      // Filter to points whose original pixel is inside the new box
      const kept = pts.filter(
        (p) => p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY) ||
          (p.canvasX >= box.x && p.canvasX <= box.x + box.width &&
           p.canvasY >= box.y && p.canvasY <= box.y + box.height)
      );
      const removedCount = pts.length - kept.length;

      // Recalculate graph values from original canvas positions using the new box + config
      const updated = kept.map((p) => {
        if (p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY)) return p;
        const { x, y } = canvasToGraph(p.canvasX, p.canvasY);
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
  }, [isResizing]);

  // When axis config changes (min/max/scale), recalculate point graph values from original
  // canvas positions so dots stay on the curve regardless of axis range changes.
  // Uses only refs — no stale closure issues.
  useEffect(() => {
    if (isAxisMappingConfirmed) return;
    const pts = dataPointsRef.current;
    if (pts.length === 0) return;
    const box = normalizeArea(graphAreaRef.current);
    if (box.width === 0 || box.height === 0) return;
    const cfg = graphConfigRef.current;

    const canvasToGraph = (cx, cy) => {
      let xMin = parseFloat(cfg.xMin); if (isNaN(xMin)) xMin = 0;
      let xMax = parseFloat(cfg.xMax); if (isNaN(xMax)) xMax = 100;
      let yMin = parseFloat(cfg.yMin); if (isNaN(yMin)) yMin = 0;
      let yMax = parseFloat(cfg.yMax); if (isNaN(yMax)) yMax = 100;
      const xRatio = (cx - box.x) / box.width;
      const yRatio = (cy - box.y) / box.height;
      let gx, gy;
      if (cfg.xScale === 'Logarithmic') {
        const safeXMin = xMin > 0 ? xMin : 1e-12;
        const safeXMax = (xMax > 0 && xMax > safeXMin) ? xMax : safeXMin * 10;
        gx = Math.pow(10, Math.log10(safeXMin) + xRatio * (Math.log10(safeXMax) - Math.log10(safeXMin)));
      } else {
        gx = xMin + xRatio * (xMax - xMin);
      }
      if (cfg.yScale === 'Logarithmic') {
        const safeYMin = yMin > 0 ? yMin : 1e-12;
        const safeYMax = (yMax > 0 && yMax > safeYMin) ? yMax : safeYMin * 10;
        const logYMin = Math.log10(safeYMin);
        const logYMax = Math.log10(safeYMax);
        gy = Math.pow(10, logYMax - yRatio * (logYMax - logYMin));
      } else {
        gy = yMax - yRatio * (yMax - yMin);
      }
      return { x: gx, y: gy };
    };

    const updated = pts.map((p) => {
      if (p.imported || !Number.isFinite(p.canvasX) || !Number.isFinite(p.canvasY)) return p;
      const { x, y } = canvasToGraph(p.canvasX, p.canvasY);
      return { ...p, x, y };
    });
    replaceDataPoints(updated);
  }, [graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax, graphConfig.xScale, graphConfig.yScale]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const drawDataPoints = (ctx) => {
    if (dataPoints.length === 0) return;

    dataPoints.forEach((point, index) => {
      // Use graph value -> canvas position so dots update when box is resized
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const { canvasX: drawX, canvasY: drawY } = convertGraphToCanvasCoordinates(point.x, point.y);
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) return;
      
      const pointRadius = 2.5;
      
      // Different colors for different point types:
      // - Red for imported points
      // - Yellow/Orange for annotations (user-captured points)
      const isAnnotation = point.isAnnotation === true;
      const fillColor = isAnnotation ? '#FFD700' : 'red'; // Gold for annotations, red for imported
      
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointRadius, 0, 2 * Math.PI);
      ctx.stroke();
      
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointRadius, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  // Draw lines connecting all captured points
  const drawFixPoints = (ctx) => {
    // Only draw if there are at least 2 valid points with graph values
    const validPoints = dataPoints
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => {
        const { canvasX, canvasY } = convertGraphToCanvasCoordinates(p.x, p.y);
        return { ...p, canvasX, canvasY };
      })
      .filter(p => Number.isFinite(p.canvasX) && Number.isFinite(p.canvasY));
    if (validPoints.length < 2) return;

    const orderedPoints = connectSortByX
      ? validPoints
        .map((point, index) => ({ point, index }))
        .sort((a, b) => {
          if (a.point.canvasX !== b.point.canvasX) return a.point.canvasX - b.point.canvasX;
          return a.index - b.index;
        })
        .map((entry) => entry.point)
      : validPoints;

    ctx.save();
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(orderedPoints[0].canvasX, orderedPoints[0].canvasY);
    for (let i = 1; i < orderedPoints.length; i++) {
      ctx.lineTo(orderedPoints[i].canvasX, orderedPoints[i].canvasY);
    }
    ctx.stroke();

    // Draw dashed preview line from last point to current mouse position
    if (orderedPoints.length > 0 && previewMousePos.x !== null && previewMousePos.y !== null) {
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.setLineDash([5, 5]); // 5px dash, 5px gap
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(orderedPoints[orderedPoints.length - 1].canvasX, orderedPoints[orderedPoints.length - 1].canvasY);
      ctx.lineTo(previewMousePos.x, previewMousePos.y);
      ctx.stroke();
      ctx.setLineDash([]); // Clear dash pattern
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Account for canvas scaling (CSS size vs actual resolution)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Reset drag distance for new interaction
    setDragDistance(0);

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
      // Prevent resizing if configuration is locked (after Final Check)
      if (isAxisMappingConfirmed) {
        return;
      }
      // Store that a handle was clicked, but don't resize yet
      potentialResizeHandleRef.current = mode;
      clickedOnHandleRef.current = true;
      setInitialArea(area);
      setInitialMouse({ x, y });
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

    // Check if we need to activate resize mode based on potential handle
    if (!resizeMode && potentialResizeHandleRef.current && initialArea && !isAxisMappingConfirmed) {
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

    if (resizeMode && initialArea && !isAxisMappingConfirmed) {
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

      setGraphArea(constrained);
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
      setGraphArea(constrained);
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
      setTimeout(() => {
        justFinishedResizingRef.current = false;
      }, 100);
    } else if (isDrawingBox) {
      lastUserBoxRef.current = { ...graphArea };
      setBoxTransparent(true);
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
    
    // Track if this click came from a handle
    const isHandleClick = clickedOnHandleRef.current;
    clickedOnHandleRef.current = false; // Reset flag
    
    // Only skip point capture if we were actually resizing or drawing a box (but allow handle clicks)
    if (!isHandleClick && (isResizing || justFinishedResizingRef.current || (isSelecting && dragDistance > DRAG_THRESHOLD))) {
      setDragDistance(0);
      if (justFinishedResizingRef.current) {
        justFinishedResizingRef.current = false;
      }
      return;
    }
    
    // Prevent adding points if box is not drawn
    if (graphArea.width === 0 || graphArea.height === 0) {
      setShowRedrawMsg(true);
      return;
    }
    
    // Get exact canvas position relative to viewport, accounting for scaling
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    // Check if click is within or on the blue box (including border and handles)
    const area = normalizeArea(graphArea);
    const borderWidth = 4; // Account for the blue line thickness
    
    // Check if within bounds (inside or on border)
    const withinXBounds = canvasX >= area.x - borderWidth && canvasX <= area.x + area.width + borderWidth;
    const withinYBounds = canvasY >= area.y - borderWidth && canvasY <= area.y + area.height + borderWidth;
    
    if (withinXBounds && withinYBounds) {
      // Gate point capture until axis mapping is confirmed (Issue 5 & 7)
      if (!isAxisMappingConfirmed) {
        alert('⚠️ Please confirm the axis mapping first before capturing data points.');
        return;
      }

      const now = Date.now();
      const last = lastCaptureClickRef.current;
      const hasLastPoint = Number.isFinite(last.x) && Number.isFinite(last.y);
      if (hasLastPoint) {
        const dx = canvasX - last.x;
        const dy = canvasY - last.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const deltaMs = now - Number(last.ts || 0);
        if (distance <= DOUBLE_CLICK_GUARD_PX && deltaMs <= DOUBLE_CLICK_GUARD_MS) {
          console.warn('[CAPTURE_GUARD] Ignored near-identical rapid click:', { distance, deltaMs });
          return;
        }
      }

      addDataPoint({ canvasX, canvasY });
      lastCaptureClickRef.current = { x: canvasX, y: canvasY, ts: now };
      // Make box transparent after first point is captured (entering capture mode)
      setBoxTransparent(true);
    }
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
    
    // Update preview mouse position for real-time preview line
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
      
      if (hovered) {
        canvas.style.cursor = 'default';
      } else {
        canvas.style.cursor = 'default';
      }
    }
    
    // Show coordinates - use drawn box if available, otherwise use full canvas as reference
    let graphX, graphY;
    
    // Parse config values as numbers
    // User enters min/max in display units and hover shows real values.
    let xMin = parseFloat(graphConfig.xMin);
    let xMax = parseFloat(graphConfig.xMax);
    let yMin = parseFloat(graphConfig.yMin);
    let yMax = parseFloat(graphConfig.yMax);

    if (Number.isNaN(xMin)) xMin = graphConfig.xScale === 'Logarithmic' ? 1 : 0;
    if (Number.isNaN(xMax)) xMax = 100;
    if (Number.isNaN(yMin)) yMin = graphConfig.yScale === 'Logarithmic' ? 1 : 0;
    if (Number.isNaN(yMax)) yMax = 100;

    let xRatio;
    let yRatio;

    if (graphArea.width > 0 && graphArea.height > 0) {
      // Use the drawn box for calculation
      xRatio = (canvasX - graphArea.x) / graphArea.width;
      yRatio = (canvasY - graphArea.y) / graphArea.height;
    } else if (uploadedImage && imageSize.width > 0) {
      // If no box drawn yet, use full image dimensions as reference
      xRatio = canvasX / imageSize.width;
      yRatio = canvasY / imageSize.height;
    } else {
      return; // Can't calculate without image loaded
    }

    if (graphConfig.xScale === 'Logarithmic') {
      const safeXMin = xMin > 0 ? xMin : 1e-12;
      const safeXMaxCandidate = xMax > 0 ? xMax : safeXMin * 10;
      const safeXMax = safeXMaxCandidate > safeXMin ? safeXMaxCandidate : safeXMin * 10;
      const logXMin = Math.log10(safeXMin);
      const logXMax = Math.log10(safeXMax);
      const xExponent = logXMin + xRatio * (logXMax - logXMin);
      graphX = Math.pow(10, xExponent);
    } else {
      graphX = xMin + xRatio * (xMax - xMin);
    }

    if (graphConfig.yScale === 'Logarithmic') {
      const safeYMin = yMin > 0 ? yMin : 1e-12;
      const safeYMaxCandidate = yMax > 0 ? yMax : safeYMin * 10;
      const safeYMax = safeYMaxCandidate > safeYMin ? safeYMaxCandidate : safeYMin * 10;
      const logYMin = Math.log10(safeYMin);
      const logYMax = Math.log10(safeYMax);
      const yExponent = logYMax - yRatio * (logYMax - logYMin);
      graphY = Math.pow(10, yExponent);
    } else {
      graphY = yMax - yRatio * (yMax - yMin);
    }
    
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
    const areaForWarn = normalizeArea(graphArea);
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

  return (
    <div className="w-full p-5 bg-white rounded-lg mt-5">
      <div className="bg-blue-50 p-4 rounded mb-4">
        <p className="text-blue-700 font-medium mb-2"><strong>Instructions:</strong></p>
        <ul className="list-disc pl-5 text-gray-700">
          <li>Drag to select the graph area (blue box)</li>
          <li>In Graph Configuration, set axis min/max, scale, and unit, then confirm axis mapping</li>
          <li>Click inside the blue box to add data points</li>
          <li>Right-click on a captured point to remove it</li>
          <li>Use the buttons below to adjust the box or clear points; hover to see the magnifier</li>
        </ul>
      </div>
      

      {(partNumber || manufacturer) ? (
        <div className="mb-4 p-3 bg-gray-100 rounded font-semibold text-gray-800 max-w-xs">
          Part Number: {partNumber && manufacturer ? `${partNumber}(${manufacturer})` : partNumber || ''}
        </div>
      ) : null}
      <div
        className="mb-2 inline-block bg-black bg-opacity-85 text-white border-2 border-green-500 px-4 py-2 rounded font-mono text-base font-bold shadow transition-opacity duration-150"
        style={{ visibility: showCoords ? 'visible' : 'hidden', opacity: showCoords ? 1 : 0.35 }}
      >
        x={formatCoord(mousePos.x)} y={formatCoord(mousePos.y)}
      </div>
      <div className="border border-gray-200 rounded mb-4 overflow-auto">
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
            if (lastUserBoxRef.current) {
              setGraphArea({ ...lastUserBoxRef.current });
            } else if (imageSize.width && imageSize.height) {
              const newBox = {
                x: MARGIN,
                y: MARGIN,
                width: imageSize.width - (MARGIN * 2),
                height: imageSize.height - (MARGIN * 2),
              };
              setGraphArea(newBox);
              lastUserBoxRef.current = newBox;
            }
            setBoxTransparent(false);
            setShowRedrawMsg(false);
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
        {removedPointsMsg && (
          <div className="text-orange-600 font-bold mt-2">
            ⚠️ {removedPointsMsg}
          </div>
        )}
      </div>
      {showMagnifier && (
        <canvas
          ref={magnifierRef}
          className="fixed border-4 border-gray-800 rounded shadow bg-white top-12 right-5 z-50"
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

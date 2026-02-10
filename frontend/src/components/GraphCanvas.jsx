import { useRef, useState, useEffect } from 'react';
import { useGraph } from '../context/GraphContext';

const GraphCanvas = ({ isReadOnly = false, partNumber = '', manufacturer = '' }) => {
  const { uploadedImage, graphArea, setGraphArea, dataPoints, addDataPoint, clearDataPoints, graphConfig, deleteDataPoint } = useGraph();
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
  const [dragDistance, setDragDistance] = useState(0);
  const imageRef = useRef(null);
  const coordinateUpdateTimeoutRef = useRef(null);
  const [resizeMode, setResizeMode] = useState(null);
  const [initialArea, setInitialArea] = useState(null);
  const [initialMouse, setInitialMouse] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const justFinishedResizingRef = useRef(false);
  const [hoveredHandle, setHoveredHandle] = useState(null);
  const prevCanvasPosRef = useRef(null);
  const prevGraphPosRef = useRef(null);
  const stuckFramesRef = useRef(0);
  const [zeroWarnActive, setZeroWarnActive] = useState(false);
  const [stuckWarnActive, setStuckWarnActive] = useState(false);
  const warningHoldTimeoutRef = useRef(null);
  const [boxTransparent, setBoxTransparent] = useState(false);
  const lastUserBoxRef = useRef(null); // Store last manually set box dimensions
  const pendingResizeHandleRef = useRef(null);

  const MARGIN = 16; // Margin from edges for resize handles visibility
  const EDGE_GAP = 12; // Hysteresis for edge checks to reduce flicker
  const EPS = 1e-6;
  const WARN_CLEAR_DELAY = 180; // ms to hold warning before clearing
  const DRAG_THRESHOLD = 50; // Threshold to distinguish between click and drag

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
          const initialBox = {
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
          };
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
  }, [graphArea, dataPoints, showFixPoints, hoveredHandle, resizeMode]);

  // Set box to transparent when points are captured (manually or imported)
  useEffect(() => {
    if (dataPoints.length > 0) {
      setBoxTransparent(true);
    }
  }, [dataPoints.length]);

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
    dataPoints.forEach((point, index) => {
      // Only draw if point has valid canvas coordinates
      if (typeof point.canvasX !== 'number' || typeof point.canvasY !== 'number' || 
          isNaN(point.canvasX) || isNaN(point.canvasY)) {
        return;
      }
      
      const pointRadius = 4;
      // Draw imported points in a red-like color, user-captured points in red
      if (point.imported) {
        // Imported point: Deep orange/red tone for distinction
        ctx.strokeStyle = '#FF7043'; // Deep orange
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.canvasX, point.canvasY, pointRadius, 0, 2 * Math.PI);
        ctx.stroke();
        
        // Soft red/orange fill for distinction
        ctx.fillStyle = '#FFCCBC'; // Light red-orange
        ctx.beginPath();
        ctx.arc(point.canvasX, point.canvasY, pointRadius, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        // User-captured point: Red filled circle (existing behavior)
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.canvasX, point.canvasY, pointRadius, 0, 2 * Math.PI);
        ctx.stroke();
        
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(point.canvasX, point.canvasY, pointRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  };

  // Draw lines connecting all captured points
  const drawFixPoints = (ctx) => {
    // Only draw if there are at least 2 valid points with canvas coordinates (imported + captured)
    const validPoints = dataPoints.filter(p => typeof p.canvasX === 'number' && typeof p.canvasY === 'number' && !isNaN(p.canvasX) && !isNaN(p.canvasY));
    if (validPoints.length < 2) return;

    // Sort points by X coordinate (left to right) to avoid zig-zag
    const sortedPoints = [...validPoints].sort((a, b) => a.canvasX - b.canvasX);

    ctx.save();
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sortedPoints[0].canvasX, sortedPoints[0].canvasY);
    for (let i = 1; i < sortedPoints.length; i++) {
      ctx.lineTo(sortedPoints[i].canvasX, sortedPoints[i].canvasY);
    }
    ctx.stroke();
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
      pendingResizeHandleRef.current = mode;
      setInitialArea(area);
      setInitialMouse({ x, y });
      setIsResizing(false); // Don't start resizing yet
      // Store that a handle was clicked, but don't resize until mouse moves
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

    // Only start resizing if mouse moves enough after clicking a handle
    if (!resizeMode && pendingResizeHandleRef.current && initialArea) {
      const dx = x - initialMouse.x;
      const dy = y - initialMouse.y;
      const moveDistance = Math.sqrt(dx * dx + dy * dy);
      if (moveDistance > 6) {
        setResizeMode(pendingResizeHandleRef.current);
        setIsResizing(true);
        setBoxTransparent(false);
        pendingResizeHandleRef.current = null;
      }
    }

    if (resizeMode && initialArea) {
      const dx = x - initialMouse.x;
      const dy = y - initialMouse.y;
      const moveDistance = Math.sqrt(dx * dx + dy * dy);
      if (!isResizing && moveDistance > 6) {
        setIsResizing(true);
      }
      if (isResizing) {
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
        // Ensure minimum size
        if (nw < minSize) nw = minSize;
        if (nh < minSize) nh = minSize;

        // Ensure boundaries (allow resizing all the way to canvas edges)
        if (nx < 0) nx = 0;
        if (ny < 0) ny = 0;
        if (nx + nw > canvasW) nw = canvasW - nx;
        if (ny + nh > canvasH) nh = canvasH - ny;

        setGraphArea({ x: nx, y: ny, width: nw, height: nh });
        return;
      }
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
      setGraphArea(normalizeArea({
        x: startPos.x,
        y: startPos.y,
        width,
        height,
      }));
    }
  };

  const handleMouseUp = () => {
    if (pendingResizeHandleRef.current && !isResizing) {
      pendingResizeHandleRef.current = null;
      setResizeMode(null);
      setInitialArea(null);
      setIsResizing(false);
    }
    if (isResizing) {
      justFinishedResizingRef.current = true;
      // Store the final resized box dimensions
      lastUserBoxRef.current = { ...graphArea };
      // Make box transparent after resize is done (entering capture mode)
      setBoxTransparent(true);
      setTimeout(() => {
        justFinishedResizingRef.current = false;
      }, 100);
    }
    if (isDrawingBox) {
      // Store box dimensions when user finishes drawing
      lastUserBoxRef.current = { ...graphArea };
      // Make box transparent after drawing is done (entering capture mode)
      setBoxTransparent(true);
    }
    setIsSelecting(false);
    setIsDrawingBox(false);
    setResizeMode(null);
    setInitialArea(null);
    setIsResizing(false);
    setDragDistance(0); // Reset drag distance after mouse up
  };

  const handleCanvasClick = (e) => {
    if (isReadOnly) {
      return;
    }
    // Don't add points while selecting, resizing, or if this was a drag (box drawing)
    if (isSelecting || isResizing || justFinishedResizingRef.current || dragDistance > DRAG_THRESHOLD) {
      setDragDistance(0); // Reset for next interaction
      if (justFinishedResizingRef.current) {
        // Only reset the flag after ignoring a click
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

    // Check if click is within graph area
    const area = normalizeArea(graphArea);
    if (
      canvasX >= area.x &&
      canvasX <= area.x + area.width &&
      canvasY >= area.y &&
      canvasY <= area.y + area.height
    ) {
      addDataPoint({ canvasX, canvasY });
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
      
      // Check distance from click to point
      if (typeof point.canvasX === 'number' && typeof point.canvasY === 'number' &&
          !isNaN(point.canvasX) && !isNaN(point.canvasY)) {
        const dx = canvasX - point.canvasX;
        const dy = canvasY - point.canvasY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= clickRadius) {
          // Found a point - delete it
          deleteDataPoint(i);
          return;
        }
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
    // User enters min/max in display units (e.g., 0-100 for 0-100 μJ)
    // We do NOT multiply by unit prefix here - values stay in display units
    let xMin = parseFloat(graphConfig.xMin);
    let xMax = parseFloat(graphConfig.xMax);
    let yMin = parseFloat(graphConfig.yMin);
    let yMax = parseFloat(graphConfig.yMax);
    
    if (graphArea.width > 0 && graphArea.height > 0) {
      // Use the drawn box for calculation
      graphX = xMin + 
        ((canvasX - graphArea.x) / graphArea.width) * (xMax - xMin);
      
      graphY = yMax - 
        ((canvasY - graphArea.y) / graphArea.height) * (yMax - yMin);
    } else if (uploadedImage && imageSize.width > 0) {
      // If no box drawn yet, use full image dimensions as reference
      graphX = xMin + 
        (canvasX / imageSize.width) * (xMax - xMin);
      
      graphY = yMax - 
        (canvasY / imageSize.height) * (yMax - yMin);
    } else {
      return; // Can't calculate without image loaded
    }
    
    // Convert back from exponent to actual value for logarithmic scales
    if (graphConfig.xScale === 'Logarithmic') {
      graphX = Math.pow(10, graphX);
    }
    if (graphConfig.yScale === 'Logarithmic') {
      graphY = Math.pow(10, graphY);
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
    
    if (pendingResizeHandleRef.current) {
      pendingResizeHandleRef.current = null;
    }
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
          <li>Click inside the blue box to add data points</li>
          <li>Use the buttons below to manage your data points</li>
          <li>Hover over the graph to see a magnified view</li>
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
        x={typeof mousePos.x === 'number' && !isNaN(mousePos.x) ? mousePos.x.toFixed(3) : 'N/A'} y={typeof mousePos.y === 'number' && !isNaN(mousePos.y) ? mousePos.y.toFixed(3) : 'N/A'}
      </div>
      <div
        className="block mt-2 mb-4 min-h-6 text-red-600 text-xs italic transition-opacity duration-200"
        style={{
          visibility: (zeroWarnActive || stuckWarnActive) ? 'visible' : 'hidden',
          opacity: (zeroWarnActive || stuckWarnActive) ? 1 : 0,
        }}
      >
        {zeroWarnActive ? '⚠️ Coordinates are constant. Check that the axis scale (Linear/Logarithmic) and min/max values match the graph.' : null}
        {zeroWarnActive && stuckWarnActive ? ' ' : null}
        {stuckWarnActive ? '⚠️ Coordinates are barely changing while you move. Verify scale, min/max, and units match the graph.' : null}
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
        <button
          className="px-4 py-2 rounded bg-blue-600 text-white font-medium"
          onClick={() => setShowFixPoints((prev) => !prev)}
        >
          {showFixPoints ? 'Hide fix-points' : 'Draw fix-points'}
        </button>
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
        >
          Redraw Box
        </button>
        <button
          className="px-4 py-2 rounded bg-red-700 text-white font-medium"
          onClick={handleClearPoints}
        >
          Clear All
        </button>
        {showRedrawMsg && (
          <div className="text-red-600 font-bold mt-2">
            Please redraw the box
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

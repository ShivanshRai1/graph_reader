import { useRef, useState, useEffect } from 'react';
import { useGraph } from '../context/GraphContext';
import './GraphCanvas.css';

const GraphCanvas = () => {
  const { uploadedImage, graphArea, setGraphArea, dataPoints, addDataPoint, clearDataPoints, graphConfig } = useGraph();
  const [showRedrawMsg, setShowRedrawMsg] = useState(false);
  const canvasRef = useRef(null);
  const magnifierRef = useRef(null);
  const [isSelecting, setIsSelecting] = useState(false);
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

  const MARGIN = 16; // Margin from edges for resize handles visibility

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
          setGraphArea({
            x: MARGIN,
            y: MARGIN,
            width: img.width - (MARGIN * 2),
            height: img.height - (MARGIN * 2),
          });
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

  const drawSelection = (ctx) => {
    const area = normalizeArea(graphArea);
    if (area.width > 0 && area.height > 0) {
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 4;
      ctx.strokeRect(area.x, area.y, area.width, area.height);
      
      // Draw resize handles
      const handleSize = 12;
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
        const currentSize = (isHovered || isActive) ? handleSize + 3 : handleSize;
        
        // Draw white border
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, currentSize, 0, 2 * Math.PI);
        ctx.fill();
        
        // Draw black fill with lighter color when hovered/active
        ctx.fillStyle = (isHovered || isActive) ? '#333333' : '#000000';
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, currentSize - 2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Add glow effect when hovered or active
        if (isHovered || isActive) {
          ctx.shadowColor = '#666666';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, currentSize - 2, 0, 2 * Math.PI);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
      });
    }
  };

  const drawDataPoints = (ctx) => {
    dataPoints.forEach((point) => {
      // Draw white border for better visibility
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(point.canvasX, point.canvasY, 8, 0, 2 * Math.PI); // reduced from 12 to 8
      ctx.stroke();
      
      // Draw red fill
      ctx.fillStyle = 'red';
      ctx.beginPath();
      ctx.arc(point.canvasX, point.canvasY, 8, 0, 2 * Math.PI); // reduced from 12 to 8
      ctx.fill();
    });
  };

  // Draw lines connecting all captured points
  const drawFixPoints = (ctx) => {
    if (dataPoints.length < 2) return;
    
    // Sort points by X coordinate (left to right) to avoid zig-zag
    const sortedPoints = [...dataPoints].sort((a, b) => a.canvasX - b.canvasX);
    
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

    const area = normalizeArea(graphArea);
    const handleRadius = 15; // Same as in handleMouseMoveOnCanvas
    
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
      setResizeMode(mode);
      setInitialArea(area);
      setInitialMouse({ x, y });
      setIsResizing(true);
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

    // Resize existing box
    if (resizeMode && initialArea) {
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

    // Draw new box
    if (!isSelecting) return;
    
    // Calculate distance moved
    const distX = x - startPos.x;
    const distY = y - startPos.y;
    const distance = Math.sqrt(distX * distX + distY * distY);
    setDragDistance(distance);
    
    const width = x - startPos.x;
    const height = y - startPos.y;
    setGraphArea(normalizeArea({
      x: startPos.x,
      y: startPos.y,
      width,
      height,
    }));
  };

  const handleMouseUp = () => {
    if (isResizing) {
      justFinishedResizingRef.current = true;
      setTimeout(() => {
        justFinishedResizingRef.current = false;
      }, 100);
    }
    setIsSelecting(false);
    setResizeMode(null);
    setInitialArea(null);
    setIsResizing(false);
  };

  const handleCanvasClick = (e) => {
    // Don't add points while selecting, resizing, or if this was a drag (box drawing)
    if (isSelecting || isResizing || justFinishedResizingRef.current || dragDistance > 10) {
      setDragDistance(0); // Reset for next interaction
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
    }
  };

  const handleClearPoints = () => {
    clearDataPoints();
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
      const handleRadius = 15; // Detection radius for hover
      
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
    
    if (graphArea.width > 0 && graphArea.height > 0) {
      // Use the drawn box for calculation
      graphX = graphConfig.xMin + 
        ((canvasX - graphArea.x) / graphArea.width) * (graphConfig.xMax - graphConfig.xMin);
      
      graphY = graphConfig.yMax - 
        ((canvasY - graphArea.y) / graphArea.height) * (graphConfig.yMax - graphConfig.yMin);
    } else if (uploadedImage && imageSize.width > 0) {
      // If no box drawn yet, use full image dimensions as reference
      graphX = graphConfig.xMin + 
        (canvasX / imageSize.width) * (graphConfig.xMax - graphConfig.xMin);
      
      graphY = graphConfig.yMax - 
        (canvasY / imageSize.height) * (graphConfig.yMax - graphConfig.yMin);
    } else {
      return; // Can't calculate without image loaded
    }
    
    // Throttle coordinate updates to reduce flickering
    if (coordinateUpdateTimeoutRef.current) {
      clearTimeout(coordinateUpdateTimeoutRef.current);
    }
    
    coordinateUpdateTimeoutRef.current = setTimeout(() => {
      setMousePos({ x: graphX, y: graphY });
      setShowCoords(true);
    }, 16); // ~60fps
    
    // Update magnifier
    setShowMagnifier(true);
    drawMagnifier(canvasX, canvasY);
  };

  const handleMouseLeaveCanvas = () => {
    if (coordinateUpdateTimeoutRef.current) {
      clearTimeout(coordinateUpdateTimeoutRef.current);
    }
    setShowCoords(false);
    setShowMagnifier(false);
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
    <div className="graph-canvas-container">
      <div className="canvas-instructions">
        <p><strong>Instructions:</strong></p>
        <ul>
          <li>Drag to select the graph area (blue box)</li>
          <li>Click inside the blue box to add data points</li>
          <li>Use the buttons below to manage your data points</li>
          <li>Hover over the graph to see a magnified view</li>
        </ul>
      </div>
      <div
        className="coordinate-display-static"
        style={{ visibility: showCoords ? 'visible' : 'hidden', opacity: showCoords ? 1 : 0.35 }}
      >
        x={typeof mousePos.x === 'number' && !isNaN(mousePos.x) ? mousePos.x.toFixed(3) : 'N/A'} y={typeof mousePos.y === 'number' && !isNaN(mousePos.y) ? mousePos.y.toFixed(3) : 'N/A'}
      </div>
      <div className="canvas-wrapper">
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
          className="graph-canvas"
        />
      </div>
      <button
        className="btn btn-primary"
        style={{ marginTop: 16, marginLeft: 8, marginBottom: 24 }}
        onClick={() => setShowFixPoints((prev) => !prev)}
      >
        {showFixPoints ? 'Hide fix-points' : 'Draw fix-points'}
      </button>
      <button
        className="btn btn-secondary"
        style={{ marginTop: 16, marginLeft: 8, marginBottom: 24 }}
        onClick={() => {
          if (imageSize.width && imageSize.height) {
            setGraphArea({
              x: MARGIN,
              y: MARGIN,
              width: imageSize.width - (MARGIN * 2),
              height: imageSize.height - (MARGIN * 2),
            });
            setShowRedrawMsg(false);
          }
        }}
      >
        Redraw Box
      </button>
      {showRedrawMsg && (
        <div style={{ color: '#d32f2f', fontWeight: 'bold', marginTop: 8, marginBottom: 8 }}>
          Please redraw the box
        </div>
      )}
      {showMagnifier && (
        <canvas
          ref={magnifierRef}
          className="magnifier-canvas"
        />
      )}
    </div>
  );
};

export default GraphCanvas;

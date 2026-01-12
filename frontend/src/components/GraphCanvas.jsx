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
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
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
  }, [graphArea, dataPoints, showFixPoints]);

  const drawSelection = (ctx) => {
    if (graphArea.width > 0 && graphArea.height > 0) {
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 4;
      ctx.strokeRect(graphArea.x, graphArea.y, graphArea.width, graphArea.height);
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
    
    setIsSelecting(true);
    setStartPos({ x, y });
  };

  const handleMouseMove = (e) => {
    if (!isSelecting) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    // Calculate distance moved
    const distX = x - startPos.x;
    const distY = y - startPos.y;
    const distance = Math.sqrt(distX * distX + distY * distY);
    setDragDistance(distance);
    
    const width = x - startPos.x;
    const height = y - startPos.y;
    
    setGraphArea({
      x: startPos.x,
      y: startPos.y,
      width,
      height,
    });
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
  };

  const handleCanvasClick = (e) => {
    // Don't add points while selecting or if this was a drag (box drawing)
    if (isSelecting || dragDistance > 10) {
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
    if (
      canvasX >= graphArea.x &&
      canvasX <= graphArea.x + graphArea.width &&
      canvasY >= graphArea.y &&
      canvasY <= graphArea.y + graphArea.height
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
      <div className="canvas-wrapper">
        {showCoords && (
          <div className="coordinate-display">
            x={mousePos.x.toFixed(3)} y={mousePos.y.toFixed(3)}
          </div>
        )}
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
                x: 0,
                y: 0,
                width: imageSize.width,
                height: imageSize.height,
              });
              setShowRedrawMsg(false);
            }
          }}
        >
          Redraw Box
        </button>
      </div>
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

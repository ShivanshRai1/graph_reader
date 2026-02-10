import { useEffect, useMemo, useRef, useState } from 'react';

const normalizeNumber = (value, fallback) => {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
};

const SavedGraphPreview = ({ points, config, width = 520, height = 220, animate = true }) => {
  const polylineRef = useRef(null);
  const [pathLength, setPathLength] = useState(0);

  const parsedPoints = useMemo(() => {
    if (!Array.isArray(points)) return [];
    return points
      .map((point) => ({
        x: Number(point.x_value ?? point.x),
        y: Number(point.y_value ?? point.y),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }, [points]);

  const xScale = config?.xScale ?? config?.x_scale ?? 'Linear';
  const yScale = config?.yScale ?? config?.y_scale ?? 'Linear';

  const plotData = useMemo(() => {
    if (parsedPoints.length === 0) {
      return { plottedPoints: [], xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }

    const toPlotX = (value) => (xScale === 'Logarithmic' ? Math.log10(Math.max(value, 1e-12)) : value);
    const toPlotY = (value) => (yScale === 'Logarithmic' ? Math.log10(Math.max(value, 1e-12)) : value);

    const sortedPoints = [...parsedPoints].sort((a, b) => a.x - b.x);
    const plottedPoints = sortedPoints.map((point) => ({
      x: point.x,
      y: point.y,
      plotX: toPlotX(point.x),
      plotY: toPlotY(point.y),
    }));

    const computedXMin = Math.min(...plottedPoints.map((point) => point.plotX));
    const computedXMax = Math.max(...plottedPoints.map((point) => point.plotX));
    const computedYMin = Math.min(...plottedPoints.map((point) => point.plotY));
    const computedYMax = Math.max(...plottedPoints.map((point) => point.plotY));

    const xMin = normalizeNumber(config?.xMin ?? config?.x_min, computedXMin);
    const xMax = normalizeNumber(config?.xMax ?? config?.x_max, computedXMax);
    const yMin = normalizeNumber(config?.yMin ?? config?.y_min, computedYMin);
    const yMax = normalizeNumber(config?.yMax ?? config?.y_max, computedYMax);

    return {
      plottedPoints,
      xMin: xMin === xMax ? xMin - 1 : xMin,
      xMax: xMin === xMax ? xMax + 1 : xMax,
      yMin: yMin === yMax ? yMin - 1 : yMin,
      yMax: yMin === yMax ? yMax + 1 : yMax,
    };
  }, [parsedPoints, config, xScale, yScale]);

  const { plottedPoints, xMin, xMax, yMin, yMax } = plotData;

  const padding = 28;
  const drawableWidth = Math.max(width - padding * 2, 1);
  const drawableHeight = Math.max(height - padding * 2, 1);

  const svgPoints = useMemo(() => {
    if (plottedPoints.length === 0) return '';
    return plottedPoints
      .map((point) => {
        const x = padding + ((point.plotX - xMin) / Math.max(xMax - xMin, 1e-9)) * drawableWidth;
        const y = padding + (1 - (point.plotY - yMin) / Math.max(yMax - yMin, 1e-9)) * drawableHeight;
        return `${x},${y}`;
      })
      .join(' ');
  }, [plottedPoints, xMin, xMax, yMin, yMax, padding, drawableWidth, drawableHeight]);

  useEffect(() => {
    if (!polylineRef.current) return;
    const length = polylineRef.current.getTotalLength();
    setPathLength(Number.isFinite(length) ? length : 0);
  }, [svgPoints]);

  if (plottedPoints.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#ffffff',
          color: '#6b7280',
          fontSize: 12,
        }}
      >
        No points to display
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: '#ffffff',
      }}
    >
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#d1d5db" strokeWidth="1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#d1d5db" strokeWidth="1" />
      <polyline
        key={svgPoints}
        ref={polylineRef}
        points={svgPoints}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        style={
          animate && pathLength
            ? {
                strokeDasharray: pathLength,
                strokeDashoffset: pathLength,
                animation: 'savedGraphLine 1s ease forwards',
              }
            : undefined
        }
      />
      {plottedPoints.map((point) => {
        const x = padding + ((point.plotX - xMin) / Math.max(xMax - xMin, 1e-9)) * drawableWidth;
        const y = padding + (1 - (point.plotY - yMin) / Math.max(yMax - yMin, 1e-9)) * drawableHeight;
        return <circle key={`${point.x}-${point.y}`} cx={x} cy={y} r={3} fill="#2563eb" />;
      })}
    </svg>
  );
};

export default SavedGraphPreview;

import { useEffect, useMemo, useRef, useState } from 'react';

const normalizeNumber = (value, fallback) => {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
};

const inferLogMode = (scale, values, configMode) => {
  if (scale !== 'Logarithmic') return 'linear';
  if (configMode === 'exponent' || configMode === 'actual') return configMode;
  if (values.some((value) => value <= 0)) return 'exponent';
  return 'actual';
};

const toPlotValue = (value, scale, mode) => {
  if (scale !== 'Logarithmic') return value;
  if (mode === 'exponent') return value;
  return Math.log10(Math.max(value, 1e-12));
};

const toPlotConfigValue = (value, scale, mode) => {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return NaN;
  if (scale !== 'Logarithmic') return num;
  if (mode === 'exponent') return num;
  if (num <= 0) return NaN;
  return Math.log10(Math.max(num, 1e-12));
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  const absValue = Math.abs(value);
  if (absValue < 1e-9) return '0';
  if (absValue >= 1000) return value.toFixed(0);
  if (absValue >= 100) return value.toFixed(1);
  if (absValue >= 10) return value.toFixed(2);
  if (absValue >= 1) return value.toFixed(3);
  return value.toExponential(2);
};

const buildTicks = (min, max, count) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step = (max - min) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, idx) => min + step * idx);
};

const SavedGraphPreview = ({ points, config, width = 520, height = 220, animate = true }) => {
  const polylineRef = useRef(null);
  const [pathLength, setPathLength] = useState(0);
  const [hoveredPoint, setHoveredPoint] = useState(null);

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

  const logModeX = inferLogMode(
    xScale,
    parsedPoints.map((point) => point.x),
    config?.logDataModeX
  );
  const logModeY = inferLogMode(
    yScale,
    parsedPoints.map((point) => point.y),
    config?.logDataModeY
  );

  const plotData = useMemo(() => {
    if (parsedPoints.length === 0) {
      return { plottedPoints: [], xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }

    const toPlotX = (value) => toPlotValue(value, xScale, logModeX);
    const toPlotY = (value) => toPlotValue(value, yScale, logModeY);

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

    const configXMin = toPlotConfigValue(config?.xMin ?? config?.x_min, xScale, logModeX);
    const configXMax = toPlotConfigValue(config?.xMax ?? config?.x_max, xScale, logModeX);
    const configYMin = toPlotConfigValue(config?.yMin ?? config?.y_min, yScale, logModeY);
    const configYMax = toPlotConfigValue(config?.yMax ?? config?.y_max, yScale, logModeY);

    const xMin = Number.isFinite(configXMin) ? configXMin : computedXMin;
    const xMax = Number.isFinite(configXMax) ? configXMax : computedXMax;
    const yMin = Number.isFinite(configYMin) ? configYMin : computedYMin;
    const yMax = Number.isFinite(configYMax) ? configYMax : computedYMax;

    return {
      plottedPoints,
      xMin: xMin === xMax ? xMin - 1 : xMin,
      xMax: xMin === xMax ? xMax + 1 : xMax,
      yMin: yMin === yMax ? yMin - 1 : yMin,
      yMax: yMin === yMax ? yMax + 1 : yMax,
    };
  }, [parsedPoints, config, xScale, yScale, logModeX, logModeY]);

  const { plottedPoints, xMin, xMax, yMin, yMax } = plotData;

  const padding = {
    left: 52,
    right: 20,
    top: 16,
    bottom: 32,
  };
  const drawableWidth = Math.max(width - padding.left - padding.right, 1);
  const drawableHeight = Math.max(height - padding.top - padding.bottom, 1);

  const svgPoints = useMemo(() => {
    if (plottedPoints.length === 0) return '';
    return plottedPoints
      .map((point) => {
        const x = padding.left + ((point.plotX - xMin) / Math.max(xMax - xMin, 1e-9)) * drawableWidth;
        const y = padding.top + (1 - (point.plotY - yMin) / Math.max(yMax - yMin, 1e-9)) * drawableHeight;
        return `${x},${y}`;
      })
      .join(' ');
  }, [plottedPoints, xMin, xMax, yMin, yMax, padding, drawableWidth, drawableHeight]);

  const pointCoords = useMemo(() => {
    return plottedPoints.map((point) => {
      const x = padding.left + ((point.plotX - xMin) / Math.max(xMax - xMin, 1e-9)) * drawableWidth;
      const y = padding.top + (1 - (point.plotY - yMin) / Math.max(yMax - yMin, 1e-9)) * drawableHeight;
      return {
        ...point,
        svgX: x,
        svgY: y,
      };
    });
  }, [plottedPoints, xMin, xMax, yMin, yMax, padding, drawableWidth, drawableHeight]);

  const maxXTicks = Math.max(3, Math.floor(drawableWidth / 120));

  const xTicks = useMemo(() => {
    if (xScale === 'Logarithmic') {
      const start = Math.floor(xMin);
      const end = Math.ceil(xMax);
      const ticks = [];
      for (let i = start; i <= end; i += 1) {
        ticks.push(i);
      }
      const step = Math.max(1, Math.ceil(ticks.length / maxXTicks));
      return ticks.filter((_, idx) => idx % step === 0);
    }
    return buildTicks(xMin, xMax, maxXTicks);
  }, [xMin, xMax, xScale, maxXTicks]);

  const yTicks = useMemo(() => {
    if (yScale === 'Logarithmic') {
      // Generate log ticks at powers of 10 within the visible range
      const minExp = Math.ceil(yMin);
      const maxExp = Math.floor(yMax);
      let ticks = [];
      for (let exp = minExp; exp <= maxExp; exp++) {
        ticks.push(exp);
      }
      // If the range is small, add intermediate ticks (2, 5 multiples)
      if (maxExp - minExp <= 2) {
        const baseTicks = [];
        for (let exp = minExp; exp <= maxExp; exp++) {
          baseTicks.push(exp);
          // Add 2*10^exp and 5*10^exp if in bounds
          if (Math.pow(10, exp) * 2 <= Math.pow(10, maxExp)) baseTicks.push(exp + Math.log10(2));
          if (Math.pow(10, exp) * 5 <= Math.pow(10, maxExp)) baseTicks.push(exp + Math.log10(5));
        }
        ticks = baseTicks;
      }
      return ticks;
    }
    return buildTicks(yMin, yMax, 5);
  }, [yMin, yMax, yScale]);

  const formatTickLabel = (value, scale) => {
    if (scale === 'Logarithmic') {
      return formatNumber(Math.pow(10, value));
    }
    return formatNumber(value);
  };

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

  const handleMouseMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
    let nearest = null;
    let nearestDistance = Infinity;
    const maxDistance = 16;

    pointCoords.forEach((point) => {
      const dx = point.svgX - mouseX;
      const dy = point.svgY - mouseY;
      const distance = Math.hypot(dx, dy);
      if (distance < maxDistance && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    });

    setHoveredPoint(nearest);
  };

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
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredPoint(null)}
    >
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <line
        x1={padding.left}
        y1={height - padding.bottom}
        x2={width - padding.right}
        y2={height - padding.bottom}
        stroke="#d1d5db"
        strokeWidth="1"
      />
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={height - padding.bottom}
        stroke="#d1d5db"
        strokeWidth="1"
      />

      {xTicks.map((tick) => {
        const x = padding.left + ((tick - xMin) / Math.max(xMax - xMin, 1e-9)) * drawableWidth;
        return (
          <g key={`x-${tick}`}>
            <line
              x1={x}
              y1={height - padding.bottom}
              x2={x}
              y2={height - padding.bottom + 4}
              stroke="#cbd5f5"
              strokeWidth="1"
            />
            <text x={x} y={height - padding.bottom + 18} textAnchor="middle" fontSize="10" fill="#6b7280">
              {formatTickLabel(tick, xScale)}
            </text>
          </g>
        );
      })}

      {yTicks.map((tick) => {
        const y = padding.top + (1 - (tick - yMin) / Math.max(yMax - yMin, 1e-9)) * drawableHeight;
        return (
          <g key={`y-${tick}`}>
            <line
              x1={padding.left - 4}
              y1={y}
              x2={padding.left}
              y2={y}
              stroke="#cbd5f5"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill="#6b7280"
            >
              {formatTickLabel(tick, yScale)}
            </text>
          </g>
        );
      })}
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
      {pointCoords.map((point) => (
        <g key={`${point.x}-${point.y}`}>
          <circle cx={point.svgX} cy={point.svgY} r={9} fill="transparent" pointerEvents="none" />
          <circle cx={point.svgX} cy={point.svgY} r={4} fill="#2563eb" pointerEvents="none" />
        </g>
      ))}

      {hoveredPoint ? (
        <g>
          <rect
            x={Math.min(hoveredPoint.svgX + 8, width - 140)}
            y={Math.max(hoveredPoint.svgY - 30, 8)}
            width={132}
            height={36}
            rx={6}
            fill="#f8fafc"
            stroke="#111827"
            strokeWidth="1"
            opacity="0.98"
          />
            <text
              x={Math.min(hoveredPoint.svgX + 14, width - 134)}
              y={Math.max(hoveredPoint.svgY - 12, 24)}
              fontSize="10"
              fontWeight="600"
              fill="#111827"
            >
                X: {Number.isFinite(hoveredPoint.x) ? hoveredPoint.x.toFixed(2) : ''}
            </text>
            <text
              x={Math.min(hoveredPoint.svgX + 14, width - 134)}
              y={Math.max(hoveredPoint.svgY + 2, 38)}
              fontSize="10"
              fontWeight="600"
              fill="#111827"
            >
                Y: {Number.isFinite(hoveredPoint.y) ? hoveredPoint.y.toFixed(2) : ''}
            </text>
        </g>
      ) : null}
    </svg>
  );
};

export default SavedGraphPreview;

import { useEffect, useMemo, useRef, useState } from 'react';

const formatUnitLabel = (value) => {
  const unitLabels = {
    '1e-12': 'pico (p)',
    '1e-9': 'nano (n)',
    '1e-6': 'micro (u)',
    '1e-3': 'milli (m)',
    '1': '1',
    '1e3': 'kilo (k)',
    '1e6': 'mega (M)',
    '1e9': 'giga (G)',
    '1e12': 'tera (T)',
  };

  return unitLabels[String(value || '')] || String(value || '-');
};

const normalizeNumber = (value, fallback) => {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
};

const inferLogMode = (scale, values, configMode, configMin, configMax) => {
  if (scale !== 'Logarithmic') return 'linear';
  if (configMode === 'exponent' || configMode === 'actual') return configMode;

  const minCfg = parseFloat(configMin);
  const maxCfg = parseFloat(configMax);
  const hasCfg = Number.isFinite(minCfg) && Number.isFinite(maxCfg);

  if (values.length === 0) return 'exponent';
  if (values.some((value) => value <= 0)) return 'exponent';

  if (hasCfg) {
    const withinCfg = values.every((value) => value >= minCfg - 0.5 && value <= maxCfg + 0.5);
    if (withinCfg) return 'exponent';
  }

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
  if (absValue >= 0.001) {
    const decimals = Math.min(6, Math.max(3, Math.ceil(-Math.log10(absValue)) + 1));
    return parseFloat(value.toFixed(decimals)).toString();
  }
  return value.toExponential(2);
};

const buildTicks = (min, max, count) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step = (max - min) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, idx) => min + step * idx);
};

const palette = ['#2563eb', '#16a34a', '#f97316', '#e11d48', '#0ea5e9', '#8b5cf6', '#14b8a6'];

const SavedGraphCombinedPreview = ({ curves, config, width = 640, height = 260 }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const polylineRefs = useRef([]);
  const [pathLengths, setPathLengths] = useState([]);

  const safeCurves = useMemo(() => (Array.isArray(curves) ? curves : []), [curves]);
  const baseConfig = config || {};
  const xScale = baseConfig.xScale ?? baseConfig.x_scale ?? 'Linear';
  const yScale = baseConfig.yScale ?? baseConfig.y_scale ?? 'Linear';
  const metadata = useMemo(() => {
    const firstCurve = safeCurves[0] || {};
    const firstConfig = firstCurve.config || {};

    return {
      graphTitle: baseConfig.graphTitle ?? firstConfig.graphTitle ?? firstCurve.graph_title ?? firstCurve.name ?? '-',
      xLabel: baseConfig.xLabel ?? firstConfig.xLabel ?? firstCurve.x_label ?? 'X Axis',
      yLabel: baseConfig.yLabel ?? firstConfig.yLabel ?? firstCurve.y_label ?? 'Y Axis',
      xUnit: formatUnitLabel(baseConfig.xUnit ?? firstConfig.xUnitPrefix ?? firstCurve.x_unit),
      yUnit: formatUnitLabel(baseConfig.yUnit ?? firstConfig.yUnitPrefix ?? firstCurve.y_unit),
      curveNames: safeCurves
        .map((curve, curveIndex) => curve?.config?.curveName || curve?.curve_name || curve?.name || `Curve ${curveIndex + 1}`)
        .filter(Boolean),
    };
  }, [safeCurves, baseConfig]);
  const xAxisTitle = (baseConfig.xLabel ?? baseConfig.x_label ?? safeCurves[0]?.x_label ?? '').toString().trim();
  const yAxisTitle = (baseConfig.yLabel ?? baseConfig.y_label ?? safeCurves[0]?.y_label ?? '').toString().trim();
  const xAxisLabel = xAxisTitle && !/^x(\s+axis)?$/i.test(xAxisTitle) ? `X (${xAxisTitle})` : 'X';
  const yAxisLabel = yAxisTitle && !/^y(\s+axis)?$/i.test(yAxisTitle) ? `Y (${yAxisTitle})` : 'Y';
  const baseLogModeX = xScale !== 'Logarithmic'
    ? 'linear'
    : (baseConfig.logDataModeX === 'actual' || baseConfig.logDataModeX === 'exponent'
      ? baseConfig.logDataModeX
      : 'exponent');
  const baseLogModeY = yScale !== 'Logarithmic'
    ? 'linear'
    : (baseConfig.logDataModeY === 'actual' || baseConfig.logDataModeY === 'exponent'
      ? baseConfig.logDataModeY
      : 'exponent');

  const parsedCurves = useMemo(() => {
    return safeCurves.map((curve, curveIndex) => {
      const points = Array.isArray(curve.points)
        ? curve.points
        : Array.isArray(curve.data_points)
          ? curve.data_points
          : [];
      const parsedPoints = points
        .map((point) => ({
          x: Number(point.x_value ?? point.x),
          y: Number(point.y_value ?? point.y),
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

      const curveConfig = curve?.config || {};
      const curveLogModeX = inferLogMode(
        xScale,
        parsedPoints.map((point) => point.x),
        curveConfig.logDataModeX || baseLogModeX,
        curveConfig.xMin ?? curve.x_min ?? baseConfig.xMin ?? baseConfig.x_min,
        curveConfig.xMax ?? curve.x_max ?? baseConfig.xMax ?? baseConfig.x_max
      );
      const curveLogModeY = inferLogMode(
        yScale,
        parsedPoints.map((point) => point.y),
        curveConfig.logDataModeY || baseLogModeY,
        curveConfig.yMin ?? curve.y_min ?? baseConfig.yMin ?? baseConfig.y_min,
        curveConfig.yMax ?? curve.y_max ?? baseConfig.yMax ?? baseConfig.y_max
      );

      const toPlotX = (value) => toPlotValue(value, xScale, curveLogModeX);
      const toPlotY = (value) => toPlotValue(value, yScale, curveLogModeY);

      const sortedPoints = [...parsedPoints].sort((a, b) => a.x - b.x);
      const plottedPoints = sortedPoints.map((point) => ({
        x: point.x,
        y: point.y,
        plotX: toPlotX(point.x),
        plotY: toPlotY(point.y),
      }));

      return {
        id: curve.id ?? curveIndex,
        label: curve.name || curve.curve_name || curve.graph_title || `Curve ${curveIndex + 1}`,
        color: palette[curveIndex % palette.length],
        logModeX: curveLogModeX,
        logModeY: curveLogModeY,
        points: plottedPoints,
      };
    });
  }, [safeCurves, xScale, yScale, baseLogModeX, baseLogModeY, baseConfig]);

  const plotBounds = useMemo(() => {
    const allPoints = parsedCurves.flatMap((curve) => curve.points);
    if (allPoints.length === 0) {
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }

    const computedXMin = Math.min(...allPoints.map((point) => point.plotX));
    const computedXMax = Math.max(...allPoints.map((point) => point.plotX));
    const computedYMin = Math.min(...allPoints.map((point) => point.plotY));
    const computedYMax = Math.max(...allPoints.map((point) => point.plotY));

    const configXMin = toPlotConfigValue(baseConfig.xMin ?? baseConfig.x_min, xScale, baseLogModeX);
    const configXMax = toPlotConfigValue(baseConfig.xMax ?? baseConfig.x_max, xScale, baseLogModeX);
    const configYMin = toPlotConfigValue(baseConfig.yMin ?? baseConfig.y_min, yScale, baseLogModeY);
    const configYMax = toPlotConfigValue(baseConfig.yMax ?? baseConfig.y_max, yScale, baseLogModeY);

    const xMin = Number.isFinite(configXMin) ? configXMin : computedXMin;
    const xMax = Number.isFinite(configXMax) ? configXMax : computedXMax;
    const yMin = Number.isFinite(configYMin) ? configYMin : computedYMin;
    const yMax = Number.isFinite(configYMax) ? configYMax : computedYMax;

    return {
      xMin: xMin === xMax ? xMin - 1 : xMin,
      xMax: xMin === xMax ? xMax + 1 : xMax,
      yMin: yMin === yMax ? yMin - 1 : yMin,
      yMax: yMin === yMax ? yMax + 1 : yMax,
    };
  }, [parsedCurves, baseConfig, xScale, yScale, baseLogModeX, baseLogModeY]);

  const padding = { left: 58, right: 20, top: 16, bottom: 40 };
  const drawableWidth = Math.max(width - padding.left - padding.right, 1);
  const drawableHeight = Math.max(height - padding.top - padding.bottom, 1);

  const curveSvgData = useMemo(() => {
    return parsedCurves.map((curve) => {
      const points = curve.points.map((point) => {
        const x = padding.left + ((point.plotX - plotBounds.xMin) / Math.max(plotBounds.xMax - plotBounds.xMin, 1e-9)) * drawableWidth;
        const y = padding.top + (1 - (point.plotY - plotBounds.yMin) / Math.max(plotBounds.yMax - plotBounds.yMin, 1e-9)) * drawableHeight;
        return { ...point, svgX: x, svgY: y };
      });

      const polyline = points.map((point) => `${point.svgX},${point.svgY}`).join(' ');
      return { ...curve, points, polyline };
    });
  }, [parsedCurves, plotBounds, padding, drawableWidth, drawableHeight]);

  const maxXTicks = Math.max(3, Math.floor(drawableWidth / 120));

  const xTicks = useMemo(() => {
    if (xScale === 'Logarithmic') {
      const start = Math.floor(plotBounds.xMin);
      const end = Math.ceil(plotBounds.xMax);
      const ticks = Array.from({ length: Math.max(end - start + 1, 1) }, (_, idx) => start + idx);
      const step = Math.max(1, Math.ceil(ticks.length / maxXTicks));
      return ticks.filter((_, idx) => idx % step === 0);
    }
    return buildTicks(plotBounds.xMin, plotBounds.xMax, maxXTicks);
  }, [plotBounds, xScale, maxXTicks]);

  const yTicks = useMemo(() => {
    if (yScale === 'Logarithmic') {
      // Generate log ticks at powers of 10 within the visible range
      const minExp = Math.ceil(plotBounds.yMin);
      const maxExp = Math.floor(plotBounds.yMax);
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
    return buildTicks(plotBounds.yMin, plotBounds.yMax, 5);
  }, [plotBounds, yScale]);

  const formatTickLabel = (value, scale) => {
    if (scale === 'Logarithmic') {
      return formatNumber(Math.pow(10, value));
    }
    return formatNumber(value);
  };

  useEffect(() => {
    const lengths = polylineRefs.current.map((ref) => (ref ? ref.getTotalLength() : 0));
    setPathLengths(lengths);
  }, [curveSvgData]);

  const handleMouseMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
    let nearest = null;
    let nearestDistance = Infinity;
    const maxDistance = 18;

    curveSvgData.forEach((curve) => {
      curve.points.forEach((point) => {
        const dx = point.svgX - mouseX;
        const dy = point.svgY - mouseY;
        const distance = Math.hypot(dx, dy);
        if (distance < maxDistance && distance < nearestDistance) {
          nearest = { ...point, curveLabel: curve.label, color: curve.color };
          nearestDistance = distance;
        }
      });
    });

    setHoveredPoint(nearest);
  };

  if (curveSvgData.length === 0 || curveSvgData.every((curve) => curve.points.length === 0)) {
    return (
      <div style={{ width }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 8,
            marginBottom: 12,
            fontSize: 12,
            color: '#334155',
          }}
        >
          <div><strong>Graph Title:</strong> {metadata.graphTitle}</div>
          <div><strong>X-label:</strong> {metadata.xLabel}</div>
          <div><strong>X-Unit:</strong> {metadata.xUnit}</div>
          <div><strong>Y-label:</strong> {metadata.yLabel}</div>
          <div><strong>Y-Unit:</strong> {metadata.yUnit}</div>
          <div><strong>Curve or Line Name:</strong> {metadata.curveNames.join(', ') || '-'}</div>
        </div>
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
      </div>
    );
  }

  return (
    <div style={{ width }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
          marginBottom: 12,
          fontSize: 12,
          color: '#334155',
        }}
      >
        <div><strong>Graph Title:</strong> {metadata.graphTitle}</div>
        <div><strong>X-label:</strong> {metadata.xLabel}</div>
        <div><strong>X-Unit:</strong> {metadata.xUnit}</div>
        <div><strong>Y-label:</strong> {metadata.yLabel}</div>
        <div><strong>Y-Unit:</strong> {metadata.yUnit}</div>
        <div><strong>Curve or Line Name:</strong> {metadata.curveNames.join(', ') || '-'}</div>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ border: '1px solid var(--color-border)', borderRadius: 8, background: '#ffffff' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {/* Grid lines */}
      {/* Vertical grid lines */}
      {xTicks.map((tick) => {
        const x = padding.left + ((tick - plotBounds.xMin) / Math.max(plotBounds.xMax - plotBounds.xMin, 1e-9)) * drawableWidth;
        return (
          <line
            key={`grid-x-${tick}`}
            x1={x}
            y1={padding.top}
            x2={x}
            y2={height - padding.bottom}
            stroke="#666"
            strokeWidth="1"
            strokeDasharray="4,6"
          />
        );
      })}
      {/* Horizontal grid lines */}
      {yTicks.map((tick) => {
        const y = padding.top + (1 - (tick - plotBounds.yMin) / Math.max(plotBounds.yMax - plotBounds.yMin, 1e-9)) * drawableHeight;
        return (
          <line
            key={`grid-y-${tick}`}
            x1={padding.left}
            y1={y}
            x2={width - padding.right}
            y2={y}
            stroke="#666"
            strokeWidth="1"
            strokeDasharray="4,6"
          />
        );
      })}
      {/* Axes */}
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
        const x = padding.left + ((tick - plotBounds.xMin) / Math.max(plotBounds.xMax - plotBounds.xMin, 1e-9)) * drawableWidth;
        return (
          <g key={`x-${tick}`}>
            <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + 4} stroke="#cbd5f5" strokeWidth="1" />
            <text x={x} y={height - padding.bottom + 18} textAnchor="middle" fontSize="10" fill="#6b7280">
              {formatTickLabel(tick, xScale)}
            </text>
          </g>
        );
      })}

      {yTicks.map((tick) => {
        const y = padding.top + (1 - (tick - plotBounds.yMin) / Math.max(plotBounds.yMax - plotBounds.yMin, 1e-9)) * drawableHeight;
        return (
          <g key={`y-${tick}`}>
            <line x1={padding.left - 4} y1={y} x2={padding.left} y2={y} stroke="#cbd5f5" strokeWidth="1" />
            <text x={padding.left - 10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#6b7280">
              {formatTickLabel(tick, yScale)}
            </text>
          </g>
        );
      })}
      <text
        x={padding.left + drawableWidth / 2}
        y={height - 8}
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="#4b5563"
      >
        {xAxisLabel}
      </text>
      <text
        x={18}
        y={padding.top + drawableHeight / 2}
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="#4b5563"
        transform={`rotate(-90 18 ${padding.top + drawableHeight / 2})`}
      >
        {yAxisLabel}
      </text>

      {curveSvgData.map((curve, index) => (
        <polyline
          key={`${curve.id}-line`}
          ref={(el) => {
            polylineRefs.current[index] = el;
          }}
          points={curve.polyline}
          fill="none"
          stroke={curve.color}
          strokeWidth="2"
          style={
            pathLengths[index]
              ? {
                  strokeDasharray: pathLengths[index],
                  strokeDashoffset: pathLengths[index],
                  animation: 'savedGraphLine 1s ease forwards',
                }
              : undefined
          }
        />
      ))}

      {curveSvgData.map((curve) =>
        curve.points.map((point) => (
          <g key={`${curve.id}-${point.x}-${point.y}`}>
            <circle cx={point.svgX} cy={point.svgY} r={7} fill="transparent" pointerEvents="none" />
            <circle cx={point.svgX} cy={point.svgY} r={3} fill={curve.color} pointerEvents="none" />
          </g>
        ))
      )}

      {hoveredPoint ? (
        <g>
          <rect
            x={Math.min(hoveredPoint.svgX + 8, width - 180)}
            y={Math.max(hoveredPoint.svgY - 40, 8)}
            width={172}
            height={44}
            rx={6}
            fill="#f8fafc"
            stroke="#111827"
            strokeWidth="1"
            opacity="0.98"
          />
          <text x={Math.min(hoveredPoint.svgX + 14, width - 174)} y={Math.max(hoveredPoint.svgY - 22, 24)} fontSize="10" fill="#111827" fontWeight="600">
            {hoveredPoint.curveLabel}
          </text>
          <text x={Math.min(hoveredPoint.svgX + 14, width - 174)} y={Math.max(hoveredPoint.svgY - 8, 38)} fontSize="10" fill="#111827" fontWeight="600">
            X: {Number.isFinite(hoveredPoint.x) ? hoveredPoint.x.toFixed(2) : ''}
          </text>
          <text x={Math.min(hoveredPoint.svgX + 88, width - 100)} y={Math.max(hoveredPoint.svgY - 8, 38)} fontSize="10" fill="#111827" fontWeight="600">
            Y: {Number.isFinite(hoveredPoint.y) ? hoveredPoint.y.toFixed(2) : ''}
          </text>
        </g>
      ) : null}
      </svg>
    </div>
  );
};

export default SavedGraphCombinedPreview;

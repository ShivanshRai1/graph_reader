/**
 * View-graph plot bounds: keep configured axis range but expand when data extends beyond it
 * (e.g. points captured outside the blue box).
 */
export const resolvePlotExtents = ({
  configXMin,
  configXMax,
  configYMin,
  configYMax,
  computedXMin,
  computedXMax,
  computedYMin,
  computedYMax,
}) => {
  let xMin = Number.isFinite(configXMin) ? configXMin : computedXMin;
  let xMax = Number.isFinite(configXMax) ? configXMax : computedXMax;
  let yMin = Number.isFinite(configYMin) ? configYMin : computedYMin;
  let yMax = Number.isFinite(configYMax) ? configYMax : computedYMax;

  if (Number.isFinite(computedXMin)) xMin = Math.min(xMin, computedXMin);
  if (Number.isFinite(computedXMax)) xMax = Math.max(xMax, computedXMax);
  if (Number.isFinite(computedYMin)) yMin = Math.min(yMin, computedYMin);
  if (Number.isFinite(computedYMax)) yMax = Math.max(yMax, computedYMax);

  // Pad only by how far data extends past the configured axis — not a % of the full span.
  // (Otherwise a point at -0.8 on a 0–400 axis would get ~16 units of extra padding → ~-17 on the chart.)
  const padBeyond = (overshoot, span) => {
    if (!Number.isFinite(overshoot) || overshoot <= 0) return 0;
    const safeSpan = Number.isFinite(span) && span > 0 ? span : 1;
    return Math.min(overshoot * 0.12, safeSpan * 0.04);
  };

  const xSpan = Math.abs(xMax - xMin);
  const ySpan = Math.abs(yMax - yMin);

  if (Number.isFinite(computedXMin) && Number.isFinite(configXMin) && computedXMin < configXMin) {
    xMin -= padBeyond(configXMin - computedXMin, xSpan);
  }
  if (Number.isFinite(computedXMax) && Number.isFinite(configXMax) && computedXMax > configXMax) {
    xMax += padBeyond(computedXMax - configXMax, xSpan);
  }
  if (Number.isFinite(computedYMin) && Number.isFinite(configYMin) && computedYMin < configYMin) {
    yMin -= padBeyond(configYMin - computedYMin, ySpan);
  }
  if (Number.isFinite(computedYMax) && Number.isFinite(configYMax) && computedYMax > configYMax) {
    yMax += padBeyond(computedYMax - configYMax, ySpan);
  }

  return {
    xMin: xMin === xMax ? xMin - 1 : xMin,
    xMax: xMin === xMax ? xMax + 1 : xMax,
    yMin: yMin === yMax ? yMin - 1 : yMin,
    yMax: yMin === yMax ? yMax + 1 : yMax,
  };
};

/** True when a point is the common (0,0) anchor used before tracing the real curve. */
const looksLikeOriginAnchor = (point, xSpan, ySpan) => {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x === 0 && y === 0) return true;
  const safeXSpan = Math.max(xSpan, 1e-9);
  const safeYSpan = Math.max(ySpan, 1e-9);
  return Math.abs(x) <= safeXSpan * 0.03 && Math.abs(y) <= safeYSpan * 0.03;
};

/** Split a point series so we do not draw one long connector across large X gaps (e.g. origin anchor → curve). */
export const buildPolylinePointGroups = (points = [], { gapFraction = 0.2 } = {}) => {
  if (!Array.isArray(points) || points.length < 2) {
    return points.length ? [points] : [];
  }

  const xs = points.map((point) => point.plotX);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), 1e-9);
  const gapThreshold = span * gapFraction;

  const dataXs = points.map((point) => Number(point.x)).filter(Number.isFinite);
  const dataYs = points.map((point) => Number(point.y)).filter(Number.isFinite);
  const dataXSpan = dataXs.length ? Math.max(...dataXs) - Math.min(...dataXs) : 1;
  const dataYSpan = dataYs.length ? Math.max(...dataYs) - Math.min(...dataYs) : 1;

  const groups = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const gap = Math.abs(next.plotX - prev.plotX);
    const shouldSplit =
      gap > gapThreshold &&
      (looksLikeOriginAnchor(prev, dataXSpan, dataYSpan) ||
        looksLikeOriginAnchor(next, dataXSpan, dataYSpan));
    if (shouldSplit && current.length >= 1) {
      if (current.length >= 2) groups.push(current);
      current = [next];
    } else {
      current.push(next);
    }
  }

  if (current.length >= 2) groups.push(current);
  else if (current.length === 1 && groups.length === 0) groups.push(current);

  return groups;
};

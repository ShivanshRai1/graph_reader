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

  const xSpan = Math.abs(xMax - xMin);
  const ySpan = Math.abs(yMax - yMin);
  const xPad = xSpan > 0 ? xSpan * 0.04 : 0.1;
  const yPad = ySpan > 0 ? ySpan * 0.04 : 0.1;

  if (Number.isFinite(computedXMin) && Number.isFinite(configXMin) && computedXMin < configXMin) {
    xMin -= xPad;
  }
  if (Number.isFinite(computedXMax) && Number.isFinite(configXMax) && computedXMax > configXMax) {
    xMax += xPad;
  }
  if (Number.isFinite(computedYMin) && Number.isFinite(configYMin) && computedYMin < configYMin) {
    yMin -= yPad;
  }
  if (Number.isFinite(computedYMax) && Number.isFinite(configYMax) && computedYMax > configYMax) {
    yMax += yPad;
  }

  return {
    xMin: xMin === xMax ? xMin - 1 : xMin,
    xMax: xMin === xMax ? xMax + 1 : xMax,
    yMin: yMin === yMax ? yMin - 1 : yMin,
    yMax: yMin === yMax ? yMax + 1 : yMax,
  };
};

/** Split a point series so we do not draw one long connector across large X gaps (e.g. origin anchor → curve). */
export const buildPolylinePointGroups = (points = [], { gapFraction = 0.2 } = {}) => {
  if (!Array.isArray(points) || points.length < 2) {
    return points.length ? [points] : [];
  }

  const xs = points.map((point) => point.plotX);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), 1e-9);
  const gapThreshold = span * gapFraction;

  const groups = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const gap = Math.abs(next.plotX - prev.plotX);
    if (gap > gapThreshold && current.length >= 1) {
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

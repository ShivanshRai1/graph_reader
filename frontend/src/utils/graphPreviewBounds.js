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

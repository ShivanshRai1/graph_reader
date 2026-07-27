import { graphToCanvasWithBounds } from '../context/GraphContext';

export const DEFAULT_AXIS_BOX_INSET_RATIO = 0.12;

/** Typical datasheet plot margins (Y labels left, X labels bottom, legend/title excluded). */
export const DATASHEET_PLOT_MARGINS = {
  left: 0.15,
  top: 0.10,
  right: 0.20,
  bottom: 0.12,
};

export const buildDatasheetPlotArea = (canvasW, canvasH, margins = DATASHEET_PLOT_MARGINS) => {
  const width = Number(canvasW);
  const height = Number(canvasH);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const left = Math.max(6, Math.round(width * margins.left));
  const top = Math.max(6, Math.round(height * margins.top));
  const right = Math.max(6, Math.round(width * margins.right));
  const bottom = Math.max(6, Math.round(height * margins.bottom));

  return {
    x: left,
    y: top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
};

/** Default axis box: full image, or datasheet-style plot area for AI / graph_id sessions. */
export const buildDefaultGraphArea = (
  canvasW,
  canvasH,
  { useInset = false, insetRatio = DEFAULT_AXIS_BOX_INSET_RATIO } = {}
) => {
  const width = Number(canvasW);
  const height = Number(canvasH);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (!useInset) {
    return { x: 0, y: 0, width, height };
  }

  return buildDatasheetPlotArea(width, height);
};

const GRAPH_AREA_EDGE_MARGIN = 6;
const BOX_AUTO_FIT_PADDING_RATIO = 0.12;
const MIN_AUTO_FIT_BOX_SIZE = 24;

const parseAxisBound = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const expandCanvasSpanForAxisFraction = (
  canvasMin,
  canvasMax,
  graphMin,
  graphMax,
  axisMin,
  axisMax,
  scale
) => {
  if (scale === 'Logarithmic') {
    return { min: canvasMin, max: canvasMax };
  }

  const axisSpan = axisMax - axisMin;
  const graphSpan = graphMax - graphMin;
  if (!(axisSpan > 0) || !(graphSpan > 0)) {
    return { min: canvasMin, max: canvasMax };
  }

  const fraction = graphSpan / axisSpan;
  if (fraction <= 0.05 || fraction >= 0.98) {
    return { min: canvasMin, max: canvasMax };
  }

  const canvasSpan = canvasMax - canvasMin;
  if (!(canvasSpan > 0)) {
    return { min: canvasMin, max: canvasMax };
  }

  const fullSpan = canvasSpan / fraction;
  const center = (canvasMin + canvasMax) / 2;
  return {
    min: center - fullSpan / 2,
    max: center + fullSpan / 2,
  };
};

const clampGraphAreaToCanvas = (area, canvasW, canvasH) => {
  const width = Number(canvasW);
  const height = Number(canvasH);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return area;
  }

  const margin = GRAPH_AREA_EDGE_MARGIN;
  let x = Math.max(margin, area.x);
  let y = Math.max(margin, area.y);
  let boxWidth = Math.max(MIN_AUTO_FIT_BOX_SIZE, area.width);
  let boxHeight = Math.max(MIN_AUTO_FIT_BOX_SIZE, area.height);

  if (x + boxWidth > width - margin) {
    boxWidth = Math.max(MIN_AUTO_FIT_BOX_SIZE, width - margin - x);
  }
  if (y + boxHeight > height - margin) {
    boxHeight = Math.max(MIN_AUTO_FIT_BOX_SIZE, height - margin - y);
  }

  return { x, y, width: boxWidth, height: boxHeight };
};

/**
 * Suggest a plot-area box from imported curve points projected on the canvas.
 * Expands using axis span vs data span (e.g. points 2–8 on axis 0–10) then adds padding.
 * Does not change axis min/max values.
 */
export const suggestGraphAreaFromImportedPoints = (
  points = [],
  graphArea,
  graphConfig = {},
  canvasSize = {}
) => {
  if (!graphArea || graphArea.width <= 0 || graphArea.height <= 0) {
    return null;
  }

  const imported = points.filter(
    (point) => point?.imported && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
  if (imported.length < 2) {
    return null;
  }

  const projected = imported
    .map((point) => {
      const { canvasX, canvasY } = graphToCanvasWithBounds(point.x, point.y, graphArea, graphConfig);
      return { canvasX, canvasY, x: point.x, y: point.y };
    })
    .filter((point) => Number.isFinite(point.canvasX) && Number.isFinite(point.canvasY));

  if (projected.length < 2) {
    return null;
  }

  let minX = Math.min(...projected.map((point) => point.canvasX));
  let maxX = Math.max(...projected.map((point) => point.canvasX));
  let minY = Math.min(...projected.map((point) => point.canvasY));
  let maxY = Math.max(...projected.map((point) => point.canvasY));

  const minGraphX = Math.min(...projected.map((point) => point.x));
  const maxGraphX = Math.max(...projected.map((point) => point.x));
  const minGraphY = Math.min(...projected.map((point) => point.y));
  const maxGraphY = Math.max(...projected.map((point) => point.y));

  const xMin = parseAxisBound(graphConfig.xMin, graphConfig.xScale === 'Logarithmic' ? 1 : 0);
  const xMax = parseAxisBound(graphConfig.xMax, 100);
  const yMin = parseAxisBound(graphConfig.yMin, graphConfig.yScale === 'Logarithmic' ? 1 : 0);
  const yMax = parseAxisBound(graphConfig.yMax, 100);

  const expandedX = expandCanvasSpanForAxisFraction(
    minX,
    maxX,
    minGraphX,
    maxGraphX,
    xMin,
    xMax,
    graphConfig.xScale
  );
  const expandedY = expandCanvasSpanForAxisFraction(
    minY,
    maxY,
    minGraphY,
    maxGraphY,
    yMin,
    yMax,
    graphConfig.yScale
  );

  minX = expandedX.min;
  maxX = expandedX.max;
  minY = expandedY.min;
  maxY = expandedY.max;

  const padX = Math.max(8, (maxX - minX) * BOX_AUTO_FIT_PADDING_RATIO);
  const padY = Math.max(8, (maxY - minY) * BOX_AUTO_FIT_PADDING_RATIO);

  const suggested = {
    x: minX - padX,
    y: minY - padY,
    width: (maxX - minX) + padX * 2,
    height: (maxY - minY) + padY * 2,
  };

  const canvasW =
    Number(canvasSize.width) ||
    Math.max(graphArea.x + graphArea.width + GRAPH_AREA_EDGE_MARGIN, maxX + padX + GRAPH_AREA_EDGE_MARGIN);
  const canvasH =
    Number(canvasSize.height) ||
    Math.max(graphArea.y + graphArea.height + GRAPH_AREA_EDGE_MARGIN, maxY + padY + GRAPH_AREA_EDGE_MARGIN);

  const clamped = clampGraphAreaToCanvas(suggested, canvasW, canvasH);
  if (clamped.width < MIN_AUTO_FIT_BOX_SIZE || clamped.height < MIN_AUTO_FIT_BOX_SIZE) {
    return null;
  }

  return clamped;
};

const isNearPowerOfTen = (value) => {
  if (!Number.isFinite(value) || value <= 0) return false;
  const exponent = Math.log10(value);
  return Math.abs(exponent - Math.round(exponent)) < 0.02;
};

/**
 * On log axes, datasheets often label up to 10^(n-1) while the grid extends to 10^n
 * (e.g. ticks to 100 with grid to 1000). When the capture box is aligned to those
 * inner ticks, extend the plot reference through the remaining decade.
 */
const inferLogVisibleMaxAtMinAnchor = (axisMin, axisMax) => {
  if (!(axisMin > 0) || !(axisMax > axisMin)) return axisMax;
  const logMin = Math.log10(axisMin);
  const logMax = Math.log10(axisMax);
  const decades = logMax - logMin;
  if (decades < 3.5 || !isNearPowerOfTen(axisMax)) return axisMax;

  const lastLabeled = Math.pow(10, Math.round(logMax) - 1);
  if (!(lastLabeled > axisMin) || !(lastLabeled < axisMax)) return axisMax;
  if (axisMax / lastLabeled < 9.5) return axisMax;

  return lastLabeled;
};

const expandLogCanvasSpanFromMinAnchor = (canvasMin, canvasMax, axisMin, axisMax, visibleMaxOverride) => {
  const canvasSpan = canvasMax - canvasMin;
  if (!(canvasSpan > 0) || !(axisMax > axisMin)) {
    return { min: canvasMin, max: canvasMax };
  }

  const visibleMax = visibleMaxOverride ?? inferLogVisibleMaxAtMinAnchor(axisMin, axisMax);
  const logVisible = Math.log10(visibleMax) - Math.log10(axisMin);
  const logFull = Math.log10(axisMax) - Math.log10(axisMin);
  if (!(logFull > logVisible + 0.01)) {
    return { min: canvasMin, max: canvasMax };
  }

  const fullSpan = canvasSpan * (logFull / logVisible);
  return { min: canvasMin, max: canvasMin + fullSpan };
};

const expandLogCanvasSpanFromBottomAnchor = (
  canvasTop,
  canvasBottom,
  axisMin,
  axisMax,
  visibleMaxOverride
) => {
  const canvasSpan = canvasBottom - canvasTop;
  if (!(canvasSpan > 0) || !(axisMax > axisMin)) {
    return { top: canvasTop, bottom: canvasBottom };
  }

  const visibleMax = visibleMaxOverride ?? inferLogVisibleMaxAtMinAnchor(axisMin, axisMax);
  const logVisible = Math.log10(visibleMax) - Math.log10(axisMin);
  const logFull = Math.log10(axisMax) - Math.log10(axisMin);
  if (!(logFull > logVisible + 0.01)) {
    return { top: canvasTop, bottom: canvasBottom };
  }

  const fullHeight = canvasSpan * (logFull / logVisible);
  return { top: canvasBottom - fullHeight, bottom: canvasBottom };
};

/**
 * Match the axis value at the capture-box inner edge to visible grid beyond the box.
 * E.g. box height to the 100 tick with two decades of grid above → visible max 100, not 10000.
 *
 * Must be strict: leftover image margin past a correctly drawn full-range box must NOT
 * look like a missing decade, or Final Check maps the blue-box edge below axis max.
 */
const inferLogVisibleMaxAtInnerEdge = (axisMin, axisMax, innerSpanPx, outerSpanPx) => {
  if (!(axisMin > 0) || !(axisMax > axisMin) || !(innerSpanPx > 0) || outerSpanPx < 0) {
    return axisMax;
  }

  // Tiny strip past the box is normal datasheet padding, not an uncaptured decade.
  if (outerSpanPx < Math.max(8, innerSpanPx * 0.06)) {
    return axisMax;
  }

  const logFull = Math.log10(axisMax) - Math.log10(axisMin);
  let bestVisible = axisMax;
  let bestScore = Infinity;
  let bestPredictedOuter = 0;

  let exp = Math.floor(Math.log10(axisMax) + 1e-9);
  const minExp = Math.ceil(Math.log10(axisMin) - 1e-9);
  for (; exp >= minExp; exp -= 1) {
    const candidate = Math.pow(10, exp);
    if (!(candidate > axisMin) || !(candidate < axisMax)) continue;

    const logVisible = Math.log10(candidate) - Math.log10(axisMin);
    if (!(logVisible > 0.01)) continue;

    const ratio = logFull / logVisible;
    if (!(ratio > 1.02)) continue;

    const predictedOuter = innerSpanPx * (ratio - 1);
    const score = Math.abs(predictedOuter - outerSpanPx);
    if (score < bestScore) {
      bestScore = score;
      bestVisible = candidate;
      bestPredictedOuter = predictedOuter;
    }
  }

  if (!(bestVisible < axisMax) || !(bestPredictedOuter > 0)) {
    return axisMax;
  }

  // Require the leftover canvas to closely match the missing-decade prediction.
  // (Previously 0.35 was too loose and treated plot margins as an extra decade.)
  if (outerSpanPx < bestPredictedOuter * 0.7 || outerSpanPx > bestPredictedOuter * 1.35) {
    return axisMax;
  }
  if (bestScore / bestPredictedOuter > 0.3) {
    return axisMax;
  }

  return bestVisible;
};

/** True when clamp would not shrink/shift the area (full expansion fits on the image). */
const plotReferenceFitsOnCanvas = (area, canvasW, canvasH) => {
  if (!area || !(area.width > 0) || !(area.height > 0)) return false;
  const clamped = clampGraphAreaToCanvas(area, canvasW, canvasH);
  return (
    Math.abs(clamped.x - area.x) <= 0.5 &&
    Math.abs(clamped.y - area.y) <= 0.5 &&
    Math.abs(clamped.width - area.width) <= 0.5 &&
    Math.abs(clamped.height - area.height) <= 0.5
  );
};

const PLOT_EDGE_TOLERANCE_PX = 8;

const resolvePlotReferenceCanvasSize = (captureBox, canvasSize = {}, expandedRef = null) => {
  const width = Math.max(
    Number(canvasSize.width) || 0,
    captureBox.x + captureBox.width + GRAPH_AREA_EDGE_MARGIN,
    expandedRef ? expandedRef.x + expandedRef.width + GRAPH_AREA_EDGE_MARGIN : 0,
    1
  );
  const height = Math.max(
    Number(canvasSize.height) || 0,
    captureBox.y + captureBox.height + GRAPH_AREA_EDGE_MARGIN,
    expandedRef ? expandedRef.y + expandedRef.height + GRAPH_AREA_EDGE_MARGIN : 0,
    1
  );
  return { width, height };
};

const plotReferenceExpandsCaptureBox = (captureBox, candidate, tolerancePx = PLOT_EDGE_TOLERANCE_PX) => {
  if (!captureBox || !candidate) return false;
  const tol = Math.max(0, tolerancePx);
  return (
    candidate.width > captureBox.width + tol ||
    candidate.height > captureBox.height + tol ||
    candidate.x < captureBox.x - tol ||
    candidate.y < captureBox.y - tol
  );
};

const applyExpandedPlotReference = (captureBox, expandedRef, canvasW, canvasH) => {
  if (!expandedRef) return null;
  const clamped = clampGraphAreaToCanvas(
    {
      x: expandedRef.x,
      y: expandedRef.y,
      width: expandedRef.width,
      height: expandedRef.height,
    },
    canvasW,
    canvasH
  );
  return plotReferenceExpandsCaptureBox(captureBox, clamped) ? clamped : null;
};

const inferLinearAxisValueOnPlotX = (axisMin, axisMax, canvasX, plot) =>
  axisMin + ((canvasX - plot.x) / plot.width) * (axisMax - axisMin);

const inferLinearAxisValueOnPlotY = (axisMin, axisMax, canvasY, plot) =>
  axisMax - ((canvasY - plot.y) / plot.height) * (axisMax - axisMin);

/** Box covers graphMin..graphMax; expand canvas span so axisMin..axisMax fits. */
const expandLinearCanvasSpanBidirectional = (
  canvasMin,
  canvasMax,
  graphMin,
  graphMax,
  axisMin,
  axisMax
) => {
  const axisSpan = axisMax - axisMin;
  const graphSpan = graphMax - graphMin;
  if (!(axisSpan > 0) || !(graphSpan > 0)) {
    return { min: canvasMin, max: canvasMax };
  }

  const fraction = graphSpan / axisSpan;
  if (fraction <= 0.02 || fraction >= 0.98) {
    return { min: canvasMin, max: canvasMax };
  }

  const canvasSpan = canvasMax - canvasMin;
  if (!(canvasSpan > 0)) {
    return { min: canvasMin, max: canvasMax };
  }

  const fullSpan = canvasSpan / fraction;
  const extensionBefore = fullSpan * ((graphMin - axisMin) / axisSpan);
  const nextMin = canvasMin - extensionBefore;
  return { min: nextMin, max: nextMin + fullSpan };
};

/** Y axis: higher graph values are toward smaller canvas Y. */
const expandLinearCanvasSpanBidirectionalY = (
  canvasTop,
  canvasBottom,
  graphHigh,
  graphLow,
  axisMin,
  axisMax
) => {
  const axisSpan = axisMax - axisMin;
  const graphSpan = graphHigh - graphLow;
  if (!(axisSpan > 0) || !(graphSpan > 0)) {
    return { min: canvasTop, max: canvasBottom };
  }

  const fraction = graphSpan / axisSpan;
  if (fraction <= 0.02 || fraction >= 0.98) {
    return { min: canvasTop, max: canvasBottom };
  }

  const canvasSpan = canvasBottom - canvasTop;
  if (!(canvasSpan > 0)) {
    return { min: canvasTop, max: canvasBottom };
  }

  const fullSpan = canvasSpan / fraction;
  const extensionTop = fullSpan * ((axisMax - graphHigh) / axisSpan);
  const extensionBottom = fullSpan * ((graphLow - axisMin) / axisSpan);
  return {
    min: canvasTop - extensionTop,
    max: canvasBottom + extensionBottom,
  };
};

/**
 * Partial blue boxes may align to inner ticks (e.g. 0–100 on a −50..125 axis).
 * Infer tick values at box edges, then expand the plot reference in all directions.
 */
const expandLinearPlotReferenceFromPartialBox = (
  captureBox,
  canvasW,
  canvasH,
  xMin,
  xMax,
  yMin,
  yMax
) => {
  const widthLimit = Number(canvasW);
  const heightLimit = Number(canvasH);
  if (!Number.isFinite(widthLimit) || widthLimit <= 0) return null;
  if (!Number.isFinite(heightLimit) || heightLimit <= 0) return null;

  const plot = buildDatasheetPlotArea(widthLimit, heightLimit);
  if (!(plot.width > 0) || !(plot.height > 0)) return null;

  const boxRight = captureBox.x + captureBox.width;
  const boxBottom = captureBox.y + captureBox.height;
  const tol = PLOT_EDGE_TOLERANCE_PX;

  const graphAtBoxLeft = inferLinearAxisValueOnPlotX(xMin, xMax, captureBox.x, plot);
  const graphAtBoxRight = inferLinearAxisValueOnPlotX(xMin, xMax, boxRight, plot);
  const graphAtBoxTop = inferLinearAxisValueOnPlotY(yMin, yMax, captureBox.y, plot);
  const graphAtBoxBottom = inferLinearAxisValueOnPlotY(yMin, yMax, boxBottom, plot);

  const expandedX = expandLinearCanvasSpanBidirectional(
    captureBox.x,
    boxRight,
    graphAtBoxLeft,
    graphAtBoxRight,
    xMin,
    xMax
  );
  const expandedY = expandLinearCanvasSpanBidirectionalY(
    captureBox.y,
    boxBottom,
    graphAtBoxTop,
    graphAtBoxBottom,
    yMin,
    yMax
  );

  const nextX = expandedX.min;
  const nextWidth = expandedX.max - expandedX.min;
  const nextY = expandedY.min;
  const nextHeight = expandedY.max - expandedY.min;

  const changed =
    Math.abs(nextX - captureBox.x) > tol ||
    Math.abs(nextWidth - captureBox.width) > tol ||
    Math.abs(nextY - captureBox.y) > tol ||
    Math.abs(nextHeight - captureBox.height) > tol;

  if (!changed) return null;

  return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
};

/** Fallback when tick inference cannot expand: union capture box with datasheet plot area. */
const buildLinearPlotReferenceFallback = (captureBox, canvasW, canvasH) => {
  const widthLimit = Number(canvasW);
  const heightLimit = Number(canvasH);
  if (!Number.isFinite(widthLimit) || widthLimit <= 0) return null;
  if (!Number.isFinite(heightLimit) || heightLimit <= 0) return null;

  const plot = buildDatasheetPlotArea(widthLimit, heightLimit);
  if (!(plot.width > 0) || !(plot.height > 0)) return null;

  const minX = Math.min(captureBox.x, plot.x);
  const minY = Math.min(captureBox.y, plot.y);
  const maxX = Math.max(captureBox.x + captureBox.width, plot.x + plot.width);
  const maxY = Math.max(captureBox.y + captureBox.height, plot.y + plot.height);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const resolveLinearPlotReferenceFromPartialBox = (
  captureBox,
  canvasW,
  canvasH,
  xMin,
  xMax,
  yMin,
  yMax
) => {
  const expanded = expandLinearPlotReferenceFromPartialBox(
    captureBox,
    canvasW,
    canvasH,
    xMin,
    xMax,
    yMin,
    yMax
  );
  if (expanded && plotReferenceExpandsCaptureBox(captureBox, expanded)) {
    return expanded;
  }
  return buildLinearPlotReferenceFallback(captureBox, canvasW, canvasH);
};

const expandLinearPlotReferenceHorizontally = (captureBox, canvasW, canvasH, xMin, xMax, yMin, yMax) => {
  const mapped = resolveLinearPlotReferenceFromPartialBox(
    captureBox,
    canvasW,
    canvasH,
    xMin,
    xMax,
    yMin,
    yMax
  );
  if (!mapped) return null;
  const tol = PLOT_EDGE_TOLERANCE_PX;
  if (
    Math.abs(mapped.x - captureBox.x) > tol ||
    Math.abs(mapped.width - captureBox.width) > tol
  ) {
    return { x: mapped.x, width: mapped.width };
  }
  return null;
};

const expandLinearPlotReferenceVertically = (captureBox, canvasW, canvasH, xMin, xMax, yMin, yMax) => {
  const mapped = resolveLinearPlotReferenceFromPartialBox(
    captureBox,
    canvasW,
    canvasH,
    xMin,
    xMax,
    yMin,
    yMax
  );
  if (!mapped) return null;
  const tol = PLOT_EDGE_TOLERANCE_PX;
  if (
    Math.abs(mapped.y - captureBox.y) > tol ||
    Math.abs(mapped.height - captureBox.height) > tol
  ) {
    return { y: mapped.y, height: mapped.height };
  }
  return null;
};

/**
 * Build the full plot-reference rectangle from the capture box at axis confirm.
 * Partial blue boxes aligned to inner ticks expand bidirectionally so axis min/max
 * map across the full plot, while outside-box capture stays valid.
 */
export const buildPlotReferenceAreaFromCaptureBox = (
  captureBox,
  graphConfig = {},
  canvasSize = {}
) => {
  if (!captureBox || captureBox.width <= 0 || captureBox.height <= 0) {
    return null;
  }

  const xMin = parseAxisBound(graphConfig.xMin, graphConfig.xScale === 'Logarithmic' ? 1 : 0);
  const xMax = parseAxisBound(graphConfig.xMax, 100);
  const yMin = parseAxisBound(graphConfig.yMin, graphConfig.yScale === 'Logarithmic' ? 1 : 0);
  const yMax = parseAxisBound(graphConfig.yMax, 100);

  let x = captureBox.x;
  let y = captureBox.y;
  let width = captureBox.width;
  let height = captureBox.height;
  const right = x + width;

  let canvasW =
    Number(canvasSize.width) ||
    Math.max(x + width + GRAPH_AREA_EDGE_MARGIN, captureBox.x + captureBox.width + GRAPH_AREA_EDGE_MARGIN);
  let canvasH =
    Number(canvasSize.height) ||
    Math.max(y + height + GRAPH_AREA_EDGE_MARGIN, captureBox.y + captureBox.height + GRAPH_AREA_EDGE_MARGIN);

  const applyLinearPlotReferenceCandidate = (linearRef) => {
    if (!linearRef) return;
    const resolvedCanvas = resolvePlotReferenceCanvasSize(captureBox, canvasSize, linearRef);
    canvasW = Math.max(canvasW, resolvedCanvas.width);
    canvasH = Math.max(canvasH, resolvedCanvas.height);
    const applied = applyExpandedPlotReference(captureBox, linearRef, canvasW, canvasH);
    if (!applied) return;
    x = applied.x;
    y = applied.y;
    width = applied.width;
    height = applied.height;
  };

  // Keep the capture box left/bottom edges fixed. Extend plot reference when the box
  // ends on inner ticks while config max goes further (e.g. box to 100, axis to 1000).
  // Never keep a clipped/partial expansion — that maps the blue-box edge below axis max.
  if (graphConfig.xScale === 'Logarithmic') {
    const canvasWidth = Math.max(
      Number(canvasW) || 0,
      captureBox.x + captureBox.width + GRAPH_AREA_EDGE_MARGIN
    );
    const remainingRight = canvasWidth - (captureBox.x + captureBox.width);
    const visibleXMax = inferLogVisibleMaxAtInnerEdge(xMin, xMax, captureBox.width, remainingRight);
    if (visibleXMax < xMax) {
      const expandedRight = expandLogCanvasSpanFromMinAnchor(x, right, xMin, xMax, visibleXMax);
      const nextWidth = Math.max(captureBox.width, expandedRight.max - captureBox.x);
      const candidate = { x: captureBox.x, y, width: nextWidth, height };
      if (plotReferenceFitsOnCanvas(candidate, canvasW, canvasH)) {
        x = captureBox.x;
        width = nextWidth;
      }
    }
  } else if (xMax > xMin) {
    if (graphConfig.yScale !== 'Logarithmic' && yMax > yMin) {
      applyLinearPlotReferenceCandidate(
        resolveLinearPlotReferenceFromPartialBox(
          captureBox,
          canvasW,
          canvasH,
          xMin,
          xMax,
          yMin,
          yMax
        )
      );
    } else {
      const horizontal = expandLinearPlotReferenceHorizontally(
        captureBox,
        canvasW,
        canvasH,
        xMin,
        xMax,
        yMin,
        yMax
      );
      if (horizontal) {
        applyLinearPlotReferenceCandidate({
          x: horizontal.x,
          y: captureBox.y,
          width: horizontal.width,
          height: captureBox.height,
        });
      }
    }
  }

  const bottom = y + height;
  if (graphConfig.yScale === 'Logarithmic') {
    const canvasHeight = Math.max(
      Number(canvasH) || 0,
      captureBox.y + captureBox.height + GRAPH_AREA_EDGE_MARGIN
    );
    const remainingTop = captureBox.y;
    const visibleYMax = inferLogVisibleMaxAtInnerEdge(yMin, yMax, captureBox.height, remainingTop);
    if (visibleYMax < yMax) {
      const expandedTop = expandLogCanvasSpanFromBottomAnchor(
        y,
        bottom,
        yMin,
        yMax,
        visibleYMax
      );
      const nextY = expandedTop.top;
      const nextHeight = Math.max(captureBox.height, expandedTop.bottom - expandedTop.top);
      const candidate = { x, y: nextY, width, height: nextHeight };
      if (plotReferenceFitsOnCanvas(candidate, canvasW, canvasH)) {
        y = nextY;
        height = nextHeight;
      }
    }
  } else if (yMax > yMin) {
    if (graphConfig.xScale === 'Logarithmic') {
      const vertical = expandLinearPlotReferenceVertically(
        captureBox,
        canvasW,
        canvasH,
        xMin,
        xMax,
        yMin,
        yMax
      );
      if (vertical) {
        applyLinearPlotReferenceCandidate({
          x,
          y: vertical.y,
          width,
          height: vertical.height,
        });
      }
    }
  }

  return clampGraphAreaToCanvas({ x, y, width, height }, canvasW, canvasH);
};

export const graphAreasAreSimilar = (a, b, tolerancePx = 6) => {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerancePx &&
    Math.abs(a.y - b.y) <= tolerancePx &&
    Math.abs(a.width - b.width) <= tolerancePx &&
    Math.abs(a.height - b.height) <= tolerancePx
  );
};

export const isGraphAreaContainedIn = (inner, outer, tolerancePx = 3) => {
  if (!inner || !outer || inner.width <= 0 || inner.height <= 0 || outer.width <= 0 || outer.height <= 0) {
    return false;
  }
  const tol = Math.max(0, tolerancePx);
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
};

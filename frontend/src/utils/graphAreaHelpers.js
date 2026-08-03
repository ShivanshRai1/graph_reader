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

/** True when canvas margin past a box edge likely holds more plot (not just padding). */
const hasSignificantOuterPlotSpan = (outerSpanPx, innerSpanPx) =>
  outerSpanPx >= Math.max(8, innerSpanPx * 0.06);

/**
 * Linear X plot-reference margins: skip Y-axis label strip on the left and light
 * padding on the right so xmin/xmax land on the grid (not full-canvas edges).
 * Independent of DATASHEET_PLOT_MARGINS so default axis-box / Y behavior stays put.
 */
const LINEAR_X_PLOT_MARGINS = {
  left: 0.12,
  top: 0.10,
  right: 0.10,
  bottom: 0.12,
};

/**
 * Log plot-reference margins: map axis max to the printed grid, not image padding.
 * top ~0.10 skips the title without dropping ymax below the top decade tick
 * (0.14 was too large — upper ticks hit ymax early, e.g. stuck near the 5-line).
 */
const LOG_PLOT_MARGINS = {
  left: 0.12,
  top: 0.10,
  right: 0.04,
  bottom: 0.12,
};

/**
 * Extend plot reference horizontally for linear axes.
 * Left may move to the plot inset (skip Y-axis labels).
 * Right stays on the blue-box edge: stretching into right padding mapped xmax past
 * the last tick, so clicks on xmax read low (e.g. ~1.9 on a 0–2.5 scale).
 * If the box ends mid-scale, adjust the blue box to the last tick, then Lock axes.
 */
const expandLinearPlotReferenceHorizontally = (captureBox, canvasW, canvasH) => {
  const widthLimit = Number(canvasW);
  const heightLimit = Number(canvasH);
  if (!Number.isFinite(widthLimit) || widthLimit <= 0) return null;
  if (!Number.isFinite(heightLimit) || heightLimit <= 0) return null;

  const plot = buildDatasheetPlotArea(widthLimit, heightLimit, LINEAR_X_PLOT_MARGINS);
  if (!(plot.width > 0)) return null;

  const boxRight = captureBox.x + captureBox.width;
  const targetLeft = Math.min(captureBox.x, plot.x);
  const targetRight = boxRight;
  const nextWidth = targetRight - targetLeft;
  if (Math.abs(targetLeft - captureBox.x) <= 0.5) {
    return null;
  }

  return { x: targetLeft, width: nextWidth };
};

/**
 * Extend log plot reference horizontally to the log plot grid (not canvas padding).
 */
const expandLogPlotReferenceHorizontally = (captureBox, canvasW, canvasH) => {
  const widthLimit = Number(canvasW);
  const heightLimit = Number(canvasH);
  if (!Number.isFinite(widthLimit) || widthLimit <= 0) return null;
  if (!Number.isFinite(heightLimit) || heightLimit <= 0) return null;

  const plot = buildDatasheetPlotArea(widthLimit, heightLimit, LOG_PLOT_MARGINS);
  if (!(plot.width > 0)) return null;

  const targetLeft = Math.min(captureBox.x, plot.x);
  const targetRight = Math.max(captureBox.x + captureBox.width, plot.x + plot.width);
  const nextWidth = targetRight - targetLeft;
  if (!(nextWidth > captureBox.width + 0.5) && Math.abs(targetLeft - captureBox.x) <= 0.5) {
    return null;
  }

  return { x: targetLeft, width: nextWidth };
};

/**
 * Log-Y only: extend plot reference upward through leftover canvas above a partial
 * capture box so the upper decade is not clipped. Linear Y does not use this —
 * ymax stays on the blue-box top (same as ymin on the box bottom).
 *
 * Do NOT expand downward into X-label / canvas margin.
 */
const expandLinearPlotReferenceVertically = (captureBox, canvasH) => {
  const heightLimit = Number(canvasH);
  if (!Number.isFinite(heightLimit) || heightLimit <= 0) return null;

  const remainingTop = Math.max(0, captureBox.y - GRAPH_AREA_EDGE_MARGIN);
  const expandTop = hasSignificantOuterPlotSpan(remainingTop, captureBox.height);
  if (!expandTop) return null;

  const nextY = captureBox.y - remainingTop;
  const nextHeight = captureBox.height + remainingTop;
  if (!(nextHeight > captureBox.height + 0.5)) return null;

  return { y: nextY, height: nextHeight };
};

/**
 * Build the full plot-reference rectangle from the capture box at axis confirm.
 * Partial blue boxes expand so axis min/max map across the plot, not only the box.
 * Linear and log both expand; log also keeps decade-extension when needed.
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

  const canvasW =
    Number(canvasSize.width) ||
    Math.max(x + width + GRAPH_AREA_EDGE_MARGIN, captureBox.x + captureBox.width + GRAPH_AREA_EDGE_MARGIN);
  const canvasH =
    Number(canvasSize.height) ||
    Math.max(y + height + GRAPH_AREA_EDGE_MARGIN, captureBox.y + captureBox.height + GRAPH_AREA_EDGE_MARGIN);

  // Log axes: expand to the log plot grid (not canvas padding — that made xmax read ~82 at 100).
  // Keep decade-extension afterward when leftover canvas still matches a missing decade.
  if (graphConfig.xScale === 'Logarithmic') {
    const horizontal = expandLogPlotReferenceHorizontally(captureBox, canvasW, canvasH);
    if (horizontal) {
      const applied = clampGraphAreaToCanvas(
        { x: horizontal.x, y, width: horizontal.width, height },
        canvasW,
        canvasH
      );
      x = applied.x;
      width = applied.width;
    }

    const canvasWidth = Math.max(
      Number(canvasW) || 0,
      x + width + GRAPH_AREA_EDGE_MARGIN
    );
    const remainingRight = canvasWidth - (x + width);
    const visibleXMax = inferLogVisibleMaxAtInnerEdge(xMin, xMax, width, remainingRight);
    if (visibleXMax < xMax) {
      const expandedRight = expandLogCanvasSpanFromMinAnchor(x, x + width, xMin, xMax, visibleXMax);
      const nextWidth = Math.max(width, expandedRight.max - x);
      const applied = clampGraphAreaToCanvas(
        { x, y, width: nextWidth, height },
        canvasW,
        canvasH
      );
      if (applied.width > width + 0.5) {
        x = applied.x;
        width = applied.width;
      }
    }
  } else if (xMax > xMin) {
    const horizontal = expandLinearPlotReferenceHorizontally(captureBox, canvasW, canvasH);
    if (horizontal) {
      // Always apply; clamp to canvas. Do not reject expansion (that locked mapping to the blue box).
      const applied = clampGraphAreaToCanvas(
        { x: horizontal.x, y, width: horizontal.width, height },
        canvasW,
        canvasH
      );
      x = applied.x;
      width = applied.width;
    }
  }

  if (graphConfig.yScale === 'Logarithmic') {
    // Log Y: expand upward through leftover canvas so the upper decade is not clipped.
    // Bottom stays on the blue box (true ymin / axis line).
    // Log X keeps plot-grid margins above — do not change that path.
    const vertical = expandLinearPlotReferenceVertically(captureBox, canvasH);
    if (vertical) {
      const applied = clampGraphAreaToCanvas(
        { x, y: vertical.y, width, height: vertical.height },
        canvasW,
        canvasH
      );
      y = applied.y;
      height = applied.height;
    } else {
      const canvasHeight = Math.max(
        Number(canvasH) || 0,
        y + height + GRAPH_AREA_EDGE_MARGIN
      );
      const remainingTop = y;
      const visibleYMax = inferLogVisibleMaxAtInnerEdge(yMin, yMax, height, remainingTop);
      if (visibleYMax < yMax) {
        const expandedTop = expandLogCanvasSpanFromBottomAnchor(
          y,
          y + height,
          yMin,
          yMax,
          visibleYMax
        );
        const nextY = expandedTop.top;
        const nextHeight = Math.max(height, expandedTop.bottom - expandedTop.top);
        const applied = clampGraphAreaToCanvas(
          { x, y: nextY, width, height: nextHeight },
          canvasW,
          canvasH
        );
        if (applied.height > height + 0.5) {
          y = applied.y;
          height = applied.height;
        }
      }
    }
  }
  // Linear Y: no vertical expand — blue box top/bottom = ymax/ymin. Stretching into
  // title/label margins made origin Y high and ymax unreachable on the top tick.

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

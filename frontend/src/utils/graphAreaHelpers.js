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

export const graphAreasAreSimilar = (a, b, tolerancePx = 6) => {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerancePx &&
    Math.abs(a.y - b.y) <= tolerancePx &&
    Math.abs(a.width - b.width) <= tolerancePx &&
    Math.abs(a.height - b.height) <= tolerancePx
  );
};

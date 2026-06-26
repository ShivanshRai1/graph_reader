import { graphToCanvasWithBounds } from '../context/GraphContext';

export const AI_MAX_POINTS_STORAGE_KEY = 'ai_max_points_per_curve_v2';
export const DEFAULT_AI_MAX_POINTS = 10;
export const MIN_AI_MAX_POINTS = 2;
export const MAX_AI_MAX_POINTS = 200;
/** Require at least this many AI points before auto-trimming a constant-axis line to endpoints. */
export const MIN_POINTS_FOR_STRAIGHT_LINE_DETECTION = 4;
const STRAIGHT_LINE_RELATIVE_TOLERANCE = 0.01;
const STRAIGHT_LINE_VARYING_AXIS_RATIO = 3;

const isValidAxisCandidate = (value) => {
  if (value === undefined || value === null) return false;
  const str = String(value).trim();
  if (!str) return false;
  const lower = str.toLowerCase();
  return lower !== 'null' && lower !== 'undefined' && lower !== 'nan';
};

const pickAxisValue = (...candidates) => {
  for (const candidate of candidates) {
    if (isValidAxisCandidate(candidate)) {
      return String(candidate).trim();
    }
  }
  return '';
};

const normalizeScale = (value, fallback = 'Linear') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (raw === '1') return 'Linear';
  if (raw.toLowerCase() === 'logarithmic' || raw === '0') return 'Logarithmic';
  return raw;
};

const parsePointPair = (point) => {
  const x = Number(point?.x_value ?? point?.x);
  const y = Number(point?.y_value ?? point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const toStoredPoint = (point, template) => {
  if (template && ('x_value' in template || 'y_value' in template)) {
    return { ...template, x_value: point.x, y_value: point.y };
  }
  if (template && ('x' in template || 'y' in template)) {
    return { ...template, x: point.x, y: point.y };
  }
  return { x_value: point.x, y_value: point.y };
};

export const clampAiMaxPoints = (value) => {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_MAX_POINTS;
  return Math.min(MAX_AI_MAX_POINTS, Math.max(MIN_AI_MAX_POINTS, parsed));
};

export const getAiMaxPointsLimit = () => {
  try {
    const raw = window.sessionStorage.getItem(AI_MAX_POINTS_STORAGE_KEY);
    if (raw === null || raw === '') return DEFAULT_AI_MAX_POINTS;
    return clampAiMaxPoints(raw);
  } catch {
    return DEFAULT_AI_MAX_POINTS;
  }
};

export const setAiMaxPointsLimit = (value) => {
  const clamped = clampAiMaxPoints(value);
  try {
    window.sessionStorage.setItem(AI_MAX_POINTS_STORAGE_KEY, String(clamped));
  } catch {
    // best-effort only
  }
  return clamped;
};

/** Evenly sample X-sorted points; always keeps first and last when max >= 2. */
export const limitPointsEvenlyOnX = (points = [], maxPoints = DEFAULT_AI_MAX_POINTS) => {
  const list = Array.isArray(points) ? points : [];
  const limit = clampAiMaxPoints(maxPoints);
  if (list.length <= limit) return list;

  const parsed = list
    .map((point, index) => ({ point, index, ...parsePointPair(point) }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((a, b) => a.x - b.x || a.index - b.index);

  if (parsed.length <= limit) {
    return parsed.map((entry) => entry.point);
  }

  const sampled = [];
  const last = parsed.length - 1;
  for (let i = 0; i < limit; i += 1) {
    const pickIndex = limit === 1 ? 0 : Math.round((i * last) / (limit - 1));
    sampled.push(parsed[pickIndex]);
  }

  return sampled.map((entry) => toStoredPoint({ x: entry.x, y: entry.y }, entry.point));
};

const buildParsedPointEntries = (points = []) =>
  (Array.isArray(points) ? points : [])
    .map((point, index) => {
      const pair = parsePointPair(point);
      if (!pair) return null;
      return { point, index, x: pair.x, y: pair.y };
    })
    .filter(Boolean);

const axisTolerance = (values, span) => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const ref = Math.max(Math.abs(mean), span, 1e-12);
  return Math.max(ref * STRAIGHT_LINE_RELATIVE_TOLERANCE, span * 0.02);
};

/**
 * Detect horizontal (constant Y) or vertical (constant X) AI curves.
 * Uses every point — if any point breaks flatness, returns null.
 */
export const detectConstantAxisLine = (points = []) => {
  const entries = buildParsedPointEntries(points);
  if (entries.length < MIN_POINTS_FOR_STRAIGHT_LINE_DETECTION) return null;

  const xs = entries.map((entry) => entry.x);
  const ys = entries.map((entry) => entry.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const xTol = axisTolerance(xs, xSpan);
  const yTol = axisTolerance(ys, ySpan);

  const allYFlat = ys.every((y) => Math.abs(y - meanY) <= yTol);
  const allXFlat = xs.every((x) => Math.abs(x - meanX) <= xTol);

  if (
    allYFlat &&
    xSpan >= Math.max(ySpan, yTol) * STRAIGHT_LINE_VARYING_AXIS_RATIO &&
    xSpan > xTol
  ) {
    return 'horizontal';
  }

  if (
    allXFlat &&
    ySpan >= Math.max(xSpan, xTol) * STRAIGHT_LINE_VARYING_AXIS_RATIO &&
    ySpan > yTol
  ) {
    return 'vertical';
  }

  return null;
};

/** Keep first and last point along the varying axis for constant-axis lines. */
export const keepConstantAxisLineEndpoints = (points = [], orientation = null) => {
  const entries = buildParsedPointEntries(points);
  if (!orientation || entries.length < 2) return points;

  const sorted =
    orientation === 'vertical'
      ? [...entries].sort((a, b) => a.y - b.y || a.index - b.index)
      : [...entries].sort((a, b) => a.x - b.x || a.index - b.index);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.index === last.index) {
    return [toStoredPoint({ x: first.x, y: first.y }, first.point)];
  }

  return [
    toStoredPoint({ x: first.x, y: first.y }, first.point),
    toStoredPoint({ x: last.x, y: last.y }, last.point),
  ];
};

/**
 * AI point post-processing: constant-axis lines → 2 endpoints; otherwise existing X sampling.
 */
export const processAiImportedPoints = (points = [], maxPoints = DEFAULT_AI_MAX_POINTS) => {
  const list = Array.isArray(points) ? points : [];
  if (list.length === 0) return list;

  const orientation = detectConstantAxisLine(list);
  if (orientation) {
    return keepConstantAxisLineEndpoints(list, orientation);
  }

  return limitPointsEvenlyOnX(list, maxPoints);
};

export const resolveDiscovereeAxisFields = (graph = {}, detail = {}) => {
  const xMin = pickAxisValue(detail?.x_min, detail?.xmin, detail?.xMin, graph?.x_min, graph?.xmin, graph?.xMin);
  const xMax = pickAxisValue(detail?.x_max, detail?.xmax, detail?.xMax, graph?.x_max, graph?.xmax, graph?.xMax);
  const yMin = pickAxisValue(detail?.y_min, detail?.ymin, detail?.yMin, graph?.y_min, graph?.ymin, graph?.yMin);
  const yMax = pickAxisValue(detail?.y_max, detail?.ymax, detail?.yMax, graph?.y_max, graph?.ymax, graph?.yMax);

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    xScale: normalizeScale(detail?.xscale ?? detail?.x_scale ?? detail?.xScale ?? graph?.x_scale ?? graph?.xscale, 'Linear'),
    yScale: normalizeScale(detail?.yscale ?? detail?.y_scale ?? detail?.yScale ?? graph?.y_scale ?? graph?.yscale, 'Linear'),
    xUnitPrefix: pickAxisValue(detail?.xunit, detail?.x_unit, detail?.xUnitPrefix, detail?.xUnit, graph?.x_unit, graph?.xunit) || '1',
    yUnitPrefix: pickAxisValue(detail?.yunit, detail?.y_unit, detail?.yUnitPrefix, detail?.yUnit, graph?.y_unit, graph?.yunit) || '1',
    xLabel: pickAxisValue(detail?.x_title, detail?.x_label, detail?.xLabel, graph?.x_title, graph?.x_label),
    yLabel: pickAxisValue(detail?.y_title, detail?.y_label, detail?.yLabel, graph?.y_title, graph?.y_label),
  };
};

export const hasCompleteAxisFields = (axis = {}) => {
  const xMin = parseFloat(axis.xMin);
  const xMax = parseFloat(axis.xMax);
  const yMin = parseFloat(axis.yMin);
  const yMax = parseFloat(axis.yMax);
  return (
    Number.isFinite(xMin) &&
    Number.isFinite(xMax) &&
    Number.isFinite(yMin) &&
    Number.isFinite(yMax) &&
    xMax > xMin &&
    yMax > yMin
  );
};

export const buildGraphConfigAxisPatch = (axis = {}) => {
  if (!hasCompleteAxisFields(axis)) return {};
  return {
    xMin: axis.xMin,
    xMax: axis.xMax,
    yMin: axis.yMin,
    yMax: axis.yMax,
    xScale: axis.xScale || 'Linear',
    yScale: axis.yScale || 'Linear',
    xUnitPrefix: axis.xUnitPrefix || '1',
    yUnitPrefix: axis.yUnitPrefix || '1',
    ...(axis.xLabel ? { xLabel: axis.xLabel } : {}),
    ...(axis.yLabel ? { yLabel: axis.yLabel } : {}),
  };
};

/**
 * Default AI thinning only — trims bulk imports above the default cap.
 * Never reduces curves the user has edited or point sets already at/below the cap.
 */
export const applyAiPointLimitToCurve = (curve, { maxPoints = getAiMaxPointsLimit(), skipIfLocallyModified = true } = {}) => {
  if (!curve || typeof curve !== 'object') return curve;
  if (skipIfLocallyModified && (curve.locallyModified || curve.userAdjustedPoints)) return curve;

  const pointList = curve.points ?? curve.data_points ?? [];
  if (!Array.isArray(pointList) || pointList.length === 0) return curve;
  if (pointList.length <= maxPoints) return curve;

  const limited = processAiImportedPoints(pointList, maxPoints);
  if (limited.length === pointList.length) return curve;

  const next = { ...curve, points: limited };
  if (Array.isArray(curve.data_points)) {
    next.data_points = limited.map((point) => ({
      x_value: Number(point?.x_value ?? point?.x),
      y_value: Number(point?.y_value ?? point?.y),
    }));
  }
  return next;
};

export const syncImportedOverlayCanvas = (points = [], graphArea, graphConfig) => {
  if (!graphArea || graphArea.width <= 0 || graphArea.height <= 0) {
    return points;
  }

  let changed = false;
  const next = points.map((point) => {
    if (!point?.imported) return point;
    const { canvasX, canvasY } = graphToCanvasWithBounds(point.x, point.y, graphArea, graphConfig);
    if (
      Number.isFinite(point.canvasX) &&
      Number.isFinite(point.canvasY) &&
      Math.abs(point.canvasX - canvasX) < 0.01 &&
      Math.abs(point.canvasY - canvasY) < 0.01
    ) {
      return point;
    }
    changed = true;
    return { ...point, canvasX, canvasY };
  });

  return changed ? next : points;
};

export const normalizeAiExtractedMetadata = (metadata = {}) => {
  const axis = resolveDiscovereeAxisFields(metadata, metadata);
  return {
    graphTitle: String(metadata.graphTitle || '').trim(),
    curveName: String(metadata.curveName || '').trim(),
    xLabel: String(metadata.xLabel || metadata.xTitle || axis.xLabel || '').trim(),
    yLabel: String(metadata.yLabel || metadata.yTitle || axis.yLabel || '').trim(),
    xScale: normalizeScale(metadata.xScale || axis.xScale, 'Linear'),
    yScale: normalizeScale(metadata.yScale || axis.yScale, 'Linear'),
    xUnitPrefix: pickAxisValue(metadata.xUnitPrefix, metadata.xUnit, axis.xUnitPrefix) || '1',
    yUnitPrefix: pickAxisValue(metadata.yUnitPrefix, metadata.yUnit, axis.yUnitPrefix) || '1',
    xMin: pickAxisValue(metadata.xMin, axis.xMin),
    xMax: pickAxisValue(metadata.xMax, axis.xMax),
    yMin: pickAxisValue(metadata.yMin, axis.yMin),
    yMax: pickAxisValue(metadata.yMax, axis.yMax),
    tctj: String(metadata.tctj || metadata.temperature || '').trim(),
  };
};

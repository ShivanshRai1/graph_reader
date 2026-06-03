import { graphToCanvasWithBounds } from '../context/GraphContext';

export const AI_MAX_POINTS_STORAGE_KEY = 'ai_max_points_per_curve';
export const DEFAULT_AI_MAX_POINTS = 20;
export const MIN_AI_MAX_POINTS = 2;
export const MAX_AI_MAX_POINTS = 200;

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
    xUnitPrefix: pickAxisValue(detail?.xunit, detail?.x_unit, detail?.xUnitPrefix, graph?.x_unit, graph?.xunit) || '1',
    yUnitPrefix: pickAxisValue(detail?.yunit, detail?.y_unit, detail?.yUnitPrefix, graph?.y_unit, graph?.yunit) || '1',
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

export const applyAiPointLimitToCurve = (curve, { maxPoints = getAiMaxPointsLimit(), skipIfLocallyModified = true } = {}) => {
  if (!curve || typeof curve !== 'object') return curve;
  if (skipIfLocallyModified && curve.locallyModified) return curve;

  const pointList = curve.points ?? curve.data_points ?? [];
  if (!Array.isArray(pointList) || pointList.length === 0) return curve;

  const limited = limitPointsEvenlyOnX(pointList, maxPoints);
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

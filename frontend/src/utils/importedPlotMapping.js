export const isTransferCharacteristicsGraph = (graphTitle = '') =>
  /transfer\s*characteristic/i.test(String(graphTitle || ''));

export const isColdTransferCharacteristicCurve = (graphConfig = {}) => {
  const label = `${graphConfig.curveName || ''} ${graphConfig.temperature || ''}`;
  return /(?:^|[^\d])-(?:20|40|55)(?:[^\d]|$)|tj\s*=\s*-\d+/i.test(label);
};

export const inferTransferCharacteristicsAxis = (graphTitle = '', points = []) => {
  if (!isTransferCharacteristicsGraph(graphTitle)) return null;

  const ys = (Array.isArray(points) ? points : [])
    .map((point) => Number(point?.y_value ?? point?.y ?? point?.yValue))
    .filter(Number.isFinite);
  if (ys.length === 0) return null;

  const yMax = Math.max(...ys);
  if (yMax < 80) return null;

  return { xMin: 3, xMax: 15, yMin: 0, yMax: 200 };
};

export const getImportedPointDataXBounds = (points = []) => {
  const xs = (Array.isArray(points) ? points : [])
    .filter((point) => point?.imported !== false)
    .map((point) => Number(point?.x_value ?? point?.x))
    .filter(Number.isFinite);
  if (xs.length === 0) return null;
  return { min: Math.min(...xs), max: Math.max(...xs) };
};

/**
 * DiscoverEE often returns cold-TJ transfer curves as a ~2 V steep leg (e.g. 7–9 V)
 * while the datasheet plot runs 3–15 V with that leg on the right (≈9–15 V).
 */
export const resolveImportedPlotX = (x, graphConfig = {}, importedPoints = []) => {
  const nx = Number(x);
  if (!Number.isFinite(nx)) return x;
  if (!isTransferCharacteristicsGraph(graphConfig.graphTitle)) return nx;
  if (!isColdTransferCharacteristicCurve(graphConfig)) return nx;

  const xMin = parseFloat(graphConfig.xMin);
  const xMax = parseFloat(graphConfig.xMax);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) return nx;

  const dataBounds = getImportedPointDataXBounds(importedPoints);
  if (!dataBounds || dataBounds.max <= dataBounds.min) return nx;

  const dataSpan = dataBounds.max - dataBounds.min;
  const axisSpan = xMax - xMin;
  if (dataSpan > axisSpan * 0.35) return nx;

  const targetMin = xMin + axisSpan / 2;
  const targetMax = xMax;
  return targetMin + ((nx - dataBounds.min) / dataSpan) * (targetMax - targetMin);
};

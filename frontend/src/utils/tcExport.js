const UNIT_SYMBOLS = {
  '1e-12': 'p',
  '1e-9': 'n',
  '1e-6': '\u03bc',
  '1e-3': 'm',
  '1': '',
  '1e3': 'k',
  '1e6': 'M',
  '1e9': 'G',
  '1e12': 'T',
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const parseAxisNumber = (value, fallback) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getUnitSymbol = (prefix) => UNIT_SYMBOLS[prefix] ?? '';

const formatAxisTitleText = (label, unitPrefix) => {
  const trimmed = String(label || '').trim();
  const unitSymbol = getUnitSymbol(unitPrefix);
  if (!trimmed && !unitSymbol) return '';
  if (!unitSymbol) return trimmed;
  if (!trimmed) return unitSymbol;
  if (trimmed.includes(`(${unitSymbol})`)) return trimmed;
  return `${trimmed} (${unitSymbol})`;
};

const sanitizeFilenamePart = (value) => {
  const cleaned = String(value || 'curve')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'curve';
};

const computePointStats = (points) => {
  if (!points.length) {
    return { min: 0, max: 0, sum: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minY = points[0][1];
  let maxY = points[0][1];
  let minX = points[0][0];
  let maxX = points[0][0];
  let sum = 0;

  points.forEach(([x, y]) => {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    sum += y;
  });

  return { min: minY, max: maxY, sum, minX, maxX, minY, maxY };
};

const groupPointsForExport = (dataPoints) => {
  const groups = new Map();

  dataPoints.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const key = point.overlayCurveId ?? '__single__';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push([point.x, point.y]);
  });

  return Array.from(groups.values());
};

const buildSeriesEntry = (templateSeries, points, { name, colorIndex, showLegend }) => {
  const series = deepClone(templateSeries);
  const stats = computePointStats(points);

  series.name = name;
  series.colorIndex = colorIndex;
  series.points = points;
  series.min = stats.min;
  series.max = stats.max;
  series.sum = stats.sum;
  series.addToLegend = showLegend;
  series.group = 0;
  series.isY2 = false;

  return series;
};

const applyAxisScale = (axisBlock, { min, max, isLog }) => {
  if (!axisBlock?.scale) return;

  axisBlock.scale.auto = false;
  axisBlock.scale.min = min;
  axisBlock.scale.max = max;
  axisBlock.scale.rangeEnabled = true;

  if (axisBlock.grid) {
    axisBlock.grid.log = !!isLog;
  }

  if (isLog) {
    const safeMin = min > 0 ? min : 0.1;
    const safeMax = max > safeMin ? max : safeMin * 10;
    axisBlock.scale.minLog = safeMin;
    axisBlock.scale.maxLog = safeMax;
  }
};

const applyGraphConfigToTypicalCurve = (tc, graphConfig) => {
  const xMin = parseAxisNumber(graphConfig.xMin, 0);
  const xMax = parseAxisNumber(graphConfig.xMax, 100);
  const yMin = parseAxisNumber(graphConfig.yMin, 0);
  const yMax = parseAxisNumber(graphConfig.yMax, 100);
  const xIsLog = graphConfig.xScale === 'Logarithmic';
  const yIsLog = graphConfig.yScale === 'Logarithmic';

  const plotTitle = String(graphConfig.graphTitle || graphConfig.curveName || 'Captured Curve').trim() || 'Captured Curve';
  const xAxisTitle = formatAxisTitleText(graphConfig.xLabel, graphConfig.xUnitPrefix) || 'X';
  const yAxisTitle = formatAxisTitleText(graphConfig.yLabel, graphConfig.yUnitPrefix) || 'Y';

  tc.title = tc.title || { text: ['', '', '', '', ''], visible: true };
  tc.title.text = [plotTitle, tc.title.text?.[1] || '', tc.title.text?.[2] || '', tc.title.text?.[3] || '', tc.title.text?.[4] || ''];
  tc.title.visible = true;

  if (tc.xAxis?.title) {
    tc.xAxis.title.text = [xAxisTitle, tc.xAxis.title.text?.[1] || ''];
    tc.xAxis.title.visible = true;
  }

  if (tc.yAxis?.title) {
    tc.yAxis.title.text = [tc.yAxis.title.text?.[0] || '', yAxisTitle];
    tc.yAxis.title.visible = true;
  }

  applyAxisScale(tc.xAxis, { min: xMin, max: xMax, isLog: xIsLog });
  applyAxisScale(tc.yAxis, { min: yMin, max: yMax, isLog: yIsLog });
};

export const inferTypicalCurveExportSource = (dataPoints = []) => {
  if (!dataPoints.length) return 'manual';

  const importedCount = dataPoints.filter((point) => point.imported).length;
  if (importedCount === dataPoints.length) return 'ai';
  if (importedCount > 0) return 'manual_edited';
  return 'manual';
};

export const buildTypicalCurveFilename = (graphConfig, source = 'manual') => {
  const baseName = sanitizeFilenamePart(graphConfig.graphTitle || graphConfig.curveName || 'curve');
  const safeSource = sanitizeFilenamePart(source);
  return `${baseName}_${safeSource}.tc`;
};

export const buildTypicalCurveExport = ({ template, graphConfig, dataPoints }) => {
  if (!template) {
    throw new Error('Typical curve template is required');
  }
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('No captured points to export');
  }

  const groupedPoints = groupPointsForExport(dataPoints);
  if (groupedPoints.length === 0) {
    throw new Error('No valid captured points to export');
  }

  const tc = deepClone(template);
  const templateSeries = template.dataSet?.data?.[0];
  if (!templateSeries) {
    throw new Error('Typical curve template is missing dataSet.data[0]');
  }

  const showLegend = groupedPoints.length > 1;
  const seriesList = groupedPoints.map((points, index) => {
    const defaultName = groupedPoints.length === 1
      ? (String(graphConfig.curveName || '').trim() || 'data0')
      : `data${index}`;
    return buildSeriesEntry(templateSeries, points, {
      name: defaultName,
      colorIndex: index,
      showLegend,
    });
  });

  tc.dataSet.data = seriesList;
  tc.dataSet.type = 'line';
  tc.dataSet.groupCount = 1;
  tc.dataSet.isCustomOrder = groupedPoints.length > 1;
  tc.dataSet.fitPointCount = String(Math.max(...groupedPoints.map((points) => points.length), 1));

  const datasetStats = seriesList.reduce(
    (acc, series) => {
      const stats = computePointStats(series.points);
      return {
        minX: Math.min(acc.minX, stats.minX),
        maxX: Math.max(acc.maxX, stats.maxX),
        minY: Math.min(acc.minY, stats.minY),
        maxY: Math.max(acc.maxY, stats.maxY),
      };
    },
    {
      minX: seriesList[0].points[0][0],
      maxX: seriesList[0].points[0][0],
      minY: seriesList[0].points[0][1],
      maxY: seriesList[0].points[0][1],
    }
  );

  tc.dataSet.minX = datasetStats.minX;
  tc.dataSet.maxX = datasetStats.maxX;
  tc.dataSet.minY = datasetStats.minY;
  tc.dataSet.maxY = datasetStats.maxY;

  if (tc.legend) {
    tc.legend.isVisible = showLegend;
  }

  applyGraphConfigToTypicalCurve(tc, graphConfig);
  return tc;
};

export const downloadTypicalCurveFile = (filename, tcObject) => {
  const json = JSON.stringify(tcObject);
  const blob = new Blob([json], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.tc') ? filename : `${filename}.tc`;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
};

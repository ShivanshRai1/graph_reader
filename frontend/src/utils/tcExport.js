import { canonicalTcSeriesName } from './tcImport';

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

const parseTemperatureForExport = (value) => {
  const parsed = parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 25;
};

const getUnitSymbol = (prefix) => UNIT_SYMBOLS[prefix] ?? '';

const normalizeParentheticalUnit = (label) =>
  String(label || '').trim().replace(/(\S)\(/g, '$1 (');

const extractUnitFromLabel = (label) => {
  const match = String(label || '').trim().match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : '';
};

const resolveAxisTitleUnit = (label, unitPrefix) => {
  const embeddedUnit = extractUnitFromLabel(label);
  if (embeddedUnit) return embeddedUnit;
  return getUnitSymbol(unitPrefix);
};

const formatAxisTitleText = (label, unitPrefix) => {
  const trimmed = normalizeParentheticalUnit(String(label || '').trim());
  const embeddedUnit = extractUnitFromLabel(trimmed);
  const unitSymbol = getUnitSymbol(unitPrefix);

  if (!trimmed && !unitSymbol && !embeddedUnit) return '';
  if (embeddedUnit) return trimmed;
  if (!unitSymbol) return trimmed;
  if (!trimmed) return unitSymbol;
  if (trimmed.includes(`(${unitSymbol})`) || trimmed.includes(`(${unitSymbol.toUpperCase()})`)) {
    return trimmed;
  }
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

const pickFirstFiniteAxisValue = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const str = String(candidate).trim();
    if (!str) continue;
    const parsed = parseFloat(str);
    if (Number.isFinite(parsed)) return str;
  }
  return '';
};

const snapAxisMinBound = (min, max) => {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return min;
  const span = Math.max(hi - lo, 1e-9);
  if (lo >= 0 && lo <= span * 0.05) return 0;
  return lo;
};

const snapAxisMaxBound = (max) => {
  const value = Number(max);
  if (!Number.isFinite(value)) return max;
  if (value <= 0) return value;

  const abs = Math.abs(value);
  const exponent = Math.floor(Math.log10(abs));
  const fraction = abs / (10 ** exponent);
  const niceFractions = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const niceFraction = niceFractions.find((candidate) => candidate >= fraction) || 10;
  return niceFraction * (10 ** exponent);
};

const snapAxisBounds = ({ xMin, xMax, yMin, yMax }) => {
  const rawXMin = Number(xMin);
  const rawXMax = Number(xMax);
  const rawYMin = Number(yMin);
  const rawYMax = Number(yMax);
  if (
    !Number.isFinite(rawXMin) || !Number.isFinite(rawXMax) ||
    !Number.isFinite(rawYMin) || !Number.isFinite(rawYMax) ||
    rawXMax <= rawXMin || rawYMax <= rawYMin
  ) {
    return { xMin, xMax, yMin, yMax };
  }

  return {
    xMin: snapAxisMinBound(rawXMin, rawXMax),
    xMax: snapAxisMaxBound(rawXMax),
    yMin: snapAxisMinBound(rawYMin, rawYMax),
    yMax: snapAxisMaxBound(rawYMax),
  };
};

const collectCurvePointsForExport = (curves = []) =>
  (Array.isArray(curves) ? curves : []).flatMap((curve) => {
    const pointList = curve?.points ?? curve?.data_points ?? [];
    return pointList
      .map((point) => ({
        x: Number(point?.x_value ?? point?.x),
        y: Number(point?.y_value ?? point?.y),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  });

const computeAxisBoundsFromCurves = (curves = []) => {
  const points = collectCurvePointsForExport(curves);
  if (points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const snapped = snapAxisBounds({
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  });

  return {
    xMin: String(snapped.xMin),
    xMax: String(snapped.xMax),
    yMin: String(snapped.yMin),
    yMax: String(snapped.yMax),
  };
};

const hasCompleteExportAxis = (config = {}) => {
  const xMin = parseFloat(config.xMin);
  const xMax = parseFloat(config.xMax);
  const yMin = parseFloat(config.yMin);
  const yMax = parseFloat(config.yMax);
  return (
    Number.isFinite(xMin) &&
    Number.isFinite(xMax) &&
    Number.isFinite(yMin) &&
    Number.isFinite(yMax) &&
    xMax > xMin &&
    yMax > yMin &&
    Boolean(config.xScale) &&
    Boolean(config.yScale) &&
    Boolean(config.xUnitPrefix) &&
    Boolean(config.yUnitPrefix)
  );
};

const roundSeriesSum = (sum) => {
  if (!Number.isFinite(sum)) return 0;
  return Math.round(sum * 1e4) / 1e4;
};

const computeLabelDecimals = (span, axis = 'y') => {
  const safeSpan = Math.abs(span);
  if (!Number.isFinite(safeSpan) || safeSpan <= 0) return axis === 'y' ? 2 : 0;
  if (safeSpan <= 0.2) return 3;
  if (safeSpan < 1) return 2;
  if (safeSpan >= 10) return 0;
  return 1;
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
      groups.set(key, {
        points: [],
        name: String(point.overlayCurveName || '').trim(),
        isY2: Boolean(point.overlayCurveIsY2),
        temperature: parseTemperatureForExport(point.overlayCurveTemperature),
      });
    }
    const group = groups.get(key);
    if (!group.name && point.overlayCurveName) {
      group.name = String(point.overlayCurveName).trim();
    }
    if (point.overlayCurveIsY2) {
      group.isY2 = true;
    }
    if (point.overlayCurveTemperature !== undefined && point.overlayCurveTemperature !== null) {
      group.temperature = parseTemperatureForExport(point.overlayCurveTemperature);
    }
    group.points.push([point.x, point.y]);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    points: [...group.points].sort((a, b) => a[0] - b[0]),
  }));
};

const computeLinearAxisGain = (min, max, fullScale) => {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return fullScale / span;
};

const computeLinearGridCount = (min, max) => {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span <= 0) return 5;
  return Math.min(10, Math.max(4, Math.round(span / 5)));
};

const buildSeriesEntry = (templateSeries, points, { name, colorIndex, showLegend, temperature, isY2, yUnitSymbol }) => {
  const series = deepClone(templateSeries);
  const stats = computePointStats(points);

  series.name = name;
  series.colorIndex = colorIndex;
  series.points = points;
  series.min = stats.min;
  series.max = stats.max;
  series.sum = roundSeriesSum(stats.sum);
  series.addToLegend = true;
  series.group = 0;
  series.isY2 = Boolean(isY2);
  series.showLines = true;
  series.showPoints = true;
  series.temperature = parseTemperatureForExport(temperature);

  if (series.scope && yUnitSymbol) {
    series.scope.units = yUnitSymbol;
  }

  return series;
};

const applyAxisScale = (axisBlock, { min, max, isLog }, { gainFullScale, labelDecimals, showMinorGrid } = {}) => {
  if (!axisBlock?.scale) return;

  axisBlock.scale.auto = false;
  axisBlock.scale.min = min;
  axisBlock.scale.max = max;
  axisBlock.scale.rangeEnabled = true;

  if (axisBlock.grid) {
    axisBlock.grid.log = !!isLog;
    if (!isLog) {
      axisBlock.grid.count = computeLinearGridCount(min, max);
      if (showMinorGrid) {
        axisBlock.grid.showMinorLogGrid = true;
      }
    }
  }

  if (!isLog && Number.isFinite(gainFullScale)) {
    axisBlock.gain = computeLinearAxisGain(min, max, gainFullScale);
  }

  if (axisBlock.labels && !isLog) {
    if (labelDecimals !== undefined) {
      axisBlock.labels.decimalCount = String(labelDecimals);
    } else {
      const span = Math.abs(max - min);
      axisBlock.labels.decimalCount = span >= 10 ? '0' : axisBlock.labels.decimalCount || '1';
    }
  }

  if (isLog) {
    const safeMin = min > 0 ? min : 0.1;
    const safeMax = max > safeMin ? max : safeMin * 10;
    axisBlock.scale.minLog = safeMin;
    axisBlock.scale.maxLog = safeMax;
  }
};

const applyY2AxisToTypicalCurve = (tc, graphConfig, y2PointStats) => {
  if (!tc?.yAxis2) return;

  const configuredMin = parseFloat(graphConfig.y2Min);
  const configuredMax = parseFloat(graphConfig.y2Max);
  const hasConfiguredRange = Number.isFinite(configuredMin) && Number.isFinite(configuredMax) && configuredMin !== configuredMax;

  const y2Min = hasConfiguredRange ? configuredMin : y2PointStats.minY;
  const y2Max = hasConfiguredRange ? configuredMax : y2PointStats.maxY;
  if (!Number.isFinite(y2Min) || !Number.isFinite(y2Max) || y2Min === y2Max) return;

  const y2IsLog = graphConfig.y2Scale === 'Logarithmic';
  const y2Span = Math.abs(y2Max - y2Min);
  const y2Label = formatAxisTitleText(graphConfig.y2Label || '', graphConfig.y2UnitPrefix || '1') || 'Y2';

  applyAxisScale(tc.yAxis2, { min: y2Min, max: y2Max, isLog: y2IsLog }, {
    gainFullScale: 144,
    labelDecimals: y2Span >= 10 ? 0 : 1,
    showMinorGrid: !y2IsLog,
  });

  if (tc.yAxis2.grid) {
    tc.yAxis2.grid.visible = true;
  }
  if (tc.yAxis2.labels) {
    tc.yAxis2.labels.visible = true;
  }
  if (tc.yAxis2.title) {
    tc.yAxis2.title.text = [tc.yAxis2.title.text?.[0] || '', y2Label];
    tc.yAxis2.title.visible = true;
    const y2Unit = resolveAxisTitleUnit(graphConfig.y2Label, graphConfig.y2UnitPrefix);
    if (y2Unit) {
      tc.yAxis2.title.units = y2Unit;
    }
  }
};

const applyGraphConfigToTypicalCurve = (tc, graphConfig, { multipleSeries = false, hasY2Series = false, y2PointStats = null } = {}) => {
  const xMin = parseAxisNumber(graphConfig.xMin, 0);
  const xMax = parseAxisNumber(graphConfig.xMax, 100);
  const yMin = parseAxisNumber(graphConfig.yMin, 0);
  const yMax = parseAxisNumber(graphConfig.yMax, 100);
  const xIsLog = graphConfig.xScale === 'Logarithmic';
  const yIsLog = graphConfig.yScale === 'Logarithmic';

  const plotTitle = multipleSeries
    ? (String(graphConfig.graphTitle || '').trim() || 'Captured Curve')
    : (String(graphConfig.graphTitle || graphConfig.curveName || '').trim() || 'Captured Curve');
  const xAxisTitle = formatAxisTitleText(graphConfig.xLabel, graphConfig.xUnitPrefix) || 'X';
  const yAxisTitle = formatAxisTitleText(graphConfig.yLabel, graphConfig.yUnitPrefix) || 'Y';
  const xUnit = resolveAxisTitleUnit(graphConfig.xLabel, graphConfig.xUnitPrefix);

  tc.title = tc.title || { text: ['', '', '', '', ''], visible: true };
  tc.title.text = [plotTitle, tc.title.text?.[1] || '', tc.title.text?.[2] || '', tc.title.text?.[3] || '', tc.title.text?.[4] || ''];
  tc.title.visible = true;

  if (tc.xAxis?.title) {
    tc.xAxis.title.text = [xAxisTitle, ''];
    tc.xAxis.title.visible = true;
    tc.xAxis.title.showUnits = false;
    if (xUnit) {
      tc.xAxis.title.units = xUnit;
    }
  }
  if (tc.xAxis?.scope && xUnit) {
    tc.xAxis.scope.units = xUnit;
  }

  if (tc.yAxis?.title) {
    const yTitleLine = yAxisTitle || tc.yAxis.title.text?.[1] || tc.yAxis.title.text?.[0] || 'Y';
    tc.yAxis.title.text = [yTitleLine, ''];
    tc.yAxis.title.visible = true;
    tc.yAxis.title.showUnits = false;
    const yUnit = resolveAxisTitleUnit(graphConfig.yLabel, graphConfig.yUnitPrefix);
    if (yUnit) {
      tc.yAxis.title.units = yUnit;
    }
  }

  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  applyAxisScale(tc.xAxis, { min: xMin, max: xMax, isLog: xIsLog }, {
    gainFullScale: 180,
    labelDecimals: computeLabelDecimals(xSpan, 'x'),
  });
  applyAxisScale(tc.yAxis, { min: yMin, max: yMax, isLog: yIsLog }, {
    gainFullScale: 144,
    labelDecimals: computeLabelDecimals(ySpan, 'y'),
    showMinorGrid: !yIsLog,
  });

  if (hasY2Series && y2PointStats) {
    applyY2AxisToTypicalCurve(tc, graphConfig, y2PointStats);
  }
};

const buildTypicalCurveExportCore = ({ template, graphConfig, seriesGroups }) => {
  if (!template) {
    throw new Error('Typical curve template is required');
  }
  if (!Array.isArray(seriesGroups) || seriesGroups.length === 0) {
    throw new Error('No captured points to export');
  }

  const validGroups = seriesGroups.filter((group) => Array.isArray(group.points) && group.points.length > 0);
  if (validGroups.length === 0) {
    throw new Error('No valid captured points to export');
  }

  const tc = deepClone(template);
  const templateSeries = template.dataSet?.data?.[0];
  if (!templateSeries) {
    throw new Error('Typical curve template is missing dataSet.data[0]');
  }

  const showLegend = validGroups.length > 1;
  const defaultTemperature = parseTemperatureForExport(graphConfig.temperature);
  const yUnitSymbol = resolveAxisTitleUnit(graphConfig.yLabel, graphConfig.yUnitPrefix);
  const y2UnitSymbol = resolveAxisTitleUnit(graphConfig.y2Label, graphConfig.y2UnitPrefix);

  const seriesList = validGroups.map((group, index) => {
    const defaultName = validGroups.length === 1
      ? (String(graphConfig.curveName || '').trim() || 'data0')
      : `data${index}`;
    const isY2 = Boolean(group.isY2);
    const rawName = String(group.name || defaultName).trim() || defaultName;
    const seriesName = canonicalTcSeriesName(rawName) || rawName;
    return buildSeriesEntry(templateSeries, group.points, {
      name: seriesName,
      colorIndex: index,
      showLegend,
      temperature: group.temperature ?? defaultTemperature,
      isY2,
      yUnitSymbol: isY2 ? (y2UnitSymbol || yUnitSymbol) : yUnitSymbol,
    });
  });

  const hasY2Series = seriesList.some((series) => series.isY2);
  const y2PointStats = hasY2Series
    ? computePointStats(
        seriesList
          .filter((series) => series.isY2)
          .flatMap((series) => series.points)
      )
    : null;

  tc.dataSet.data = seriesList;
  tc.dataSet.type = 'line';
  tc.dataSet.groupCount = 1;
  tc.dataSet.isCustomOrder = validGroups.length > 1;
  tc.dataSet.isRed = true;
  tc.dataSet.decimationCount = '512';
  tc.dataSet.fitPointCount = String(Math.max(...validGroups.map((group) => group.points.length), 1));

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

  applyGraphConfigToTypicalCurve(tc, graphConfig, {
    multipleSeries: validGroups.length > 1,
    hasY2Series,
    y2PointStats,
  });

  return tc;
};

export const inferTypicalCurveExportSource = (dataPoints = []) => {
  if (!dataPoints.length) return 'manual';

  const importedCount = dataPoints.filter((point) => point.imported).length;
  if (importedCount === dataPoints.length) return 'ai';
  if (importedCount > 0) return 'manual_edited';
  return 'manual';
};

export const inferTypicalCurveExportSourceFromCurves = (curves = [], savedSource = '') => {
  if (curves.some((curve) => curve?.locallyModified)) return 'manual_edited';
  if (String(savedSource).toLowerCase() === 'company') return 'ai';
  return 'manual';
};

export const resolveGraphConfigForSavedCurvesExport = (curves = [], graphConfig = {}, options = {}) => {
  const first = curves[0] || {};
  const cfg = first.config || {};
  const persistedAxis = options?.persistedAxis || null;
  const computedAxis = computeAxisBoundsFromCurves(curves);

  const resolved = {
    graphTitle: cfg.graphTitle || first.graph_title || graphConfig.graphTitle || '',
    curveName: cfg.curveName || first.curve_name || first.name || graphConfig.curveName || '',
    xLabel: cfg.xLabel || first.x_label || persistedAxis?.xLabel || graphConfig.xLabel || '',
    yLabel: cfg.yLabel || first.y_label || persistedAxis?.yLabel || graphConfig.yLabel || '',
    xScale: cfg.xScale || first.x_scale || persistedAxis?.xScale || graphConfig.xScale || 'Linear',
    yScale: cfg.yScale || first.y_scale || persistedAxis?.yScale || graphConfig.yScale || 'Linear',
    xUnitPrefix: cfg.xUnitPrefix || first.x_unit || persistedAxis?.xUnitPrefix || graphConfig.xUnitPrefix || '1',
    yUnitPrefix: cfg.yUnitPrefix || first.y_unit || persistedAxis?.yUnitPrefix || graphConfig.yUnitPrefix || '1',
    xMin: pickFirstFiniteAxisValue(cfg.xMin, first.x_min, persistedAxis?.xMin, graphConfig.xMin, computedAxis?.xMin),
    xMax: pickFirstFiniteAxisValue(cfg.xMax, first.x_max, persistedAxis?.xMax, graphConfig.xMax, computedAxis?.xMax),
    yMin: pickFirstFiniteAxisValue(cfg.yMin, first.y_min, persistedAxis?.yMin, graphConfig.yMin, computedAxis?.yMin),
    yMax: pickFirstFiniteAxisValue(cfg.yMax, first.y_max, persistedAxis?.yMax, graphConfig.yMax, computedAxis?.yMax),
    temperature: cfg.temperature || first.temperature || graphConfig.temperature || '',
    y2Label: graphConfig.y2Label || cfg.y2Label || '',
    y2Min: graphConfig.y2Min ?? cfg.y2Min ?? '',
    y2Max: graphConfig.y2Max ?? cfg.y2Max ?? '',
    y2Scale: graphConfig.y2Scale || cfg.y2Scale || 'Linear',
    y2UnitPrefix: graphConfig.y2UnitPrefix || cfg.y2UnitPrefix || '1',
  };

  return resolved;
};

export const resolveExportGraphConfig = (curves = [], graphConfig = {}, options = {}) =>
  resolveGraphConfigForSavedCurvesExport(curves, graphConfig, options);

export const isSavedCurvesExportReady = (curves = [], graphConfig = {}, options = {}) => {
  if (!Array.isArray(curves) || curves.length === 0) return false;
  const exportConfig = resolveExportGraphConfig(curves, graphConfig, options);
  return hasCompleteExportAxis(exportConfig);
};

export const savedCurvesToExportSeries = (curves = []) =>
  (Array.isArray(curves) ? curves : [])
    .map((curve) => {
      const pointList = curve?.points ?? curve?.data_points ?? [];
      const points = pointList
        .map((point) => [Number(point?.x_value ?? point?.x), Number(point?.y_value ?? point?.y)])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .sort((a, b) => a[0] - b[0]);

      return {
        name: String(curve?.config?.curveName || curve?.curve_name || curve?.name || '').trim(),
        points,
        isY2: Boolean(curve?.config?.isY2 || curve?.isY2),
        temperature: parseTemperatureForExport(curve?.config?.temperature ?? curve?.temperature),
      };
    })
    .filter((group) => group.points.length > 0);

export const buildTypicalCurveFilename = (graphConfig, source = 'manual') => {
  const graphName = sanitizeFilenamePart(graphConfig.graphTitle || 'graph');
  const curveName = sanitizeFilenamePart(graphConfig.curveName || 'curve');
  const safeSource = sanitizeFilenamePart(source);
  return `${graphName}-${curveName}-${safeSource}.tc`;
};

export const buildTypicalCurveFilenameForGraph = (graphConfig, source = 'manual', curveCount = 1) => {
  const graphName = sanitizeFilenamePart(graphConfig.graphTitle || 'graph');
  const safeSource = sanitizeFilenamePart(source);
  if (curveCount <= 1) {
    return buildTypicalCurveFilename(graphConfig, source);
  }
  return `${graphName}-all_curves-${safeSource}.tc`;
};

export const buildTypicalCurveExport = ({ template, graphConfig, dataPoints }) => {
  const groupedPoints = groupPointsForExport(dataPoints);
  const defaultTemperature = parseTemperatureForExport(graphConfig.temperature);
  const seriesGroups = groupedPoints.map((group, index) => ({
    ...group,
    name:
      group.name ||
      (groupedPoints.length === 1
        ? String(graphConfig.curveName || '').trim()
        : `data${index}`),
    temperature: group.temperature ?? defaultTemperature,
  }));

  return buildTypicalCurveExportCore({ template, graphConfig, seriesGroups });
};

export const buildTypicalCurveExportFromSavedCurves = ({ template, graphConfig, curves }) => {
  const seriesGroups = savedCurvesToExportSeries(curves);
  if (seriesGroups.length === 0) {
    throw new Error('No saved curve points to export');
  }

  return buildTypicalCurveExportCore({
    template,
    graphConfig,
    seriesGroups,
  });
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

const formatSavedCurveExportValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (Math.abs(num) > 0 && Math.abs(num) < 0.0001) {
    return num.toExponential(4);
  }
  return String(num);
};

const getSavedCurveExportPoints = (curve = {}) =>
  (Array.isArray(curve?.points) ? curve.points : Array.isArray(curve?.data_points) ? curve.data_points : [])
    .map((point) => ({
      x: Number(point?.x_value ?? point?.x),
      y: Number(point?.y_value ?? point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

const getSavedCurveDisplayName = (curve, index = 0) =>
  String(curve?.config?.curveName || curve?.curve_name || curve?.name || '').trim() ||
  `Series ${index + 1}`;

const buildSavedCurveExportMetadata = (curve, graphConfig = {}, options = {}) => {
  const exportConfig = resolveExportGraphConfig([curve], graphConfig, options);
  return {
    graphTitle: exportConfig.graphTitle || '',
    curveName: exportConfig.curveName || '',
    xScale: exportConfig.xScale || 'Linear',
    yScale: exportConfig.yScale || 'Linear',
    xUnitPrefix: exportConfig.xUnitPrefix || '1',
    yUnitPrefix: exportConfig.yUnitPrefix || '1',
    xMin: formatSavedCurveExportValue(exportConfig.xMin),
    xMax: formatSavedCurveExportValue(exportConfig.xMax),
    yMin: formatSavedCurveExportValue(exportConfig.yMin),
    yMax: formatSavedCurveExportValue(exportConfig.yMax),
    temperature: exportConfig.temperature || '',
    exportedAt: new Date().toISOString(),
  };
};

const buildSavedGraphExportMetadata = (curves = [], graphConfig = {}, options = {}) => {
  const exportConfig = resolveExportGraphConfig(curves, graphConfig, options);
  return {
    graphTitle: exportConfig.graphTitle || '',
    curveCount: curves.length,
    xScale: exportConfig.xScale || 'Linear',
    yScale: exportConfig.yScale || 'Linear',
    xUnitPrefix: exportConfig.xUnitPrefix || '1',
    yUnitPrefix: exportConfig.yUnitPrefix || '1',
    xMin: formatSavedCurveExportValue(exportConfig.xMin),
    xMax: formatSavedCurveExportValue(exportConfig.xMax),
    yMin: formatSavedCurveExportValue(exportConfig.yMin),
    yMax: formatSavedCurveExportValue(exportConfig.yMax),
    exportedAt: new Date().toISOString(),
  };
};

const mapSavedCurvePointsForJsonExport = (points) =>
  points.map((point, index) => ({
    index: index + 1,
    x: formatSavedCurveExportValue(point.x),
    y: formatSavedCurveExportValue(point.y),
  }));

export const buildSavedCurveCsvExport = (curve, graphConfig = {}, options = {}) => {
  const points = getSavedCurveExportPoints(curve);
  if (points.length === 0) {
    throw new Error('No points to export.');
  }

  const meta = buildSavedCurveExportMetadata(curve, graphConfig, options);
  const metaRows = [
    ['# Graph Title', meta.graphTitle],
    ['# Curve Name', meta.curveName],
    ['# X Scale', meta.xScale],
    ['# Y Scale', meta.yScale],
    ['# X Unit Prefix', meta.xUnitPrefix],
    ['# Y Unit Prefix', meta.yUnitPrefix],
    ['# X Min', meta.xMin],
    ['# X Max', meta.xMax],
    ['# Y Min', meta.yMin],
    ['# Y Max', meta.yMax],
    ['# Temperature', meta.temperature],
    ['# Exported At', meta.exportedAt],
    [''],
  ];
  const header = ['Index', 'X', 'Y'];
  const rows = points.map((point, index) => [
    String(index + 1),
    formatSavedCurveExportValue(point.x),
    formatSavedCurveExportValue(point.y),
  ]);

  return [...metaRows, header, ...rows].map((row) => row.join(',')).join('\n');
};

export const buildSavedCurveJsonExport = (curve, graphConfig = {}, options = {}) => {
  const points = getSavedCurveExportPoints(curve);
  if (points.length === 0) {
    throw new Error('No points to export.');
  }

  const metadata = buildSavedCurveExportMetadata(curve, graphConfig, options);
  return JSON.stringify(
    {
      metadata,
      points: mapSavedCurvePointsForJsonExport(points),
    },
    null,
    2
  );
};

export const buildSavedCurvesCombinedCsvExport = (curves = [], graphConfig = {}, options = {}) => {
  const curveList = (Array.isArray(curves) ? curves : []).filter(Boolean);
  const sections = curveList
    .map((curve, index) => {
      const points = getSavedCurveExportPoints(curve);
      if (points.length === 0) return null;
      const meta = buildSavedCurveExportMetadata(curve, graphConfig, options);
      return {
        name: getSavedCurveDisplayName(curve, index),
        temperature: meta.temperature || '',
        points,
      };
    })
    .filter(Boolean);

  if (sections.length === 0) {
    throw new Error('No points to export.');
  }

  const graphMeta = buildSavedGraphExportMetadata(curveList, graphConfig, options);
  const graphMetaRows = [
    ['# Graph Title', graphMeta.graphTitle],
    ['# Curve Count', String(graphMeta.curveCount)],
    ['# X Scale', graphMeta.xScale],
    ['# Y Scale', graphMeta.yScale],
    ['# X Unit Prefix', graphMeta.xUnitPrefix],
    ['# Y Unit Prefix', graphMeta.yUnitPrefix],
    ['# X Min', graphMeta.xMin],
    ['# X Max', graphMeta.xMax],
    ['# Y Min', graphMeta.yMin],
    ['# Y Max', graphMeta.yMax],
    ['# Exported At', graphMeta.exportedAt],
    [''],
  ];

  const sectionRows = sections.flatMap((section) => {
    const rows = [
      ['# Curve', section.name],
      ['# Temperature', section.temperature],
      [''],
      ['Index', 'X', 'Y'],
      ...section.points.map((point, index) => [
        String(index + 1),
        formatSavedCurveExportValue(point.x),
        formatSavedCurveExportValue(point.y),
      ]),
      [''],
    ];
    return rows;
  });

  return [...graphMetaRows, ...sectionRows].map((row) => row.join(',')).join('\n');
};

export const buildSavedCurvesCombinedJsonExport = (curves = [], graphConfig = {}, options = {}) => {
  const curveList = (Array.isArray(curves) ? curves : []).filter(Boolean);
  const exportedCurves = curveList
    .map((curve, index) => {
      const points = getSavedCurveExportPoints(curve);
      if (points.length === 0) return null;
      const meta = buildSavedCurveExportMetadata(curve, graphConfig, options);
      return {
        name: getSavedCurveDisplayName(curve, index),
        temperature: meta.temperature || '',
        points: mapSavedCurvePointsForJsonExport(points),
      };
    })
    .filter(Boolean);

  if (exportedCurves.length === 0) {
    throw new Error('No points to export.');
  }

  return JSON.stringify(
    {
      metadata: buildSavedGraphExportMetadata(curveList, graphConfig, options),
      curves: exportedCurves,
    },
    null,
    2
  );
};

export const buildSavedCurveComparisonFilename = (curve, graphConfig = {}, options = {}, extension = 'csv') => {
  const exportConfig = resolveExportGraphConfig([curve], graphConfig, options);
  const graphName = sanitizeFilenamePart(exportConfig.graphTitle || 'graph');
  const curveName = sanitizeFilenamePart(exportConfig.curveName || 'curve');
  const safeExtension = String(extension || 'csv').replace(/^\./, '');
  return `${graphName}-${curveName}.${safeExtension}`;
};

export const buildSavedGraphComparisonFilename = (curves = [], graphConfig = {}, options = {}, extension = 'csv') => {
  const curveList = Array.isArray(curves) ? curves.filter(Boolean) : [];
  const exportConfig = resolveExportGraphConfig(curveList, graphConfig, options);
  const graphName = sanitizeFilenamePart(exportConfig.graphTitle || 'graph');
  const safeExtension = String(extension || 'csv').replace(/^\./, '');
  if (curveList.length <= 1) {
    const curveName = sanitizeFilenamePart(exportConfig.curveName || 'curve');
    return `${graphName}-${curveName}.${safeExtension}`;
  }
  return `${graphName}-all_curves.${safeExtension}`;
};

export const downloadTextExportFile = (filename, content, mimeType = 'text/plain;charset=utf-8;') => {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.visibility = 'hidden';
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
};

const queueTextExportDownloads = (downloads = [], delayMs = 200) => {
  downloads.forEach((item, index) => {
    const run = () => downloadTextExportFile(item.filename, item.content, item.mimeType);
    if (index === 0 || downloads.length === 1) {
      run();
      return;
    }
    window.setTimeout(run, index * delayMs);
  });
};

export const exportSavedCurvesToCsv = (curves = [], graphConfig = {}, options = {}) => {
  const curveList = Array.isArray(curves) ? curves.filter(Boolean) : [];
  if (curveList.length === 0) {
    throw new Error('No saved curves to export.');
  }

  const downloads = curveList.map((curve) => ({
    filename: buildSavedCurveComparisonFilename(curve, graphConfig, options, 'csv'),
    content: buildSavedCurveCsvExport(curve, graphConfig, options),
    mimeType: 'text/csv;charset=utf-8;',
  }));

  if (curveList.length > 1) {
    downloads.push({
      filename: buildSavedGraphComparisonFilename(curveList, graphConfig, options, 'csv'),
      content: buildSavedCurvesCombinedCsvExport(curveList, graphConfig, options),
      mimeType: 'text/csv;charset=utf-8;',
    });
  }

  queueTextExportDownloads(downloads);
};

export const exportSavedCurvesToJson = (curves = [], graphConfig = {}, options = {}) => {
  const curveList = Array.isArray(curves) ? curves.filter(Boolean) : [];
  if (curveList.length === 0) {
    throw new Error('No saved curves to export.');
  }

  const downloads = curveList.map((curve) => ({
    filename: buildSavedCurveComparisonFilename(curve, graphConfig, options, 'json'),
    content: buildSavedCurveJsonExport(curve, graphConfig, options),
    mimeType: 'application/json;charset=utf-8;',
  }));

  if (curveList.length > 1) {
    downloads.push({
      filename: buildSavedGraphComparisonFilename(curveList, graphConfig, options, 'json'),
      content: buildSavedCurvesCombinedJsonExport(curveList, graphConfig, options),
      mimeType: 'application/json;charset=utf-8;',
    });
  }

  queueTextExportDownloads(downloads);
};

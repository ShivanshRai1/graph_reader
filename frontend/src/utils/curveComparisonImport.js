import { parseTypicalCurveFile } from './tcImport';

const parseAxisNumber = (value, fallback = NaN) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePoints = (points) =>
  (Array.isArray(points) ? points : [])
    .map((point) => {
      if (Array.isArray(point)) {
        return { x: Number(point[0]), y: Number(point[1]) };
      }
      return { x: Number(point?.x), y: Number(point?.y) };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

const inferBoundsFromCurves = (curves) => {
  const xs = [];
  const ys = [];
  curves.forEach((curve) => {
    curve.points.forEach((point) => {
      xs.push(point.x);
      ys.push(point.y);
    });
  });
  if (xs.length === 0 || ys.length === 0) {
    return { xMin: '0', xMax: '1', yMin: '0', yMax: '1' };
  }
  return {
    xMin: String(Math.min(...xs)),
    xMax: String(Math.max(...xs)),
    yMin: String(Math.min(...ys)),
    yMax: String(Math.max(...ys)),
  };
};

const buildConfig = (meta = {}, curves = []) => {
  const bounds = inferBoundsFromCurves(curves);
  const xMin = meta.xMin !== undefined && meta.xMin !== '' ? String(meta.xMin) : bounds.xMin;
  const xMax = meta.xMax !== undefined && meta.xMax !== '' ? String(meta.xMax) : bounds.xMax;
  const yMin = meta.yMin !== undefined && meta.yMin !== '' ? String(meta.yMin) : bounds.yMin;
  const yMax = meta.yMax !== undefined && meta.yMax !== '' ? String(meta.yMax) : bounds.yMax;

  return {
    graphTitle: meta.graphTitle || meta.title || 'Captured curve',
    xMin,
    xMax,
    yMin,
    yMax,
    xLabel: meta.xLabel || 'X',
    yLabel: meta.yLabel || 'Y',
    xScale: meta.xScale === 'Logarithmic' ? 'Logarithmic' : 'Linear',
    yScale: meta.yScale === 'Logarithmic' ? 'Logarithmic' : 'Linear',
    curveName: meta.curveName || '',
  };
};

const buildParsedResult = (config, curves, raw, format) => {
  const plottableCurves = curves
    .map((curve, index) => ({
      id: curve.id || `${format}-${index}`,
      name: curve.name || `Series ${index + 1}`,
      points: normalizePoints(curve.points),
      config: {
        ...config,
        curveName: curve.name || config.curveName || `Series ${index + 1}`,
      },
    }))
    .filter((curve) => curve.points.length > 0);

  if (plottableCurves.length === 0) {
    throw new Error('No plottable points found in file.');
  }

  return {
    config,
    curves: plottableCurves,
    raw,
    format,
  };
};

const parseCsvPointRows = (dataRows) => {
  if (dataRows.length === 0) {
    throw new Error('Invalid CSV file: no data rows found.');
  }

  const headerValues = dataRows[0].split(',').map((value) => value.trim());
  const headerLower = headerValues.map((value) => value.toLowerCase());
  let xIndex = headerLower.indexOf('x');
  let yIndex = headerLower.indexOf('y');
  let startIndex = 0;

  if (xIndex >= 0 && yIndex >= 0) {
    startIndex = 1;
  } else if (headerValues.length >= 3) {
    const firstCol = headerLower[0];
    const indexCol =
      firstCol === '#' || firstCol === 'index' || firstCol === '' || firstCol === 'no' || firstCol === 'num';
    const n0 = parseFloat(headerValues[0]);
    const n1 = parseFloat(headerValues[1]);
    const n2 = parseFloat(headerValues[2]);
    const looksLikeIndexRow =
      Number.isFinite(n0) &&
      Number.isFinite(n1) &&
      Number.isFinite(n2) &&
      Math.abs(n0 - Math.round(n0)) < 1e-9 &&
      n0 > 0 &&
      n1 !== n0;

    if (indexCol) {
      xIndex = 1;
      yIndex = 2;
      startIndex = 1;
    } else if (looksLikeIndexRow) {
      xIndex = 1;
      yIndex = 2;
      startIndex = 0;
    } else {
      xIndex = 0;
      yIndex = 1;
      const firstX = parseFloat(headerValues[0]);
      const firstY = parseFloat(headerValues[1]);
      if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) {
        throw new Error('Invalid CSV file: expected numeric X and Y columns.');
      }
      startIndex = 0;
    }
  } else {
    xIndex = 0;
    yIndex = 1;
    const firstX = parseFloat(headerValues[0]);
    const firstY = parseFloat(headerValues[1]);
    if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) {
      throw new Error('Invalid CSV file: expected numeric X and Y columns.');
    }
    startIndex = 0;
  }

  const points = [];
  for (let i = startIndex; i < dataRows.length; i += 1) {
    const values = dataRows[i].split(',').map((value) => value.trim());
    if (values.length <= Math.max(xIndex, yIndex)) continue;
    const x = parseFloat(values[xIndex]);
    const y = parseFloat(values[yIndex]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }

  if (points.length === 0) {
    throw new Error('Invalid CSV file: no numeric X/Y points found.');
  }

  return points;
};

const parseGraphCaptureMultiCurveCsv = (content) => {
  const lines = String(content || '').split(/\r?\n/);
  const graphMeta = {};
  const curveSections = [];
  let currentCurveName = '';
  let currentCurveMeta = {};
  let currentDataRows = [];

  const flushCurveSection = () => {
    if (currentDataRows.length === 0) return;
    const points = parseCsvPointRows(currentDataRows);
    curveSections.push({
      name: currentCurveName || graphMeta['Curve Name'] || 'Captured curve',
      points,
    });
    currentCurveMeta = {};
    currentDataRows = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#')) {
      const withoutHash = trimmed.replace(/^#\s*/, '');
      const commaIndex = withoutHash.indexOf(',');
      if (commaIndex === -1) return;
      const key = withoutHash.slice(0, commaIndex).trim();
      const value = withoutHash.slice(commaIndex + 1).trim();

      if (key === 'Curve') {
        flushCurveSection();
        currentCurveName = value;
        return;
      }

      if (currentCurveName) {
        currentCurveMeta[key] = value;
      } else if (key) {
        graphMeta[key] = value;
      }
      return;
    }

    currentDataRows.push(trimmed);
  });

  flushCurveSection();

  if (curveSections.length === 0) {
    throw new Error('Invalid CSV file: no curve sections found.');
  }

  const config = buildConfig(
    {
      graphTitle: graphMeta['Graph Title'] || graphMeta.graphTitle,
      xScale: graphMeta['X Scale'] || graphMeta.xScale,
      yScale: graphMeta['Y Scale'] || graphMeta.yScale,
      xMin: graphMeta['X Min'] || graphMeta.xMin,
      xMax: graphMeta['X Max'] || graphMeta.xMax,
      yMin: graphMeta['Y Min'] || graphMeta.yMin,
      yMax: graphMeta['Y Max'] || graphMeta.yMax,
    },
    curveSections
  );

  return buildParsedResult(
    config,
    curveSections.map((section) => ({
      name: section.name,
      points: section.points,
    })),
    content,
    'csv'
  );
};

const parseGraphCaptureCsv = (content) => {
  const lines = String(content || '').split(/\r?\n/);
  const hasCurveSections = lines.some((line) => /^#\s*Curve\s*,/i.test(line.trim()));
  const curveCount = (() => {
    const countLine = lines.find((line) => /^#\s*Curve Count\s*,/i.test(line.trim()));
    if (!countLine) return null;
    const value = countLine.replace(/^#\s*Curve Count\s*,/i, '').trim();
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  if (hasCurveSections || (curveCount !== null && curveCount > 1)) {
    return parseGraphCaptureMultiCurveCsv(content);
  }

  const meta = {};
  const dataRows = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#')) {
      const withoutHash = trimmed.replace(/^#\s*/, '');
      const commaIndex = withoutHash.indexOf(',');
      if (commaIndex === -1) return;
      const key = withoutHash.slice(0, commaIndex).trim();
      const value = withoutHash.slice(commaIndex + 1).trim();
      if (key) meta[key] = value;
      return;
    }

    dataRows.push(trimmed);
  });

  const points = parseCsvPointRows(dataRows);
  const config = buildConfig(
    {
      graphTitle: meta['Graph Title'] || meta.graphTitle,
      curveName: meta['Curve Name'] || meta.curveName,
      xScale: meta['X Scale'] || meta.xScale,
      yScale: meta['Y Scale'] || meta.yScale,
      xMin: meta['X Min'] || meta.xMin,
      xMax: meta['X Max'] || meta.xMax,
      yMin: meta['Y Min'] || meta.yMin,
      yMax: meta['Y Max'] || meta.yMax,
    },
    [{ points }]
  );

  return buildParsedResult(
    config,
    [{ name: config.curveName || 'Captured curve', points }],
    content,
    'csv'
  );
};

const parseGraphCaptureJson = (data) => {
  const metadata = data?.metadata || {};

  if (Array.isArray(data?.curves) && data.curves.length > 0) {
    const curves = data.curves
      .map((curve, index) => {
        const points = normalizePoints(curve?.points);
        if (points.length === 0) return null;
        return {
          name: String(curve?.name || `Series ${index + 1}`).trim() || `Series ${index + 1}`,
          points,
        };
      })
      .filter(Boolean);

    if (curves.length === 0) {
      throw new Error('Invalid JSON file: no points found in curves.');
    }

    const config = buildConfig(
      {
        graphTitle: metadata.graphTitle,
        xScale: metadata.xScale,
        yScale: metadata.yScale,
        xMin: metadata.xMin,
        xMax: metadata.xMax,
        yMin: metadata.yMin,
        yMax: metadata.yMax,
      },
      curves
    );

    return buildParsedResult(config, curves, data, 'json');
  }

  const points = normalizePoints(data?.points);
  if (points.length === 0) {
    throw new Error('Invalid JSON file: no points found.');
  }

  const config = buildConfig(
    {
      graphTitle: metadata.graphTitle,
      curveName: metadata.curveName,
      xScale: metadata.xScale,
      yScale: metadata.yScale,
      xMin: metadata.xMin,
      xMax: metadata.xMax,
      yMin: metadata.yMin,
      yMax: metadata.yMax,
    },
    [{ points }]
  );

  return buildParsedResult(
    config,
    [{ name: metadata.curveName || config.graphTitle || 'Captured curve', points }],
    data,
    'json'
  );
};

const parseSimpleJsonArray = (data) => {
  const points = normalizePoints(data);
  if (points.length === 0) {
    throw new Error('Invalid JSON file: array must contain numeric x/y points.');
  }

  const config = buildConfig({}, [{ points }]);
  return buildParsedResult(config, [{ name: 'Series 1', points }], data, 'json');
};

const parseCurveSummaryEntry = (entry) => {
  const summary = entry?.curveSummary;
  const seriesList = Array.isArray(summary?.series) ? summary.series : [];
  const plottableSeries = seriesList.filter(
    (series) => Array.isArray(series?.data) && series.data.length > 0
  );

  if (plottableSeries.length === 0) {
    return null;
  }

  const xAxis = summary?.xAxis || {};
  const yAxis = Array.isArray(summary?.yAxes) ? summary.yAxes[0] : summary?.yAxis || {};

  const config = buildConfig(
    {
      title: entry?.title,
      graphTitle: entry?.title || (entry?.figure ? `Figure ${entry.figure}` : 'Typical curve'),
      xLabel: xAxis.label || 'X',
      yLabel: yAxis.label || 'Y',
      xMin: xAxis.min,
      xMax: xAxis.max,
      yMin: yAxis.min,
      yMax: yAxis.max,
    },
    plottableSeries.map((series) => ({ points: series.data }))
  );

  const curves = plottableSeries.map((series, index) => ({
    name: series.name || `Series ${index + 1}`,
    points: series.data,
  }));

  return buildParsedResult(config, curves, entry, 'jsonld');
};

const collectJsonLdPlotCandidates = (data) => {
  const plots = [];
  const seen = new Set();

  const addEntry = (entry, index) => {
    const parsed = parseCurveSummaryEntry(entry);
    if (!parsed) return;

    const figure = entry?.figure;
    const title = String(entry?.title || '').trim();
    const id = figure !== undefined && figure !== null
      ? `figure-${figure}`
      : `plot-${index}-${title || plots.length}`;

    if (seen.has(id)) return;
    seen.add(id);

    plots.push({
      id,
      label: figure !== undefined && figure !== null
        ? `Figure ${figure}${title ? `: ${title}` : ''}`
        : (title || `Plot ${plots.length + 1}`),
      parsed,
    });
  };

  if (Array.isArray(data?.typicalPerformanceData)) {
    data.typicalPerformanceData.forEach((entry, index) => addEntry(entry, index));
  }

  if (plots.length === 0 && data?.curveSummary) {
    const parsed = parseCurveSummaryEntry(data);
    if (parsed) {
      plots.push({
        id: 'root-plot',
        label: data.title || data.graphTitle || 'Plot 1',
        parsed,
      });
    }
  }

  return plots;
};

const isTypicalCurveJson = (data) =>
  Boolean(data && typeof data === 'object' && Array.isArray(data?.dataSet?.data));

const parseJsonLikeContent = (content, filename) => {
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON format: ${error.message}`);
  }

  if (isTypicalCurveJson(data)) {
    return { type: 'parsed', parsed: { ...parseTypicalCurveFile(data), format: 'tc' } };
  }

  if (data?.metadata && Array.isArray(data?.points)) {
    return { type: 'parsed', parsed: parseGraphCaptureJson(data) };
  }

  if (data?.metadata && Array.isArray(data?.curves)) {
    return { type: 'parsed', parsed: parseGraphCaptureJson(data) };
  }

  if (Array.isArray(data)) {
    return { type: 'parsed', parsed: parseSimpleJsonArray(data) };
  }

  const jsonLdPlots = collectJsonLdPlotCandidates(data);
  if (jsonLdPlots.length > 0) {
    if (jsonLdPlots.length === 1) {
      return { type: 'parsed', parsed: jsonLdPlots[0].parsed };
    }
    return {
      type: 'plotSelection',
      filename,
      plots: jsonLdPlots,
    };
  }

  throw new Error(
    'Unsupported JSON/JSON-LD structure. Expected .tc JSON, Graph Capture export, point array, or datasheet plot data.'
  );
};

export const parseComparisonFileContent = (content, filename = '') => {
  const lowerName = String(filename || '').trim().toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.split('.').pop() : '';

  if (extension === 'csv') {
    return { type: 'parsed', parsed: parseGraphCaptureCsv(content) };
  }

  if (extension === 'tc') {
    return { type: 'parsed', parsed: { ...parseTypicalCurveFile(content), format: 'tc' } };
  }

  if (extension === 'json' || extension === 'jsonld' || extension === 'ld') {
    return parseJsonLikeContent(content, filename);
  }

  const trimmed = String(content || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJsonLikeContent(content, filename);
  }

  if (trimmed.includes(',') && !trimmed.startsWith('{')) {
    return { type: 'parsed', parsed: parseGraphCaptureCsv(content) };
  }

  throw new Error(`Unsupported file type: ${filename || 'unknown file'}`);
};

export const readComparisonCurveFile = (file, selectedPlotId = null) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseComparisonFileContent(reader.result, file.name);
        if (result.type === 'plotSelection') {
          if (!selectedPlotId) {
            resolve(result);
            return;
          }
          const selected = result.plots.find((plot) => plot.id === selectedPlotId);
          if (!selected) {
            reject(new Error('Selected plot was not found in JSON-LD file.'));
            return;
          }
          resolve({ type: 'parsed', parsed: selected.parsed });
          return;
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });

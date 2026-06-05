/**
 * Build LT7153pdp-datasheet-by-discoveree.jsonld from Graph Capture .tc exports only.
 * Does not modify frontend app code. Safe to run anytime.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const LT7153_DIR = path.join(REPO_ROOT, 'LT7153');
const TEMPLATE_PATH = path.join(LT7153_DIR, 'LT7153pdp.datasheet-template.jsonld');
const FIGURE_MAP_PATH = path.join(LT7153_DIR, 'figure-map.json');
const OUTPUT_PATH = path.join(LT7153_DIR, 'LT7153pdp-datasheet-by-discoveree.jsonld');

const normalizeSeriesNameForMatch = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');

const canonicalSeriesName = (name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const voutMatch = trimmed.match(/^vout\s*=\s*([\d.]+)\s*v?\s*$/i);
  if (voutMatch) return `VOUT=${voutMatch[1]}V`;
  return trimmed;
};

const parseAxisNumber = (value, fallback = NaN) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readAxisTitle = (axisBlock) => {
  const parts = axisBlock?.title?.text;
  if (!Array.isArray(parts)) return '';
  return parts.map((line) => String(line || '').trim()).filter(Boolean).join(' ');
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const parseTypicalCurveFile = (raw) => {
  const tc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!tc || typeof tc !== 'object') {
    throw new Error('Invalid .tc file: expected JSON object.');
  }

  const dataSet = tc.dataSet;
  const seriesList = Array.isArray(dataSet?.data) ? dataSet.data : [];
  if (seriesList.length === 0) {
    throw new Error('Invalid .tc file: no curves in dataSet.data.');
  }

  const titleParts = tc.title?.text;
  const graphTitle = Array.isArray(titleParts)
    ? titleParts.map((line) => String(line || '').trim()).filter(Boolean).join(' ')
    : '';

  const xMin = parseAxisNumber(tc.xAxis?.scale?.min, parseAxisNumber(dataSet.minX, 0));
  const xMax = parseAxisNumber(tc.xAxis?.scale?.max, parseAxisNumber(dataSet.maxX, 1));
  const yMin = parseAxisNumber(tc.yAxis?.scale?.min, parseAxisNumber(dataSet.minY, 0));
  const yMax = parseAxisNumber(tc.yAxis?.scale?.max, parseAxisNumber(dataSet.maxY, 1));

  const xLabel = readAxisTitle(tc.xAxis) || 'X';
  const yLabel = readAxisTitle(tc.yAxis) || 'Y';

  const curves = seriesList
    .filter((series) => series?.isVisible !== false)
    .map((series, index) => {
      const rawPoints = Array.isArray(series.points) ? series.points : [];
      const points = rawPoints
        .map(([x, y]) => [Number(x), Number(y)])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .sort((a, b) => a[0] - b[0]);

      const name = canonicalSeriesName(series.name) || String(series.name || `Series ${index + 1}`).trim();

      return { name, points, groupId: index };
    })
    .filter((curve) => curve.points.length > 0);

  if (curves.length === 0) {
    throw new Error('Invalid .tc file: no plottable points.');
  }

  return {
    graphTitle,
    xLabel,
    yLabel,
    xMin,
    xMax,
    yMin,
    yMax,
    curves,
  };
};

const isGenericDataSeriesName = (name) => /^data\d+$/i.test(String(name || '').trim());

const extractVoltageKey = (name) => {
  const match = String(name || '').match(/([\d.]+)\s*v\b/i);
  return match ? match[1] : '';
};

const extractTcSeries = (parsed) =>
  parsed.curves.map((curve) => ({
    name: curve.name,
    data: curve.points,
  }));

const seriesNamesMatch = (templateName, tcName) =>
  normalizeSeriesNameForMatch(templateName) === normalizeSeriesNameForMatch(tcName);

/** Set series data from .tc capture; update name only when it differs from the matched .tc curve. */
const assignSeriesFromTc = (series, tcMatch) => {
  const next = deepClone(series);
  if (!tcMatch?.data?.length) {
    next.data = [];
    return next;
  }

  next.data = tcMatch.data;
  if (!seriesNamesMatch(series.name, tcMatch.name)) {
    next.name = tcMatch.name;
  }
  return next;
};

/** Uncaptured figures: clear tc link and blank every series `data` array only. */
const blankUncapturedData = (entry) => {
  if ('tcFileUrl' in entry) entry.tcFileUrl = '';

  if (!entry.curveSummary || !Array.isArray(entry.curveSummary.series)) return;

  entry.curveSummary.series = entry.curveSummary.series.map((series) => {
    const next = deepClone(series);
    next.data = [];
    return next;
  });
};

/** Update series[].data from .tc; set series.name only when it differs from the matched .tc curve. */
const applySeriesDataFromTc = (templateSeries, tcSeries) => {
  const tcByName = new Map();
  tcSeries.forEach((series) => {
    const key = normalizeSeriesNameForMatch(series.name);
    if (key && !tcByName.has(key)) tcByName.set(key, series);
  });
  const tcByVoltage = new Map();
  tcSeries.forEach((series) => {
    const voltageKey = extractVoltageKey(series.name);
    if (voltageKey && !tcByVoltage.has(voltageKey)) {
      tcByVoltage.set(voltageKey, series);
    }
  });
  const tcGeneric =
    tcSeries.length > 0 && tcSeries.every((series) => isGenericDataSeriesName(series.name));

  const resolveTcMatch = (series, index) => {
    if (tcGeneric && tcSeries[index]) return tcSeries[index];

    const key = normalizeSeriesNameForMatch(series.name);
    if (key && tcByName.has(key)) return tcByName.get(key);

    const voltageKey = extractVoltageKey(series.name);
    if (voltageKey && tcByVoltage.has(voltageKey)) return tcByVoltage.get(voltageKey);

    return null;
  };

  const mapByNameOrVoltage = () =>
    templateSeries.map((series, index) => assignSeriesFromTc(series, resolveTcMatch(series, index)));

  let mapped = mapByNameOrVoltage();
  const matchedPoints = mapped.reduce((sum, series) => sum + (series.data?.length || 0), 0);

  if (matchedPoints === 0 && tcSeries.length === templateSeries.length) {
    mapped = templateSeries.map((series, index) => assignSeriesFromTc(series, tcSeries[index] || null));
  }

  return mapped;
};

const isSafeTcFilename = (filename) => {
  const name = String(filename || '').trim();
  if (!name.toLowerCase().endsWith('.tc')) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return /^[^\\/]+\.tc$/i.test(name);
};

const buildTcFileUrl = (baseUrl, filename) => {
  if (!isSafeTcFilename(filename)) return '';
  const base = String(baseUrl || '').trim();
  if (!base.startsWith('https://') && !base.startsWith('http://')) return '';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${filename}`;
};

const mergeCapturedIntoEntry = (entry, parsed, tcFileUrl = '') => {
  if (tcFileUrl) entry.tcFileUrl = tcFileUrl;

  if (!entry.curveSummary || !Array.isArray(entry.curveSummary.series)) return;

  const tcSeries = extractTcSeries(parsed);
  entry.curveSummary.series = applySeriesDataFromTc(entry.curveSummary.series, tcSeries);
};

const normalizeForMatch = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');

const fileMatchesFigure = (filename, patterns) => {
  const normalized = normalizeForMatch(filename);
  return patterns.some((pattern) => normalized.includes(normalizeForMatch(pattern)));
};

const loadFigureTcMap = (capturedDir, figurePatterns) => {
  const map = new Map();

  if (!fs.existsSync(capturedDir)) {
    return map;
  }

  const files = fs.readdirSync(capturedDir).filter((name) => name.toLowerCase().endsWith('.tc'));
  const usedFiles = new Set();

  const figureKeys = Object.keys(figurePatterns).sort((a, b) => Number(a) - Number(b));

  for (const figureKey of figureKeys) {
    const figure = Number(figureKey);
    const patterns = figurePatterns[figureKey];
    const match = files.find(
      (name) => !usedFiles.has(name) && fileMatchesFigure(name, patterns)
    );
    if (!match) continue;

    const fullPath = path.join(capturedDir, match);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      map.set(figure, { parsed: parseTypicalCurveFile(raw), filename: match });
      usedFiles.add(match);
      console.log(`  Figure ${figure}: ${match} (${map.get(figure).parsed.curves.length} series)`);
    } catch (err) {
      console.warn(`  Figure ${figure}: skipped ${match} — ${err.message}`);
    }
  }

  const unused = files.filter((name) => !usedFiles.has(name));
  if (unused.length > 0) {
    console.warn(`  Unmatched .tc files (check figure-map.json): ${unused.join(', ')}`);
  }

  return map;
};

const main = () => {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Template missing: ${TEMPLATE_PATH}`);
    console.error('Copy LT7153pdp-datasheet-by-discoveree.jsonld to that path first.');
    process.exit(1);
  }

  const figureMap = JSON.parse(fs.readFileSync(FIGURE_MAP_PATH, 'utf8'));
  const capturedDir = path.join(LT7153_DIR, figureMap.capturedDir || 'captured');
  const tcFileBaseUrl = figureMap.tcFileBaseUrl || 'https://www.discoveree.io/jsonld/analog/LT7153/';
  const tcFileUrlOverrides = figureMap.tcFileUrlOverrides || {};
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

  if (!Array.isArray(template.typicalPerformanceData)) {
    console.error('Template has no typicalPerformanceData array.');
    process.exit(1);
  }

  console.log(`Reading captures from: ${capturedDir}`);
  const figureTcMap = loadFigureTcMap(capturedDir, figureMap.tcFilePatterns || {});

  let filled = 0;
  let blanked = 0;

  const output = deepClone(template);

  output.typicalPerformanceData = template.typicalPerformanceData.map((entry) => {
    const nextEntry = deepClone(entry);
    const figure = entry.figure;
    const capture = figureTcMap.get(figure);

    if (capture) {
      const urlFilename = tcFileUrlOverrides[String(figure)] || capture.filename;
      const tcFileUrl = buildTcFileUrl(tcFileBaseUrl, urlFilename);
      mergeCapturedIntoEntry(nextEntry, capture.parsed, tcFileUrl);
      filled += 1;
    } else {
      blankUncapturedData(nextEntry);
      blanked += 1;
    }

    return nextEntry;
  });

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`Wrote: ${OUTPUT_PATH}`);
  const withUrls = output.typicalPerformanceData.filter((e) => String(e.tcFileUrl || '').trim()).length;
  console.log(`  Captured figures: ${filled}`);
  console.log(`  Blank figures:    ${blanked}`);
  console.log(`  tcFileUrl set:    ${withUrls}`);
};

main();

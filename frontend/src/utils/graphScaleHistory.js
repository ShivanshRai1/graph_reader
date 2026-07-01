import {
  hasCompleteAxisFields,
  resolveDiscovereeAxisFields,
} from './aiCurveProcessing';
import { detectGraphScalePattern } from './graphScalePatterns';

const COMPANY_GRAPH_CAPTURE_API_URL = 'https://www.discoveree.io/graph_capture_api.php';
const MIN_SAMPLES = 2;
const MAJORITY_RATIO = 0.7;
const UNIT_MAJORITY_RATIO = 0.6;
const MAX_COMPANY_GRAPHS = 8;
const COMPANY_FETCH_TIMEOUT_MS = 20000;

const PATTERN_SEARCH_KEYWORDS = {
  capacitance_vs_vr: ['capacitance'],
  gate_charge_vs_vgs: ['gate charge', 'qg'],
  forward_if_vs_vf: ['forward', 'if vs vf'],
  output_iv: ['output', 'transfer'],
  rds_on_vs_vgs: ['rds', 'on-resistance'],
  safe_operating_area: ['soa', 'safe operating'],
};

const buildScaleSuggestionsUrl = (apiUrl, params = {}) => {
  const base = String(apiUrl || '').trim().replace(/\/$/, '');
  if (!base) return '';

  const query = new URLSearchParams();
  if (params.graphTitle) query.set('graph_title', params.graphTitle);
  if (params.xLabel) query.set('x_label', params.xLabel);
  if (params.yLabel) query.set('y_label', params.yLabel);
  if (params.partNumber) query.set('part_number', params.partNumber);
  if (params.manufacturer) query.set('manufacturer', params.manufacturer);

  const qs = query.toString();
  return qs ? `${base}/api/scale-suggestions?${qs}` : `${base}/api/scale-suggestions`;
};

const parseCompanyApiText = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const match = text.match(/[{\[][\s\S]*[}\]]/);
  return JSON.parse(match ? match[0] : text);
};

const fetchWithTimeout = async (url, timeoutMs = COMPANY_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    window.clearTimeout(timer);
  }
};

const normalizeScale = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'logarithmic' || normalized === 'log') return 'Logarithmic';
  if (normalized === 'linear') return 'Linear';
  return '';
};

const parseAxisNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPlaceholderBounds = ({ xMin, xMax, yMin, yMax, xScale, yScale }) => {
  if (normalizeScale(xScale) === 'Logarithmic' || normalizeScale(yScale) === 'Logarithmic') {
    return false;
  }
  const xMinNum = parseAxisNumber(xMin);
  const xMaxNum = parseAxisNumber(xMax);
  const yMinNum = parseAxisNumber(yMin);
  const yMaxNum = parseAxisNumber(yMax);
  return xMinNum === 0 && xMaxNum === 100 && yMinNum === 0 && yMaxNum === 100;
};

const hasUsableAxisSample = (axis = {}) => {
  const hasScale = Boolean(normalizeScale(axis.xScale) || normalizeScale(axis.yScale));
  const hasUnits =
    (axis.xUnitPrefix && String(axis.xUnitPrefix).trim() !== '1') ||
    (axis.yUnitPrefix && String(axis.yUnitPrefix).trim() !== '1');
  const hasBounds = hasCompleteAxisFields(axis) && !isPlaceholderBounds(axis);
  return hasScale || hasUnits || hasBounds;
};

const formatAxisBound = (value) => {
  if (value === null || value === undefined) return null;
  if (value === 0) return '0';
  const absValue = Math.abs(value);
  if (absValue >= 1000 || (absValue > 0 && absValue < 0.001)) {
    return String(Number(value.toPrecision(12)));
  }
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
};

const medianAxisValue = (values = []) => {
  const nums = values
    .map((value) => parseAxisNumber(value))
    .filter((value) => value !== null);
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const majorityScale = (values = [], minRatio = MAJORITY_RATIO) => {
  const normalized = values.map((value) => normalizeScale(value)).filter(Boolean);
  if (!normalized.length) return null;
  const logCount = normalized.filter((value) => value === 'Logarithmic').length;
  const linearCount = normalized.length - logCount;
  if (logCount / normalized.length >= minRatio) return 'Logarithmic';
  if (linearCount / normalized.length >= minRatio) return 'Linear';
  return null;
};

const majorityValue = (values = [], minRatio = UNIT_MAJORITY_RATIO) => {
  const counts = {};
  values.forEach((value) => {
    const key = String(value || '').trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const [bestKey, bestCount] = entries.sort((a, b) => b[1] - a[1])[0];
  if (bestCount / values.length >= minRatio) return bestKey;
  return null;
};

const suggestionHasAxisSettings = (suggestion = {}) =>
  Boolean(
    suggestion.xScale ||
      suggestion.yScale ||
      suggestion.xMin ||
      suggestion.xMax ||
      suggestion.yMin ||
      suggestion.yMax
  );

const buildSuggestionFromSamples = (samples = [], { patternId = null, patternLabel = null } = {}) => {
  if (samples.length < MIN_SAMPLES) {
    return {
      suggestion: null,
      pattern_id: patternId,
      pattern_label: patternLabel,
      sample_count: samples.length,
      message: null,
    };
  }

  const boundSamples = samples.filter(
    (sample) => hasCompleteAxisFields(sample) && !isPlaceholderBounds(sample)
  );
  const boundSource = boundSamples.length >= MIN_SAMPLES ? boundSamples : samples;

  const suggestion = {};
  const xScale = majorityScale(samples.map((sample) => sample.xScale));
  const yScale = majorityScale(samples.map((sample) => sample.yScale));
  const xUnit = majorityValue(samples.map((sample) => sample.xUnitPrefix));
  const yUnit = majorityValue(samples.map((sample) => sample.yUnitPrefix));

  if (xScale) suggestion.xScale = xScale;
  if (yScale) suggestion.yScale = yScale;
  if (xUnit) suggestion.xUnitPrefix = xUnit;
  if (yUnit) suggestion.yUnitPrefix = yUnit;

  const xMin = medianAxisValue(boundSource.map((sample) => sample.xMin));
  const xMax = medianAxisValue(boundSource.map((sample) => sample.xMax));
  const yMin = medianAxisValue(boundSource.map((sample) => sample.yMin));
  const yMax = medianAxisValue(boundSource.map((sample) => sample.yMax));

  const formattedXMin = formatAxisBound(xMin);
  const formattedXMax = formatAxisBound(xMax);
  const formattedYMin = formatAxisBound(yMin);
  const formattedYMax = formatAxisBound(yMax);

  if (formattedXMin !== null && formattedXMax !== null && xMax > xMin) {
    suggestion.xMin = formattedXMin;
    suggestion.xMax = formattedXMax;
  }
  if (formattedYMin !== null && formattedYMax !== null && yMax > yMin) {
    suggestion.yMin = formattedYMin;
    suggestion.yMax = formattedYMax;
  }

  const reference = samples.find((sample) => sample.referencePartNumber) || samples[0];
  if (reference?.referencePartNumber) {
    suggestion.referencePartNumber = reference.referencePartNumber;
  }
  if (reference?.referenceGraphId) {
    suggestion.referenceGraphId = String(reference.referenceGraphId);
  }
  if (reference?.referenceCurveId) {
    suggestion.referenceCurveId = reference.referenceCurveId;
  }

  if (!suggestionHasAxisSettings(suggestion)) {
    return {
      suggestion: null,
      pattern_id: patternId,
      pattern_label: patternLabel,
      sample_count: samples.length,
      message: null,
    };
  }

  const scaleParts = [];
  if (xScale) {
    const xLog = samples.filter((sample) => normalizeScale(sample.xScale) === 'Logarithmic').length;
    scaleParts.push(`X was ${xScale} in ${xLog}/${samples.length} similar captures`);
  }
  if (yScale) {
    const yLog = samples.filter((sample) => normalizeScale(sample.yScale) === 'Logarithmic').length;
    scaleParts.push(`Y was ${yScale} in ${yLog}/${samples.length} similar captures`);
  }

  let boundsPart = null;
  if (suggestion.xMin && suggestion.xMax && suggestion.yMin && suggestion.yMax) {
    boundsPart = `typical axis X [${suggestion.xMin}, ${suggestion.xMax}], Y [${suggestion.yMin}, ${suggestion.yMax}]`;
  }

  const refPart = suggestion.referencePartNumber;
  const refClause = refPart ? ` (example: ${refPart})` : '';
  const messageParts = [`Based on ${samples.length} similar past captures${refClause}`];
  if (scaleParts.length) messageParts.push(scaleParts.join('; '));
  if (boundsPart) messageParts.push(boundsPart);

  return {
    suggestion,
    pattern_id: patternId,
    pattern_label: patternLabel,
    sample_count: samples.length,
    message: `${messageParts.join('. ')}.`,
  };
};

const matchesTargetPattern = (graph = {}, targetPatternId = '') => {
  if (!targetPatternId) return true;
  const pattern = detectGraphScalePattern({
    graphTitle: graph.graph_title || graph.graphTitle || '',
    xTitle: graph.x_title || graph.xLabel || '',
    yTitle: graph.y_title || graph.yLabel || '',
  });
  return pattern?.id === targetPatternId;
};

const collectAxisSamplesFromCompanyGraph = (graph = {}, targetPatternId = '') => {
  if (!graph || typeof graph !== 'object') return [];
  if (!matchesTargetPattern(graph, targetPatternId)) return [];

  const details = Array.isArray(graph.details) ? graph.details : [];
  const samples = [];

  if (details.length > 0) {
    details.forEach((detail) => {
      const axis = resolveDiscovereeAxisFields(graph, detail);
      if (!hasUsableAxisSample(axis)) return;
      samples.push({
        ...axis,
        referencePartNumber: graph.partno || graph.part_number || '',
        referenceGraphId: graph.graph_id || graph.graphId || '',
        referenceCurveId: detail.id || detail.detail_id || '',
      });
    });
    return samples;
  }

  const axis = resolveDiscovereeAxisFields(graph, {});
  if (!hasUsableAxisSample(axis)) return [];
  return [
    {
      ...axis,
      referencePartNumber: graph.partno || graph.part_number || '',
      referenceGraphId: graph.graph_id || graph.graphId || '',
    },
  ];
};

const sessionCurveMatchesContext = (curve = {}, params = {}, targetPatternId = '') => {
  const graphTitle = curve?.config?.graphTitle || params.graphTitle || '';
  const xTitle = curve?.config?.xLabel || params.xLabel || '';
  const yTitle = curve?.config?.yLabel || params.yLabel || '';
  return matchesTargetPattern(
    { graph_title: graphTitle, x_title: xTitle, y_title: yTitle },
    targetPatternId
  );
};

const curveConfigToAxisSample = (curve = {}, params = {}) => {
  const cfg = curve?.config || {};
  const axis = {
    xScale: cfg.xScale,
    yScale: cfg.yScale,
    xUnitPrefix: cfg.xUnitPrefix,
    yUnitPrefix: cfg.yUnitPrefix,
    xMin: cfg.xMin,
    xMax: cfg.xMax,
    yMin: cfg.yMin,
    yMax: cfg.yMax,
    referencePartNumber: cfg.partNumber || params.partNumber || curve.part_number || '',
    referenceGraphId: String(curve.graphId || params.graphId || '').trim(),
    referenceCurveId: String(curve.detailId || curve.id || '').trim(),
  };
  return hasUsableAxisSample(axis) ? axis : null;
};

export const extractSessionAxisSamples = (sessionCurves = [], params = {}, targetPatternId = '') => {
  if (!targetPatternId || !Array.isArray(sessionCurves)) return [];

  const samples = [];
  const seen = new Set();

  sessionCurves.forEach((curve) => {
    if (!sessionCurveMatchesContext(curve, params, targetPatternId)) return;
    const sample = curveConfigToAxisSample(curve, params);
    if (!sample) return;

    const key = [
      sample.referenceGraphId,
      sample.referenceCurveId,
      sample.xScale,
      sample.yScale,
      sample.xMin,
      sample.xMax,
      sample.yMin,
      sample.yMax,
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    samples.push(sample);
  });

  return samples;
};

const dedupeAxisSamples = (samples = []) => {
  const seen = new Set();
  return samples.filter((sample) => {
    const key = [
      sample.referenceGraphId,
      sample.referenceCurveId,
      sample.xScale,
      sample.yScale,
      sample.xMin,
      sample.xMax,
      sample.yMin,
      sample.yMax,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildEmptyHistoricalMessage = ({ totalSamples = 0, sessionSampleCount = 0 } = {}) => {
  if (totalSamples === 0) {
    return 'No similar past captures found yet for this part and graph type. Save this graph once; the next similar capture can suggest axis settings automatically.';
  }
  if (totalSamples === 1) {
    return 'Only one similar capture found so far. Save one more graph like this to unlock axis suggestions.';
  }
  if (sessionSampleCount > 0 && totalSamples === sessionSampleCount) {
    return 'Curves are saved on this graph, but axis min/max were not stored in the database. Set scale and limits manually, then save.';
  }
  return 'Similar captures exist, but not enough stored axis settings yet. Set scale and min/max manually for now.';
};

const buildCompanySearchUrls = (params = {}, targetPatternId = '') => {
  const graphTitle = String(params.graphTitle || '').trim();
  const partNumber = String(params.partNumber || '').trim();
  const manufacturer = String(params.manufacturer || '').trim();
  const urls = [];
  const seen = new Set();

  const addUrl = (searchParams) => {
    const qs = searchParams.toString();
    if (!qs || seen.has(qs)) return;
    seen.add(qs);
    urls.push(`${COMPANY_GRAPH_CAPTURE_API_URL}?${qs}`);
  };

  if (graphTitle || partNumber || manufacturer) {
    const primary = new URLSearchParams();
    if (graphTitle) primary.set('graph_title', graphTitle);
    if (partNumber) primary.set('partno', partNumber);
    if (manufacturer) primary.set('manf', manufacturer);
    addUrl(primary);
  }

  const keywords = PATTERN_SEARCH_KEYWORDS[targetPatternId] || [];
  keywords.forEach((keyword) => {
    if (!partNumber && !manufacturer) return;
    const fallback = new URLSearchParams();
    fallback.set('graph_title', keyword);
    if (partNumber) fallback.set('partno', partNumber);
    if (manufacturer) fallback.set('manf', manufacturer);
    addUrl(fallback);
  });

  return urls;
};

const fetchCompanyGraphRecords = async (params = {}, targetPatternId = '') => {
  const graphId = String(params.graphId || '').trim();
  const records = [];
  const seenGraphIds = new Set();

  const addGraph = (graph) => {
    const id = String(graph?.graph_id || graph?.graphId || '').trim();
    if (id && seenGraphIds.has(id)) return;
    if (id) seenGraphIds.add(id);
    records.push(graph);
  };

  if (graphId) {
    try {
      const response = await fetchWithTimeout(
        `${COMPANY_GRAPH_CAPTURE_API_URL}?graph_id=${encodeURIComponent(graphId)}`
      );
      if (response.ok) {
        const parsed = parseCompanyApiText(await response.text());
        if (parsed?.graph && typeof parsed.graph === 'object') {
          const graph = {
            ...parsed.graph,
            details: Array.isArray(parsed.details) ? parsed.details : [],
          };
          addGraph(graph);
        }
      }
    } catch {
      // Ignore company lookup failures and keep Render-only suggestions.
    }
  }

  const searchUrls = buildCompanySearchUrls(params, targetPatternId);
  for (const url of searchUrls) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) continue;
      const parsed = parseCompanyApiText(await response.text());
      const graphs = Array.isArray(parsed?.graphs) ? parsed.graphs : [];
      graphs.slice(0, MAX_COMPANY_GRAPHS).forEach(addGraph);
      if (records.length >= MAX_COMPANY_GRAPHS) break;
    } catch {
      // Ignore individual search failures.
    }
  }

  return records;
};

const buildCompanyAndSessionSuggestion = async (params = {}, sessionCurves = [], targetPattern = null) => {
  if (!targetPattern) return null;

  const graphs = await fetchCompanyGraphRecords(params, targetPattern.id);
  const apiSamples = graphs.flatMap((graph) =>
    collectAxisSamplesFromCompanyGraph(graph, targetPattern.id)
  );
  const sessionSamples = extractSessionAxisSamples(sessionCurves, params, targetPattern.id);
  const samples = dedupeAxisSamples([...apiSamples, ...sessionSamples]);

  const built = buildSuggestionFromSamples(samples, {
    patternId: targetPattern.id,
    patternLabel: targetPattern.label,
  });

  if (!built?.suggestion) {
    return {
      ...built,
      apiSampleCount: apiSamples.length,
      sessionSampleCount: sessionSamples.length,
      source: null,
    };
  }

  let message = built.message || '';
  if (sessionSamples.length > 0 && apiSamples.length === 0) {
    message = message.replace(
      'similar past captures',
      `similar past captures (${sessionSamples.length} already saved on this graph)`
    );
  } else if (sessionSamples.length > 0 && apiSamples.length > 0) {
    message = message.replace(
      /\.$/,
      `, including ${sessionSamples.length} curve(s) already saved on this graph.`
    );
  }

  return {
    ...built,
    message,
    apiSampleCount: apiSamples.length,
    sessionSampleCount: sessionSamples.length,
    source: sessionSamples.length > 0 && apiSamples.length === 0 ? 'session' : 'company',
  };
};

const fetchRenderScaleSuggestion = async (apiUrl, params = {}) => {
  const url = buildScaleSuggestionsUrl(apiUrl, params);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data !== 'object') return null;
    if (!data.suggestion) {
      return data.suggestion === null ? { ...data, source: 'render' } : null;
    }
    return { ...data, source: 'render' };
  } catch {
    return null;
  }
};

const mergeHistoricalScaleSuggestions = (renderResult, companyResult) => {
  if (!renderResult?.suggestion && !companyResult?.suggestion) {
    return null;
  }

  if (renderResult?.suggestion && !companyResult?.suggestion) {
    return { ...renderResult, sources: ['render'] };
  }

  if (!renderResult?.suggestion && companyResult?.suggestion) {
    return {
      ...companyResult,
      sources: [companyResult.source === 'session' ? 'session' : 'company'],
    };
  }

  const mergedSuggestion = { ...companyResult.suggestion };
  const boundFields = ['xMin', 'xMax', 'yMin', 'yMax'];
  boundFields.forEach((field) => {
    if (renderResult.suggestion[field]) {
      mergedSuggestion[field] = renderResult.suggestion[field];
    }
  });

  ['xScale', 'yScale', 'xUnitPrefix', 'yUnitPrefix'].forEach((field) => {
    if (!mergedSuggestion[field] && renderResult.suggestion[field]) {
      mergedSuggestion[field] = renderResult.suggestion[field];
    }
  });

  if (!mergedSuggestion.referencePartNumber && renderResult.suggestion.referencePartNumber) {
    mergedSuggestion.referencePartNumber = renderResult.suggestion.referencePartNumber;
  }
  if (!mergedSuggestion.referenceGraphId && renderResult.suggestion.referenceGraphId) {
    mergedSuggestion.referenceGraphId = renderResult.suggestion.referenceGraphId;
  }
  if (!mergedSuggestion.referenceCurveId && renderResult.suggestion.referenceCurveId) {
    mergedSuggestion.referenceCurveId = renderResult.suggestion.referenceCurveId;
  }

  const messageParts = [];
  if (renderResult.sample_count >= MIN_SAMPLES && renderResult.message) {
    messageParts.push(`Render database: ${renderResult.message.replace(/\.$/, '')}`);
  }
  if (companyResult.sample_count >= MIN_SAMPLES && companyResult.message) {
    const label =
      companyResult.source === 'session'
        ? 'Saved curves on this graph'
        : 'Company database';
    messageParts.push(`${label}: ${companyResult.message.replace(/\.$/, '')}`);
  }

  return {
    suggestion: mergedSuggestion,
    pattern_id: renderResult.pattern_id || companyResult.pattern_id,
    pattern_label: renderResult.pattern_label || companyResult.pattern_label,
    sample_count: (renderResult.sample_count || 0) + (companyResult.sample_count || 0),
    message: messageParts.length
      ? `${messageParts.join(' ')}.`
      : renderResult.message || companyResult.message,
    sources: ['render', 'company'],
  };
};

export const fetchHistoricalScaleSuggestion = async (
  apiUrl,
  params = {},
  { sessionCurves = [] } = {}
) => {
  const targetPattern = detectGraphScalePattern({
    graphTitle: params.graphTitle,
    xTitle: params.xLabel,
    yTitle: params.yLabel,
  });

  const [renderResult, companyResult] = await Promise.all([
    fetchRenderScaleSuggestion(apiUrl, params),
    buildCompanyAndSessionSuggestion(params, sessionCurves, targetPattern),
  ]);

  const merged = mergeHistoricalScaleSuggestions(renderResult, companyResult);
  if (merged?.suggestion) return merged;

  if (companyResult?.suggestion) {
    return {
      ...companyResult,
      sources: [companyResult.source === 'session' ? 'session' : 'company'],
    };
  }
  if (renderResult?.suggestion) return { ...renderResult, sources: ['render'] };

  if (!targetPattern) return null;

  const totalSamples =
    (companyResult?.sample_count || 0) +
    (renderResult?.sample_count || 0);
  const sessionSampleCount = companyResult?.sessionSampleCount || 0;

  return {
    suggestion: null,
    pattern_id: targetPattern.id,
    pattern_label: targetPattern.label,
    sample_count: totalSamples,
    message: null,
    emptyMessage: buildEmptyHistoricalMessage({ totalSamples, sessionSampleCount }),
  };
};

const isDefaultLinearScale = (value) => String(value || 'Linear').trim() === 'Linear';

const isDefaultPlaceholderBounds = (config = {}) => {
  const xMin = Number.parseFloat(config.xMin);
  const xMax = Number.parseFloat(config.xMax);
  const yMin = Number.parseFloat(config.yMin);
  const yMax = Number.parseFloat(config.yMax);
  return (
    isDefaultLinearScale(config.xScale) &&
    isDefaultLinearScale(config.yScale) &&
    xMin === 0 &&
    xMax === 100 &&
    yMin === 0 &&
    yMax === 100
  );
};

const isEmptyAxisValue = (value) => {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '';
};

const canApplyAxisField = (config, field, suggestedValue, { onlyFillDefaults }) => {
  const suggested = String(suggestedValue ?? '').trim();
  if (!suggested) return false;

  const current = config?.[field];
  if (!onlyFillDefaults) return String(current ?? '').trim() !== suggested;

  if (field === 'xScale' || field === 'yScale') {
    return isDefaultLinearScale(current);
  }
  if (field === 'xUnitPrefix' || field === 'yUnitPrefix') {
    return !current || String(current).trim() === '1';
  }
  if (['xMin', 'xMax', 'yMin', 'yMax'].includes(field)) {
    return isEmptyAxisValue(current) || isDefaultPlaceholderBounds(config);
  }
  return isEmptyAxisValue(current);
};

export const historicalSuggestionHasAxisSettings = (historical) => {
  const suggestion = historical?.suggestion;
  if (!suggestion || typeof suggestion !== 'object') return false;
  return suggestionHasAxisSettings(suggestion);
};

export const applyHistoricalAxisSuggestion = (
  config = {},
  historical = null,
  { onlyFillDefaults = true } = {}
) => {
  const suggestion = historical?.suggestion;
  if (!suggestion || typeof suggestion !== 'object') return config;

  const next = { ...config };
  let changed = false;

  const fields = [
    'xScale',
    'yScale',
    'xUnitPrefix',
    'yUnitPrefix',
    'xMin',
    'xMax',
    'yMin',
    'yMax',
  ];

  fields.forEach((field) => {
    if (!canApplyAxisField(config, field, suggestion[field], { onlyFillDefaults })) return;
    next[field] = String(suggestion[field]).trim();
    changed = true;
  });

  return changed ? next : config;
};

export const applyHistoricalScaleHints = (
  config = {},
  historical = null,
  options = {}
) => applyHistoricalAxisSuggestion(config, historical, options);

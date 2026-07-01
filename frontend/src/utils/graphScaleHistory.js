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

export const fetchHistoricalScaleSuggestion = async (apiUrl, params = {}) => {
  const url = buildScaleSuggestionsUrl(apiUrl, params);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.suggestion || typeof data.suggestion !== 'object') return null;
    return data;
  } catch {
    return null;
  }
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
  return Boolean(
    suggestion.xScale ||
      suggestion.yScale ||
      suggestion.xMin ||
      suggestion.xMax ||
      suggestion.yMin ||
      suggestion.yMax
  );
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

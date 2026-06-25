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

export const applyHistoricalScaleHints = (
  config = {},
  historical = null,
  { onlyFillDefaults = true } = {}
) => {
  const suggestion = historical?.suggestion;
  if (!suggestion || typeof suggestion !== 'object') return config;

  const next = { ...config };
  let changed = false;

  const isDefaultLinearScale = (value) => String(value || 'Linear').trim() === 'Linear';

  ['x', 'y'].forEach((axis) => {
    const scaleKey = axis === 'x' ? 'xScale' : 'yScale';
    const suggestedScale = String(suggestion[scaleKey] || '').trim();
    const currentScale = String(next[scaleKey] || 'Linear').trim();
    if (!suggestedScale || suggestedScale === currentScale) return;

    const canSetLog =
      suggestedScale === 'Logarithmic' &&
      (!onlyFillDefaults || isDefaultLinearScale(currentScale));
    const canSetLinear =
      suggestedScale === 'Linear' &&
      (!onlyFillDefaults || isDefaultLinearScale(currentScale));

    if (canSetLog || canSetLinear) {
      next[scaleKey] = suggestedScale;
      changed = true;
    }
  });

  return changed ? next : config;
};

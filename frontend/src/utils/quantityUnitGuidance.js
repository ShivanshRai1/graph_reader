import {
  detectGraphScalePattern,
  getPatternAxisDefaults,
} from './graphScalePatterns';

const PICO = '1e-12';
const NANO = '1e-9';
const MICRO = '1e-6';
const MILLI = '1e-3';
const BASE = '1';
const KILO = '1e3';
const MEGA = '1e6';
const GIGA = '1e9';

export const UNIT_CROSS_CHECK_MESSAGE = 'Please cross check the unit based on graph type';
export const SCALE_CROSS_CHECK_MESSAGE = 'Please cross check the scale (Linear/Logarithmic) based on graph type';
export const SCALE_AND_UNIT_CROSS_CHECK_MESSAGE =
  'Please cross check the scale (Linear/Logarithmic) and unit based on graph type';

const QUANTITY_UNIT_GUIDANCE_RULES = [
  {
    quantity: 'Thermal Resistance',
    pattern: /thermal\s*resistance/i,
    expectedUnits: '°C/W, K/W',
    allowedPrefixes: [BASE],
    defaultPrefix: BASE,
  },
  {
    quantity: 'Voltage',
    pattern: /\bvoltage\b|\bV(?:R|IN|OUT)?\b|\[\s*V\s*\]/i,
    expectedUnits: 'V',
    allowedPrefixes: [BASE],
    defaultPrefix: BASE,
  },
  {
    quantity: 'Current',
    pattern: /\bcurrent\b|\[\s*mA\s*\]|\[\s*A\s*\]/i,
    expectedUnits: 'mA, A',
    allowedPrefixes: [MILLI, BASE],
    defaultPrefix: MILLI,
  },
  {
    quantity: 'Temperature',
    pattern: /\btemperature\b|\bT(?:J|A|C)?\b|\[\s*°?C\s*\]|\[\s*K\s*\]/i,
    expectedUnits: '°C or K',
    allowedPrefixes: [BASE],
    defaultPrefix: BASE,
  },
  {
    quantity: 'Resistance',
    pattern: /\bresistance\b|\[\s*μ?Ω\s*\]|\[\s*uΩ\s*\]/i,
    expectedUnits: 'μΩ, mΩ, Ω',
    allowedPrefixes: [MICRO, MILLI, BASE],
    defaultPrefix: BASE,
  },
  {
    quantity: 'Capacitance',
    pattern: /\bcapacitance\b|\bC\s*\[|\[\s*pF\s*\]|\[\s*nF\s*\]|\[\s*μF\s*\]|\[\s*uF\s*\]/i,
    expectedUnits: 'pF, nF, μF',
    allowedPrefixes: [PICO, NANO, MICRO],
    defaultPrefix: PICO,
  },
  {
    quantity: 'Inductance',
    pattern: /\binductance\b|\[\s*nH\s*\]|\[\s*μH\s*\]|\[\s*uH\s*\]|\[\s*mH\s*\]/i,
    expectedUnits: 'nH, μH, mH',
    allowedPrefixes: [NANO, MICRO, MILLI],
    defaultPrefix: NANO,
  },
  {
    quantity: 'Charge',
    pattern: /\bcharge\b|\[\s*pC\s*\]|\[\s*nC\s*\]|\[\s*μC\s*\]|\[\s*uC\s*\]/i,
    expectedUnits: 'pC, nC, μC',
    allowedPrefixes: [PICO, NANO, MICRO],
    defaultPrefix: PICO,
  },
  {
    quantity: 'Energy',
    pattern: /\benergy\b|\[\s*nJ\s*\]|\[\s*μJ\s*\]|\[\s*uJ\s*\]|\[\s*mJ\s*\]|\[\s*J\s*\]/i,
    expectedUnits: 'nJ, μJ, mJ, J',
    allowedPrefixes: [NANO, MICRO, MILLI, BASE],
    defaultPrefix: NANO,
  },
  {
    quantity: 'Power',
    pattern: /\bpower\b|\[\s*mW\s*\]|\[\s*W\s*\]|\[\s*kW\s*\]/i,
    expectedUnits: 'mW, W, kW',
    allowedPrefixes: [MILLI, BASE, KILO],
    defaultPrefix: MILLI,
  },
  {
    quantity: 'Time',
    pattern: /\btime\b|\[\s*ps\s*\]|\[\s*ns\s*\]|\[\s*μs\s*\]|\[\s*us\s*\]|\[\s*ms\s*\]|\[\s*s\s*\]/i,
    expectedUnits: 'ps, ns, μs, ms',
    allowedPrefixes: [PICO, NANO, MICRO, MILLI],
    defaultPrefix: NANO,
  },
  {
    quantity: 'Frequency',
    pattern: /\bfrequency\b|\[\s*Hz\s*\]|\[\s*kHz\s*\]|\[\s*MHz\s*\]|\[\s*GHz\s*\]/i,
    expectedUnits: 'Hz, kHz, MHz, GHz',
    allowedPrefixes: [BASE, KILO, MEGA, GIGA],
    defaultPrefix: BASE,
  },
];

const TITLE_FIELDS = [
  { source: 'Graph Title', key: 'graphTitle' },
  { source: 'X Title', key: 'xTitle' },
  { source: 'Y Title', key: 'yTitle' },
];

const BRACKET_UNIT_TO_PREFIX = {
  pf: PICO,
  pc: PICO,
  ps: PICO,
  nf: NANO,
  nh: NANO,
  nj: NANO,
  nc: NANO,
  ns: NANO,
  μf: MICRO,
  uf: MICRO,
  'μω': MICRO,
  uω: MICRO,
  us: MICRO,
  μs: MICRO,
  ma: MILLI,
  mv: MILLI,
  mw: MILLI,
  mω: MILLI,
  mohm: MILLI,
  mh: MILLI,
  mj: MILLI,
  ms: MILLI,
  v: BASE,
  a: BASE,
  ω: BASE,
  ohm: BASE,
  j: BASE,
  w: BASE,
  s: BASE,
  hz: BASE,
  khz: KILO,
  kw: KILO,
  mhz: MEGA,
  ghz: GIGA,
};

const BRACKET_UNIT_TO_SCALE = {
  pf: 'Logarithmic',
  nf: 'Logarithmic',
  μf: 'Logarithmic',
  uf: 'Logarithmic',
};

const normalizeGuidanceText = (value) => String(value || '').trim();

const normalizeBracketUnitKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ω/g, 'ω');

const isDefaultUnitPrefix = (value) => {
  const normalized = String(value ?? '').trim();
  return !normalized || normalized === '1';
};

const isDefaultLinearScale = (value) => String(value || 'Linear').trim() === 'Linear';

const matchRulesForText = (text) => {
  const normalized = normalizeGuidanceText(text);
  if (!normalized) return [];

  const matches = [];
  for (const rule of QUANTITY_UNIT_GUIDANCE_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    if (rule.quantity === 'Resistance' && /thermal\s*resistance/i.test(normalized)) {
      continue;
    }
    matches.push({
      quantity: rule.quantity,
      expectedUnits: rule.expectedUnits,
      allowedPrefixes: [...rule.allowedPrefixes],
      defaultPrefix: rule.defaultPrefix,
    });
  }
  return matches;
};

const extractBracketUnitPrefixes = (text) => {
  const normalized = normalizeGuidanceText(text);
  if (!normalized) return [];

  const prefixes = new Set();
  const bracketPattern = /\[([^\]]+)\]/g;
  let match = bracketPattern.exec(normalized);
  while (match) {
    const key = normalizeBracketUnitKey(match[1]);
    const prefix = BRACKET_UNIT_TO_PREFIX[key];
    if (prefix) prefixes.add(prefix);
    match = bracketPattern.exec(normalized);
  }
  return [...prefixes];
};

const collectAllowedPrefixesForTitle = (text) => {
  const matches = matchRulesForText(text);
  if (matches.length === 0) return [];

  const allowed = new Set();
  matches.forEach((match) => {
    match.allowedPrefixes.forEach((prefix) => allowed.add(prefix));
  });
  return [...allowed];
};

const resolveAxisTitleText = (axis, { xTitle, yTitle, graphTitle }) => {
  const axisTitle = axis === 'x' ? normalizeGuidanceText(xTitle) : normalizeGuidanceText(yTitle);
  if (axisTitle) return axisTitle;
  return normalizeGuidanceText(graphTitle);
};

const inferSuggestedUnitPrefixForAxis = (axis, { xTitle = '', yTitle = '', graphTitle = '' } = {}) => {
  const axisTitle = axis === 'x' ? normalizeGuidanceText(xTitle) : normalizeGuidanceText(yTitle);
  const titleText = resolveAxisTitleText(axis, { xTitle, yTitle, graphTitle });
  if (!titleText) return null;

  const bracketPrefixes = extractBracketUnitPrefixes(axisTitle || titleText);
  if (bracketPrefixes.length >= 1) {
    return bracketPrefixes[0];
  }

  const axisMatches = matchRulesForText(axisTitle);
  if (axisMatches.length >= 1) {
    return axisMatches[0].defaultPrefix;
  }

  const graphMatches = matchRulesForText(graphTitle);
  if (!axisTitle && graphMatches.length === 1) {
    return graphMatches[0].defaultPrefix;
  }

  return null;
};

const titleSuggestsLogScale = (text) => {
  const normalized = normalizeGuidanceText(text);
  if (!normalized) return false;
  if (/\blogarithmic\b/i.test(normalized)) return true;
  if (/\blog\s*scale\b/i.test(normalized)) return true;
  if (/\blog[-\s]?log\b/i.test(normalized)) return true;

  const bracketPattern = /\[([^\]]+)\]/g;
  let match = bracketPattern.exec(normalized);
  while (match) {
    const key = normalizeBracketUnitKey(match[1]);
    if (BRACKET_UNIT_TO_SCALE[key] === 'Logarithmic') {
      return true;
    }
    match = bracketPattern.exec(normalized);
  }

  const hasCapacitance = /\bcapacitance\b/i.test(normalized);
  const hasVoltage = /\bvoltage\b/i.test(normalized);
  const hasReverseVoltage = /\breverse\s+voltage\b|\bV\s*R\b/i.test(normalized);
  if (hasCapacitance && (hasVoltage || hasReverseVoltage)) {
    return true;
  }

  return false;
};

export const UNIT_PREFIX_SELECT_OPTIONS = [
  { value: '1e-12', label: 'pico (p) = 1e-12' },
  { value: '1e-9', label: 'nano (n) = 1e-9' },
  { value: '1e-6', label: 'micro (μ) = 1e-6' },
  { value: '1e-3', label: 'milli (m) = 1e-3' },
  { value: '1', label: '1' },
  { value: '1e3', label: 'Kilo (k) = 1e3' },
  { value: '1e6', label: 'Mega (M) = 1e6' },
  { value: '1e9', label: 'Giga (G) = 1e9' },
  { value: '1e12', label: 'Tera (T) = 1e12' },
];

export const getUnitPrefixLabel = (prefix) => {
  const match = UNIT_PREFIX_SELECT_OPTIONS.find((option) => option.value === String(prefix ?? '').trim());
  return match?.label || String(prefix || '').trim() || '-';
};

export const getAxisUnitRecommendations = (
  axis,
  { xTitle = '', yTitle = '', graphTitle = '' } = {}
) => {
  const axisTitle = axis === 'x' ? normalizeGuidanceText(xTitle) : normalizeGuidanceText(yTitle);
  const titleText = resolveAxisTitleText(axis, { xTitle, yTitle, graphTitle });
  if (!titleText && !axisTitle) {
    return { primaryPrefix: null, recommendedPrefixes: [] };
  }

  const primaryPrefix = inferSuggestedUnitPrefixForAxis(axis, { xTitle, yTitle, graphTitle });
  const bracketPrefixes = extractBracketUnitPrefixes(axisTitle || titleText);
  const ruleAllowed = collectAllowedPrefixesForTitle(titleText);

  let recommendedPrefixes = [];
  if (bracketPrefixes.length > 0) {
    recommendedPrefixes =
      ruleAllowed.length > 0
        ? ruleAllowed.filter((prefix) => bracketPrefixes.includes(prefix))
        : bracketPrefixes;
    if (recommendedPrefixes.length === 0) {
      recommendedPrefixes = bracketPrefixes;
    }
  } else if (ruleAllowed.length > 0) {
    recommendedPrefixes = ruleAllowed;
  }

  return {
    primaryPrefix,
    recommendedPrefixes,
  };
};

const inferSuggestedScaleForAxis = (axis, { xTitle = '', yTitle = '', graphTitle = '' } = {}) => {
  const axisTitle = axis === 'x' ? normalizeGuidanceText(xTitle) : normalizeGuidanceText(yTitle);
  if (titleSuggestsLogScale(axisTitle)) return 'Logarithmic';
  if (titleSuggestsLogScale(graphTitle)) return 'Logarithmic';
  return null;
};

export const detectQuantityUnitGuidance = ({
  graphTitle = '',
  xTitle = '',
  yTitle = '',
} = {}) => {
  const fieldValues = {
    graphTitle: normalizeGuidanceText(graphTitle),
    xTitle: normalizeGuidanceText(xTitle),
    yTitle: normalizeGuidanceText(yTitle),
  };

  const rows = [];
  const seen = new Set();

  TITLE_FIELDS.forEach(({ source, key }) => {
    const text = fieldValues[key];
    if (!text) return;

    matchRulesForText(text).forEach((match) => {
      const dedupeKey = `${source}::${match.quantity}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      rows.push({
        source,
        quantity: match.quantity,
        expectedUnits: match.expectedUnits,
      });
    });
  });

  return rows;
};

export const shouldShowScaleAndUnitCrossCheck = (titles = {}) =>
  detectQuantityUnitGuidance(titles).length > 0 ||
  Boolean(detectGraphScalePattern(titles));

export const applyInferredAxisSettingsFromTitles = (
  config = {},
  { onlyFillDefaults = true, allowOverrideDefaultUnit = true } = {}
) => {
  const titles = {
    graphTitle: config.graphTitle,
    xTitle: config.xLabel,
    yTitle: config.yLabel,
  };
  const graphPattern = detectGraphScalePattern(titles);

  const next = { ...config };
  let changed = false;

  ['x', 'y'].forEach((axis) => {
    const unitKey = axis === 'x' ? 'xUnitPrefix' : 'yUnitPrefix';
    const scaleKey = axis === 'x' ? 'xScale' : 'yScale';
    const currentUnit = String(next[unitKey] ?? '').trim();
    const currentScale = String(next[scaleKey] || 'Linear').trim();

    const patternDefaults = getPatternAxisDefaults(graphPattern, axis);
    const suggestedUnit =
      patternDefaults.unitPrefix || inferSuggestedUnitPrefixForAxis(axis, titles);
    const suggestedScale =
      patternDefaults.scale || inferSuggestedScaleForAxis(axis, titles);

    const canSetUnit =
      suggestedUnit &&
      (
        !onlyFillDefaults ||
        isDefaultUnitPrefix(currentUnit) ||
        (allowOverrideDefaultUnit && currentUnit === '1' && suggestedUnit !== '1')
      );

    if (canSetUnit && currentUnit !== suggestedUnit) {
      next[unitKey] = suggestedUnit;
      changed = true;
    }

    const canSetScale =
      suggestedScale &&
      suggestedScale !== currentScale &&
      (!onlyFillDefaults || isDefaultLinearScale(currentScale));

    if (canSetScale) {
      next[scaleKey] = suggestedScale;
      changed = true;
    }
  });

  return changed ? next : config;
};

export const getAxisUnitMismatchWarning = (
  axis,
  { xTitle = '', yTitle = '', graphTitle = '', unitPrefix = '' } = {}
) => {
  const selectedPrefix = String(unitPrefix ?? '').trim();
  if (!selectedPrefix) return null;

  const titleText = resolveAxisTitleText(axis, { xTitle, yTitle, graphTitle });
  if (!titleText) return null;

  const ruleAllowed = collectAllowedPrefixesForTitle(titleText);
  const bracketAllowed = extractBracketUnitPrefixes(titleText);

  if (ruleAllowed.length === 0 && bracketAllowed.length === 0) {
    return null;
  }

  let allowedPrefixes = ruleAllowed;
  if (bracketAllowed.length > 0) {
    allowedPrefixes =
      ruleAllowed.length > 0
        ? ruleAllowed.filter((prefix) => bracketAllowed.includes(prefix))
        : bracketAllowed;
    if (allowedPrefixes.length === 0) {
      allowedPrefixes = bracketAllowed;
    }
  }

  if (allowedPrefixes.includes(selectedPrefix)) {
    return null;
  }

  return {
    message: UNIT_CROSS_CHECK_MESSAGE,
    axis,
    allowedPrefixes,
  };
};

export const getAxisScaleMismatchWarning = (
  axis,
  { xTitle = '', yTitle = '', graphTitle = '', scale = 'Linear' } = {}
) => {
  const selectedScale = String(scale || 'Linear').trim();
  const titleText = resolveAxisTitleText(axis, { xTitle, yTitle, graphTitle });
  if (!titleText) return null;

  const pattern = detectGraphScalePattern({ graphTitle, xTitle, yTitle });
  const patternScale = getPatternAxisDefaults(pattern, axis).scale;
  const suggestsLog =
    patternScale === 'Logarithmic' ||
    titleSuggestsLogScale(titleText) ||
    titleSuggestsLogScale(graphTitle);
  const suggestsLinear = patternScale === 'Linear';

  if (suggestsLinear && selectedScale === 'Logarithmic') {
    return {
      message: SCALE_CROSS_CHECK_MESSAGE,
      axis,
      suggestedScale: 'Linear',
    };
  }

  if (!suggestsLog) return null;
  if (selectedScale === 'Logarithmic') return null;

  return {
    message: SCALE_CROSS_CHECK_MESSAGE,
    axis,
    suggestedScale: 'Logarithmic',
  };
};

export { detectGraphScalePattern, getGraphPatternGuidance } from './graphScalePatterns';

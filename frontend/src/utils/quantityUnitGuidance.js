const PICO = '1e-12';
const NANO = '1e-9';
const MICRO = '1e-6';
const MILLI = '1e-3';
const BASE = '1';
const KILO = '1e3';
const MEGA = '1e6';
const GIGA = '1e9';

export const UNIT_CROSS_CHECK_MESSAGE = 'Please cross check the unit based on graph type';

const QUANTITY_UNIT_GUIDANCE_RULES = [
  {
    quantity: 'Thermal Resistance',
    pattern: /thermal\s*resistance/i,
    expectedUnits: '°C/W, K/W',
    allowedPrefixes: [BASE],
  },
  {
    quantity: 'Voltage',
    pattern: /\bvoltage\b|\bV(?:R|IN|OUT)?\b|\[\s*V\s*\]/i,
    expectedUnits: 'V',
    allowedPrefixes: [BASE],
  },
  {
    quantity: 'Current',
    pattern: /\bcurrent\b|\[\s*mA\s*\]|\[\s*A\s*\]/i,
    expectedUnits: 'mA, A',
    allowedPrefixes: [MILLI, BASE],
  },
  {
    quantity: 'Temperature',
    pattern: /\btemperature\b|\bT(?:J|A|C)?\b|\[\s*°?C\s*\]|\[\s*K\s*\]/i,
    expectedUnits: '°C or K',
    allowedPrefixes: [BASE],
  },
  {
    quantity: 'Resistance',
    pattern: /\bresistance\b|\[\s*μ?Ω\s*\]|\[\s*uΩ\s*\]/i,
    expectedUnits: 'μΩ, mΩ, Ω',
    allowedPrefixes: [MICRO, MILLI, BASE],
  },
  {
    quantity: 'Capacitance',
    pattern: /\bcapacitance\b|\bC\s*\[|\[\s*pF\s*\]|\[\s*nF\s*\]|\[\s*μF\s*\]|\[\s*uF\s*\]/i,
    expectedUnits: 'pF, nF, μF',
    allowedPrefixes: [PICO, NANO, MICRO],
  },
  {
    quantity: 'Inductance',
    pattern: /\binductance\b|\[\s*nH\s*\]|\[\s*μH\s*\]|\[\s*uH\s*\]|\[\s*mH\s*\]/i,
    expectedUnits: 'nH, μH, mH',
    allowedPrefixes: [NANO, MICRO, MILLI],
  },
  {
    quantity: 'Charge',
    pattern: /\bcharge\b|\[\s*pC\s*\]|\[\s*nC\s*\]|\[\s*μC\s*\]|\[\s*uC\s*\]/i,
    expectedUnits: 'pC, nC, μC',
    allowedPrefixes: [PICO, NANO, MICRO],
  },
  {
    quantity: 'Energy',
    pattern: /\benergy\b|\[\s*nJ\s*\]|\[\s*μJ\s*\]|\[\s*uJ\s*\]|\[\s*mJ\s*\]|\[\s*J\s*\]/i,
    expectedUnits: 'nJ, μJ, mJ, J',
    allowedPrefixes: [NANO, MICRO, MILLI, BASE],
  },
  {
    quantity: 'Power',
    pattern: /\bpower\b|\[\s*mW\s*\]|\[\s*W\s*\]|\[\s*kW\s*\]/i,
    expectedUnits: 'mW, W, kW',
    allowedPrefixes: [MILLI, BASE, KILO],
  },
  {
    quantity: 'Time',
    pattern: /\btime\b|\[\s*ps\s*\]|\[\s*ns\s*\]|\[\s*μs\s*\]|\[\s*us\s*\]|\[\s*ms\s*\]|\[\s*s\s*\]/i,
    expectedUnits: 'ps, ns, μs, ms',
    allowedPrefixes: [PICO, NANO, MICRO, MILLI],
  },
  {
    quantity: 'Frequency',
    pattern: /\bfrequency\b|\[\s*Hz\s*\]|\[\s*kHz\s*\]|\[\s*MHz\s*\]|\[\s*GHz\s*\]/i,
    expectedUnits: 'Hz, kHz, MHz, GHz',
    allowedPrefixes: [BASE, KILO, MEGA, GIGA],
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

const normalizeGuidanceText = (value) => String(value || '').trim();

const normalizeBracketUnitKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ω/g, 'ω');

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

/**
 * Detect quantity keywords in graph/X/Y titles and return guidance rows for display.
 * Informational only — does not validate or restrict user input.
 */
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

/**
 * Return a cross-check warning when the selected unit prefix does not match
 * the quantity implied by the axis title (or graph title fallback).
 */
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

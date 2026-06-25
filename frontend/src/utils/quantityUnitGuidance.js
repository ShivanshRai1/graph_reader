const QUANTITY_UNIT_GUIDANCE_RULES = [
  {
    quantity: 'Thermal Resistance',
    pattern: /thermal\s*resistance/i,
    expectedUnits: '°C/W, K/W',
  },
  {
    quantity: 'Voltage',
    pattern: /\bvoltage\b/i,
    expectedUnits: 'V',
  },
  {
    quantity: 'Current',
    pattern: /\bcurrent\b/i,
    expectedUnits: 'mA, A',
  },
  {
    quantity: 'Temperature',
    pattern: /\btemperature\b/i,
    expectedUnits: '°C or K',
  },
  {
    quantity: 'Resistance',
    pattern: /\bresistance\b/i,
    expectedUnits: 'μΩ, mΩ, Ω',
  },
  {
    quantity: 'Capacitance',
    pattern: /\bcapacitance\b/i,
    expectedUnits: 'pF, nF, μF',
  },
  {
    quantity: 'Inductance',
    pattern: /\binductance\b/i,
    expectedUnits: 'nH, μH, mH',
  },
  {
    quantity: 'Charge',
    pattern: /\bcharge\b/i,
    expectedUnits: 'pC, nC, μC',
  },
  {
    quantity: 'Energy',
    pattern: /\benergy\b/i,
    expectedUnits: 'nJ, μJ, mJ, J',
  },
  {
    quantity: 'Power',
    pattern: /\bpower\b/i,
    expectedUnits: 'mW, W, kW',
  },
  {
    quantity: 'Time',
    pattern: /\btime\b/i,
    expectedUnits: 'ps, ns, μs, ms',
  },
  {
    quantity: 'Frequency',
    pattern: /\bfrequency\b/i,
    expectedUnits: 'Hz, kHz, MHz, GHz',
  },
];

const TITLE_FIELDS = [
  { source: 'Graph Title', key: 'graphTitle' },
  { source: 'X Title', key: 'xTitle' },
  { source: 'Y Title', key: 'yTitle' },
];

const normalizeGuidanceText = (value) => String(value || '').trim();

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
    });
  }
  return matches;
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

const PICO = '1e-12';
const NANO = '1e-9';
const MICRO = '1e-6';
const MILLI = '1e-3';
const BASE = '1';

const normalizeText = (value) => String(value || '').trim();

const combineTitles = ({ graphTitle = '', xTitle = '', yTitle = '' } = {}) =>
  [graphTitle, xTitle, yTitle].filter(Boolean).join(' ');

const hasCapacitanceSignal = (text) =>
  /\bcapacitance\b/i.test(text) ||
  /\bc\s*\[/i.test(text) ||
  /\[\s*pF/i.test(text) ||
  /\[\s*nF/i.test(text) ||
  /\bc\s+vs\.?\s*/i.test(text);

const hasReverseVoltageSignal = (text) =>
  /\breverse\s+voltage\b/i.test(text) ||
  /\bv\s*r\b/i.test(text) ||
  /\bvr\s*\[/i.test(text);

const hasVoltageSignal = (text) =>
  hasReverseVoltageSignal(text) ||
  /\bvoltage\b/i.test(text) ||
  /\[\s*v\s*\]/i.test(text);

const hasCurrentSignal = (text) =>
  /\bcurrent\b/i.test(text) ||
  /\[\s*mA\s*\]/i.test(text) ||
  /\[\s*a\s*\]/i.test(text) ||
  /\bi\s*\(/i.test(text);

const GRAPH_SCALE_PATTERNS = [
  {
    id: 'capacitance_vs_vr',
    label: 'Capacitance vs reverse voltage (C–V)',
    typicalNote:
      'C–V plots on diodes and MOSFETs are usually shown on logarithmic axes — verify against the printed graph.',
    componentFamilies: ['diode', 'mosfet', 'generic'],
    defaultScales: { x: 'Logarithmic', y: 'Logarithmic' },
    defaultUnits: { x: BASE, y: PICO },
    matches: ({ combined, xTitle, yTitle }) => {
      if (!hasCapacitanceSignal(combined)) return false;
      if (!hasVoltageSignal(combined)) return false;
      const axisText = `${xTitle} ${yTitle}`;
      if (hasCapacitanceSignal(yTitle) && hasVoltageSignal(xTitle)) return true;
      if (hasCapacitanceSignal(combined) && (hasReverseVoltageSignal(combined) || hasVoltageSignal(axisText))) {
        return true;
      }
      return false;
    },
  },
  {
    id: 'output_iv',
    label: 'Output / transfer characteristics (I–V)',
    typicalNote:
      'I–V output curves are usually linear on both axes — verify against the printed graph.',
    componentFamilies: ['diode', 'mosfet', 'generic'],
    defaultScales: { x: 'Linear', y: 'Linear' },
    defaultUnits: { x: BASE, y: MILLI },
    matches: ({ combined, xTitle, yTitle }) => {
      if (!/\boutput\s+characteristic|\btransfer\s+characteristic|\bdrain\s+current\b|\bi\s*[-–]\s*v\b/i.test(combined)) {
        return false;
      }
      return hasVoltageSignal(xTitle || combined) && hasCurrentSignal(yTitle || combined);
    },
  },
  {
    id: 'rds_on_vs_vgs',
    label: 'On-resistance vs gate voltage',
    typicalNote:
      'Rds(on) vs Vgs curves are usually linear — verify against the printed graph.',
    componentFamilies: ['mosfet', 'generic'],
    defaultScales: { x: 'Linear', y: 'Linear' },
    defaultUnits: { x: BASE, y: BASE },
    matches: ({ combined }) =>
      /\br\s*ds\s*\(?\s*on\s*\)?/i.test(combined) &&
      (/\bv\s*gs\b/i.test(combined) || /\bgate\s+voltage\b/i.test(combined)),
  },
  {
    id: 'safe_operating_area',
    label: 'Safe operating area (SOA)',
    typicalNote:
      'SOA plots are often logarithmic on one or both axes — verify against the printed graph.',
    componentFamilies: ['diode', 'mosfet', 'generic'],
    defaultScales: { x: 'Logarithmic', y: 'Logarithmic' },
    defaultUnits: { x: BASE, y: BASE },
    matches: ({ combined }) => /\bsafe\s+operating\s+area\b|\bsoa\b/i.test(combined),
  },
];

export const detectComponentFamily = ({
  partNumber = '',
  manufacturer = '',
  categoryTitle = '',
} = {}) => {
  const blob = `${partNumber} ${manufacturer} ${categoryTitle}`.toLowerCase();
  if (/\bdiode\b|schottky|rectifier|zener/i.test(blob)) return 'diode';
  if (/\bmosfet\b|\bfet\b|hexfet|power\s*mos/i.test(blob)) return 'mosfet';
  return 'generic';
};

export const detectGraphScalePattern = ({
  graphTitle = '',
  xTitle = '',
  yTitle = '',
} = {}) => {
  const combined = combineTitles({ graphTitle, xTitle, yTitle });
  if (!combined) return null;

  const context = {
    combined,
    graphTitle: normalizeText(graphTitle),
    xTitle: normalizeText(xTitle),
    yTitle: normalizeText(yTitle),
  };

  for (const pattern of GRAPH_SCALE_PATTERNS) {
    if (pattern.matches(context)) {
      return pattern;
    }
  }
  return null;
};

export const getPatternAxisDefaults = (pattern, axis) => {
  if (!pattern || (axis !== 'x' && axis !== 'y')) return { scale: null, unitPrefix: null };
  return {
    scale: pattern.defaultScales?.[axis] || null,
    unitPrefix: pattern.defaultUnits?.[axis] || null,
  };
};

export const getGraphPatternGuidance = ({
  graphTitle = '',
  xTitle = '',
  yTitle = '',
  partNumber = '',
  manufacturer = '',
  categoryTitle = '',
} = {}) => {
  const pattern = detectGraphScalePattern({ graphTitle, xTitle, yTitle });
  if (!pattern) return null;

  const componentFamily = detectComponentFamily({ partNumber, manufacturer, categoryTitle });
  const familyLabel =
    componentFamily === 'diode' ? 'diode' : componentFamily === 'mosfet' ? 'MOSFET' : 'this device type';

  return {
    patternId: pattern.id,
    label: pattern.label,
    componentFamily,
    message: pattern.typicalNote,
    detail:
      componentFamily === 'generic'
        ? pattern.typicalNote
        : `${pattern.label} graphs for ${familyLabel} datasheets: ${pattern.typicalNote}`,
    defaultScales: { ...pattern.defaultScales },
    defaultUnits: { ...pattern.defaultUnits },
  };
};

export const GRAPH_SCALE_PATTERN_IDS = GRAPH_SCALE_PATTERNS.map((pattern) => pattern.id);

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
  /\bc\s*\(/i.test(text) ||
  /\[\s*pF/i.test(text) ||
  /\[\s*nF/i.test(text) ||
  /\bc\s+vs\.?\s*/i.test(text);

const hasReverseVoltageSignal = (text) =>
  /\breverse\s+voltage\b/i.test(text) ||
  /\bv\s*r\b/i.test(text) ||
  /\bvr\s*\[/i.test(text);

const hasForwardVoltageSignal = (text) =>
  /\bforward\s+voltage\b/i.test(text) ||
  /\bv\s*f\b/i.test(text) ||
  /\bvf\s*\[/i.test(text);

const hasForwardCurrentSignal = (text) =>
  /\bforward\s+current\b/i.test(text) ||
  /\bi\s*f\b/i.test(text) ||
  /\bif\s*\[/i.test(text);

const hasVoltageSignal = (text) =>
  hasReverseVoltageSignal(text) ||
  hasForwardVoltageSignal(text) ||
  /\bvoltage\b/i.test(text) ||
  /\[\s*v\s*\]/i.test(text) ||
  /\bv\s*ds\b/i.test(text);

const hasCurrentSignal = (text) =>
  /\bcurrent\b/i.test(text) ||
  /\[\s*mA\s*\]/i.test(text) ||
  /\[\s*a\s*\]/i.test(text) ||
  /\bi\s*\(/i.test(text);

const CV_TYPICAL_NOTE =
  'C–V (capacitance vs reverse voltage) is a diode curve and is usually shown on logarithmic axes — verify against the printed graph.';

const IF_VF_TYPICAL_NOTE =
  'IF vs VF (forward current vs forward voltage) is a diode curve and is usually shown on linear axes — verify against the printed graph.';

const GRAPH_SCALE_PATTERNS = [
  {
    id: 'capacitance_vs_vr',
    label: 'Capacitance vs reverse voltage (C–V)',
    typicalNote: CV_TYPICAL_NOTE,
    componentFamilies: ['diode', 'generic'],
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
    id: 'forward_if_vs_vf',
    label: 'Forward current vs forward voltage (IF vs VF)',
    typicalNote: IF_VF_TYPICAL_NOTE,
    componentFamilies: ['diode', 'generic'],
    defaultScales: { x: 'Linear', y: 'Linear' },
    defaultUnits: { x: BASE, y: MILLI },
    matches: ({ combined, xTitle, yTitle }) => {
      const axisText = `${xTitle} ${yTitle}`;
      const hasIfVfPair =
        (hasForwardCurrentSignal(yTitle) && hasForwardVoltageSignal(xTitle)) ||
        (hasForwardCurrentSignal(combined) && hasForwardVoltageSignal(combined));
      if (hasIfVfPair) return true;
      if (/\bif\s+vs\.?\s*vf\b/i.test(combined)) return true;
      if (/\bforward\s+characteristic/i.test(combined) && hasCurrentSignal(yTitle || combined) && hasVoltageSignal(xTitle || combined)) {
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
    id: 'gate_charge_vs_vgs',
    label: 'Gate charge vs gate voltage (Qg vs Vgs)',
    typicalNote:
      'Gate charge curves are often logarithmic on one or both axes — verify against the printed graph.',
    componentFamilies: ['mosfet', 'generic'],
    defaultScales: { x: 'Linear', y: 'Linear' },
    defaultUnits: { x: BASE, y: BASE },
    matches: ({ combined }) =>
      (/\bgate\s+charge\b/i.test(combined) || /\bqg\b/i.test(combined)) &&
      (/\bvgs\b/i.test(combined) || /\bgate\s+voltage\b/i.test(combined)),
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

  return {
    patternId: pattern.id,
    label: pattern.label,
    componentFamily: pattern.componentFamilies?.includes('diode') ? 'diode' : 'generic',
    message: pattern.typicalNote,
    detail: pattern.typicalNote,
    defaultScales: { ...pattern.defaultScales },
    defaultUnits: { ...pattern.defaultUnits },
  };
};

export const GRAPH_SCALE_PATTERN_IDS = GRAPH_SCALE_PATTERNS.map((pattern) => pattern.id);

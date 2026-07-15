/**
 * DiscoverEE text prep for company API payloads and responses.
 *
 * DISPLAY (parseDiscoverEeTextField): repair known corruption so the UI shows μ.
 * WIRE (prepareDiscoverEeTextField): stabilize unicode WITHOUT rewriting DiscoverEE's
 * stored keys — never turn "1?F" into "1μF" on POST or append matching remaps to another graph.
 */

const MICRO_SIGN = '\u00B5'; // µ
const GREEK_MU = '\u03BC'; // μ
const OHM_SIGN = '\u2126'; // Ω
const GREEK_OMEGA = '\u03A9'; // Ω

/** UTF-8 μ (CE BC) mis-read as Latin-1 Î¼ */
const MOJIBAKE_MU = '\u00CE\u00BC';
/** UTF-8 µ (C2 B5) mis-read as Latin-1 Âµ */
const MOJIBAKE_MICRO_SIGN = '\u00C2\u00B5';

const normalizeUnicodeStable = (value) => {
  if (value == null) return '';
  let text = String(value);
  if (!text) return '';

  try {
    text = text.normalize('NFC');
  } catch {
    /* ignore environments without String#normalize */
  }

  text = text.split(MOJIBAKE_MU).join(GREEK_MU);
  text = text.split(MOJIBAKE_MICRO_SIGN).join(GREEK_MU);
  text = text.split(MICRO_SIGN).join(GREEK_MU);
  text = text.split(OHM_SIGN).join(GREEK_OMEGA);
  return text;
};

/** Repair DiscoverEE GET / URL text for UI display only (1?F → 1μF, 1uF → 1μF). */
export const parseDiscoverEeTextField = (value) => {
  let text = normalizeUnicodeStable(value);
  if (!text) return '';

  text = text.replace(/(\d)\?([FfHhAaVvSs])/g, (_, digit, unit) => `${digit}${GREEK_MU}${unit}`);
  text = text.replace(/(\d)u([FfHhAaVvSs])\b/g, (_, digit, unit) => `${digit}${GREEK_MU}${unit}`);
  return text;
};

/**
 * Prepare a free-text field for DiscoverEE JSON POST.
 * NFC + lookalike unification only — does NOT invent μ from ?/u (that splits appends).
 */
export const prepareDiscoverEeTextField = (value) => normalizeUnicodeStable(value);

/** Apply prepareDiscoverEeTextField to every string value in a plain object (shallow). */
export const prepareDiscoverEeStringFields = (fields = {}) => {
  const next = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (typeof value === 'string') {
      next[key] = prepareDiscoverEeTextField(value);
    } else {
      next[key] = value;
    }
  });
  return next;
};

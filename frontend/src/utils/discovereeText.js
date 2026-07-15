/**
 * DiscoverEE text prep for company API payloads.
 * UI keeps whatever the user typed; wire values are Unicode-stable so append
 * matching does not split graphs when titles contain μ / µ / Ω variants.
 */

const MICRO_SIGN = '\u00B5'; // µ
const GREEK_MU = '\u03BC'; // μ
const OHM_SIGN = '\u2126'; // Ω
const GREEK_OMEGA = '\u03A9'; // Ω

/**
 * Prepare a free-text field for DiscoverEE JSON POST.
 * - Preserves all symbols (no stripping / ASCII fallback)
 * - NFC so composed/decomposed forms match
 * - Unifies common lookalike unit characters
 */
export const prepareDiscoverEeTextField = (value) => {
  if (value == null) return '';
  let text = String(value);
  if (!text) return '';

  try {
    text = text.normalize('NFC');
  } catch {
    /* ignore environments without String#normalize */
  }

  return text.split(MICRO_SIGN).join(GREEK_MU).split(OHM_SIGN).join(GREEK_OMEGA);
};

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

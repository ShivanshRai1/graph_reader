/**
 * Manual-capture OCR helpers (Tesseract.js).
 * Used only after "Capture Manually" — does not touch AI extraction.
 * Results are applied into existing form fields; user can edit anytime.
 */

const TITLE_HINT =
  /\b(figure|fig\.?|typical|characteristic|output|transfer|forward|reverse|efficiency|capacitance|voltage|current|bode|transient)\b/i;

const parseNumericToken = (raw) => {
  const text = String(raw || '')
    .trim()
    .replace(/,/g, '')
    .replace(/[^\d.eE+\-]/g, '');
  if (!text || text === '.' || text === '-' || text === '+') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return value;
};

const collectAxisNumbers = (words, { x0, y0, x1, y1 }) => {
  const hits = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const box = word?.bbox;
    if (!box) return;
    const cx = (Number(box.x0) + Number(box.x1)) / 2;
    const cy = (Number(box.y0) + Number(box.y1)) / 2;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return;
    const value = parseNumericToken(word.text);
    if (value == null) return;
    hits.push({ value, cx, cy, text: String(word.text || '').trim() });
  });
  return hits;
};

const pickExtremeByAxis = (hits, axis, preferMin) => {
  if (!hits.length) return null;
  const sorted = [...hits].sort((a, b) => (axis === 'x' ? a.cx - b.cx : a.cy - b.cy));
  const pick = preferMin ? sorted[0] : sorted[sorted.length - 1];
  return pick?.value ?? null;
};

const extractTitleFromWords = (words, imageWidth, imageHeight) => {
  const topBand = imageHeight * 0.22;
  const candidates = [];

  (Array.isArray(words) ? words : []).forEach((word) => {
    const box = word?.bbox;
    if (!box) return;
    const cy = (Number(box.y0) + Number(box.y1)) / 2;
    if (cy > topBand) return;
    const text = String(word.text || '').trim();
    if (!text) return;
    candidates.push({
      text,
      x0: Number(box.x0),
      y0: Number(box.y0),
      y1: Number(box.y1),
    });
  });

  if (!candidates.length) return '';

  // Group into rough lines by y.
  candidates.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  candidates.forEach((item) => {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(item.y0 - last.y0) > imageHeight * 0.03) {
      lines.push({ y0: item.y0, parts: [item] });
    } else {
      last.parts.push(item);
    }
  });

  const lineTexts = lines.map((line) => {
    const parts = [...line.parts].sort((a, b) => a.x0 - b.x0);
    return parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
  }).filter(Boolean);

  const hinted = lineTexts.find((line) => TITLE_HINT.test(line) && line.length >= 8);
  if (hinted) return hinted.slice(0, 180);

  const longest = [...lineTexts].sort((a, b) => b.length - a.length)[0] || '';
  return longest.length >= 6 ? longest.slice(0, 180) : '';
};

const normalizeMinMax = (minValue, maxValue) => {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
  if (minValue === maxValue) return null;
  return minValue < maxValue
    ? { min: minValue, max: maxValue }
    : { min: maxValue, max: minValue };
};

/**
 * @param {string} imageSrc data URL or http(s) image URL
 * @returns {Promise<{ curveTitle: string, xMin: number|null, xMax: number|null, yMin: number|null, yMax: number|null }>}
 */
export const extractManualGraphFieldsFromImage = async (imageSrc) => {
  const empty = { curveTitle: '', xMin: null, xMax: null, yMin: null, yMax: null };
  const src = String(imageSrc || '').trim();
  if (!src) return empty;

  let Tesseract;
  try {
    Tesseract = (await import('tesseract.js')).default;
  } catch (error) {
    console.warn('[MANUAL OCR] Failed to load tesseract.js:', error);
    return empty;
  }

  let result;
  try {
    result = await Tesseract.recognize(src, 'eng', {
      logger: () => {},
    });
  } catch (error) {
    console.warn('[MANUAL OCR] Recognize failed:', error);
    return empty;
  }

  const words = result?.data?.words || [];
  const imageWidth = Number(result?.data?.imageWidth) || 0;
  const imageHeight = Number(result?.data?.imageHeight) || 0;

  // Fallback dimensions from first word bboxes if meta missing.
  let width = imageWidth;
  let height = imageHeight;
  if (!width || !height) {
    words.forEach((word) => {
      const box = word?.bbox;
      if (!box) return;
      width = Math.max(width, Number(box.x1) || 0);
      height = Math.max(height, Number(box.y1) || 0);
    });
  }
  if (!width || !height) {
    return {
      ...empty,
      curveTitle: extractTitleFromWords(words, 1000, 1000),
    };
  }

  const leftBand = collectAxisNumbers(words, {
    x0: 0,
    y0: height * 0.12,
    x1: width * 0.22,
    y1: height * 0.88,
  });
  const bottomBand = collectAxisNumbers(words, {
    x0: width * 0.12,
    y0: height * 0.78,
    x1: width * 0.98,
    y1: height,
  });

  // Y axis: top of plot ≈ max, bottom ≈ min (screen y increases downward).
  const yMax = pickExtremeByAxis(leftBand, 'y', true);
  const yMin = pickExtremeByAxis(leftBand, 'y', false);
  const xMin = pickExtremeByAxis(bottomBand, 'x', true);
  const xMax = pickExtremeByAxis(bottomBand, 'x', false);

  const xRange = normalizeMinMax(xMin, xMax);
  const yRange = normalizeMinMax(yMin, yMax);

  return {
    curveTitle: extractTitleFromWords(words, width, height),
    xMin: xRange?.min ?? null,
    xMax: xRange?.max ?? null,
    yMin: yRange?.min ?? null,
    yMax: yRange?.max ?? null,
  };
};

/** True when form still has manual-capture reset defaults (safe to auto-fill). */
export const isManualOcrDefaultAxisConfig = (config = {}) => {
  const xMin = Number(config.xMin);
  const xMax = Number(config.xMax);
  const yMin = Number(config.yMin);
  const yMax = Number(config.yMax);
  return xMin === 0 && xMax === 100 && yMin === 0 && yMax === 100;
};

/**
 * Manual-capture OCR helpers (Tesseract.js).
 * Used only after "Capture Manually" — does not touch AI extraction.
 * Results are written into existing form fields; user can edit anytime.
 */

const TITLE_HINT =
  /\b(figure|fig\.?|typical|characteristic|output|transfer|forward|reverse|efficiency|capacitance|voltage|current|bode|transient|regulation|load)\b/i;

const AXIS_LABEL_HINT =
  /\b(vout|vin|iout|iin|isd|vsd|ids|vds|vgs|normalized|efficiency|temperature|freq|frequency|gain|phase|time|current|voltage|power|%|amp|ohm)\b/i;

const parseNumericToken = (raw) => {
  let text = String(raw || '').trim().replace(/,/g, '');
  // Common OCR glitches: O/o for 0, l/I for 1
  text = text.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
  text = text.replace(/[^\d.eE+\-]/g, '');
  if (!text || text === '.' || text === '-' || text === '+') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  // Ignore tiny OCR fragments that are almost never axis ends on datasheet plots.
  if (Math.abs(value) > 1e9) return null;
  return value;
};

const wordCenter = (word) => {
  const box = word?.bbox;
  if (!box) return null;
  return {
    cx: (Number(box.x0) + Number(box.x1)) / 2,
    cy: (Number(box.y0) + Number(box.y1)) / 2,
    x0: Number(box.x0),
    y0: Number(box.y0),
    x1: Number(box.x1),
    y1: Number(box.y1),
    text: String(word.text || '').trim(),
  };
};

const collectAxisNumbers = (words, { x0, y0, x1, y1 }) => {
  const hits = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center) return;
    if (center.cx < x0 || center.cx > x1 || center.cy < y0 || center.cy > y1) return;
    const value = parseNumericToken(center.text);
    if (value == null) return;
    hits.push({ value, cx: center.cx, cy: center.cy, text: center.text });
  });
  return hits;
};

const uniqueSortedValues = (hits, axis) => {
  const sorted = [...hits].sort((a, b) => (axis === 'x' ? a.cx - b.cx : a.cy - b.cy));
  const values = [];
  sorted.forEach((hit) => {
    const last = values[values.length - 1];
    if (last == null || Math.abs(last - hit.value) > 1e-9) {
      values.push(hit.value);
    }
  });
  return values;
};

const pickAxisRangeFromHits = (hits, axis) => {
  const values = uniqueSortedValues(hits, axis);
  if (values.length < 2) return null;
  // Prefer outermost tick labels (first/last along the axis band).
  const first = values[0];
  const last = values[values.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === last) return null;
  return first < last ? { min: first, max: last } : { min: last, max: first };
};

const groupWordsIntoLines = (items, imageHeight) => {
  const sorted = [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  sorted.forEach((item) => {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(item.y0 - last.y0) > imageHeight * 0.028) {
      lines.push({ y0: item.y0, parts: [item] });
    } else {
      last.parts.push(item);
    }
  });
  return lines.map((line) => {
    const parts = [...line.parts].sort((a, b) => a.x0 - b.x0);
    return {
      y0: line.y0,
      text: parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
    };
  }).filter((line) => line.text);
};

const extractTitleFromWords = (words, imageWidth, imageHeight) => {
  const topBand = imageHeight * 0.24;
  const candidates = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center || center.cy > topBand) return;
    if (!center.text) return;
    // Skip pure numbers in the title band.
    if (parseNumericToken(center.text) != null && !/[A-Za-z]/.test(center.text)) return;
    candidates.push(center);
  });
  if (!candidates.length) return '';

  const lineTexts = groupWordsIntoLines(candidates, imageHeight).map((l) => l.text);
  const hinted = lineTexts.find((line) => TITLE_HINT.test(line) && line.length >= 8);
  if (hinted) return hinted.slice(0, 180);
  const longest = [...lineTexts].sort((a, b) => b.length - a.length)[0] || '';
  return longest.length >= 6 ? longest.slice(0, 180) : '';
};

const extractAxisTitleFromBand = (words, band, imageHeight) => {
  const items = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center) return;
    if (center.cx < band.x0 || center.cx > band.x1 || center.cy < band.y0 || center.cy > band.y1) return;
    if (!center.text) return;
    // Axis titles are text-heavy; skip lone numbers.
    if (parseNumericToken(center.text) != null && !/[A-Za-z%]/.test(center.text)) return;
    items.push(center);
  });
  if (!items.length) return '';
  const lines = groupWordsIntoLines(items, imageHeight).map((l) => l.text);
  const hinted = lines.find((line) => AXIS_LABEL_HINT.test(line) && line.length >= 2);
  if (hinted) return hinted.slice(0, 80);
  const longest = [...lines].sort((a, b) => b.length - a.length)[0] || '';
  return longest.length >= 2 ? longest.slice(0, 80) : '';
};

const resolveImageSize = (words, imageWidth, imageHeight) => {
  let width = Number(imageWidth) || 0;
  let height = Number(imageHeight) || 0;
  if (!width || !height) {
    (Array.isArray(words) ? words : []).forEach((word) => {
      const box = word?.bbox;
      if (!box) return;
      width = Math.max(width, Number(box.x1) || 0);
      height = Math.max(height, Number(box.y1) || 0);
    });
  }
  return { width, height };
};

/**
 * @param {string} imageSrc data URL or http(s) image URL
 * @returns {Promise<{
 *   graphTitle: string,
 *   curveTitle: string,
 *   xTitle: string,
 *   yTitle: string,
 *   xMin: number|null,
 *   xMax: number|null,
 *   yMin: number|null,
 *   yMax: number|null,
 * }>}
 */
export const extractManualGraphFieldsFromImage = async (imageSrc) => {
  const empty = {
    graphTitle: '',
    curveTitle: '',
    xTitle: '',
    yTitle: '',
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  };
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
    console.log('[MANUAL OCR] Starting Tesseract recognize…');
    result = await Tesseract.recognize(src, 'eng', {
      logger: (message) => {
        if (message?.status === 'recognizing text' && message?.progress != null) {
          const pct = Math.round(Number(message.progress) * 100);
          if (pct === 0 || pct === 50 || pct === 100) {
            console.log('[MANUAL OCR] progress', `${pct}%`);
          }
        }
      },
    });
  } catch (error) {
    console.warn('[MANUAL OCR] Recognize failed:', error);
    return empty;
  }

  const words = result?.data?.words || [];
  const { width, height } = resolveImageSize(
    words,
    result?.data?.imageWidth,
    result?.data?.imageHeight
  );

  if (!width || !height) {
    const title = extractTitleFromWords(words, 1000, 1000);
    return { ...empty, graphTitle: title, curveTitle: title };
  }

  const leftBand = collectAxisNumbers(words, {
    x0: 0,
    y0: height * 0.1,
    x1: width * 0.28,
    y1: height * 0.9,
  });
  const bottomBand = collectAxisNumbers(words, {
    x0: width * 0.1,
    y0: height * 0.72,
    x1: width * 0.98,
    y1: height,
  });

  // Y: top of left band ≈ max, bottom ≈ min (screen y grows downward).
  const yValues = uniqueSortedValues(leftBand, 'y');
  const yMax = yValues.length ? yValues[0] : null;
  const yMin = yValues.length > 1 ? yValues[yValues.length - 1] : null;
  const yRange =
    Number.isFinite(yMin) && Number.isFinite(yMax) && yMin !== yMax
      ? (yMin < yMax ? { min: yMin, max: yMax } : { min: yMax, max: yMin })
      : null;
  const xRange = pickAxisRangeFromHits(bottomBand, 'x');

  const graphTitle = extractTitleFromWords(words, width, height);
  const xTitle = extractAxisTitleFromBand(
    words,
    { x0: width * 0.2, y0: height * 0.86, x1: width * 0.95, y1: height },
    height
  );
  const yTitle = extractAxisTitleFromBand(
    words,
    { x0: 0, y0: height * 0.15, x1: width * 0.2, y1: height * 0.85 },
    height
  );

  const fields = {
    graphTitle,
    curveTitle: graphTitle,
    xTitle,
    yTitle,
    xMin: xRange?.min ?? null,
    xMax: xRange?.max ?? null,
    yMin: yRange?.min ?? null,
    yMax: yRange?.max ?? null,
  };

  console.log('[MANUAL OCR] Extracted fields:', fields);
  return fields;
};

/**
 * Manual-capture OCR helpers (Tesseract.js).
 * Used only after "Capture Manually" — does not touch AI extraction.
 * Results are written into existing form fields; user can edit anytime.
 *
 * Axis titles: full-image pass + cropped passes.
 * Vertical Y labels are rotated to horizontal before OCR (CW and CCW; best wins).
 * Axis ticks: dedicated digit-only crops (more reliable than full-page sparse hits).
 */

const FIGURE_CAPTION_RE =
  /\b(?:fig(?:ure)?\.?\s*\d+[.:)]?\s*)(.+)/i;

const VS_SPLIT_RE = /\s+vs\.?\s+/i;

const AXIS_LABEL_HINT =
  /\b(vout|vin|iout|i_out|iin|isd|vsd|ids|vds|vgs|normalized|efficiency|temperature|freq|frequency|gain|phase|time|current|voltage|power|load|regulation|amp|ohm|watt)\b|[%°]|\$[A-Za-z]|_\{|(\([A-Za-zµμΩ/%]+\))/i;

const parseNumericToken = (raw) => {
  let text = String(raw || '').trim().replace(/,/g, '');
  text = text.replace(/[Oo]/g, '0');
  if (/^[-+]?[\d.lI]+([eE][-+]?\d+)?$/.test(text)) {
    text = text.replace(/[lI]/g, '1');
  }
  text = text.replace(/[^\d.eE+-]/g, '');
  if (!text || text === '.' || text === '-' || text === '+') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) > 1e9) return null;
  return value;
};

const extractNumbersFromText = (text) => {
  const matches = String(text || '').match(/[-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  return matches
    .map((token) => parseNumericToken(token))
    .filter((value) => value != null);
};

const wordCenter = (word) => {
  const box = word?.bbox;
  if (!box) return null;
  const conf = Number(word.confidence);
  return {
    cx: (Number(box.x0) + Number(box.x1)) / 2,
    cy: (Number(box.y0) + Number(box.y1)) / 2,
    x0: Number(box.x0),
    y0: Number(box.y0),
    x1: Number(box.x1),
    y1: Number(box.y1),
    text: String(word.text || '').trim(),
    confidence: Number.isFinite(conf) ? conf : 100,
  };
};

const collectAxisNumbers = (words, { x0, y0, x1, y1 }, { minConfidence = 35 } = {}) => {
  const hits = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center) return;
    if (center.confidence < minConfidence) return;
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

const rangeFromValues = (values) => {
  const unique = [];
  [...values]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .forEach((value) => {
      const last = unique[unique.length - 1];
      if (last == null || Math.abs(last - value) > 1e-9) unique.push(value);
    });
  if (unique.length < 2) return null;
  return {
    min: unique[0],
    max: unique[unique.length - 1],
    count: unique.length,
    values: unique,
  };
};

/** Prefer denser / wider tick sets; reject weak 2-point fragments (e.g. 0..100, 2..5). */
const preferBetterRange = (primary, secondary) => {
  const score = (range) => {
    if (!range) return -Infinity;
    const span = Math.abs(range.max - range.min);
    const count = range.count || 0;
    let s = count * 12 + Math.log10(span + 1) * 6;
    if (count <= 2 && span <= 5 && Number.isInteger(range.min) && Number.isInteger(range.max)) {
      s -= 40;
    }
    // Placeholder-like endpoints with no interior ticks are almost never real datasheet axes.
    if (count <= 2 && range.min === 0 && range.max === 100) s -= 80;
    if (count <= 2 && range.min === 0 && range.max === 10) s -= 20;
    return s;
  };
  const a = score(primary);
  const b = score(secondary);
  if (a === -Infinity && b === -Infinity) return null;
  return b > a ? secondary : primary;
};

/** Drop clearly bogus OCR ranges so we don't overwrite form defaults with junk. */
const sanitizeAxisRange = (range) => {
  if (!range) return null;
  if (!(range.count >= 2)) return null;
  if (range.count <= 2 && range.min === 0 && range.max === 100) return null;
  if (range.count <= 2 && Math.abs(range.max - range.min) <= 5 && Number.isInteger(range.min) && Number.isInteger(range.max)) {
    // e.g. 2..5 from splitting "25"
    return null;
  }
  return range;
};

/**
 * When OCR misses an end tick, extend one step when spacing is uniform
 * (e.g. -0.75..1 → -1..1, or -1..0.75 → -1..1).
 */
const extendUniformTickRange = (range) => {
  if (!range) return range;
  let min = range.min;
  let max = range.max;
  const vals = Array.isArray(range.values) ? range.values : [min, max];

  // Common normalized-axis miss: one end tick dropped (±0.75 vs ±1).
  if (Math.abs(min + 1) < 1e-6 && Math.abs(max - 0.75) < 1e-6) {
    max = 1;
  } else if (Math.abs(max - 1) < 1e-6 && Math.abs(min + 0.75) < 1e-6) {
    min = -1;
  }

  if (vals.length >= 3) {
    const diffs = [];
    for (let i = 1; i < vals.length; i += 1) {
      const d = Number((vals[i] - vals[i - 1]).toFixed(6));
      if (d > 0) diffs.push(d);
    }
    if (diffs.length) {
      diffs.sort((a, b) => a - b);
      const step = diffs[Math.floor(diffs.length / 2)];
      if (step > 0) {
        const uniform = diffs.every((d) => Math.abs(d - step) <= step * 0.25 + 1e-9);
        if (uniform) {
          const nearMirror = Math.abs(Math.abs(max) - Math.abs(min)) <= step * 1.15 + 1e-9;
          if (nearMirror && Math.abs(max) > Math.abs(min) + 1e-9) {
            const extMin = Number((min - step).toFixed(6));
            if (Math.abs(extMin + max) <= step * 0.2 + 1e-9) min = extMin;
          }
          if (nearMirror && Math.abs(min) > Math.abs(max) + 1e-9) {
            const extMax = Number((max + step).toFixed(6));
            if (Math.abs(extMax + min) <= step * 0.2 + 1e-9) max = extMax;
          }
        }
      }
    }
  }

  if (min === range.min && max === range.max) return range;
  return rangeFromValues([min, ...vals, max]) || { ...range, min, max, count: range.count };
};

/** Repair "1.00" read as 100 when neighboring ticks are fractional. */
const repairDroppedDecimals = (values) => {
  const list = values.filter((v) => Number.isFinite(v));
  const hasFraction = list.some((v) => Math.abs(v % 1) > 1e-9 && Math.abs(v) <= 10);
  if (!hasFraction) return list;
  return list.map((v) => {
    if (Math.abs(v) >= 10 && Math.abs(v) <= 1000 && Number.isInteger(v)) {
      const repaired = v / 100;
      if (Math.abs(repaired) <= 10) return repaired;
    }
    return v;
  });
};

/** Prefer tick values that form a dense low-span sequence (drop stray 100 when 0..25 exists). */
const refineTickValues = (values, axis) => {
  let list = repairDroppedDecimals(values.filter((v) => Number.isFinite(v)));
  if (axis === 'x') {
    const modest = list.filter((v) => v >= -1 && v <= 50);
    if (modest.length >= 3) list = modest;
    if (list.includes(100) && list.some((v) => v > 0 && v <= 50)) {
      list = list.filter((v) => v !== 100);
    }
  }
  if (axis === 'y') {
    const modest = list.filter((v) => Math.abs(v) <= 20);
    if (modest.length >= 3) list = modest;
  }
  return list;
};

const groupWordsIntoLines = (items, imageHeight) => {
  const sorted = [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  sorted.forEach((item) => {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(item.y0 - last.y0) > imageHeight * 0.028) {
      lines.push({ y0: item.y0, y1: item.y1 ?? item.y0, parts: [item] });
    } else {
      last.parts.push(item);
      last.y1 = Math.max(last.y1, item.y1 ?? item.y0);
    }
  });
  return lines
    .map((line) => {
      const parts = [...line.parts].sort((a, b) => a.x0 - b.x0);
      return {
        y0: line.y0,
        y1: line.y1,
        text: parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((line) => line.text);
};

const cleanCaptionText = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\bFig(?:ure)?\.?\s*(\d+)/i, 'Figure $1')
    .trim();

const normalizeAxisLabelText = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\$\\?mathrm\{([^}]+)\}/gi, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\bI\s*[_ ]?\s*OUT\b/gi, 'I_OUT')
    .replace(/\bIOUT\b/gi, 'I_OUT')
    .replace(/\bIout\b/g, 'I_OUT')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();

/** Pull whatever OCR put inside (...), e.g. %, A, V, mA — do not invent units. */
const extractParenUnits = (text) => {
  const units = [];
  const pushUnit = (raw) => {
    const unit = String(raw || '').trim();
    if (!unit || unit.length > 16) return;
    if (!/[A-Za-z%°µμΩ0-9/]/.test(unit)) return;
    if (!units.some((existing) => existing.toLowerCase() === unit.toLowerCase())) {
      units.push(unit);
    }
  };

  const source = String(text || '');
  const re = /\(\s*([^)]+?)\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    pushUnit(match[1]);
  }

  const bare = source.trim();
  // Standalone unit fragments OCR sometimes returns on their own line.
  if (/^\(\s*[^)]+\s*\)$/.test(bare)) {
    pushUnit(bare.replace(/^\(\s*|\s*\)$/g, ''));
  } else if (/^[%°µμΩ]+$/.test(bare)) {
    pushUnit(bare);
  }

  return units;
};

const stripParenUnits = (text) =>
  normalizeAxisLabelText(text)
    .replace(/\(\s*[^)]+\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isUnitOnlyLabel = (text) => {
  const t = normalizeAxisLabelText(text);
  return !t || /^\(\s*[^)]+\s*\)$/.test(t) || /^[%°µμΩ]+$/.test(t);
};

/** Keep printed name; attach a parenthetical unit only when OCR actually saw one. */
const polishAxisTitle = (text, unitFromOcr = '') => {
  let t = normalizeAxisLabelText(text);
  if (!t || isUnitOnlyLabel(t)) return '';
  const existingUnits = extractParenUnits(t);
  if (existingUnits.length) return t.slice(0, 80);
  const unit = String(unitFromOcr || '').trim();
  if (unit) {
    const base = stripParenUnits(t);
    if (base) return `${base} (${unit})`.slice(0, 80);
  }
  return t.slice(0, 80);
};

const isFigureCaptionText = (text) => FIGURE_CAPTION_RE.test(String(text || '').trim());

/** Reject OCR noise like: Z aw our " LE VU (A) */
const looksLikeGarbageTitle = (text) => {
  const t = normalizeAxisLabelText(text);
  if (!t) return true;
  if (isFigureCaptionText(t)) return true;
  if (/["'`]/.test(t)) return true;
  if (/^\d/.test(t)) return true;
  if ((t.match(/[^A-Za-z0-9%°µμΩ()_/\s.-]/g) || []).length >= 2) return true;

  const withoutUnit = stripParenUnits(t);
  const tokens = withoutUnit.split(/\s+/).filter(Boolean);
  const shortTokens = tokens.filter((w) => w.length <= 3);
  if (tokens.length >= 4 && !AXIS_LABEL_HINT.test(t)) return true;
  if (shortTokens.length >= 3 && !/\bi_out\b|\bnormalized\b|\bvoltage\b|\bcurrent\b/i.test(t)) {
    return true;
  }
  // Random letter salad with a trailing unit still counts as garbage.
  if (tokens.length >= 3 && shortTokens.length >= 2 && /\([^)]+\)/.test(t) && !AXIS_LABEL_HINT.test(withoutUnit)) {
    return true;
  }
  return false;
};

const isGarbageAxisLabel = (text) => {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return true;
  if (looksLikeGarbageTitle(t)) return true;
  if (/^figure\b/i.test(t)) return true;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const junk = (t.match(/[^A-Za-z0-9%°µμΩ()_/\s.-]/g) || []).length;
  if (letters < 2) return true;
  if (junk >= Math.max(2, letters)) return true;
  if ((t.match(/\b[A-Za-z]\b/g) || []).length >= 2 && letters <= 6 && !AXIS_LABEL_HINT.test(t)) {
    return true;
  }
  if (!AXIS_LABEL_HINT.test(t) && t.length <= 8 && letters <= 4) return true;
  return false;
};

const scoreAxisLabel = (text, axis = '') => {
  const t = normalizeAxisLabelText(text);
  if (isGarbageAxisLabel(t) || looksLikeGarbageTitle(t)) return -1;
  let score = Math.min(stripParenUnits(t).length, 30);
  if (AXIS_LABEL_HINT.test(t)) score += 40;
  if (/\bnormalized\b/i.test(t)) score += 50;
  if (/\bi_out\b|\biout\b|\bi\s*out\b/i.test(t)) score += 80;
  if (/\([A-Za-zµμΩ/%]+\)/.test(t)) score += 25;
  if (stripParenUnits(t).split(/\s+/).length <= 3) score += 10;

  // Printed axis symbols beat figure-caption "A vs. B" prose.
  if (axis === 'x' && /\bload\s+current\b/i.test(t) && !/\bi_out\b/i.test(t)) score -= 55;
  if (axis === 'y' && /\bload\s+regulation\b/i.test(t) && !/\bnormalized\b/i.test(t)) score -= 40;
  // Don't let Y's (%) leak onto X caption prose.
  if (axis === 'x' && /\(%\)/.test(t) && !/\bi_out\b|\bnormalized\b/i.test(t)) score -= 45;
  if (axis === 'y' && /\(%\)/.test(t)) score += 30;
  if (axis === 'x' && /\(\s*A\s*\)/i.test(t)) score += 35;
  return score;
};

const pickBestAxisLabel = (axis, candidates = [], { unitSources = [] } = {}) => {
  const expanded = [];
  (Array.isArray(candidates) ? candidates : [candidates]).flat().forEach((raw) => {
    if (raw == null) return;
    const text = String(raw).trim();
    if (text) expanded.push(text);
  });

  // Units only from this axis's sources — never invent, never cross-wire X↔Y units.
  const units = [];
  [...expanded, ...unitSources].forEach((line) => {
    extractParenUnits(line).forEach((unit) => {
      if (!units.some((existing) => existing.toLowerCase() === unit.toLowerCase())) {
        units.push(unit);
      }
    });
  });

  const names = expanded
    .map((line) => stripParenUnits(line))
    .filter((name) => name && !isUnitOnlyLabel(name) && !isGarbageAxisLabel(name) && !looksLikeGarbageTitle(name));
  units.forEach((unit) => {
    names.forEach((name) => {
      if (!/\([^)]+\)/.test(name)) {
        expanded.push(`${name} (${unit})`);
      }
    });
  });

  let best = '';
  let bestScore = -1;
  expanded.forEach((raw) => {
    if (isUnitOnlyLabel(raw) || looksLikeGarbageTitle(raw)) return;
    const unitHint = extractParenUnits(raw)[0] || units[0] || '';
    const text = polishAxisTitle(raw, unitHint);
    if (!text || looksLikeGarbageTitle(text)) return;
    const score = scoreAxisLabel(text, axis);
    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  });
  return bestScore >= 40 ? best : '';
};

const allLineTexts = (words, imageHeight, fullText) => {
  const items = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center?.text) return;
    items.push(center);
  });
  const fromWords = groupWordsIntoLines(items, imageHeight || 1000).map((l) => l.text);
  const fromFull = String(fullText || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...fromWords, ...fromFull];
};

const extractGraphTitle = (words, imageWidth, imageHeight, fullText) => {
  const lines = allLineTexts(words, imageHeight, fullText);
  const figureLine = lines.find((line) => isFigureCaptionText(line) && line.length >= 10);
  if (figureLine) return cleanCaptionText(figureLine).slice(0, 180);

  const marginItems = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center?.text) return;
    const inTop = center.cy <= imageHeight * 0.22;
    const inBottom = center.cy >= imageHeight * 0.82;
    if (!inTop && !inBottom) return;
    if (parseNumericToken(center.text) != null && !/[A-Za-z]/.test(center.text)) return;
    marginItems.push(center);
  });
  const marginLines = groupWordsIntoLines(marginItems, imageHeight).map((l) => l.text);
  const hinted = marginLines.find(
    (line) =>
      /\b(typical|characteristic|efficiency|regulation|bode|transient|output|transfer)\b/i.test(line) &&
      line.length >= 8
  );
  if (hinted) return cleanCaptionText(hinted).slice(0, 180);
  const longest = [...marginLines].sort((a, b) => b.length - a.length)[0] || '';
  return longest.length >= 8 ? cleanCaptionText(longest).slice(0, 180) : '';
};

const titlesFromVsPattern = (graphTitle) => {
  const cleaned = cleanCaptionText(graphTitle).replace(FIGURE_CAPTION_RE, '$1').trim();
  const parts = cleaned.split(VS_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return { xTitle: '', yTitle: '' };
  return {
    yTitle: parts[0].slice(0, 80),
    xTitle: parts[1].slice(0, 80),
  };
};

const extractAxisTitleFromBand = (words, band, imageHeight, { allowVerticalJoin = false } = {}) => {
  const items = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center?.text) return;
    if (center.cx < band.x0 || center.cx > band.x1 || center.cy < band.y0 || center.cy > band.y1) return;
    if (parseNumericToken(center.text) != null && !/[A-Za-z%]/.test(center.text)) return;
    items.push(center);
  });
  if (!items.length) return '';

  const lines = groupWordsIntoLines(items, imageHeight)
    .map((l) => l.text)
    .filter((text) => !isGarbageAxisLabel(text) && !isFigureCaptionText(text));

  const hinted = lines.find((line) => AXIS_LABEL_HINT.test(line) && line.length >= 2);
  if (hinted) return hinted.slice(0, 80);

  if (allowVerticalJoin) {
    const stacked = [...items]
      .sort((a, b) => a.cy - b.cy)
      .map((p) => p.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!isGarbageAxisLabel(stacked) && AXIS_LABEL_HINT.test(stacked)) {
      return stacked.slice(0, 80);
    }
  }

  const longest = [...lines].sort((a, b) => b.length - a.length)[0] || '';
  if (!longest || isGarbageAxisLabel(longest)) return '';
  return longest.slice(0, 80);
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

const findFigureCaptionY = (words, imageHeight, fullText) => {
  const items = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center?.text) return;
    items.push(center);
  });
  const lines = groupWordsIntoLines(items, imageHeight);
  const figure = lines.find((line) => isFigureCaptionText(line.text));
  if (figure) return figure.y0;
  if (FIGURE_CAPTION_RE.test(String(fullText || ''))) return imageHeight * 0.9;
  return null;
};

const loadHtmlImage = (src) =>
  new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image API unavailable'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for OCR crops'));
    img.src = src;
  });

const canvasToDataUrl = (canvas, scale = 3, { highContrast = false } = {}) => {
  let source = canvas;
  if (highContrast) {
    const boosted = document.createElement('canvas');
    boosted.width = canvas.width;
    boosted.height = canvas.height;
    const bctx = boosted.getContext('2d');
    bctx.drawImage(canvas, 0, 0);
    const image = bctx.getImageData(0, 0, boosted.width, boosted.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const v = gray < 170 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    bctx.putImageData(image, 0, 0);
    source = boosted;
  }

  if (scale <= 1) return source.toDataURL('image/png');
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
};

/**
 * Crop a rect from the source image; optional 90° rotation so vertical text becomes horizontal.
 * rotateDeg: 0 | 90 (CW) | -90 (CCW)
 */
const cropRegionToDataUrl = (img, rect, rotateDeg = 0, scale = 3, { highContrast = false } = {}) => {
  if (typeof document === 'undefined') return null;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const sx = Math.max(0, Math.floor(rect.x));
  const sy = Math.max(0, Math.floor(rect.y));
  const sw = Math.min(iw - sx, Math.floor(rect.w));
  const sh = Math.min(ih - sy, Math.floor(rect.h));
  if (sw < 8 || sh < 8) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const sctx = srcCanvas.getContext('2d');
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, sw, sh);
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  if (!rotateDeg) return canvasToDataUrl(srcCanvas, scale, { highContrast });

  const dst = document.createElement('canvas');
  dst.width = sh;
  dst.height = sw;
  const dctx = dst.getContext('2d');
  dctx.fillStyle = '#ffffff';
  dctx.fillRect(0, 0, dst.width, dst.height);
  if (rotateDeg === 90) {
    dctx.translate(dst.width, 0);
    dctx.rotate(Math.PI / 2);
  } else {
    dctx.translate(0, dst.height);
    dctx.rotate(-Math.PI / 2);
  }
  dctx.drawImage(srcCanvas, 0, 0);
  return canvasToDataUrl(dst, scale, { highContrast });
};

const safeSetParameters = async (worker, params) => {
  try {
    await worker.setParameters(params);
  } catch {
    /* ignore unsupported params */
  }
};

const recognizePlainText = async (worker, imageSrc, pagesegMode) => {
  await safeSetParameters(worker, {
    tessedit_char_whitelist: '',
    user_defined_dpi: '300',
    ...(pagesegMode != null ? { tessedit_pageseg_mode: String(pagesegMode) } : {}),
  });
  const recognized = await worker.recognize(imageSrc);
  return String(recognized?.data?.text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

/** Digit-focused OCR for axis tick strips. */
const recognizeTickNumbers = async (worker, imageSrc) => {
  await safeSetParameters(worker, {
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: '0123456789.-',
    user_defined_dpi: '300',
  });
  const recognized = await worker.recognize(imageSrc);
  const fromText = extractNumbersFromText(recognized?.data?.text || '');
  const fromWords = [];
  (recognized?.data?.words || []).forEach((word) => {
    const value = parseNumericToken(word.text);
    if (value != null) fromWords.push(value);
  });
  await safeSetParameters(worker, { tessedit_char_whitelist: '' });
  return repairDroppedDecimals([...fromText, ...fromWords]);
};

/** Pull a clean I_OUT (A)-style label from raw OCR text when crops are noisy. */
const findIoutLabelInText = (text) => {
  const source = String(text || '');
  const match =
    source.match(/\bI\s*_?\s*OUT\s*\(\s*A\s*\)/i) ||
    source.match(/\bIOUT\s*\(\s*A\s*\)/i);
  if (!match) return '';
  return polishAxisTitle(match[0], 'A') || 'I_OUT (A)';
};

/**
 * @param {string} imageSrc data URL or http(s) image URL
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

  let worker;
  try {
    console.log('[MANUAL OCR] Starting Tesseract worker…');
    worker = await Tesseract.createWorker('eng', 1, {
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
    console.warn('[MANUAL OCR] createWorker failed:', error);
    return empty;
  }

  let result;
  try {
    await safeSetParameters(worker, {
      tessedit_pageseg_mode: '3',
      user_defined_dpi: '300',
    });
    result = await worker.recognize(src);
  } catch (error) {
    console.warn('[MANUAL OCR] Recognize failed:', error);
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
    return empty;
  }

  const words = result?.data?.words || [];
  const fullText = String(result?.data?.text || '');

  let htmlImage = null;
  try {
    htmlImage = await loadHtmlImage(src);
  } catch (error) {
    console.warn('[MANUAL OCR] Could not decode image for axis crops:', error);
  }

  const pixelWidth = htmlImage?.naturalWidth || htmlImage?.width || 0;
  const pixelHeight = htmlImage?.naturalHeight || htmlImage?.height || 0;
  const { width, height } = resolveImageSize(
    words,
    pixelWidth || result?.data?.imageWidth,
    pixelHeight || result?.data?.imageHeight
  );

  if (!width || !height) {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
    const title = extractGraphTitle(words, 1000, 1000, fullText);
    const fromVs = titlesFromVsPattern(title);
    return {
      ...empty,
      graphTitle: title,
      curveTitle: title,
      xTitle: polishAxisTitle(fromVs.xTitle),
      yTitle: polishAxisTitle(fromVs.yTitle),
    };
  }

  const captionY = findFigureCaptionY(words, height, fullText);
  const bottomCeiling =
    captionY != null ? Math.min(captionY - height * 0.015, height * 0.92) : height * 0.94;

  const collectWithFallback = (band) => {
    let hits = collectAxisNumbers(words, band, { minConfidence: 35 });
    if (hits.length < 2) {
      hits = collectAxisNumbers(words, band, { minConfidence: 0 });
    }
    return hits;
  };

  // Full-image tick bands (fallback only — often sparse / wrong).
  const leftBand = collectWithFallback({
    x0: width * 0.02,
    y0: height * 0.08,
    x1: width * 0.28,
    y1: Math.min(height * 0.82, bottomCeiling),
  });
  const bottomBand = collectWithFallback({
    x0: width * 0.15,
    y0: height * 0.62,
    x1: width * 0.95,
    y1: Math.min(height * 0.8, bottomCeiling),
  });

  let yRange = extendUniformTickRange(
    sanitizeAxisRange(
      rangeFromValues(refineTickValues(uniqueSortedValues(leftBand, 'y'), 'y'))
    )
  );
  let xRange = sanitizeAxisRange(
    rangeFromValues(refineTickValues(uniqueSortedValues(bottomBand, 'x'), 'x'))
  );

  const graphTitle = extractGraphTitle(words, width, height, fullText);
  const fromVs = titlesFromVsPattern(graphTitle);

  let xTitleFromFull = extractAxisTitleFromBand(
    words,
    {
      x0: width * 0.2,
      y0: Math.min(height * 0.78, bottomCeiling - height * 0.08),
      x1: width * 0.95,
      y1: bottomCeiling,
    },
    height
  );
  let yTitleFromFull = extractAxisTitleFromBand(
    words,
    {
      x0: 0,
      y0: height * 0.12,
      x1: width * 0.18,
      y1: height * 0.82,
    },
    height,
    { allowVerticalJoin: true }
  );
  if (isFigureCaptionText(xTitleFromFull) || isGarbageAxisLabel(xTitleFromFull)) xTitleFromFull = '';
  if (isFigureCaptionText(yTitleFromFull) || isGarbageAxisLabel(yTitleFromFull)) yTitleFromFull = '';

  let xTitleFromCrop = '';
  let yTitleFromCrop = '';
  let xLabelCropText = '';
  let yLabelCropText = '';
  let xTickCropRange = null;
  let yTickCropRange = null;

  if (htmlImage) {
    try {
      // X title: thin band under ticks / above figure caption (avoid tick digits).
      console.log('[MANUAL OCR] Reading horizontal X-axis label crop…');
      const xLabelTop = Math.min(height * 0.82, bottomCeiling - height * 0.08);
      const xLabelCrop = cropRegionToDataUrl(
        htmlImage,
        {
          x: width * 0.28,
          y: xLabelTop,
          w: width * 0.5,
          h: Math.max(height * 0.045, Math.min(height * 0.07, bottomCeiling - xLabelTop - 2)),
        },
        0,
        3.5,
        { highContrast: true }
      );
      if (xLabelCrop) {
        const xLines = await recognizePlainText(worker, xLabelCrop, 7);
        xLabelCropText = xLines.join('\n');
        // Units only from X crop — never fullText (that leaks Y's "%").
        xTitleFromCrop = pickBestAxisLabel('x', xLines, { unitSources: [xLabelCropText] });
        if (!xTitleFromCrop) {
          xTitleFromCrop = findIoutLabelInText(xLabelCropText);
        }
      }
      if (!xTitleFromCrop) {
        xTitleFromCrop = findIoutLabelInText(fullText);
      }

      console.log('[MANUAL OCR] Reading vertical Y-axis label (rotated crops)…');
      const yLabelRect = {
        x: 0,
        y: height * 0.1,
        w: width * 0.15,
        h: height * 0.72,
      };
      const yCandidates = [];
      const yCropCw = cropRegionToDataUrl(htmlImage, yLabelRect, 90, 3.5, { highContrast: true });
      const yCropCcw = cropRegionToDataUrl(htmlImage, yLabelRect, -90, 3.5, { highContrast: true });
      if (yCropCw) yCandidates.push(...(await recognizePlainText(worker, yCropCw, 7)));
      if (yCropCcw) yCandidates.push(...(await recognizePlainText(worker, yCropCcw, 7)));
      yLabelCropText = yCandidates.join('\n');
      yTitleFromCrop = pickBestAxisLabel('y', yCandidates, {
        unitSources: [yLabelCropText, fullText],
      });

      // X ticks: try bands with and without thresholding (threshold can wipe light ticks).
      console.log('[MANUAL OCR] Reading X tick number crops…');
      const xTickRects = [
        { x: width * 0.2, y: height * 0.68, w: width * 0.68, h: height * 0.08 },
        { x: width * 0.18, y: height * 0.72, w: width * 0.7, h: height * 0.07 },
        { x: width * 0.22, y: height * 0.64, w: width * 0.65, h: height * 0.09 },
        { x: width * 0.15, y: height * 0.7, w: width * 0.75, h: height * 0.1 },
      ];
      for (const rect of xTickRects) {
        for (const highContrast of [false, true]) {
          const crop = cropRegionToDataUrl(htmlImage, rect, 0, 4, { highContrast });
          if (!crop) continue;
          const nums = refineTickValues(await recognizeTickNumbers(worker, crop), 'x');
          const next = sanitizeAxisRange(rangeFromValues(nums));
          xTickCropRange = preferBetterRange(xTickCropRange, next);
          console.log('[MANUAL OCR] X tick numbers', { highContrast, nums, next });
        }
      }

      console.log('[MANUAL OCR] Reading Y tick number crops…');
      const yTickRects = [
        { x: width * 0.05, y: height * 0.08, w: width * 0.18, h: height * 0.74 },
        { x: width * 0.08, y: height * 0.1, w: width * 0.14, h: height * 0.72 },
      ];
      for (const rect of yTickRects) {
        for (const highContrast of [false, true]) {
          const crop = cropRegionToDataUrl(htmlImage, rect, 0, 4, { highContrast });
          if (!crop) continue;
          const nums = refineTickValues(await recognizeTickNumbers(worker, crop), 'y');
          const next = extendUniformTickRange(sanitizeAxisRange(rangeFromValues(nums)));
          yTickCropRange = preferBetterRange(yTickCropRange, next);
          console.log('[MANUAL OCR] Y tick numbers', { highContrast, nums, next });
        }
      }

      console.log('[MANUAL OCR] Axis crop titles', {
        xTitleFromCrop,
        yCandidates,
        yTitleFromCrop,
      });
    } catch (error) {
      console.warn('[MANUAL OCR] Axis crop OCR failed:', error);
    }
  }

  try {
    await worker.terminate();
  } catch {
    /* ignore */
  }

  xRange = sanitizeAxisRange(preferBetterRange(xTickCropRange, xRange));
  yRange = extendUniformTickRange(
    sanitizeAxisRange(preferBetterRange(yTickCropRange, yRange))
  );

  // Prefer printed I_OUT (A) over figure-caption "Load Current" + leaked (%).
  const ioutTitle = findIoutLabelInText(`${xLabelCropText}\n${fullText}`);
  const xTitle =
    ioutTitle ||
    pickBestAxisLabel('x', [xTitleFromCrop, xTitleFromFull], {
      unitSources: [xLabelCropText],
    });

  const yTitle = pickBestAxisLabel(
    'y',
    [yTitleFromCrop, yTitleFromFull, fromVs.yTitle],
    { unitSources: [yLabelCropText, fullText] }
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

  console.log('[MANUAL OCR] Extracted fields:', fields, {
    tickCounts: { xFull: bottomBand.length, yFull: leftBand.length },
    tickCrops: { x: xTickCropRange, y: yTickCropRange },
    captionY,
    sources: {
      x: { crop: xTitleFromCrop, full: xTitleFromFull, iout: ioutTitle, vs: fromVs.xTitle },
      y: { crop: yTitleFromCrop, full: yTitleFromFull, vs: fromVs.yTitle },
    },
  });
  return fields;
};

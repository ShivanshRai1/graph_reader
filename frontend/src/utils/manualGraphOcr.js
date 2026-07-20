/**
 * Manual-capture OCR helpers (Tesseract.js).
 * Used only after "Capture Manually" — does not touch AI extraction.
 * Results are written into existing form fields; user can edit anytime.
 *
 * Axis titles: full-image pass + cropped passes.
 * Y labels support (1) stacked upright glyphs in a column, (2) true 90°-rotated text.
 * Curve name: first legend entry when present (temps / Vxx= / TYP…); else graph title.
 * Axis ticks: dedicated digit-only crops (more reliable than full-page sparse hits).
 */

const FIGURE_CAPTION_RE =
  /\b(?:fig(?:ure)?\.?\s*\d+[.:)]?\s*)(.+)/i;

const VS_SPLIT_RE = /\s+vs\.?\s+/i;

const AXIS_LABEL_HINT =
  /\b(vout|vin|iout|i_out|iin|isd|vsd|ids|vds|vgs|normalized|efficiency|temperature|freq|frequency|gain|phase|time|current|voltage|power|load|regulation|amp|ohm|watt)\b|[%°]|\$[A-Za-z]|_\{|(\([A-Za-zµμΩ/%]+\))/i;

const parseNumericToken = (raw) => {
  let text = String(raw || '').trim().replace(/,/g, '');
  // Tick glyphs are often confused: O→0, l/I→1, S→5, Z→2.
  if (/^[-+]?[0-9OoIlSsZz.]+([eE][-+]?\d+)?$/.test(text)) {
    text = text.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/[Ss]/g, '5').replace(/[Zz]/g, '2');
  } else {
    text = text.replace(/[Oo]/g, '0');
    if (/^[-+]?[\d.lI]+([eE][-+]?\d+)?$/.test(text)) {
      text = text.replace(/[lI]/g, '1');
    }
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

/** Prefer coherent tick series: many ticks, capped density, mild span (not 0.4..0.5 or 0..98.4). */
const preferBetterRange = (primary, secondary) => {
  const score = (range) => {
    if (!range) return -Infinity;
    const span = Math.abs(range.max - range.min);
    const count = range.count || 0;
    if (!(span > 0) || count < 2) return -Infinity;
    const density = count / Math.max(span, 0.1);
    // Cap density so 2 pts in a 0.1 span cannot beat a real 0..5.5 / 98..102 series.
    let s = count * 15 + Math.min(density, 2.5) * 20 + Math.log10(span + 1) * 15;
    if (count <= 2) s -= 80;
    if (count <= 3 && span < 1) s -= 55;
    if (count <= 3 && span > 20) s -= 45;
    if (density < 0.05 && span > 10) s -= 70;
    if (count <= 2 && span <= 5 && Number.isInteger(range.min) && Number.isInteger(range.max)) {
      s -= 40;
    }
    if (count <= 2 && range.min === 0 && range.max === 100) s -= 80;
    // Sparse 0 → large fractional max is almost always OCR junk (origin + misread).
    if (
      range.min === 0 &&
      count <= 3 &&
      span > 20 &&
      Math.abs(range.max % 1) > 0.01
    ) {
      s -= 90;
    }
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
    // e.g. 2..5 from splitting a two-digit tick
    return null;
  }
  // Microscopic fragments (0.4..0.5) from annotation/Y-leak — not an axis range.
  if (range.count <= 3 && Math.abs(range.max - range.min) <= 0.75 && Math.abs(range.max) < 10) {
    return null;
  }
  // Weak partial reads like 1..10 with almost no interior ticks.
  if (range.max <= 10 && range.min >= 1 && range.count <= 4) return null;
  if (range.min === 1 && range.max === 10) return null;
  // Origin + one noisy high value (e.g. 0..98.4) is not a real tick series.
  if (
    range.min === 0 &&
    range.count <= 3 &&
    Math.abs(range.max - range.min) > 20 &&
    Math.abs(range.max % 1) > 0.01
  ) {
    return null;
  }
  return range;
};

/** Split sorted tick values into contiguous clusters by median-gap limit. */
const splitTickClusters = (values) => {
  const sorted = [];
  [...values]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
    .forEach((v) => {
      if (!sorted.length || Math.abs(sorted[sorted.length - 1] - v) > 1e-9) sorted.push(v);
    });
  if (sorted.length < 2) return sorted.length ? [sorted] : [];

  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!(medianGap > 0)) return [sorted];

  const limit = medianGap * 2.75 + 1e-9;
  const clusters = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] <= limit) {
      current.push(sorted[i]);
    } else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);
  return clusters;
};

const scoreTickCluster = (cluster, { favorHighMagnitude = false } = {}) => {
  if (!cluster || cluster.length < 2) return -Infinity;
  const span = cluster[cluster.length - 1] - cluster[0];
  if (!(span > 0)) return -Infinity;
  const density = cluster.length / Math.max(span, 0.1);
  const median = cluster[Math.floor(cluster.length / 2)];
  const fracCount = cluster.filter((v) => Math.abs(v % 1) > 1e-9).length;
  // Cap density — tiny 0.4..0.5 clusters must not outrank a full axis series.
  let s = cluster.length * 8 + Math.min(density, 3) * 15 + Math.log10(span + 1) * 10;
  if (favorHighMagnitude) {
    // Y crops often also see X origin/fractions; prefer the high tick run.
    if (Math.abs(median) >= 10) s += 35;
    if (fracCount >= cluster.length * 0.5 && Math.abs(median) < 10) s -= 45;
  }
  return s;
};

/**
 * Keep the densest run of tick values (drop stray figure numbers / opposite-axis leaks).
 * Purely statistical — no fixed endpoints.
 */
const densestTickCluster = (values, { favorHighMagnitude = false } = {}) => {
  const sorted = [];
  [...values]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
    .forEach((v) => {
      if (!sorted.length || Math.abs(sorted[sorted.length - 1] - v) > 1e-9) sorted.push(v);
    });
  if (sorted.length < 4) return sorted;

  const clusters = splitTickClusters(sorted);
  const candidates = clusters.filter((c) => c.length >= 3);
  if (!candidates.length) return sorted;

  let best = candidates[0];
  let bestScore = scoreTickCluster(best, { favorHighMagnitude });
  for (let i = 1; i < candidates.length; i += 1) {
    const c = candidates[i];
    const s = scoreTickCluster(c, { favorHighMagnitude });
    if (
      s > bestScore ||
      (s === bestScore &&
        Math.abs(c[c.length - 1] - c[0]) < Math.abs(best[best.length - 1] - best[0]))
    ) {
      best = c;
      bestScore = s;
    }
  }
  return best;
};

/**
 * When OCR misses an end tick, extend one step only if interior spacing is uniform
 * (step comes from values OCR actually read).
 */
const extendUniformTickRange = (range) => {
  if (!range) return range;
  let min = range.min;
  let max = range.max;
  const vals = densestTickCluster(Array.isArray(range.values) ? range.values : [min, max]);
  if (vals.length < 3) return range;

  const diffs = [];
  for (let i = 1; i < vals.length; i += 1) {
    const d = Number((vals[i] - vals[i - 1]).toFixed(6));
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return range;
  diffs.sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 2)];
  if (!(step > 0)) return range;
  const uniform = diffs.every((d) => Math.abs(d - step) <= step * 0.25 + 1e-9);
  if (!uniform) return range;

  min = vals[0];
  max = vals[vals.length - 1];

  // Bipolar axes: if one side is short by exactly one step, add that step.
  const nearMirror = Math.abs(Math.abs(max) - Math.abs(min)) <= step * 1.15 + 1e-9;
  if (nearMirror && Math.abs(max) > Math.abs(min) + 1e-9) {
    const extMin = Number((min - step).toFixed(6));
    if (Math.abs(extMin + max) <= step * 0.2 + 1e-9) min = extMin;
  }
  if (nearMirror && Math.abs(min) > Math.abs(max) + 1e-9) {
    const extMax = Number((max + step).toFixed(6));
    if (Math.abs(extMax + min) <= step * 0.2 + 1e-9) max = extMax;
  }

  return rangeFromValues([min, ...vals, max]) || { ...range, min, max, count: range.count };
};

/**
 * Repair OCR decimal loss using neighboring ticks only.
 * - "5.5" → 55 (÷10) when it continues a fractional/small series
 * - "1.00" → 100 (÷100) when that fits better
 * Integer values ≥ 10 are treated as repair candidates, not series anchors.
 */
const repairDroppedDecimals = (values) => {
  const list = values.filter((v) => Number.isFinite(v));
  // Core ticks: fractions and small magnitudes (exclude integer≥10 — often lost decimals).
  const core = [
    ...new Set(
      list.filter((v) => Math.abs(v % 1) > 1e-9 || Math.abs(v) < 10)
    ),
  ].sort((a, b) => a - b);
  if (core.length < 3) return list;

  const diffs = [];
  for (let i = 1; i < core.length; i += 1) {
    const d = core[i] - core[i - 1];
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return list;
  diffs.sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 2)];
  if (!(step > 0) || step > 5) return list;

  const lo = core[0];
  const hi = core[core.length - 1];
  const fitsSeries = (candidate) => {
    if (!Number.isFinite(candidate)) return false;
    if (candidate < lo - step * 1.25 || candidate > hi + step * 1.25) return false;
    const k = Math.round(candidate / step);
    return Math.abs(candidate - k * step) <= step * 0.25 + 1e-9;
  };

  return list.map((v) => {
    if (!Number.isInteger(v) || Math.abs(v) < 10) return v;
    for (const div of [10, 100]) {
      const repaired = v / div;
      if (fitsSeries(repaired)) return Number(repaired.toFixed(6));
    }
    return v;
  });
};

/**
 * Prefer tick values that form a coherent series.
 * Does not invent endpoints; only filters/repairs OCR noise.
 */
const refineTickValues = (values, axis) => {
  let list = repairDroppedDecimals(values.filter((v) => Number.isFinite(v)));

  if (axis === 'x') {
    list = list.filter((v) => v >= 0 && v <= 1000);
    const fractions = list.filter((v) => Math.abs(v % 1) > 1e-9);
    // Only collapse to integers when OCR saw no meaningful fractional ticks.
    // Otherwise keep decimals (e.g. 0, 0.5, …, 5.5) instead of forcing 0, 5, 55.
    if (fractions.length < 2) {
      const ints = list.filter((v) => Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9);
      if (ints.length >= 2) {
        list = ints.map((v) => Math.round(v));
      }
    }
    list = densestTickCluster(list);
    if (list.includes(100) && list.some((v) => v > 0 && v < 100)) {
      list = list.filter((v) => v !== 100);
    }
  }

  if (axis === 'y') {
    // Do not clamp to |v|<=20 — many datasheet Y axes are 50–150, 70–100, etc.
    // Prefer high-magnitude integer runs over X-origin / fractional leaks in the left crop.
    list = densestTickCluster(list, { favorHighMagnitude: true });
  }

  return list;
};

/**
 * Merge neighboring single/double-digit OCR fragments (e.g. "2"+"5" → 25)
 * using word bounding boxes — only when both tokens are digits and sit close together.
 */
const mergeAdjacentDigitWords = (words, band) => {
  const items = [];
  (Array.isArray(words) ? words : []).forEach((word) => {
    const center = wordCenter(word);
    if (!center) return;
    if (center.cx < band.x0 || center.cx > band.x1 || center.cy < band.y0 || center.cy > band.y1) {
      return;
    }
    const raw = String(center.text || '').trim();
    if (!/^\d{1,3}$/.test(raw)) return;
    items.push({
      ...center,
      digits: raw,
      value: Number(raw),
    });
  });
  items.sort((a, b) => a.cx - b.cx || a.cy - b.cy);

  const merged = items.map((item) => item.value);
  for (let i = 0; i < items.length - 1; i += 1) {
    const a = items[i];
    const b = items[i + 1];
    const gap = b.x0 - a.x1;
    const sameRow = Math.abs(a.cy - b.cy) <= Math.max(8, (a.y1 - a.y0) * 0.8);
    const close = gap >= -2 && gap <= Math.max(14, (a.x1 - a.x0) * 0.85);
    if (!sameRow || !close) continue;
    if (a.digits.length + b.digits.length > 3) continue;
    const combined = Number(`${a.digits}${b.digits}`);
    if (Number.isFinite(combined)) merged.push(combined);
  }
  return merged;
};

/**
 * Build an X/Y range only from numbers OCR actually returned.
 * May correct an obvious leftmost "1"→"0" when the remaining ticks form a series from 0.
 */
const inferLinearTickRange = (values, axis) => {
  let nums = [...new Set(refineTickValues(values, axis))].sort((a, b) => a - b);
  if (nums.length < 2) return null;

  if (axis === 'x' && nums.length >= 3) {
    const diffs = [];
    for (let i = 1; i < nums.length; i += 1) {
      const d = nums[i] - nums[i - 1];
      if (d > 0) diffs.push(d);
    }
    diffs.sort((a, b) => a - b);
    const step = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;

    if (nums[0] === 1 && nums.length >= 3) {
      const rest = nums.slice(1);
      const restStep = rest.length >= 2 ? rest[1] - rest[0] : step;
      // If remaining ticks look like step, 2*step, 3*step..., leftmost "1" was likely a misread "0".
      if (
        restStep > 0 &&
        Math.abs(rest[0] - restStep) <= restStep * 0.05 + 1e-9 &&
        rest.every((v, i) => Math.abs(v - restStep * (i + 1)) <= restStep * 0.05 + 1e-9)
      ) {
        nums = [0, ...rest];
      }
    }

    // Series starts at one step (0.5, 1.0, …) — OCR often drops the printed "0".
    if (
      step > 0 &&
      nums[0] > 0 &&
      Math.abs(nums[0] - step) <= step * 0.2 + 1e-9 &&
      diffs.every((d) => Math.abs(d - step) <= step * 0.3 + 1e-9)
    ) {
      const prepended = Number((nums[0] - step).toFixed(6));
      if (prepended >= 0 && Math.abs(prepended) <= step * 0.2 + 1e-9) {
        nums = [0, ...nums];
      }
    }
  }

  return sanitizeAxisRange(rangeFromValues(nums));
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
    // Common OCR mangling of IOUT: tour / Iour / tout / lout / 1OUT / I OUT / I_OUT
    .replace(/\bI_OUT\b/gi, 'IOUT')
    .replace(/\bIour\b/gi, 'IOUT')
    .replace(/\bIOUR\b/gi, 'IOUT')
    .replace(/\btour\b/gi, 'IOUT')
    .replace(/\bTOUR\b/gi, 'IOUT')
    .replace(/\b[Il1T]\s*_?\s*OUT\b/gi, 'IOUT')
    .replace(/\bTOUT\b/gi, 'IOUT')
    .replace(/\btout\b/gi, 'IOUT')
    .replace(/\blout\b/gi, 'IOUT')
    .replace(/\bIout\b/gi, 'IOUT')
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
  let t = repairAxisLabelUnitOrder(normalizeAxisLabelText(text));
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

/**
 * OCR on rotated vertical labels often emits "(%)NAME" instead of "NAME (%)".
 * Reorder only — does not invent words or units.
 */
const repairAxisLabelUnitOrder = (text) => {
  const t = normalizeAxisLabelText(text);
  const match = t.match(/^\(\s*([^)]+?)\s*\)\s+(.+)$/);
  if (!match) return t;
  const unit = match[1].trim();
  const name = match[2].trim();
  if (!unit || !name || isUnitOnlyLabel(name)) return t;
  return `${name} (${unit})`;
};

/** Reject rotated-OCR letter salad (e.g. Q3ZINVIWHON) even when a unit was detected. */
const looksLikeOcrGibberish = (text) => {
  const ordered = repairAxisLabelUnitOrder(normalizeAxisLabelText(text));
  const bare = stripParenUnits(ordered).replace(/[^A-Za-z0-9]/g, '');
  if (bare.length < 4) return false;
  // Digit glued inside a letter run is almost never a real axis word.
  if (/[A-Za-z]\d+[A-Za-z]/.test(bare)) return true;
  const letters = bare.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return true;
  const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
  const vowelRatio = vowels / letters.length;
  if (vowelRatio < 0.22) return true;
  // Long consonant clumps with weak vowels — typical of mirrored/garbled OCR.
  if (vowelRatio < 0.34 && /[B-DF-HJ-NP-TV-XZ]{4,}/i.test(letters)) return true;
  return false;
};

const isFigureCaptionText = (text) => FIGURE_CAPTION_RE.test(String(text || '').trim());

/** Reject OCR noise like: Z aw our " LE VU (A) */
const looksLikeGarbageTitle = (text) => {
  const t = repairAxisLabelUnitOrder(normalizeAxisLabelText(text));
  if (!t) return true;
  if (isFigureCaptionText(t)) return true;
  if (/["'`]/.test(t)) return true;
  if (/^\d/.test(t)) return true;
  if ((t.match(/[^A-Za-z0-9%°µμΩ()_/\s.-]/g) || []).length >= 2) return true;
  if (looksLikeOcrGibberish(t)) return true;

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

/** True when a label is just a chunk of the figure caption (e.g. halves of "A vs. B"). */
const isGraphTitleFragment = (label, graphTitle) => {
  const name = stripParenUnits(label)
    .toLowerCase()
    .replace(/[^\w\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = stripParenUnits(graphTitle)
    .toLowerCase()
    .replace(FIGURE_CAPTION_RE, '$1')
    .replace(/[^\w\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length < 4 || !title) return false;
  if (name.split(/\s+/).filter(Boolean).length < 2) return false;
  return title.includes(name);
};

const scoreAxisLabel = (text, axis = '', { graphTitle = '' } = {}) => {
  const t = repairAxisLabelUnitOrder(normalizeAxisLabelText(text));
  if (isGarbageAxisLabel(t) || looksLikeGarbageTitle(t) || looksLikeOcrGibberish(t)) return -1;
  let score = Math.min(stripParenUnits(t).length, 30);
  if (AXIS_LABEL_HINT.test(t)) score += 40;
  if (/\([A-Za-zµμΩ/%]+\)/.test(t)) score += 30;
  if (stripParenUnits(t).split(/\s+/).length <= 3) score += 10;
  // Printed axis labels are often uppercase; caption phrases are mixed/title case.
  const bare = stripParenUnits(t);
  if (/^[A-Z][A-Z\s/%()._-]*$/.test(bare) && bare.length >= 4 && !/\d/.test(bare)) {
    score += 15;
  }

  // Prefer short symbol-style axis labels over long figure-caption prose.
  if (bare.split(/\s+/).length >= 4) score -= 20;
  if (isGraphTitleFragment(t, graphTitle)) score -= 120;
  // Unit must trail the name: "NAME (%)" not "(%)NAME".
  if (/^\(\s*[^)]+\s*\)/.test(normalizeAxisLabelText(text)) && !/^\(\s*[^)]+\s*\)\s*$/.test(normalizeAxisLabelText(text))) {
    score -= 25;
  }
  if (axis === 'x' && /\(%\)/.test(t)) score -= 45;
  if (axis === 'y' && /\(%\)/.test(t)) score += 20;
  if (axis === 'x' && /\(\s*[A-Za-zµμΩ]+\s*\)/.test(t)) score += 20;
  return score;
};

const pickBestAxisLabel = (axis, candidates = [], { unitSources = [], graphTitle = '' } = {}) => {
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
    if (isUnitOnlyLabel(raw) || looksLikeGarbageTitle(raw) || looksLikeOcrGibberish(raw)) return;
    const unitHint = extractParenUnits(raw)[0] || units[0] || '';
    const text = polishAxisTitle(raw, unitHint);
    if (!text || looksLikeGarbageTitle(text) || looksLikeOcrGibberish(text)) return;
    const score = scoreAxisLabel(text, axis, { graphTitle });
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

/**
 * Normalize a legend curve label OCR already saw (temps, Vxx=/Ixx=, TYP/MIN/MAX).
 * Returns '' when the token does not look like a curve name.
 */
const normalizeLegendCurveName = (raw) => {
  let t = String(raw || '')
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ');
  if (!t || t.length > 48) return '';
  if (/^fig(?:ure)?\b/i.test(t)) return '';

  // Temperature curves: -55°C, +25 C, -55C, 125°C
  const temp = t.match(/^([+-]?\d+)\s*°?\s*([CF])\b/i);
  if (temp) {
    return `${temp[1]}${temp[2].toUpperCase()}`;
  }
  // Same pattern embedded in a short legend line.
  const tempEmbedded = t.match(/(?:^|[\s|])([+-]?\d+)\s*°?\s*([CF])\b/i);
  if (tempEmbedded && t.length <= 24) {
    return `${tempEmbedded[1]}${tempEmbedded[2].toUpperCase()}`;
  }

  // Bias / condition curves often printed in legends: VGS=10V, VIN = 12 V
  const cond = t.match(
    /\b([VIvi][A-Za-z0-9]{0,10})\s*=\s*([-+]?\d+\.?\d*)\s*([A-Za-zµμΩ%]{0,4})\b/
  );
  if (cond) {
    const unit = String(cond[3] || '').trim();
    return `${cond[1].toUpperCase()}=${cond[2]}${unit}`;
  }

  if (/^(TYP|MIN|MAX|NOM|TYP\.)$/i.test(t)) {
    return t.replace(/\./g, '').toUpperCase();
  }

  return '';
};

/**
 * First-come curve name from legend OCR (top→bottom in a legend band, then line order).
 * Does not invent labels — only normalizes tokens OCR returned.
 */
const pickFirstLegendCurveName = (lineTexts, words, band) => {
  const seen = new Set();
  const ordered = [];

  const push = (raw) => {
    const name = normalizeLegendCurveName(raw);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(name);
  };

  // Prefer spatially ordered tokens inside the legend band (top first).
  if (band && Array.isArray(words)) {
    const items = [];
    words.forEach((word) => {
      const center = wordCenter(word);
      if (!center?.text) return;
      if (
        center.cx < band.x0 ||
        center.cx > band.x1 ||
        center.cy < band.y0 ||
        center.cy > band.y1
      ) {
        return;
      }
      items.push(center);
    });
    const bandHeight = Math.max(1, band.y1 - band.y0);
    groupWordsIntoLines(items, bandHeight * 4)
      .sort((a, b) => a.y0 - b.y0)
      .forEach((line) => push(line.text));
  }

  (Array.isArray(lineTexts) ? lineTexts : [lineTexts]).forEach((line) => {
    const text = String(line || '').trim();
    if (!text) return;
    push(text);
    // Also peel every temp token from a multi-entry legend line.
    const tempIter = text.matchAll(/([+-]?\d+)\s*°?\s*([CF])\b/gi);
    for (const match of tempIter) {
      push(`${match[1]}${match[2]}`);
    }
  });

  return ordered[0] || '';
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
    const stacked = extractStackedUprightLabels(items, band);
    const stackedBest = stacked.find((s) => !isGarbageAxisLabel(s) && !looksLikeOcrGibberish(s));
    if (stackedBest) return stackedBest.slice(0, 80);
  }

  const longest = [...lines].sort((a, b) => b.length - a.length)[0] || '';
  if (!longest || isGarbageAxisLabel(longest)) return '';
  return longest.slice(0, 80);
};

/**
 * Glue upright glyphs stacked in a vertical column (datasheet Y labels often use this,
 * not true 90°-rotated text). Tries top→bottom and bottom→top. No invented characters.
 */
const glueStackedTokens = (sortedItems) => {
  const chars = [];
  (Array.isArray(sortedItems) ? sortedItems : []).forEach((item) => {
    const t = String(item?.text || '').trim();
    if (!t) return;
    // Skip pure numeric tick labels; keep letters, %, parentheses, unit fragments.
    if (/^[-+]?\d+(?:\.\d+)?$/.test(t) && !/[A-Za-z%°]/.test(t)) return;
    chars.push(t);
  });
  if (chars.length < 3) return '';

  const singleCount = chars.filter((c) => c.length === 1).length;
  const mostlySingles = singleCount >= Math.ceil(chars.length * 0.55);
  let raw = mostlySingles ? chars.join('') : chars.join(' ');
  raw = raw
    .replace(/([A-Za-z])\(/g, '$1 (')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s*%\s*\)/g, '(%)')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeAxisLabelText(raw);
};

/**
 * From word/glyph boxes in a band, rebuild stacked-upright labels.
 * @param {Array} wordsOrCenters tesseract words or {text,cx,cy,x0,y0,x1,y1}
 */
const extractStackedUprightLabels = (wordsOrCenters, band) => {
  const items = [];
  (Array.isArray(wordsOrCenters) ? wordsOrCenters : []).forEach((word) => {
    const center =
      word && Number.isFinite(word.cx) && word.text != null ? word : wordCenter(word);
    if (!center?.text) return;
    if (
      Number.isFinite(band?.x0) &&
      (center.cx < band.x0 ||
        center.cx > band.x1 ||
        center.cy < band.y0 ||
        center.cy > band.y1)
    ) {
      return;
    }
    const raw = String(center.text || '').trim();
    if (!raw) return;
    if (/^[-+]?\d+(?:\.\d+)?$/.test(raw) && !/[A-Za-z%°]/.test(raw)) return;
    items.push({
      ...center,
      text: raw,
    });
  });
  if (items.length < 3) return [];

  // Prefer a narrow vertical column (similar cx).
  const byX = [...items].sort((a, b) => a.cx - b.cx);
  const medianCx = byX[Math.floor(byX.length / 2)].cx;
  const xTol = Math.max(
    14,
    Number.isFinite(band?.x1) && Number.isFinite(band?.x0) ? (band.x1 - band.x0) * 0.4 : 24
  );
  let column = items.filter((item) => Math.abs(item.cx - medianCx) <= xTol);
  if (column.length < 3) column = items;

  const topDown = glueStackedTokens([...column].sort((a, b) => a.cy - b.cy || a.cx - b.cx));
  const bottomUp = glueStackedTokens([...column].sort((a, b) => b.cy - a.cy || a.cx - b.cx));
  return [...new Set([topDown, bottomUp].filter((s) => s && s.length >= 3))];
};

const recognizeTextWithWords = async (worker, imageSrc, pagesegMode) => {
  await safeSetParameters(worker, {
    tessedit_char_whitelist: '',
    user_defined_dpi: '300',
    ...(pagesegMode != null ? { tessedit_pageseg_mode: String(pagesegMode) } : {}),
  });
  const recognized = await worker.recognize(imageSrc);
  const lines = String(recognized?.data?.text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { lines, words: recognized?.data?.words || [] };
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
 * mirrorX: flip horizontally after rotate (helps when vertical text was read mirrored).
 */
const cropRegionToDataUrl = (
  img,
  rect,
  rotateDeg = 0,
  scale = 3,
  { highContrast = false, mirrorX = false } = {}
) => {
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

  let working = srcCanvas;
  if (rotateDeg) {
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
    working = dst;
  }

  if (mirrorX) {
    const flipped = document.createElement('canvas');
    flipped.width = working.width;
    flipped.height = working.height;
    const fctx = flipped.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, flipped.width, flipped.height);
    fctx.translate(flipped.width, 0);
    fctx.scale(-1, 1);
    fctx.drawImage(working, 0, 0);
    working = flipped;
  }

  return canvasToDataUrl(working, scale, { highContrast });
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
  const collect = async (whitelist, pagesegMode) => {
    await safeSetParameters(worker, {
      tessedit_pageseg_mode: String(pagesegMode),
      tessedit_char_whitelist: whitelist,
      user_defined_dpi: '300',
    });
    const recognized = await worker.recognize(imageSrc);
    const fromText = extractNumbersFromText(recognized?.data?.text || '');
    const fromWords = [];
    (recognized?.data?.words || []).forEach((word) => {
      const value = parseNumericToken(word.text);
      if (value != null) fromWords.push(value);
    });
    // Also merge split digit tokens from this crop's word boxes.
    const merged = mergeAdjacentDigitWords(recognized?.data?.words || [], {
      x0: -Infinity,
      y0: -Infinity,
      x1: Infinity,
      y1: Infinity,
    });
    return [...fromText, ...fromWords, ...merged];
  };

  // Run whitelist + open passes; sparse ticks often need both.
  const nums = [
    ...(await collect('0123456789.-', 6)),
    ...(await collect('0123456789.-', 7)),
    ...(await collect('', 6)),
  ];
  await safeSetParameters(worker, { tessedit_char_whitelist: '' });
  return repairDroppedDecimals(nums);
};

/** Pull a clean IOUT (A)-style label from raw OCR text when crops are noisy. */
const findIoutLabelInText = (text) => {
  const source = String(text || '');
  // Match IOUT (A) and common OCR corruptions: tour / Iour / tout / lout / I_OUT (A)
  const match =
    source.match(/\bI\s*_?\s*OUT\s*\(\s*A\s*\)/i) ||
    source.match(/\bIOUT\s*\(\s*A\s*\)/i) ||
    source.match(/\bI_OUT\s*\(\s*A\s*\)/i) ||
    source.match(/\btour\s*\(\s*A\s*\)/i) ||
    source.match(/\bIour\s*\(\s*A\s*\)/i) ||
    source.match(/\btout\s*\(\s*A\s*\)/i) ||
    source.match(/\blout\s*\(\s*A\s*\)/i) ||
    source.match(/\b[Il1T]\s*_?\s*OUT\s*\(\s*A\s*\)/i);
  if (
    match ||
    /\bI\s*ou[tr]\s*\(\s*A\s*\)/i.test(source) ||
    /\btou[tr]\s*\(\s*A\s*\)/i.test(source) ||
    /\bout\s*\(\s*A\s*\)/i.test(source)
  ) {
    return 'IOUT (A)';
  }
  return '';
};

/** If OCR almost got IOUT (A), force the canonical label (IOUT is fine; underscore not required). */
const canonicalizeXAxisTitle = (text) => {
  const t = normalizeAxisLabelText(text);
  if (!t) return '';
  if (
    findIoutLabelInText(t) ||
    /\bI\s*ou[tr]\b/i.test(t) ||
    /\btou[tr]\b/i.test(t) ||
    /\bout\s*\(\s*A\s*\)/i.test(t) ||
    /^IOUT\b/i.test(t) ||
    /^I_OUT\b/i.test(t)
  ) {
    return 'IOUT (A)';
  }
  return t;
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
  let xRange = inferLinearTickRange(uniqueSortedValues(bottomBand, 'x'), 'x');
  const xTickNumberPool = [...uniqueSortedValues(bottomBand, 'x')];
  const yTickNumberPool = [...uniqueSortedValues(leftBand, 'y')];

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
  let legendCurveName = '';

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

      console.log('[MANUAL OCR] Reading Y-axis label (stacked upright + rotated)…');
      const yLabelRects = [
        { x: 0, y: height * 0.08, w: width * 0.14, h: height * 0.75 },
        { x: 0, y: height * 0.12, w: width * 0.11, h: height * 0.7 },
      ];
      const yCandidates = [];
      const yBand = {
        x0: 0,
        y0: height * 0.08,
        x1: width * 0.16,
        y1: height * 0.85,
      };

      // 1) Stacked upright glyphs (letters stay horizontal, stacked vertically) — do NOT rotate.
      for (const yLabelRect of yLabelRects) {
        for (const highContrast of [true, false]) {
          const uprightCrop = cropRegionToDataUrl(htmlImage, yLabelRect, 0, 4, { highContrast });
          if (!uprightCrop) continue;
          for (const psm of [6, 5]) {
            const { lines, words: cropWords } = await recognizeTextWithWords(worker, uprightCrop, psm);
            yCandidates.push(...lines);
            yCandidates.push(
              ...extractStackedUprightLabels(cropWords, {
                x0: -Infinity,
                y0: -Infinity,
                x1: Infinity,
                y1: Infinity,
              })
            );
          }
        }
      }
      yCandidates.push(...extractStackedUprightLabels(words, yBand));

      // 2) True sideways text: rotate into a horizontal line.
      const pushRotatedY = async (rect, rotateDeg, highContrast, mirrorX) => {
        const yCrop = cropRegionToDataUrl(htmlImage, rect, rotateDeg, 3.5, {
          highContrast,
          mirrorX,
        });
        if (!yCrop) return;
        yCandidates.push(...(await recognizePlainText(worker, yCrop, 7)));
      };
      for (const yLabelRect of yLabelRects) {
        for (const rotateDeg of [90, -90]) {
          await pushRotatedY(yLabelRect, rotateDeg, true, false);
        }
      }
      if (!pickBestAxisLabel('y', yCandidates, { unitSources: [yCandidates.join('\n')], graphTitle })) {
        for (const yLabelRect of yLabelRects) {
          for (const rotateDeg of [90, -90]) {
            await pushRotatedY(yLabelRect, rotateDeg, false, false);
            await pushRotatedY(yLabelRect, rotateDeg, true, true);
          }
        }
      }

      const reversedExtras = [];
      yCandidates.forEach((line) => {
        const ordered = repairAxisLabelUnitOrder(line);
        const bare = stripParenUnits(ordered);
        const unit = extractParenUnits(ordered)[0] || '';
        if (bare.length < 4) return;
        const reversed = bare.split('').reverse().join('');
        if (reversed === bare) return;
        reversedExtras.push(unit ? `${reversed} (${unit})` : reversed);
      });
      yCandidates.push(...reversedExtras);

      const parenLabels =
        String(fullText || '').match(/\b[A-Za-z][A-Za-z0-9_/.-]{1,40}\s*\(\s*[^)]{1,12}\s*\)/g) || [];
      parenLabels.forEach((label) => {
        if (!isGraphTitleFragment(label, graphTitle) && !looksLikeOcrGibberish(label)) {
          yCandidates.push(label);
        }
      });
      yLabelCropText = yCandidates.join('\n');
      yTitleFromCrop = pickBestAxisLabel('y', yCandidates, {
        unitSources: [yLabelCropText],
        graphTitle,
      });
      console.log('[MANUAL OCR] Y label candidates', {
        count: yCandidates.length,
        sample: yCandidates.slice(0, 12),
        yTitleFromCrop,
      });

      // X ticks: prefer bands just under the plot (labels sit lower than 0.66 on many datasheets).
      console.log('[MANUAL OCR] Reading X tick number crops…');
      const xTickYTop = Math.min(height * 0.78, (bottomCeiling || height) - height * 0.14);
      const xTickRects = [
        { x: width * 0.16, y: height * 0.68, w: width * 0.76, h: height * 0.1 },
        { x: width * 0.16, y: height * 0.72, w: width * 0.76, h: height * 0.1 },
        { x: width * 0.16, y: xTickYTop, w: width * 0.76, h: Math.max(height * 0.08, height * 0.12) },
        { x: width * 0.16, y: height * 0.7, w: width * 0.28, h: height * 0.12 },
        { x: width * 0.4, y: height * 0.7, w: width * 0.28, h: height * 0.12 },
        { x: width * 0.62, y: height * 0.68, w: width * 0.34, h: height * 0.14 },
        { x: width * 0.72, y: height * 0.7, w: width * 0.26, h: height * 0.14 },
      ];
      for (const rect of xTickRects) {
        for (const highContrast of [false, true]) {
          const crop = cropRegionToDataUrl(htmlImage, rect, 0, 5, { highContrast });
          if (!crop) continue;
          const nums = refineTickValues(await recognizeTickNumbers(worker, crop), 'x');
          xTickNumberPool.push(...nums);
          const next = inferLinearTickRange(nums, 'x');
          xTickCropRange = preferBetterRange(xTickCropRange, next);
          console.log('[MANUAL OCR] X tick numbers', { highContrast, rect, nums, next });
        }
      }

      console.log('[MANUAL OCR] Reading Y tick number crops…');
      const yTickRects = [
        { x: width * 0.05, y: height * 0.08, w: width * 0.18, h: height * 0.74 },
        { x: width * 0.08, y: height * 0.1, w: width * 0.14, h: height * 0.72 },
        // Outer ends are often missed by the tall strip — crop top and bottom separately.
        { x: width * 0.04, y: height * 0.06, w: width * 0.2, h: height * 0.22 },
        { x: width * 0.04, y: height * 0.68, w: width * 0.2, h: height * 0.2 },
      ];
      for (const rect of yTickRects) {
        for (const highContrast of [false, true]) {
          const crop = cropRegionToDataUrl(htmlImage, rect, 0, 4.5, { highContrast });
          if (!crop) continue;
          const nums = refineTickValues(await recognizeTickNumbers(worker, crop), 'y');
          yTickNumberPool.push(...nums);
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

      // Legend / curve names (temps, Vxx=, …) — first entry wins; not the figure caption.
      console.log('[MANUAL OCR] Reading legend curve labels…');
      const legendBand = {
        x0: width * 0.5,
        y0: height * 0.35,
        x1: width * 0.98,
        y1: Math.min(bottomCeiling || height * 0.9, height * 0.88),
      };
      const legendRects = [
        { x: width * 0.55, y: height * 0.42, w: width * 0.4, h: height * 0.38 },
        { x: width * 0.62, y: height * 0.55, w: width * 0.34, h: height * 0.28 },
      ];
      const legendLines = [];
      for (const rect of legendRects) {
        for (const highContrast of [true, false]) {
          const crop = cropRegionToDataUrl(htmlImage, rect, 0, 3.2, { highContrast });
          if (!crop) continue;
          legendLines.push(...(await recognizePlainText(worker, crop, 6)));
        }
      }
      legendCurveName = pickFirstLegendCurveName(legendLines, words, legendBand);
      console.log('[MANUAL OCR] Legend curve', { legendCurveName, legendSample: legendLines.slice(0, 8) });
    } catch (error) {
      console.warn('[MANUAL OCR] Axis crop OCR failed:', error);
    }
  }

  try {
    await worker.terminate();
  } catch {
    /* ignore */
  }

  // Mine full-page OCR for X ticks: spatial bottom band + adjacent digit merges.
  // Integers only — avoids Y-axis fractions leaking into the X pool.
  const xWordBand = {
    x0: width * 0.12,
    y0: height * 0.62,
    x1: width * 0.98,
    y1: bottomCeiling || height * 0.88,
  };
  xTickNumberPool.push(
    ...mergeAdjacentDigitWords(words, xWordBand),
    ...refineTickValues(
      collectAxisNumbers(words, xWordBand, { minConfidence: 0 }).map((hit) => hit.value),
      'x'
    ),
    ...extractNumbersFromText(fullText).filter((v) => Number.isInteger(v) && v >= 0 && v <= 100)
  );
  const xFromPool = inferLinearTickRange(xTickNumberPool, 'x');

  xRange = preferBetterRange(preferBetterRange(xTickCropRange, xRange), xFromPool);
  xRange = sanitizeAxisRange(xRange);
  // Never keep placeholder 0..100 as an OCR result.
  if (xRange && xRange.min === 0 && xRange.max === 100) {
    xRange = null;
  }

  // Rebuild Y from the full tick pool so sparse end-crops can still contribute.
  const yFromPool = extendUniformTickRange(
    sanitizeAxisRange(rangeFromValues(refineTickValues(yTickNumberPool, 'y')))
  );
  yRange = extendUniformTickRange(
    sanitizeAxisRange(preferBetterRange(preferBetterRange(yTickCropRange, yRange), yFromPool))
  );

  // Prefer printed IOUT (A) over OCR mangling like "tour (A)" / "Iour (A)".
  // This only renames what OCR already read — it does not invent axis titles.
  const xTitle =
    findIoutLabelInText(`${xLabelCropText}\n${fullText}\n${xTitleFromCrop}\n${xTitleFromFull}`) ||
    canonicalizeXAxisTitle(xTitleFromCrop) ||
    canonicalizeXAxisTitle(xTitleFromFull) ||
    canonicalizeXAxisTitle(
      pickBestAxisLabel('x', [xTitleFromCrop, xTitleFromFull], {
        unitSources: [xLabelCropText],
        graphTitle,
      })
    ) ||
    '';

  // Prefer rotated Y-crop / left-band labels over "A vs B" caption halves.
  // Units only from the Y crop — fullText can attach the wrong unit onto caption prose.
  const yTitle =
    pickBestAxisLabel('y', [yTitleFromCrop, yTitleFromFull], {
      unitSources: [yLabelCropText],
      graphTitle,
    }) ||
    pickBestAxisLabel('y', [fromVs.yTitle], {
      unitSources: [yLabelCropText],
      graphTitle,
    }) ||
    '';

  // Curve name: prefer first legend entry when present; otherwise fall back to graph title
  // (some single-curve plots truly use the same string for both).
  if (!legendCurveName) {
    legendCurveName = pickFirstLegendCurveName([], words, {
      x0: width * 0.5,
      y0: height * 0.35,
      x1: width * 0.98,
      y1: Math.min(bottomCeiling || height * 0.9, height * 0.88),
    });
  }
  const curveTitle = legendCurveName || graphTitle;

  const fields = {
    graphTitle,
    curveTitle,
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
    legendCurveName,
    captionY,
    sources: {
      x: { crop: xTitleFromCrop, full: xTitleFromFull, vs: fromVs.xTitle },
      y: { crop: yTitleFromCrop, full: yTitleFromFull, vs: fromVs.yTitle },
    },
  });
  return fields;
};

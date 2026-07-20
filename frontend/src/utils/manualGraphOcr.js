/**
 * Manual-capture OCR helpers (Tesseract.js).
 * Used only after "Capture Manually" — does not touch AI extraction.
 * Results are written into existing form fields; user can edit anytime.
 *
 * Axis titles: full-image pass + cropped passes.
 * Vertical Y labels are rotated to horizontal before OCR (CW and CCW; best wins).
 */

const FIGURE_CAPTION_RE =
  /\b(?:fig(?:ure)?\.?\s*\d+[.:)]?\s*)(.+)/i;

const VS_SPLIT_RE = /\s+vs\.?\s+/i;

const AXIS_LABEL_HINT =
  /\b(vout|vin|iout|iin|isd|vsd|ids|vds|vgs|normalized|efficiency|temperature|freq|frequency|gain|phase|time|current|voltage|power|load|regulation|amp|ohm|watt)\b|[%°]|\$[A-Za-z]|_\{|(\([A-Za-zµμΩ/%]+\))/i;

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

const pickAxisRangeFromHits = (hits, axis) => {
  const values = uniqueSortedValues(hits, axis);
  if (values.length < 2) return null;
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
    .replace(/\bI\s*[_ ]?\s*OUT\b/gi, 'Iout')
    .replace(/\bIOUT\b/gi, 'Iout')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();

const isFigureCaptionText = (text) => FIGURE_CAPTION_RE.test(String(text || '').trim());

const isGarbageAxisLabel = (text) => {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return true;
  if (isFigureCaptionText(t)) return true;
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

const scoreAxisLabel = (text) => {
  const t = normalizeAxisLabelText(text);
  if (isGarbageAxisLabel(t)) return -1;
  let score = Math.min(t.length, 40);
  if (AXIS_LABEL_HINT.test(t)) score += 40;
  if (/\bnormalized\b/i.test(t)) score += 50;
  if (/\biout\b|\bi\s*out\b/i.test(t)) score += 50;
  if (/%/.test(t)) score += 20;
  if (/\([A-Za-zµμΩ/%]+\)/.test(t)) score += 25;
  return score;
};

const pickBestAxisLabel = (...candidates) => {
  let best = '';
  let bestScore = -1;
  candidates.flat().forEach((raw) => {
    const text = normalizeAxisLabelText(raw);
    const score = scoreAxisLabel(text);
    if (score > bestScore) {
      bestScore = score;
      best = text.slice(0, 80);
    }
  });
  return bestScore >= 0 ? best : '';
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

const canvasToDataUrl = (canvas, scale = 2) => {
  if (scale <= 1) return canvas.toDataURL('image/png');
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
};

/**
 * Crop a rect from the source image; optional 90° rotation so vertical text becomes horizontal.
 * rotateDeg: 0 | 90 (CW) | -90 (CCW)
 */
const cropRegionToDataUrl = (img, rect, rotateDeg = 0) => {
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

  if (!rotateDeg) return canvasToDataUrl(srcCanvas, 2.5);

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
  return canvasToDataUrl(dst, 2.5);
};

const recognizePlainText = async (worker, imageSrc, pagesegMode) => {
  try {
    if (pagesegMode != null) {
      await worker.setParameters({ tessedit_pageseg_mode: String(pagesegMode) });
    }
  } catch {
    /* older builds may not accept PSM overrides */
  }
  const recognized = await worker.recognize(imageSrc);
  return String(recognized?.data?.text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
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
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
    } catch {
      /* ignore */
    }
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
      xTitle: fromVs.xTitle,
      yTitle: fromVs.yTitle,
    };
  }

  const captionY = findFigureCaptionY(words, height, fullText);
  const bottomCeiling =
    captionY != null ? Math.min(captionY - height * 0.01, height * 0.92) : height * 0.94;

  const collectWithFallback = (band) => {
    let hits = collectAxisNumbers(words, band, { minConfidence: 35 });
    if (hits.length < 2) {
      hits = collectAxisNumbers(words, band, { minConfidence: 0 });
    }
    return hits;
  };

  const leftBand = collectWithFallback({
    x0: 0,
    y0: height * 0.08,
    x1: width * 0.32,
    y1: Math.min(height * 0.88, bottomCeiling),
  });
  const bottomBand = collectWithFallback({
    x0: width * 0.12,
    y0: height * 0.68,
    x1: width * 0.98,
    y1: bottomCeiling,
  });

  const yRange = pickAxisRangeFromHits(leftBand, 'y');
  const xRange = pickAxisRangeFromHits(bottomBand, 'x');

  const graphTitle = extractGraphTitle(words, width, height, fullText);
  const fromVs = titlesFromVsPattern(graphTitle);

  let xTitleFromFull = extractAxisTitleFromBand(
    words,
    {
      x0: width * 0.18,
      y0: height * 0.74,
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
      x1: width * 0.22,
      y1: height * 0.82,
    },
    height,
    { allowVerticalJoin: true }
  );
  if (isFigureCaptionText(xTitleFromFull) || isGarbageAxisLabel(xTitleFromFull)) xTitleFromFull = '';
  if (isFigureCaptionText(yTitleFromFull) || isGarbageAxisLabel(yTitleFromFull)) yTitleFromFull = '';

  let xTitleFromCrop = '';
  let yTitleFromCrop = '';

  if (htmlImage) {
    try {
      console.log('[MANUAL OCR] Reading horizontal X-axis label crop…');
      const xCrop = cropRegionToDataUrl(htmlImage, {
        x: width * 0.2,
        y: Math.max(height * 0.72, bottomCeiling - height * 0.12),
        w: width * 0.7,
        h: Math.max(height * 0.06, bottomCeiling - height * 0.72),
      }, 0);
      if (xCrop) {
        const xLines = await recognizePlainText(worker, xCrop, 7);
        xTitleFromCrop = pickBestAxisLabel(xLines);
      }

      console.log('[MANUAL OCR] Reading vertical Y-axis label (rotated crops)…');
      const yRect = {
        x: 0,
        y: height * 0.15,
        w: width * 0.16,
        h: height * 0.65,
      };
      const yCropCw = cropRegionToDataUrl(htmlImage, yRect, 90);
      const yCropCcw = cropRegionToDataUrl(htmlImage, yRect, -90);
      const yCandidates = [];
      if (yCropCw) {
        yCandidates.push(...(await recognizePlainText(worker, yCropCw, 7)));
      }
      if (yCropCcw) {
        yCandidates.push(...(await recognizePlainText(worker, yCropCcw, 7)));
      }
      yTitleFromCrop = pickBestAxisLabel(yCandidates);
      console.log('[MANUAL OCR] Axis crop candidates', {
        xLines: xTitleFromCrop,
        yCandidates,
        yPicked: yTitleFromCrop,
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

  // Prefer real printed axis labels from crops; then full-image band; then "A vs. B" caption fallback.
  const xTitle = pickBestAxisLabel(xTitleFromCrop, xTitleFromFull, fromVs.xTitle);
  const yTitle = pickBestAxisLabel(yTitleFromCrop, yTitleFromFull, fromVs.yTitle);

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
    tickCounts: { x: bottomBand.length, y: leftBand.length },
    captionY,
    sources: {
      x: { crop: xTitleFromCrop, full: xTitleFromFull, vs: fromVs.xTitle },
      y: { crop: yTitleFromCrop, full: yTitleFromFull, vs: fromVs.yTitle },
    },
  });
  return fields;
};

const parseAxisNumber = (value, fallback = NaN) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readAxisTitle = (axisBlock) => {
  const parts = axisBlock?.title?.text;
  if (!Array.isArray(parts)) return '';
  return parts.map((line) => String(line || '').trim()).filter(Boolean).join(' ');
};

const isLogAxis = (axisBlock) => Boolean(axisBlock?.grid?.log || axisBlock?.scale?.log);

/**
 * Match key for series names: case-insensitive, ignores all whitespace.
 * "VOUT = 0.5V", "VOUT=0.5V", and "vout=0.5v" all map to "vout=0.5v".
 */
export const normalizeSeriesNameForMatch = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

/**
 * HPPeval-style legend name when the label is a VOUT rail (optional for export).
 */
export const canonicalTcSeriesName = (name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';

  const voutMatch = trimmed.match(/^vout\s*=\s*([\d.]+)\s*v?\s*$/i);
  if (voutMatch) {
    return `VOUT=${voutMatch[1]}V`;
  }

  return trimmed;
};

export const parseTypicalCurveFile = (raw) => {
  const tc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!tc || typeof tc !== 'object') {
    throw new Error('Invalid .tc file: expected JSON object.');
  }

  const dataSet = tc.dataSet;
  const seriesList = Array.isArray(dataSet?.data) ? dataSet.data : [];
  if (seriesList.length === 0) {
    throw new Error('Invalid .tc file: no curves in dataSet.data.');
  }

  const titleParts = tc.title?.text;
  const graphTitle = Array.isArray(titleParts)
    ? titleParts.map((line) => String(line || '').trim()).filter(Boolean).join(' ')
    : '';

  const xMin = parseAxisNumber(tc.xAxis?.scale?.min, parseAxisNumber(dataSet.minX, 0));
  const xMax = parseAxisNumber(tc.xAxis?.scale?.max, parseAxisNumber(dataSet.maxX, 1));
  const yMin = parseAxisNumber(tc.yAxis?.scale?.min, parseAxisNumber(dataSet.minY, 0));
  const yMax = parseAxisNumber(tc.yAxis?.scale?.max, parseAxisNumber(dataSet.maxY, 1));

  const config = {
    graphTitle: graphTitle || 'Typical curve',
    xMin: String(xMin),
    xMax: String(xMax),
    yMin: String(yMin),
    yMax: String(yMax),
    xLabel: readAxisTitle(tc.xAxis) || 'X',
    yLabel: readAxisTitle(tc.yAxis) || 'Y',
    xScale: isLogAxis(tc.xAxis) ? 'Logarithmic' : 'Linear',
    yScale: isLogAxis(tc.yAxis) ? 'Logarithmic' : 'Linear',
  };

  const curves = seriesList
    .filter((series) => series?.isVisible !== false)
    .map((series, index) => {
      const rawPoints = Array.isArray(series.points) ? series.points : [];
      const points = rawPoints
        .map(([x, y]) => ({ x: Number(x), y: Number(y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

      return {
        id: `tc-${index}`,
        name: String(series.name || `Series ${index + 1}`).trim() || `Series ${index + 1}`,
        points,
        config: {
          ...config,
          curveName: String(series.name || `Series ${index + 1}`).trim(),
        },
      };
    })
    .filter((curve) => curve.points.length > 0);

  if (curves.length === 0) {
    throw new Error('Invalid .tc file: no plottable points.');
  }

  return { config, curves, raw: tc };
};

export const readTypicalCurveFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseTypicalCurveFile(reader.result));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });

const indexPointsByName = (parsed) => {
  const map = new Map();
  parsed.curves.forEach((curve) => {
    const key = normalizeSeriesNameForMatch(curve.name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, { points: curve.points, label: curve.name });
    }
  });
  return map;
};

const findYAtX = (points, targetX) => {
  const exact = points.find((point) => point.x === targetX);
  if (exact) return exact.y;

  const sorted = [...points].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (targetX >= left.x && targetX <= right.x) {
      if (right.x === left.x) return left.y;
      const ratio = (targetX - left.x) / (right.x - left.x);
      return left.y + ratio * (right.y - left.y);
    }
  }
  return null;
};

export const compareTypicalCurveFiles = (referenceParsed, candidateParsed) => {
  const refByName = indexPointsByName(referenceParsed);
  const rows = [];

  candidateParsed.curves.forEach((candidateCurve) => {
    const key = normalizeSeriesNameForMatch(candidateCurve.name);
    const refEntry = refByName.get(key);
    const refPoints = refEntry?.points;
    if (!refPoints) {
      rows.push({
        series: candidateCurve.name,
        status: 'missing_in_reference',
        maxAbsError: null,
        meanAbsError: null,
        pointCount: candidateCurve.points.length,
      });
      return;
    }

    let maxAbsError = 0;
    let sumAbsError = 0;
    let compared = 0;

    refPoints.forEach((refPoint) => {
      const candidateY = findYAtX(candidateCurve.points, refPoint.x);
      if (!Number.isFinite(candidateY)) return;
      const absError = Math.abs(refPoint.y - candidateY);
      maxAbsError = Math.max(maxAbsError, absError);
      sumAbsError += absError;
      compared += 1;
    });

    rows.push({
      series: candidateCurve.name,
      status: compared > 0 ? 'ok' : 'no_overlap',
      maxAbsError: compared > 0 ? maxAbsError : null,
      meanAbsError: compared > 0 ? sumAbsError / compared : null,
      pointCount: compared,
    });
  });

  refByName.forEach((entry, nameKey) => {
    const hasCandidate = candidateParsed.curves.some(
      (curve) => normalizeSeriesNameForMatch(curve.name) === nameKey
    );
    if (!hasCandidate) {
      rows.push({
        series: entry.label || nameKey,
        status: 'missing_in_candidate',
        maxAbsError: null,
        meanAbsError: null,
        pointCount: 0,
      });
    }
  });

  const comparable = rows.filter((row) => row.status === 'ok' && Number.isFinite(row.maxAbsError));
  const overallMax = comparable.length
    ? Math.max(...comparable.map((row) => row.maxAbsError))
    : null;

  return { rows, overallMax };
};

export const prefixTypicalCurveCurves = (parsed, prefix) =>
  parsed.curves.map((curve, index) => ({
    ...curve,
    id: `${prefix}-${curve.id ?? index}`,
    name: `${prefix}: ${curve.name}`,
    config: {
      ...curve.config,
      curveName: `${prefix}: ${curve.name}`,
    },
  }));

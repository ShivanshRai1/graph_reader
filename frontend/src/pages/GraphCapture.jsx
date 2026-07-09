import ImageUpload from '../components/ImageUpload';
import GraphCanvas from '../components/GraphCanvas';
import GraphConfig from '../components/GraphConfig';
import CapturedPointsList from '../components/CapturedPointsList';
import SavedGraphPreview from '../components/SavedGraphPreview';
import SavedGraphCombinedPreview from '../components/SavedGraphCombinedPreview';
import ViewModalPanel from '../components/ViewModalPanel';
import lineSingleTemplate from '../assets/tc-templates/line-single.json';
import {
  buildTypicalCurveExportFromSavedCurves,
  buildTypicalCurveFilenameForGraph,
  downloadTypicalCurveFile,
  exportSavedCurvesToCsv,
  exportSavedCurvesToJson,
  exportSingleSavedCurveDownloads,
  inferTypicalCurveExportSourceFromCurves,
  isSavedCurvesExportReady,
  resolveGraphConfigForSavedCurvesExport,
  resolveExportGraphConfig,
} from '../utils/tcExport';
import {
  applyAiPointLimitToCurve,
  buildGraphConfigAxisPatch,
  getAiMaxPointsLimit,
  processAiImportedPoints,
  normalizeAiExtractedMetadata,
  resolveDiscovereeAxisFields,
  syncImportedOverlayCanvas,
} from '../utils/aiCurveProcessing';
import {
  buildPlotReferenceAreaFromCaptureBox,
  graphAreasAreSimilar,
  suggestGraphAreaFromImportedPoints,
} from '../utils/graphAreaHelpers';
import { useGraph, graphToCanvasWithBounds, getManualCapturePoints, MANUAL_CAPTURE_OVERLAY_ID } from '../context/GraphContext';
import { clearAnnotationsForCurve } from '../utils/annotationStorage';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';

const MiniGraphCanvas = ({ points }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!points || points.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let xMin = Math.min(...points.map((p) => p.x_value));
    let xMax = Math.max(...points.map((p) => p.x_value));
    let yMin = Math.min(...points.map((p) => p.y_value));
    let yMax = Math.max(...points.map((p) => p.y_value));

    if (xMin === xMax) xMax = xMin + 1;
    if (yMin === yMax) yMax = yMin + 1;

    const pad = 10;
    const w = canvas.width - pad * 2;
    const h = canvas.height - pad * 2;

    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, h + pad);
    ctx.lineTo(w + pad, h + pad);
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h + pad);
    ctx.stroke();

    ctx.strokeStyle = '#0074d9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((pt, i) => {
      const x = pad + ((pt.x_value - xMin) / (xMax - xMin)) * w;
      const y = pad + h - ((pt.y_value - yMin) / (yMax - yMin)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#0074d9';
    points.forEach((pt) => {
      const x = pad + ((pt.x_value - xMin) / (xMax - xMin)) * w;
      const y = pad + h - ((pt.y_value - yMin) / (yMax - yMin)) * h;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [points]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={80}
      style={{
        background: '#ffffff',
        borderRadius: 4,
        border: '1px solid var(--color-border)',
      }}
    />
  );
};

const ViewModalBackdropDimControl = ({ value, onChange }) => (
  <div
    style={{
      fontSize: 12,
      color: '#4b5563',
      marginBottom: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    }}
  >
    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Background dim</span>
    <input
      type="range"
      min="0"
      max="0.65"
      step="0.05"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ flex: '1 1 120px', minWidth: 120 }}
      aria-label="Background dim amount"
    />
    <span style={{ minWidth: 36, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    <span style={{ fontSize: 11, color: '#6b7280' }}>Drag modal aside to compare overlay on graph.</span>
  </div>
);

const shouldSuppressViewModalBackdropClose = (interactionRef) => {
  const interaction = interactionRef?.current;
  if (!interaction?.wasDragged && !interaction?.wasResized) return false;
  interaction.wasDragged = false;
  interaction.wasResized = false;
  return true;
};

const buildGraphGroupId = (imageUrl) => {
  if (!imageUrl) return 'graph_unknown';
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i += 1) {
    hash = (hash * 31 + imageUrl.charCodeAt(i)) >>> 0;
  }
  return `graph_${hash.toString(36)}`;
};

const normalizeImageCandidate = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const lower = value.toLowerCase();
  if (
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return value;
  }

  // Some API rows store relative upload paths. Normalize them so image loading is reliable.
  if (value.startsWith('/')) {
    return `https://www.discoveree.io${value}`;
  }

  if (lower.startsWith('uploads/') || lower.startsWith('images/') || lower.startsWith('assets/')) {
    return `https://www.discoveree.io/${value.replace(/^\/+/, '')}`;
  }

  // Some DiscoverEE payloads return only a bare filename (no leading path).
  // Treat common image filenames as hosted on discoveree root.
  if (!value.includes('/') && /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(value)) {
    return `https://www.discoveree.io/${value}`;
  }

  // Local DB may store raw base64 without a data: prefix.
  const compact = value.replace(/\s/g, '');
  if (compact.length > 200 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    const payload = compact.replace(/^data:[^;]+;base64,/, '');
    return `data:image/png;base64,${payload}`;
  }

  return value;
};

const isEmbeddedGraphImage = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('data:') || normalized.startsWith('blob:');
};

/** localStorage quota is ~5 MB; skip caching oversized base64 graph images. */
const MAX_PERSISTED_GRAPH_IMAGE_CHARS = 1_500_000;

const isRejectedGraphImageToken = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || normalized === '0' || normalized === 'null' || normalized === 'undefined' || normalized === 'nan';
};

const buildDiscovereeGraphImageUrlCandidates = (rawValue, graph = {}) => {
  const value = String(rawValue || '').trim();
  if (!value || isRejectedGraphImageToken(value)) return [];

  const urls = [];
  const pushCandidate = (candidate) => {
    const normalized = normalizeImageCandidate(candidate);
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  };

  pushCandidate(value);

  if (!value.includes('/')) {
    const manf = String(graph?.manf || graph?.manufacturer || '').trim().toLowerCase();
    const partno = String(graph?.partno || graph?.part_number || '').trim().toLowerCase();

    if (value.startsWith('0') && value.length > 1) {
      const withoutLeadingZero = value.slice(1);
      pushCandidate(withoutLeadingZero);
      pushCandidate(`@${withoutLeadingZero}`);
    }

    if (value.startsWith('@')) {
      pushCandidate(value.slice(1));
    } else {
      pushCandidate(`@${value}`);
    }

    pushCandidate(`uploads/${value}`);
    if (manf && partno) {
      pushCandidate(`uploads/${manf}/${partno}/${value}`);
      pushCandidate(`${manf}/${partno}/${value}`);
    }
  }

  return urls;
};

const probeImageUrl = (url, timeoutMs = 12000) =>
  new Promise((resolve) => {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      resolve(false);
      return;
    }

    if (isEmbeddedGraphImage(normalizedUrl)) {
      resolve(true);
      return;
    }

    const img = new Image();
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(false);
    }, timeoutMs);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };

    img.src = normalizedUrl;
  });

/** Pick the first usable graph image without network probing (for immediate display). */
const resolveQuickGraphImage = (graph = {}, graphId = '', extras = {}) => {
  const persisted = extras.persistedGraphImage ?? getValidatedPersistedGraphImage(graphId);
  if (persisted) return persisted;

  const candidates = collectGraphImageCandidates({
    graph,
    graphId,
    restoredPending: extras.restoredPending ?? '',
    persistedGraphImage: persisted,
    backendMirroredImage: extras.backendMirroredImage ?? '',
    localGraphImage: extras.localGraphImage ?? '',
  });

  for (const candidate of candidates) {
    if (isEmbeddedGraphImage(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (isRejectedGraphImageToken(candidate)) continue;
    const urls = buildDiscovereeGraphImageUrlCandidates(candidate, graph);
    if (urls[0]) return urls[0];
  }

  return '';
};

const resolveFirstReachableImageUrl = async (candidates = []) => {
  const list = Array.isArray(candidates) ? candidates : [];

  for (const rawCandidate of list) {
    const rawValue = String(rawCandidate || '').trim();
    if (!rawValue || isRejectedGraphImageToken(rawValue)) continue;

    if (isEmbeddedGraphImage(rawValue)) {
      return rawValue;
    }

    const urlCandidates = buildDiscovereeGraphImageUrlCandidates(rawValue);
    for (const url of urlCandidates) {
      if (await probeImageUrl(url)) {
        return url;
      }
    }
  }

  return '';
};

const collectGraphImageCandidates = ({
  graph = {},
  details = [],
  graphId = '',
  restoredPending = '',
  localGraphImage = '',
  persistedGraphImage = '',
  backendMirroredImage = '',
} = {}) => {
  const ordered = [];
  const push = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || isRejectedGraphImageToken(normalized)) return;
    if (!ordered.includes(normalized)) {
      ordered.push(normalized);
    }
  };

  push(restoredPending);
  push(backendMirroredImage);

  const graphFields = [
    graph?.graph_image,
    graph?.graph_img,
    graph?.graphImage,
    graph?.graph_image_url,
    graph?.image_url,
    graph?.img_url,
    graph?.image,
  ];

  const detailList = Array.isArray(details) ? details : [];
  const detailFields = detailList.flatMap((detail) => [
    detail?.graph_image,
    detail?.graph_img,
    detail?.graphImage,
    detail?.graph_image_url,
    detail?.image_url,
    detail?.img_url,
    detail?.image,
  ]);

  [...graphFields, ...detailFields].forEach(push);
  push(persistedGraphImage);
  push(localGraphImage);

  return ordered;
};

const buildCurveDedupKey = (curve = {}) => {
  const graphId = String(curve?.graphId || curve?.graph_id || '');
  const detailId = String(curve?.detailId || curve?.detail_id || '');
  if (graphId && detailId) {
    return `${graphId}::${detailId}`;
  }

  const points = Array.isArray(curve?.points) ? curve.points : [];
  const pointSignature = points
    .map((point) => {
      const x = Number(point?.x_value ?? point?.x);
      const y = Number(point?.y_value ?? point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return '';
      }
      return `${x}:${y}`;
    })
    .filter(Boolean)
    .join('|');

  return [
    String(curve?.id || ''),
    graphId,
    String(curve?.name || curve?.curve_name || ''),
    pointSignature,
  ].join('::');
};

const dedupeCurves = (curves = []) => {
  const list = Array.isArray(curves) ? curves : [];
  const seen = new Set();
  const deduped = [];

  list.forEach((curve) => {
    const key = buildCurveDedupKey(curve);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(curve);
  });

  return deduped;
};

const buildXYDedupKey = (x, y, precision = 6) => {
  const xNum = Number(x);
  const yNum = Number(y);
  if (!Number.isFinite(xNum) || !Number.isFinite(yNum)) return '';
  return `${xNum.toFixed(precision)}|${yNum.toFixed(precision)}`;
};

const dedupePointsByXY = (points = [], precision = 6) => {
  const list = Array.isArray(points) ? points : [];
  const seen = new Set();
  const unique = [];
  let removed = 0;

  list.forEach((point) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const key = buildXYDedupKey(x, y, precision);
    if (!key) {
      return;
    }

    if (seen.has(key)) {
      removed += 1;
      return;
    }

    seen.add(key);
    unique.push({ ...point, x, y });
  });

  return { unique, removed };
};

const resolveGraphTitle = (graph = {}, details = []) => {
  const detailList = Array.isArray(details) ? details : [];
  const candidates = [
    graph?.graph_title,
    graph?.graphTitle,
    graph?.title,
    detailList[0]?.graph_title,
    detailList[0]?.curve_title,
    graph?.partno,
    graph?.identifier,
    graph?.graph_id ? `Graph ${graph.graph_id}` : '',
  ];

  return candidates.find((value) => String(value || '').trim() !== '') || '';
};

const formatTemperatureCelsius = (value) => {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1000) / 1000).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const parseTemperatureToCelsius = (rawValue, fallbackUnit = 'C') => {
  const text = String(rawValue || '').trim();
  if (!text) {
    return { celsiusText: '', unit: String(fallbackUnit || 'C').toUpperCase() };
  }

  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:deg\s*)?(c|f|k)?\s*$/i);
  if (!match) {
    return { celsiusText: '', unit: String(fallbackUnit || 'C').toUpperCase() };
  }

  const numericValue = Number.parseFloat(match[1]);
  const unit = String(match[2] || fallbackUnit || 'C').toUpperCase();
  if (!Number.isFinite(numericValue)) {
    return { celsiusText: '', unit };
  }

  if (unit === 'F') {
    return { celsiusText: formatTemperatureCelsius((numericValue - 32) * (5 / 9)), unit };
  }

  if (unit === 'K') {
    return { celsiusText: formatTemperatureCelsius(numericValue - 273.15), unit };
  }

  return { celsiusText: formatTemperatureCelsius(numericValue), unit };
};

const hasImplicitTemperatureContext = (...values) => {
  const combined = values
    .flat()
    .filter(Boolean)
    .map((value) => String(value))
    .join(' ')
    .toLowerCase();

  if (!combined) return false;

  return /(temperature|temp\b|tc\b|tj\b)/i.test(combined);
};

const isTemperatureSymbol = (...values) => {
  const combined = values
    .flat()
    .filter(Boolean)
    .map((value) => String(value))
    .join(' ')
    .toLowerCase();

  if (!combined) return false;

  return /(graph_tctj|df_tj|tctj|temperature|temp\b|tc\b|tj\b)/i.test(combined);
};

const resolveTemperatureForSave = (rawTemperature, shouldDefaultRoomTemperature) => {
  const parsedTemperature = parseTemperatureToCelsius(rawTemperature);
  if (parsedTemperature.celsiusText) {
    // console.log('[TEMP_DEBUG] Temperature normalized before save', {
    //   rawInput: String(rawTemperature || ''),
    //   detectedUnit: parsedTemperature.unit,
    //   normalizedCelsius: parsedTemperature.celsiusText,
    //   usedDefaultRoomTemperature: false
    // });
    return parsedTemperature.celsiusText;
  }

  const fallbackTemperature = shouldDefaultRoomTemperature ? '25' : '';
  // console.log('[TEMP_DEBUG] Temperature fallback applied before save', {
  //   rawInput: String(rawTemperature || ''),
  //   detectedUnit: parsedTemperature.unit,
  //   normalizedCelsius: fallbackTemperature,
  //   usedDefaultRoomTemperature: shouldDefaultRoomTemperature,
  // });
  return fallbackTemperature;
};

const getLastNonEmptyQueryValue = (searchParams, key) => {
  const values = searchParams.getAll(key).map((value) => String(value || '').trim()).filter(Boolean);
  return values.length > 0 ? values[values.length - 1] : '';
};

const normalizeSessionIdentifier = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const lower = value.toLowerCase();
  if (['0', 'null', 'undefined', 'nan', 'false'].includes(lower)) {
    return '';
  }

  return value;
};

const GRAPH_STABLE_IDENTIFIER_PREFIX = 'usergraph_gid_';

const getPersistedStableGraphIdentifier = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return '';
  try {
    return normalizeSessionIdentifier(localStorage.getItem(`graph_stable_identifier_${normalizedGraphId}`));
  } catch {
    return '';
  }
};

const persistStableGraphIdentifier = (graphId, identifier) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedIdentifier = normalizeSessionIdentifier(identifier);
  if (!normalizedGraphId || !normalizedIdentifier) return normalizedIdentifier;
  try {
    localStorage.setItem(`graph_stable_identifier_${normalizedGraphId}`, normalizedIdentifier);
  } catch (error) {
    console.warn('[GRAPH SESSION] Failed to persist stable identifier:', error);
  }
  return normalizedIdentifier;
};

/** DiscoverEE often returns identifier "0" — generate a stable per-graph_id identifier for append/edit. */
const ensureStableGraphIdentifier = (graphId, preferredIdentifier = '') => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return '';

  const fromPreferred = normalizeSessionIdentifier(preferredIdentifier);
  if (fromPreferred) {
    return persistStableGraphIdentifier(normalizedGraphId, fromPreferred);
  }

  const persisted = getPersistedStableGraphIdentifier(normalizedGraphId);
  if (persisted) return persisted;

  return persistStableGraphIdentifier(
    normalizedGraphId,
    `${GRAPH_STABLE_IDENTIFIER_PREFIX}${normalizedGraphId}`
  );
};

/** Pick the identifier for a specific graph_id — never reuse another graph's session identifier. */
const resolveIdentifierForGraph = ({
  graphId = '',
  curve = null,
  savedCurves = [],
  urlParams = {},
  sessionGraphId = '',
  sessionIdentifier = '',
} = {}) => {
  const targetGraphId = String(graphId || '').trim();
  if (!targetGraphId) {
    return normalizeSessionIdentifier(curve?.identifier || urlParams?.identifier || '');
  }

  const curveGraphId = String(curve?.graphId || '').trim();
  if (curveGraphId === targetGraphId) {
    const fromCurve = normalizeSessionIdentifier(curve?.identifier);
    if (fromCurve) return fromCurve;
  }

  const curveList = Array.isArray(savedCurves) ? savedCurves : [];
  for (const savedCurve of curveList) {
    if (String(savedCurve?.graphId || '').trim() !== targetGraphId) continue;
    const fromSaved = normalizeSessionIdentifier(savedCurve?.identifier);
    if (fromSaved) return fromSaved;
  }

  if (String(urlParams?.graph_id || '').trim() === targetGraphId) {
    const fromUrl = normalizeSessionIdentifier(urlParams?.identifier);
    if (fromUrl) return fromUrl;
  }

  if (String(sessionGraphId || '').trim() === targetGraphId) {
    const fromSession = normalizeSessionIdentifier(sessionIdentifier);
    if (fromSession) return fromSession;
  }

  return ensureStableGraphIdentifier(targetGraphId);
};

/** Pick the detail_id for a newly saved curve without reusing an existing curve's id. */
const resolveDetailIdFromRefetch = ({
  refetchDetails = [],
  savedPoints = [],
  curveTitle = '',
  usedDetailIds = [],
  immediateDetailId = '',
} = {}) => {
  const used = usedDetailIds instanceof Set ? usedDetailIds : new Set(usedDetailIds || []);

  if (immediateDetailId && !used.has(String(immediateDetailId))) {
    return String(immediateDetailId);
  }

  const savedXyStr = (savedPoints || [])
    .map((point) => `{x:${point.x_value ?? point.x},y:${point.y_value ?? point.y}}`)
    .join(',');

  if (savedXyStr) {
    const xyMatch = refetchDetails.find((detail) => {
      if (!detail?.xy || !detail?.id) return false;
      const normalizedSavedXy = savedXyStr.replace(/\s/g, '').toLowerCase();
      const normalizedApiXy = detail.xy.replace(/\s/g, '').toLowerCase();
      return normalizedSavedXy === normalizedApiXy;
    });
    if (xyMatch?.id && !used.has(String(xyMatch.id))) {
      return String(xyMatch.id);
    }
  }

  const normalizedTitle = String(curveTitle || '').trim().toLowerCase();
  if (normalizedTitle) {
    const titleMatch = refetchDetails.find((detail) => {
      if (!detail?.id || used.has(String(detail.id))) return false;
      return String(detail.curve_title || '').trim().toLowerCase() === normalizedTitle;
    });
    if (titleMatch?.id) {
      return String(titleMatch.id);
    }
  }

  const unusedDetails = refetchDetails.filter((detail) => detail?.id && !used.has(String(detail.id)));
  if (unusedDetails.length > 0) {
    return String(unusedDetails[unusedDetails.length - 1].id);
  }

  return '';
};

const UNIT_PREFIX_SYMBOL_MAP = {
  '1e-12': 'p',
  '1e-9': 'n',
  '1e-6': 'μ',
  '1e-3': 'm',
  '1': '',
  '1e3': 'k',
  '1e6': 'M',
  '1e9': 'G',
  '1e12': 'T',
};

const extractUnitFromAxisTitle = (title) => {
  const text = String(title || '').trim();
  if (!text) return '';
  const squareMatch = text.match(/\[([^\]]+)\]/);
  if (squareMatch && squareMatch[1]) return squareMatch[1].trim();
  const roundMatch = text.match(/\(([^)]+)\)\s*$/);
  return roundMatch && roundMatch[1] ? roundMatch[1].trim() : '';
};

const stripKnownUnitPrefix = (unitText) => {
  const text = String(unitText || '').trim();
  if (!text) return '';
  const first = text.charAt(0);
  if (['p', 'n', 'u', 'μ', 'm', 'k', 'K', 'M', 'G', 'T'].includes(first) && text.length > 1) {
    return text.slice(1);
  }
  return text;
};

const formatAxisUnitCompact = (prefixValue, axisTitle) => {
  const normalizedPrefix = String(prefixValue ?? '').trim();
  const normalizedPrefixSymbol = UNIT_PREFIX_SYMBOL_MAP[normalizedPrefix];
  const titleUnit = extractUnitFromAxisTitle(axisTitle);

  if (normalizedPrefixSymbol !== undefined) {
    const baseUnit = stripKnownUnitPrefix(titleUnit);
    if (!baseUnit) return normalizedPrefixSymbol || '1';
    return `${normalizedPrefixSymbol}${baseUnit}`;
  }

  if (normalizedPrefix) {
    return normalizedPrefix.replace(/^u(?=[A-Za-z])/, 'μ');
  }

  return titleUnit || '';
};

const formatAxisHeaderWithUnit = (axisFallback, axisTitle, axisUnit) => {
  const titleText = String(axisTitle || '').trim() || axisFallback;
  const unitText = String(axisUnit || '').trim();
  return unitText ? `${titleText}( Unit: ${unitText} )` : titleText;
};

const stripDfPrefixForDisplay = (rawLabel) => {
  const label = String(rawLabel || '').trim();
  if (!label) return '';
  return label.toLowerCase().startsWith('df_') ? label.slice(3) : label;
};

const getAlternateDfSymbolKey = (rawKey) => {
  const key = String(rawKey || '').trim();
  if (!key) return '';
  return key.toLowerCase().startsWith('df_') ? key.slice(3) : `df_${key}`;
};

const isValidSymbolValue = (value) => {
  // Check if value is null, undefined, or not a valid primitive
  if (value === undefined || value === null) return false;
  
  // Convert to string and check
  const strValue = String(value).trim();
  if (!strValue) return false;
  
  // Exclude literal string representations of invalid values
  const lowerValue = strValue.toLowerCase();
  if (lowerValue === 'null' || lowerValue === 'undefined' || lowerValue === 'nan') {
    return false;
  }
  
  return true;
};

const normalizePersistedGraphArea = (area) => {
  const x = Number(area?.x);
  const y = Number(area?.y);
  const width = Number(area?.width);
  const height = Number(area?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width,
    height,
  };
};

const hasValidAxisMapping = (config = {}) => {
  const xMin = parseFloat(config.xMin);
  const xMax = parseFloat(config.xMax);
  const yMin = parseFloat(config.yMin);
  const yMax = parseFloat(config.yMax);

  return (
    Number.isFinite(xMin) &&
    Number.isFinite(xMax) &&
    Number.isFinite(yMin) &&
    Number.isFinite(yMax) &&
    xMin !== xMax &&
    yMin !== yMax &&
    Boolean(config.xScale) &&
    Boolean(config.yScale)
  );
};

const isDefaultPlaceholderAxisBounds = (config = {}) => {
  const xMin = parseFloat(config.xMin);
  const xMax = parseFloat(config.xMax);
  const yMin = parseFloat(config.yMin);
  const yMax = parseFloat(config.yMax);
  return xMin === 0 && xMax === 100 && yMin === 0 && yMax === 100;
};

const hasUsableAxisMapping = (config = {}) =>
  hasValidAxisMapping(config) && !isDefaultPlaceholderAxisBounds(config);

const getPersistedGraphContext = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return null;

  try {
    const raw = localStorage.getItem(`graph_context_${normalizedGraphId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      graphArea: normalizePersistedGraphArea(parsed?.graphArea),
      plotReferenceArea: normalizePersistedGraphArea(parsed?.plotReferenceArea),
      plotReferenceLocked: parsed?.plotReferenceLocked === true,
      axis: parsed?.axis && typeof parsed.axis === 'object' ? parsed.axis : null,
    };
  } catch (error) {
    console.warn('[DEBUG] Failed to read persisted graph context:', error);
    return null;
  }
};

const buildPersistedAxisPayload = (axisConfig = {}) => ({
  xMin: axisConfig.xMin ?? '',
  xMax: axisConfig.xMax ?? '',
  yMin: axisConfig.yMin ?? '',
  yMax: axisConfig.yMax ?? '',
  xScale: axisConfig.xScale || 'Linear',
  yScale: axisConfig.yScale || 'Linear',
  xUnitPrefix: axisConfig.xUnitPrefix || '1',
  yUnitPrefix: axisConfig.yUnitPrefix || '1',
  xLabel: axisConfig.xLabel || '',
  yLabel: axisConfig.yLabel || '',
});

const patchSavedCurvesWithAxisConfig = (curves, axisConfig, graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId || !hasValidAxisMapping(axisConfig)) {
    return curves;
  }

  const axisPatch = buildPersistedAxisPayload(axisConfig);
  return (Array.isArray(curves) ? curves : []).map((curve) => {
    const curveGraphId = String(curve?.graphId || '').trim();
    if (curveGraphId && curveGraphId !== normalizedGraphId) return curve;

    return {
      ...curve,
      x_min: axisPatch.xMin,
      x_max: axisPatch.xMax,
      y_min: axisPatch.yMin,
      y_max: axisPatch.yMax,
      x_scale: axisPatch.xScale,
      y_scale: axisPatch.yScale,
      x_unit: axisPatch.xUnitPrefix,
      y_unit: axisPatch.yUnitPrefix,
      x_label: axisPatch.xLabel,
      y_label: axisPatch.yLabel,
      config: {
        ...(curve.config || {}),
        xMin: axisPatch.xMin,
        xMax: axisPatch.xMax,
        yMin: axisPatch.yMin,
        yMax: axisPatch.yMax,
        xScale: axisPatch.xScale,
        yScale: axisPatch.yScale,
        xUnitPrefix: axisPatch.xUnitPrefix,
        yUnitPrefix: axisPatch.yUnitPrefix,
        xLabel: axisPatch.xLabel,
        yLabel: axisPatch.yLabel,
      },
    };
  });
};

const buildCanvasSizeHintFromArea = (area, imageSize = {}) => ({
  width: Math.max(
    Number(imageSize.width) || 0,
    area.x + area.width + 48,
    1
  ),
  height: Math.max(
    Number(imageSize.height) || 0,
    area.y + area.height + 48,
    1
  ),
});

const resolveLockedPlotReferenceArea = (captureArea, axisConfig, imageSize = {}) => {
  if (!captureArea) {
    return null;
  }

  return (
    buildPlotReferenceAreaFromCaptureBox(
      captureArea,
      axisConfig,
      buildCanvasSizeHintFromArea(captureArea, imageSize)
    ) || captureArea
  );
};

const resolvePersistedPlotReferenceArea = (persistedContext, imageSize = {}) => {
  const captureArea = normalizePersistedGraphArea(persistedContext?.graphArea);
  const plotRef = normalizePersistedGraphArea(persistedContext?.plotReferenceArea);
  const axis = persistedContext?.axis;

  if (persistedContext?.plotReferenceLocked && captureArea && axis && hasUsableAxisMapping(axis)) {
    return resolveLockedPlotReferenceArea(captureArea, axis, imageSize);
  }

  if (persistedContext?.plotReferenceLocked) {
    return plotRef || captureArea;
  }
  return plotRef || captureArea;
};

const persistGraphContext = (graphId, area, axisConfig = {}, options = {}) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedArea = normalizePersistedGraphArea(area);
  if (!normalizedGraphId || !normalizedArea) return;

  const shouldPersistAxis =
    options.persistAxis !== false && hasValidAxisMapping(axisConfig);
  const existing = getPersistedGraphContext(normalizedGraphId);
  const axis = shouldPersistAxis
    ? buildPersistedAxisPayload(axisConfig)
    : (existing?.axis || null);
  const normalizedPlotReference = options.plotReferenceLocked === true
    ? normalizePersistedGraphArea(
        options.plotReferenceArea || existing?.plotReferenceArea || normalizedArea
      )
    : normalizePersistedGraphArea(
        options.plotReferenceArea || existing?.plotReferenceArea || normalizedArea
      );
  const plotReferenceLocked =
    options.plotReferenceLocked !== undefined
      ? Boolean(options.plotReferenceLocked)
      : Boolean(existing?.plotReferenceLocked);

  try {
    localStorage.setItem(
      `graph_context_${normalizedGraphId}`,
      JSON.stringify({
        graphArea: normalizedArea,
        plotReferenceArea: normalizedPlotReference,
        plotReferenceLocked,
        axis,
      })
    );
  } catch (error) {
    console.warn('[DEBUG] Failed to persist graph context:', error);
  }
};

const readPersistedGraphImageKey = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return '';

  try {
    return String(localStorage.getItem(`graph_image_${normalizedGraphId}`) || '');
  } catch (error) {
    console.warn('[DEBUG] Failed to read persisted graph image key:', error);
    return '';
  }
};

/** Same-browser cache only: embedded images keyed by graph_id (skip stale filename tokens). */
const getValidatedPersistedGraphImage = (graphId) => {
  const normalized = normalizeImageCandidate(readPersistedGraphImageKey(graphId));
  if (!normalized || !isEmbeddedGraphImage(normalized)) return '';
  return normalized;
};

const resolveAxisValueForPersist = (...values) => {
  for (const candidate of values) {
    if (isValidSymbolValue(candidate)) {
      return String(candidate).trim();
    }
  }
  return '';
};

const getCurveMergeKey = (curve) => {
  const detailId = String(curve?.detailId || curve?.detail_id || '').trim();
  if (detailId) return `d:${detailId}`;

  const graphId = String(curve?.graphId || '').trim();
  const id = String(curve?.id || '').trim();
  if (id) return `i:${graphId}:${id}`;

  const name = String(curve?.name || curve?.config?.curveName || curve?.curve_name || '').trim();
  return `n:${graphId}:${name}`;
};

const getCurveDetailIdNumber = (curve) =>
  Number(String(curve?.detailId || curve?.detail_id || '').trim() || 0);

const collectCompanyDetailIds = (curves = []) => {
  const ids = new Set();
  (Array.isArray(curves) ? curves : []).forEach((curve) => {
    const detailId = String(curve?.detailId || curve?.detail_id || '').trim();
    if (detailId) ids.add(detailId);
  });
  return ids;
};

/** Drop stale browser-cache curves whose detail_id no longer exists on DiscoverEE. */
const filterPersistedCurvesForCompanyApi = (companyCurves = [], persistedCurves = []) => {
  const apiDetailIds = collectCompanyDetailIds(companyCurves);
  if (apiDetailIds.size === 0) {
    return Array.isArray(persistedCurves) ? persistedCurves : [];
  }

  return (Array.isArray(persistedCurves) ? persistedCurves : []).filter((curve) => {
    const detailId = String(curve?.detailId || curve?.detail_id || '').trim();
    if (!detailId) return false;
    return apiDetailIds.has(detailId);
  });
};

const dedupeCompanyApiDetailsById = (details = []) => {
  const bestById = new Map();
  const withoutId = [];

  (Array.isArray(details) ? details : []).forEach((detail) => {
    const id = String(detail?.id ?? '').trim();
    if (!id) {
      withoutId.push(detail);
      return;
    }
    const existing = bestById.get(id);
    const existingId = Number(existing?.id || 0);
    const candidateId = Number(detail?.id || 0);
    if (!existing || candidateId >= existingId) {
      bestById.set(id, detail);
    }
  });

  return [...withoutId, ...Array.from(bestById.values())];
};

const shouldReplaceMergedCurve = (existing, candidate) => {
  if (!existing) return true;
  if (candidate?.locallyModified && !existing?.locallyModified) return true;
  if (existing?.locallyModified && !candidate?.locallyModified) return false;
  if (candidate?.userAdjustedPoints && !existing?.userAdjustedPoints) return true;
  if (existing?.userAdjustedPoints && !candidate?.userAdjustedPoints) return false;

  const existingTs = Number(existing?.updatedAt || 0);
  const candidateTs = Number(candidate?.updatedAt || 0);
  if (candidateTs > existingTs) return true;
  if (candidateTs < existingTs) return false;

  const existingDetailId = getCurveDetailIdNumber(existing);
  const candidateDetailId = getCurveDetailIdNumber(candidate);
  if (candidateDetailId > existingDetailId) return true;
  if (candidateDetailId < existingDetailId) return false;

  if (candidate?.locallyModified) return true;

  const existingPointCount = Array.isArray(existing?.points) ? existing.points.length : 0;
  const candidatePointCount = Array.isArray(candidate?.points) ? candidate.points.length : 0;
  return candidatePointCount > existingPointCount;
};

const mergeCurvesForRestore = (...sources) => {
  const merged = new Map();

  sources.flat().forEach((curve) => {
    if (!curve) return;
    const key = getCurveMergeKey(curve);
    const existing = merged.get(key);
    if (shouldReplaceMergedCurve(existing, curve)) {
      merged.set(key, curve);
    }
  });

  return dedupeCurvesByGraphAndName(Array.from(merged.values()));
};

const dedupeCurvesByGraphAndName = (curves = []) => {
  const merged = new Map();

  curves.forEach((curve) => {
    const key = getCurveMergeKey(curve);
    const existing = merged.get(key);
    if (shouldReplaceMergedCurve(existing, curve)) {
      merged.set(key, curve);
    }
  });

  return dedupeCurves(Array.from(merged.values()));
};

const normalizeCurveForStorage = (curve) => {
  if (!curve || typeof curve !== 'object') return null;
  const graphImageUrl = String(curve.graphImageUrl || curve.graph_img || '');
  return {
    ...curve,
    graphImageUrl: graphImageUrl.startsWith('data:') ? '' : graphImageUrl,
  };
};

const getPersistedSavedCurves = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return null;

  try {
    const raw = localStorage.getItem(`saved_curves_${normalizedGraphId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.curves)) return null;
    return {
      savedAt: Number(parsed.savedAt || 0),
      source: parsed.source || 'company',
      curves: parsed.curves.filter(Boolean),
    };
  } catch (error) {
    console.warn('[DEBUG] Failed to read persisted saved curves:', error);
    return null;
  }
};

const persistSavedCurves = (graphId, curves, source = 'company') => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return;

  const list = Array.isArray(curves) ? curves.filter(Boolean) : [];
  if (list.length === 0) return;

  try {
    localStorage.setItem(
      `saved_curves_${normalizedGraphId}`,
      JSON.stringify({
        savedAt: Date.now(),
        source,
        curves: list.map((curve) => normalizeCurveForStorage(curve)).filter(Boolean),
      })
    );
  } catch (error) {
    console.warn('[DEBUG] Failed to persist saved curves:', error);
  }
};

const clearPersistedSavedCurves = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return;

  try {
    localStorage.removeItem(`saved_curves_${normalizedGraphId}`);
  } catch (error) {
    console.warn('[DEBUG] Failed to clear persisted saved curves:', error);
  }
};

const clearPersistedGraphSessionArtifacts = (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return;

  clearPersistedSavedCurves(normalizedGraphId);

  try {
    localStorage.removeItem(`graph_image_${normalizedGraphId}`);
    localStorage.removeItem(`graph_context_${normalizedGraphId}`);
  } catch (error) {
    console.warn('[DEBUG] Failed to clear persisted graph session artifacts:', error);
  }
};

const hydrateStoredCurves = (curves, graphId) => {
  const fallbackImage = getValidatedPersistedGraphImage(graphId);
  return (Array.isArray(curves) ? curves : []).map((curve) => {
    const graphImageUrl =
      curve?.graphImageUrl ||
      curve?.graph_img ||
      fallbackImage ||
      '';
    return {
      ...curve,
      graphImageUrl,
      graphGroupId: curve?.graphGroupId || buildGraphGroupId(graphImageUrl),
    };
  });
};

const mapLocalApiCurveToSavedCurve = (curve, graphId, graphImageUrl = '') => {
  const resolvedImage = graphImageUrl || curve?.graph_image || '';
  const graphGroupId = buildGraphGroupId(resolvedImage || '');
  return {
    id: curve.id,
    detailId: '',
    graphId: String(graphId || curve.discoveree_graph_id || ''),
    discoveree_cat_id: curve.discoveree_cat_id || null,
    name: curve.curve_name || `Curve ${curve.id}`,
    points: Array.isArray(curve.data_points)
      ? curve.data_points.map((pt) => ({ x_value: pt.x_value, y_value: pt.y_value }))
      : [],
    symbolValues: {},
    config: {
      graphTitle: curve.graph_title || '',
      curveName: curve.curve_name || '',
      xScale: curve.x_scale || 'Linear',
      yScale: curve.y_scale || 'Linear',
      xUnitPrefix: curve.x_unit || '1',
      yUnitPrefix: curve.y_unit || '1',
      xMin: resolveAxisValueForPersist(curve.x_min),
      xMax: resolveAxisValueForPersist(curve.x_max),
      yMin: resolveAxisValueForPersist(curve.y_min),
      yMax: resolveAxisValueForPersist(curve.y_max),
      logDataModeX: (curve.x_scale || 'Linear') === 'Logarithmic' ? 'actual' : 'linear',
      logDataModeY: (curve.y_scale || 'Linear') === 'Logarithmic' ? 'actual' : 'linear',
      temperature: curve.temperature || '',
    },
    graphGroupId,
    graphImageUrl: resolvedImage,
    updatedAt: curve.created_at ? Date.parse(curve.created_at) || 0 : 0,
  };
};

const fetchAllLocalCurvesByGraphId = async (apiUrl, graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId || !apiUrl) return [];

  try {
    const response = await fetch(
      `${apiUrl}/api/curves/all-by-graph/${encodeURIComponent(normalizedGraphId)}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('[DEBUG] Failed to fetch all local curves by graph:', error);
    return [];
  }
};

const fetchMirroredGraphImageFromBackend = async (apiUrl, graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId || !apiUrl) return '';

  try {
    const response = await fetch(
      `${apiUrl}/api/graphs/${encodeURIComponent(normalizedGraphId)}/graph-image`
    );
    if (!response.ok) return '';
    const data = await response.json().catch(() => ({}));
    const normalized = normalizeImageCandidate(data?.graph_image || '');
    return isEmbeddedGraphImage(normalized) ? normalized : '';
  } catch (error) {
    console.warn('[GRAPH_IMG_MIRROR] Failed to fetch mirrored graph image:', error);
    return '';
  }
};

const mirrorGraphImageToBackend = async (apiUrl, graphId, imageUrl, { localCurveId = null } = {}) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedImage = normalizeImageCandidate(imageUrl);
  if (!apiUrl || !normalizedGraphId || !isEmbeddedGraphImage(normalizedImage)) return false;
  if (normalizedImage.length > MAX_PERSISTED_GRAPH_IMAGE_CHARS) {
    console.warn('[GRAPH_IMG_MIRROR] Skipping mirror — image exceeds size limit for graph_id:', normalizedGraphId);
    return false;
  }

  try {
    const response = await fetch(
      `${apiUrl}/api/graphs/${encodeURIComponent(normalizedGraphId)}/graph-image`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph_image: normalizedImage,
          ...(localCurveId ? { local_curve_id: Number(localCurveId) } : {}),
        }),
      }
    );
    if (!response.ok) {
      console.warn('[GRAPH_IMG_MIRROR] Mirror PUT failed:', normalizedGraphId, response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[GRAPH_IMG_MIRROR] Mirror PUT error:', error);
    return false;
  }
};

const buildRestoredSavedCurves = ({
  graphId,
  companyCurves = [],
  localApiCurvesRaw = [],
  graphImageUrl = '',
}) => {
  const persisted = getPersistedSavedCurves(graphId);
  const localApiCurves = localApiCurvesRaw.map((curve) =>
    mapLocalApiCurveToSavedCurve(curve, graphId, graphImageUrl)
  );
  const prunedPersisted = filterPersistedCurvesForCompanyApi(
    companyCurves,
    persisted?.curves || []
  );
  if (
    Array.isArray(persisted?.curves) &&
    prunedPersisted.length !== persisted.curves.length
  ) {
    console.log('[GRAPH SESSION] Pruned stale browser-cache curves not on DiscoverEE:', {
      graphId,
      before: persisted.curves.length,
      after: prunedPersisted.length,
    });
  }
  const merged = mergeCurvesForRestore(
    companyCurves,
    localApiCurves,
    prunedPersisted
  );
  const hydrated = hydrateStoredCurves(merged, graphId).map((curve) => ({
    ...curve,
    graphImageUrl: curve.graphImageUrl || graphImageUrl,
    graphGroupId: curve.graphGroupId || buildGraphGroupId(graphImageUrl || curve.graphImageUrl || ''),
  }));

  return {
    curves: dedupeCurves(hydrated.map((curve) => applyAiPointLimitToCurve(curve))),
    source:
      persisted?.source ||
      (companyCurves.length > 0 ? 'company' : localApiCurves.length > 0 ? 'local' : 'company'),
  };
};

const buildImportedPointsForCurve = (curve, area, config) => {
  const pointList = Array.isArray(curve?.points) ? curve.points : [];
  return pointList
    .map((point) => {
      const x = Number(point?.x_value ?? point?.x);
      const y = Number(point?.y_value ?? point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      const { canvasX, canvasY } = graphToCanvasWithBounds(x, y, area, config);
      return {
        x,
        y,
        canvasX,
        canvasY,
        imported: true,
      };
    })
    .filter(Boolean);
};

const normalizeCurveConfigFields = (curve) => ({
  xMin: curve?.config?.xMin ?? curve?.x_min,
  xMax: curve?.config?.xMax ?? curve?.x_max,
  yMin: curve?.config?.yMin ?? curve?.y_min,
  yMax: curve?.config?.yMax ?? curve?.y_max,
  xScale: curve?.config?.xScale ?? curve?.x_scale,
  yScale: curve?.config?.yScale ?? curve?.y_scale,
  xUnit: curve?.config?.xUnitPrefix ?? curve?.x_unit,
  yUnit: curve?.config?.yUnitPrefix ?? curve?.y_unit,
  xUnitPrefix: curve?.config?.xUnitPrefix ?? curve?.x_unit,
  yUnitPrefix: curve?.config?.yUnitPrefix ?? curve?.y_unit,
  xunit: curve?.config?.xUnitPrefix ?? curve?.x_unit,
  yunit: curve?.config?.yUnitPrefix ?? curve?.y_unit,
  logDataModeX: curve?.config?.logDataModeX ?? curve?.logDataModeX,
  logDataModeY: curve?.config?.logDataModeY ?? curve?.logDataModeY,
  xLabel: curve?.config?.xLabel ?? curve?.x_label,
  yLabel: curve?.config?.yLabel ?? curve?.y_label,
  graphTitle: curve?.config?.graphTitle ?? curve?.graph_title ?? curve?.name,
  curveName: curve?.config?.curveName ?? curve?.curve_name ?? curve?.name,
});

const snapAxisMinBound = (min, max) => {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return min;
  const span = Math.max(hi - lo, 1e-9);
  if (lo >= 0 && lo <= span * 0.05) return 0;
  return lo;
};

/** Common printed axis tick values on datasheet plots (includes 7 between 6 and 8). */
const COMPACT_AXIS_MAX_TICKS = [
  0.5, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10,
  12, 15, 16, 18, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100,
  120, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000,
  1200, 1500, 2000, 2500, 3000, 5000, 10000,
];

const snapAxisMaxBound = (max) => {
  const value = Number(max);
  if (!Number.isFinite(value)) return max;
  if (value <= 0) return value;

  const nextTick = COMPACT_AXIS_MAX_TICKS.find((tick) => tick >= value);
  if (nextTick !== undefined) {
    const tickIndex = COMPACT_AXIS_MAX_TICKS.indexOf(nextTick);
    const prevTick = tickIndex > 0 ? COMPACT_AXIS_MAX_TICKS[tickIndex - 1] : null;
    if (prevTick && nextTick - prevTick === 1 && value <= prevTick * 1.06) {
      return prevTick;
    }
    // Datasheet plots often label ticks 0,4,8,12,16 but the full axis runs to 20.
    if (nextTick === 16 && value >= 8 && value <= 16) {
      return 20;
    }
    return nextTick;
  }

  const abs = Math.abs(value);
  const exponent = Math.floor(Math.log10(abs));
  const fraction = abs / (10 ** exponent);
  const niceFractions = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];
  const niceFraction = niceFractions.find((candidate) => candidate >= fraction) || 10;
  return niceFraction * (10 ** exponent);
};

const snapAxisBounds = ({ xMin, xMax, yMin, yMax }) => {
  const rawXMin = Number(xMin);
  const rawXMax = Number(xMax);
  const rawYMin = Number(yMin);
  const rawYMax = Number(yMax);
  if (
    !Number.isFinite(rawXMin) || !Number.isFinite(rawXMax) ||
    !Number.isFinite(rawYMin) || !Number.isFinite(rawYMax) ||
    rawXMax <= rawXMin || rawYMax <= rawYMin
  ) {
    return { xMin, xMax, yMin, yMax };
  }

  const snappedXMin = snapAxisMinBound(rawXMin, rawXMax);
  const snappedYMin = snapAxisMinBound(rawYMin, rawYMax);
  let snappedXMax = snapAxisMaxBound(rawXMax);
  let snappedYMax = snapAxisMaxBound(rawYMax);

  // Id-Vds style plots: both axes share a 0–20 scale even when Y data peaks below 16.
  if (
    snappedXMin === 0 &&
    snappedYMin === 0 &&
    snappedXMax === 20 &&
    snappedYMax >= 8 &&
    snappedYMax <= 16
  ) {
    snappedYMax = 20;
  }

  return {
    xMin: snappedXMin,
    xMax: snappedXMax,
    yMin: snappedYMin,
    yMax: snappedYMax,
  };
};

// Returns axis bounds with 3-tier priority:
// 1. Stored config value (from local backend or original save), if valid and non-zero
// 2. Computed from actual captured points (snapped to nice ticks)
// 3. Raw stored value even if zero (last resort)
const resolveAxisBoundsWithFallback = (curves) => {
  const curveList = Array.isArray(curves) ? curves : (curves ? [curves] : []);
  if (curveList.length === 0) return { xMin: '', xMax: '', yMin: '', yMax: '', source: 'none' };

  const cfg = normalizeCurveConfigFields(curveList[0]);
  const storedXMin = Number(cfg.xMin);
  const storedXMax = Number(cfg.xMax);
  const storedYMin = Number(cfg.yMin);
  const storedYMax = Number(cfg.yMax);

  const storedValid =
    Number.isFinite(storedXMin) && Number.isFinite(storedXMax) &&
    Number.isFinite(storedYMin) && Number.isFinite(storedYMax) &&
    storedXMax > storedXMin && storedYMax > storedYMin &&
    !isDefaultPlaceholderAxisBounds({ xMin: storedXMin, xMax: storedXMax, yMin: storedYMin, yMax: storedYMax });

  if (storedValid) {
    return { xMin: storedXMin, xMax: storedXMax, yMin: storedYMin, yMax: storedYMax, source: 'stored' };
  }

  const allPoints = curveList.flatMap((curve) => {
    const pts = curve?.points ?? curve?.data_points ?? [];
    return pts.map((pt) => ({
      x: Number(pt.x_value ?? pt.x),
      y: Number(pt.y_value ?? pt.y),
    })).filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  });

  if (allPoints.length > 0) {
    const xs = allPoints.map((pt) => pt.x);
    const ys = allPoints.map((pt) => pt.y);
    return {
      ...snapAxisBounds({
        xMin: Math.min(...xs),
        xMax: Math.max(...xs),
        yMin: Math.min(...ys),
        yMax: Math.max(...ys),
      }),
      source: 'computed',
    };
  }

  return { xMin: storedXMin, xMax: storedXMax, yMin: storedYMin, yMax: storedYMax, source: 'fallback' };
};

const hasPersistedMappingContext = (persistedContext) => {
  const area = normalizePersistedGraphArea(persistedContext?.graphArea);
  const axis = persistedContext?.axis;
  return Boolean(area && axis && hasUsableAxisMapping(axis));
};

const applyComputedAxisBounds = (config = {}, curves = []) => {
  if (hasUsableAxisMapping(config)) return config;

  const curveList = Array.isArray(curves) ? curves : (curves ? [curves] : []);
  if (curveList.length === 0) return config;

  const bounds = resolveAxisBoundsWithFallback(curveList);
  if (bounds.source !== 'computed' && bounds.source !== 'stored') return config;

  return {
    ...config,
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
  };
};

const hasValidStoredAxisBounds = (bounds = {}) => {
  const xMin = parseFloat(bounds.xMin);
  const xMax = parseFloat(bounds.xMax);
  const yMin = parseFloat(bounds.yMin);
  const yMax = parseFloat(bounds.yMax);
  return (
    Number.isFinite(xMin) &&
    Number.isFinite(xMax) &&
    Number.isFinite(yMin) &&
    Number.isFinite(yMax) &&
    xMax > xMin &&
    yMax > yMin
  );
};

const pickStoredAxisBounds = (source = {}) => {
  if (!source || typeof source !== 'object') return null;
  const xMin = parseFloat(source.xMin);
  const xMax = parseFloat(source.xMax);
  const yMin = parseFloat(source.yMin);
  const yMax = parseFloat(source.yMax);
  if (!hasValidStoredAxisBounds({ xMin, xMax, yMin, yMax })) return null;
  return { xMin, xMax, yMin, yMax };
};

const AXIS_BOUND_TOLERANCE = 1e-9;

const resolveAxisBoundFields = (source = {}) => ({
  xMin: source.xMin ?? source.x_min ?? '',
  xMax: source.xMax ?? source.x_max ?? '',
  yMin: source.yMin ?? source.y_min ?? '',
  yMax: source.yMax ?? source.y_max ?? '',
});

const haveAxisBoundsChanged = (current = {}, next = {}) => {
  const fields = ['xMin', 'xMax', 'yMin', 'yMax'];
  return fields.some((field) => {
    const left = parseFloat(current[field]);
    const right = parseFloat(next[field]);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      return left !== right;
    }
    return String(current[field] ?? '').trim() !== String(next[field] ?? '').trim();
  });
};

const isPointWithinAxisBounds = (point, bounds = {}) => {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const xMin = parseFloat(bounds.xMin);
  const xMax = parseFloat(bounds.xMax);
  const yMin = parseFloat(bounds.yMin);
  const yMax = parseFloat(bounds.yMax);

  if (Number.isFinite(xMin) && x < xMin - AXIS_BOUND_TOLERANCE) return false;
  if (Number.isFinite(xMax) && x > xMax + AXIS_BOUND_TOLERANCE) return false;
  if (Number.isFinite(yMin) && y < yMin - AXIS_BOUND_TOLERANCE) return false;
  if (Number.isFinite(yMax) && y > yMax + AXIS_BOUND_TOLERANCE) return false;
  return true;
};

const partitionPointsByAxisBounds = (points = [], bounds = {}) => {
  const normalized = (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Number(point?.x_value ?? point?.x),
      y: Number(point?.y_value ?? point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  const inBounds = [];
  let removedCount = 0;
  normalized.forEach((point) => {
    if (isPointWithinAxisBounds(point, bounds)) {
      inBounds.push(point);
    } else {
      removedCount += 1;
    }
  });
  return { inBounds, removedCount };
};

const buildCurveMetaFromSaved = (curve, graphConfig = {}) => ({
  xScale: curve?.config?.xScale || curve?.x_scale || graphConfig?.xScale || 'Linear',
  yScale: curve?.config?.yScale || curve?.y_scale || graphConfig?.yScale || 'Linear',
  xUnitPrefix: curve?.config?.xUnitPrefix || curve?.x_unit || graphConfig?.xUnitPrefix || '1',
  yUnitPrefix: curve?.config?.yUnitPrefix || curve?.y_unit || graphConfig?.yUnitPrefix || '1',
  xMin: String(curve?.config?.xMin ?? curve?.x_min ?? graphConfig?.xMin ?? ''),
  xMax: String(curve?.config?.xMax ?? curve?.x_max ?? graphConfig?.xMax ?? ''),
  yMin: String(curve?.config?.yMin ?? curve?.y_min ?? graphConfig?.yMin ?? ''),
  yMax: String(curve?.config?.yMax ?? curve?.y_max ?? graphConfig?.yMax ?? ''),
});

const pickUsableAxisBounds = (source = {}) => {
  const bounds = pickStoredAxisBounds(source);
  if (!bounds || isDefaultPlaceholderAxisBounds(bounds)) return null;
  return bounds;
};

const resolveDataBoundsFromCurves = (curves = []) => {
  const curveList = Array.isArray(curves) ? curves : (curves ? [curves] : []);
  const allPoints = curveList.flatMap((curve) => {
    const pts = curve?.points ?? curve?.data_points ?? [];
    return pts
      .map((pt) => ({
        x: Number(pt.x_value ?? pt.x),
        y: Number(pt.y_value ?? pt.y),
      }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  });

  if (allPoints.length === 0) {
    return { xMin: '', xMax: '', yMin: '', yMax: '' };
  }

  const xs = allPoints.map((pt) => pt.x);
  const ys = allPoints.map((pt) => pt.y);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
};

// Prefer confirmed graph axis bounds for view previews (matches main canvas), not point auto-zoom.
const resolveAxisBoundsForGraphPreview = (curves, { graphId = '', liveGraphConfig = {} } = {}) => {
  const curveList = Array.isArray(curves) ? curves : (curves ? [curves] : []);

  const fromLive = pickUsableAxisBounds(liveGraphConfig);
  if (fromLive) return { ...fromLive, source: 'live' };

  const normalizedGraphId = String(graphId || '').trim();
  if (normalizedGraphId) {
    const fromPersisted = pickUsableAxisBounds(getPersistedGraphContext(normalizedGraphId)?.axis);
    if (fromPersisted) return { ...fromPersisted, source: 'persisted' };
  }

  if (curveList.length > 0) {
    const fromCurve = pickUsableAxisBounds(normalizeCurveConfigFields(curveList[0]));
    if (fromCurve) return { ...fromCurve, source: 'curve' };
  }

  return resolveAxisBoundsWithFallback(curveList);
};

const buildSavedGraphPreviewConfig = (
  curve,
  { graphId = '', liveGraphConfig = {}, urlParams = {} } = {}
) => {
  const cfg = normalizeCurveConfigFields(curve);
  const bounds = resolveAxisBoundsForGraphPreview([curve], { graphId, liveGraphConfig });
  return {
    ...cfg,
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
    xLabel: cfg.xLabel || liveGraphConfig.xLabel || urlParams.x_label || '',
    yLabel: cfg.yLabel || liveGraphConfig.yLabel || urlParams.y_label || '',
  };
};

const buildSavedGraphCombinedPreviewConfig = (
  curves = [],
  { graphId = '', liveGraphConfig = {}, urlParams = {} } = {}
) => {
  const first = curves[0];
  const cfg = first ? normalizeCurveConfigFields(first) : {};
  const bounds = resolveAxisBoundsForGraphPreview(curves, { graphId, liveGraphConfig });
  return {
    ...cfg,
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
    xLabel: cfg.xLabel || liveGraphConfig.xLabel || urlParams.x_label || '',
    yLabel: cfg.yLabel || liveGraphConfig.yLabel || urlParams.y_label || '',
  };
};

const COMBINED_OVERLAY_COLORS = ['#2563eb', '#16a34a', '#f97316', '#e11d48', '#0ea5e9', '#8b5cf6', '#14b8a6'];

const buildCombinedOverlayPoints = (curves) => {
  const curveList = Array.isArray(curves) ? curves : [];
  return curveList.flatMap((curve, curveIndex) => {
    const limitedCurve = applyAiPointLimitToCurve(curve);
    const points = limitedCurve?.points ?? limitedCurve?.data_points ?? [];
    const overlayColor = COMBINED_OVERLAY_COLORS[curveIndex % COMBINED_OVERLAY_COLORS.length];
    const overlayCurveId = String(curve?.id ?? curveIndex);
    const overlayCurveName = String(
      curve?.config?.curveName || curve?.curve_name || curve?.name || ''
    ).trim();
    const overlayCurveIsY2 = Boolean(curve?.config?.isY2 || curve?.isY2);
    const overlayCurveTemperature =
      curve?.config?.temperature ?? curve?.temperature ?? '';
    return points
      .map((point) => ({
        x: Number(point.x_value ?? point.x),
        y: Number(point.y_value ?? point.y),
        imported: true,
        overlayColor,
        overlayCurveId,
        overlayCurveName,
        overlayCurveIsY2,
        overlayCurveTemperature,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  });
};

const resolveSymbolValue = (source = {}, requestedKey = '', contextKeys = []) => {
  const key = String(requestedKey || '').trim();
  if (!key || !source || typeof source !== 'object') return '';

  const directValue = source[key];
  if (isValidSymbolValue(directValue)) {
    return String(directValue).trim();
  }

  const alternateKey = getAlternateDfSymbolKey(key);
  if (!alternateKey) return '';

  const contextKeySet = new Set((Array.isArray(contextKeys) ? contextKeys : []).map((item) => String(item).toLowerCase()));
  // If alternate key is explicitly part of the same form/list, don't borrow it.
  if (contextKeySet.has(String(alternateKey).toLowerCase())) {
    return '';
  }

  const alternateValue = source[alternateKey];
  if (isValidSymbolValue(alternateValue)) {
    return String(alternateValue).trim();
  }

  return '';
};

const toApiSymbolKey = (rawKey) => {
  const key = String(rawKey || '').trim();
  if (!key) return '';

  const lower = key.toLowerCase();
  // Keep legacy/special keys as-is.
  if (lower === 'tctj' || lower === 'graph_tctj') {
    return key;
  }

  return lower.startsWith('df_') ? key : `df_${key}`;
};

// Format symbol values as text for console output: "df_vds: 5.0, df_vgs: 2.5, df_tj: 298"
const formatSymbolValuesAsText = (symbolObj) => {
  if (!symbolObj || typeof symbolObj !== 'object') return '';
  return Object.entries(symbolObj)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
};

// Format symbol values as SQL SELECT statement for console output: "SELECT df_vds=5.0, df_vgs=2.5, df_tj=298"
const formatSymbolValuesAsSql = (symbolObj) => {
  if (!symbolObj || typeof symbolObj !== 'object') return '';
  const assignments = Object.entries(symbolObj)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `SELECT ${assignments}`;
};

// Safely parse Company API responses that may come as JSONP (e.g. FF{...} or FF({...}))
const parseCompanyApiText = (rawText) => {
  const match = rawText.match(/[{\[][\s\S]*[}\]]/);
  return JSON.parse(match ? match[0] : rawText);
};

const parseCompanyApiDetails = (result) => {
  if (Array.isArray(result?.details)) {
    return result.details;
  }
  if (Array.isArray(result?.graph?.details)) {
    return result.graph.details;
  }
  if (result?.details && typeof result.details === 'object') {
    return Object.values(result.details);
  }
  if (result?.graph?.details && typeof result.graph.details === 'object') {
    return Object.values(result.graph.details);
  }
  return [];
};

const normalizeCompanyXyString = (xy) =>
  String(xy || '').replace(/\s/g, '').toLowerCase();

const buildCompanyXyString = (points = []) =>
  (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .map((point) => `{x:${String(point.x)},y:${String(point.y)}}`)
    .join(',');

const buildCompanyAppendDetailPayload = ({
  curveTitle,
  points,
  xScale,
  yScale,
  xUnitPrefix,
  yUnitPrefix,
  axisConfig,
}) => {
  const detailPayload = {
    curve_title: curveTitle || '',
    xscale: xScale || '1',
    yscale: yScale || '1',
    xunit: xUnitPrefix || '1',
    yunit: yUnitPrefix || '1',
  };
  appendCompanyDetailAxisBounds(detailPayload, axisConfig);
  const xy = buildCompanyXyString(points);
  if (!xy) {
    throw new Error('No valid points to save.');
  }
  detailPayload.xy = xy;
  return detailPayload;
};

const removeCompanyDetailFromDiscoveree = async ({
  graphId,
  detailId,
  discovereeCatId = '',
  testuserId = '',
  corsFallback,
}) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedDetailId = String(detailId || '').trim();
  if (!normalizedGraphId || !normalizedDetailId) {
    throw new Error('Missing graph_id or detail id for remove.');
  }

  const companyUrl = `https://www.discoveree.io/graph_capture_api.php?${new URLSearchParams({
    action: 'remove',
    graph_id: normalizedGraphId,
    id: normalizedDetailId,
    discoveree_cat_id: String(discovereeCatId || ''),
    testuser_id: String(testuserId || ''),
  }).toString()}`;

  console.log('=== COMPANY REMOVE REQUEST ===', {
    graphId: normalizedGraphId,
    detailId: normalizedDetailId,
    url: companyUrl,
  });

  try {
    const response = await fetch(companyUrl, { method: 'GET' });
    const responseText = await response.text();
    console.log('=== COMPANY REMOVE RESPONSE ===', {
      graphId: normalizedGraphId,
      detailId: normalizedDetailId,
      status: response.status,
      ok: response.ok,
      response: responseText.substring(0, 300),
    });
    if (!response.ok) {
      throw new Error(`Company remove failed (${response.status})`);
    }
  } catch (error) {
    const maybeCors = error?.message === 'Failed to fetch' || error?.name === 'TypeError';
    if (maybeCors && typeof corsFallback === 'function') {
      console.warn('Remove fetch blocked by CORS, using browser fallback:', companyUrl);
      await corsFallback(companyUrl);
      return;
    }
    throw error;
  }
};

const postCompanyAppendSave = async (graphId, payload) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) {
    throw new Error('Missing graph_id for append save.');
  }

  const companyUrl = `${DISCOVEREE_GRAPH_CAPTURE_API_URL}?graph_id=${encodeURIComponent(normalizedGraphId)}`;
  console.log('=== COMPANY APPEND SAVE REQUEST ===', {
    graphId: normalizedGraphId,
    url: companyUrl,
    payload,
  });

  const response = await fetch(companyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text();
  let result = {};
  try {
    result = rawText ? parseCompanyApiText(rawText) : {};
  } catch {
    result = rawText;
  }
  console.log('=== COMPANY APPEND SAVE RESPONSE ===', {
    graphId: normalizedGraphId,
    url: companyUrl,
    status: response.status,
    ok: response.ok,
    rawText,
    response: result,
  });

  if (!response.ok) {
    throw new Error(`Company append save failed (${response.status})`);
  }
  if (result?.status && result.status !== 'success') {
    throw new Error(result?.msg || 'Company append save returned non-success status');
  }

  return { result, companyUrl, rawText };
};

const parseCompanyAxisNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const appendCompanyDetailAxisBounds = (detailPayload, axisConfig = {}) => {
  const xMin = parseCompanyAxisNumber(axisConfig.xMin);
  const xMax = parseCompanyAxisNumber(axisConfig.xMax);
  const yMin = parseCompanyAxisNumber(axisConfig.yMin);
  const yMax = parseCompanyAxisNumber(axisConfig.yMax);

  if (xMin !== undefined) {
    detailPayload.x_min = xMin;
    detailPayload.xmin = xMin;
  }
  if (xMax !== undefined) {
    detailPayload.x_max = xMax;
    detailPayload.xmax = xMax;
  }
  if (yMin !== undefined) {
    detailPayload.y_min = yMin;
    detailPayload.ymin = yMin;
  }
  if (yMax !== undefined) {
    detailPayload.y_max = yMax;
    detailPayload.ymax = yMax;
  }

  return detailPayload;
};

const findCompanyDetailByVerifiedXy = (details = [], xy = '') => {
  const list = Array.isArray(details) ? details : [];
  const normalizedXy = normalizeCompanyXyString(xy);
  if (!normalizedXy) return null;
  return list.find((detail) => normalizeCompanyXyString(detail?.xy) === normalizedXy) || null;
};

const extractDetailIdFromCompanyResult = (result) => {
  if (!result || typeof result !== 'object') return '';
  if (result.detail_id !== undefined && result.detail_id !== null && String(result.detail_id).trim() !== '') {
    return String(result.detail_id).trim();
  }
  if (Array.isArray(result.details) && result.details.length > 0 && result.details[0]?.id) {
    return String(result.details[0].id).trim();
  }
  if (result.graph?.detail_id !== undefined && result.graph?.detail_id !== null) {
    return String(result.graph.detail_id).trim();
  }
  if (Array.isArray(result.graph?.details) && result.graph.details.length > 0 && result.graph.details[0]?.id) {
    return String(result.graph.details[0].id).trim();
  }
  return '';
};

const verifyEditedCurveOnDiscoveree = async ({
  graphId,
  sentXy = '',
  rawXy = '',
  appendResult = null,
  attempts = 6,
  delayMs = 1000,
} = {}) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedSentXy = normalizeCompanyXyString(sentXy || rawXy);
  if (!normalizedGraphId || !normalizedSentXy) {
    return { xyConfirmedOnDiscoveree: false, detailId: '', verifiedDetail: null };
  }

  const hintedDetailId = extractDetailIdFromCompanyResult(appendResult?.result);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(normalizedGraphId)}`
      );
      if (response.ok) {
        const parsed = parseCompanyApiText(await response.text());
        const list = dedupeCompanyApiDetailsById(parseCompanyApiDetails(parsed));
        console.log(`[EDIT VERIFY] Attempt ${attempt}/${attempts}:`, {
          totalDetails: list.length,
          hintedDetailId: hintedDetailId || '(none)',
        });

        const byXy = findCompanyDetailByVerifiedXy(list, rawXy);
        if (byXy?.id && normalizeCompanyXyString(byXy.xy) === normalizedSentXy) {
          return {
            xyConfirmedOnDiscoveree: true,
            detailId: String(byXy.id),
            verifiedDetail: byXy,
            attempt,
          };
        }

        if (hintedDetailId) {
          const byHint = list.find((detail) => String(detail?.id || '') === hintedDetailId);
          if (byHint && normalizeCompanyXyString(byHint.xy) === normalizedSentXy) {
            return {
              xyConfirmedOnDiscoveree: true,
              detailId: hintedDetailId,
              verifiedDetail: byHint,
              attempt,
            };
          }
        }
      }
    } catch (error) {
      console.warn(`[EDIT VERIFY] Attempt ${attempt}/${attempts} failed:`, error.message);
    }

    if (attempt < attempts) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { xyConfirmedOnDiscoveree: false, detailId: '', verifiedDetail: null };
};

const verifyCompanyDetailRemovedFromDiscoveree = async ({
  graphId,
  detailId,
  attempts = 6,
  delayMs = 750,
} = {}) => {
  const normalizedGraphId = String(graphId || '').trim();
  const normalizedDetailId = String(detailId || '').trim();
  if (!normalizedGraphId || !normalizedDetailId) {
    return { removed: false, attempt: 0 };
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(normalizedGraphId)}`
      );
      if (response.ok) {
        const parsed = parseCompanyApiText(await response.text());
        const list = dedupeCompanyApiDetailsById(parseCompanyApiDetails(parsed));
        const stillPresent = list.some(
          (detail) => String(detail?.id || '').trim() === normalizedDetailId
        );
        console.log(`[EDIT REMOVE VERIFY] Attempt ${attempt}/${attempts}:`, {
          graphId: normalizedGraphId,
          detailId: normalizedDetailId,
          stillPresent,
          totalDetails: list.length,
        });
        if (!stillPresent) {
          return { removed: true, attempt };
        }
      }
    } catch (error) {
      console.warn(`[EDIT REMOVE VERIFY] Attempt ${attempt}/${attempts} failed:`, error.message);
    }

    if (attempt < attempts) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { removed: false, attempt: attempts };
};

const fetchCompanyGraphDetailsWithRetry = async (graphId, { attempts = 4, delayMs = 750 } = {}) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) {
    return { details: [], result: null };
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(normalizedGraphId)}`
      );
      if (response.ok) {
        const parsed = parseCompanyApiText(await response.text());
        const details = parseCompanyApiDetails(parsed);
        console.log(`[RE-FETCH] Attempt ${attempt}/${attempts}:`, { totalDetails: details.length });
        if (details.length > 0) {
          return { details, result: parsed };
        }
      }
    } catch (error) {
      console.warn(`[RE-FETCH] Attempt ${attempt}/${attempts} failed:`, error.message);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { details: [], result: null };
};
const AI_DIRECT_CAPTURE_PARAM = 'ai_direct_capture';
const AI_PENDING_CAPTURE_STORAGE_KEY = 'ai_pending_capture_image';
const AI_PENDING_CAPTURE_TTL_MS = 5 * 60 * 1000;
const AI_LAST_RETURNED_GRAPH_ID_KEY = 'ai_last_returned_graph_id';
const AI_EXTRACTED_METADATA_KEY = 'ai_extracted_metadata';
const AI_CAPTURE_GUIDANCE_KEY = 'ai_capture_guidance_active';

const readAiCaptureGuidanceActive = () => {
  try {
    return window.sessionStorage.getItem(AI_CAPTURE_GUIDANCE_KEY) === '1';
  } catch {
    return false;
  }
};

const persistAiCaptureGuidanceActive = (active) => {
  try {
    if (active) {
      window.sessionStorage.setItem(AI_CAPTURE_GUIDANCE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(AI_CAPTURE_GUIDANCE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist AI capture guidance flag.', error);
  }
};

const persistAiExtractedMetadata = (metadata) => {
  try {
    window.sessionStorage.setItem(AI_EXTRACTED_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.warn('Unable to persist AI extracted metadata.', error);
  }
};

const restoreAiExtractedMetadata = () => {
  try {
    const raw = window.sessionStorage.getItem(AI_EXTRACTED_METADATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Unable to restore AI extracted metadata.', error);
    return null;
  }
};

const clearAiExtractedMetadata = () => {
  try {
    window.sessionStorage.removeItem(AI_EXTRACTED_METADATA_KEY);
  } catch (error) {
    console.warn('Unable to clear AI extracted metadata.', error);
  }
};

const persistAiPendingCapture = (imageBase64, source, graphId = '') => {
  try {
    if (!imageBase64) return;
    const payload = {
      imageBase64,
      source: source || 'upload',
      graphId: String(graphId || ''),
      ts: Date.now(),
    };
    window.sessionStorage.setItem(AI_PENDING_CAPTURE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist AI pending capture image.', error);
  }
};

const consumeAiPendingCapture = (expectedGraphId = '') => {
  try {
    const raw = window.sessionStorage.getItem(AI_PENDING_CAPTURE_STORAGE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw);
    window.sessionStorage.removeItem(AI_PENDING_CAPTURE_STORAGE_KEY);

    if (!payload?.imageBase64) return null;
    if (Date.now() - Number(payload?.ts || 0) > AI_PENDING_CAPTURE_TTL_MS) return null;

    const payloadGraphId = String(payload?.graphId || '').trim();
    const normalizedExpectedGraphId = String(expectedGraphId || '').trim();
    if (payloadGraphId && normalizedExpectedGraphId && payloadGraphId !== normalizedExpectedGraphId) {
      window.sessionStorage.removeItem(AI_PENDING_CAPTURE_STORAGE_KEY);
      return null;
    }

    return {
      imageBase64: payload.imageBase64,
      source: payload.source || 'upload',
    };
  } catch (error) {
    console.warn('Unable to consume AI pending capture image.', error);
    return null;
  }
};

const getLastAiReturnedGraphId = () => {
  try {
    return String(window.sessionStorage.getItem(AI_LAST_RETURNED_GRAPH_ID_KEY) || '').trim();
  } catch {
    return '';
  }
};

const persistLastAiReturnedGraphId = (graphId = '') => {
  try {
    const normalizedGraphId = String(graphId || '').trim();
    if (!normalizedGraphId) return;
    window.sessionStorage.setItem(AI_LAST_RETURNED_GRAPH_ID_KEY, normalizedGraphId);
  } catch {
    // no-op: best-effort only
  }
};

// Persist AI extraction flow details so they survive page navigation
const persistAiExtractionFlowLog = (flowData) => {
  try {
    const KEY = 'ai_extraction_flow_log';
    window.sessionStorage.setItem(KEY, JSON.stringify(flowData));
  } catch (error) {
    console.warn('Unable to persist AI extraction flow log.', error);
  }
};

const logAiExtractionFlowSummary = (attempts = [], { restored = false } = {}) => {
  if (!isAiExtractionVerboseLogEnabled()) return;

  const list = Array.isArray(attempts) ? attempts : [];
  const groupLabel = restored
    ? '%c📊 AI EXTRACTION FLOW SUMMARY (restored after navigation)'
    : '%c📊 AI EXTRACTION FLOW SUMMARY';

  console.group(groupLabel, 'color: #2196F3; font-size: 14px; font-weight: bold;');

  if (list.length === 0) {
    console.log('No upstream attempts were recorded.');
    console.groupEnd();
    return;
  }

  const primaryAttempt = list[0];
  console.log('%c=== ATTEMPT 1: PRIMARY URL ===', 'color: #FF9800; font-weight: bold;');
  console.log('URL:', primaryAttempt?.target_url);
  console.log('Status Code:', primaryAttempt?.upstream_status);
  console.log('Content Type:', primaryAttempt?.content_type);

  if ((primaryAttempt?.content_type || '').includes('text/html')) {
    console.log('%c❌ BLOCKED: Response is HTML (not JSON)', 'color: #F44336; font-weight: bold;');
    console.log('This means: Imunify360 bot-protection blocked the request');
    console.log('Error Details:', primaryAttempt?.raw_text?.substring(0, 500));
  } else if ((primaryAttempt?.raw_text || '').toLowerCase().includes('invalid base64 format')) {
    console.log('%c❌ BLOCKED: Server returned Invalid base64 format', 'color: #F44336; font-weight: bold;');
    console.log('This often appears with WAF blocks — request may not have reached the AI handler');
    console.log('Error Details:', primaryAttempt?.raw_text?.substring(0, 500));
  } else if ((primaryAttempt?.raw_text || '').toLowerCase().includes('imunify360')) {
    console.log('%c❌ BLOCKED: Imunify360 bot-protection detected', 'color: #F44336; font-weight: bold;');
    console.log('Error Message:', primaryAttempt?.raw_text?.substring(0, 500));
  }

  const backupAttempt = list.find((attempt) => String(attempt?.target_url || '').includes('graph_capture_api.php'));
  if (!backupAttempt) {
    console.log('%cℹ️ No backup endpoint attempt detected in this run', 'color: #607D8B; font-weight: bold;');
    console.groupEnd();
    return;
  }

  console.log('%c=== BACKUP ATTEMPT (graph_capture_api.php) ===', 'color: #4CAF50; font-weight: bold;');
  console.log('URL:', backupAttempt?.target_url);
  console.log('Status Code:', backupAttempt?.upstream_status);
  console.log('Content Type:', backupAttempt?.content_type);

  const backupGraphId = String(
    backupAttempt?.response?.graph_id ?? backupAttempt?.response?.graphId ?? ''
  ).trim();
  const backupHasGraphId =
    backupGraphId !== '' || /"graph_id"\s*:\s*"?\d+"?/i.test(String(backupAttempt?.raw_text || ''));
  const backupIsJson = String(backupAttempt?.content_type || '').toLowerCase().includes('application/json');

  if (Number(backupAttempt?.upstream_status) === 200 && backupIsJson && backupHasGraphId) {
    console.log('%c✅ SUCCESS: Backup endpoint returned graph_id', 'color: #4CAF50; font-weight: bold;');
    console.log('Graph ID returned:', backupGraphId || backupAttempt?.raw_text?.substring(0, 200));
  } else {
    console.log('%c⚠️ BACKUP DID NOT RETURN VALID graph_id', 'color: #FF9800; font-weight: bold;');
    console.log('Backup Response Snippet:', String(backupAttempt?.raw_text || '').substring(0, 400));
  }

  console.groupEnd();
};

const AI_SUPPORT_EXCHANGE_KEY = 'ai_support_exchange_log';

const buildVisionUploadSupportSnapshot = (requestPayload = {}, attempts = [], meta = {}) => {
  const primary = (Array.isArray(attempts) ? attempts : []).find((attempt) =>
    String(attempt?.target_url || '').includes('vision_upload.php')
  );
  if (!primary) return null;

  const base64 = String(requestPayload.base64image || '');
  return {
    ts: Date.now(),
    route: meta.route || '',
    activeRelayUrl: meta.activeRelayUrl || '',
    relayStatus: meta.relayStatus ?? '',
    relayOk: meta.relayOk ?? '',
    requestPayload: {
      ...requestPayload,
      base64image: base64
        ? `[${base64.length} chars] ${base64.substring(0, 80)}${base64.length > 80 ? '...' : ''}`
        : '(empty)',
    },
    response: {
      target_url: primary?.target_url || '',
      upstream_status: primary?.upstream_status,
      content_type: primary?.content_type || '',
      raw_text: primary?.raw_text ?? '',
    },
  };
};

const persistAiSupportExchangeLog = (snapshot) => {
  try {
    if (!snapshot) return;
    window.sessionStorage.setItem(AI_SUPPORT_EXCHANGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Unable to persist AI support exchange log.', error);
  }
};

const logVisionUploadPrimaryExchange = (requestPayload = {}, attempts = [], meta = {}) => {
  const snapshot = buildVisionUploadSupportSnapshot(requestPayload, attempts, meta);
  if (!snapshot) return;
  persistAiSupportExchangeLog(snapshot);
};

const AI_EXCHANGE_LOG_KEY = 'ai_extraction_exchange_log';

const formatAiRequestPayloadForLog = (requestPayload = {}) => {
  const base64 = String(requestPayload.base64image || '');
  if (/^\[\d+ chars\]/.test(base64)) {
    return requestPayload;
  }
  return {
    ...requestPayload,
    base64image: base64
      ? `[${base64.length} chars] ${base64.substring(0, 80)}${base64.length > 80 ? '...' : ''}`
      : '(empty)',
  };
};

const logAiExtractionRequestResponse = ({
  requestPayload = {},
  result = {},
  meta = {},
  restored = false,
  outcome = '',
} = {}) => {
  const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
  const graphId = relayResultHasGraphId(result);
  const groupLabel = restored
    ? `[AI] request / response (restored after navigation${graphId ? ` — graph_id ${graphId}` : ''})`
    : `[AI] request / response${graphId ? ` — graph_id ${graphId}` : ''}`;

  console.group(groupLabel);
  if (meta.route || meta.activeRelayUrl) {
    console.log('route / relay:', {
      route: meta.route || AI_EXTRACTION_ROUTE,
      activeRelayUrl: meta.activeRelayUrl || '(unknown)',
      relayStatus: meta.relayStatus,
      relayOk: meta.relayOk,
    });
  }
  console.log('request payload:', formatAiRequestPayloadForLog(requestPayload));

  if (attempts.length > 0) {
    attempts.forEach((attempt, index) => {
      console.log(`response attempt ${index + 1}/${attempts.length}:`, {
        target_url: attempt?.target_url,
        mode: attempt?.mode,
        upstream_status: attempt?.upstream_status,
        content_type: attempt?.content_type,
        raw_text: attempt?.raw_text ?? '(empty)',
        parsed: attempt?.response,
      });
    });
  } else {
    console.log('response:', {
      upstream_status: result?.upstream_status,
      content_type: result?.content_type,
      raw_text: result?.raw_text ?? '(empty)',
      parsed: result?.response,
    });
  }

  if (outcome) console.log('outcome:', outcome);
  if (!restored && !isAiExtractionVerboseLogEnabled()) {
    console.log('tip: add ?ai_debug=true for extra relay/debug logs');
  }
  console.groupEnd();
};

const persistAiExtractionExchangeLog = (exchangeData) => {
  try {
    window.sessionStorage.setItem(AI_EXCHANGE_LOG_KEY, JSON.stringify(exchangeData));
  } catch (error) {
    console.warn('Unable to persist AI extraction exchange log.', error);
  }
};

const restoreAndLogAiExtractionExchange = () => {
  try {
    const raw = window.sessionStorage.getItem(AI_EXCHANGE_LOG_KEY);
    if (!raw) return;
    const exchange = JSON.parse(raw);
    logAiExtractionRequestResponse({ ...exchange, restored: true });
    window.sessionStorage.removeItem(AI_EXCHANGE_LOG_KEY);
  } catch (error) {
    console.warn('Unable to restore AI extraction exchange log.', error);
  }
};

const checkGraphHasCapturedCurves = async (graphId) => {
  const normalizedGraphId = String(graphId || '').trim();
  if (!normalizedGraphId) return false;

  const response = await fetch(
    `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(normalizedGraphId)}`
  );

  if (!response.ok) {
    throw new Error(`Graph check failed with status ${response.status}`);
  }

  const rawText = await response.text();
  const parsed = parseCompanyApiText(rawText);
  const details = Array.isArray(parsed?.details)
    ? parsed.details
    : Array.isArray(parsed?.graph?.details)
      ? parsed.graph.details
      : [];

  return details.length > 0;
};

const resolveIntegerGraphIdFromAiResponse = (responsePayload) => {
  if (typeof responsePayload === 'number' && Number.isInteger(responsePayload) && responsePayload > 0) {
    return String(responsePayload);
  }
  if (typeof responsePayload === 'string') {
    const trimmed = responsePayload.trim();
    if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return trimmed;
  }

  if (!responsePayload || typeof responsePayload !== 'object') return '';

  const candidateValues = [
    responsePayload?.graph_id,
    responsePayload?.graphId,
    responsePayload?.id,
    responsePayload?.graph?.graph_id,
    responsePayload?.graph?.graphId,
    responsePayload?.graph?.id,
  ];

  for (const candidate of candidateValues) {
    const normalized = String(candidate ?? '').trim();
    if (!normalized) continue;
    const asNumber = Number(normalized);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      return String(asNumber);
    }
  }

  return '';
};

// AI extraction route (temporary testing):
// 'render-only' — Render backend relay only (browser + Netlify paused)
// 'netlify-only' — Netlify function only (browser + Render paused)
// 'browser-only' — browser → DiscoverEE direct only
// 'production' — Render first (long AI wait), Netlify fallback if Render unreachable
const AI_EXTRACTION_ROUTE = 'production';
// Set false to test vision_upload.php only (no graph_capture_api.php fallback).
const AI_EXTRACTION_USE_BACKUP_ENDPOINT = false;
const AI_RELAY_FETCH_TIMEOUT_MS = 130000;
const AI_MANUAL_CAPTURE_MESSAGE = 'There is an issue with AI fetching the graph image. Please try capturing manually.';

const isAiExtractionVerboseLogEnabled = () => {
  try {
    return new URLSearchParams(window.location.search).get('ai_debug') === 'true';
  } catch {
    return false;
  }
};

const aiLogVerbose = (...args) => {
  if (isAiExtractionVerboseLogEnabled()) console.log(...args);
};

const aiWarnVerbose = (...args) => {
  if (isAiExtractionVerboseLogEnabled()) console.warn(...args);
};

const isAiProviderFailureText = (rawText = '') => {
  const raw = String(rawText || '').toLowerCase();
  return (
    raw.includes('resource_exhausted') ||
    raw.includes('quota exceeded') ||
    raw.includes('"code": 429') ||
    raw.includes('"code":429')
  );
};

const collectAiFailureText = (result) => {
  const chunks = [result?.raw_text];
  if (Array.isArray(result?.attempts)) {
    result.attempts.forEach((attempt) => chunks.push(attempt?.raw_text));
  }
  return chunks.filter(Boolean).join('\n');
};

const isAiProviderFailureResult = (result) =>
  isAiProviderFailureText(collectAiFailureText(result));

const isRelayTransportFailure = (responseStatus, networkError) =>
  Boolean(networkError) || responseStatus === 502 || responseStatus === 503 || responseStatus === 504;

const fetchAiRelayPost = async (relayUrl, requestPayload, timeoutMs = AI_RELAY_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    return { response, result, networkError: '' };
  } catch (error) {
    const isAbort = error?.name === 'AbortError';
    const message = isAbort
      ? `Relay request timed out after ${timeoutMs}ms`
      : (error?.message || String(error));

    return {
      response: { ok: false, status: isAbort ? 504 : 502 },
      result: {
        upstream_ok: false,
        upstream_status: isAbort ? 504 : 502,
        raw_text: message,
        response: {},
        attempts: [],
      },
      networkError: message,
    };
  } finally {
    window.clearTimeout(timer);
  }
};

const DISCOVEREE_VISION_UPLOAD_URL = 'https://www.discoveree.io/vision_upload.php';
const DISCOVEREE_GRAPH_CAPTURE_API_URL = 'https://www.discoveree.io/graph_capture_api.php';

const extractPlainNumericGraphIdFromRawText = (rawText = '') => {
  const trimmed = String(rawText || '').trim();
  if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return trimmed;
  return '';
};

const getGraphIdFromRelayAttempt = (attempt = {}) => {
  const fromResponse = resolveIntegerGraphIdFromAiResponse(attempt?.response || {});
  if (fromResponse) return fromResponse;
  const rawText = String(attempt?.raw_text || '');
  const plainNumeric = extractPlainNumericGraphIdFromRawText(rawText);
  if (plainNumeric) return plainNumeric;
  const match = rawText.match(/"graph_id"\s*:\s*"?\d+"?/i);
  return match ? match[1] : '';
};

const relayAttemptHasValidGraphId = (attempt = {}) => {
  if (attempt?.valid_graph_id) return true;
  return Boolean(getGraphIdFromRelayAttempt(attempt));
};

const relayResultHasGraphId = (result) => {
  const fromTop = resolveIntegerGraphIdFromAiResponse(
    result?.response && typeof result.response === 'object' ? result.response : {}
  );
  if (fromTop) return fromTop;

  if (Array.isArray(result?.attempts)) {
    for (const attempt of result.attempts) {
      const attemptId = getGraphIdFromRelayAttempt(attempt);
      if (attemptId) return Number(attemptId);
    }
  }

  const plainNumeric = extractPlainNumericGraphIdFromRawText(result?.raw_text);
  return plainNumeric ? Number(plainNumeric) : null;
};

const describeRelayUpstreamFailure = (attempt = {}) => {
  const reasons = [];
  const rawText = String(attempt?.raw_text || '');
  const contentType = String(attempt?.content_type || '').toLowerCase();
  const upstreamStatus = Number(attempt?.upstream_status || 0);

  if (upstreamStatus >= 400) {
    reasons.push(`HTTP ${upstreamStatus}`);
  }
  if (contentType.includes('text/html') || /<!DOCTYPE|<html/i.test(rawText)) {
    reasons.push('Response is HTML (Imunify360 bot-protection or login page, not JSON API)');
  }
  if (/imunify360|access denied/i.test(rawText)) {
    reasons.push('Imunify360 / Access denied in response body');
  }
  if (rawText.toLowerCase().includes('invalid base64 format')) {
    reasons.push('Server returned "Invalid base64 format"');
  }
  if (isAiProviderFailureText(rawText)) {
    reasons.push('AI provider error (quota/rate limit)');
  }
  if (attempt?.upstream_ok === false && upstreamStatus > 0 && upstreamStatus < 400) {
    reasons.push('upstream_ok is false despite HTTP success');
  }
  if (!relayAttemptHasValidGraphId(attempt)) {
    if (rawText && !contentType.includes('application/json')) {
      reasons.push('Response body is not JSON');
    } else if (attempt?.response) {
      reasons.push('JSON parsed but no valid integer graph_id');
    } else {
      reasons.push('No parseable response / graph_id');
    }
  }
  if (reasons.length === 0) {
    reasons.push('Unknown failure');
  }
  return reasons;
};

const logRelayUpstreamAttempt = (attempt, index, total, logPrefix = '[AI NETLIFY]') => {
  if (!isAiExtractionVerboseLogEnabled()) return;

  const graphId = getGraphIdFromRelayAttempt(attempt);
  const worked = relayAttemptHasValidGraphId(attempt);
  const label = attempt?.target_url?.includes('graph_capture_api.php')
    ? 'graph_capture_api.php (backup)'
    : attempt?.target_url?.includes('vision_upload.php')
      ? 'vision_upload.php (primary)'
      : (attempt?.target_url || 'unknown');

  console.group(
    `%c${logPrefix} Upstream ${index + 1}/${total} — ${label}`,
    worked ? 'color:#4CAF50;font-weight:bold;' : 'color:#F44336;font-weight:bold;'
  );
  console.log('target_url:', attempt?.target_url);
  console.log('mode:', attempt?.mode);
  console.log('upstream_status:', attempt?.upstream_status);
  console.log('upstream_ok:', attempt?.upstream_ok);
  console.log('content_type:', attempt?.content_type);
  console.log('valid_graph_id flag:', attempt?.valid_graph_id);
  console.log('graph_id:', graphId || '(none)');
  if (worked) {
    console.log('%c✅ WORKED', 'color:#4CAF50;font-weight:bold;');
  } else {
    console.log('%c❌ DID NOT WORK — reasons:', 'color:#F44336;font-weight:bold;', describeRelayUpstreamFailure(attempt));
    console.log('Response preview:', rawTextPreview(attempt?.raw_text));
  }
  console.groupEnd();
};

const rawTextPreview = (rawText, max = 500) => String(rawText || '').substring(0, max);

const classifyPrimaryVisionUploadFailure = (attempt = {}) => {
  const rawText = String(attempt?.raw_text || '');
  const contentType = String(attempt?.content_type || '').toLowerCase();
  const reasons = describeRelayUpstreamFailure(attempt);

  let rootCause = 'unknown';
  if (/imunify360|access denied/i.test(rawText)) {
    rootCause = 'imunify360_bot_protection';
  } else if (contentType.includes('text/html') || /<!DOCTYPE|<html/i.test(rawText)) {
    rootCause = contentType.includes('text/html') && /login|session has expired/i.test(rawText)
      ? 'discoveree_login_html_page'
      : 'html_response_not_json_api';
  } else if (rawText.toLowerCase().includes('invalid base64 format')) {
    rootCause = 'server_rejected_base64';
  } else if (Number(attempt?.upstream_status) >= 500) {
    rootCause = 'server_5xx_error';
  } else if (Number(attempt?.upstream_status) >= 400) {
    rootCause = 'server_4xx_error';
  } else if (!relayAttemptHasValidGraphId(attempt)) {
    rootCause = 'no_graph_id_in_response';
  }

  return { reasons, rootCause };
};

/** Console report: primary vision_upload.php status (survives reload via sessionStorage). */
const logPrimaryVisionUploadFailureReport = (attempts = [], { restored = false } = {}) => {
  if (!isAiExtractionVerboseLogEnabled()) {
    return { primaryWorked: false, primaryAttempts: [] };
  }

  const primaryAttempts = (Array.isArray(attempts) ? attempts : []).filter((attempt) =>
    String(attempt?.target_url || '').includes('vision_upload.php')
  );

  const primaryWorked = primaryAttempts.some(relayAttemptHasValidGraphId);
  const groupLabel = restored
    ? `%c${primaryWorked ? '✅' : '❌'} PRIMARY URL (vision_upload.php) — restored after navigation`
    : `%c${primaryWorked ? '✅' : '❌'} PRIMARY URL (vision_upload.php)`;

  console.group(
    groupLabel,
    primaryWorked ? 'color:#4CAF50;font-weight:bold;font-size:14px;' : 'color:#F44336;font-weight:bold;font-size:14px;'
  );

  if (primaryAttempts.length === 0) {
    console.log('❌ PRIMARY URL NOT WORKING: No vision_upload.php attempts were recorded in this AI run.');
    console.groupEnd();
    return { primaryWorked: false, primaryAttempts: [] };
  }

  if (primaryWorked) {
    console.log('✅ PRIMARY URL WORKING: vision_upload.php returned a valid graph_id.');
    console.log('Primary AI URL:', DISCOVEREE_VISION_UPLOAD_URL);
    primaryAttempts.forEach((attempt) => {
      if (!relayAttemptHasValidGraphId(attempt)) return;
      console.log(`Success via mode "${attempt?.mode || 'render-json'}":`, {
        graph_id: getGraphIdFromRelayAttempt(attempt),
        status: attempt?.upstream_status,
        content_type: attempt?.content_type,
      });
    });
    console.groupEnd();
    return { primaryWorked: true, primaryAttempts };
  }

  console.log('❌ PRIMARY URL NOT WORKING: vision_upload.php did not return graph_id.');
  console.log('Primary AI URL:', DISCOVEREE_VISION_UPLOAD_URL);
  console.log(`${primaryAttempts.length} attempt(s) to vision_upload.php — none returned graph_id.`);

  primaryAttempts.forEach((attempt, index) => {
    const { reasons, rootCause } = classifyPrimaryVisionUploadFailure(attempt);
    console.group(`%cPrimary attempt ${index + 1}/${primaryAttempts.length}`, 'color:#FF9800;font-weight:bold;');
    console.log('encoding/mode:', attempt?.mode || '(unknown)');
    console.log('HTTP status:', attempt?.upstream_status);
    console.log('Content-Type:', attempt?.content_type);
    console.log('root_cause:', rootCause);
    console.log('failure_reasons:', reasons);
    console.log('Response body (first 800 chars):', rawTextPreview(attempt?.raw_text, 800));
    console.groupEnd();
  });

  const first = primaryAttempts[0] || {};
  const firstRaw = String(first?.raw_text || '');
  const firstContentType = String(first?.content_type || '');

  console.log('%c--- PLAIN ENGLISH (why Capture with AI primary failed) ---', 'color:#FF5722;font-weight:bold;');
  if (firstContentType.includes('text/html') || /<!DOCTYPE|<html/i.test(firstRaw)) {
    console.log(
      'DiscoverEE returned an HTML web page instead of JSON. Imunify360 / bot-protection on vision_upload.php blocked the request before the real AI handler ran.'
    );
  }
  if (firstRaw.toLowerCase().includes('invalid base64 format')) {
    console.log(
      'Body contains "Invalid base64 format". This usually means the request was rejected at the edge — not that your image is corrupt (the same image often works via graph_capture_api.php backup).'
    );
  }
  if (/login|session has expired/i.test(firstRaw)) {
    console.log('Response looks like a DiscoverEE login/session page — not an API error from your app.');
  }
  console.log(
    'Netlify relay may still succeed using backup POST to graph_capture_api.php (different endpoint, different handler on DiscoverEE).'
  );

  console.groupEnd();
  return { primaryWorked: false, primaryAttempts };
};

const analyzeNetlifyRelayResult = (netlifyResult, relayHttpOk) => {
  const attempts = Array.isArray(netlifyResult?.attempts) ? netlifyResult.attempts : [];
  const responseGraphId = resolveIntegerGraphIdFromAiResponse(netlifyResult?.response || {});
  const winningAttempt = attempts.find((attempt) => relayAttemptHasValidGraphId(attempt));
  const backupWin = winningAttempt?.target_url?.includes('graph_capture_api.php');
  const primaryAttempts = attempts.filter((a) => String(a?.target_url || '').includes('vision_upload.php'));
  const backupAttempts = attempts.filter((a) => String(a?.target_url || '').includes('graph_capture_api.php'));
  const primaryWorked = primaryAttempts.some(relayAttemptHasValidGraphId);
  const backupWorked = backupAttempts.some(relayAttemptHasValidGraphId);

  const overallGraphId = responseGraphId || getGraphIdFromRelayAttempt(winningAttempt || {});
  const overallWorked = Boolean(overallGraphId) || Boolean(netlifyResult?.upstream_ok);

  const summary = {
    overallWorked,
    overallGraphId: overallGraphId || '',
    relayHttpOk,
    upstream_ok: netlifyResult?.upstream_ok,
    upstream_status: netlifyResult?.upstream_status,
    final_target_url: netlifyResult?.target_url || winningAttempt?.target_url || '',
    primaryWorked,
    backupWorked,
    wonViaBackup: backupWin,
    totalAttempts: attempts.length,
  };

  if (!overallWorked) {
    summary.whyNot = [];
    if (!relayHttpOk) summary.whyNot.push(`Netlify relay HTTP not OK`);
    if (attempts.length === 0) summary.whyNot.push('No upstream attempts recorded in relay response');
    if (!primaryWorked && primaryAttempts.length > 0) {
      summary.whyNot.push('All vision_upload.php attempts failed (see attempt logs above)');
    }
    if (!backupWorked && backupAttempts.length > 0) {
      summary.whyNot.push('graph_capture_api.php backup also failed');
    }
    if (!overallGraphId) summary.whyNot.push('No valid graph_id in final relay response');
  } else {
    summary.whyWorked = primaryWorked
      ? 'Primary vision_upload.php returned graph_id'
      : backupWorked
        ? 'Primary failed but graph_capture_api.php backup returned graph_id'
        : 'graph_id found in relay final response';
  }

  return summary;
};

const fetchAiExtractionViaNetlifyOnly = async (netlifyRelayUrl, requestPayload) => {
  if (isAiExtractionVerboseLogEnabled()) {
    console.group('%c[AI NETLIFY] Netlify relay only (browser + Render paused)', 'color:#2196F3;font-weight:bold;font-size:13px;');
    console.log('Relay URL:', netlifyRelayUrl);
    console.log('Payload keys:', Object.keys(requestPayload));
    console.log('partno:', requestPayload.partno, '| manf:', requestPayload.manf, '| graph_title:', requestPayload.graph_title);
    console.log('graph_id in payload:', requestPayload.graph_id || '(empty)');
    console.log('identifier:', requestPayload.identifier);
    console.log('ai_extraction_id:', requestPayload.ai_extraction_id);
  }

  const start = performance.now();
  let relayHttpStatus = 0;
  let relayHttpOk = false;
  let netlifyResult = null;
  let networkError = '';

  try {
    const relay = await fetchAiRelayPost(netlifyRelayUrl, requestPayload);
    relayHttpStatus = relay.response.status;
    relayHttpOk = relay.response.ok;
    netlifyResult = relay.result;
    networkError = relay.networkError;
    aiLogVerbose('Relay HTTP status:', relayHttpStatus, '| ok:', relayHttpOk);
  } catch (error) {
    networkError = error?.message || String(error);
  }

  aiLogVerbose('Relay round-trip (ms):', (performance.now() - start).toFixed(1));

  if (networkError) {
    if (isAiExtractionVerboseLogEnabled()) {
      console.log('%c❌ [AI NETLIFY] RELAY REQUEST FAILED', 'color:#F44336;font-weight:bold;font-size:13px;', networkError);
      console.groupEnd();
    }
    return {
      activeRelayUrl: netlifyRelayUrl,
      result: {
        upstream_ok: false,
        upstream_status: relayHttpStatus || 502,
        raw_text: networkError,
        response: {},
        attempts: [],
      },
      response: { ok: false, status: relayHttpStatus || 502 },
    };
  }

  if (isAiExtractionVerboseLogEnabled()) {
    console.log('relay_context:', netlifyResult?.relay_context || '(none)');
    console.log('final target_url:', netlifyResult?.target_url);
    console.log('final upstream_status:', netlifyResult?.upstream_status);
    console.log('final upstream_ok:', netlifyResult?.upstream_ok);
    console.log('final content_type:', netlifyResult?.content_type);

    const attempts = Array.isArray(netlifyResult?.attempts) ? netlifyResult.attempts : [];
    if (attempts.length === 0) {
      console.log('[AI NETLIFY] No attempts[] array in relay response — logging final raw_text only');
      console.log('raw_text preview:', rawTextPreview(netlifyResult?.raw_text));
    } else {
      attempts.forEach((attempt, index) => logRelayUpstreamAttempt(attempt, index, attempts.length));
    }

    const analysis = analyzeNetlifyRelayResult(netlifyResult, relayHttpOk);
    if (analysis.overallWorked) {
      console.log('%c✅ [AI NETLIFY] OVERALL SUCCESS', 'color:#4CAF50;font-weight:bold;font-size:13px;', {
        graph_id: analysis.overallGraphId,
        why: analysis.whyWorked,
        wonViaBackup: analysis.wonViaBackup,
        final_url: analysis.final_target_url,
      });
    } else {
      console.log('%c❌ [AI NETLIFY] OVERALL FAILED', 'color:#F44336;font-weight:bold;font-size:13px;', {
        whyNot: analysis.whyNot,
        relayHttpOk: analysis.relayHttpOk,
        upstream_ok: analysis.upstream_ok,
      });
    }
    console.groupEnd();
  }

  const analysis = analyzeNetlifyRelayResult(netlifyResult, relayHttpOk);

  return {
    activeRelayUrl: netlifyRelayUrl,
    result: netlifyResult,
    response: {
      ok: relayHttpOk && Boolean(analysis.overallWorked || netlifyResult?.upstream_ok),
      status: relayHttpStatus || 502,
    },
  };
};

const fetchAiExtractionViaRenderOnly = async (renderRelayUrl, requestPayload) => {
  if (isAiExtractionVerboseLogEnabled()) {
    console.group('%c[AI RENDER] Render backend relay only (browser + Netlify paused)', 'color:#4CAF50;font-weight:bold;font-size:13px;');
    console.log('Relay URL:', renderRelayUrl);
    console.log('Render backend: one primary multipart call (120s wait), backup only on WAF block');
    console.log('Payload keys:', Object.keys(requestPayload));
    console.log('partno:', requestPayload.partno, '| manf:', requestPayload.manf, '| graph_title:', requestPayload.graph_title);
    console.log('graph_id in payload:', requestPayload.graph_id || '(empty)');
    console.log('identifier:', requestPayload.identifier);
    console.log('ai_extraction_id:', requestPayload.ai_extraction_id);
  }

  const start = performance.now();
  let relayHttpStatus = 0;
  let relayHttpOk = false;
  let renderResult = null;
  let networkError = '';

  try {
    const relay = await fetchAiRelayPost(renderRelayUrl, requestPayload);
    relayHttpStatus = relay.response.status;
    relayHttpOk = relay.response.ok;
    renderResult = relay.result;
    networkError = relay.networkError;
    aiLogVerbose('Relay HTTP status:', relayHttpStatus, '| ok:', relayHttpOk);
  } catch (error) {
    networkError = error?.message || String(error);
  }

  aiLogVerbose('Relay round-trip (ms):', (performance.now() - start).toFixed(1));

  if (networkError) {
    if (isAiExtractionVerboseLogEnabled()) {
      console.log('%c❌ [AI RENDER] RELAY REQUEST FAILED', 'color:#F44336;font-weight:bold;font-size:13px;', networkError);
      console.groupEnd();
    }
    return {
      activeRelayUrl: renderRelayUrl,
      result: {
        upstream_ok: false,
        upstream_status: relayHttpStatus || 502,
        raw_text: networkError,
        response: {},
        attempts: [],
      },
      response: { ok: false, status: relayHttpStatus || 502 },
    };
  }

  if (isAiExtractionVerboseLogEnabled()) {
    console.log('final target_url:', renderResult?.target_url);
    console.log('final upstream_status:', renderResult?.upstream_status);
    console.log('final upstream_ok:', renderResult?.upstream_ok);
    console.log('final content_type:', renderResult?.content_type);

    const attempts = Array.isArray(renderResult?.attempts) ? renderResult.attempts : [];
    if (attempts.length === 0) {
      console.log('[AI RENDER] No attempts[] array in relay response — logging final raw_text only');
      console.log('raw_text preview:', rawTextPreview(renderResult?.raw_text));
    } else {
      attempts.forEach((attempt, index) => logRelayUpstreamAttempt(attempt, index, attempts.length, '[AI RENDER]'));
    }

    const analysis = analyzeNetlifyRelayResult(renderResult, relayHttpOk);
    if (analysis.overallWorked) {
      console.log('%c✅ [AI RENDER] OVERALL SUCCESS', 'color:#4CAF50;font-weight:bold;font-size:13px;', {
        graph_id: analysis.overallGraphId,
        why: analysis.whyWorked,
        wonViaBackup: analysis.wonViaBackup,
        final_url: analysis.final_target_url,
      });
    } else {
      console.log('%c❌ [AI RENDER] OVERALL FAILED', 'color:#F44336;font-weight:bold;font-size:13px;', {
        whyNot: analysis.whyNot,
        relayHttpOk: analysis.relayHttpOk,
        upstream_ok: analysis.upstream_ok,
      });
    }
    console.groupEnd();
  }

  const analysis = analyzeNetlifyRelayResult(renderResult, relayHttpOk);

  return {
    activeRelayUrl: renderRelayUrl,
    result: renderResult,
    response: {
      ok: relayHttpOk && Boolean(analysis.overallWorked || renderResult?.upstream_ok),
      status: relayHttpStatus || 502,
    },
  };
};

const describeAiDirectFailure = (attempt = {}) => {
  const reasons = [];
  if (attempt.networkError) {
    reasons.push(`Network/CORS error: ${attempt.networkError}`);
  }
  if (attempt.httpStatus && !attempt.httpOk) {
    reasons.push(`HTTP status ${attempt.httpStatus}`);
  }
  if (attempt.isHtml) {
    reasons.push('Response is HTML (Imunify360 bot-protection or login page, not JSON API)');
  }
  if (attempt.isImunify) {
    reasons.push('Imunify360 / Access denied detected in response body');
  }
  if (attempt.isInvalidBase64) {
    reasons.push('Server returned "Invalid base64 format"');
  }
  if (!attempt.parsedResponse && attempt.rawText) {
    reasons.push('Response body is not valid JSON');
  }
  if (!attempt.validGraphId && attempt.parsedResponse) {
    reasons.push('JSON parsed but no valid integer graph_id found');
  }
  if (reasons.length === 0) {
    reasons.push('Unknown failure');
  }
  return reasons;
};

const logAiDirectAttempt = (attempt, label) => {
  const graphId = resolveIntegerGraphIdFromAiResponse(attempt.parsedResponse || {});
  console.group(`%c[AI DIRECT] ${label}`, attempt.validGraphId ? 'color:#4CAF50;font-weight:bold;' : 'color:#F44336;font-weight:bold;');
  console.log('URL:', attempt.target_url);
  console.log('Mode:', attempt.mode);
  console.log('Duration (ms):', attempt.durationMs);
  console.log('HTTP status:', attempt.httpStatus);
  console.log('Content-Type:', attempt.contentType);
  console.log('graph_id:', graphId || '(none)');
  if (attempt.networkError) {
    console.log('Network error:', attempt.networkError);
  }
  if (attempt.validGraphId) {
    console.log('%c✅ WORKED', 'color:#4CAF50;font-weight:bold;');
  } else {
    console.log('%c❌ DID NOT WORK — reasons:', 'color:#F44336;font-weight:bold;', describeAiDirectFailure(attempt));
    console.log('Response preview:', String(attempt.rawText || '').substring(0, 500));
  }
  console.groupEnd();
};

const postAiExtractionDirectAttempt = async (targetUrl, body, mode, headers = {}) => {
  const start = performance.now();
  const attempt = {
    mode,
    target_url: targetUrl,
    httpStatus: 0,
    httpOk: false,
    contentType: '',
    raw_text: '',
    parsedResponse: null,
    validGraphId: false,
    networkError: '',
    isHtml: false,
    isImunify: false,
    isInvalidBase64: false,
    durationMs: '0',
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      body,
      headers,
      mode: 'cors',
    });
    attempt.httpStatus = response.status;
    attempt.httpOk = response.ok;
    attempt.contentType = response.headers.get('content-type') || '';
    attempt.raw_text = await response.text();
    attempt.durationMs = (performance.now() - start).toFixed(1);
    attempt.isHtml =
      attempt.contentType.toLowerCase().includes('text/html') ||
      /<!DOCTYPE|<html/i.test(attempt.raw_text);
    attempt.isImunify = /imunify360|access denied/i.test(attempt.raw_text);
    attempt.isInvalidBase64 = attempt.raw_text.toLowerCase().includes('invalid base64 format');

    try {
      attempt.parsedResponse = parseCompanyApiText(attempt.raw_text);
    } catch {
      attempt.parsedResponse = null;
    }

    attempt.validGraphId = Boolean(resolveIntegerGraphIdFromAiResponse(attempt.parsedResponse || {}));
  } catch (error) {
    attempt.networkError = error?.message || String(error);
    attempt.durationMs = (performance.now() - start).toFixed(1);
  }

  return attempt;
};

const fetchAiExtractionDirectFromBrowser = async (requestPayload) => {
  console.group('%c[AI DIRECT] Browser → DiscoverEE (Netlify/Render relays paused)', 'color:#FF6B00;font-weight:bold;font-size:13px;');

  const formData = new FormData();
  for (const [key, value] of Object.entries(requestPayload)) {
    formData.append(key, value == null ? '' : String(value));
  }

  const attempts = [];
  const primary = await postAiExtractionDirectAttempt(
    DISCOVEREE_VISION_UPLOAD_URL,
    formData,
    'browser_multipart_form'
  );
  attempts.push(primary);
  logAiDirectAttempt(primary, 'Attempt 1 — vision_upload.php (primary)');

  let finalAttempt = primary;
  const shouldTryBackup =
    AI_EXTRACTION_USE_BACKUP_ENDPOINT &&
    !primary.validGraphId &&
    (primary.networkError || primary.isHtml || primary.isImunify || primary.isInvalidBase64 || !primary.httpOk);

  if (shouldTryBackup) {
    console.log('%c[AI DIRECT] Primary failed — trying graph_capture_api.php backup', 'color:#FF9800;font-weight:bold;');
    const backup = await postAiExtractionDirectAttempt(
      DISCOVEREE_GRAPH_CAPTURE_API_URL,
      JSON.stringify(requestPayload),
      'browser_json_backup',
      {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      }
    );
    attempts.push(backup);
    logAiDirectAttempt(backup, 'Attempt 2 — graph_capture_api.php (backup)');
    if (backup.validGraphId) {
      finalAttempt = backup;
    }
  }

  const graphId = resolveIntegerGraphIdFromAiResponse(finalAttempt.parsedResponse || {});
  if (finalAttempt.validGraphId) {
    console.log('%c✅ [AI DIRECT] OVERALL SUCCESS', 'color:#4CAF50;font-weight:bold;font-size:13px;', {
      graph_id: graphId,
      via: finalAttempt.target_url,
    });
  } else {
    console.log('%c❌ [AI DIRECT] OVERALL FAILED', 'color:#F44336;font-weight:bold;font-size:13px;');
    attempts.forEach((attempt, index) => {
      console.log(`Attempt ${index + 1} summary:`, {
        url: attempt.target_url,
        worked: attempt.validGraphId,
        whyNot: attempt.validGraphId ? 'n/a' : describeAiDirectFailure(attempt),
      });
    });
  }
  console.groupEnd();

  return {
    activeRelayUrl: finalAttempt.target_url,
    result: {
      target_url: finalAttempt.target_url,
      upstream_status: finalAttempt.httpStatus,
      upstream_ok: finalAttempt.validGraphId,
      content_type: finalAttempt.contentType,
      raw_text: finalAttempt.raw_text,
      response: finalAttempt.parsedResponse || {},
      attempts: attempts.map((attempt) => ({
        target_url: attempt.target_url,
        upstream_status: attempt.httpStatus,
        upstream_ok: attempt.httpOk,
        content_type: attempt.contentType,
        raw_text: attempt.raw_text,
        response: attempt.parsedResponse,
        mode: attempt.mode,
      })),
    },
  };
};

const hasCurveLineInAiResponse = (responsePayload) => {
  if (!responsePayload || typeof responsePayload !== 'object') return false;

  const topLevelCurveNameCandidates = [
    responsePayload?.curve_title,
    responsePayload?.curve_name,
    responsePayload?.line_name,
    responsePayload?.graph?.curve_title,
    responsePayload?.graph?.curve_name,
    responsePayload?.graph?.line_name,
  ];

  if (topLevelCurveNameCandidates.some((value) => String(value ?? '').trim())) {
    return true;
  }

  const details = Array.isArray(responsePayload?.details)
    ? responsePayload.details
    : Array.isArray(responsePayload?.graph?.details)
      ? responsePayload.graph.details
      : [];

  if (details.length === 0) return false;

  return details.some((detail) => {
    const curveNameCandidates = [
      detail?.curve_title,
      detail?.curve_name,
      detail?.line_name,
      detail?.name,
      detail?.title,
    ];

    return curveNameCandidates.some((value) => String(value ?? '').trim());
  });
};

const buildTcCheckerUrl = () => {
  const params = new URLSearchParams(window.location.search);
  params.set('view', 'plot-checker');
  const query = params.toString();
  return `${window.location.pathname}?${query}`;
};

const GraphCapture = () => {
  const {
    uploadedImage,
    graphConfig,
    dataPoints,
    setGraphConfig,
    replaceDataPoints,
    clearDataPoints,
    setUploadedImage,
    loadAnnotationsForCurve,
    convertCanvasToGraphCoordinates,
    graphArea,
    setGraphArea,
    setCaptureGraphArea,
    plotReferenceArea,
    getMappingArea,
    lockPlotReference,
    unlockPlotReference,
    restorePlotReferenceArea,
  } = useGraph();
  const graphWorkspaceRef = useRef(null);
  const graphAreaRef = useRef(graphArea);
  const imageSizeRef = useRef({ width: 0, height: 0 });
  const importedBoxAutoFitDoneRef = useRef(false);
  const userManuallyAdjustedGraphAreaRef = useRef(false);

  useEffect(() => {
    graphAreaRef.current = graphArea;
  }, [graphArea]);

  useEffect(() => {
    importedBoxAutoFitDoneRef.current = false;
    userManuallyAdjustedGraphAreaRef.current = false;
  }, [uploadedImage]);

  const handleGraphAreaManuallyAdjusted = useCallback(() => {
    userManuallyAdjustedGraphAreaRef.current = true;
    importedBoxAutoFitDoneRef.current = true;
  }, []);

  // Restore AI extraction logs on component mount
  useEffect(() => {
    restoreAndLogAiExtractionExchange();
  }, []);

  // Display stored dual-call test results from previous test run
  useEffect(() => {
    const storedResults = sessionStorage.getItem('ai_test_dual_call_results');
    if (!storedResults) return;
    
    try {
      const results = JSON.parse(storedResults);
      console.group('%c[TEST MODE] Previous Dual Call Test Results', 'color: #FF6B00; font-weight: bold; font-size: 12px;');
      console.log('Timestamp:', results.timestamp);
      console.log('%cFrontend Direct Call Result:', 'color: #2196F3; font-weight: bold;', results.frontend);
      console.log('%cBackend Relay Result:', 'color: #2196F3; font-weight: bold;', results.backend);
      console.log('%c💡 TIP: Copy these results to compare frontend vs backend behavior', 'color: #FFC107; font-weight: bold;');
      console.groupEnd();
    } catch (err) {
      console.warn('[TEST MODE] Failed to parse stored test results:', err);
    }
  }, []);

  // Restore and apply AI extracted metadata to form on component mount
  useEffect(() => {
    const rawMetadata = restoreAiExtractedMetadata();
    if (!rawMetadata) return;

    const metadata = normalizeAiExtractedMetadata(rawMetadata);
    aiLogVerbose('[AI METADATA] Restoring extracted metadata to form:', metadata);

    setGraphConfig((prev) => ({
      ...prev,
      ...(metadata.graphTitle ? { graphTitle: metadata.graphTitle } : {}),
      ...(metadata.curveName ? { curveName: metadata.curveName } : {}),
      ...(metadata.xLabel ? { xLabel: metadata.xLabel } : {}),
      ...(metadata.yLabel ? { yLabel: metadata.yLabel } : {}),
      ...(metadata.xScale ? { xScale: metadata.xScale } : {}),
      ...(metadata.yScale ? { yScale: metadata.yScale } : {}),
      ...(metadata.xUnitPrefix ? { xUnitPrefix: metadata.xUnitPrefix } : {}),
      ...(metadata.yUnitPrefix ? { yUnitPrefix: metadata.yUnitPrefix } : {}),
      ...buildGraphConfigAxisPatch(metadata),
      ...(metadata.tctj ? { temperature: metadata.tctj } : {}),
    }));

    aiLogVerbose('[AI METADATA] Form values restored from extracted metadata');
    clearAiExtractedMetadata();
  }, []);

  const handleAiExtensionCapture = async (imageBase64, source = '') => {
    // TEST MODE: Check at the very start before anything else runs
    const _testParams = new URLSearchParams(window.location.search);
    const _isDualCallTest = _testParams.get('ai_test_dual_call') === 'true';
    aiLogVerbose('[TEST MODE EARLY CHECK] window.location.search:', window.location.search);
    aiLogVerbose('[TEST MODE EARLY CHECK] ai_test_dual_call value:', _testParams.get('ai_test_dual_call'));
    aiLogVerbose('[TEST MODE EARLY CHECK] isDualCallTest:', _isDualCallTest);

    const reencodeImageBase64 = async (base64Str) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const freshBase64 = canvas.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '');
            resolve(freshBase64);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = base64Str.startsWith('data:') ? base64Str : `data:image/png;base64,${base64Str}`;
      });
    };

    try {
      setAiCaptureGuidanceActive(true);
      persistAiCaptureGuidanceActive(true);

      const _u = new URL(window.location.href);
      _u.searchParams.set('type', 'ai_extraction');
      window.history.replaceState(null, '', _u.toString());
    } catch (_e) {}
    const navigateWithAiFlowMessage = (message, targetUrl, delayMs = 900) => {
      setAiFlowStatusMessage(message);
      window.setTimeout(() => {
        // When graph_id is already in the URL, targetUrl equals current URL.
        // Assigning window.location.href to the same URL is a no-op in Chrome/Edge.
        // Use reload() instead so sessionStorage image is restored.
        let isSameUrl = false;
        try { isSameUrl = new URL(targetUrl).href === window.location.href; } catch { isSameUrl = targetUrl === window.location.href; }
        if (isSameUrl) { window.location.reload(); } else { window.location.href = targetUrl; }
      }, delayMs);
    };

    // TEST MODE: Make direct frontend call to AI API (for testing if frontend bypasses Imunify360)
    const testDirectFrontendCall = async (base64Image) => {
      console.group('%c[TEST] Direct Frontend Call to vision_upload.php', 'color: #FF6B00; font-weight: bold; font-size: 12px;');
      const formData = new FormData();
      formData.append('image', base64Image);
      
      const startTime = performance.now();
      try {
        console.log('Sending direct request from browser to: https://www.discoveree.io/vision_upload.php');
        const response = await fetch('https://www.discoveree.io/vision_upload.php', {
          method: 'POST',
          body: formData,
          mode: 'cors',
        });
        
        const duration = (performance.now() - startTime).toFixed(2);
        const contentType = response.headers.get('content-type');
        const responseText = await response.text();
        
        console.log('%c✅ Frontend Request Completed', 'color: #4CAF50; font-weight: bold;');
        console.log('Status:', response.status);
        console.log('Content-Type:', contentType);
        console.log('Duration:', duration, 'ms');
        console.log('Response length:', responseText.length);
        console.log('Response preview:', responseText.substring(0, 500));
        
        if ((contentType || '').includes('text/html')) {
          console.log('%c❌ BLOCKED: HTML response (likely Imunify360)', 'color: #F44336;');
        } else if ((contentType || '').includes('application/json')) {
          console.log('%c✅ SUCCESS: JSON response', 'color: #4CAF50;');
          const parsed = JSON.parse(responseText);
          console.log('Parsed response:', parsed);
          return { success: true, data: parsed, status: response.status };
        }
        
        return { success: false, status: response.status, contentType, responseLength: responseText.length };
      } catch (error) {
        const duration = (performance.now() - startTime).toFixed(2);
        console.log('%c❌ Frontend Request Failed', 'color: #F44336; font-weight: bold;');
        console.log('Error type:', error.name);
        console.log('Error message:', error.message);
        console.log('Duration:', duration, 'ms');
        return { success: false, error: error.message };
      } finally {
        console.groupEnd();
      }
    };

    setAiFlowStatusMessage('');
    // Re-encode image via Canvas to create guaranteed-valid base64 from actual image pixels
    let freshBase64 = imageBase64;
    try {
      freshBase64 = await reencodeImageBase64(imageBase64);
      aiLogVerbose('[AI] Image re-encoded via Canvas. Fresh base64 length:', freshBase64.length);
    } catch (reencodeErr) {
      aiWarnVerbose('[AI] Canvas re-encoding failed, using original base64:', reencodeErr.message);
      // Fall back to original if re-encoding fails
    }

    // Strip data URI prefix and non-base64 chars
    const rawBase64 = String(freshBase64 || '')
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/[^A-Za-z0-9+/=]/g, '');
    if (!rawBase64) {
      alert('No valid image data found for AI extraction. Please paste or upload an image and try again.');
      return false;
    }

    const hasExistingGraphContextForAi = String(urlParams.graph_id || '').trim() !== '';
    const case3DedupSuffix = hasExistingGraphContextForAi
      ? ''
      : `__ai_new_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const baseGraphTitle = String(urlParams.graph_title || '');
    const dedupBusterGraphTitle = hasExistingGraphContextForAi
      ? baseGraphTitle
      : `${baseGraphTitle || 'ai_graph'}${case3DedupSuffix}`;

    const baseIdentifier = String(urlParams.identifier || crypto.randomUUID());
    const dedupBusterIdentifier = hasExistingGraphContextForAi
      ? baseIdentifier
      : `${baseIdentifier}${case3DedupSuffix}`;

    const requestPayload = {
      action: 'graphcapture',
      type: 'ai_extraction',
      ai_extraction_id: crypto.randomUUID(),
      base64image: rawBase64,
      graph_id: String(urlParams.graph_id || ''),
      discoveree_cat_id: String(urlParams.discoveree_cat_id || ''),
      partno: String(urlParams.partno || ''),
      manf: String(urlParams.manf || urlParams.manufacturer || ''),
      manufacturer: String(urlParams.manufacturer || ''),
      username: String(urlParams.username || ''),
      graph_title: dedupBusterGraphTitle,
      curve_title: String(urlParams.curve_title || ''),
      x_label: String(urlParams.x_label || ''),
      y_label: String(urlParams.y_label || ''),
      other_symbols: String(urlParams.other_symbols || ''),
      identifier: dedupBusterIdentifier,
      testuser_id: String(urlParams.testuser_id || ''),
      tctj: String(urlParams.tctj || ''),
      return_url: String(urlParams.return_url || ''),
    };

    const netlifyRelayUrl = '/.netlify/functions/ai-relay';
    const renderRelayUrl = `${apiUrl}/api/ai-extraction`;

    aiLogVerbose('=== AI EXTRACTION REQUEST ===', {
      route: AI_EXTRACTION_ROUTE,
      netlifyRelayUrl: AI_EXTRACTION_ROUTE === 'netlify-only' || AI_EXTRACTION_ROUTE === 'production'
        ? netlifyRelayUrl
        : '(paused)',
      renderRelayUrl: AI_EXTRACTION_ROUTE === 'render-only' || AI_EXTRACTION_ROUTE === 'production'
        ? renderRelayUrl
        : '(paused)',
      browserDirect: AI_EXTRACTION_ROUTE === 'browser-only' ? 'active' : '(paused)',
      visionUploadUrl: DISCOVEREE_VISION_UPLOAD_URL,
      graphCaptureApiUrl: DISCOVEREE_GRAPH_CAPTURE_API_URL,
      base64imageLength: rawBase64.length,
      payload: requestPayload,
    });
    aiLogVerbose('[DEBUG] Sending base64 string of length:', rawBase64.length, 'first 100 chars:', rawBase64.substring(0, 100));

    setIsAiExtractionLoading(true);

    const showAiManualCaptureMessage = (message = AI_MANUAL_CAPTURE_MESSAGE, displayMs = 5000) => {
      setIsAiExtractionLoading(false);
      setAiFlowStatusMessage(message);
      window.setTimeout(() => setAiFlowStatusMessage(''), displayMs);
      return false;
    };
    
    // TEST MODE: If ai_test_dual_call=true, run frontend and backend calls in parallel
    const urlSearchParams = new URLSearchParams(window.location.search);
    const isDualCallTest = _isDualCallTest; // Evaluated at very start of function
    const isBackendFallbackDisabled = urlSearchParams.get('ai_disable_backend_fallback') === 'true';
    const isEndpointProofTest = (() => {
      if (urlSearchParams.get('ai_test_endpoint_proof') === 'true') return true;
      for (const key of urlSearchParams.keys()) {
        const normalizedKey = String(key || '').toLowerCase();
        if (normalizedKey === 'ai_test_endpoint_proof=true' || normalizedKey === 'ai_test_endpoint_proof%3dtrue') {
          return true;
        }
      }
      return false;
    })();
    aiLogVerbose('[DEBUG] ai_test_endpoint_proof enabled:', isEndpointProofTest, 'search:', window.location.search);

    if (isEndpointProofTest) {
      setIsAiExtractionLoading(true);
      console.group('%c🔬 ENDPOINT PROOF TEST — All 3 Paths vs vision_upload.php', 'color: #9C27B0; font-weight: bold; font-size: 15px;');
      console.log('Testing vision_upload.php from: (1) Browser direct, (2) Netlify function, (3) Render backend');
      console.log('Navigation BLOCKED so you can read results. Payload base64 length:', rawBase64.length);

      const VISION_URL = 'https://www.discoveree.io/vision_upload.php';
      const GCAPI_URL  = 'https://www.discoveree.io/graph_capture_api.php';

      const proofPayload = { ...requestPayload };

      // --- PATH 1: Browser direct ---
      const path1 = (async () => {
        console.group('%c📍 PATH 1 — Browser direct → vision_upload.php', 'color: #FF6B00; font-weight: bold;');
        const t0 = performance.now();
        try {
          const fd = new FormData();
          Object.entries(proofPayload).forEach(([k, v]) => fd.append(k, v));
          const r = await fetch(VISION_URL, { method: 'POST', body: fd, mode: 'cors' });
          const ct = r.headers.get('content-type') || '';
          const body = await r.text();
          const ms = (performance.now() - t0).toFixed(0);
          const blocked = ct.includes('text/html') || body.includes('Imunify360') || body.includes('Invalid base64');
          console.log('URL:', VISION_URL);
          console.log('HTTP status:', r.status, '| Content-Type:', ct, '| Duration:', ms + 'ms');
          console.log('Body (first 400):', body.substring(0, 400));
          if (blocked) console.log('%c❌ BLOCKED — response is HTML, not JSON', 'color:#F44336;font-weight:bold;');
          else         console.log('%c✅ NOT blocked — response is JSON', 'color:#4CAF50;font-weight:bold;');
          console.groupEnd();
          return { path: 'browser_direct', url: VISION_URL, status: r.status, contentType: ct, bodySnippet: body.substring(0, 400), blocked, ms };
        } catch (err) {
          const ms = (performance.now() - t0).toFixed(0);
          console.log('%c❌ ERROR — request threw an exception (likely CORS or network block)', 'color:#F44336;font-weight:bold;');
          console.log('Error name:', err.name, '| Message:', err.message, '| Duration:', ms + 'ms');
          console.groupEnd();
          return { path: 'browser_direct', url: VISION_URL, error: err.message, errorName: err.name, blocked: true, ms };
        }
      })();

      // --- PATH 2: Netlify function ---
      const path2 = (async () => {
        console.group('%c📍 PATH 2 — Netlify function → relay → vision_upload.php + graph_capture_api.php', 'color: #2196F3; font-weight: bold;');
        const t0 = performance.now();
        try {
          const r = await fetch(netlifyRelayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proofPayload),
          });
          const ct = r.headers.get('content-type') || '';
          const data = await r.json();
          const ms = (performance.now() - t0).toFixed(0);
          console.log('Relay URL:', netlifyRelayUrl, '| HTTP status:', r.status, '| Duration:', ms + 'ms');
          console.log('upstream_status:', data?.upstream_status, '| upstream_ok:', data?.upstream_ok, '| content_type:', data?.content_type);
          console.log('raw_text (first 300):', String(data?.raw_text || '').substring(0, 300));
          if (Array.isArray(data?.attempts)) {
            data.attempts.forEach((a, i) => {
              const aBlocked = String(a?.content_type || '').includes('text/html') || String(a?.raw_text || '').includes('Imunify360') || String(a?.raw_text || '').includes('Invalid base64');
              console.log(`  Attempt ${i + 1}: ${a?.target_url} | HTTP ${a?.upstream_status} | ${a?.content_type} | blocked=${aBlocked} | snippet="${String(a?.raw_text || '').substring(0, 120)}"`);
            });
          }
          const visionAttempt = (data?.attempts || []).find(a => String(a?.target_url || '').includes('vision_upload'));
          const gcapiAttempt  = (data?.attempts || []).find(a => String(a?.target_url || '').includes('graph_capture_api'));
          if (visionAttempt) {
            const vBlocked = String(visionAttempt.content_type || '').includes('text/html');
            console.log(vBlocked ? '%c❌ vision_upload.php BLOCKED from Netlify' : '%c✅ vision_upload.php NOT blocked from Netlify', vBlocked ? 'color:#F44336;font-weight:bold;' : 'color:#4CAF50;font-weight:bold;');
          }
          if (gcapiAttempt) {
            const gOk = String(gcapiAttempt.content_type || '').includes('application/json');
            console.log(gOk ? '%c✅ graph_capture_api.php OK from Netlify' : '%c⚠️ graph_capture_api.php unexpected response from Netlify', gOk ? 'color:#4CAF50;font-weight:bold;' : 'color:#FF9800;font-weight:bold;');
          }
          console.groupEnd();
          return { path: 'netlify_relay', relayStatus: r.status, upstreamStatus: data?.upstream_status, upstreamOk: data?.upstream_ok, contentType: data?.content_type, rawSnippet: String(data?.raw_text || '').substring(0, 300), attempts: data?.attempts, ms };
        } catch (err) {
          const ms = (performance.now() - t0).toFixed(0);
          console.log('%c❌ ERROR calling Netlify relay', 'color:#F44336;font-weight:bold;', err.message);
          console.groupEnd();
          return { path: 'netlify_relay', error: err.message, ms };
        }
      })();

      // --- PATH 3: Render backend ---
      const path3 = (async () => {
        console.group('%c📍 PATH 3 — Render backend → relay → vision_upload.php + graph_capture_api.php', 'color: #4CAF50; font-weight: bold;');
        const t0 = performance.now();
        try {
          const r = await fetch(renderRelayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proofPayload),
          });
          const ct = r.headers.get('content-type') || '';
          const data = await r.json();
          const ms = (performance.now() - t0).toFixed(0);
          console.log('Relay URL:', renderRelayUrl, '| HTTP status:', r.status, '| Duration:', ms + 'ms');
          console.log('upstream_status:', data?.upstream_status, '| upstream_ok:', data?.upstream_ok, '| content_type:', data?.content_type);
          console.log('raw_text (first 300):', String(data?.raw_text || '').substring(0, 300));
          if (Array.isArray(data?.attempts)) {
            data.attempts.forEach((a, i) => {
              const aBlocked = String(a?.content_type || '').includes('text/html') || String(a?.raw_text || '').includes('Imunify360') || String(a?.raw_text || '').includes('Invalid base64');
              console.log(`  Attempt ${i + 1}: ${a?.target_url} | HTTP ${a?.upstream_status} | ${a?.content_type} | blocked=${aBlocked} | snippet="${String(a?.raw_text || '').substring(0, 120)}"`);
            });
          }
          const visionAttempt = (data?.attempts || []).find(a => String(a?.target_url || '').includes('vision_upload'));
          const gcapiAttempt  = (data?.attempts || []).find(a => String(a?.target_url || '').includes('graph_capture_api'));
          if (visionAttempt) {
            const vBlocked = String(visionAttempt.content_type || '').includes('text/html');
            console.log(vBlocked ? '%c❌ vision_upload.php BLOCKED from Render backend' : '%c✅ vision_upload.php NOT blocked from Render backend', vBlocked ? 'color:#F44336;font-weight:bold;' : 'color:#4CAF50;font-weight:bold;');
          }
          if (gcapiAttempt) {
            const gOk = String(gcapiAttempt.content_type || '').includes('application/json');
            console.log(gOk ? '%c✅ graph_capture_api.php OK from Render backend' : '%c⚠️ graph_capture_api.php unexpected response from Render backend', gOk ? 'color:#4CAF50;font-weight:bold;' : 'color:#FF9800;font-weight:bold;');
          }
          console.groupEnd();
          return { path: 'render_backend', relayStatus: r.status, upstreamStatus: data?.upstream_status, upstreamOk: data?.upstream_ok, contentType: data?.content_type, rawSnippet: String(data?.raw_text || '').substring(0, 300), attempts: data?.attempts, ms };
        } catch (err) {
          const ms = (performance.now() - t0).toFixed(0);
          console.log('%c❌ ERROR calling Render backend', 'color:#F44336;font-weight:bold;', err.message);
          console.groupEnd();
          return { path: 'render_backend', error: err.message, ms };
        }
      })();

      const [r1, r2, r3] = await Promise.allSettled([path1, path2, path3]);

      console.group('%c📋 PROOF SUMMARY', 'color: #9C27B0; font-weight: bold; font-size: 14px;');
      console.log('%cPATH 1 — Browser direct:',   'color:#FF6B00;font-weight:bold;', r1.value || r1.reason);
      console.log('%cPATH 2 — Netlify relay:',    'color:#2196F3;font-weight:bold;', r2.value || r2.reason);
      console.log('%cPATH 3 — Render backend:',   'color:#4CAF50;font-weight:bold;', r3.value || r3.reason);
      sessionStorage.setItem('ai_endpoint_proof_results', JSON.stringify({ path1: r1.value, path2: r2.value, path3: r3.value, ts: new Date().toISOString() }));
      console.log('%c💾 Full results saved to sessionStorage key: ai_endpoint_proof_results', 'color:#9C27B0;');
      console.log('%c⚠️ Navigation BLOCKED — refresh page to return to normal mode', 'color:#FFC107;font-weight:bold;');
      console.groupEnd();
      console.groupEnd();
      setIsAiExtractionLoading(false);
      return false;
    }

    if (isDualCallTest) {
      console.group('%c[TEST MODE] Running Dual API Calls (Frontend + Backend)', 'color: #FF6B00; font-weight: bold; font-size: 14px;');
      console.log('Starting parallel frontend and backend calls for comparison...');
      console.log('Test results will be stored in sessionStorage and persist after navigation.');
      console.log('To retrieve results after navigation, run: JSON.parse(sessionStorage.getItem("ai_test_dual_call_results"))');
      
      try {
        // Run both calls in parallel
        const [frontendResult, backendResult] = await Promise.allSettled([
          testDirectFrontendCall(rawBase64),
          (async () => {
            const r = await fetch(renderRelayUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestPayload),
            });
            const text = await r.text();
            return { status: r.status, contentType: r.headers.get('content-type'), text };
          })()
        ]);
        
        console.group('%c[TEST RESULTS COMPARISON]', 'color: #FF6B00; font-weight: bold; font-size: 12px;');
        console.log('%cFrontend Result:', 'color: #2196F3; font-weight: bold;', frontendResult);
        console.log('%cBackend Result:', 'color: #2196F3; font-weight: bold;', backendResult);
        console.log('%c⚠️ Navigation is BLOCKED in test mode so you can read these results', 'color: #FFC107; font-weight: bold;');
        console.groupEnd();
        console.groupEnd();
        setIsAiExtractionLoading(false);
        return false; // Stop here — do not navigate so logs stay visible
      } catch (testErr) {
        console.error('[TEST] Error during dual call test:', testErr);
      }
      console.groupEnd();
      setIsAiExtractionLoading(false);
      return false; // Stop here in test mode regardless
    }
    
    try {
      // Debug: Allow forcing error via URL parameter for testing failure case
      if (urlSearchParams.get('ai_force_error') === 'true') {
        console.log('[DEBUG] Forced error mode enabled - simulating AI extraction failure');
        throw new Error('Simulated AI extraction failure for testing purposes');
      }

      let response;
      let activeRelayUrl;
      let result;

      if (AI_EXTRACTION_ROUTE === 'browser-only') {
        aiLogVerbose('%c[AI] Browser-direct only (relays paused)', 'color:#FF9800;font-weight:bold;');
        const direct = await fetchAiExtractionDirectFromBrowser(requestPayload);
        activeRelayUrl = direct.activeRelayUrl;
        result = direct.result;
        response = {
          ok: Boolean(result.upstream_ok),
          status: result.upstream_status || 502,
        };
      } else if (AI_EXTRACTION_ROUTE === 'netlify-only') {
        aiLogVerbose('%c[AI] Netlify relay only (browser + Render paused)', 'color:#2196F3;font-weight:bold;');
        const netlify = await fetchAiExtractionViaNetlifyOnly(netlifyRelayUrl, requestPayload);
        activeRelayUrl = netlify.activeRelayUrl;
        result = netlify.result;
        response = netlify.response;
      } else if (AI_EXTRACTION_ROUTE === 'render-only') {
        aiLogVerbose('%c[AI] Render backend relay only (browser + Netlify paused)', 'color:#4CAF50;font-weight:bold;');
        const render = await fetchAiExtractionViaRenderOnly(renderRelayUrl, requestPayload);
        activeRelayUrl = render.activeRelayUrl;
        result = render.result;
        response = render.response;
      } else {
        // production: Render first (long upstream wait), Netlify only if Render relay is unreachable
        aiLogVerbose('[RELAY] Trying Render backend first (long AI wait):', renderRelayUrl);
        const renderRelay = await fetchAiRelayPost(renderRelayUrl, requestPayload);
        activeRelayUrl = renderRelayUrl;
        result = renderRelay.result;
        response = {
          ok: renderRelay.response.ok,
          status: renderRelay.response.status,
        };

        const renderHasGraphId = Boolean(relayResultHasGraphId(result));
        const renderRelayUnreachable =
          Boolean(renderRelay.networkError) ||
          renderRelay.response.status === 502 ||
          renderRelay.response.status === 503;

        if (!renderHasGraphId && renderRelayUnreachable && !isAiProviderFailureResult(result)) {
          if (isBackendFallbackDisabled) {
            throw new Error('Render relay failed and Netlify fallback is disabled (ai_disable_backend_fallback=true).');
          }
          aiWarnVerbose('[RELAY] Render relay unreachable. Falling back to Netlify relay:', netlifyRelayUrl);
          const netlifyRelay = await fetchAiRelayPost(netlifyRelayUrl, requestPayload);
          activeRelayUrl = netlifyRelayUrl;
          result = netlifyRelay.result;
          response = {
            ok: netlifyRelay.response.ok,
            status: netlifyRelay.response.status,
          };
        } else if (renderHasGraphId) {
          aiLogVerbose('[RELAY] Render backend succeeded with graph_id.');
        } else {
          aiLogVerbose('[RELAY] Using Render response without Netlify retry (avoids duplicate AI captures).');
        }
      }

      aiLogVerbose('=== RELAY RESPONSE ===', {
        activeRelayUrl,
        relayStatus: response.status,
        relayOk: response.ok,
      });

      aiLogVerbose('=== UPSTREAM RESPONSE ===', {
        upstreamStatus: result?.upstream_status,
        upstreamOk: result?.upstream_ok,
        contentType: result?.content_type,
        rawTextLength: (result?.raw_text || '').length,
        firstRawTextChars: (result?.raw_text || '').substring(0, 200),
      });

      aiLogVerbose('=== PARSED RESPONSE ===', {
        response: result?.response,
      });

      aiLogVerbose('=== AI EXTRACTION RESPONSE ===', {
        url: activeRelayUrl,
        relayStatus: response.status,
        upstreamStatus: result?.upstream_status,
        upstreamOk: result?.upstream_ok,
        contentType: result?.content_type,
        rawText: result?.raw_text,
        parsedResponse: result?.response,
      });

      aiLogVerbose('[DEBUG] Attempts (which URLs were tried):', result?.attempts?.map(a => ({
        targetUrl: a?.target_url,
        status: a?.upstream_status,
        isHtml: (a?.content_type || '').includes('text/html'),
        responseLength: (a?.raw_text || '').length,
      })));

      const aiLogMeta = {
        route: AI_EXTRACTION_ROUTE,
        activeRelayUrl,
        relayStatus: response.status,
        relayOk: response.ok,
      };

      logVisionUploadPrimaryExchange(requestPayload, result?.attempts || [], aiLogMeta);
      logPrimaryVisionUploadFailureReport(result?.attempts || []);
      logAiExtractionFlowSummary(result?.attempts || []);
      
      // Save flow data to sessionStorage so it persists across page navigation
      persistAiExtractionFlowLog({ attempts: result?.attempts || [] });

      const logAndPersistAiExchange = (outcome) => {
        const exchange = {
          requestPayload: formatAiRequestPayloadForLog(requestPayload),
          result,
          meta: aiLogMeta,
          outcome,
        };
        persistAiExtractionExchangeLog(exchange);
        logAiExtractionRequestResponse({ ...exchange, restored: false });
      };

      if (!response.ok) {
        logAndPersistAiExchange('relay error');
        // Relay itself failed (502/503) — network/server issue
        throw new Error(`Relay error (${response.status}): ${JSON.stringify(result)}`);
      }

      const resolvedGraphId = relayResultHasGraphId(result);

      // Upstream responded (even 4xx/5xx) — surface AI failures without duplicate retries
      if (!result?.upstream_ok && !resolvedGraphId) {
        aiWarnVerbose('=== AI EXTRACTION UPSTREAM ERROR ===', result?.raw_text || `HTTP ${result?.upstream_status}`);
        logAndPersistAiExchange('try manual capture (upstream error)');
        return showAiManualCaptureMessage();
      }

      const aiResponsePayload = result?.response && typeof result.response === 'object'
        ? result.response
        : {};
      const validGraphId = resolvedGraphId || resolveIntegerGraphIdFromAiResponse(aiResponsePayload);
      
      // Extract metadata from AI response for auto-population
      const extractedMetadata = normalizeAiExtractedMetadata({
        graphTitle: String(aiResponsePayload?.graph_title || aiResponsePayload?.title || '').trim(),
        curveName: String(aiResponsePayload?.curve_title || aiResponsePayload?.curve_name || aiResponsePayload?.line_name || '').trim(),
        xLabel: String(aiResponsePayload?.x_title || aiResponsePayload?.x_label || '').trim(),
        yLabel: String(aiResponsePayload?.y_title || aiResponsePayload?.y_label || '').trim(),
        xScale: String(aiResponsePayload?.x_scale || 'Linear').trim(),
        yScale: String(aiResponsePayload?.y_scale || 'Linear').trim(),
        xUnitPrefix: String(aiResponsePayload?.x_unit || aiResponsePayload?.xunit || '').trim(),
        yUnitPrefix: String(aiResponsePayload?.y_unit || aiResponsePayload?.yunit || '').trim(),
        xMin: aiResponsePayload?.x_min ?? '',
        xMax: aiResponsePayload?.x_max ?? '',
        yMin: aiResponsePayload?.y_min ?? '',
        yMax: aiResponsePayload?.y_max ?? '',
        tctj: String(aiResponsePayload?.tctj || aiResponsePayload?.temperature || '').trim(),
      });
      
      if (!validGraphId) {
        aiLogVerbose('=== AI EXTRACTION DECISION ===', {
          action: 'stay',
          reason: 'Missing valid integer graph_id in response',
          response: aiResponsePayload,
        });
        logAndPersistAiExchange('try manual capture (no graph_id)');
        return showAiManualCaptureMessage();
      }

      const currentUrlGraphId = String(urlParams.graph_id || '').trim();
      const graphIdForFlow = currentUrlGraphId || validGraphId;

      let hasCapturedCurves = false;
      try {
        hasCapturedCurves = await checkGraphHasCapturedCurves(graphIdForFlow);
      } catch (error) {
        console.warn('Unable to check captured curves by graph_id. Falling back to AI response metadata.', error);
        hasCapturedCurves = hasCurveLineInAiResponse(aiResponsePayload);
      }

      const redirectUrl = new URL(window.location.href);
      redirectUrl.searchParams.set('graph_id', graphIdForFlow);
      redirectUrl.searchParams.delete(AI_DIRECT_CAPTURE_PARAM);

      if (!hasCapturedCurves) {
        aiLogVerbose('=== AI EXTRACTION DECISION ===', {
          action: currentUrlGraphId ? 'redirect_for_capture_no_curves' : 'redirect_case3_with_graph_id_no_curves',
          reason: currentUrlGraphId
            ? 'graph_id in URL but no captured curves yet — upload mode with pending image'
            : 'Case 3: AI returned graph_id but no captured curves — graph_id added to URL, upload mode with pending image',
          graph_id: graphIdForFlow,
        });

        persistAiPendingCapture(imageBase64, source, graphIdForFlow);
        persistAiExtractedMetadata(extractedMetadata);
        logAndPersistAiExchange('redirect — upload mode with pending image');
        navigateWithAiFlowMessage(
          'Graph found. Redirecting to graph capture page with pre-filled data...',
          redirectUrl.toString(),
          900
        );
        return true;
      }

      aiLogVerbose('=== AI EXTRACTION DECISION ===', {
        action: 'redirect',
        reason: 'Valid graph_id found and existing captured curves detected',
        graph_id: graphIdForFlow,
      });

      logAndPersistAiExchange('redirect — graph has existing curves');
      navigateWithAiFlowMessage(
        'Graph found with existing curves. Redirecting to graph capture page...',
        redirectUrl.toString()
      );
      return true;
    } catch (error) {
      console.error('AI extraction request failed:', error);
      return showAiManualCaptureMessage();
    } finally {
      // Loading state already cleared above in catch, safe to call again here for non-error paths
      setIsAiExtractionLoading(false);
    }
  };

  const handleUserImageLoaded = ({ preserveGraphContext = false } = {}) => {
    const graphIdInUrl = String(
      new URLSearchParams(window.location.search).get('graph_id') ||
      activeSessionGraphIdRef.current ||
      ''
    ).trim();
    // DiscoverEE append: keep graph_id on first manual capture when URL already has one.
    const shouldPreserveGraphContext =
      preserveGraphContext || (Boolean(graphIdInUrl) && savedCurves.length === 0);

    if (!shouldPreserveGraphContext) {
      clearGraphIdContext();
    } else if (graphIdInUrl) {
      activateAppendSession(
        graphIdInUrl,
        activeSessionImageKeyRef.current || uploadedImage || '',
        'manual-capture-preserve-graph-id'
      );
    }
    setGraphTitleUnlocked(true);
    setUrlParams((prev) => ({
      ...prev,
      x_label: '',
      y_label: '',
    }));
    setIsXTitleUrlLocked(false);
    setIsYTitleUrlLocked(false);

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('x_label');
    currentUrl.searchParams.delete('x_title');
    currentUrl.searchParams.delete('xlabel');
    currentUrl.searchParams.delete('y_label');
    currentUrl.searchParams.delete('y_title');
    currentUrl.searchParams.delete('ylabel');
    currentUrl.searchParams.delete(AI_DIRECT_CAPTURE_PARAM);
    window.history.replaceState({}, '', currentUrl.toString());
    setAiFlowStatusMessage('');

    setAiCaptureGuidanceActive(false);
    persistAiCaptureGuidanceActive(false);

    if (shouldPreserveGraphContext) {
      setShouldSkipCaptureChoiceAfterAi(false);
    }

    scrollToGraphWorkspace();
  };
  const [isSaving, setIsSaving] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [savedCurves, setSavedCurves] = useState([]);
  const [combinedGroupId, setCombinedGroupId] = useState('');
  const [isFetchingSaved, setIsFetchingSaved] = useState(false);
  const [isAiExtractionLoading, setIsAiExtractionLoading] = useState(false);
  const [savedCurvesError, setSavedCurvesError] = useState('');
  const [selectedCurveId, setSelectedCurveId] = useState('');
  const [isLoadingSavedCurve, setIsLoadingSavedCurve] = useState(false);
  const [shouldSkipCaptureChoiceAfterAi, setShouldSkipCaptureChoiceAfterAi] = useState(false);
  const [aiFlowStatusMessage, setAiFlowStatusMessage] = useState('');
  const [restoredPendingCapture, setRestoredPendingCapture] = useState(null);
  const [hasPendingCaptureChoice, setHasPendingCaptureChoice] = useState(false);
  const [aiCaptureGuidanceActive, setAiCaptureGuidanceActive] = useState(() => readAiCaptureGuidanceActive());
  const [isInitialGraphFetchPending, setIsInitialGraphFetchPending] = useState(() => {
    const graphId = String(new URLSearchParams(window.location.search).get('graph_id') || '').trim();
    if (!graphId) return false;
    if (getValidatedPersistedGraphImage(graphId)) return false;
    if (getPersistedSavedCurves(graphId)?.curves?.length > 0) return false;
    return true;
  });
  const [graphLoadNotice, setGraphLoadNotice] = useState('');
  const [savedCurvesSource, setSavedCurvesSource] = useState('company');
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [previewSortByX, setPreviewSortByX] = useState(false);
  const [isUpdatingCurveId, setIsUpdatingCurveId] = useState('');
  const [isRemovingCurveId, setIsRemovingCurveId] = useState('');
  const [isRemovingAllGraphs, setIsRemovingAllGraphs] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const [urlParams, setUrlParams] = useState({
    partno: '',
    manufacturer: '',
    username: '',
    graph_title: '',
    curve_title: '',
    x_label: '',
    y_label: '',
    other_symbols: '',
    discoveree_cat_id: '',
    identifier: '',
    testuser_id: '',
    tctj: '',
    return_url: '',
    graph_id: '',
  });
  const [isXTitleUrlLocked, setIsXTitleUrlLocked] = useState(false);
  const [isYTitleUrlLocked, setIsYTitleUrlLocked] = useState(false);
  const [graphTitleUnlocked, setGraphTitleUnlocked] = useState(false);
  const [symbolValues, setSymbolValues] = useState({});
  const [symbolNames, setSymbolNames] = useState([]);
  const [returnParams, setReturnParams] = useState({});
  const [returnGraphId, setReturnGraphId] = useState('');
  const [editingCurveId, setEditingCurveId] = useState('');
  // Helper function to convert friendly label to return parameter name
  const convertLabelToReturnParam = (label) => {
    const trimmed = (label || '').trim();
    // Keep already-safe parameter names unchanged (e.g. graph_tctj)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      return trimmed;
    }

    // Remove content in parentheses: "No. of branches or Order (n)" → "No. of branches or Order"
    const cleaned = trimmed.replace(/\s*\([^)]*\)\s*/g, '').trim();
    
    // Split by spaces, dots, commas, hyphens
    const words = cleaned.split(/[\s\.,\-]+/).filter((w) => w.length > 0);
    
    if (words.length === 0) return '';
    
    // Take first 3 words for the parameter name
    const selectedWords = words.slice(0, 3);
    
    // Convert to PascalCase: capitalize first letter of each word
    const paramName = selectedWords
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    
    return paramName;
  };

      const buildSymbolKeyCandidates = (label) => {
        const trimmed = (label || '').trim();
        if (!trimmed) return [];

        const cleaned = trimmed.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        const safeExact = /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned) ? cleaned : '';
        const compact = cleaned.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_]/g, '');
        const snake = cleaned
          .toLowerCase()
          .replace(/[^a-z0-9_\s]/g, ' ')
          .replace(/\s+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '');
        const legacy = convertLabelToReturnParam(cleaned);

        return Array.from(new Set([safeExact, compact, snake, legacy].filter(Boolean)));
      };

      const resolveSymbolParamName = (label, searchParams) => {
        const candidates = buildSymbolKeyCandidates(label);
        const keys = Array.from(searchParams.keys());

        for (const candidate of candidates) {
          const lowerCandidate = candidate.toLowerCase();

          const directMatch = keys.find((key) => key.toLowerCase() === lowerCandidate);
          if (directMatch) {
            return directMatch;
          }

          const returnMatch = keys.find((key) => key.toLowerCase() === `return_${lowerCandidate}`);
          if (returnMatch) {
            return returnMatch.substring(7);
          }
        }

        return candidates[0] || convertLabelToReturnParam(label);
      };

      const parseSymbolValuesFromText = (rawValue, preferredKeys = []) => {
        const text = String(rawValue || '').trim();
        if (!text) return {};

        const parsedEntries = text
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const separatorIndex = part.indexOf(':');
            if (separatorIndex === -1) return null;
            const key = part.slice(0, separatorIndex).trim();
            const value = part.slice(separatorIndex + 1).trim();
            return key && value ? [key, value] : null;
          })
          .filter(Boolean);

        if (parsedEntries.length > 0) {
          return Object.fromEntries(parsedEntries);
        }

        if (preferredKeys.length === 1) {
          return { [preferredKeys[0]]: text };
        }

        return { tctj: text };
      };

      const extractDetailSymbolValues = (detail = {}, preferredKeys = []) => {
        const preferredKeySet = new Set((Array.isArray(preferredKeys) ? preferredKeys : []).map((key) => String(key).toLowerCase()));
        const readMappedValue = (source = {}, key = '') => {
          const directValue = source?.[key];
          if (directValue !== undefined && directValue !== null && String(directValue).trim() !== '') {
            return String(directValue);
          }

          const alternateKey = getAlternateDfSymbolKey(key);
          if (!alternateKey || preferredKeySet.has(String(alternateKey).toLowerCase())) {
            return '';
          }

          const alternateValue = source?.[alternateKey];
          if (alternateValue !== undefined && alternateValue !== null && String(alternateValue).trim() !== '') {
            return String(alternateValue);
          }

          return '';
        };

        const directValues = preferredKeys.reduce((accumulator, key) => {
          const mappedValue = readMappedValue(detail, key);
          if (mappedValue !== '') {
            accumulator[key] = mappedValue;
          }
          return accumulator;
        }, {});

        if (Object.keys(directValues).length > 0) {
          return directValues;
        }

        if (detail?.symbol_values && typeof detail.symbol_values === 'object' && !Array.isArray(detail.symbol_values)) {
          const mappedFromSymbolValues = preferredKeys.reduce((accumulator, key) => {
            const mappedValue = readMappedValue(detail.symbol_values, key);
            if (mappedValue !== '') {
              accumulator[key] = mappedValue;
            }
            return accumulator;
          }, {});

          if (Object.keys(mappedFromSymbolValues).length > 0) {
            return mappedFromSymbolValues;
          }

          return Object.fromEntries(
            Object.entries(detail.symbol_values)
              .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
              .map(([key, value]) => [key, String(value)])
          );
        }

        if (detail?.tctj && typeof detail.tctj === 'object' && !Array.isArray(detail.tctj)) {
          const mappedFromTctjObject = preferredKeys.reduce((accumulator, key) => {
            const mappedValue = readMappedValue(detail.tctj, key);
            if (mappedValue !== '') {
              accumulator[key] = mappedValue;
            }
            return accumulator;
          }, {});

          if (Object.keys(mappedFromTctjObject).length > 0) {
            return mappedFromTctjObject;
          }
        }

        return parseSymbolValuesFromText(detail?.tctj, preferredKeys);
      };

      const buildDynamicSymbolPayload = (values = {}, labels = {}, preferredKeys = [], fallbackValue = '') => {
        const orderedKeys = Array.from(
          new Set([
            ...(Array.isArray(preferredKeys) ? preferredKeys : []),
            ...Object.keys(labels || {}),
            ...Object.keys(values || {}),
          ].filter(Boolean))
        );

        const symbolTitles = {};
        const symbolValuesPayload = {};

        orderedKeys.forEach((rawKey) => {
          const key = toApiSymbolKey(rawKey);
          if (!key) return;

          const label = String(labels?.[rawKey] || labels?.[key] || '').trim();
          const rawValue = values?.[rawKey] ?? values?.[key];

          if (label) {
            symbolTitles[key] = label;
          }

          if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
            symbolValuesPayload[key] = String(rawValue).trim();
          }
        });

        const legacyFieldValues = {};
        ['tctj', 'df_tj'].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(symbolValuesPayload, key)) {
            legacyFieldValues[key] = symbolValuesPayload[key];
          }
        });

        const primaryKey =
          orderedKeys.find((key) => ['graph_tctj', 'tctj', 'df_tj'].includes(key)) ||
          Object.keys(symbolValuesPayload)[0] ||
          orderedKeys[0] ||
          '';

        const primaryValue =
          (primaryKey && symbolValuesPayload[primaryKey]) ||
          Object.values(symbolValuesPayload)[0] ||
          String(fallbackValue || '').trim();

        const legacyTctjValue =
          legacyFieldValues.tctj || legacyFieldValues.df_tj || String(fallbackValue || '').trim();

        return {
          symbolTitles,
          symbolValues: symbolValuesPayload,
          legacyFieldValues,
          hasExplicitLegacyFields: Object.keys(legacyFieldValues).length > 0,
          primaryKey,
          primaryLabel: primaryKey ? symbolTitles[primaryKey] || '' : '',
          primaryValue,
          legacyTctjValue,
        };
      };

  const [symbolLabels, setSymbolLabels] = useState({});
  const [editCurveMeta, setEditCurveMeta] = useState({
    xScale: 'Linear',
    yScale: 'Linear',
    xUnitPrefix: '1',
    yUnitPrefix: '1',
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
  });
  const editSessionAxisRef = useRef(null);
  const [editCurveSymbolValues, setEditCurveSymbolValues] = useState({});
  const [editCurveName, setEditCurveName] = useState('');
  const [editPartNumber, setEditPartNumber] = useState('');
  // State for axis confirmation and freezing (Issue 5 & 7)
  const [isAxisMappingConfirmed, setIsAxisMappingConfirmed] = useState(false);
  const [frozenGraphConfig, setFrozenGraphConfig] = useState(null);
  const [partNumberLocked, setPartNumberLocked] = useState(false);
  const [showReturnDecisionModal, setShowReturnDecisionModal] = useState(false);
  const [showCaptureAnotherGuidance, setShowCaptureAnotherGuidance] = useState(false);
  const [pendingReturnUrl, setPendingReturnUrl] = useState('');
  const savedGraphsSectionRef = useRef(null);
  const hasAutoScrolledToSavedGraphs = useRef(false);
  const autoLoadedGraphIdRef = useRef('');
  const activeSessionGraphIdRef = useRef('');
  const hasActiveAppendSessionRef = useRef(false);
  const activeSessionImageKeyRef = useRef('');
  const restoredPendingImageRef = useRef('');
  const previousUploadedImageRef = useRef(uploadedImage || '');
  const suppressNextImageSessionResetRef = useRef(false);
    const activeSessionIdentifierRef = useRef('');
  const [singleModalLayout, setSingleModalLayout] = useState(null);
  const [combinedModalLayout, setCombinedModalLayout] = useState(null);
  const [allCombinedModalLayout, setAllCombinedModalLayout] = useState(null);
  const [showAllCombinedModal, setShowAllCombinedModal] = useState(false);
  const [viewModalBackdropOpacity, setViewModalBackdropOpacity] = useState(0.15);
  const [viewModalTableVisible, setViewModalTableVisible] = useState(true);
  const singleDragRef = useRef({ wasDragged: false, wasResized: false });
  const combinedDragRef = useRef({ wasDragged: false, wasResized: false });
  const allCombinedDragRef = useRef({ wasDragged: false, wasResized: false });

  const selectedCurve = savedCurves.find((curve) => curve.id === selectedCurveId);

  useLayoutEffect(() => {
    const graphId = String(new URLSearchParams(window.location.search).get('graph_id') || '').trim();
    if (!graphId) return;

    const persistedContext = getPersistedGraphContext(graphId);
    const persistedArea = normalizePersistedGraphArea(persistedContext?.graphArea);
    const axisConfirmed = hasPersistedMappingContext(persistedContext);

    if (persistedArea) {
      setCaptureGraphArea(persistedArea);
      if (axisConfirmed) {
        const persistedPlotRef = resolvePersistedPlotReferenceArea(persistedContext, imageSizeRef.current);
        restorePlotReferenceArea(persistedPlotRef, { locked: true });
      }
    }
    if (persistedContext?.axis && hasValidAxisMapping(persistedContext.axis)) {
      setGraphConfig((prev) => ({
        ...prev,
        xScale: persistedContext.axis.xScale || prev.xScale,
        yScale: persistedContext.axis.yScale || prev.yScale,
        xUnitPrefix: persistedContext.axis.xUnitPrefix || prev.xUnitPrefix,
        yUnitPrefix: persistedContext.axis.yUnitPrefix || prev.yUnitPrefix,
        xMin: persistedContext.axis.xMin ?? prev.xMin,
        xMax: persistedContext.axis.xMax ?? prev.xMax,
        yMin: persistedContext.axis.yMin ?? prev.yMin,
        yMax: persistedContext.axis.yMax ?? prev.yMax,
        xLabel: persistedContext.axis.xLabel ?? prev.xLabel,
        yLabel: persistedContext.axis.yLabel ?? prev.yLabel,
      }));
    }
    if (axisConfirmed) {
      setIsAxisMappingConfirmed(true);
      setFrozenGraphConfig((prev) => prev || { ...persistedContext.axis });
      const persistedPlotRef = resolvePersistedPlotReferenceArea(persistedContext, imageSizeRef.current);
      lockPlotReference(persistedPlotRef);
    }

    const cachedImage = getValidatedPersistedGraphImage(graphId);
    if (cachedImage) {
      suppressNextImageSessionResetRef.current = true;
      setUploadedImage(cachedImage);
    }

    const persistedCurves = getPersistedSavedCurves(graphId);
    if (persistedCurves?.curves?.length > 0) {
      setSavedCurves(persistedCurves.curves);
      setSavedCurvesSource(persistedCurves.source || 'company');
      if (axisConfirmed) {
        setShowCaptureAnotherGuidance(true);
      }
    }

    if (cachedImage || persistedCurves?.curves?.length > 0) {
      autoLoadedGraphIdRef.current = graphId;
    }
  }, [setCaptureGraphArea, setGraphConfig, setUploadedImage, restorePlotReferenceArea, lockPlotReference]);

  const uniqueSavedCurves = useMemo(() => {
    if (!Array.isArray(savedCurves)) return [];
    return dedupeCurves(savedCurves);
  }, [savedCurves]);

  const allowNextCurveNameEntry = useMemo(() => {
    if (!isAxisMappingConfirmed || editingCurveId) return false;
    if (showCaptureAnotherGuidance) return true;
    return savedCurves.length > 0 && !String(graphConfig.curveName || '').trim();
  }, [
    isAxisMappingConfirmed,
    editingCurveId,
    showCaptureAnotherGuidance,
    savedCurves.length,
    graphConfig.curveName,
  ]);

  const groupedCurves = useMemo(() => {
    const uniqueCurves = uniqueSavedCurves;
    const groups = new Map();

    uniqueCurves.forEach((curve, index) => {
      const imageUrl = curve.graphImageUrl ?? curve.graph_img ?? '';
      const graphIdKey = curve.graphId ? `graphId_${String(curve.graphId)}` : '';
      const groupId = graphIdKey || curve.graphGroupId || buildGraphGroupId(imageUrl) || `graph_${index}`;
      const existing = groups.get(groupId) || {
        id: groupId,
        imageUrl,
        curves: [],
      };
      existing.curves.push(curve);
      groups.set(groupId, existing);
    });

    return Array.from(groups.values());
  }, [uniqueSavedCurves]);

  const allScaleGroupedCurves = useMemo(() => {
    const groups = new Map();
    uniqueSavedCurves.forEach((curve, index) => {
      const xScale = curve?.config?.xScale || curve?.x_scale || 'Linear';
      const yScale = curve?.config?.yScale || curve?.y_scale || 'Linear';
      const key = `${xScale}__${yScale}`;
      const existing = groups.get(key) || {
        id: key,
        xScale,
        yScale,
        curves: [],
      };
      existing.curves.push(curve);
      groups.set(key, existing);
    });

    return Array.from(groups.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [uniqueSavedCurves]);

  const selectedGroup = groupedCurves.find((group) => group.id === combinedGroupId);
  const selectedCurvePoints = selectedCurve?.points ?? selectedCurve?.data_points ?? [];
  // Page B: saved curves exist. Page A: upload-only until user confirms capture (not while pending AI image).
  const showCaptureWorkspace =
    savedCurves.length > 0 ||
    (Boolean(uploadedImage) && !hasPendingCaptureChoice && !restoredPendingCapture?.imageBase64);
  const hasTemperatureInOtherSymbols = isTemperatureSymbol(urlParams.other_symbols);
  const shouldShowTemperatureInput =
    (urlParams.tctj !== '0' || hasTemperatureInOtherSymbols) &&
    !hasImplicitTemperatureContext(
      urlParams.x_label,
      urlParams.y_label,
      graphConfig.curveName,
      urlParams.curve_title,
    );

  const unitOptions = [
    { value: '1e-12', label: 'pico (p) = 1e-12' },
    { value: '1e-9', label: 'nano (n) = 1e-9' },
    { value: '1e-6', label: 'micro (μ) = 1e-6' },
    { value: '1e-3', label: 'milli (m) = 1e-3' },
    { value: '1', label: '1' },
    { value: '1e3', label: 'Kilo (k) = 1e3' },
    { value: '1e6', label: 'Mega (M) = 1e6' },
    { value: '1e9', label: 'Giga (G) = 1e9' },
    { value: '1e12', label: 'Tera (T) = 1e12' },
  ];

  const getUnitLabel = (unitValue) => {
    if (!unitValue) return '';
    const option = unitOptions.find((opt) => opt.value === String(unitValue));
    return option ? option.label : String(unitValue);
  };

  const normalizeCurveSymbolValues = (curve) => {
    if (curve?.symbolValues && typeof curve.symbolValues === 'object') {
      return { ...curve.symbolValues };
    }

    const rawTctj = curve?.config?.temperature ?? curve?.temperature ?? curve?.tctj;
    if (rawTctj && typeof rawTctj === 'object' && !Array.isArray(rawTctj)) {
      return { ...rawTctj };
    }

    if (rawTctj !== undefined && rawTctj !== null && rawTctj !== '') {
      return parseSymbolValuesFromText(rawTctj, symbolNames);
    }

    return { ...symbolValues };
  };

  const getSymbolDisplayLabel = (symbolKey) => {
    const rawLabel = symbolLabels[symbolKey] || symbolKey;
    return stripDfPrefixForDisplay(rawLabel);
  };

  const visibleSymbolNames = (Array.isArray(symbolNames) ? symbolNames : []).filter(
    (symbol) => !isTemperatureSymbol(symbol, getSymbolDisplayLabel(symbol))
  );

  const getCurveSymbolMetadataEntries = (curve) => {
    const values = normalizeCurveSymbolValues(curve);
    const orderedKeys = Array.from(
      new Set([...(Array.isArray(symbolNames) ? symbolNames : []), ...Object.keys(values || {})].filter(Boolean))
    );

    return orderedKeys
      .map((key) => ({
        key,
        label: getSymbolDisplayLabel(key),
        value: resolveSymbolValue(values, key, orderedKeys),
      }))
      .filter((entry) => entry.value !== '');
  };

  const resolveAxisValue = (...values) => {
    for (const candidate of values) {
      if (isValidSymbolValue(candidate)) {
        return String(candidate).trim();
      }
    }
    return '';
  };

  const getPersistedGraphImage = (graphId) => {
    const normalizedGraphId = String(graphId || '').trim();
    if (!normalizedGraphId) return '';

    try {
      return String(localStorage.getItem(`graph_image_${normalizedGraphId}`) || '');
    } catch (error) {
      console.warn('[DEBUG] Failed to read persisted graph image:', error);
      return '';
    }
  };

  const persistGraphImage = (graphId, imageUrl) => {
    const normalizedGraphId = String(graphId || '').trim();
    const normalizedImage = String(imageUrl || '').trim();
    if (!normalizedGraphId || !normalizedImage) return;
    // Only cache embeddable images. DiscoverEE filename URLs often 404 and should not be cached.
    if (!isEmbeddedGraphImage(normalizedImage)) return;
    if (normalizedImage.length > MAX_PERSISTED_GRAPH_IMAGE_CHARS) {
      console.warn('[DEBUG] Graph image too large for localStorage cache; skipping persist for graph_id:', normalizedGraphId);
      return;
    }

    try {
      localStorage.setItem(`graph_image_${normalizedGraphId}`, normalizedImage);
      // console.log('[DEBUG] Persisted graph image for graph_id:', normalizedGraphId);
    } catch (error) {
      console.warn('[DEBUG] Failed to persist graph image:', error);
    }
  };

  const resolveSavedPartNumber = (...candidates) => {
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }
    return '';
  };

  const buildCurveConfigFromSaved = (curve, prevConfig = {}, persistedAxis = null, { preferPersistedAxis = false } = {}) => {
    const xMinSources = preferPersistedAxis
      ? [persistedAxis?.xMin, curve.config?.xMin, curve.x_min, prevConfig.xMin]
      : [curve.config?.xMin, curve.x_min, persistedAxis?.xMin, prevConfig.xMin];
    const xMaxSources = preferPersistedAxis
      ? [persistedAxis?.xMax, curve.config?.xMax, curve.x_max, prevConfig.xMax]
      : [curve.config?.xMax, curve.x_max, persistedAxis?.xMax, prevConfig.xMax];
    const yMinSources = preferPersistedAxis
      ? [persistedAxis?.yMin, curve.config?.yMin, curve.y_min, prevConfig.yMin]
      : [curve.config?.yMin, curve.y_min, persistedAxis?.yMin, prevConfig.yMin];
    const yMaxSources = preferPersistedAxis
      ? [persistedAxis?.yMax, curve.config?.yMax, curve.y_max, prevConfig.yMax]
      : [curve.config?.yMax, curve.y_max, persistedAxis?.yMax, prevConfig.yMax];

    return {
      graphTitle: curve.config?.graphTitle || curve.graph_title || prevConfig.graphTitle || '',
      curveName: curve.config?.curveName || curve.curve_name || curve.name || prevConfig.curveName || '',
      partNumber: curve.config?.partNumber || curve.part_number || prevConfig.partNumber || '',
      xScale: preferPersistedAxis
        ? (persistedAxis?.xScale || curve.config?.xScale || curve.x_scale || prevConfig.xScale || 'Linear')
        : (curve.config?.xScale || curve.x_scale || persistedAxis?.xScale || prevConfig.xScale || 'Linear'),
      yScale: preferPersistedAxis
        ? (persistedAxis?.yScale || curve.config?.yScale || curve.y_scale || prevConfig.yScale || 'Linear')
        : (curve.config?.yScale || curve.y_scale || persistedAxis?.yScale || prevConfig.yScale || 'Linear'),
      xUnitPrefix: preferPersistedAxis
        ? (persistedAxis?.xUnitPrefix || curve.config?.xUnitPrefix || curve.x_unit || prevConfig.xUnitPrefix || '1')
        : (curve.config?.xUnitPrefix || curve.x_unit || persistedAxis?.xUnitPrefix || prevConfig.xUnitPrefix || '1'),
      yUnitPrefix: preferPersistedAxis
        ? (persistedAxis?.yUnitPrefix || curve.config?.yUnitPrefix || curve.y_unit || prevConfig.yUnitPrefix || '1')
        : (curve.config?.yUnitPrefix || curve.y_unit || persistedAxis?.yUnitPrefix || prevConfig.yUnitPrefix || '1'),
      xMin: resolveAxisValue(...xMinSources),
      xMax: resolveAxisValue(...xMaxSources),
      yMin: resolveAxisValue(...yMinSources),
      yMax: resolveAxisValue(...yMaxSources),
      xLabel: preferPersistedAxis
        ? (persistedAxis?.xLabel || curve.config?.xLabel || curve.x_label || prevConfig.xLabel || '')
        : (curve.config?.xLabel || curve.x_label || persistedAxis?.xLabel || prevConfig.xLabel || ''),
      yLabel: preferPersistedAxis
        ? (persistedAxis?.yLabel || curve.config?.yLabel || curve.y_label || prevConfig.yLabel || '')
        : (curve.config?.yLabel || curve.y_label || persistedAxis?.yLabel || prevConfig.yLabel || ''),
      temperature: curve.config?.temperature || curve.temperature || prevConfig.temperature || '',
    };
  };

  const restoreGraphDisplayFromSavedCurve = (curve, graphId, { keepCurveNameEmpty = false, allCurves = null, loadPoints = true, graphAreaOverride = null } = {}) => {
    const persistedContext = getPersistedGraphContext(graphId);
    const persistedAxis = persistedContext?.axis;
    const restoredArea =
      normalizePersistedGraphArea(graphAreaOverride) ||
      normalizePersistedGraphArea(persistedContext?.graphArea);
    const mappingConfirmed = hasPersistedMappingContext(persistedContext);
    let nextConfig = buildCurveConfigFromSaved(curve, graphConfig, persistedAxis, {
      preferPersistedAxis: mappingConfirmed,
    });
    const curveList = Array.isArray(allCurves) && allCurves.length > 0 ? allCurves : [curve];
    const apiAxisPatch = buildGraphConfigAxisPatch(
      resolveDiscovereeAxisFields({}, normalizeCurveConfigFields(curveList[0]))
    );
    if (Object.keys(apiAxisPatch).length > 0 && !mappingConfirmed) {
      nextConfig = { ...nextConfig, ...apiAxisPatch };
    }

    if (!mappingConfirmed) {
      nextConfig = applyComputedAxisBounds(nextConfig, curveList);
    }

    if (restoredArea) {
      setCaptureGraphArea(restoredArea);
      if (hasPersistedMappingContext(persistedContext)) {
        const persistedPlotRef = resolvePersistedPlotReferenceArea(persistedContext, imageSizeRef.current);
        restorePlotReferenceArea(persistedPlotRef, { locked: true });
      }
    }
    // When no persisted area exists, keep the current box so GraphCanvas can show the default immediately.

    setGraphConfig((prev) => ({
      ...prev,
      ...nextConfig,
      ...(keepCurveNameEmpty ? { curveName: '' } : {}),
    }));

    const loadedPoints =
      Array.isArray(curve?.points) && curve.points.length > 0
        ? curve.points
          .map((point) => ({
            x: Number(point.x_value ?? point.x),
            y: Number(point.y_value ?? point.y),
            imported: true,
            overlayCurveId: String(curve?.id ?? curve?.detailId ?? 'saved'),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        : [];

    if (loadPoints) {
      replaceDataPoints(loadedPoints);
    }

    if (mappingConfirmed) {
      setIsAxisMappingConfirmed(true);
      setFrozenGraphConfig({
        ...nextConfig,
        ...(persistedAxis && hasUsableAxisMapping(persistedAxis) ? persistedAxis : {}),
      });
      if (restoredArea) {
        const persistedPlotRef = resolvePersistedPlotReferenceArea(persistedContext, imageSizeRef.current);
        lockPlotReference(persistedPlotRef);
      }
    } else {
      setIsAxisMappingConfirmed(false);
      setFrozenGraphConfig(null);
    }

    return { nextConfig, loadedPoints, mappingConfirmed };
  };

  const resolveGraphImageUrl = (graph = {}, details = [], graphId = '') => {
    const candidates = collectGraphImageCandidates({
      graph,
      details,
      graphId,
      restoredPending: restoredPendingImageRef.current,
      persistedGraphImage: getValidatedPersistedGraphImage(graphId),
    });

    for (const candidate of candidates) {
      if (isEmbeddedGraphImage(candidate)) {
        return candidate;
      }
      const urlCandidates = buildDiscovereeGraphImageUrlCandidates(candidate, graph);
      if (urlCandidates.length > 0) {
        return urlCandidates[0];
      }
    }

    return '';
  };

  const resolveReachableGraphImageUrl = async (graph = {}, details = [], graphId = '', extras = {}) => {
    const backendMirroredImage =
      extras.backendMirroredImage ??
      (extras.fetchBackendMirror === false
        ? ''
        : await fetchMirroredGraphImageFromBackend(extras.apiUrl || '', graphId));

    const candidates = collectGraphImageCandidates({
      graph,
      details,
      graphId,
      restoredPending: extras.restoredPending ?? restoredPendingImageRef.current,
      localGraphImage: extras.localGraphImage ?? '',
      persistedGraphImage: extras.persistedGraphImage ?? getValidatedPersistedGraphImage(graphId),
      backendMirroredImage,
    });

    return resolveFirstReachableImageUrl(candidates);
  };

  const handleViewCurve = (curve) => {
    setCombinedGroupId('');
    setShowAllCombinedModal(false);
    setSingleModalLayout(null);
    setCombinedModalLayout(null);
    setAllCombinedModalLayout(null);
    setSelectedCurveId(curve.id);
    setViewModalTableVisible(true);

    const graphId = String(curve.graphId || getGraphIdForCurve(curve) || urlParams.graph_id || '').trim();
    const curvesForGraph = savedCurves.filter(
      (savedCurve) => String(savedCurve.graphId || graphId) === graphId
    );

    if (curve.graphImageUrl && curve.graphImageUrl !== uploadedImage) {
      setUploadedImageFromExistingGraph(curve.graphImageUrl);
    }

    const liveGraphArea =
      graphArea.width > 0 && graphArea.height > 0
        ? {
            x: graphArea.x,
            y: graphArea.y,
            width: graphArea.width,
            height: graphArea.height,
          }
        : null;

    restoreGraphDisplayFromSavedCurve(curve, graphId, {
      allCurves: curvesForGraph.length > 0 ? curvesForGraph : [curve],
      graphAreaOverride: liveGraphArea,
    });

    const curveSymbols = normalizeCurveSymbolValues(curve);
    if (Object.keys(curveSymbols).length > 0) {
      setSymbolValues((prev) => ({ ...prev, ...curveSymbols }));
    }
    
    setIsReadOnly(true);
  };

  const applyCombinedGraphOverlay = (curves) => {
    const curveList = Array.isArray(curves) ? curves.filter(Boolean) : [];
    if (curveList.length === 0) return;

    const referenceCurve = curveList[0];
    const graphId = String(referenceCurve.graphId || getGraphIdForCurve(referenceCurve) || urlParams.graph_id || '').trim();

    const liveGraphArea =
      graphArea.width > 0 && graphArea.height > 0
        ? {
            x: graphArea.x,
            y: graphArea.y,
            width: graphArea.width,
            height: graphArea.height,
          }
        : null;

    if (referenceCurve.graphImageUrl && referenceCurve.graphImageUrl !== uploadedImage) {
      setUploadedImageFromExistingGraph(referenceCurve.graphImageUrl);
    }

    restoreGraphDisplayFromSavedCurve(referenceCurve, graphId, {
      allCurves: curveList,
      keepCurveNameEmpty: true,
      loadPoints: false,
      graphAreaOverride: liveGraphArea,
    });
    replaceDataPoints(buildCombinedOverlayPoints(curveList));
    setIsReadOnly(true);
  };

  const clearSavedViewOverlay = () => {
    clearDataPoints();
    setIsReadOnly(false);
  };

  const handleViewCombinedGroup = (group) => {
    setSelectedCurveId('');
    setShowAllCombinedModal(false);
    setSingleModalLayout(null);
    setCombinedModalLayout(null);
    setAllCombinedModalLayout(null);
    setCombinedGroupId(group.id);
    applyCombinedGraphOverlay(group.curves);
  };

  const handleExportGroupToTC = (group) => {
    const curves = Array.isArray(group?.curves) ? group.curves.filter(Boolean) : [];
    if (curves.length === 0) {
      alert('No saved curves to export.');
      return;
    }

    const graphId = String(urlParams.graph_id || activeSessionGraphIdRef.current || '').trim();
    const exportOptions = { persistedAxis: getPersistedGraphContext(graphId)?.axis || null };
    if (!isSavedCurvesExportReady(curves, graphConfig, exportOptions)) {
      alert('Setup required before exporting .tc: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    try {
      const exportConfig = resolveExportGraphConfig(curves, graphConfig, exportOptions);
      const source = inferTypicalCurveExportSourceFromCurves(curves, savedCurvesSource);
      const tcObject = buildTypicalCurveExportFromSavedCurves({
        template: lineSingleTemplate,
        graphConfig: exportConfig,
        curves,
      });
      const filename = buildTypicalCurveFilenameForGraph(exportConfig, source, curves.length);
      downloadTypicalCurveFile(filename, tcObject);
    } catch (error) {
      console.error('Failed to export saved curves to .tc:', error);
      alert(`Failed to export .tc file: ${error.message}`);
    }
  };

  const handleExportAllSavedCurvesToTC = () => {
    if (uniqueSavedCurves.length === 0) {
      alert('No saved curves to export.');
      return;
    }
    if (groupedCurves.length === 1) {
      handleExportGroupToTC(groupedCurves[0]);
      return;
    }

    const graphId = String(urlParams.graph_id || activeSessionGraphIdRef.current || '').trim();
    const exportOptions = { persistedAxis: getPersistedGraphContext(graphId)?.axis || null };
    const readyGroups = groupedCurves.filter((group) => isSavedCurvesExportReady(group.curves, graphConfig, exportOptions));
    if (readyGroups.length === 0) {
      alert('Setup required before exporting .tc: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    readyGroups.forEach((group) => handleExportGroupToTC(group));
  };

  const getSavedCurvesExportOptions = () => {
    const graphId = String(urlParams.graph_id || activeSessionGraphIdRef.current || '').trim();
    return {
      persistedAxis: getPersistedGraphContext(graphId)?.axis || null,
      partNumber: urlParams.partno || graphConfig.partNumber || '',
    };
  };

  const handleDownloadCurve = (curve) => {
    if (!curve) {
      alert('No saved curve to export.');
      return;
    }

    const exportOptions = getSavedCurvesExportOptions();
    if (!isSavedCurvesExportReady([curve], graphConfig, exportOptions)) {
      alert('Setup required before downloading: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    try {
      exportSingleSavedCurveDownloads(curve, graphConfig, exportOptions);
    } catch (error) {
      console.error('Failed to download curve export:', error);
      alert(`Failed to download curve file: ${error.message}`);
    }
  };

  const handleExportGroupToCSV = (group) => {
    const curves = Array.isArray(group?.curves) ? group.curves.filter(Boolean) : [];
    if (curves.length === 0) {
      alert('No saved curves to export.');
      return;
    }

    const exportOptions = getSavedCurvesExportOptions();
    if (!isSavedCurvesExportReady(curves, graphConfig, exportOptions)) {
      alert('Setup required before exporting CSV: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    try {
      exportSavedCurvesToCsv(curves, graphConfig, exportOptions);
    } catch (error) {
      console.error('Failed to export saved curves to CSV:', error);
      alert(`Failed to export CSV file: ${error.message}`);
    }
  };

  const handleExportGroupToJSON = (group) => {
    const curves = Array.isArray(group?.curves) ? group.curves.filter(Boolean) : [];
    if (curves.length === 0) {
      alert('No saved curves to export.');
      return;
    }

    const exportOptions = getSavedCurvesExportOptions();
    if (!isSavedCurvesExportReady(curves, graphConfig, exportOptions)) {
      alert('Setup required before exporting JSON: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    try {
      exportSavedCurvesToJson(curves, graphConfig, exportOptions);
    } catch (error) {
      console.error('Failed to export saved curves to JSON:', error);
      alert(`Failed to export JSON file: ${error.message}`);
    }
  };

  const handleExportAllSavedCurvesToCSV = () => {
    if (uniqueSavedCurves.length === 0) {
      alert('No saved curves to export.');
      return;
    }
    if (groupedCurves.length === 1) {
      handleExportGroupToCSV(groupedCurves[0]);
      return;
    }

    const exportOptions = getSavedCurvesExportOptions();
    const readyGroups = groupedCurves.filter((group) =>
      isSavedCurvesExportReady(group.curves, graphConfig, exportOptions)
    );
    if (readyGroups.length === 0) {
      alert('Setup required before exporting CSV: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    readyGroups.forEach((group) => handleExportGroupToCSV(group));
  };

  const handleExportAllSavedCurvesToJSON = () => {
    if (uniqueSavedCurves.length === 0) {
      alert('No saved curves to export.');
      return;
    }
    if (groupedCurves.length === 1) {
      handleExportGroupToJSON(groupedCurves[0]);
      return;
    }

    const exportOptions = getSavedCurvesExportOptions();
    const readyGroups = groupedCurves.filter((group) =>
      isSavedCurvesExportReady(group.curves, graphConfig, exportOptions)
    );
    if (readyGroups.length === 0) {
      alert('Setup required before exporting JSON: confirm axis mapping with X/Y min, max, scale, and unit in Graph Setup.');
      return;
    }

    readyGroups.forEach((group) => handleExportGroupToJSON(group));
  };

  const handleViewAllCombinedGraphs = () => {
    setSelectedCurveId('');
    setCombinedGroupId('');
    setSingleModalLayout(null);
    setCombinedModalLayout(null);
    setAllCombinedModalLayout(null);
    setShowAllCombinedModal(true);
    applyCombinedGraphOverlay(uniqueSavedCurves);
  };

  const handleEditCurveStart = (curve) => {
    // console.log('[GRAPH SESSION] handleEditCurveStart', {
    //   curveId: curve.id,
    //   curveGraphId: curve.graphId || '',
    //   sessionActive: hasActiveAppendSessionRef.current,
    //   sessionGraphId: activeSessionGraphIdRef.current || '',
    // });
    setSelectedCurveId('');
    setCombinedGroupId('');
    setShowAllCombinedModal(false);
    const graphId = String(curve.graphId || getGraphIdForCurve(curve) || urlParams.graph_id || '').trim();
    const curvesForGraph = savedCurves.filter(
      (savedCurve) => String(savedCurve.graphId || graphId) === graphId
    );

    const liveGraphArea =
      graphArea.width > 0 && graphArea.height > 0
        ? {
            x: graphArea.x,
            y: graphArea.y,
            width: graphArea.width,
            height: graphArea.height,
          }
        : null;

    const nextImage = curve.graphImageUrl || '';
    if (nextImage && nextImage !== uploadedImage) {
      setUploadedImageFromExistingGraph(nextImage);
    }

    const { nextConfig } = restoreGraphDisplayFromSavedCurve(curve, graphId, {
      allCurves: curvesForGraph.length > 0 ? curvesForGraph : [curve],
      graphAreaOverride: liveGraphArea,
    });

    if (hasUsableAxisMapping(nextConfig)) {
      setIsAxisMappingConfirmed(true);
      setFrozenGraphConfig({ ...nextConfig });
      const areaToPersist =
        normalizePersistedGraphArea(liveGraphArea) ||
        normalizePersistedGraphArea(getPersistedGraphContext(graphId)?.graphArea);
      if (graphId && areaToPersist) {
        persistGraphContext(graphId, areaToPersist, nextConfig);
      }
    }

    setIsReadOnly(false);

    const sessionAxisBounds = resolveAxisBoundFields({
      xMin: nextConfig.xMin ?? curve.config?.xMin ?? curve.x_min ?? graphConfig.xMin,
      xMax: nextConfig.xMax ?? curve.config?.xMax ?? curve.x_max ?? graphConfig.xMax,
      yMin: nextConfig.yMin ?? curve.config?.yMin ?? curve.y_min ?? graphConfig.yMin,
      yMax: nextConfig.yMax ?? curve.config?.yMax ?? curve.y_max ?? graphConfig.yMax,
    });
    editSessionAxisRef.current = sessionAxisBounds;

    setEditingCurveId(curve.id);
    setEditCurveMeta({
      xScale: nextConfig.xScale,
      yScale: nextConfig.yScale,
      xUnitPrefix: nextConfig.xUnitPrefix,
      yUnitPrefix: nextConfig.yUnitPrefix,
      xMin: String(sessionAxisBounds.xMin ?? ''),
      xMax: String(sessionAxisBounds.xMax ?? ''),
      yMin: String(sessionAxisBounds.yMin ?? ''),
      yMax: String(sessionAxisBounds.yMax ?? ''),
    });
    setEditCurveSymbolValues(normalizeCurveSymbolValues(curve));
    setEditCurveName(curve.config?.curveName || curve.curve_name || curve.name || '');
    const graphIdForEdit = String(curve.graphId || getGraphIdForCurve(curve) || urlParams.graph_id || '').trim();
    const siblingCurves = savedCurves.filter(
      (savedCurve) => String(savedCurve.graphId || getGraphIdForCurve(savedCurve) || '') === graphIdForEdit
    );
    const partNumberFromSiblings = siblingCurves
      .map((savedCurve) => resolveSavedPartNumber(savedCurve.part_number, savedCurve.config?.partNumber))
      .find(Boolean);
    setEditPartNumber(
      resolveSavedPartNumber(
        curve.part_number,
        curve.config?.partNumber,
        partNumberFromSiblings,
        graphConfig.partNumber,
        urlParams.partno
      )
    );
  };

  const handleEditAxisBoundChange = (field, value) => {
    setEditCurveMeta((prev) => ({ ...prev, [field]: value }));
    setGraphConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditCurveCancel = () => {
    if (editSessionAxisRef.current) {
      setGraphConfig((prev) => ({
        ...prev,
        ...editSessionAxisRef.current,
      }));
    }
    editSessionAxisRef.current = null;
    setEditingCurveId('');
    setEditCurveSymbolValues({});
    setEditCurveName('');
    setEditPartNumber('');
    clearDataPoints();
  };

  const getTctjValueFromSymbols = (symbols = {}, fallback = '') => {
    if (!symbols || typeof symbols !== 'object') {
      return fallback || '';
    }

    return buildDynamicSymbolPayload(symbols, symbolLabels, symbolNames, fallback).legacyTctjValue || fallback || '';
  };

  const haveSymbolValuesChanged = (currentValues = {}, nextValues = {}, preferredKeys = []) => {
    const keys = Array.from(
      new Set([
        ...(Array.isArray(preferredKeys) ? preferredKeys : []),
        ...Object.keys(currentValues || {}),
        ...Object.keys(nextValues || {}),
      ].filter(Boolean))
    );

    return keys.some((key) => String(currentValues?.[key] || '') !== String(nextValues?.[key] || ''));
  };

  const getGraphDynamicFieldValues = (symbolPayload = {}) => {
    if (!symbolPayload || typeof symbolPayload !== 'object') {
      return {};
    }

    // Never allow runtime symbol keys to override core graph API fields.
    const reservedGraphKeys = new Set([
      'graph_id',
      'discoveree_cat_id',
      'identifier',
      'partno',
      'manf',
      'graph_title',
      'curve_title',
      'x_title',
      'y_title',
      'graph_img',
      'mark_review',
      'testuser_id',
    ]);

    const entries = Object.entries(symbolPayload.symbolValues || {}).filter(
      ([key, value]) =>
        !reservedGraphKeys.has(String(key).trim().toLowerCase()) &&
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
    );

    return Object.fromEntries(entries.map(([key, value]) => [key, String(value).trim()]));
  };

  const normalizePointsForComparison = (points = []) =>
    (Array.isArray(points) ? points : [])
      .map((point) => ({
        x: Number(point?.x_value ?? point?.x),
        y: Number(point?.y_value ?? point?.y),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  const getEditCurveDataPoints = (curve, points = dataPoints) => {
    const curveKeys = new Set(
      [curve?.id, curve?.detailId, curve?.detail_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const allPoints = Array.isArray(points) ? points : [];
    if (curveKeys.size === 0) {
      return allPoints;
    }
    const hasOverlayIds = allPoints.some((point) => point?.overlayCurveId);
    if (!hasOverlayIds) {
      return allPoints;
    }
    return allPoints.filter((point) => {
      const overlayId = String(point?.overlayCurveId || '').trim();
      if (!overlayId) return true;
      if (overlayId === MANUAL_CAPTURE_OVERLAY_ID) return true;
      return curveKeys.has(overlayId);
    });
  };

  const havePointsChanged = (originalPoints = [], nextPoints = []) => {
    if (originalPoints.length !== nextPoints.length) {
      return true;
    }

    return originalPoints.some((point, index) => {
      const nextPoint = nextPoints[index];
      return !nextPoint || point.x !== nextPoint.x || point.y !== nextPoint.y;
    });
  };

  const setUploadedImageFromExistingGraph = (nextImage) => {
    if (!nextImage) return;
    suppressNextImageSessionResetRef.current = true;
    setUploadedImage(nextImage);
  };

  const logGraphImageAvailability = (graphId, imageUrl, source, meta = {}) => {
    const normalizedImage = String(imageUrl || '').trim();
    const hasImage = normalizedImage.length > 0;
    const imagePreview = hasImage
      ? `${normalizedImage.slice(0, 60)}${normalizedImage.length > 60 ? '...' : ''}`
      : '(none)';

    const payload = {
      graphId: String(graphId || '').trim() || '(none)',
      source,
      hasImage,
      imageLength: normalizedImage.length,
      imagePreview,
      ...meta,
    };

    if (hasImage) {
      // console.log('[GRAPH_IMAGE] AVAILABLE', payload);
    } else {
      // Missing image is expected for graph IDs that do not exist upstream/local yet.
      console.debug('[GRAPH_IMAGE] MISSING', payload);
    }
  };

  const fetchLocalCurveByDiscovereeId = async ({ graphId = '', discovereeCatId = '' } = {}) => {
    const normalizedGraphId = String(graphId || '').trim();
    const normalizedDiscovereeCatId = String(discovereeCatId || '').trim();
    if (!normalizedGraphId && !normalizedDiscovereeCatId) {
      return null;
    }

    try {
      // First try graph_id lookup for rows created with discoveree_graph_id.
      if (normalizedGraphId) {
        const byGraphResponse = await fetch(
          `${apiUrl}/api/curves/by-graph/${encodeURIComponent(normalizedGraphId)}`
        );
        if (byGraphResponse.ok) {
          const byGraphCurve = await byGraphResponse.json();
          if (byGraphCurve) {
            return byGraphCurve;
          }
        }
      }

      // Fallback to discoveree_cat_id when available and meaningful.
      // If a mapped discoveree_graph_id exists and doesn't match the requested graph_id, skip it.
      if (normalizedDiscovereeCatId && normalizedDiscovereeCatId !== '0') {
        const byDiscovereeResponse = await fetch(
          `${apiUrl}/api/curves/by-discoveree/${encodeURIComponent(normalizedDiscovereeCatId)}`
        );
        if (byDiscovereeResponse.ok) {
          const byDiscovereeCurve = await byDiscovereeResponse.json();
          if (byDiscovereeCurve) {
            const mappedGraphId = String(byDiscovereeCurve?.discoveree_graph_id || '').trim();
            if (!normalizedGraphId || !mappedGraphId || mappedGraphId === normalizedGraphId) {
              return byDiscovereeCurve;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.warn('[DEBUG] Local by-discoveree fallback failed:', error);
      return null;
    }
  };

  const activateAppendSession = (graphId, imageUrl = '', reason = 'unknown') => {
    if (graphId === undefined || graphId === null || String(graphId).trim() === '') {
      return;
    }

    const nextGraphId = String(graphId);
    const previousGraphId = String(activeSessionGraphIdRef.current || '');
    if (previousGraphId && previousGraphId !== nextGraphId) {
      activeSessionIdentifierRef.current = '';
    }
    hasActiveAppendSessionRef.current = true;
    activeSessionGraphIdRef.current = nextGraphId;
    activeSessionImageKeyRef.current = String(
      imageUrl || (previousGraphId === nextGraphId ? activeSessionImageKeyRef.current : '') || ''
    );

    // console.log('[GRAPH SESSION] activated', {
    //   reason,
    //   graphId: nextGraphId,
    //   hasImageContext: Boolean(activeSessionImageKeyRef.current),
    // });
  };

  const getGraphIdForCurve = (curve) => {
    if (curve?.graphId !== undefined && curve?.graphId !== null && String(curve.graphId).trim() !== '') {
      return String(curve.graphId);
    }

    const rawId = String(curve?.id || '');
    if (rawId.includes('_')) {
      const [prefix] = rawId.split('_');
      if (prefix) return prefix;
    }

    if (hasActiveAppendSessionRef.current && activeSessionGraphIdRef.current) {
      return String(activeSessionGraphIdRef.current);
    }

    return urlParams.graph_id ? String(urlParams.graph_id) : '';
  };

  const getDetailIdForCurve = (curve) => {
    if (curve?.detailId !== undefined && curve?.detailId !== null && String(curve.detailId).trim() !== '') {
      return String(curve.detailId);
    }

    if (curve?.detail_id !== undefined && curve?.detail_id !== null && String(curve.detail_id).trim() !== '') {
      return String(curve.detail_id);
    }

    const rawId = String(curve?.id || '');
    if (rawId.includes('_')) {
      const parts = rawId.split('_');
      const suffix = parts[parts.length - 1];
      if (suffix && /^\d+$/.test(suffix)) {
        return suffix;
      }
    }

    if (/^\d+$/.test(rawId)) {
      const graphId = getGraphIdForCurve(curve);
      if (!graphId || String(graphId) !== rawId) {
        return rawId;
      }
    }

    return '';
  };

  const getCurveViewId = (curve) => {
    if (!curve) return '';

    const detailId = getDetailIdForCurve(curve);
    if (detailId && String(detailId) !== '0') {
      return String(detailId);
    }

    if (curve?.discoveree_cat_id !== undefined && curve?.discoveree_cat_id !== null && String(curve.discoveree_cat_id) !== '0') {
      return String(curve.discoveree_cat_id);
    }

    if (curve?.id !== undefined && curve?.id !== null && String(curve.id) !== '0') {
      return String(curve.id);
    }

    return '';
  };

  const triggerGetWithoutCors = (url) =>
    new Promise((resolve) => {
      // Fire-and-forget fallback for endpoints that work in browser URL bar but block fetch via CORS.
      const img = new Image();
      img.onload = () => resolve({ sent: true, via: 'img' });
      img.onerror = () => resolve({ sent: true, via: 'img' });
      img.src = `${url}${url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
    });

  const clearGraphIdContext = () => {
    // console.log('[GRAPH SESSION] clearGraphIdContext', {
    //   previousGraphId: activeSessionGraphIdRef.current || '',
    //   previousSessionActive: hasActiveAppendSessionRef.current,
    // });
    setUrlParams((prev) => ({ ...prev, graph_id: '', identifier: '' }));
    setReturnGraphId('');
    setSelectedCurveId('');
    setCombinedGroupId('');
    hasActiveAppendSessionRef.current = false;
    activeSessionGraphIdRef.current = '';
    activeSessionIdentifierRef.current = '';
    activeSessionImageKeyRef.current = '';
    autoLoadedGraphIdRef.current = '';
    hasAutoScrolledToSavedGraphs.current = false;

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('graph_id');
    currentUrl.searchParams.delete('identifier');
    currentUrl.searchParams.delete('return_graph_id');
    window.history.replaceState({}, '', currentUrl.toString());
  };

  const syncGraphIdContext = (nextGraphId, nextIdentifier = '') => {
    if (!nextGraphId) {
      console.warn('[GRAPH SESSION] syncGraphIdContext called with empty graphId — skipped');
      return;
    }
    const nextId = String(nextGraphId);
    const previousGraphId = String(activeSessionGraphIdRef.current || '');
    const sessionIdentifierForSameGraph =
      previousGraphId && previousGraphId === nextId ? activeSessionIdentifierRef.current : '';
    const normalizedIdentifier = ensureStableGraphIdentifier(
      nextId,
      nextIdentifier || sessionIdentifierForSameGraph || ''
    );
    // console.log('[GRAPH SESSION] syncGraphIdContext', {
    //   nextGraphId: nextId,
    //   nextIdentifier: normalizedIdentifier || '(none)',
    //   previousGraphId: activeSessionGraphIdRef.current || '',
    //   isNewSession: !hasActiveAppendSessionRef.current,
    // });
    activateAppendSession(nextId, uploadedImage || activeSessionImageKeyRef.current || '', 'syncGraphIdContext');
    if (normalizedIdentifier) {
      activeSessionIdentifierRef.current = normalizedIdentifier;
    }
    setUrlParams((prev) => ({
      ...prev,
      graph_id: nextId,
      identifier: normalizedIdentifier || (String(prev.graph_id || '') === nextId ? prev.identifier : '') || '',
    }));
    setReturnGraphId(nextId);

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('graph_id', nextId);
    if (normalizedIdentifier) {
      currentUrl.searchParams.set('identifier', normalizedIdentifier);
    } else {
      currentUrl.searchParams.delete('identifier');
    }
    window.history.replaceState({}, '', currentUrl.toString());
  };

  const syncAxisTitleContext = (nextXTitle, nextYTitle) => {
    const normalizedXTitle = String(nextXTitle || '').trim();
    const normalizedYTitle = String(nextYTitle || '').trim();
    if (!normalizedXTitle && !normalizedYTitle) {
      return;
    }

    setUrlParams((prev) => ({
      ...prev,
      x_label: normalizedXTitle || prev.x_label,
      y_label: normalizedYTitle || prev.y_label,
    }));

    if (normalizedXTitle) {
      setIsXTitleUrlLocked(true);
    }
    if (normalizedYTitle) {
      setIsYTitleUrlLocked(true);
    }

    const currentUrl = new URL(window.location.href);
    if (normalizedXTitle) {
      currentUrl.searchParams.set('x_title', normalizedXTitle);
    }
    if (normalizedYTitle) {
      currentUrl.searchParams.set('y_title', normalizedYTitle);
    }
    window.history.replaceState({}, '', currentUrl.toString());
  };

  useEffect(() => {
    const nextImage = uploadedImage || '';
    const sessionImageKey = activeSessionImageKeyRef.current || previousUploadedImageRef.current || '';

    if (suppressNextImageSessionResetRef.current) {
      suppressNextImageSessionResetRef.current = false;
      previousUploadedImageRef.current = nextImage;
      return;
    }

    if (
      hasActiveAppendSessionRef.current &&
      nextImage &&
      savedCurves.length > 0 &&
      sessionImageKey &&
      nextImage !== sessionImageKey
    ) {
      // console.log('[GRAPH SESSION] resetting after user changed image', {
      //   previousGraphId: activeSessionGraphIdRef.current,
      //   sessionImageKey: sessionImageKey || '(none — old graph had no image)',
      // });
      clearGraphIdContext();
    }

    previousUploadedImageRef.current = nextImage;
  }, [uploadedImage, savedCurves.length]);

  const pushEditedCurveToApi = async (curve, nextMeta, nextSymbols, newCurveName = '', options = {}) => {
    const {
      pointsOverride = null,
      axisBoundsOverride = null,
      axisBaseline = null,
      isCompanionAxisSync = false,
      partNumberOverride = undefined,
    } = options;
    const currentSymbolPayload = buildDynamicSymbolPayload(
      normalizeCurveSymbolValues(curve),
      symbolLabels,
      symbolNames,
      resolveTemperatureForSave(curve?.config?.temperature || curve?.temperature || '', false)
    );
    const nextSymbolPayload = buildDynamicSymbolPayload(
      nextSymbols,
      symbolLabels,
      symbolNames,
      resolveTemperatureForSave(curve?.config?.temperature || curve?.temperature || '', false)
    );
    const tctjValue = nextSymbolPayload.legacyTctjValue;
    const currentPoints = normalizePointsForComparison(curve?.points);
    const nextPoints = pointsOverride !== null
      ? normalizePointsForComparison(pointsOverride)
      : normalizePointsForComparison(getEditCurveDataPoints(curve, dataPoints));
    const currentMeta = {
      xScale: curve.config?.xScale || curve.x_scale || 'Linear',
      yScale: curve.config?.yScale || curve.y_scale || 'Linear',
      xUnitPrefix: curve.config?.xUnitPrefix || curve.x_unit || '1',
      yUnitPrefix: curve.config?.yUnitPrefix || curve.y_unit || '1',
    };
    const currentAxisBounds = resolveAxisBoundFields(
      axisBaseline || curve.config || curve || graphConfig
    );
    const resolvedEditAxis = resolveAxisBoundFields(
      axisBoundsOverride || {
        xMin: nextMeta.xMin ?? graphConfig.xMin ?? curve.config?.xMin ?? curve.x_min,
        xMax: nextMeta.xMax ?? graphConfig.xMax ?? curve.config?.xMax ?? curve.x_max,
        yMin: nextMeta.yMin ?? graphConfig.yMin ?? curve.config?.yMin ?? curve.y_min,
        yMax: nextMeta.yMax ?? graphConfig.yMax ?? curve.config?.yMax ?? curve.y_max,
      }
    );
    const hasMetaChanges =
      currentMeta.xScale !== nextMeta.xScale ||
      currentMeta.yScale !== nextMeta.yScale ||
      currentMeta.xUnitPrefix !== nextMeta.xUnitPrefix ||
      currentMeta.yUnitPrefix !== nextMeta.yUnitPrefix;
    const hasAxisBoundsChanges = haveAxisBoundsChanged(currentAxisBounds, resolvedEditAxis);
    const hasLegacyTemperatureChange =
      String(currentSymbolPayload.legacyTctjValue || '') !== String(nextSymbolPayload.legacyTctjValue || '');
    const hasSymbolValueChanges = haveSymbolValuesChanged(
      currentSymbolPayload.symbolValues,
      nextSymbolPayload.symbolValues,
      symbolNames
    );
    const hasXyChanges = havePointsChanged(currentPoints, nextPoints);

    const changedPoints = (() => {
      const maxLen = Math.max(currentPoints.length, nextPoints.length);
      const diffs = [];
      for (let i = 0; i < maxLen; i++) {
        const oldPt = currentPoints[i];
        const newPt = nextPoints[i];
        if (!oldPt || !newPt) {
          diffs.push({ index: i, old_x: oldPt?.x ?? null, old_y: oldPt?.y ?? null, new_x: newPt?.x ?? null, new_y: newPt?.y ?? null });
        } else if (oldPt.x !== newPt.x || oldPt.y !== newPt.y) {
          diffs.push({ index: i, old_x: oldPt.x, old_y: oldPt.y, new_x: newPt.x, new_y: newPt.y });
        }
      }
      return diffs;
    })();

    const oldCurveName = String(curve?.config?.curveName || curve?.curve_name || curve?.name || '');
    const hasCurveNameChange = newCurveName !== '' && newCurveName !== oldCurveName;
    const currentPartNumber = resolveSavedPartNumber(
      curve?.part_number,
      curve?.config?.partNumber,
      graphConfig.partNumber,
      urlParams.partno
    );
    const nextPartNumber =
      partNumberOverride !== undefined
        ? String(partNumberOverride || '').trim()
        : currentPartNumber;
    const hasPartNumberChange = nextPartNumber !== currentPartNumber;
    const hasLocalChanges =
      hasMetaChanges ||
      hasAxisBoundsChanges ||
      hasLegacyTemperatureChange ||
      hasXyChanges ||
      hasCurveNameChange ||
      hasPartNumberChange;
    const hasCompanyChanges =
      hasMetaChanges ||
      hasAxisBoundsChanges ||
      hasLegacyTemperatureChange ||
      hasSymbolValueChanges ||
      hasXyChanges ||
      hasCurveNameChange ||
      hasPartNumberChange;

    if (
      !isCompanionAxisSync &&
      !(savedCurvesSource === 'company' ? hasCompanyChanges : hasLocalChanges)
    ) {
      throw new Error('No changes detected to update.');
    }

    if (
      isCompanionAxisSync &&
      !hasAxisBoundsChanges &&
      !hasXyChanges &&
      !hasMetaChanges &&
      !hasSymbolValueChanges &&
      !hasCurveNameChange
    ) {
      return {
        graphId: String(getGraphIdForCurve(curve) || ''),
        detailId: String(getDetailIdForCurve(curve) || ''),
        xyConfirmedOnDiscoveree: true,
        skipped: true,
      };
    }

    if (savedCurvesSource !== 'company') {
      const localCurveId = curve?.id;
      if (!localCurveId) {
        throw new Error('Missing local curve id for update.');
      }

      const localPayload = {};
      if (currentMeta.xScale !== nextMeta.xScale) localPayload.x_scale = nextMeta.xScale;
      if (currentMeta.yScale !== nextMeta.yScale) localPayload.y_scale = nextMeta.yScale;
      if (currentMeta.xUnitPrefix !== nextMeta.xUnitPrefix) localPayload.x_unit = nextMeta.xUnitPrefix;
      if (currentMeta.yUnitPrefix !== nextMeta.yUnitPrefix) localPayload.y_unit = nextMeta.yUnitPrefix;
      if (hasLegacyTemperatureChange) localPayload.temperature = tctjValue;
      if (hasCurveNameChange) localPayload.curve_name = newCurveName;
      if (hasPartNumberChange) localPayload.part_number = nextPartNumber;
      if (hasAxisBoundsChanges) {
        localPayload.x_min = parseFloat(resolvedEditAxis.xMin);
        localPayload.x_max = parseFloat(resolvedEditAxis.xMax);
        localPayload.y_min = parseFloat(resolvedEditAxis.yMin);
        localPayload.y_max = parseFloat(resolvedEditAxis.yMax);
      }
      if (hasXyChanges || pointsOverride !== null) {
        localPayload.data_points = nextPoints.map((point) => ({
          x_value: point.x,
          y_value: point.y,
        }));
      }

      // Always send all symbol values in the payload, not just changed ones
      Object.entries(getGraphDynamicFieldValues(nextSymbolPayload)).forEach(([key, value]) => {
        localPayload[key] = value;
      });

      const localUrl = `${apiUrl}/api/curves/${localCurveId}`;
      console.log('=== EDIT API REQUEST ===', {
        source: 'local',
        url: localUrl,
        method: 'PUT',
        payload: localPayload,
        changed_points: changedPoints,
      });

      const localResponse = await fetch(localUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(localPayload),
      });

      const localRawText = await localResponse.text();
      let localResult = {};
      try {
        localResult = localRawText ? JSON.parse(localRawText) : {};
      } catch {
        localResult = localRawText;
      }
      console.log('=== EDIT API RESPONSE ===', {
        source: 'local',
        url: localUrl,
        status: localResponse.status,
        ok: localResponse.ok,
        rawText: localRawText,
        response: localResult,
      });

      if (!localResponse.ok) {
        throw new Error(`Local API update failed (${localResponse.status})`);
      }

      return;
    }

    const companyGraphId = getGraphIdForCurve(curve);
    if (!companyGraphId) {
      throw new Error('Missing company graph_id for update.');
    }

    const resolvedOldCurveName = String(curve?.config?.curveName || curve?.curve_name || curve?.name || '');
    const resolvedNewCurveName = newCurveName !== '' ? newCurveName : resolvedOldCurveName;
    const resolvedGraphImageForEdit = normalizeImageCandidate(
      curve?.graphImageUrl || curve?.graph_img || uploadedImage || ''
    );
    const resolvedEditMeta = hasMetaChanges
      ? {
          xScale: nextMeta.xScale || currentMeta.xScale || 'Linear',
          yScale: nextMeta.yScale || currentMeta.yScale || 'Linear',
          xUnitPrefix: nextMeta.xUnitPrefix || currentMeta.xUnitPrefix || '1',
          yUnitPrefix: nextMeta.yUnitPrefix || currentMeta.yUnitPrefix || '1',
        }
      : { ...currentMeta };
    const resolvedEditIdentifier = ensureStableGraphIdentifier(
      companyGraphId,
      resolveIdentifierForGraph({
        graphId: companyGraphId,
        curve,
        savedCurves,
        urlParams,
        sessionGraphId: activeSessionGraphIdRef.current,
        sessionIdentifier: activeSessionIdentifierRef.current,
      })
    );
    const resolvedDetailId = getDetailIdForCurve(curve);
    if (!resolvedDetailId) {
      throw new Error('Missing DiscoverEE detail id for update. Refresh the graph and try again.');
    }
    if (nextPoints.length === 0) {
      throw new Error('No valid points to save for this curve.');
    }

    const detailPayload = buildCompanyAppendDetailPayload({
      curveTitle: resolvedNewCurveName,
      points: nextPoints,
      xScale: resolvedEditMeta.xScale,
      yScale: resolvedEditMeta.yScale,
      xUnitPrefix: resolvedEditMeta.xUnitPrefix,
      yUnitPrefix: resolvedEditMeta.yUnitPrefix,
      axisConfig: resolvedEditAxis,
    });

    const curvesOnSameGraph = savedCurves.filter(
      (savedCurve) => String(getGraphIdForCurve(savedCurve) || '').trim() === String(companyGraphId).trim()
    );
    const isMultiCurveGraph = curvesOnSameGraph.length > 1;
    const editGraphPayload = {
      graph_id: String(companyGraphId),
      discoveree_cat_id: String(curve?.discoveree_cat_id || urlParams.discoveree_cat_id || ''),
      identifier: resolvedEditIdentifier,
      partno: nextPartNumber,
      manf: urlParams.manf || urlParams.manufacturer || graphConfig.manufacturer || '',
      manufacturer: urlParams.manufacturer || graphConfig.manufacturer || '',
      graph_title: graphConfig.graphTitle || urlParams.graph_title || curve.config?.graphTitle || '',
      x_title: graphConfig.xLabel || urlParams.x_label || curve.config?.xLabel || '',
      y_title: graphConfig.yLabel || urlParams.y_label || curve.config?.yLabel || '',
      ...(resolvedGraphImageForEdit ? { graph_img: resolvedGraphImageForEdit } : {}),
      mark_review: '1',
      testuser_id: String(curve?.testuser_id || urlParams.testuser_id || ''),
      uname: urlParams.username || graphConfig.username || '',
      username: urlParams.username || graphConfig.username || '',
    };
    // Per-curve renames belong in details[0].curve_title only. On multi-curve graphs,
    // omit graph-level curve_title so DiscoverEE does not treat the edit as a new graph.
    if (!isMultiCurveGraph) {
      editGraphPayload.curve_title = resolvedNewCurveName;
    }

    const appendPayload = {
      graph: editGraphPayload,
      details: [detailPayload],
    };
    Object.entries(getGraphDynamicFieldValues(nextSymbolPayload)).forEach(([key, value]) => {
      appendPayload.graph[key] = value;
    });

    const detailIdsToRemove = new Set([resolvedDetailId]);

    console.log('=== EDIT REMOVE-AND-RESAVE ===', {
      step: 'remove',
      graphId: companyGraphId,
      detailIdsToRemove: Array.from(detailIdsToRemove),
    });
    try {
      for (const detailIdToRemove of detailIdsToRemove) {
        await removeCompanyDetailFromDiscoveree({
          graphId: companyGraphId,
          detailId: detailIdToRemove,
          discovereeCatId: String(curve?.discoveree_cat_id || urlParams.discoveree_cat_id || ''),
          testuserId: String(curve?.testuser_id || urlParams.testuser_id || ''),
          corsFallback: triggerGetWithoutCors,
        });

        const { removed, attempt: removeVerifyAttempt } = await verifyCompanyDetailRemovedFromDiscoveree({
          graphId: companyGraphId,
          detailId: detailIdToRemove,
        });
        if (!removed) {
          throw new Error(
            'DiscoverEE did not confirm removal of the old curve. Update was cancelled to avoid duplicate curves. Refresh the page and try again.'
          );
        }
        console.log('=== EDIT REMOVE VERIFIED ===', {
          graphId: companyGraphId,
          detailId: detailIdToRemove,
          removeVerifyAttempt,
        });
      }
    } catch (removeError) {
      throw new Error(`Failed to remove old curve before save: ${removeError.message}`);
    }

    console.log('=== EDIT REMOVE-AND-RESAVE ===', {
      step: 'append-save',
      graphId: companyGraphId,
      isMultiCurveGraph,
      graphLevelCurveTitleOmitted: isMultiCurveGraph,
    });
    let appendResult;
    try {
      appendResult = await postCompanyAppendSave(companyGraphId, appendPayload);
    } catch (saveError) {
      throw new Error(
        `Curve was removed from DiscoverEE but re-save failed: ${saveError.message}. ` +
        'Refresh the page — you may need to capture this curve again.'
      );
    }

    const returnedGraphId = appendResult?.result?.graph_id ? String(appendResult.result.graph_id) : '';
    if (returnedGraphId && returnedGraphId !== String(companyGraphId)) {
      throw new Error(
        `Re-save was written to graph ${returnedGraphId} instead of ${companyGraphId}. ` +
        'The edited curve was removed from the current graph. Check the other graph on DiscoverEE or re-capture this curve.'
      );
    }
    console.log('=== GRAPH ID CONSISTENCY CHECK (EDIT) ===', {
      editMode: 'remove-and-resave',
      expectedGraphId: String(companyGraphId),
      sentGraphId: String(companyGraphId),
      sentIdentifier: String(resolvedEditIdentifier || ''),
      returnedGraphId,
      matchesExpected: !returnedGraphId || returnedGraphId === String(companyGraphId),
      note: 'If matchesExpected is false, API is creating/updating a different graph context than requested.',
    });

    void mirrorGraphImageToBackend(
      apiUrl,
      String(companyGraphId),
      resolvedGraphImageForEdit || uploadedImage
    );

    const sentXy = normalizeCompanyXyString(detailPayload.xy);
    const {
      xyConfirmedOnDiscoveree,
      detailId: newDetailId,
      verifiedDetail,
      attempt: verifyAttempt,
    } = await verifyEditedCurveOnDiscoveree({
      graphId: companyGraphId,
      sentXy,
      rawXy: detailPayload.xy,
      appendResult,
    });
    const verifiedXy = normalizeCompanyXyString(verifiedDetail?.xy);

    console.log('[EDIT VERIFY]', {
      editMode: 'remove-and-resave',
      graphId: String(companyGraphId),
      removedDetailId: resolvedDetailId,
      verifiedDetailId: newDetailId || '(pending)',
      verifyAttempt: verifyAttempt || '(none)',
      sentPointCount: nextPoints.length,
      sentXyLength: sentXy.length,
      verifiedXyLength: verifiedXy.length,
      xyConfirmedOnDiscoveree,
    });

    if (!xyConfirmedOnDiscoveree) {
      console.warn(
        '[EDIT VERIFY] DiscoverEE GET did not yet return the re-saved xy; keeping existing detail_id and locallyModified cache.'
      );
    }

    return {
      graphId: String(companyGraphId),
      detailId: xyConfirmedOnDiscoveree ? newDetailId : '',
      xyConfirmedOnDiscoveree,
    };
  };

  const handleEditCurveUpdate = async (curveId) => {
    const targetCurve = savedCurves.find((curve) => curve.id === curveId);
    if (!targetCurve) {
      alert('Unable to find the selected curve for update.');
      return;
    }

    const nextAxisBounds = {
      xMin: editCurveMeta.xMin,
      xMax: editCurveMeta.xMax,
      yMin: editCurveMeta.yMin,
      yMax: editCurveMeta.yMax,
    };

    if (!hasValidStoredAxisBounds(nextAxisBounds)) {
      alert('Please enter valid axis min/max values (each min must be less than its max).');
      return;
    }

    const graphIdForCurve = String(
      targetCurve.graphId || getGraphIdForCurve(targetCurve) || urlParams.graph_id || ''
    ).trim();
    const curvesOnGraph = savedCurves.filter(
      (curve) => String(curve.graphId || getGraphIdForCurve(curve) || graphIdForCurve) === graphIdForCurve
    );

    const axisBaseline = editSessionAxisRef.current || resolveAxisBoundFields(graphConfig);
    const hasAxisChange = haveAxisBoundsChanged(axisBaseline, nextAxisBounds);
    const currentPartNumber = resolveSavedPartNumber(
      targetCurve.part_number,
      targetCurve.config?.partNumber,
      graphConfig.partNumber,
      urlParams.partno
    );
    const nextPartNumber = String(editPartNumber || '').trim();
    const hasPartNumberChange = nextPartNumber !== currentPartNumber;
    const currentEditMeta = {
      xScale: targetCurve.config?.xScale || targetCurve.x_scale || 'Linear',
      yScale: targetCurve.config?.yScale || targetCurve.y_scale || 'Linear',
      xUnitPrefix: targetCurve.config?.xUnitPrefix || targetCurve.x_unit || '1',
      yUnitPrefix: targetCurve.config?.yUnitPrefix || targetCurve.y_unit || '1',
    };
    const hasMetaChanges =
      currentEditMeta.xScale !== editCurveMeta.xScale ||
      currentEditMeta.yScale !== editCurveMeta.yScale ||
      currentEditMeta.xUnitPrefix !== editCurveMeta.xUnitPrefix ||
      currentEditMeta.yUnitPrefix !== editCurveMeta.yUnitPrefix;

    const editPlans = curvesOnGraph.map((curve) => {
      const isTarget = curve.id === curveId;
      const rawPoints = isTarget
        ? normalizePointsForComparison(getEditCurveDataPoints(targetCurve, dataPoints))
        : normalizePointsForComparison(curve?.points);
      if (!hasAxisChange) {
        return { curve, isTarget, points: rawPoints, removedCount: 0 };
      }
      const { inBounds, removedCount } = partitionPointsByAxisBounds(rawPoints, nextAxisBounds);
      return { curve, isTarget, points: inBounds, removedCount };
    });

    const totalRemoved = hasAxisChange
      ? editPlans.reduce((sum, plan) => sum + plan.removedCount, 0)
      : 0;

    if (hasAxisChange && editPlans.some((plan) => plan.points.length === 0)) {
      alert('Cannot update: at least one curve would have no points left. Widen the axis range or adjust points first.');
      return;
    }

    let confirmMessage = 'Are you sure you want to update this curve?';
    if (hasPartNumberChange) {
      confirmMessage =
        `Part number will be updated to "${nextPartNumber || '(empty)'}" for all curves on this graph.` +
        '\n\n' +
        confirmMessage;
    }
    if (hasAxisChange && totalRemoved > 0) {
      confirmMessage =
        `${totalRemoved} point(s) fall outside the new axis range and will be removed.` +
        ' Axis min/max will apply to all curves on this graph.' +
        '\n\nContinue with update?';
    } else if (hasAxisChange) {
      confirmMessage =
        'Axis min/max will apply to all curves on this graph.\n\nAre you sure you want to update?';
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsUpdatingCurveId(curveId);
    try {
      const targetPlan = editPlans.find((plan) => plan.isTarget);
      if (!targetPlan) {
        throw new Error('Unable to prepare the selected curve for update.');
      }

      const targetOverlayId = String(targetCurve?.id ?? targetCurve?.detailId ?? 'saved');
      if (
        targetPlan.points.length !==
        normalizePointsForComparison(getEditCurveDataPoints(targetCurve, dataPoints)).length
      ) {
        replaceDataPoints(
          targetPlan.points.map((point) => ({
            x: point.x,
            y: point.y,
            imported: true,
            overlayCurveId: targetOverlayId,
          }))
        );
      }

      if (hasAxisChange) {
        setGraphConfig((prev) => ({ ...prev, ...nextAxisBounds }));
        setFrozenGraphConfig((prev) => (prev ? { ...prev, ...nextAxisBounds } : prev));
        editSessionAxisRef.current = { ...nextAxisBounds };
      }

      const editResult = await pushEditedCurveToApi(
        targetCurve,
        editCurveMeta,
        editCurveSymbolValues,
        editCurveName,
        {
          pointsOverride: targetPlan.points,
          axisBoundsOverride: nextAxisBounds,
          axisBaseline,
          partNumberOverride: editPartNumber,
        }
      );

      const saveResults = new Map();
      saveResults.set(curveId, {
        detailId:
          editResult?.xyConfirmedOnDiscoveree === true
            ? String(editResult?.detailId || '').trim()
            : '',
        points: targetPlan.points,
        xyConfirmedOnDiscoveree: editResult?.xyConfirmedOnDiscoveree === true,
      });

      if (hasAxisChange && savedCurvesSource === 'company') {
        for (const plan of editPlans.filter((plan) => !plan.isTarget)) {
          const companionMeta = buildCurveMetaFromSaved(plan.curve, graphConfig);
          const companionResult = await pushEditedCurveToApi(
            plan.curve,
            companionMeta,
            normalizeCurveSymbolValues(plan.curve),
            plan.curve.config?.curveName || plan.curve.name || '',
            {
              pointsOverride: plan.points,
              axisBoundsOverride: nextAxisBounds,
              axisBaseline: resolveAxisBoundFields(plan.curve.config || plan.curve),
              isCompanionAxisSync: true,
              ...(hasPartNumberChange ? { partNumberOverride: nextPartNumber } : {}),
            }
          );
          saveResults.set(plan.curve.id, {
            detailId:
              companionResult?.xyConfirmedOnDiscoveree === true
                ? String(companionResult?.detailId || '').trim()
                : '',
            points: plan.points,
            xyConfirmedOnDiscoveree: companionResult?.xyConfirmedOnDiscoveree === true,
          });
        }
      }

      const syncedGraphId = targetCurve.graphId || getGraphIdForCurve(targetCurve);
      syncGraphIdContext(
        syncedGraphId,
        resolveIdentifierForGraph({
          graphId: syncedGraphId,
          curve: targetCurve,
          savedCurves,
          urlParams,
          sessionGraphId: activeSessionGraphIdRef.current,
          sessionIdentifier: activeSessionIdentifierRef.current,
        })
      );

      setSavedCurves((prev) => {
        const updated = prev.map((curve) => {
          const onGraph =
            String(curve.graphId || getGraphIdForCurve(curve) || graphIdForCurve) === graphIdForCurve;
          if (!onGraph) return curve;

          const plan = editPlans.find((entry) => entry.curve.id === curve.id);
          if (!plan) return curve;

          const result = saveResults.get(curve.id);
          const isTarget = curve.id === curveId;
          const updatedName = isTarget ? editCurveName || curve.name : curve.name;

          return {
            ...curve,
            ...(hasPartNumberChange ? { part_number: nextPartNumber } : {}),
            ...(result?.xyConfirmedOnDiscoveree === true &&
            result?.detailId &&
            graphIdForCurve
              ? {
                  detailId: result.detailId,
                  id: `${graphIdForCurve}_${result.detailId}`,
                }
              : {}),
            name: isTarget ? updatedName : curve.name,
            points: plan.points.map((point) => ({
              x_value: point.x,
              y_value: point.y,
            })),
            config: {
              ...(curve.config || {}),
              ...(hasPartNumberChange ? { partNumber: nextPartNumber } : {}),
              ...(isTarget && hasMetaChanges
                ? {
              curveName: updatedName,
              xScale: editCurveMeta.xScale,
              yScale: editCurveMeta.yScale,
              xUnitPrefix: editCurveMeta.xUnitPrefix,
              yUnitPrefix: editCurveMeta.yUnitPrefix,
                  }
                : isTarget
                  ? { curveName: updatedName }
                  : {}),
            },
            ...(isTarget && hasMetaChanges
              ? {
            symbolValues: { ...editCurveSymbolValues },
            x_scale: editCurveMeta.xScale,
            y_scale: editCurveMeta.yScale,
            x_unit: editCurveMeta.xUnitPrefix,
            y_unit: editCurveMeta.yUnitPrefix,
                }
              : isTarget
                ? { symbolValues: { ...editCurveSymbolValues } }
                : {}),
            updatedAt: Date.now(),
            locallyModified: isTarget || hasAxisChange ? true : Boolean(curve.locallyModified),
            userAdjustedPoints: isTarget ? true : Boolean(curve.userAdjustedPoints),
          };
        });

        const axisConfig = hasAxisChange
          ? { ...graphConfig, ...nextAxisBounds }
          : graphConfig;
        const next = hasAxisChange && graphIdForCurve
          ? patchSavedCurvesWithAxisConfig(updated, axisConfig, graphIdForCurve)
          : updated;

        if (graphIdForCurve) {
          const curvesForGraph = next.filter(
            (curve) => (curve.graphId || getGraphIdForCurve(curve)) === graphIdForCurve
          );
          persistSavedCurves(graphIdForCurve, curvesForGraph, savedCurvesSource);
        }
        return next;
      });

      if (graphIdForCurve && graphArea.width > 0 && graphArea.height > 0) {
        persistGraphContext(
          graphIdForCurve,
          graphArea,
          hasAxisChange ? { ...graphConfig, ...nextAxisBounds } : graphConfig
        );
      }

      if (savedCurvesSource === 'company' && graphIdForCurve) {
        try {
          const { details: refetchDetails } = await fetchCompanyGraphDetailsWithRetry(graphIdForCurve);
          const apiDetails = dedupeCompanyApiDetailsById(refetchDetails);
          if (apiDetails.length > 0) {
            setSavedCurves((prev) => {
              const graphIdKey = String(graphIdForCurve);
              const onGraph = prev.filter(
                (curve) => String(curve.graphId || getGraphIdForCurve(curve) || '') === graphIdKey
              );
              const offGraph = prev.filter(
                (curve) => String(curve.graphId || getGraphIdForCurve(curve) || '') !== graphIdKey
              );
              const apiDetailIds = new Set(
                apiDetails.map((detail) => String(detail?.id || '').trim()).filter(Boolean)
              );
              const prunedOnGraph = onGraph.filter((curve) => {
                const detailId = String(getDetailIdForCurve(curve) || '').trim();
                return detailId && apiDetailIds.has(detailId);
              });
              const knownDetailIds = new Set(
                prunedOnGraph.map((curve) => String(getDetailIdForCurve(curve) || '')).filter(Boolean)
              );
              const missing = apiDetails.filter(
                (detail) => detail?.id && !knownDetailIds.has(String(detail.id))
              );
              if (
                missing.length === 0 &&
                prunedOnGraph.length === onGraph.length &&
                prunedOnGraph.length === apiDetails.length
              ) {
                return prev;
              }

              const graphImageUrl =
                prunedOnGraph[0]?.graphImageUrl ||
                onGraph[0]?.graphImageUrl ||
                onGraph[0]?.graph_img ||
                uploadedImage ||
                '';
              const syncedOnGraph = prunedOnGraph.map((curve) => {
                const detailId = String(getDetailIdForCurve(curve) || '').trim();
                const apiDetail = apiDetails.find(
                  (detail) => String(detail?.id || '').trim() === detailId
                );
                if (!apiDetail?.curve_title) {
                  return curve;
                }
                return {
                  ...curve,
                  name: apiDetail.curve_title,
                  config: {
                    ...(curve.config || {}),
                    curveName: apiDetail.curve_title,
                  },
                };
              });
              const missingCurves = missing.map((detail, i) => {
                const rawPoints = parseXyString(detail.xy);
                return {
                  id: `${graphIdKey}_${detail.id || i}`,
                  detailId: detail.id ? String(detail.id) : '',
                  graphId: graphIdKey,
                  name: detail.curve_title || `Curve ${i + 1}`,
                  points: rawPoints,
                  graphImageUrl,
                  config: {
                    curveName: detail.curve_title || '',
                    graphTitle: prunedOnGraph[0]?.config?.graphTitle || graphConfig.graphTitle || '',
                  },
                };
              });

              const nextOnGraph = dedupeCurves([...syncedOnGraph, ...missingCurves]);
              const next = dedupeCurves([...offGraph, ...nextOnGraph]);
              const curvesForGraph = next.filter(
                (curve) => String(curve.graphId || getGraphIdForCurve(curve) || '') === graphIdKey
              );
              persistSavedCurves(graphIdKey, curvesForGraph, savedCurvesSource);
              return next;
            });
          }
        } catch (refetchError) {
          console.warn('[EDIT REFETCH] Unable to reconcile sibling curves from DiscoverEE:', refetchError);
        }
      }

      if (hasPartNumberChange) {
        setGraphConfig((prev) => ({ ...prev, partNumber: nextPartNumber }));
      }

      setEditingCurveId('');
      setEditCurveSymbolValues({});
      setEditCurveName('');
      setEditPartNumber('');
      editSessionAxisRef.current = null;
      clearDataPoints();

      const successMessage =
        hasAxisChange && totalRemoved > 0
          ? `Curve updated successfully. ${totalRemoved} point(s) outside the axis range were removed.`
          : hasAxisChange
            ? 'Curve updated successfully. Axis min/max were applied to all curves on this graph.'
            : 'Curve updated successfully.';
      alert(successMessage);
    } catch (error) {
      console.error('Edit update API error:', error);
      alert(`Edit update failed: ${error.message}`);
    } finally {
      setIsUpdatingCurveId('');
    }
  };

  const removeCurveViaApi = async (curve) => {
    if (savedCurvesSource !== 'company') {
      const localUrl = `${apiUrl}/api/curves/${curve.id}`;
      // console.log('=== REMOVE API REQUEST ===', {
      //   source: 'local',
      //   url: localUrl,
      //   method: 'DELETE',
      // });

      const localResponse = await fetch(localUrl, {
        method: 'DELETE',
      });

      const localResult = await localResponse.json().catch(() => ({}));
      // console.log('=== REMOVE API RESPONSE ===', {
      //   source: 'local',
      //   url: localUrl,
      //   status: localResponse.status,
      //   ok: localResponse.ok,
      //   response: localResult,
      // });

      if (!localResponse.ok) {
        throw new Error(`Local remove failed (${localResponse.status})`);
      }

      return;
    }

    const graphId = curve.graphId || getGraphIdForCurve(curve);
    const detailId = getDetailIdForCurve(curve);
    const discovereeCatId = curve.discoveree_cat_id ? String(curve.discoveree_cat_id) : String(urlParams.discoveree_cat_id || '');
    const testuserId = String(curve.testuser_id || urlParams.testuser_id || '');

    if (!graphId) {
      throw new Error('Missing graph_id for remove.');
    }

    if (!detailId) {
      const localCurveId = Number(curve.id);
      if (Number.isFinite(localCurveId) && localCurveId > 0) {
        try {
          await fetch(`${apiUrl}/api/curves/${localCurveId}`, { method: 'DELETE' });
      } catch {
          // Best-effort cleanup for unsynced local-only curves.
        }
      }
      return;
    }

    await removeCompanyDetailFromDiscoveree({
      graphId,
      detailId,
      discovereeCatId,
      testuserId,
      corsFallback: triggerGetWithoutCors,
    });
  };

  const handleRemoveCurve = async (curve) => {
    if (!curve) {
      return;
    }

    const confirmed = window.confirm('Remove this curve?');
    if (!confirmed) {
      return;
    }

    setIsRemovingCurveId(curve.id);

    try {
      await removeCurveViaApi(curve);
      const remainingCurves = savedCurves.filter((item) => item.id !== curve.id);
      setSavedCurves(remainingCurves);
      const activeGraphId = String(
        curve.graphId || getGraphIdForCurve(curve) || urlParams.graph_id || ''
      ).trim();
      if (activeGraphId) {
        const curvesForGraph = remainingCurves.filter(
          (item) => (item.graphId || getGraphIdForCurve(item)) === activeGraphId
        );
        if (curvesForGraph.length > 0) {
          persistSavedCurves(activeGraphId, curvesForGraph, savedCurvesSource);
        } else {
          clearPersistedSavedCurves(activeGraphId);
        }
      }
      if (remainingCurves.length === 0) {
        clearGraphIdContext();
      }
    } catch (error) {
      console.error('Remove API error:', error);
      alert(`Remove failed: ${error.message}`);
    } finally {
      setIsRemovingCurveId('');
    }
  };

  const handleRemoveAllGraphs = async () => {
    const activeGraphId = urlParams.graph_id || (savedCurves[0] ? (savedCurves[0].graphId || getGraphIdForCurve(savedCurves[0])) : '');
    const curvesToRemove = activeGraphId
      ? savedCurves.filter((curve) => (curve.graphId || getGraphIdForCurve(curve)) === String(activeGraphId))
      : [...savedCurves];

    if (curvesToRemove.length === 0) {
      alert('No graphs found to remove.');
      return;
    }

    const confirmed = window.confirm('Remove all graphs?');
    if (!confirmed) {
      return;
    }

    setIsRemovingAllGraphs(true);
    try {
      for (const curve of curvesToRemove) {
        await removeCurveViaApi(curve);
      }

      const removedIds = new Set(curvesToRemove.map((curve) => curve.id));
      setSavedCurves((prev) => prev.filter((curve) => !removedIds.has(curve.id)));
      if (activeGraphId) {
        clearPersistedSavedCurves(String(activeGraphId));
      }
      clearGraphIdContext();
    } catch (error) {
      console.error('Remove all API error:', error);
      alert(`Remove all failed: ${error.message}`);
    } finally {
      setIsRemovingAllGraphs(false);
    }
  };

  const normalizeCurveConfig = (curve) => normalizeCurveConfigFields(curve);

  const applyDiscovereeGraphMetadataToConfig = (
    discovereeGraph = {},
    resolvedGraphTitle = '',
    firstDetail = null,
    curves = [],
    graphId = ''
  ) => {
    if (!discovereeGraph || typeof discovereeGraph !== 'object') return;

    const persistedContext = graphId ? getPersistedGraphContext(graphId) : null;
    const keepPersistedAxis = hasPersistedMappingContext(persistedContext);
    const axisFields = resolveDiscovereeAxisFields(discovereeGraph, firstDetail || {});
    const curveList = Array.isArray(curves) ? curves : [];
    const firstCurveAxis = curveList[0] ? normalizeCurveConfigFields(curveList[0]) : {};
    const resolvedAxisFields = {
      ...axisFields,
      ...(axisFields.xUnitPrefix === '1' && firstCurveAxis.xUnitPrefix && firstCurveAxis.xUnitPrefix !== '1'
        ? { xUnitPrefix: firstCurveAxis.xUnitPrefix }
        : {}),
      ...(axisFields.yUnitPrefix === '1' && firstCurveAxis.yUnitPrefix && firstCurveAxis.yUnitPrefix !== '1'
        ? { yUnitPrefix: firstCurveAxis.yUnitPrefix }
        : {}),
    };

    setGraphConfig((prev) => {
      let next = {
        ...prev,
        graphTitle: resolvedGraphTitle || discovereeGraph.graph_title || prev.graphTitle || '',
        partNumber: discovereeGraph.partno || prev.partNumber || '',
        manufacturer: discovereeGraph.manf || prev.manufacturer || '',
      };

      if (keepPersistedAxis) {
        return next;
      }

      next = {
        ...next,
        xLabel: resolvedAxisFields.xLabel || discovereeGraph.x_title || discovereeGraph.x_label || prev.xLabel || '',
        yLabel: resolvedAxisFields.yLabel || discovereeGraph.y_title || discovereeGraph.y_label || prev.yLabel || '',
        ...buildGraphConfigAxisPatch(resolvedAxisFields),
        ...(resolvedAxisFields.xScale ? { xScale: resolvedAxisFields.xScale } : {}),
        ...(resolvedAxisFields.yScale ? { yScale: resolvedAxisFields.yScale } : {}),
        ...(resolvedAxisFields.xUnitPrefix ? { xUnitPrefix: resolvedAxisFields.xUnitPrefix } : {}),
        ...(resolvedAxisFields.yUnitPrefix ? { yUnitPrefix: resolvedAxisFields.yUnitPrefix } : {}),
      };
      return applyComputedAxisBounds(next, curveList);
    });
  };

  const formatDisplayValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return (Math.abs(num) > 0 && Math.abs(num) < 0.0001)
      ? num.toExponential(4)
      : num.toFixed(4);
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const otherSymbols = searchParams.get('other_symbols') || searchParams.get('other_symb') || '';
    const symbolArray = otherSymbols ? otherSymbols.split(',').map((s) => s.trim()) : [];

    // Extract friendly labels and pre-fill values from URL parameters
    // Format: "Friendly Label=value" or just "Friendly Label"
    const symbolNames = [];
    const initialSymbolValues = {};
    const labelMap = {}; // Map from symbol name to friendly label
    let detectedTemperatureValue = searchParams.get('tctj') || '';
    
    symbolArray.forEach((symbolWithPotentialValue) => {
      if (symbolWithPotentialValue.includes('=')) {
        const [label, symbolValue] = symbolWithPotentialValue.split('=').map((s) => s.trim());
        const paramName = resolveSymbolParamName(label, searchParams);

        if (isTemperatureSymbol(label, paramName)) {
          if ((!detectedTemperatureValue || detectedTemperatureValue === '0') && symbolValue) {
            detectedTemperatureValue = symbolValue;
          }
          return;
        }
        
        symbolNames.push(paramName);
        initialSymbolValues[paramName] = symbolValue;
        labelMap[paramName] = label; // Store the friendly label for display
      } else {
        const paramName = resolveSymbolParamName(symbolWithPotentialValue, searchParams);
        const symbolValue =
          searchParams.get(paramName) ||
          searchParams.get(`return_${paramName}`) ||
          '';

        if (isTemperatureSymbol(symbolWithPotentialValue, paramName)) {
          if ((!detectedTemperatureValue || detectedTemperatureValue === '0') && symbolValue) {
            detectedTemperatureValue = symbolValue;
          }
          return;
        }

        symbolNames.push(paramName);
        initialSymbolValues[paramName] = symbolValue;
        labelMap[paramName] = symbolWithPotentialValue;
      }
    });

    setSymbolNames(symbolNames);
    setSymbolValues(initialSymbolValues);
    setSymbolLabels(labelMap);

    // Extract return parameters (format: return_paramName=value, excluding return_url)
    const returnParamsObj = {};
    const keys = Array.from(searchParams.keys());
    keys.forEach((key) => {
      if (key.startsWith('return_') && key !== 'return_url') {
        const paramName = key.substring(7); // Remove 'return_' prefix
        const paramValue = searchParams.get(key);
        returnParamsObj[paramName] = paramValue;
      }
    });
    setReturnParams(returnParamsObj);

    const partno = searchParams.get('partno') || '';
    const manufacturer = searchParams.get('manufacturer') || searchParams.get('manufactuer') || searchParams.get('manf') || '';
    const username = searchParams.get('username') || searchParams.get('uname') || '';
    const curveTitle = searchParams.get('curve_title') || '';
    const graphTitle = searchParams.get('graph_title') || '';
    const tctjValue = detectedTemperatureValue;
    const graphIdFromUrl =
      getLastNonEmptyQueryValue(searchParams, 'graph_id') ||
      getLastNonEmptyQueryValue(searchParams, 'return_graph_id') ||
      '';
    const restoredPending = consumeAiPendingCapture(graphIdFromUrl);

    const xTitleFromUrl = (searchParams.get('x_label') || searchParams.get('x_title') || searchParams.get('xlabel') || '').trim();
    const yTitleFromUrl = (searchParams.get('y_label') || searchParams.get('y_title') || searchParams.get('ylabel') || '').trim();

    setUrlParams({
      partno,
      manufacturer,
      username,
      graph_title: graphTitle,
      curve_title: curveTitle,
      x_label: xTitleFromUrl,
      y_label: yTitleFromUrl,
      other_symbols: otherSymbols,
      discoveree_cat_id: searchParams.get('discoveree_cat_id') || '',
      identifier: normalizeSessionIdentifier(
        getLastNonEmptyQueryValue(searchParams, 'identifier') || searchParams.get('identifier') || ''
      ),
      testuser_id: searchParams.get('testuser_id') || '',
      tctj: tctjValue,
      return_url: searchParams.get('return_url') || '',
      graph_id: graphIdFromUrl,
    });
    setShouldSkipCaptureChoiceAfterAi(false);
    setRestoredPendingCapture(restoredPending);
    restoredPendingImageRef.current = String(restoredPending?.imageBase64 || '');
    if (restoredPending?.imageBase64) {
      aiLogVerbose('[AI PENDING CAPTURE] Restoring captured image to upload panel (pending choice)');
    }

    setIsXTitleUrlLocked(Boolean(xTitleFromUrl));
    setIsYTitleUrlLocked(Boolean(yTitleFromUrl));

    // Auto-populate graphConfig with URL parameters
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      manufacturer: manufacturer || prevConfig.manufacturer,
      username: username || prevConfig.username,
      curveName: curveTitle || prevConfig.curveName,
      graphTitle: graphTitle || prevConfig.graphTitle,
      xLabel: xTitleFromUrl || prevConfig.xLabel,
      yLabel: yTitleFromUrl || prevConfig.yLabel,
      partNumber: partno || prevConfig.partNumber,
      temperature: tctjValue && tctjValue !== '0' ? tctjValue : prevConfig.temperature,
    }));
  }, [window.location.search]);

  // Auto-fill graph title from graph_id if graph_id is provided but graph_title is not
  useEffect(() => {
    const hasGraphId = Boolean(urlParams.graph_id);
    const hasGraphTitle = Boolean(urlParams.graph_title);
    
    // If graph_id is present but graph_title is not, and current graphConfig.graphTitle is empty, try to fetch the title
    if (hasGraphId && !hasGraphTitle && !graphConfig.graphTitle && savedCurves.length > 0) {
      const matchingCurve = savedCurves.find(
        (curve) => (curve.graphId || getGraphIdForCurve(curve)) === String(urlParams.graph_id)
      );
      if (matchingCurve) {
        const fetchedTitle = matchingCurve.config?.graphTitle || matchingCurve.graph_title || matchingCurve.name;
        if (fetchedTitle) {
          setGraphConfig((prev) => ({
            ...prev,
            graphTitle: fetchedTitle,
          }));
        }
      }
    }
  }, [urlParams.graph_id, savedCurves, graphConfig.graphTitle]);

  const parseXyString = (xy) => {
    if (!xy) return [];
    const points = [];
    const matches = [...xy.matchAll(/\{\s*x:\s*([^,}]+)\s*,\s*y:\s*([^}]+)\s*\}/g)];
    matches.forEach((match) => {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ x_value: x, y_value: y });
      }
    });
    return points;
  };

  useEffect(() => {
    // Parse graph_id directly from URL to avoid timing issues with state
    const searchParams = new URLSearchParams(window.location.search);
    const graphId = searchParams.get('graph_id');
    const discovereeCatIdFromUrl = searchParams.get('discoveree_cat_id') || '';
    const hydratedSymbolNames =
      Array.isArray(symbolNames) && symbolNames.length > 0
        ? symbolNames
        : (() => {
            const otherSymbolsRaw = searchParams.get('other_symbols') || searchParams.get('other_symb') || '';
            const symbolTokens = otherSymbolsRaw
              ? otherSymbolsRaw.split(',').map((token) => token.trim()).filter(Boolean)
              : [];

            return symbolTokens.map((token) => {
              const label = token.includes('=') ? token.split('=')[0].trim() : token;
              return resolveSymbolParamName(label, searchParams);
            });
          })();
    
    if (!graphId) {
      console.log('[DEBUG] No graph_id in URL params, skipping fetch');
      setIsInitialGraphFetchPending(false);
      return;
    }

    // Skip auto-fetch when URL hydration restored a pending AI image (upload-only Page A).
    if (String(restoredPendingImageRef.current || '').trim()) {
      aiLogVerbose('[DEBUG] Pending AI capture restored on mount, skipping auto-fetch to stay in upload mode');
      setIsInitialGraphFetchPending(false);
      return;
    }

    console.log('[DEBUG] Fetching graph_id:', graphId);
    const fetchGraphById = async () => {
      try {
        clearDataPoints();

        // Try DiscovereE API first
        console.log('[DEBUG] Attempting DiscovereE API fetch...');
        const discovereeResponse = await fetch(
          `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(graphId)}`
        );
        console.log('[DEBUG] DiscoverEE response status:', discovereeResponse.status);
        if (discovereeResponse.ok) {
          const discovereeRaw = await discovereeResponse.text();
          const result = parseCompanyApiText(discovereeRaw);
          console.log('[DEBUG] DiscoverEE response:', result);

          const discovereeGraph = result?.graph && !Array.isArray(result.graph) ? result.graph : null;
          const discovereeDetails = dedupeCompanyApiDetailsById(parseCompanyApiDetails(result));

          if (result.status === 'success' && discovereeGraph && discovereeDetails.length > 0) {
            setGraphLoadNotice('');
            console.log('[DEBUG] Successfully parsed DiscoverEE data, details count:', discovereeDetails.length);
            console.log('[DEBUG] discovereeGraph all fields:', JSON.stringify(discovereeGraph, null, 2));
            const resolvedGraphId = String(discovereeGraph.graph_id || graphId).trim();
            const quickImage = resolveQuickGraphImage(discovereeGraph, resolvedGraphId);
            if (quickImage) {
              setUploadedImageFromExistingGraph(quickImage);
              if (isEmbeddedGraphImage(quickImage)) {
                persistGraphImage(resolvedGraphId, quickImage);
              }
              setIsInitialGraphFetchPending(false);
            }
            const graphImageUrl = await resolveReachableGraphImageUrl(
              discovereeGraph,
              discovereeDetails,
              resolvedGraphId,
              { restoredPending: '', apiUrl }
            );
            if (graphImageUrl && graphImageUrl !== quickImage) {
              setUploadedImageFromExistingGraph(graphImageUrl);
            }
            logGraphImageAvailability(resolvedGraphId, graphImageUrl, 'discoveree-success-with-details', {
              detailsCount: discovereeDetails.length,
              companyGraphImgPresent: Boolean(String(discovereeGraph?.graph_img || '').trim()),
            });
            const graphGroupId = buildGraphGroupId(graphImageUrl || String(discovereeGraph.graph_id));
            const resolvedGraphTitle = resolveGraphTitle(discovereeGraph, discovereeDetails);

            if (graphImageUrl && isEmbeddedGraphImage(graphImageUrl)) {
              persistGraphImage(resolvedGraphId, graphImageUrl);
            }
            const preferredSymbolKeySet = new Set((Array.isArray(hydratedSymbolNames) ? hydratedSymbolNames : []).map((key) => String(key).toLowerCase()));
            const graphLevelSymbolValues = hydratedSymbolNames.reduce((accumulator, key) => {
              const directValue = discovereeGraph?.[key];
              if (directValue !== undefined && directValue !== null && String(directValue).trim() !== '') {
                accumulator[key] = String(directValue).trim();
                return accumulator;
              }

              const alternateKey = getAlternateDfSymbolKey(key);
              if (!alternateKey || preferredSymbolKeySet.has(String(alternateKey).toLowerCase())) {
                return accumulator;
              }

              const alternateValue = discovereeGraph?.[alternateKey];
              if (alternateValue !== undefined && alternateValue !== null && String(alternateValue).trim() !== '') {
                accumulator[key] = String(alternateValue).trim();
              }

              return accumulator;
            }, {});

            const fetched = discovereeDetails.map((detail, i) => {
              const axisFields = resolveDiscovereeAxisFields(discovereeGraph, detail);
              const rawPoints = parseXyString(detail.xy);
              const points = rawPoints;
              const resolvedXMin = axisFields.xMin;
              const resolvedXMax = axisFields.xMax;
              const resolvedYMin = axisFields.yMin;
              const resolvedYMax = axisFields.yMax;
              const resolvedXScale = axisFields.xScale;
              const resolvedYScale = axisFields.yScale;
              const detailSymbolValues =
                detail.tctj && typeof detail.tctj === 'object' && !Array.isArray(detail.tctj)
                  ? detail.tctj
                  : extractDetailSymbolValues(detail, hydratedSymbolNames);
              const mergedSymbolValues = {
                ...graphLevelSymbolValues,
                ...detailSymbolValues,
              };
              const resolvedCurveTitle = detail.curve_title || discovereeGraph.curve_title || '';
              const resolvedPartNumber = String(
                discovereeGraph.partno || urlParams.partno || graphConfig.partNumber || ''
              ).trim();
              console.log('[DEBUG] Parsed detail', i, 'xy:', detail.xy, 'points count:', points.length);
              return {
                id: `${discovereeGraph.graph_id}_${detail.id || i}`,
                detailId: detail.id ? String(detail.id) : '',
                graphId: String(discovereeGraph.graph_id || ''),
                identifier: ensureStableGraphIdentifier(
                  String(discovereeGraph.graph_id || ''),
                  discovereeGraph.identifier || ''
                ),
                part_number: resolvedPartNumber,
                discoveree_cat_id: String(
                  discovereeGraph.discoveree_cat_id ||
                  result?.discoveree_cat_id ||
                  urlParams.discoveree_cat_id ||
                  ''
                ),
                testuser_id: searchParams.get('testuser_id') || '',
                name: resolvedCurveTitle || resolvedGraphTitle || `Curve ${i + 1}`,
                points,
                updatedAt: detail.ins_date
                  ? Date.parse(String(detail.ins_date).replace(' ', 'T'))
                  : Number(detail.id || 0),
                x_min: resolvedXMin,
                x_max: resolvedXMax,
                y_min: resolvedYMin,
                y_max: resolvedYMax,
                symbolValues: mergedSymbolValues,
                config: {
                  graphTitle: resolvedGraphTitle,
                  curveName: resolvedCurveTitle,
                  partNumber: resolvedPartNumber,
                  xScale: resolvedXScale,
                  yScale: resolvedYScale,
                  xUnitPrefix: axisFields.xUnitPrefix || detail.xunit || '1',
                  yUnitPrefix: axisFields.yUnitPrefix || detail.yunit || '1',
                  xMin: resolvedXMin,
                  xMax: resolvedXMax,
                  yMin: resolvedYMin,
                  yMax: resolvedYMax,
                  xLabel: axisFields.xLabel || '',
                  yLabel: axisFields.yLabel || '',
                  logDataModeX: resolvedXScale === 'Logarithmic' ? 'actual' : 'linear',
                  logDataModeY: resolvedYScale === 'Logarithmic' ? 'actual' : 'linear',
                  temperature: detail.tctj || '',
                },
                graphGroupId,
                graphImageUrl,
              };
            });
            const dedupedFetched = dedupeCurves(fetched);
            console.log('[DEBUG] Total fetched curves:', fetched.length, 'after dedupe:', dedupedFetched.length);
            if (dedupedFetched.length > 0) {
              const resolvedGraphIdForCurves = String(discovereeGraph.graph_id || graphId).trim();
              const restoredBundle = buildRestoredSavedCurves({
                graphId: resolvedGraphIdForCurves,
                companyCurves: dedupedFetched,
                graphImageUrl: graphImageUrl || '',
              });
              const curvesToUse = restoredBundle.curves;

              console.log('[DEBUG] Setting savedCurves from DiscoverEE + persisted merge:', curvesToUse.length);
              autoLoadedGraphIdRef.current = resolvedGraphIdForCurves;
              setSavedCurves(curvesToUse);
              setSavedCurvesSource(restoredBundle.source);
              persistSavedCurves(
                resolvedGraphIdForCurves,
                curvesToUse,
                restoredBundle.source
              );
              activateAppendSession(resolvedGraphIdForCurves, graphImageUrl || quickImage, 'fetchGraphById');
              syncGraphIdContext(
                resolvedGraphIdForCurves,
                ensureStableGraphIdentifier(
                  resolvedGraphIdForCurves,
                  discovereeGraph.identifier || curvesToUse[0]?.identifier || ''
                )
              );

              if (graphImageUrl || quickImage) {
                setUploadedImageFromExistingGraph(graphImageUrl || quickImage);
              }

              restoreGraphDisplayFromSavedCurve(curvesToUse[0], resolvedGraphIdForCurves, {
                keepCurveNameEmpty: true,
                allCurves: curvesToUse,
                loadPoints: false,
                graphAreaOverride: normalizePersistedGraphArea(
                  getPersistedGraphContext(resolvedGraphIdForCurves)?.graphArea
                ),
              });

              applyDiscovereeGraphMetadataToConfig(
                discovereeGraph,
                resolvedGraphTitle,
                discovereeDetails[0],
                curvesToUse,
                resolvedGraphIdForCurves
              );
              return;
            }
          }

          if (result.status === 'success' && discovereeGraph && discovereeDetails.length === 0) {
            console.log('[DEBUG] DiscoverEE graph found but details are empty. Showing upload panel.');
            const resolvedGraphId = discovereeGraph.graph_id || graphId;

            clearPersistedGraphSessionArtifacts(resolvedGraphId);

            setSavedCurves([]);
            setSavedCurvesSource('company');
            setUploadedImage(null);
            clearDataPoints();
            setGraphArea({ x: 0, y: 0, width: 0, height: 0 });
            setIsAxisMappingConfirmed(false);
            setFrozenGraphConfig(null);

            const emptyDetailsImageUrl = await resolveReachableGraphImageUrl(
              discovereeGraph,
              [],
              String(resolvedGraphId),
              { restoredPending: '', apiUrl }
            );
            activateAppendSession(resolvedGraphId, emptyDetailsImageUrl, 'fetchGraphById-emptyDetails');
            if (emptyDetailsImageUrl) {
              setUploadedImageFromExistingGraph(emptyDetailsImageUrl);
              if (isEmbeddedGraphImage(emptyDetailsImageUrl)) {
                persistGraphImage(String(resolvedGraphId), emptyDetailsImageUrl);
              }
            }
            setGraphLoadNotice('');
            setShouldSkipCaptureChoiceAfterAi(false);

            const resolvedGraphTitle = resolveGraphTitle(discovereeGraph, []);
            applyDiscovereeGraphMetadataToConfig(discovereeGraph, resolvedGraphTitle, null, [], resolvedGraphId);

            if (resolvedGraphTitle && !urlParams.graph_title) {
              setGraphConfig((prev) => ({
                ...prev,
                graphTitle: resolvedGraphTitle,
              }));
            }
            return;
          }
        }

        // DiscoverEE graph_id sessions: saved curves come from DiscoverEE only (no Render/local restore).
        console.log('[DEBUG] DiscoverEE unavailable or incomplete for graph_id; skipping Render/local saved curves.');
        logGraphImageAvailability(graphId, '', 'discoveree-fallback-skipped', {
            discovereeResponse: 'failed-or-empty',
          });
          setShouldSkipCaptureChoiceAfterAi(false);
      } catch (error) {
        console.error('[DEBUG] Error in fetchGraphById:', error);
      }
    };
    fetchGraphById().finally(() => setIsInitialGraphFetchPending(false));
  }, []); // graphId is parsed from URL directly

  // Keep saved curves in localStorage after initial fetch completes (backup for any state updates).
  useEffect(() => {
    if (isInitialGraphFetchPending) return;

    const graphId = String(urlParams.graph_id || activeSessionGraphIdRef.current || '').trim();
    if (!graphId || savedCurves.length === 0) return;

    const curvesForGraph = savedCurves.filter(
      (curve) => (curve.graphId || getGraphIdForCurve(curve)) === graphId
    );
    if (curvesForGraph.length === 0) return;

    persistSavedCurves(graphId, curvesForGraph, savedCurvesSource);
  }, [savedCurves, urlParams.graph_id, savedCurvesSource, isInitialGraphFetchPending]);

  // Auto-load graph context (image + axis settings) and restore saved curve points after refresh.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const graphId = searchParams.get('graph_id');
    
    if (graphId && savedCurves.length > 0) {
      if (autoLoadedGraphIdRef.current === graphId) {
        return;
      }
      autoLoadedGraphIdRef.current = graphId;

      const firstCurve = savedCurves[0];
      console.log('[DEBUG] Auto-loading graph context with saved curve points:', firstCurve.id);

      const autoLoadCandidates = [
        firstCurve.graphImageUrl,
        firstCurve.graph_img,
        savedCurves.find((curve) => curve?.graphImageUrl || curve?.graph_img)?.graphImageUrl,
        savedCurves.find((curve) => curve?.graphImageUrl || curve?.graph_img)?.graph_img,
        getValidatedPersistedGraphImage(graphId),
      ].filter(Boolean);

      if (!uploadedImage) {
        (async () => {
          const backendMirroredImage = await fetchMirroredGraphImageFromBackend(apiUrl, graphId);
          const resolvedSavedImage = await resolveFirstReachableImageUrl(
            backendMirroredImage ? [backendMirroredImage, ...autoLoadCandidates] : autoLoadCandidates
          );

      logGraphImageAvailability(graphId || firstCurve.graphId || getGraphIdForCurve(firstCurve), resolvedSavedImage, 'auto-load-graph-context', {
        firstCurveId: firstCurve.id,
      });
      
      if (resolvedSavedImage) {
        console.log('[DEBUG] Setting graph image:', resolvedSavedImage);
        setUploadedImageFromExistingGraph(resolvedSavedImage);
            if (isEmbeddedGraphImage(resolvedSavedImage)) {
              persistGraphImage(graphId, resolvedSavedImage);
            }
          } else {
            console.warn('[GRAPH_IMAGE] No reachable image URL for graph_id:', graphId);
          }
        })();
      }

      restoreGraphDisplayFromSavedCurve(firstCurve, graphId, {
        keepCurveNameEmpty: true,
        allCurves: savedCurves,
        loadPoints: false,
        graphAreaOverride:
          graphAreaRef.current?.width > 0 && graphAreaRef.current?.height > 0
            ? graphAreaRef.current
            : null,
      });
      setShowCaptureAnotherGuidance(true);
      setIsReadOnly(false);

      console.log('[DEBUG] Graph context restored after refresh (overlay points hidden until View/Edit).');
    }
  }, [savedCurves, uploadedImage, replaceDataPoints, setGraphConfig, setUploadedImage]);

  // Keep blue box + axis mapping in localStorage so refresh restores them.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const graphId = String(searchParams.get('graph_id') || activeSessionGraphIdRef.current || '').trim();
    if (!graphId || graphArea.width <= 0 || graphArea.height <= 0) return;
    persistGraphContext(
      graphId,
      graphArea,
      graphConfig,
      {
        persistAxis: isAxisMappingConfirmed || hasValidAxisMapping(graphConfig),
        plotReferenceLocked: isAxisMappingConfirmed,
        plotReferenceArea: isAxisMappingConfirmed ? plotReferenceArea : graphArea,
      }
    );
  }, [
    graphArea.x,
    graphArea.y,
    graphArea.width,
    graphArea.height,
    plotReferenceArea.x,
    plotReferenceArea.y,
    plotReferenceArea.width,
    plotReferenceArea.height,
    isAxisMappingConfirmed,
    graphConfig.xMin,
    graphConfig.xMax,
    graphConfig.yMin,
    graphConfig.yMax,
    graphConfig.xScale,
    graphConfig.yScale,
    graphConfig.xUnitPrefix,
    graphConfig.yUnitPrefix,
    graphConfig.xLabel,
    graphConfig.yLabel,
  ]);

  // One-time blue-box auto-fit from imported AI points (skip if user moved box or area was persisted).
  useEffect(() => {
    if (importedBoxAutoFitDoneRef.current) return;
    if (userManuallyAdjustedGraphAreaRef.current) return;
    if (Boolean(editingCurveId)) return;
    if (isReadOnly) return;
    if (Boolean(selectedCurveId) || Boolean(combinedGroupId) || showAllCombinedModal) return;
    if (!uploadedImage) return;
    if (graphArea.width <= 0 || graphArea.height <= 0) return;
    if (!hasValidAxisMapping(graphConfig)) return;

    const importedPoints = dataPoints.some((point) => point?.imported)
      ? dataPoints.filter((point) => point?.imported && Number.isFinite(point.x) && Number.isFinite(point.y))
      : (() => {
          const searchParams = new URLSearchParams(window.location.search);
          const graphId = String(searchParams.get('graph_id') || activeSessionGraphIdRef.current || '').trim();
          const curvesForGraph = savedCurves.filter(
            (curve) => !graphId || String(curve.graphId || getGraphIdForCurve(curve) || '') === graphId
          );
          const overlayCurves = curvesForGraph.length > 0 ? curvesForGraph : savedCurves;
          return buildCombinedOverlayPoints(overlayCurves);
        })();
    if (importedPoints.length < 2) return;

    const searchParams = new URLSearchParams(window.location.search);
    const graphId = String(searchParams.get('graph_id') || activeSessionGraphIdRef.current || '').trim();
    if (graphId) {
      const persistedArea = normalizePersistedGraphArea(getPersistedGraphContext(graphId)?.graphArea);
      if (persistedArea) {
        importedBoxAutoFitDoneRef.current = true;
        return;
      }
    }

    const suggested = suggestGraphAreaFromImportedPoints(importedPoints, graphArea, graphConfig);
    importedBoxAutoFitDoneRef.current = true;
    if (!suggested || graphAreasAreSimilar(suggested, graphArea)) return;

    setGraphArea(suggested);
  }, [
    uploadedImage,
    graphArea.x,
    graphArea.y,
    graphArea.width,
    graphArea.height,
    graphConfig.xMin,
    graphConfig.xMax,
    graphConfig.yMin,
    graphConfig.yMax,
    graphConfig.xScale,
    graphConfig.yScale,
    dataPoints,
    savedCurves,
    editingCurveId,
    isReadOnly,
    selectedCurveId,
    combinedGroupId,
    showAllCombinedModal,
    setGraphArea,
  ]);

  // Keep imported AI overlay dots aligned with the current graph box + axis setup.
  useEffect(() => {
    if (Boolean(editingCurveId)) return;
    if (graphArea.width <= 0 || graphArea.height <= 0) return;
    if (!hasValidAxisMapping(graphConfig)) return;
    if (!dataPoints.some((point) => point.imported)) return;

    const mappingArea = getMappingArea();
    const syncedPoints = syncImportedOverlayCanvas(
      dataPoints,
      mappingArea.width > 0 ? mappingArea : graphArea,
      graphConfig
    );
    if (syncedPoints !== dataPoints) {
      replaceDataPoints(syncedPoints);
    }
  }, [
    editingCurveId,
    graphArea.x,
    graphArea.y,
    graphArea.width,
    graphArea.height,
    graphConfig.xMin,
    graphConfig.xMax,
    graphConfig.yMin,
    graphConfig.yMax,
    graphConfig.xScale,
    graphConfig.yScale,
    dataPoints,
    replaceDataPoints,
  ]);

  // Auto-scroll to Saved Graphs when opening with graph_id so edit/remove actions are visible immediately.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const graphId = searchParams.get('graph_id');

    if (!graphId || savedCurves.length === 0 || hasAutoScrolledToSavedGraphs.current) {
      return;
    }

    hasAutoScrolledToSavedGraphs.current = true;

    window.requestAnimationFrame(() => {
      if (savedGraphsSectionRef.current) {
        savedGraphsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }, [savedCurves.length, uploadedImage]);

  const resolveGraphImageForCompanyPayload = () => {
    const graphId = String(urlParams.graph_id || '').trim();
    const existingCurveForGraphId = graphId
      ? savedCurves.find((curve) => (curve.graphId || getGraphIdForCurve(curve)) === graphId)
      : null;

    return (
      normalizeImageCandidate(
        uploadedImage ||
        activeSessionImageKeyRef.current ||
        previousUploadedImageRef.current ||
        restoredPendingImageRef.current ||
        restoredPendingCapture?.imageBase64 ||
        (graphId ? getValidatedPersistedGraphImage(graphId) : '') ||
        selectedCurve?.graphImageUrl ||
        selectedCurve?.graph_img ||
        existingCurveForGraphId?.graphImageUrl ||
        existingCurveForGraphId?.graph_img ||
        ''
      ) || ''
    );
  };

  const saveCurveToBackend = async ({ allowRedirect }) => {
    if (isSaving) {
      console.warn('Save ignored: request already in progress.');
      return null;
    }

    console.log('=== SAVE CURVE STARTED ===');
    console.log('GraphConfig:', graphConfig);
    console.log('DataPoints count:', dataPoints.length);
    console.log('DataPoints:', dataPoints);

    const manualCapturePoints = getManualCapturePoints(dataPoints);

    const graphTitle = String(graphConfig.graphTitle || '').trim();
    const curveName = String(graphConfig.curveName || '').trim();
    const xTitle = String(graphConfig.xLabel || '').trim();
    const yTitle = String(graphConfig.yLabel || '').trim();

    if (!graphTitle || !curveName || !xTitle || !yTitle) {
      const missingFields = [];
      if (!graphTitle) missingFields.push('Graph Title');
      if (!curveName) missingFields.push('Curve or Line Name');
      if (!xTitle) missingFields.push('X Title');
      if (!yTitle) missingFields.push('Y Title');
      alert(`Please enter required fields: ${missingFields.join(', ')}`);
      return null;
    }
    if (manualCapturePoints.length === 0) {
      console.error('Validation failed: No data points captured');
      alert('Please capture at least one data point');
      return null;
    }

    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);

    console.log('Parsed min/max values:', { xMin, xMax, yMin, yMax });

    if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) {
      console.error('Validation failed: Invalid numeric values');
      alert('Please enter valid numeric values for all min/max fields');
      return null;
    }
    if (xMin >= xMax) {
      console.error('Validation failed: X-axis min >= max');
      alert('X-axis: Min must be less than Max');
      return null;
    }
    if (yMin >= yMax) {
      console.error('Validation failed: Y-axis min >= max');
      alert('Y-axis: Min must be less than Max');
      return null;
    }

    setIsSaving(true);
    try {
      const startTime = Date.now();
      const { unique: uniquePoints, removed: removedDuplicatePoints } = dedupePointsByXY(manualCapturePoints, 6);
      if (removedDuplicatePoints > 0) {
        console.warn(`[POINT_DEDUP] Removed ${removedDuplicatePoints} duplicate XY point(s) before saving.`);
      }

      const resolvedTemperature = resolveTemperatureForSave(graphConfig.temperature, shouldShowTemperatureInput);
      console.log('[TEMP_DEBUG] Local backend payload temperature', {
        rawInput: String(graphConfig.temperature || ''),
        resolvedTemperatureCelsius: resolvedTemperature,
        shouldDefaultRoomTemperature: shouldShowTemperatureInput,
      });

      const resolvedGraphImage = resolveGraphImageForCompanyPayload() || null;

      const payload = {
        part_number: urlParams.partno || graphConfig.partNumber || null,
        curve_name: urlParams.curve_title || graphConfig.curveName,
        x_scale: graphConfig.xScale,
        y_scale: graphConfig.yScale,
        x_unit: graphConfig.xUnitPrefix,
        y_unit: graphConfig.yUnitPrefix,
        x_min: parseFloat(graphConfig.xMin),
        x_max: parseFloat(graphConfig.xMax),
        y_min: parseFloat(graphConfig.yMin),
        y_max: parseFloat(graphConfig.yMax),
        temperature: resolvedTemperature,
        manufacturer: urlParams.manufacturer || graphConfig.manufacturer || null,
        graph_title: graphConfig.graphTitle || urlParams.graph_title || null,
        x_label: graphConfig.xLabel || urlParams.x_label || null,
        y_label: graphConfig.yLabel || urlParams.y_label || null,
        other_symbols: urlParams.other_symbols || null,
        discoveree_cat_id: urlParams.discoveree_cat_id ? parseInt(urlParams.discoveree_cat_id) : null,
        discoveree_graph_id: urlParams.graph_id ? String(urlParams.graph_id) : null,
        graph_image: resolvedGraphImage,
        data_points: uniquePoints.map((point) => ({
          x_value: point.x,
          y_value: point.y,
        })),
      };

      console.log('URL Params extracted:', urlParams);
      console.log('Backend payload being sent:', payload);
      console.log('Data points to be saved:', payload.data_points);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      console.log(`Making POST request to: ${apiUrl}/api/curves`);
      const response = await fetch(`${apiUrl}/api/curves`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      console.log('Backend response status:', response.status);
      console.log(`Backend request took ${(elapsed / 1000).toFixed(1)}s`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Backend error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}. ${errorData.detail || ''}`);
      }

      const result = await response.json();
      console.log('Backend save successful! Response:', result);
      console.log('Graph ID from backend:', result.id);

      const graphImageUrl = resolveGraphImageForCompanyPayload();
      const graphGroupId = buildGraphGroupId(graphImageUrl || '');
      console.log('Local save successful, calling sendToCompanyDatabase...');
      const companyResult = await sendToCompanyDatabase(graphImageUrl, result.id, allowRedirect);
      const companyGraphId = companyResult?.graphId ?? null;
      const companyDetailId = companyResult?.detailId ?? null;
      const companyIdentifier = companyResult?.identifier ?? '';
      console.log('sendToCompanyDatabase returned:', {
        graphId: companyGraphId,
        detailId: companyDetailId,
        identifier: companyIdentifier,
      });

      if (!companyGraphId) {
        setIsSaving(false);
        return null;
      }

      // Re-fetch from company API to get the real detail ID for the newly created curve
      let realDetailId = '';
      let detailsVerifiedOnDiscoveree = false;
      if (companyGraphId) {
        try {
          console.log('[RE-FETCH] Fetching details for graph_id:', companyGraphId);
          const { details: refetchDetails, result: refetchResult } = await fetchCompanyGraphDetailsWithRetry(
            companyGraphId
          );
          if (refetchResult) {
            console.log('[RE-FETCH] Full API response:', refetchResult);
            }
            
            console.log('[RE-FETCH] Parsed details array:', {
              totalDetails: refetchDetails.length,
              details: refetchDetails.map((d, idx) => ({ 
                idx, 
                id: d?.id, 
                curve_title: d?.curve_title,
              xy: d?.xy ? d.xy.substring(0, 50) + '...' : 'no xy',
              })),
            });
            
          if (refetchDetails.length === 0) {
            console.warn('[CAPTURE MANUALLY DEBUG]', {
              graph_id: String(companyGraphId || ''),
              post_response: 'success',
              get_details_count: 0,
              verify_url: `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(companyGraphId || '')}`,
            });
          } else {
            detailsVerifiedOnDiscoveree = true;

            const usedDetailIds = new Set(
              savedCurves.map((curve) => String(curve.detailId || '')).filter(Boolean)
            );
            const savedPoints = payload?.data_points || [];

            realDetailId = resolveDetailIdFromRefetch({
              refetchDetails,
              savedPoints,
              curveTitle: payload.curve_name,
              usedDetailIds,
              immediateDetailId: companyDetailId,
            });

            if (realDetailId) {
              console.log('[RE-FETCH] ✓ Resolved detail_id:', realDetailId);
            } else {
              console.warn('[RE-FETCH] Could not resolve a unique detail_id from company API', {
                usedDetailIds: [...usedDetailIds],
                totalDetails: refetchDetails.length,
              });
            }
          }
        } catch (refetchErr) {
          console.error('[RE-FETCH] Error fetching details:', refetchErr.message);
        }
      }
      
      if (!realDetailId) {
        console.warn('[DETAIL_ID] Could not extract detail_id from Company API. Will store empty value.');
      }

      const savedCurve = {
        id: realDetailId ? `${companyGraphId}_${realDetailId}` : result.id,
        graphId: String(companyGraphId || ''),
        identifier: String(companyIdentifier || ''),
        discoveree_cat_id: String(urlParams.discoveree_cat_id || companyGraphId || ''),
        detailId: realDetailId,
        testuser_id: urlParams.testuser_id || '',
        name: payload.curve_name,
        points: payload.data_points,
        symbolValues: { ...symbolValues },
        config: {
          ...graphConfig,
          temperature: resolveTemperatureForSave(graphConfig.temperature, shouldShowTemperatureInput),
          logDataModeX: graphConfig.xScale === 'Logarithmic' ? 'actual' : 'linear',
          logDataModeY: graphConfig.yScale === 'Logarithmic' ? 'actual' : 'linear',
        },
        graphGroupId,
        graphImageUrl,
        updatedAt: Date.now(),
        locallyModified: true,
      };
      console.log('Saving curve with config:', savedCurve.config);
      console.log('xUnitPrefix:', savedCurve.config.xUnitPrefix);
      console.log('yUnitPrefix:', savedCurve.config.yUnitPrefix);
      
      // CRITICAL: Validate that this curve has a unique detail_id
      const duplicateDetailId = savedCurves.some(curve => curve.detailId && curve.detailId === savedCurve.detailId);
      if (duplicateDetailId && savedCurve.detailId) {
        console.error('[CRITICAL] Duplicate detail_id detected!', {
          currentCurveDetailId: savedCurve.detailId,
          existingCurveDetailIds: savedCurves.map(c => c.detailId),
          issue: 'Multiple curves have the same detail_id - Company API may have merged them',
        });
        savedCurve.detailId = '';
        savedCurve.id = result.id;
      }
      
      if (savedCurve.detailId) {
        console.log('[DETAIL_ID_ASSIGNMENT] New curve assigned detail_id:', {
          detailId: savedCurve.detailId,
          graphId: savedCurve.graphId,
          identifier: savedCurve.identifier,
          curveIndex: savedCurves.length,
        });
      }
      
      setSavedCurves((prev) => {
        const next = [...prev, savedCurve];
        const persistGraphId = String(urlParams.graph_id || companyGraphId || '').trim();
        if (persistGraphId) {
          const curvesForGraph = next.filter(
            (curve) => (curve.graphId || getGraphIdForCurve(curve)) === persistGraphId
          );
          persistSavedCurves(persistGraphId, curvesForGraph, savedCurvesSource);
        }
        return next;
      });

      const persistGraphId = String(urlParams.graph_id || companyGraphId || '').trim();
      if (persistGraphId && graphArea.width > 0 && graphArea.height > 0) {
        persistGraphContext(persistGraphId, graphArea, graphConfig, {
          persistAxis: true,
          plotReferenceLocked: isAxisMappingConfirmed,
          plotReferenceArea: isAxisMappingConfirmed ? plotReferenceArea : graphArea,
        });
      }

      clearDataPoints();
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        curveName: '',
      }));
      setShowCaptureAnotherGuidance(true);
      setIsReadOnly(false);
      setIsSaving(false);

      if (!urlParams.return_url) {
        if (detailsVerifiedOnDiscoveree) {
          alert('Data saved successfully!');
        } else {
          alert(`Save completed. API did not return any curve details (graph_id ${companyGraphId}).`);
        }
      }

      return result.id;
    } catch (error) {
      console.error('=== SAVE CURVE ERROR ===');
      console.error('Full error object:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);

      if (error.name === 'AbortError') {
        console.error('Abort error - request timed out');
        alert('Request timed out. The server may be starting up (takes 1-2 minutes on first use). Please try again.');
      } else {
        console.error('Other error in saveCurveToBackend');
        alert('Error saving curve: ' + error.message + '\n\nMake sure backend is running or try again if server is starting up.');
      }
      setIsSaving(false);
      return null;
    }
  };

  const handleSave = async () => {
    await saveCurveToBackend({ allowRedirect: true });
  };

  const handleSaveDataPoints = async () => {
    await saveCurveToBackend({ allowRedirect: false });
  };

  const handleCaptureAnotherCurve = () => {
    console.log('[CAPTURE ANOTHER] Starting capture of next curve', {
      sessionGraphId: activeSessionGraphIdRef.current,
      sessionIdentifier: activeSessionIdentifierRef.current,
      currentUrl: window.location.href,
    });
    // Close the modal and continue on the same graph. saveCurveToBackend already cleared
    // points, cleared curve name, and enabled next-curve guidance while keeping axis locked.
    setShowReturnDecisionModal(false);
    setPendingReturnUrl('');
    setShowCaptureAnotherGuidance(true);

    // Clear the selected curve details modal if any is open
    setSelectedCurveId('');
    setCombinedGroupId('');
    setShowAllCombinedModal(false);
    
    // Verify session state is still intact after closing modal
    setTimeout(() => {
      const checkUrl = new URL(window.location.href);
      const urlGraphId = checkUrl.searchParams.get('graph_id');
      const urlIdentifier = checkUrl.searchParams.get('identifier');
      console.log('[CAPTURE ANOTHER] Session state after UI reset:', {
        refGraphId: activeSessionGraphIdRef.current,
        refIdentifier: activeSessionIdentifierRef.current,
        urlGraphId,
        urlIdentifier,
        sessionPreserved: Boolean(activeSessionGraphIdRef.current && activeSessionIdentifierRef.current),
      });
    }, 0);
  };

  const handleReturnNow = () => {
    if (pendingReturnUrl) {
      window.location.href = pendingReturnUrl;
      return;
    }

    if (urlParams.return_url) {
      const searchParams = new URLSearchParams(window.location.search);
      const graphIdForReturn =
        searchParams.get('graph_id') ||
        urlParams.graph_id ||
        selectedCurve?.discoveree_cat_id ||
        selectedCurve?.id ||
        '';
      const returnUrl = constructReturnUrl(urlParams.return_url, graphIdForReturn);
      window.location.href = returnUrl;
      return;
    }

    setShowReturnDecisionModal(false);
  };

  const handleCancelAndReturn = () => {
    if (urlParams.return_url) {
      const searchParams = new URLSearchParams(window.location.search);
      const graphIdForReturn =
        searchParams.get('graph_id') ||
        urlParams.graph_id ||
        selectedCurve?.discoveree_cat_id ||
        selectedCurve?.id ||
        '';
      const returnUrl = constructReturnUrl(urlParams.return_url, graphIdForReturn);
      window.location.href = returnUrl;
    }
  };

  const sendToCompanyDatabase = async (graphImageUrl, graphId, allowRedirect) => {
    // ============================================================
    // TESTING MODE: Set to false to skip actual API call
    // ============================================================
    const SEND_TO_API = true;

    console.log('=== SENDING TO COMPANY DATABASE STARTED ===');
    console.log('Local Graph ID:', graphId);
    console.log('Graph Image URL:', graphImageUrl);
    console.log('Full dataPoints object from context:', dataPoints);
    console.log('dataPoints type:', typeof dataPoints);
    console.log('dataPoints is array?:', Array.isArray(dataPoints));

    try {
      console.log('Before filtering - dataPoints length:', dataPoints ? dataPoints.length : 'dataPoints is null/undefined');

      const { unique: uniquePointsForCompanyApi, removed: removedDuplicatesForCompanyApi } = dedupePointsByXY(
        getManualCapturePoints(dataPoints),
        6
      );
      if (removedDuplicatesForCompanyApi > 0) {
        console.warn(`[POINT_DEDUP] Removed ${removedDuplicatesForCompanyApi} duplicate XY point(s) before company API send.`);
      }

      const xyPoints = uniquePointsForCompanyApi
        .filter((point) => {
          console.log(
            `  Checking point:`,
            point,
            `isFinite(x)=${Number.isFinite(point.x)}, isFinite(y)=${Number.isFinite(point.y)}`
          );
          return Number.isFinite(point.x) && Number.isFinite(point.y);
        })
        .map((point) => ({
          x: String(point.x),
          y: String(point.y),
        }));

      console.log('Raw data points count:', dataPoints.length);
      console.log('Filtered valid XY Points count:', xyPoints.length);
      console.log('Filtered XY Points being sent:', xyPoints);

      if (xyPoints.length === 0) {
        console.error('No valid data points after filtering');
        alert('No valid data points to send to the company API.');
        return false;
      }

      console.log('Symbol values (Text):', formatSymbolValuesAsText(symbolValues));
      const dfOnlyValues = Object.fromEntries(Object.entries(symbolValues).filter(([k]) => k.startsWith('df_')));
      console.table(dfOnlyValues);
      const resolvedTemperature = resolveTemperatureForSave(graphConfig.temperature, shouldShowTemperatureInput);
      console.log('[TEMP_DEBUG] Company API temperature before payload build', {
        rawInput: String(graphConfig.temperature || ''),
        resolvedTemperatureCelsius: resolvedTemperature,
        shouldDefaultRoomTemperature: shouldShowTemperatureInput,
      });

      const dynamicSymbolPayload = buildDynamicSymbolPayload(
        symbolValues,
        symbolLabels,
        symbolNames,
        resolvedTemperature
      );
      const tctjValue = dynamicSymbolPayload.legacyTctjValue;
      console.log('TCTJ Value (plain string):', tctjValue);

      const detailPayload = {
        curve_title: urlParams.curve_title || graphConfig.curveName || '',
        xy: xyPoints.map((point) => `{x:${point.x},y:${point.y}}`).join(','),
        xscale: graphConfig.xScale || '1',
        yscale: graphConfig.yScale || '1',
        xunit: graphConfig.xUnitPrefix || '1',
        yunit: graphConfig.yUnitPrefix || '1',
        x_min: Number.isFinite(Number.parseFloat(graphConfig.xMin)) ? Number.parseFloat(graphConfig.xMin) : undefined,
        x_max: Number.isFinite(Number.parseFloat(graphConfig.xMax)) ? Number.parseFloat(graphConfig.xMax) : undefined,
        y_min: Number.isFinite(Number.parseFloat(graphConfig.yMin)) ? Number.parseFloat(graphConfig.yMin) : undefined,
        y_max: Number.isFinite(Number.parseFloat(graphConfig.yMax)) ? Number.parseFloat(graphConfig.yMax) : undefined,
        // Include legacy key variants for upstream parsers that expect compact names.
        xmin: Number.isFinite(Number.parseFloat(graphConfig.xMin)) ? Number.parseFloat(graphConfig.xMin) : undefined,
        xmax: Number.isFinite(Number.parseFloat(graphConfig.xMax)) ? Number.parseFloat(graphConfig.xMax) : undefined,
        ymin: Number.isFinite(Number.parseFloat(graphConfig.yMin)) ? Number.parseFloat(graphConfig.yMin) : undefined,
        ymax: Number.isFinite(Number.parseFloat(graphConfig.yMax)) ? Number.parseFloat(graphConfig.yMax) : undefined,
      };

      const searchParams = new URLSearchParams(window.location.search);
      const incomingUrlGraphId =
        getLastNonEmptyQueryValue(searchParams, 'graph_id') ||
        String(urlParams.graph_id || '').trim() ||
        getLastNonEmptyQueryValue(searchParams, 'return_graph_id') ||
        String(activeSessionGraphIdRef.current || '').trim() ||
        String(savedCurves[0]?.graphId || '').trim() ||
        '';
      // Prefer URL graph_id, then in-session refs, so multi-curve append still works after refresh.
      const existingGraphId = incomingUrlGraphId;
      const existingGraphIdentifier = normalizeSessionIdentifier(
        getLastNonEmptyQueryValue(searchParams, 'identifier') ||
        urlParams.identifier ||
        (savedCurves[0]?.identifier ? String(savedCurves[0].identifier) : '')
      );
      const isAppendingToExistingGraph = Boolean(existingGraphId);
      // Use the stored session identifier (from original create-new save) to avoid API creating a new graph.
      // Falls back to URL identifier param, then to stored identifier from response.
      // CRITICAL: Never use graph_id as identifier fallback - this causes Company API to create new graphs!
      const appendIdentifier = resolveIdentifierForGraph({
        graphId: existingGraphId,
        curve: savedCurves.find(
          (savedCurve) => String(savedCurve?.graphId || '').trim() === String(existingGraphId).trim()
        ),
        savedCurves,
        urlParams,
        sessionGraphId: activeSessionGraphIdRef.current,
        sessionIdentifier: activeSessionIdentifierRef.current,
      }) || existingGraphIdentifier;

      console.log('=== GRAPH SESSION STATE BEFORE SAVE ===', {
        sessionActive: hasActiveAppendSessionRef.current,
        sessionGraphId: activeSessionGraphIdRef.current || '',
        incomingUrlGraphId,
        storedIdentifier: activeSessionIdentifierRef.current || '(none)',
        isAppendingToExistingGraph,
        currentUrlFull: window.location.href,
        allGraphIdParamsInUrl: searchParams.getAll('graph_id'),
        allIdentifierParamsInUrl: searchParams.getAll('identifier'),
        effectiveIdentifierForAppend: appendIdentifier || '(none)',
      });

      // Build the JSON payload for company's API
      const uniqueIdentifier = `usergraph_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      // Keep append identifier stable. If identifier is invalid (e.g. "0"), leave it empty and rely on graph_id.
      const resolvedOutgoingIdentifier = isAppendingToExistingGraph ? appendIdentifier : uniqueIdentifier;
      const effectiveGraphImageUrl =
        normalizeImageCandidate(graphImageUrl) || resolveGraphImageForCompanyPayload();
      if (effectiveGraphImageUrl && !normalizeImageCandidate(graphImageUrl)) {
        console.log('[GRAPH_IMG] Recovered graph image for company POST via save fallbacks.', {
          graphId: existingGraphId || '(create-new)',
          length: effectiveGraphImageUrl.length,
        });
      } else if (isAppendingToExistingGraph && !effectiveGraphImageUrl) {
        console.warn('[GRAPH_IMG] Append save has no graph image to send — graph_img will be omitted.', {
          graphId: existingGraphId,
        });
      }
      const companyApiPayload = {
        graph: {
          // Include graph_id explicitly during append to reduce graph split risk.
          graph_id: isAppendingToExistingGraph ? String(existingGraphId) : '',
          discoveree_cat_id: urlParams.discoveree_cat_id ? String(urlParams.discoveree_cat_id) : '',
          identifier: resolvedOutgoingIdentifier,
          partno: urlParams.partno || '',
          manf: urlParams.manf || urlParams.manufacturer || graphConfig.manufacturer || '',
          manufacturer: urlParams.manufacturer || graphConfig.manufacturer || '',
          graph_title: graphConfig.graphTitle || urlParams.graph_title || '',
          curve_title: urlParams.curve_title || graphConfig.curveName || '',
          x_title: graphConfig.xLabel || urlParams.x_label || '',
          y_title: graphConfig.yLabel || urlParams.y_label || '',
          ...(effectiveGraphImageUrl ? { graph_img: effectiveGraphImageUrl } : {}),
          mark_review: '1',
          testuser_id: urlParams.testuser_id || '',
          uname: urlParams.username || graphConfig.username || '',
          username: urlParams.username || graphConfig.username || '',
        },
        details: [detailPayload],
      };
      Object.entries(getGraphDynamicFieldValues(dynamicSymbolPayload)).forEach(([key, value]) => {
        companyApiPayload.graph[key] = value;
      });

      console.log('Complete Company API Payload - Graph object:', {
        ...companyApiPayload.graph,
        dynamicSymbolsText: formatSymbolValuesAsText(Object.fromEntries(
          Object.entries(companyApiPayload.graph).filter(([key]) => 
            !['graph_id', 'discoveree_cat_id', 'identifier', 'partno', 'manf', 'graph_title', 'curve_title', 'x_title', 'y_title', 'graph_img', 'mark_review', 'testuser_id'].includes(key)
          )
        )),
        dynamicSymbolsSql: formatSymbolValuesAsSql(Object.fromEntries(
          Object.entries(companyApiPayload.graph).filter(([key]) => 
            !['graph_id', 'discoveree_cat_id', 'identifier', 'partno', 'manf', 'graph_title', 'curve_title', 'x_title', 'y_title', 'graph_img', 'mark_review', 'testuser_id'].includes(key)
          )
        )),
      });
      console.log('Graph object:', companyApiPayload.graph);
      console.log('Details array (XY Points):', {
        xy: companyApiPayload.details[0]?.xy?.substring(0, 100) + '...',
        curve_title: companyApiPayload.details[0]?.curve_title,
        scales: `${companyApiPayload.details[0]?.xscale || '1'} x ${companyApiPayload.details[0]?.yscale || '1'}`,
      });

      // Skip API call if in testing mode
      if (!SEND_TO_API) {
        console.log('TESTING MODE: Skipping actual API call');
        // Simulate successful response for testing redirect
        if (allowRedirect && urlParams.return_url) {
          const returnUrl = constructReturnUrl(urlParams.return_url, graphId);
          console.log('Return URL found. Showing decision modal:', returnUrl);
          setPendingReturnUrl(returnUrl);
          setShowReturnDecisionModal(true);
        } else {
          alert('Data saved to local backend successfully! (API call skipped for testing)');
        }
        return null;
      }

      const COMPANY_API_SAVE_URL = isAppendingToExistingGraph
        ? `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(existingGraphId)}`
        : 'https://www.discoveree.io/graph_capture_api.php';

      console.log('Company save mode:', isAppendingToExistingGraph ? 'append-existing-graph' : 'create-new-graph', {
        existingGraphId,
        existingGraphIdentifier: appendIdentifier,
        sentGraphId: companyApiPayload?.graph?.graph_id || '',
        sentIdentifier: companyApiPayload?.graph?.identifier || '(none)',
      });

      console.log('Making request to Company API:', COMPANY_API_SAVE_URL);
      console.log('Request body:', JSON.stringify(companyApiPayload, null, 2));

      const response = await fetch(COMPANY_API_SAVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(companyApiPayload),
      });

      console.log('Company API Response status:', response.status);
      console.log('Company API Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Company API Error response:', errorData);
        throw new Error(`Company API error! status: ${response.status}. ${errorData.detail || errorData.message || ''}`);
      }

      const rawText = await response.text();
      // Strip any non-JSON prefix/wrapper (handles JSONP like FF({...}) or FF{...})
      const jsonMatch = rawText.match(/[{\[][\s\S]*[}\]]/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      console.log('Company API Response received:', result);
      console.log('Company Graph ID from API:', result?.graph_id);
      const returnedGraphId = result?.graph_id ? String(result.graph_id) : '';
      const requestedGraphId = isAppendingToExistingGraph ? String(existingGraphId || '') : '';
      const appendGraphMismatch = Boolean(
        isAppendingToExistingGraph && requestedGraphId && returnedGraphId && returnedGraphId !== requestedGraphId
      );
      const effectiveGraphId =
        appendGraphMismatch && returnedGraphId ? returnedGraphId : (returnedGraphId || requestedGraphId);
      const companyGraphId = effectiveGraphId || null;

      if (result?.status && result.status !== 'success') {
        throw new Error(result?.msg || 'Company API returned non-success status');
      }

      if (!companyGraphId || String(companyGraphId).trim() === '' || String(companyGraphId) === '0') {
        throw new Error('Company API did not return a valid graph_id');
      }
      
      // Extract detail_id from multiple possible locations in API response
      let companyDetailId = '';
      if (result?.detail_id) {
        companyDetailId = result.detail_id;
        console.log('[DETAIL_ID] Found in result.detail_id:', companyDetailId);
      } else if (result?.details && Array.isArray(result.details) && result.details.length > 0) {
        companyDetailId = result.details[0]?.id;
        console.log('[DETAIL_ID] Found in result.details[0].id:', companyDetailId);
      } else if (result?.graph?.detail_id) {
        companyDetailId = result.graph.detail_id;
        console.log('[DETAIL_ID] Found in result.graph.detail_id:', companyDetailId);
      } else if (result?.graph?.details && Array.isArray(result.graph.details) && result.graph.details.length > 0) {
        companyDetailId = result.graph.details[0]?.id;
        console.log('[DETAIL_ID] Found in result.graph.details[0].id:', companyDetailId);
      } else {
        console.warn('[DETAIL_ID] Not found in immediate API response - will attempt re-fetch');
      }
      
      console.log('[DETAIL_ID_FROM_API] Company API response analysis:', {
        hasDetailId: Boolean(companyDetailId),
        foundDetailId: companyDetailId || '(will re-fetch)',
        graphId: companyGraphId,
        responseKeys: Object.keys(result || {}),
      });

      if (appendGraphMismatch) {
        console.warn('Graph ID mismatch during append. Company API saved to a different graph_id; switching session to returned id.', {
          requestedGraphId,
          returnedGraphId,
          effectiveGraphId,
        });
      }

      // Store the identifier used for this create-new save so subsequent appends use the same one.
      if (companyGraphId && resolvedOutgoingIdentifier) {
        activeSessionIdentifierRef.current = resolvedOutgoingIdentifier;
        persistStableGraphIdentifier(companyGraphId, resolvedOutgoingIdentifier);
      }
      if (companyGraphId) {
        if (uploadedImage && isEmbeddedGraphImage(uploadedImage)) {
          persistGraphImage(companyGraphId, uploadedImage);
        } else if (effectiveGraphImageUrl && isEmbeddedGraphImage(effectiveGraphImageUrl)) {
          persistGraphImage(companyGraphId, effectiveGraphImageUrl);
        }
        void mirrorGraphImageToBackend(
          apiUrl,
          String(companyGraphId),
          effectiveGraphImageUrl || uploadedImage,
          { localCurveId: graphId }
        );
      }
      console.log('Company Detail ID from API:', companyDetailId);
      console.log('=== GRAPH ID CONSISTENCY CHECK (SAVE) ===', {
        mode: isAppendingToExistingGraph ? 'append-existing-graph' : 'create-new-graph',
        requestedGraphId,
        sentGraphId: String(companyApiPayload?.graph?.graph_id || ''),
        sentIdentifier: String(companyApiPayload?.graph?.identifier || ''),
        returnedGraphId,
        effectiveGraphId,
        returnedDetailId: companyDetailId,
        matchesRequested: !requestedGraphId || requestedGraphId === returnedGraphId,
        note: 'If matchesRequested is false during append-existing-graph, API is returning a different graph_id than requested.',
      });
      
      // CRITICAL: Verify identifier and detail_id consistency
      console.log('=== IDENTIFIER + DETAIL_ID FLOW ===', {
        sentIdentifier: String(companyApiPayload?.graph?.identifier || ''),
        returnedGraphId,
        returnedDetailId: companyDetailId,
        willBeStoredInRef: true,
        willBeStoredInSavedCurves: true,
        nextSaveShouldUseStoredIdentifier: 'YES - prevents Company API from creating new graphs',
      });
      // CRITICAL: Verify all curves in session have the same graph_id
      const curvesInThisSession = savedCurves.filter(curve => (curve.graphId || getGraphIdForCurve(curve)) === String(companyGraphId));
      const otherGraphIds = savedCurves.map(curve => curve.graphId || getGraphIdForCurve(curve)).filter(id => id !== String(companyGraphId));
      
      if (otherGraphIds.length > 0) {
        console.warn('[GRAPH_ID_WARNING] Multiple graph_ids found in local savedCurves state.', {
          currentCurveGraphId: String(companyGraphId),
          otherGraphIdsInSavedCurves: [...new Set(otherGraphIds)],
          issue: 'Multiple different graph_ids in same session - curves may have been split across graphs',
          affectedCurves: savedCurves.map((c, idx) => ({ 
            index: idx, 
            graphId: c.graphId || getGraphIdForCurve(c), 
            identifier: c.identifier,
            detailId: c.detailId,
          })),
        });
      } else {
        console.log('[GRAPH_ID_VALIDATION] All curves in session share same graph_id ✓', {
          graphId: companyGraphId,
          curvesWithThisId: curvesInThisSession.length,
        });
      }
      
      if (companyGraphId) {
        // CRITICAL: syncGraphIdContext must store both graph_id AND identifier to preserve session for next curve capture
        syncGraphIdContext(companyGraphId, resolvedOutgoingIdentifier);
        syncAxisTitleContext(graphConfig.xLabel, graphConfig.yLabel);
        // Verify identifier was stored in ref (double-check for safety)
        if (resolvedOutgoingIdentifier && !activeSessionIdentifierRef.current) {
          activeSessionIdentifierRef.current = resolvedOutgoingIdentifier;
          console.log('[CRITICAL] Manually ensured identifier ref was set:', resolvedOutgoingIdentifier);
        }
        
        // Verify URL was updated correctly
        const checkUrl = new URL(window.location.href);
        const urlGraphId = checkUrl.searchParams.get('graph_id');
        console.log('[URL_VALIDATION] After syncGraphIdContext:', {
          graphIdInUrl: urlGraphId,
          expectedGraphId: String(companyGraphId),
          urlMatches: urlGraphId === String(companyGraphId),
          fullUrl: window.location.href,
        });
      }

      // Update local backend with the real discoveree_cat_id
      if (companyGraphId && graphId) {
        console.log('Updating local curve with discoveree_cat_id:', companyGraphId);
        try {
          const updateResponse = await fetch(`${apiUrl}/api/curves/${graphId}/discoveree-id?discoveree_cat_id=${companyGraphId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          if (updateResponse.ok) {
            console.log('Successfully updated local curve with discoveree_cat_id');
          } else {
            console.warn('Failed to update local curve with discoveree_cat_id');
          }
        } catch (updateError) {
          console.error('Error updating local curve:', updateError);
          // Don't fail the whole operation if update fails
        }
      }

      // Handle return URL redirect if configured
      if (allowRedirect && urlParams.return_url && companyGraphId) {
        console.log('Return URL found, constructing redirect...');
        const returnUrl = constructReturnUrl(urlParams.return_url, companyGraphId);
        console.log('Final redirect URL:', returnUrl);
        console.log('Showing decision modal for capture another vs return.');
        setPendingReturnUrl(returnUrl);
        setShowReturnDecisionModal(true);
      } else {
        // Do not show a second success message
        console.log('No return URL - data saved.');
      }
      return { 
        graphId: companyGraphId, 
        detailId: companyDetailId ? String(companyDetailId) : '',
        identifier: resolvedOutgoingIdentifier,
      };
    } catch (error) {
      console.error('Full error object:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);

      // Check if it's a CORS or network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        console.error('Detected CORS/Network error');
        alert(
          'Error saving to company database: Network or CORS error.\n\nThis is likely a CORS issue. The API at discoveree.io needs to allow requests from Netlify.\n\nPlease contact the API administrator to add CORS headers for: https://graph-capture.netlify.app'
        );
      } else {
        console.error('Other error detected');
        alert('Error saving to company database: ' + error.message);
      }
      return null;
    }
  };

  const constructReturnUrl = (baseUrl, graphId) => {
    console.log('=== CONSTRUCTING RETURN URL ===');
    console.log('Base URL:', baseUrl);
    console.log('Graph ID:', graphId);
    console.log('Return params to add:', returnParams);

    const url = new URL(baseUrl);

    // Add return parameters
    Object.entries(returnParams).forEach(([key, value]) => {
      console.log(`Adding param: ${key} = ${value}`);
      url.searchParams.append(key, value);
    });

    // Add all symbol values with their return parameter names (dynamic)
    // Only add if the value is not just the friendly label
    const activeSymbolValues =
      selectedCurve?.symbolValues && Object.keys(selectedCurve.symbolValues).length > 0
        ? selectedCurve.symbolValues
        : symbolValues;

    Object.entries(activeSymbolValues).forEach(([paramName, value]) => {
      const friendlyLabel = symbolLabels[paramName];
      // Only add if value exists and is not the friendly label itself
      if (value && value !== friendlyLabel) {
        console.log(`Adding return_${paramName} = ${value}`);
        url.searchParams.append(`return_${paramName}`, value);
      }
    });

    // Add return_graph_id
    if (graphId) {
      console.log(`Adding return_graph_id = ${graphId}`);
      url.searchParams.append('return_graph_id', graphId);
    }

    return url.toString();
  };

  const handleViewSavedPoints = async () => {
    setShowSavedPanel(true);
    setIsFetchingSaved(true);
    setSavedCurvesError('');
    try {
      // Company database view API endpoint
      const COMPANY_API_VIEW_URL =
        'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11';
      if (!COMPANY_API_VIEW_URL) {
        throw new Error('Company view API not configured');
      }
      const response = await fetch(COMPANY_API_VIEW_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      const curves = Array.isArray(result)
        ? result
        : Array.isArray(result.data)
          ? result.data
          : Array.isArray(result.results)
            ? result.results
            : Array.isArray(result.curves)
              ? result.curves
              : [];
      setSavedCurves(curves);
      setSavedCurvesSource('company');
      if (!curves || curves.length === 0) {
        setSavedCurvesError('No saved curves found.');
      }
    } catch (error) {
      setSavedCurvesError('Unable to load saved curves. Please try again.');
    } finally {
      setIsFetchingSaved(false);
    }
  };

  const handleLoadSavedCurve = async () => {
    if (!selectedCurveId) {
      return;
    }
    if (savedCurvesSource === 'company') {
      setSavedCurvesError('Loading points is only available for local saved curves.');
      return;
    }
    setIsLoadingSavedCurve(true);
    setSavedCurvesError('');
    try {
      const response = await fetch(`${apiUrl}/api/curves/${selectedCurveId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const curve = await response.json();
      setGraphConfig({
        ...graphConfig,
        partNumber: curve.part_number ?? '',
        curveName: curve.curve_name ?? '',
        xLabel: curve.x_label ?? '',
        yLabel: curve.y_label ?? '',
        xScale: curve.x_scale ?? 'Linear',
        yScale: curve.y_scale ?? 'Linear',
        xUnitPrefix: curve.x_unit ?? '',
        yUnitPrefix: curve.y_unit ?? '',
        xMin: curve.x_min !== null && curve.x_min !== undefined ? String(curve.x_min) : '',
        xMax: curve.x_max !== null && curve.x_max !== undefined ? String(curve.x_max) : '',
        yMin: curve.y_min !== null && curve.y_min !== undefined ? String(curve.y_min) : '',
        yMax: curve.y_max !== null && curve.y_max !== undefined ? String(curve.y_max) : '',
        temperature: curve.temperature ?? '',
      });

      const loadedPoints = Array.isArray(curve.data_points)
        ? curve.data_points.map((point) => ({
            x: point.x_value,
            y: point.y_value,
            imported: true,
            overlayCurveId: String(curve.id ?? 'saved'),
          }))
        : [];

      replaceDataPoints(loadedPoints);
      setIsReadOnly(true);
    } catch (error) {
      setSavedCurvesError('Unable to load the selected curve. Please try again.');
    } finally {
      setIsLoadingSavedCurve(false);
    }
  };

  const handleExportCSV = () => {
    const manualCapturePoints = getManualCapturePoints(dataPoints);
    if (manualCapturePoints.length === 0) {
      alert('No data points to export');
      return;
    }

    // Generate CSV content
    let csv = 'X Value,Y Value\n';
    manualCapturePoints.forEach((point) => {
      const x = typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(6) : 'Invalid';
      const y = typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(6) : 'Invalid';
      csv += `${x},${y}\n`;
    });

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphConfig.curveName || 'curve'}_data.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleViewCompanyDatabase = () => {
    // ============================================================
    // TODO: ENTER YOUR COMPANY'S DATABASE VIEW API/URL HERE
    // Replace 'YOUR_COMPANY_API_VIEW_URL' with your actual viewing endpoint
    // Example: 'https://your-company-dashboard.com/results'
    // ============================================================
    const COMPANY_API_VIEW_URL =
      'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11';

    if (
      COMPANY_API_VIEW_URL ===
      'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11'
    ) {
      alert('Company database view URL not configured. Please enter your URL in the code.');
      return;
    }

    // Open the company's database view in a new tab
    window.open(COMPANY_API_VIEW_URL, '_blank');
  };

  const scrollToGraphWorkspace = () => {
    requestAnimationFrame(() => {
      graphWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="w-full min-h-screen p-8" style={{ backgroundColor: '#ffffff', color: '#213547' }}>
      {(isAiExtractionLoading || aiFlowStatusMessage || isInitialGraphFetchPending) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-md bg-white px-5 py-3 text-sm font-medium" style={{ color: '#213547' }}>
            {isInitialGraphFetchPending
              ? 'Loading graph...'
              : isAiExtractionLoading
                ? 'AI extraction in progress, please wait...'
                : aiFlowStatusMessage}
          </div>
        </div>
      )}
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#213547' }}>
          Graph Capture Tool
        </h1>
        {!!urlParams.return_url && (
          <button
            onClick={handleCancelAndReturn}
            className="px-4 py-2 rounded bg-red-600 text-white font-medium"
          >
            Cancel and Return
          </button>
        )}
        {/* <p className="text-gray-600">Upload graph images and extract data points easily</p> */}
      </header>

      <div className="flex flex-col gap-8">
        <ImageUpload
          onImageLoaded={handleUserImageLoaded}
          onAiExtensionCapture={handleAiExtensionCapture}
          isAiExtractionLoading={isAiExtractionLoading}
          skipCaptureChoice={shouldSkipCaptureChoiceAfterAi}
          initialPendingCapture={restoredPendingCapture}
          onPendingCaptureChange={setHasPendingCaptureChoice}
        />
        {(showCaptureWorkspace) && (
          <>
            {graphLoadNotice ? (
              <div className="w-full rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {graphLoadNotice}
              </div>
            ) : null}
          <div ref={graphWorkspaceRef} className="flex flex-col lg:flex-row gap-8">
            <div className="w-full lg:w-2/5 flex flex-col gap-4">
              <GraphCanvas
                isReadOnly={isReadOnly}
                partNumber={urlParams.partno}
                manufacturer={urlParams.manufacturer || graphConfig.manufacturer}
                isAxisMappingConfirmed={isAxisMappingConfirmed}
                hasReturnUrl={!!urlParams.return_url}
                isEditingCurve={Boolean(editingCurveId)}
                editingCurveOverlayId={editingCurveId ? String(editingCurveId) : ''}
                savedCurveViewActive={Boolean((selectedCurveId || combinedGroupId || showAllCombinedModal) && !editingCurveId)}
                hasAiSavedCurves={savedCurves.length > 0 && savedCurvesSource === 'company'}
                showAiCaptureGuidance={aiCaptureGuidanceActive}
                useInsetDefaultAxisBox={Boolean(
                  urlParams.graph_id ||
                  dataPoints.some((point) => point.imported) ||
                  savedCurves.some((curve) => String(curve.graphId || '').trim() !== '')
                )}
                onGraphAreaManuallyAdjusted={handleGraphAreaManuallyAdjusted}
                onImageSizeChange={(size) => {
                  imageSizeRef.current = size;
                }}
              />
              <CapturedPointsList isReadOnly={isReadOnly} hasReturnUrl={!!urlParams.return_url} isEditingCurve={Boolean(editingCurveId)} isAxisMappingConfirmed={isAxisMappingConfirmed} />
            </div>
            <div className="w-full lg:w-3/5">
              {allowNextCurveNameEntry ? (
                <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {isAxisMappingConfirmed ? (
                    <>
                      Curve saved. Enter a new <strong>Curve or Line Name</strong>, capture points on the graph, then click <strong>Save Data Points</strong> again. Axis mapping stays locked for this graph.
                    </>
                  ) : (
                    <>
                      Enter a new curve or line name, then click <strong>Final Check</strong> to capture the next curve.
                    </>
                  )}
                </div>
              ) : null}
              <GraphConfig 
                showTctj={shouldShowTemperatureInput} 
                isGraphTitleReadOnly={Boolean(urlParams.graph_id || urlParams.graph_title) && !graphTitleUnlocked} 
                isCurveNameReadOnly={false} 
                isXTitleReadOnly={isXTitleUrlLocked}
                isYTitleReadOnly={isYTitleUrlLocked}
                initialCurveName={urlParams.curve_title} 
                initialGraphTitle={urlParams.graph_title}
                initialXTitle={urlParams.x_label}
                initialYTitle={urlParams.y_label}
                companyGraphId={String(
                  urlParams.graph_id || savedCurves[0]?.graphId || ''
                ).trim()}
                sessionSavedCurves={savedCurves}
                isAxisMappingConfirmed={isAxisMappingConfirmed}
                allowNextCurveNameEntry={allowNextCurveNameEntry}
                isEditingCurve={Boolean(editingCurveId)}
                isPartNumberFromUrl={Boolean(urlParams.partno)}
                isPartNumberLocked={partNumberLocked}
                showManufacturerField={!Boolean(urlParams.manufacturer)}
                showUsernameField={!Boolean(urlParams.username)}
                onConfirmAxisMapping={() => {
                  const captureArea = graphArea;
                  const plotRef = resolveLockedPlotReferenceArea(
                    captureArea,
                    graphConfig,
                    imageSizeRef.current
                  );
                  const mappingArea =
                    plotRef.width > 0 && plotRef.height > 0 ? plotRef : captureArea;
                  const syncedPoints = syncImportedOverlayCanvas(
                    dataPoints,
                    mappingArea,
                    graphConfig
                  );
                  if (syncedPoints !== dataPoints) {
                    replaceDataPoints(syncedPoints);
                  }
                  lockPlotReference(plotRef);
                  setIsAxisMappingConfirmed(true);
                  setFrozenGraphConfig({ ...graphConfig });
                  setPartNumberLocked(true);
                  setShowCaptureAnotherGuidance(false);
                  const graphId = String(urlParams.graph_id || activeSessionGraphIdRef.current || '').trim();
                  if (graphId && captureArea.width > 0 && captureArea.height > 0) {
                    persistGraphContext(graphId, captureArea, graphConfig, {
                      plotReferenceArea: plotRef,
                      plotReferenceLocked: true,
                    });
                    setSavedCurves((prev) => {
                      const patched = patchSavedCurvesWithAxisConfig(prev, graphConfig, graphId);
                      const curvesForGraph = patched.filter(
                        (curve) => (curve.graphId || getGraphIdForCurve(curve)) === graphId
                      );
                      if (curvesForGraph.length > 0) {
                        persistSavedCurves(graphId, curvesForGraph, savedCurvesSource);
                      }
                      return patched;
                    });
                  }
                }}
                onRetakeAxis={() => {
                  unlockPlotReference();
                  setIsAxisMappingConfirmed(false);
                  setFrozenGraphConfig(null);
                  setShowCaptureAnotherGuidance(false);
                }}
              >
                {/* Dynamic Symbol Input Boxes - Only show if other_symb exists in URL */}
                {visibleSymbolNames.length > 0 && (
                  <div className="p-4 border rounded" style={{ backgroundColor: '#ffffff', borderColor: 'var(--color-border)' }}>
                    {visibleSymbolNames.map((symbol) => {
                      // Use the friendly label stored in symbolLabels map
                      const displayLabel = getSymbolDisplayLabel(symbol);
                      return (
                      <div key={symbol} className="mb-3">
                        <label className="block mb-1 text-sm font-medium" style={{ color: '#213547' }}>
                          {displayLabel}
                        </label>
                        <input
                          type="text"
                          value={resolveSymbolValue(symbolValues, symbol, symbolNames)}
                          onChange={(e) => setSymbolValues({ ...symbolValues, [symbol]: e.target.value })}
                          disabled={Boolean(editingCurveId)}
                          placeholder={`Enter value for ${displayLabel}`}
                          className="w-full px-3 py-2 border rounded text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          style={{
                            color: '#213547',
                            backgroundColor: editingCurveId ? '#f3f4f6' : '#ffffff',
                            borderColor: 'var(--color-border)',
                          }}
                        />
                      </div>
                      );
                    })}
                  </div>
                )}
              </GraphConfig>

              <div className="mt-6 flex flex-row gap-4 items-center">
                {urlParams.graph_title === 'rth_cth' ? (
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 rounded bg-blue-600 text-white font-medium disabled:opacity-50"
                    disabled={isSaving}
                  >
                    Fit, convert and export to RC ladder sim
                  </button>
                ) : !!urlParams.return_url ? (
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 rounded bg-blue-600 text-white font-medium disabled:opacity-50"
                    disabled={isSaving}
                  >
                    Submit
                  </button>
                ) : (
                  <button
                    onClick={handleSaveDataPoints}
                    className="px-4 py-2 rounded bg-green-600 text-white font-medium disabled:opacity-50"
                    disabled={isSaving}
                  >
                    Save Data Points
                  </button>
                )}
                {!!urlParams.return_url ? (
                  <>
                    <button
                      onClick={handleReturnNow}
                      className="px-4 py-2 rounded bg-blue-600 text-white font-medium border-none shadow-none disabled:opacity-50"
                      style={{ backgroundColor: '#2563eb' }}
                      disabled={isSaving || isRemovingAllGraphs}
                    >
                      Return to Original Page
                    </button>
                    <button
                      onClick={handleRemoveAllGraphs}
                      className="px-4 py-2 rounded bg-red-600 text-white font-medium disabled:opacity-50"
                      style={{ backgroundColor: '#dc2626' }}
                      disabled={isSaving || isRemovingAllGraphs || savedCurves.length === 0}
                    >
                      {isRemovingAllGraphs ? 'Removing All Graphs...' : 'Remove All Graphs'}
                    </button>
                  </>
                ) : null}
                {isSaving ? (
                  <span className="text-sm" style={{ color: '#6b7280' }}>
                    Processing...
                  </span>
                ) : null}
              </div>

              {/* Saved Graphs Section */}
              {savedCurves.length > 0 && (
                <div
                  ref={savedGraphsSectionRef}
                  className="mt-10 p-4 rounded shadow"
                  style={{ backgroundColor: '#ffffff', color: '#213547', border: '1px solid var(--color-border)' }}
                >
                  <h2 className="text-lg font-bold mb-4" style={{ color: '#213547' }}>
                    Saved Graphs
                  </h2>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      className="px-3 py-1 rounded bg-yellow-400 text-black text-xs"
                      style={{ backgroundColor: '#facc15', color: '#111827', borderColor: '#facc15' }}
                      onClick={handleViewAllCombinedGraphs}
                    >
                      View all graphs combined
                    </button>
                    <a
                      href={buildTcCheckerUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 rounded text-xs font-medium inline-flex items-center"
                      style={{
                        color: '#1d4ed8',
                        backgroundColor: '#eff6ff',
                        border: '1px solid #93c5fd',
                        textDecoration: 'none',
                      }}
                      title="Open plot checker to compare captured export against reference"
                    >
                      Check
                    </a>
                  </div>
                  <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-2">
                    {groupedCurves.map((group, groupIndex) => (
                      <div key={group.id} className="rounded p-3" style={{ border: '1px solid var(--color-border)', background: '#ffffff' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold" style={{ color: '#213547' }}>
                            {group.curves[0]?.config?.graphTitle || group.curves[0]?.graph_title || `Graph ${groupIndex + 1}`} ({group.curves.length} curves)
                          </div>
                          <div className="flex flex-wrap gap-2">
                          <button
                            className="px-3 py-1 rounded bg-gray-900 text-white text-xs"
                              onClick={() => handleViewCombinedGroup(group)}
                          >
                            View combined graph
                          </button>
                            <button
                              className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
                              onClick={() => handleExportGroupToTC(group)}
                              title="Export all curves in this graph to one HPPeval .tc file"
                            >
                              Export .tc
                            </button>
                            <button
                              className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
                              onClick={() => handleExportGroupToCSV(group)}
                              title="Download one combined CSV with all curves in this graph"
                            >
                              Export CSV
                            </button>
                            <button
                              className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
                              onClick={() => handleExportGroupToJSON(group)}
                              title="Download one combined JSON with all curves in this graph"
                            >
                              Export JSON
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {group.curves.map((curve) => (
                            <div
                              key={curve.id}
                              className="rounded p-3 hover:bg-gray-100"
                              style={{ backgroundColor: '#ffffff', color: '#213547', border: '1px solid var(--color-border)' }}
                            >
                              <div className="font-semibold mb-1" style={{ color: '#213547' }}>
                                {curve.config?.curveName || curve.curve_name || curve.name || `Curve #${curve.id}`}
                              </div>
                              <div className="text-xs mb-1">
                                Points:{' '}
                                {editingCurveId === curve.id
                                  ? normalizePointsForComparison(getEditCurveDataPoints(curve, dataPoints)).length
                                  : (curve.points?.length ?? curve.data_points?.length ?? 0)}
                              </div>
                              <div className="text-xs mb-2 text-gray-700">
                                Part number:{' '}
                                {resolveSavedPartNumber(
                                  curve.part_number,
                                  curve.config?.partNumber,
                                  graphConfig.partNumber,
                                  urlParams.partno
                                ) || '-'}
                                <br />
                                X unit: {getUnitLabel(curve.config?.xUnitPrefix || curve.x_unit) || '-'} | Y unit: {getUnitLabel(curve.config?.yUnitPrefix || curve.y_unit) || '-'}<br />
                                X scale: {curve.config?.xScale || curve.x_scale || '-'} | Y scale: {curve.config?.yScale || curve.y_scale || '-'}
                              </div>
                              {(() => {
                                const symbolEntries = getCurveSymbolMetadataEntries(curve);
                                if (symbolEntries.length === 0) return null;
                                return (
                                  <div className="text-xs mb-2 text-gray-700">
                                    {symbolEntries.map((entry, index) => (
                                      <span key={`${curve.id}_${entry.key}`}>
                                        {index > 0 ? ' | ' : ''}
                                        {entry.label}: {entry.value}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
                              {editingCurveId === curve.id ? (
                                <div className="mt-2">
                                  <label className="text-sm font-semibold text-gray-700 block mb-3">
                                    Part Number
                                    <input
                                      type="text"
                                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                      value={editPartNumber}
                                      onChange={(e) => setEditPartNumber(e.target.value)}
                                      placeholder="Enter part number"
                                    />
                                    <span className="block mt-1 text-xs font-normal text-gray-500">
                                      Applies to all curves on this graph.
                                    </span>
                                  </label>
                                  <label className="text-sm font-semibold text-gray-700 block mb-3">
                                    Curve Name
                                    <input
                                      type="text"
                                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                      value={editCurveName}
                                      onChange={(e) => setEditCurveName(e.target.value)}
                                      placeholder="Enter curve name"
                                    />
                                  </label>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="text-sm font-semibold text-gray-700">
                                      Y Scale
                                      <select
                                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                        value={editCurveMeta.yScale}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, yScale: e.target.value })}
                                      >
                                        <option value="Linear">Linear</option>
                                        <option value="Logarithmic">Logarithmic</option>
                                      </select>
                                    </label>
                                    <label className="text-sm font-semibold text-gray-700">
                                      Y Unit
                                      <select
                                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                        value={editCurveMeta.yUnitPrefix}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, yUnitPrefix: e.target.value })}
                                      >
                                        {unitOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="text-sm font-semibold text-gray-700">
                                      X Scale
                                      <select
                                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                        value={editCurveMeta.xScale}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, xScale: e.target.value })}
                                      >
                                        <option value="Linear">Linear</option>
                                        <option value="Logarithmic">Logarithmic</option>
                                      </select>
                                    </label>
                                    <label className="text-sm font-semibold text-gray-700">
                                      X Unit
                                      <select
                                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                        value={editCurveMeta.xUnitPrefix}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, xUnitPrefix: e.target.value })}
                                      >
                                        {unitOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                  <div className="mt-3 p-2 rounded border border-gray-200 bg-gray-50">
                                    <div className="text-sm font-bold text-gray-800 mb-2">
                                      Axis Range (applies to all curves on this graph)
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                      <label className="text-sm font-semibold text-gray-700">
                                        X Min
                                        <input
                                          type="text"
                                          className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                          value={editCurveMeta.xMin}
                                          onChange={(e) => handleEditAxisBoundChange('xMin', e.target.value)}
                                        />
                                      </label>
                                      <label className="text-sm font-semibold text-gray-700">
                                        X Max
                                        <input
                                          type="text"
                                          className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                          value={editCurveMeta.xMax}
                                          onChange={(e) => handleEditAxisBoundChange('xMax', e.target.value)}
                                        />
                                      </label>
                                      <label className="text-sm font-semibold text-gray-700">
                                        Y Min
                                        <input
                                          type="text"
                                          className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                          value={editCurveMeta.yMin}
                                          onChange={(e) => handleEditAxisBoundChange('yMin', e.target.value)}
                                        />
                                      </label>
                                      <label className="text-sm font-semibold text-gray-700">
                                        Y Max
                                        <input
                                          type="text"
                                          className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                          value={editCurveMeta.yMax}
                                          onChange={(e) => handleEditAxisBoundChange('yMax', e.target.value)}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                  {(() => {
                                    const editableSymbolKeys = Array.from(
                                      new Set([
                                        ...visibleSymbolNames,
                                        ...Object.keys(editCurveSymbolValues || {}),
                                      ].filter((symbol) => symbol && !isTemperatureSymbol(symbol, getSymbolDisplayLabel(symbol))))
                                    );

                                    if (editableSymbolKeys.length === 0) {
                                      return null;
                                    }

                                    return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                      {editableSymbolKeys.map((symbol) => {
                                        const displayLabel = getSymbolDisplayLabel(symbol);
                                        return (
                                          <label key={`${curve.id}_${symbol}`} className="text-sm font-semibold text-gray-700">
                                            {displayLabel}
                                            <input
                                              type="text"
                                              className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                                              value={resolveSymbolValue(editCurveSymbolValues, symbol, editableSymbolKeys)}
                                              onChange={(e) =>
                                                setEditCurveSymbolValues({
                                                  ...editCurveSymbolValues,
                                                  [symbol]: e.target.value,
                                                })
                                              }
                                            />
                                          </label>
                                        );
                                      })}
                                    </div>
                                    );
                                  })()}
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-semibold"
                                      onClick={() => handleEditCurveUpdate(curve.id)}
                                      disabled={isUpdatingCurveId === curve.id}
                                    >
                                      {isUpdatingCurveId === curve.id ? 'Updating...' : 'Update Data'}
                                    </button>
                                    <button
                                      className="px-3 py-1.5 rounded bg-gray-700 text-white text-sm font-semibold"
                                      onClick={handleEditCurveCancel}
                                    >
                                      Cancel Edit
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2 mt-2">
                                  <button
                                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs"
                                    onClick={() => handleViewCurve(curve)}
                                  >
                                    View
                                  </button>
                                  <button
                                    className="px-3 py-1 rounded bg-red-600 text-white text-xs"
                                    style={{ backgroundColor: '#dc2626' }}
                                    onClick={() => handleRemoveCurve(curve)}
                                    disabled={isRemovingCurveId === curve.id || isRemovingAllGraphs}
                                  >
                                    {isRemovingCurveId === curve.id ? 'Removing...' : 'Remove'}
                                  </button>
                                  <button
                                    className="px-3 py-1 rounded bg-yellow-500 text-white text-xs"
                                    onClick={() => handleEditCurveStart(curve)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
                                    onClick={() => handleDownloadCurve(curve)}
                                    title="Download this curve as CSV and JSON"
                                  >
                                    Download
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Temporarily disabled - View Saved Points button */}
              {/* <div className="mt-4">
                <button
                  onClick={handleViewSavedPoints}
                  className="px-4 py-2 rounded border border-gray-400 text-gray-700 bg-white disabled:opacity-50"
                  disabled={isFetchingSaved}
                >
                  {isFetchingSaved ? 'Loading Saved Points...' : 'View Saved Points'}
                </button>

                {showSavedPanel ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      border: '1px solid #ddd',
                      borderRadius: 8,
                      backgroundColor: '#fafafa',
                    }}
                  >
                    {savedCurvesError ? (
                      <div style={{ color: '#d32f2f', marginBottom: 8 }}>{savedCurvesError}</div>
                    ) : null}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={selectedCurveId}
                        onChange={(e) => setSelectedCurveId(e.target.value)}
                        style={{ minWidth: 220, padding: 6 }}
                      >
                        <option value="">Select a saved curve</option>
                        {savedCurves.map((curve, index) => {
                          const curveId = curve.id ?? curve.graph_id ?? index + 1;
                          const curveLabel = curve.curve_name || curve.curve_title || curve.graph_title || `Curve ${curveId}`;
                          return (
                            <option key={curveId} value={curveId}>
                              {curveLabel} (ID: {curveId})
                            </option>
                          );
                        })}
                      </select>
                      <button
                        onClick={handleLoadSavedCurve}
                        className="btn btn-primary"
                        disabled={!selectedCurveId || isLoadingSavedCurve}
                      >
                        {isLoadingSavedCurve ? 'Loading...' : 'Load Saved Points'}
                      </button>
                    </div>
                    {isReadOnly ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
                        Loaded points are read-only.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div> */}
            </div>
          </div>
          </>
        )}

      </div>

      {showReturnDecisionModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.35)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowReturnDecisionModal(false)}
        >
          <div
            style={{
              background: '#fff',
              color: '#213547',
              borderRadius: 8,
              minWidth: 420,
              maxWidth: 520,
              boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-2" style={{ color: '#213547', fontSize: 18 }}>
              Curve saved successfully
            </div>
            <div className="text-sm mb-4" style={{ color: '#4b5563' }}>
              Do you want to capture another curve?
            </div>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white font-medium"
                onClick={handleCaptureAnotherCurve}
              >
                Yes, capture another
              </button>
              <button
                className="px-4 py-2 rounded bg-gray-800 text-white font-medium"
                onClick={handleReturnNow}
              >
                No, return now
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedCurve && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: `rgba(0,0,0,${viewModalBackdropOpacity})`,
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <ViewModalPanel
            title={selectedCurve.name || `Curve #${selectedCurve.id}`}
            layout={singleModalLayout}
            onLayoutChange={setSingleModalLayout}
            interactionRef={singleDragRef}
            onClose={() => {
              setSingleModalLayout(null);
            setSelectedCurveId('');
              setViewModalTableVisible(true);
              clearSavedViewOverlay();
            }}
            defaultWidth={640}
            minWidth={520}
            maxWidth={720}
          >
            <ViewModalBackdropDimControl
              value={viewModalBackdropOpacity}
              onChange={setViewModalBackdropOpacity}
            />
            {(() => {
              const cfg = normalizeCurveConfig(selectedCurve);
              const previewGraphId = String(
                selectedCurve?.graphId || urlParams.graph_id || activeSessionGraphIdRef.current || ''
              ).trim();
              const bounds = resolveAxisBoundsForGraphPreview([selectedCurve], {
                graphId: previewGraphId,
                liveGraphConfig: graphConfig,
              });
              const dataBounds = resolveDataBoundsFromCurves([selectedCurve]);
              const xTitle = cfg.xLabel || urlParams.x_label || '';
              const yTitle = cfg.yLabel || urlParams.y_label || '';
              const partNo = selectedCurve?.part_number || selectedCurve?.config?.partNumber || urlParams.partno || '';
              const showDataRange =
                bounds.source !== 'computed' &&
                Number.isFinite(dataBounds.yMin) &&
                Number.isFinite(dataBounds.yMax) &&
                Number.isFinite(bounds.yMin) &&
                Number.isFinite(bounds.yMax) &&
                Math.abs(dataBounds.yMax - dataBounds.yMin) < Math.abs(bounds.yMax - bounds.yMin) * 0.25;
              return (
                <div style={{ fontSize: 12, color: '#444', background: '#f5f5f5', borderRadius: 5, padding: '8px 12px', marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 24px' }}>
                  {partNo && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ fontWeight: 600 }}>Part Number:</span> {partNo}
                    </div>
                  )}
                  {cfg.graphTitle && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ fontWeight: 600 }}>Graph Title:</span> {cfg.graphTitle}
                    </div>
                  )}
                  {cfg.curveName && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ fontWeight: 600 }}>Curve Name:</span> {cfg.curveName}
                    </div>
                  )}
                  <div><span style={{ fontWeight: 600 }}>Axis X Min:</span> {formatDisplayValue(bounds.xMin)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis Y Min:</span> {formatDisplayValue(bounds.yMin)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis X Max:</span> {formatDisplayValue(bounds.xMax)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis Y Max:</span> {formatDisplayValue(bounds.yMax)}</div>
                  {showDataRange && (
                    <>
                      <div><span style={{ fontWeight: 600 }}>Data Y Min:</span> {formatDisplayValue(dataBounds.yMin)}</div>
                      <div><span style={{ fontWeight: 600 }}>Data Y Max:</span> {formatDisplayValue(dataBounds.yMax)}</div>
                    </>
                  )}
                  <div><span style={{ fontWeight: 600 }}>X Scale:</span> {cfg.xScale || '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Y Scale:</span> {cfg.yScale || '—'}</div>
                  {xTitle && <div><span style={{ fontWeight: 600 }}>X Title:</span> {xTitle}</div>}
                  {yTitle && <div><span style={{ fontWeight: 600 }}>Y Title:</span> {yTitle}</div>}
                  <div><span style={{ fontWeight: 600 }}>X Unit:</span> {getUnitLabel(cfg.xUnit) || '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Y Unit:</span> {getUnitLabel(cfg.yUnit) || '—'}</div>
                  {(() => {
                    const symbolEntries = getCurveSymbolMetadataEntries(selectedCurve);
                    if (symbolEntries.length === 0) return null;
                    return (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ fontWeight: 600 }}>Parameters:</span>{' '}
                        {symbolEntries.map((entry, index) => (
                          <span key={`${selectedCurve.id}_${entry.key}`}>
                            {index > 0 ? ' | ' : ''}
                            {entry.label}: {entry.value}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            <div className="mb-2 text-xs">Points: {selectedCurvePoints.length}</div>
            <a
              href={`https://www.discoveree.io/show_graph.php?graph_id=${encodeURIComponent(getGraphIdForCurve(selectedCurve) || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden"
              onClick={(event) => {
                if (!getGraphIdForCurve(selectedCurve)) {
                  event.preventDefault();
                  alert('Graph id is unavailable for this item.');
                }
              }}
              style={{ color: '#1d4ed8', textDecoration: 'underline', fontSize: 13 }}
            >
              View graph in new tab
            </a>
            <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>Point order (display only):</span>
              <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
                <button
                  type="button"
                  title="Use original capture sequence (the order you clicked points)"
                  onClick={() => setPreviewSortByX(false)}
                  style={{
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#475569' : '#1d4ed8',
                    color: previewSortByX ? '#ffffff' : '#fde047',
                    cursor: 'pointer',
                  }}
                >
                  Capture Order
                </button>
                <button
                  type="button"
                  title="Sort points left-to-right by X value"
                  onClick={() => setPreviewSortByX(true)}
                  style={{
                    border: 'none',
                    borderLeft: '1px solid #94a3b8',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#1d4ed8' : '#475569',
                    color: previewSortByX ? '#fde047' : '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  X-Sorted
                </button>
              </div>
            </div>
            <div className="text-xs" style={{ color: '#6b7280', marginBottom: 8 }}>
              Capture Order keeps the click sequence; X-Sorted reorders by X ascending. This changes display order only.
            </div>
            <div style={{ marginTop: 12 }}>
              <SavedGraphPreview
                points={selectedCurvePoints}
                config={buildSavedGraphPreviewConfig(selectedCurve, {
                  graphId: String(
                    selectedCurve?.graphId || urlParams.graph_id || activeSessionGraphIdRef.current || ''
                  ).trim(),
                  liveGraphConfig: graphConfig,
                  urlParams,
                })}
                width={600}
                height={240}
                animate
                sortByX={previewSortByX}
              />
            </div>
            <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  const cfg = normalizeCurveConfig(selectedCurve);
                  const xHdr = (cfg.xLabel || urlParams.x_label) ? `X[${cfg.xLabel || urlParams.x_label}]` : 'X';
                  const yHdr = (cfg.yLabel || urlParams.y_label) ? `Y[${cfg.yLabel || urlParams.y_label}]` : 'Y';
                  const headers = [xHdr, yHdr];
                  const rows = selectedCurvePoints.map((pt) => [
                    formatDisplayValue(pt.x_value ?? pt.x),
                    formatDisplayValue(pt.y_value ?? pt.y),
                  ]);
                  const tableData = [headers, ...rows].map((row) => row.join('\t')).join('\n');
                  navigator.clipboard.writeText(tableData).then(() => {
                    alert('Table copied to clipboard!');
                  }).catch((err) => {
                    console.error('Failed to copy:', err);
                    alert('Failed to copy to clipboard');
                  });
                }}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Copy Table
              </button>
              <button
                type="button"
                onClick={() => setViewModalTableVisible((prev) => !prev)}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#475569',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {viewModalTableVisible ? 'Hide Table' : 'Show Table'}
              </button>
            </div>
            {viewModalTableVisible ? (
            <table className="mt-2 w-full text-xs border" style={{ borderColor: 'var(--color-border)', marginTop: 12 }}>
              <thead>
                <tr style={{ backgroundColor: '#222', color: '#fff' }}>
                  <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>{(normalizeCurveConfig(selectedCurve).xLabel || urlParams.x_label) ? `X[${normalizeCurveConfig(selectedCurve).xLabel || urlParams.x_label}]` : 'X'}</th>
                  <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>{(normalizeCurveConfig(selectedCurve).yLabel || urlParams.y_label) ? `Y[${normalizeCurveConfig(selectedCurve).yLabel || urlParams.y_label}]` : 'Y'}</th>
                </tr>
              </thead>
              <tbody>
                {selectedCurvePoints.map((pt, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                      {formatDisplayValue(pt.x_value ?? pt.x)}
                    </td>
                    <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                      {formatDisplayValue(pt.y_value ?? pt.y)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            ) : null}
          </ViewModalPanel>
        </div>
      )}
      {selectedGroup && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: `rgba(0,0,0,${viewModalBackdropOpacity})`,
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <ViewModalPanel
            title={`Combined curves (${selectedGroup.curves.length})`}
            layout={combinedModalLayout}
            onLayoutChange={setCombinedModalLayout}
            interactionRef={combinedDragRef}
            onClose={() => {
              setCombinedModalLayout(null);
            setCombinedGroupId('');
              clearSavedViewOverlay();
            }}
            defaultWidth={760}
            minWidth={560}
            maxWidth={860}
            maxHeightFactor={0.88}
          >
            <ViewModalBackdropDimControl
              value={viewModalBackdropOpacity}
              onChange={setViewModalBackdropOpacity}
            />
            {(() => {
              const cfg = normalizeCurveConfig(selectedGroup.curves[0]);
              const previewGraphId = String(
                selectedGroup.curves[0]?.graphId ||
                urlParams.graph_id ||
                activeSessionGraphIdRef.current ||
                ''
              ).trim();
              const bounds = resolveAxisBoundsForGraphPreview(selectedGroup.curves, {
                graphId: previewGraphId,
                liveGraphConfig: graphConfig,
              });
              const dataBounds = resolveDataBoundsFromCurves(selectedGroup.curves);
              const showDataRange =
                bounds.source !== 'computed' &&
                Number.isFinite(dataBounds.yMin) &&
                Number.isFinite(dataBounds.yMax) &&
                Number.isFinite(bounds.yMin) &&
                Number.isFinite(bounds.yMax) &&
                Math.abs(dataBounds.yMax - dataBounds.yMin) < Math.abs(bounds.yMax - bounds.yMin) * 0.25;
              return (
                <div style={{ fontSize: 12, color: '#444', background: '#f5f5f5', borderRadius: 5, padding: '8px 12px', marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 24px' }}>
                  {cfg.graphTitle && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ fontWeight: 600 }}>Graph Title:</span> {cfg.graphTitle}
                    </div>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ fontWeight: 600 }}>Curves:</span>{' '}
                    {selectedGroup.curves.map((c, i) => (
                      <span key={i}>{i > 0 ? ', ' : ''}{c.config?.curveName || c.curve_name || c.name || `Curve ${i + 1}`}</span>
                    ))}
                  </div>
                  <div><span style={{ fontWeight: 600 }}>Axis X Min:</span> {formatDisplayValue(bounds.xMin)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis Y Min:</span> {formatDisplayValue(bounds.yMin)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis X Max:</span> {formatDisplayValue(bounds.xMax)}</div>
                  <div><span style={{ fontWeight: 600 }}>Axis Y Max:</span> {formatDisplayValue(bounds.yMax)}</div>
                  {showDataRange && (
                    <>
                      <div><span style={{ fontWeight: 600 }}>Data Y Min:</span> {formatDisplayValue(dataBounds.yMin)}</div>
                      <div><span style={{ fontWeight: 600 }}>Data Y Max:</span> {formatDisplayValue(dataBounds.yMax)}</div>
                    </>
                  )}
                  <div><span style={{ fontWeight: 600 }}>X Scale:</span> {cfg.xScale || '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Y Scale:</span> {cfg.yScale || '—'}</div>
                  {cfg.xLabel && <div><span style={{ fontWeight: 600 }}>X Title:</span> {cfg.xLabel}</div>}
                  {cfg.yLabel && <div><span style={{ fontWeight: 600 }}>Y Title:</span> {cfg.yLabel}</div>}
                  <div><span style={{ fontWeight: 600 }}>X Unit:</span> {getUnitLabel(cfg.xUnit) || '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Y Unit:</span> {getUnitLabel(cfg.yUnit) || '—'}</div>
                  {(() => {
                    const allEntries = selectedGroup.curves.flatMap((curve, curveIndex) =>
                      getCurveSymbolMetadataEntries(curve).map((entry) => ({
                        ...entry,
                        curveName:
                          curve.config?.curveName ||
                          curve.curve_name ||
                          curve.name ||
                          `Curve ${curveIndex + 1}`,
                      }))
                    );

                    if (allEntries.length === 0) return null;

                    return (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ fontWeight: 600 }}>Parameters:</span>{' '}
                        {allEntries.map((entry, index) => (
                          <span key={`${entry.curveName}_${entry.key}_${index}`}>
                            {index > 0 ? ' | ' : ''}
                            {entry.curveName} {entry.label}: {entry.value}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>Point order (display only):</span>
              <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
                <button
                  type="button"
                  title="Use original capture sequence (the order you clicked points)"
                  onClick={() => setPreviewSortByX(false)}
                  style={{
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#475569' : '#1d4ed8',
                    color: previewSortByX ? '#ffffff' : '#fde047',
                    cursor: 'pointer',
                  }}
                >
                  Capture Order
                </button>
                <button
                  type="button"
                  title="Sort points left-to-right by X value"
                  onClick={() => setPreviewSortByX(true)}
                  style={{
                    border: 'none',
                    borderLeft: '1px solid #94a3b8',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#1d4ed8' : '#475569',
                    color: previewSortByX ? '#fde047' : '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  X-Sorted
                </button>
              </div>
            </div>
            <div className="text-xs" style={{ color: '#6b7280', marginBottom: 8 }}>
              Capture Order keeps the click sequence; X-Sorted reorders by X ascending. This changes display order only.
            </div>
            <div style={{ marginTop: 12 }}>
              {selectedGroup.curves.length === 1 ? (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, background: '#ffffff' }}>
                <SavedGraphPreview
                  points={selectedGroup.curves[0]?.points ?? selectedGroup.curves[0]?.data_points ?? []}
                  config={buildSavedGraphPreviewConfig(selectedGroup.curves[0], {
                    graphId: String(
                      selectedGroup.curves[0]?.graphId ||
                      urlParams.graph_id ||
                      activeSessionGraphIdRef.current ||
                      ''
                    ).trim(),
                    liveGraphConfig: graphConfig,
                    urlParams,
                  })}
                  width={760}
                  height={300}
                  animate
                  sortByX={previewSortByX}
                />
                </div>
              ) : (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, background: '#ffffff' }}>
                  <div className="font-semibold mb-2" style={{ color: '#213547', fontSize: 14 }}>
                    X {normalizeCurveConfig(selectedGroup.curves[0]).xScale || 'Linear'}, Y {normalizeCurveConfig(selectedGroup.curves[0]).yScale || 'Linear'} ({selectedGroup.curves.length} curves)
                  </div>
                <SavedGraphCombinedPreview
                  curves={selectedGroup.curves}
                  config={buildSavedGraphCombinedPreviewConfig(selectedGroup.curves, {
                    graphId: String(
                      selectedGroup.curves[0]?.graphId ||
                      urlParams.graph_id ||
                      activeSessionGraphIdRef.current ||
                      ''
                    ).trim(),
                    liveGraphConfig: graphConfig,
                    urlParams,
                  })}
                  width={760}
                  height={300}
                  sortByX={previewSortByX}
                />
                </div>
              )}
            </div>
          </ViewModalPanel>
        </div>
      )}
      {showAllCombinedModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: `rgba(0,0,0,${viewModalBackdropOpacity})`,
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <ViewModalPanel
            title={`View all graphs combined (${uniqueSavedCurves.length} curves)`}
            layout={allCombinedModalLayout}
            onLayoutChange={setAllCombinedModalLayout}
            interactionRef={allCombinedDragRef}
            onClose={() => {
              setAllCombinedModalLayout(null);
              setShowAllCombinedModal(false);
              clearSavedViewOverlay();
            }}
            defaultWidth={760}
            minWidth={560}
            maxWidth={860}
            maxHeightFactor={0.88}
          >
            <ViewModalBackdropDimControl
              value={viewModalBackdropOpacity}
              onChange={setViewModalBackdropOpacity}
            />
            <div className="text-xs mb-3" style={{ color: '#4b5563' }}>
              Curves are grouped automatically by axis scale.
            </div>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>Point order (display only):</span>
              <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
                <button
                  type="button"
                  title="Use original capture sequence (the order you clicked points)"
                  onClick={() => setPreviewSortByX(false)}
                  style={{
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#475569' : '#1d4ed8',
                    color: previewSortByX ? '#ffffff' : '#fde047',
                    cursor: 'pointer',
                  }}
                >
                  Capture Order
                </button>
                <button
                  type="button"
                  title="Sort points left-to-right by X value"
                  onClick={() => setPreviewSortByX(true)}
                  style={{
                    border: 'none',
                    borderLeft: '1px solid #94a3b8',
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: previewSortByX ? '#1d4ed8' : '#475569',
                    color: previewSortByX ? '#fde047' : '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  X-Sorted
                </button>
              </div>
            </div>
            <div className="text-xs" style={{ color: '#6b7280', marginBottom: 10 }}>
              Capture Order keeps the click sequence; X-Sorted reorders by X ascending. This changes display order only.
            </div>
            {allScaleGroupedCurves.map((scaleGroup, idx) => (
              <div key={scaleGroup.id} style={{ marginBottom: 18, border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, background: '#ffffff' }}>
                <div className="font-semibold mb-2" style={{ color: '#213547', fontSize: 14 }}>
                  Group {idx + 1}: X {scaleGroup.xScale}, Y {scaleGroup.yScale} ({scaleGroup.curves.length} curves)
                </div>
                <SavedGraphCombinedPreview
                  curves={scaleGroup.curves}
                  config={{
                    ...buildSavedGraphCombinedPreviewConfig(scaleGroup.curves, {
                      graphId: String(
                        scaleGroup.curves[0]?.graphId ||
                        urlParams.graph_id ||
                        activeSessionGraphIdRef.current ||
                        ''
                      ).trim(),
                      liveGraphConfig: graphConfig,
                      urlParams,
                    }),
                    xScale: scaleGroup.xScale,
                    yScale: scaleGroup.yScale,
                  }}
                  width={760}
                  height={300}
                  sortByX={previewSortByX}
                />
              </div>
            ))}
          </ViewModalPanel>
        </div>
      )}
    </div>
  );
};

export default GraphCapture;


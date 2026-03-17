import ImageUpload from '../components/ImageUpload';
import GraphCanvas from '../components/GraphCanvas';
import GraphConfig from '../components/GraphConfig';
import CapturedPointsList from '../components/CapturedPointsList';
import SavedGraphPreview from '../components/SavedGraphPreview';
import SavedGraphCombinedPreview from '../components/SavedGraphCombinedPreview';
import { useGraph } from '../context/GraphContext';
import { useState, useEffect, useMemo, useRef } from 'react';

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

const buildGraphGroupId = (imageUrl) => {
  if (!imageUrl) return 'graph_unknown';
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i += 1) {
    hash = (hash * 31 + imageUrl.charCodeAt(i)) >>> 0;
  }
  return `graph_${hash.toString(36)}`;
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
  } = useGraph();
  const [isSaving, setIsSaving] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [savedCurves, setSavedCurves] = useState([]);
  const [combinedGroupId, setCombinedGroupId] = useState('');
  const [isFetchingSaved, setIsFetchingSaved] = useState(false);
  const [savedCurvesError, setSavedCurvesError] = useState('');
  const [selectedCurveId, setSelectedCurveId] = useState('');
  const [isLoadingSavedCurve, setIsLoadingSavedCurve] = useState(false);
  const [savedCurvesSource, setSavedCurvesSource] = useState('company');
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [isUpdatingCurveId, setIsUpdatingCurveId] = useState('');
  const [isRemovingCurveId, setIsRemovingCurveId] = useState('');
  const [isRemovingAllGraphs, setIsRemovingAllGraphs] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const [urlParams, setUrlParams] = useState({
    partno: '',
    manufacturer: '',
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

  const [symbolLabels, setSymbolLabels] = useState({});
  const [editCurveMeta, setEditCurveMeta] = useState({
    xScale: 'Linear',
    yScale: 'Linear',
    xUnitPrefix: '1',
    yUnitPrefix: '1',
  });
  const [editCurveSymbolValues, setEditCurveSymbolValues] = useState({});
  // State for axis confirmation and freezing (Issue 5 & 7)
  const [isAxisMappingConfirmed, setIsAxisMappingConfirmed] = useState(false);
  const [frozenGraphConfig, setFrozenGraphConfig] = useState(null);
  const [showReturnDecisionModal, setShowReturnDecisionModal] = useState(false);
  const [pendingReturnUrl, setPendingReturnUrl] = useState('');
  const savedGraphsSectionRef = useRef(null);
  const hasAutoScrolledToSavedGraphs = useRef(false);
  const autoLoadedGraphIdRef = useRef('');

  const selectedCurve = savedCurves.find((curve) => curve.id === selectedCurveId);
  const groupedCurves = useMemo(() => {
    if (!Array.isArray(savedCurves)) return [];
    const groups = new Map();

    savedCurves.forEach((curve, index) => {
      const imageUrl = curve.graphImageUrl ?? curve.graph_img ?? '';
      const groupId = curve.graphGroupId ?? buildGraphGroupId(imageUrl) ?? `graph_${index}`;
      const existing = groups.get(groupId) || {
        id: groupId,
        imageUrl,
        curves: [],
      };
      existing.curves.push(curve);
      groups.set(groupId, existing);
    });

    return Array.from(groups.values());
  }, [savedCurves]);
  const selectedGroup = groupedCurves.find((group) => group.id === combinedGroupId);
  const selectedCurvePoints = selectedCurve?.points ?? selectedCurve?.data_points ?? [];

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

  const normalizeCurveSymbolValues = (curve) => {
    if (curve?.symbolValues && typeof curve.symbolValues === 'object') {
      return { ...curve.symbolValues };
    }

    const rawTctj = curve?.config?.temperature ?? curve?.temperature ?? curve?.tctj;
    if (rawTctj && typeof rawTctj === 'object' && !Array.isArray(rawTctj)) {
      return { ...rawTctj };
    }

    if (rawTctj !== undefined && rawTctj !== null && rawTctj !== '') {
      if (symbolNames.length === 1) {
        return { [symbolNames[0]]: String(rawTctj) };
      }
      return { tctj: String(rawTctj) };
    }

    return { ...symbolValues };
  };

  const handleViewCurve = (curve) => {
    setSelectedCurveId(curve.id);
    const curveSymbols = normalizeCurveSymbolValues(curve);
    if (Object.keys(curveSymbols).length > 0) {
      setSymbolValues((prev) => ({ ...prev, ...curveSymbols }));
    }
  };

  const handleEditCurveStart = (curve) => {
    setEditingCurveId(curve.id);
    setEditCurveMeta({
      xScale: curve.config?.xScale || curve.x_scale || 'Linear',
      yScale: curve.config?.yScale || curve.y_scale || 'Linear',
      xUnitPrefix: curve.config?.xUnitPrefix || curve.x_unit || '1',
      yUnitPrefix: curve.config?.yUnitPrefix || curve.y_unit || '1',
    });
    setEditCurveSymbolValues(normalizeCurveSymbolValues(curve));
  };

  const handleEditCurveCancel = () => {
    setEditingCurveId('');
    setEditCurveSymbolValues({});
  };

  const getTctjValueFromSymbols = (symbols = {}, fallback = '') => {
    if (!symbols || typeof symbols !== 'object') {
      return fallback || '';
    }

    if (symbols.graph_tctj !== undefined && symbols.graph_tctj !== null && String(symbols.graph_tctj).trim() !== '') {
      return String(symbols.graph_tctj);
    }

    const nonEmptyEntries = Object.entries(symbols).filter(([, value]) =>
      value !== undefined && value !== null && String(value).trim() !== ''
    );

    if (nonEmptyEntries.length === 1) {
      return String(nonEmptyEntries[0][1]);
    }

    if (nonEmptyEntries.length > 1) {
      return nonEmptyEntries.map(([key, value]) => `${key}:${value}`).join(';');
    }

    return fallback || '';
  };

  const getGraphIdForCurve = (curve) => {
    if (curve?.discoveree_cat_id !== undefined && curve?.discoveree_cat_id !== null && String(curve.discoveree_cat_id) !== '') {
      return String(curve.discoveree_cat_id);
    }

    const rawId = String(curve?.id || '');
    if (rawId.includes('_')) {
      const [prefix] = rawId.split('_');
      if (prefix) return prefix;
    }

    return urlParams.graph_id ? String(urlParams.graph_id) : '';
  };

  const getDetailIdForCurve = (curve) => {
    if (curve?.detailId !== undefined && curve?.detailId !== null && String(curve.detailId).trim() !== '') {
      return String(curve.detailId);
    }

    const rawId = String(curve?.id || '');
    if (rawId.includes('_')) {
      const parts = rawId.split('_');
      const suffix = parts[parts.length - 1];
      if (suffix && /^\d+$/.test(suffix)) {
        return suffix;
      }
    }

    return '';
  };

  const pushEditedCurveToApi = async (curve, nextMeta, nextSymbols) => {
    const tctjValue = getTctjValueFromSymbols(nextSymbols, curve?.config?.temperature || curve?.temperature || '');
    const currentMeta = {
      xScale: curve.config?.xScale || curve.x_scale || 'Linear',
      yScale: curve.config?.yScale || curve.y_scale || 'Linear',
      xUnitPrefix: curve.config?.xUnitPrefix || curve.x_unit || '1',
      yUnitPrefix: curve.config?.yUnitPrefix || curve.y_unit || '1',
    };
    const currentTctjValue = getTctjValueFromSymbols(
      normalizeCurveSymbolValues(curve),
      curve?.config?.temperature || curve?.temperature || ''
    );
    const hasMetaChanges =
      currentMeta.xScale !== nextMeta.xScale ||
      currentMeta.yScale !== nextMeta.yScale ||
      currentMeta.xUnitPrefix !== nextMeta.xUnitPrefix ||
      currentMeta.yUnitPrefix !== nextMeta.yUnitPrefix;
    const hasTctjChange = String(currentTctjValue || '') !== String(tctjValue || '');

    if (!hasMetaChanges && !hasTctjChange) {
      throw new Error('No changes detected to update.');
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
      if (hasTctjChange) localPayload.temperature = tctjValue;

      const localUrl = `${apiUrl}/api/curves/${localCurveId}`;
      console.log('=== EDIT API REQUEST ===', {
        source: 'local',
        url: localUrl,
        method: 'PUT',
        payload: localPayload,
      });

      const localResponse = await fetch(localUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(localPayload),
      });

      const localResult = await localResponse.json().catch(() => ({}));
      console.log('=== EDIT API RESPONSE ===', {
        source: 'local',
        url: localUrl,
        status: localResponse.status,
        ok: localResponse.ok,
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

    const detailPayload = {
      curve_title: curve?.config?.curveName || curve?.curve_name || curve?.name || '',
    };
    if (curve?.detailId) detailPayload.id = String(curve.detailId);
    if (currentMeta.xScale !== nextMeta.xScale) detailPayload.xscale = nextMeta.xScale || 'Linear';
    if (currentMeta.yScale !== nextMeta.yScale) detailPayload.yscale = nextMeta.yScale || 'Linear';
    if (currentMeta.xUnitPrefix !== nextMeta.xUnitPrefix) detailPayload.xunit = nextMeta.xUnitPrefix || '1';
    if (currentMeta.yUnitPrefix !== nextMeta.yUnitPrefix) detailPayload.yunit = nextMeta.yUnitPrefix || '1';
    if (hasTctjChange) {
      detailPayload.tctj = tctjValue;
      detailPayload.df_tj = tctjValue;
    }

    const payload = {
      graph: {
        discoveree_cat_id: String(urlParams.discoveree_cat_id || companyGraphId),
        identifier: `edit_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      },
      details: [detailPayload],
    };

    const companyUrl = `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(companyGraphId)}`;
    console.log('=== EDIT API REQUEST ===', {
      source: 'company',
      targetGraphId: companyGraphId,
      targetDetailId: curve?.detailId || '',
      url: companyUrl,
      method: 'POST',
      payload,
    });

    const response = await fetch(companyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    console.log('=== EDIT API RESPONSE ===', {
      source: 'company',
      targetGraphId: companyGraphId,
      targetDetailId: curve?.detailId || '',
      url: companyUrl,
      status: response.status,
      ok: response.ok,
      response: result,
    });

    if (!response.ok) {
      throw new Error(`Company API update failed (${response.status})`);
    }

    if (result?.status && result.status !== 'success') {
      throw new Error(result?.msg || 'Company API returned non-success status');
    }
  };

  const handleEditCurveUpdate = async (curveId) => {
    const targetCurve = savedCurves.find((curve) => curve.id === curveId);
    if (!targetCurve) {
      alert('Unable to find the selected curve for update.');
      return;
    }

    setIsUpdatingCurveId(curveId);
    try {
      await pushEditedCurveToApi(targetCurve, editCurveMeta, editCurveSymbolValues);

      setSavedCurves((prev) =>
        prev.map((curve) => {
          if (curve.id !== curveId) return curve;
          return {
            ...curve,
            config: {
              ...(curve.config || {}),
              xScale: editCurveMeta.xScale,
              yScale: editCurveMeta.yScale,
              xUnitPrefix: editCurveMeta.xUnitPrefix,
              yUnitPrefix: editCurveMeta.yUnitPrefix,
            },
            symbolValues: { ...editCurveSymbolValues },
            x_scale: editCurveMeta.xScale,
            y_scale: editCurveMeta.yScale,
            x_unit: editCurveMeta.xUnitPrefix,
            y_unit: editCurveMeta.yUnitPrefix,
          };
        })
      );
      setEditingCurveId('');
      setEditCurveSymbolValues({});
      alert('Curve updated successfully.');
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
      console.log('=== REMOVE API REQUEST ===', {
        source: 'local',
        url: localUrl,
        method: 'DELETE',
      });

      const localResponse = await fetch(localUrl, {
        method: 'DELETE',
      });

      const localResult = await localResponse.json().catch(() => ({}));
      console.log('=== REMOVE API RESPONSE ===', {
        source: 'local',
        url: localUrl,
        status: localResponse.status,
        ok: localResponse.ok,
        response: localResult,
      });

      if (!localResponse.ok) {
        throw new Error(`Local remove failed (${localResponse.status})`);
      }

      return;
    }

    const graphId = curve.graphId || getGraphIdForCurve(curve);
    const detailId = getDetailIdForCurve(curve);
    const discovereeCatId = curve.discoveree_cat_id ? String(curve.discoveree_cat_id) : String(urlParams.discoveree_cat_id || '');
    const testuserId = String(urlParams.testuser_id || '');

    if (!graphId) {
      throw new Error('Missing graph_id for remove.');
    }

    if (!detailId) {
      console.error('Remove skipped: missing detail id', { curve });
      throw new Error('Missing curve id for remove.');
    }

    const removePayload = new URLSearchParams({
      action: 'remove',
      graph_id: String(graphId),
      id: detailId,
      discoveree_cat_id: discovereeCatId,
      testuser_id: testuserId,
    });

    const companyUrl = `https://www.discoveree.io/graph_capture_api.php?${removePayload.toString()}`;
    console.log('=== REMOVE API REQUEST ===', {
      source: 'company',
      targetGraphId: String(graphId),
      targetDetailId: detailId,
      url: companyUrl,
      method: 'GET',
      payload: Object.fromEntries(removePayload.entries()),
    });

    const response = await fetch(companyUrl, {
      method: 'GET',
    });

    const responseText = await response.text();
    let result = responseText;
    try {
      result = JSON.parse(responseText);
    } catch {
      // Keep raw text response when API does not return JSON.
    }

    console.log('=== REMOVE API RESPONSE ===', {
      source: 'company',
      targetGraphId: String(graphId),
      targetDetailId: detailId,
      url: companyUrl,
      status: response.status,
      ok: response.ok,
      response: result,
    });

    if (!response.ok) {
      throw new Error(`Company remove failed (${response.status})`);
    }
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
      setSavedCurves((prev) => prev.filter((item) => item.id !== curve.id));
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

    const confirmed = window.confirm(`Remove all graphs for graph_id ${activeGraphId || 'current selection'}?`);
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
    } catch (error) {
      console.error('Remove all API error:', error);
      alert(`Remove all failed: ${error.message}`);
    } finally {
      setIsRemovingAllGraphs(false);
    }
  };

  const normalizeCurveConfig = (curve) => ({
    xMin: curve?.config?.xMin ?? curve?.x_min,
    xMax: curve?.config?.xMax ?? curve?.x_max,
    yMin: curve?.config?.yMin ?? curve?.y_min,
    yMax: curve?.config?.yMax ?? curve?.y_max,
    xScale: curve?.config?.xScale ?? curve?.x_scale,
    yScale: curve?.config?.yScale ?? curve?.y_scale,
    xUnit: curve?.config?.xUnitPrefix ?? curve?.x_unit,
    yUnit: curve?.config?.yUnitPrefix ?? curve?.y_unit,
    xLabel: curve?.config?.xLabel ?? curve?.x_label,
    yLabel: curve?.config?.yLabel ?? curve?.y_label,
    graphTitle: curve?.config?.graphTitle ?? curve?.graph_title ?? curve?.name,
  });

  const toActualValue = (value, scale) => {
    if (scale !== 'Logarithmic') return value;
    return Math.pow(10, value);
  };

  const formatDisplayValue = (value, scale) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    const actual = toActualValue(num, scale);
    if (!Number.isFinite(actual)) return '';
    return (Math.abs(actual) > 0 && Math.abs(actual) < 0.0001)
      ? actual.toExponential(4)
      : actual.toFixed(4);
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
    
    symbolArray.forEach((symbolWithPotentialValue) => {
      if (symbolWithPotentialValue.includes('=')) {
        const [label, symbolValue] = symbolWithPotentialValue.split('=').map((s) => s.trim());
        const paramName = convertLabelToReturnParam(label);
        
        symbolNames.push(paramName);
        initialSymbolValues[paramName] = symbolValue;
        labelMap[paramName] = label; // Store the friendly label for display
      } else {
        const paramName = convertLabelToReturnParam(symbolWithPotentialValue);
        symbolNames.push(paramName);
        initialSymbolValues[paramName] =
          searchParams.get(paramName) ||
          searchParams.get(`return_${paramName}`) ||
          '';
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
    const manufacturer = searchParams.get('manufacturer') || searchParams.get('manf') || '';
    const curveTitle = searchParams.get('curve_title') || '';
    const graphTitle = searchParams.get('graph_title') || '';
    const tctjValue = searchParams.get('tctj') || '';

    setUrlParams({
      partno,
      manufacturer,
      graph_title: graphTitle,
      curve_title: curveTitle,
      x_label: searchParams.get('x_label') || searchParams.get('x_title') || searchParams.get('xlabel') || '',
      y_label: searchParams.get('y_label') || searchParams.get('y_title') || searchParams.get('ylabel') || '',
      other_symbols: otherSymbols,
      discoveree_cat_id: searchParams.get('discoveree_cat_id') || '',
      identifier: searchParams.get('identifier') || '',
      testuser_id: searchParams.get('testuser_id') || '',
      tctj: tctjValue,
      return_url: searchParams.get('return_url') || '',
      graph_id: searchParams.get('graph_id') || '',
    });

    // Auto-populate graphConfig with URL parameters
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      curveName: curveTitle || prevConfig.curveName,
      graphTitle: graphTitle || prevConfig.graphTitle,
      partNumber: partno || prevConfig.partNumber,
      temperature: tctjValue && tctjValue !== '0' ? tctjValue : prevConfig.temperature,
    }));
  }, []);

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
    
    if (!graphId) {
      console.log('[DEBUG] No graph_id in URL params, skipping fetch');
      return;
    }
    console.log('[DEBUG] Fetching graph_id:', graphId);
    const fetchGraphById = async () => {
      try {
        // Try DiscovereE API first
        console.log('[DEBUG] Attempting DiscovereE API fetch...');
        const discovereeResponse = await fetch(
          `https://www.discoveree.io/graph_capture_api.php?graph_id=${encodeURIComponent(graphId)}`
        );
        console.log('[DEBUG] DiscoverEE response status:', discovereeResponse.status);
        if (discovereeResponse.ok) {
          const result = await discovereeResponse.json();
          console.log('[DEBUG] DiscoverEE response:', result);

          const discovereeGraph = result?.graph && !Array.isArray(result.graph) ? result.graph : null;
          const discovereeDetails = Array.isArray(result?.details)
            ? result.details
            : Array.isArray(discovereeGraph?.details)
              ? discovereeGraph.details
              : [];

          if (result.status === 'success' && discovereeGraph && discovereeDetails.length > 0) {
            console.log('[DEBUG] Successfully parsed DiscoverEE data, details count:', discovereeDetails.length);
            const graphImageUrl = discovereeGraph.graph_img || '';
            const graphGroupId = buildGraphGroupId(graphImageUrl || String(discovereeGraph.graph_id));
            const fetched = discovereeDetails.map((detail, i) => {
              const points = parseXyString(detail.xy);
              const detailSymbolValues =
                detail.tctj && typeof detail.tctj === 'object' && !Array.isArray(detail.tctj)
                  ? detail.tctj
                  : detail.tctj !== undefined && detail.tctj !== null && detail.tctj !== ''
                    ? symbolNames.length === 1
                      ? { [symbolNames[0]]: String(detail.tctj) }
                      : { tctj: String(detail.tctj) }
                    : {};
              console.log('[DEBUG] Parsed detail', i, 'xy:', detail.xy, 'points count:', points.length);
              return {
                id: `${discovereeGraph.graph_id}_${detail.id || i}`,
                detailId: detail.id ? String(detail.id) : '',
                graphId: String(discovereeGraph.graph_id || ''),
                discoveree_cat_id: discovereeGraph.graph_id,
                name: detail.curve_title || discovereeGraph.graph_title || `Curve ${i + 1}`,
                points,
                symbolValues: detailSymbolValues,
                config: {
                  graphTitle: discovereeGraph.graph_title || '',
                  curveName: detail.curve_title || '',
                  xScale: detail.xscale === '1' ? 'Linear' : detail.xscale || 'Linear',
                  yScale: detail.yscale === '1' ? 'Linear' : detail.yscale || 'Linear',
                  xUnitPrefix: detail.xunit || '1',
                  yUnitPrefix: detail.yunit || '1',
                  xMin: '',
                  xMax: '',
                  yMin: '',
                  yMax: '',
                  temperature: detail.tctj || '',
                },
                graphGroupId,
                graphImageUrl,
              };
            });
            console.log('[DEBUG] Total fetched curves:', fetched.length);
            if (fetched.length > 0) {
              console.log('[DEBUG] Setting savedCurves...');
              setSavedCurves(fetched);
              return;
            }
          }
        }

        // Fallback: Try Netlify deployed backend (same domain)
        console.log('[DEBUG] DiscoverEE failed or returned no data, trying Netlify fallback...');
        const netlifyBackendUrl = `${window.location.origin}/api/curves/${graphId}`;
        console.log('[DEBUG] Netlify URL:', netlifyBackendUrl);
        const localResponse = await fetch(netlifyBackendUrl);
        console.log('[DEBUG] Netlify response status:', localResponse.status);
        if (localResponse.ok) {
          const curve = await localResponse.json();
          console.log('[DEBUG] Netlify response:', curve);
          const graphGroupId = buildGraphGroupId('');
          const savedCurve = {
            id: curve.id,
            detailId: '',
            graphId: '',
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
              xMin: curve.x_min ? String(curve.x_min) : '',
              xMax: curve.x_max ? String(curve.x_max) : '',
              yMin: curve.y_min ? String(curve.y_min) : '',
              yMax: curve.y_max ? String(curve.y_max) : '',
              temperature: curve.temperature || '',
            },
            graphGroupId,
            graphImageUrl: '',
          };
          console.log('[DEBUG] Setting savedCurves from Netlify...');
          setSavedCurves([savedCurve]);
        } else {
          console.log('[DEBUG] Netlify also failed');
        }
      } catch (error) {
        console.error('[DEBUG] Error in fetchGraphById:', error);
      }
    };
    fetchGraphById();
  }, []); // graphId is parsed from URL directly

  // Auto-load first curve into main canvas when graph_id loads data
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const graphId = searchParams.get('graph_id');
    
    if (graphId && savedCurves.length > 0) {
      if (autoLoadedGraphIdRef.current === graphId) {
        return;
      }
      autoLoadedGraphIdRef.current = graphId;

      const firstCurve = savedCurves[0];
      console.log('[DEBUG] Auto-loading first curve into canvas:', firstCurve.id);
      
      // Set the graph image from DiscoverEE
      if (firstCurve.graphImageUrl) {
        console.log('[DEBUG] Setting graph image:', firstCurve.graphImageUrl);
        setUploadedImage(firstCurve.graphImageUrl);
      }
      
      // Set graph config
      setGraphConfig((prev) => ({
        ...prev,
        graphTitle: firstCurve.config?.graphTitle || firstCurve.graph_title || '',
        curveName: firstCurve.config?.curveName || firstCurve.curve_name || '',
        partNumber: firstCurve.config?.partNumber || firstCurve.part_number || '',
        xScale: firstCurve.config?.xScale || firstCurve.x_scale || 'Linear',
        yScale: firstCurve.config?.yScale || firstCurve.y_scale || 'Linear',
        xUnitPrefix: firstCurve.config?.xUnitPrefix || firstCurve.x_unit || '1',
        yUnitPrefix: firstCurve.config?.yUnitPrefix || firstCurve.y_unit || '1',
        xMin: firstCurve.config?.xMin || (firstCurve.x_min ? String(firstCurve.x_min) : ''),
        xMax: firstCurve.config?.xMax || (firstCurve.x_max ? String(firstCurve.x_max) : ''),
        yMin: firstCurve.config?.yMin || (firstCurve.y_min ? String(firstCurve.y_min) : ''),
        yMax: firstCurve.config?.yMax || (firstCurve.y_max ? String(firstCurve.y_max) : ''),
        temperature: firstCurve.config?.temperature || firstCurve.temperature || '',
      }));
      
      // Load curve points into canvas
      const loadedPoints = Array.isArray(firstCurve.points)
        ? firstCurve.points.map((point) => ({
            x: point.x_value || point.x,
            y: point.y_value || point.y,
            imported: true,
          }))
        : [];
      
      replaceDataPoints(loadedPoints);
      setIsReadOnly(true);
      
      console.log('[DEBUG] Curve loaded into canvas, points count:', loadedPoints.length);
    }
  }, [savedCurves, replaceDataPoints, setGraphConfig, setUploadedImage]);

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

  const saveCurveToBackend = async ({ allowRedirect }) => {
    console.log('=== SAVE CURVE STARTED ===');
    console.log('GraphConfig:', graphConfig);
    console.log('DataPoints count:', dataPoints.length);
    console.log('DataPoints:', dataPoints);

    if (!graphConfig.graphTitle || !graphConfig.curveName) {
      if (!graphConfig.graphTitle && !graphConfig.curveName) {
        alert('Please enter both a graph title and a curve name');
      } else if (!graphConfig.graphTitle) {
        alert('Please enter a graph title');
      } else {
        alert('Please enter a curve name');
      }
      return null;
    }
    if (dataPoints.length === 0) {
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
    console.log('All validations passed');

    setIsSaving(true);
    try {
      const startTime = Date.now();

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
        temperature: graphConfig.temperature,
        manufacturer: urlParams.manufacturer || null,
        graph_title: urlParams.graph_title || null,
        x_label: urlParams.x_label || null,
        y_label: urlParams.y_label || null,
        other_symbols: urlParams.other_symbols || null,
        discoveree_cat_id: urlParams.discoveree_cat_id ? parseInt(urlParams.discoveree_cat_id) : null,
        data_points: dataPoints.map((point) => ({
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

      // Show only one success message after saving
      if (!urlParams.return_url) {
        alert('Data saved successfully!');
      }

      const graphGroupId = buildGraphGroupId(uploadedImage || '');
      const graphImageUrl = uploadedImage || '';
      console.log('Local save successful, calling sendToCompanyDatabase...');
      const companyGraphId = await sendToCompanyDatabase(graphImageUrl, result.id, allowRedirect);
      console.log('sendToCompanyDatabase returned:', companyGraphId);

      const savedCurve = {
        id: result.id,
        discoveree_cat_id: companyGraphId,
        name: payload.curve_name,
        points: payload.data_points,
        symbolValues: { ...symbolValues },
        config: { ...graphConfig },
        graphGroupId,
        graphImageUrl,
      };
      console.log('Saving curve with config:', savedCurve.config);
      console.log('xUnitPrefix:', savedCurve.config.xUnitPrefix);
      console.log('yUnitPrefix:', savedCurve.config.yUnitPrefix);
      
      setSavedCurves((prev) => [
        ...prev,
        savedCurve,
      ]);

      clearDataPoints();
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        curveName: '',
      }));
      setIsReadOnly(false);
      setIsSaving(false);
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
    setShowReturnDecisionModal(false);
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

      const unitFactor = (value) => {
        const num = parseFloat(value);
        return Number.isFinite(num) ? num : 1;
      };

      const xUnitFactor = unitFactor(graphConfig.xUnitPrefix);
      const yUnitFactor = unitFactor(graphConfig.yUnitPrefix);

      const xyPoints = dataPoints
        .filter((point) => {
          console.log(
            `  Checking point:`,
            point,
            `isFinite(x)=${Number.isFinite(point.x)}, isFinite(y)=${Number.isFinite(point.y)}`
          );
          return Number.isFinite(point.x) && Number.isFinite(point.y);
        })
        .map((point) => ({
          x: String(point.x * xUnitFactor),
          y: String(point.y * yUnitFactor),
        }));

      console.log('Raw data points count:', dataPoints.length);
      console.log('Filtered valid XY Points count:', xyPoints.length);
      console.log('Filtered XY Points being sent:', xyPoints);

      if (xyPoints.length === 0) {
        console.error('No valid data points after filtering');
        alert('No valid data points to send to the company API.');
        return false;
      }

      console.log('Symbol values:', symbolValues);
      const getTctjValueForApi = () => {
        if (!symbolValues || typeof symbolValues !== 'object') {
          return graphConfig.temperature || '';
        }

        if (symbolValues.graph_tctj) {
          return String(symbolValues.graph_tctj);
        }

        const nonEmptyEntries = Object.entries(symbolValues).filter(([, value]) =>
          value !== undefined && value !== null && String(value).trim() !== ''
        );

        if (nonEmptyEntries.length === 1) {
          return String(nonEmptyEntries[0][1]);
        }

        if (nonEmptyEntries.length > 1) {
          // Keep all symbol values in a plain string to match API expectation for tctj.
          return nonEmptyEntries.map(([key, value]) => `${key}:${value}`).join(';');
        }

        return graphConfig.temperature || '';
      };

      const tctjValue = getTctjValueForApi();
      console.log('TCTJ Value (plain string):', tctjValue);

      const detailPayload = {
        curve_title: urlParams.curve_title || graphConfig.curveName || '',
        xy: xyPoints.map((point) => `{x:${point.x},y:${point.y}}`).join(','),
        tctj: tctjValue,
        df_tj: tctjValue,
        xscale: graphConfig.xScale || '1',
        yscale: graphConfig.yScale || '1',
        xunit: graphConfig.xUnitPrefix || '1',
        yunit: graphConfig.yUnitPrefix || '1',
      };

      const tctjTitle =
        symbolLabels.graph_tctj ||
        symbolLabels.tctj ||
        (symbolNames.length > 0 ? symbolNames[0] : '');

      // Build the JSON payload for company's API
      // Always use a unique identifier for each save to ensure a new graph is created
      const uniqueIdentifier = `usergraph_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const companyApiPayload = {
        graph: {
          discoveree_cat_id: urlParams.discoveree_cat_id ? String(urlParams.discoveree_cat_id) : '',
          identifier: uniqueIdentifier,
          partno: urlParams.partno || '',
          manf: urlParams.manufacturer || '',
          graph_title: urlParams.graph_title || '',
          x_title: urlParams.x_label || '',
          y_title: urlParams.y_label || '',
          tctj_title: tctjTitle,
          graph_img: graphImageUrl || '',
          mark_review: '1',
          testuser_id: urlParams.testuser_id || '',
        },
        details: [detailPayload],
      };

      console.log('Complete Company API Payload:', companyApiPayload);
      console.log('Graph object:', companyApiPayload.graph);
      console.log('Details array:', companyApiPayload.details);

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

      const COMPANY_API_SAVE_URL = 'https://www.discoveree.io/graph_capture_api.php';

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

      const result = await response.json();
      console.log('Company API Response received:', result);
      console.log('Company Graph ID from API:', result?.graph_id);
      const companyGraphId = result?.graph_id ?? null;

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
      } else if (allowRedirect && urlParams.return_url && !companyGraphId) {
        alert('Company graph ID missing. Saved locally, but cannot redirect without a company graph ID.');
      } else {
        // Do not show a second success message
        console.log('No return URL - data saved.');
      }
      return companyGraphId;
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
    if (dataPoints.length === 0) {
      alert('No data points to export');
      return;
    }

    // Generate CSV content
    let csv = 'X Value,Y Value\n';
    dataPoints.forEach((point) => {
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

  return (
    <div className="w-full min-h-screen p-8" style={{ backgroundColor: '#ffffff', color: '#213547' }}>
      <header className="mb-8 flex items-start justify-between gap-4">
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
        <ImageUpload />
        {uploadedImage && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="w-full lg:w-2/5 flex flex-col gap-4">
              <GraphCanvas isReadOnly={isReadOnly} partNumber={urlParams.partno} manufacturer={urlParams.manufacturer} isAxisMappingConfirmed={isAxisMappingConfirmed} hasReturnUrl={!!urlParams.return_url} />
              <CapturedPointsList isReadOnly={isReadOnly} hasReturnUrl={!!urlParams.return_url} />
            </div>
            <div className="w-full lg:w-3/5">
              <GraphConfig 
                showTctj={urlParams.tctj !== '0'} 
                isGraphTitleReadOnly={false} 
                isCurveNameReadOnly={false} 
                initialCurveName={urlParams.curve_title} 
                initialGraphTitle={urlParams.graph_title}
                isAxisMappingConfirmed={isAxisMappingConfirmed}
                onConfirmAxisMapping={() => {
                  setIsAxisMappingConfirmed(true);
                  setFrozenGraphConfig({ ...graphConfig });
                }}
                onRetakeAxis={() => {
                  setIsAxisMappingConfirmed(false);
                  setFrozenGraphConfig(null);
                  clearDataPoints();
                }}
              >
                {/* Dynamic Symbol Input Boxes - Only show if other_symb exists in URL */}
                {symbolNames && symbolNames.length > 0 && (
                  <div className="p-4 border rounded" style={{ backgroundColor: '#ffffff', borderColor: 'var(--color-border)' }}>
                    {symbolNames.map((symbol) => {
                      // Use the friendly label stored in symbolLabels map
                      const displayLabel = symbolLabels[symbol] || symbol;
                      return (
                      <div key={symbol} className="mb-3">
                        <label className="block mb-1 text-sm font-medium" style={{ color: '#213547' }}>
                          {displayLabel}
                        </label>
                        <input
                          type="text"
                          value={symbolValues[symbol] || ''}
                          onChange={(e) => setSymbolValues({ ...symbolValues, [symbol]: e.target.value })}
                          placeholder={`Enter value for ${displayLabel}`}
                          className="w-full px-3 py-2 border rounded text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          style={{
                            color: '#213547',
                            backgroundColor: '#ffffff',
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
                  <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-2">
                    {groupedCurves.map((group, groupIndex) => (
                      <div key={group.id} className="rounded p-3" style={{ border: '1px solid var(--color-border)', background: '#ffffff' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold" style={{ color: '#213547' }}>
                            {group.curves[0]?.config?.graphTitle || group.curves[0]?.graph_title || `Graph ${groupIndex + 1}`} ({group.curves.length} curves)
                          </div>
                          <button
                            className="px-3 py-1 rounded bg-gray-900 text-white text-xs"
                            onClick={() => setCombinedGroupId(group.id)}
                          >
                            View combined graph
                          </button>
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
                                Points: {curve.points?.length ?? curve.data_points?.length ?? 0}
                              </div>
                              <div className="text-xs mb-2 text-gray-700">
                                X unit: {curve.config?.xUnitPrefix || curve.x_unit || '-'} | Y unit: {curve.config?.yUnitPrefix || curve.y_unit || '-'}<br />
                                X scale: {curve.config?.xScale || curve.x_scale || '-'} | Y scale: {curve.config?.yScale || curve.y_scale || '-'}
                              </div>
                              {editingCurveId === curve.id ? (
                                <div className="mt-2">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="text-xs text-gray-700">
                                      Y Scale
                                      <select
                                        className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                        value={editCurveMeta.yScale}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, yScale: e.target.value })}
                                      >
                                        <option value="Linear">Linear</option>
                                        <option value="Logarithmic">Logarithmic</option>
                                      </select>
                                    </label>
                                    <label className="text-xs text-gray-700">
                                      Y Unit
                                      <select
                                        className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
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
                                    <label className="text-xs text-gray-700">
                                      X Scale
                                      <select
                                        className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                        value={editCurveMeta.xScale}
                                        onChange={(e) => setEditCurveMeta({ ...editCurveMeta, xScale: e.target.value })}
                                      >
                                        <option value="Linear">Linear</option>
                                        <option value="Logarithmic">Logarithmic</option>
                                      </select>
                                    </label>
                                    <label className="text-xs text-gray-700">
                                      X Unit
                                      <select
                                        className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
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
                                  {symbolNames && symbolNames.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                      {symbolNames.map((symbol) => {
                                        const displayLabel = symbolLabels[symbol] || symbol;
                                        return (
                                          <label key={`${curve.id}_${symbol}`} className="text-xs text-gray-700">
                                            {displayLabel}
                                            <input
                                              type="text"
                                              className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                              value={editCurveSymbolValues[symbol] || ''}
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
                                  ) : null}
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      className="px-3 py-1 rounded bg-green-600 text-white text-xs"
                                      onClick={() => handleEditCurveUpdate(curve.id)}
                                      disabled={isUpdatingCurveId === curve.id}
                                    >
                                      {isUpdatingCurveId === curve.id ? 'Updating...' : 'Update Data'}
                                    </button>
                                    <button
                                      className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
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
        )}

        {!uploadedImage && savedCurves.length > 0 && (
          <div
            ref={savedGraphsSectionRef}
            className="mt-2 p-4 rounded shadow"
            style={{ backgroundColor: '#ffffff', color: '#213547', border: '1px solid var(--color-border)' }}
          >
            <h2 className="text-lg font-bold mb-4" style={{ color: '#213547' }}>
              Saved Graphs
            </h2>
            <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-2">
              {groupedCurves.map((group, groupIndex) => (
                <div key={group.id} className="rounded p-3" style={{ border: '1px solid var(--color-border)', background: '#ffffff' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold" style={{ color: '#213547' }}>
                      {group.curves[0]?.config?.graphTitle || group.curves[0]?.graph_title || `Graph ${groupIndex + 1}`} ({group.curves.length} curves)
                    </div>
                    <button
                      className="px-3 py-1 rounded bg-gray-900 text-white text-xs"
                      onClick={() => setCombinedGroupId(group.id)}
                    >
                      View combined graph
                    </button>
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
                          Points: {curve.points?.length ?? curve.data_points?.length ?? 0}
                        </div>
                        <div className="text-xs mb-2 text-gray-700">
                          X unit: {curve.config?.xUnitPrefix || curve.x_unit || '-'} | Y unit: {curve.config?.yUnitPrefix || curve.y_unit || '-'}<br />
                          X scale: {curve.config?.xScale || curve.x_scale || '-'} | Y scale: {curve.config?.yScale || curve.y_scale || '-'}
                        </div>
                        {editingCurveId === curve.id ? (
                          <div className="mt-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <label className="text-xs text-gray-700">
                                Y Scale
                                <select
                                  className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                  value={editCurveMeta.yScale}
                                  onChange={(e) => setEditCurveMeta({ ...editCurveMeta, yScale: e.target.value })}
                                >
                                  <option value="Linear">Linear</option>
                                  <option value="Logarithmic">Logarithmic</option>
                                </select>
                              </label>
                              <label className="text-xs text-gray-700">
                                Y Unit
                                <select
                                  className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
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
                              <label className="text-xs text-gray-700">
                                X Scale
                                <select
                                  className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                  value={editCurveMeta.xScale}
                                  onChange={(e) => setEditCurveMeta({ ...editCurveMeta, xScale: e.target.value })}
                                >
                                  <option value="Linear">Linear</option>
                                  <option value="Logarithmic">Logarithmic</option>
                                </select>
                              </label>
                              <label className="text-xs text-gray-700">
                                X Unit
                                <select
                                  className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
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
                            {symbolNames && symbolNames.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                {symbolNames.map((symbol) => {
                                  const displayLabel = symbolLabels[symbol] || symbol;
                                  return (
                                    <label key={`${curve.id}_${symbol}`} className="text-xs text-gray-700">
                                      {displayLabel}
                                      <input
                                        type="text"
                                        className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs"
                                        value={editCurveSymbolValues[symbol] || ''}
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
                            ) : null}
                            <div className="flex gap-2 mt-3">
                              <button
                                className="px-3 py-1 rounded bg-green-600 text-white text-xs"
                                onClick={() => handleEditCurveUpdate(curve.id)}
                                disabled={isUpdatingCurveId === curve.id}
                              >
                                {isUpdatingCurveId === curve.id ? 'Updating...' : 'Update Data'}
                              </button>
                              <button
                                className="px-3 py-1 rounded bg-gray-700 text-white text-xs"
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
          onClick={handleCaptureAnotherCurve}
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
            background: 'rgba(0,0,0,0.35)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setSelectedCurveId('')}
        >
          <div
            style={{
              background: '#fff',
              color: '#213547',
              borderRadius: 8,
              minWidth: 520,
              maxWidth: 720,
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
              padding: 24,
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                position: 'absolute',
                top: 8,
                right: 12,
                background: 'none',
                border: 'none',
                fontSize: 22,
                color: '#888',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedCurveId('')}
              aria-label="Close"
            >
              ×
            </button>
            <div className="font-semibold mb-2" style={{ color: '#213547', fontSize: 18 }}>
              {selectedCurve.name || `Curve #${selectedCurve.id}`}
            </div>
            <div className="mb-2 text-xs">Points: {selectedCurvePoints.length}</div>
            <a
              href={`${window.location.origin}/?view=curve&curveId=${selectedCurve.discoveree_cat_id || selectedCurve.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1d4ed8', textDecoration: 'underline', fontSize: 13 }}
            >
              View graph in new tab
            </a>
            <div style={{ marginTop: 12 }}>
              <SavedGraphPreview
                points={selectedCurvePoints}
                config={normalizeCurveConfig(selectedCurve)}
                width={600}
                height={240}
                animate
              />
            </div>
            <table className="mt-2 w-full text-xs border" style={{ borderColor: 'var(--color-border)', marginTop: 12 }}>
              <thead>
                <tr style={{ backgroundColor: '#222', color: '#fff' }}>
                  <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>
                    X
                  </th>
                  <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>
                    Y
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedCurvePoints.map((pt, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                      {formatDisplayValue(pt.x_value ?? pt.x, selectedCurve?.config?.xScale ?? selectedCurve?.x_scale ?? 'Linear')}
                    </td>
                    <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                      {formatDisplayValue(pt.y_value ?? pt.y, selectedCurve?.config?.yScale ?? selectedCurve?.y_scale ?? 'Linear')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            background: 'rgba(0,0,0,0.35)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setCombinedGroupId('')}
        >
          <div
            style={{
              background: '#fff',
              color: '#213547',
              borderRadius: 8,
              minWidth: 560,
              maxWidth: 820,
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
              padding: 24,
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                position: 'absolute',
                top: 8,
                right: 12,
                background: 'none',
                border: 'none',
                fontSize: 22,
                color: '#888',
                cursor: 'pointer',
              }}
              onClick={() => setCombinedGroupId('')}
              aria-label="Close"
            >
              ×
            </button>
            <div className="font-semibold mb-2" style={{ color: '#213547', fontSize: 18 }}>
              Combined curves ({selectedGroup.curves.length})
            </div>
            <div style={{ marginTop: 12 }}>
              <SavedGraphCombinedPreview
                curves={selectedGroup.curves}
                config={normalizeCurveConfig(selectedGroup.curves[0])}
                width={700}
                height={280}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphCapture;

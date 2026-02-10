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
  });
  const [symbolValues, setSymbolValues] = useState({});
  const [symbolNames, setSymbolNames] = useState([]);
  const [returnParams, setReturnParams] = useState({});
  const [returnGraphId, setReturnGraphId] = useState('');

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

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const otherSymbols = searchParams.get('other_symbols') || searchParams.get('other_symb') || '';
    const symbolArray = otherSymbols ? otherSymbols.split(',').map((s) => s.trim()) : [];

    setSymbolNames(symbolArray);
    const initialSymbolValues = {};
    symbolArray.forEach((symbol) => {
      initialSymbolValues[symbol] = '';
    });
    setSymbolValues(initialSymbolValues);

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
    });

    // Auto-populate graphConfig with URL parameters
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      curveName: curveTitle || prevConfig.curveName,
      graphTitle: graphTitle || prevConfig.graphTitle,
      partNumber: partno || prevConfig.partNumber,
      temperature: tctjValue && tctjValue !== '0' ? tctjValue : prevConfig.temperature,
    }));
  }, [setGraphConfig]);

  const saveCurveToBackend = async ({ allowRedirect }) => {
    console.log('=== SAVE CURVE STARTED ===');
    console.log('GraphConfig:', graphConfig);
    console.log('DataPoints count:', dataPoints.length);
    console.log('DataPoints:', dataPoints);

    if (!graphConfig.curveName) {
      console.error('Validation failed: No curve name');
      alert('Please enter a curve name');
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
      alert('Data saved successfully!');

      const graphGroupId = buildGraphGroupId(uploadedImage || '');
      const graphImageUrl = uploadedImage || '';
      console.log('Local save successful, calling sendToCompanyDatabase...');
      const companyGraphId = await sendToCompanyDatabase(graphImageUrl, result.id, allowRedirect);
      console.log('sendToCompanyDatabase returned:', companyGraphId);

      setSavedCurves((prev) => [
        ...prev,
        {
          id: result.id,
          discovereeId: companyGraphId,
          name: payload.curve_name,
          points: payload.data_points,
          config: { ...graphConfig },
          graphGroupId,
          graphImageUrl,
        },
      ]);

      clearDataPoints();
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
      const tctjValue = symbolValues && Object.keys(symbolValues).length > 0 ? symbolValues : graphConfig.temperature || '';
      console.log('TCTJ Value:', tctjValue);

      const detailPayload = {
        curve_title: urlParams.curve_title || graphConfig.curveName || '',
        xy: xyPoints.map((point) => `{x:${point.x},y:${point.y}}`).join(','),
        tctj: tctjValue,
        xscale: graphConfig.xScale || '1',
        yscale: graphConfig.yScale || '1',
        xunit: graphConfig.xUnitPrefix || '1',
        yunit: graphConfig.yUnitPrefix || '1',
      };

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
          console.log('Redirecting to:', returnUrl);
          window.location.href = returnUrl;
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

      // Handle return URL redirect if configured
      if (allowRedirect && urlParams.return_url && companyGraphId) {
        console.log('Return URL found, constructing redirect...');
        const returnUrl = constructReturnUrl(urlParams.return_url, companyGraphId);
        console.log('Final redirect URL:', returnUrl);
        console.log('Redirecting now...');
        window.location.href = returnUrl;
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
      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#213547' }}>
          Graph Capture Tool
        </h1>
        {/* <p className="text-gray-600">Upload graph images and extract data points easily</p> */}
      </header>

      <div className="flex flex-col gap-8">
        <ImageUpload />
        {uploadedImage && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="w-full lg:w-2/5 flex flex-col gap-4">
              <GraphCanvas isReadOnly={isReadOnly} partNumber={urlParams.partno} manufacturer={urlParams.manufacturer} />
              <CapturedPointsList isReadOnly={isReadOnly} />
            </div>
            <div className="w-full lg:w-3/5">
              <GraphConfig showTctj={urlParams.tctj !== '0'} isGraphTitleReadOnly={false} isCurveNameReadOnly={false} />

              {/* Dynamic Symbol Input Boxes - Only show if other_symb exists in URL */}
              {symbolNames && symbolNames.length > 0 && (
                <div className="mt-4 p-4 border rounded" style={{ backgroundColor: '#ffffff', borderColor: 'var(--color-border)' }}>
                  <h3 className="mb-3 text-sm font-semibold" style={{ color: '#213547' }}>
                    Symbol Values
                  </h3>
                  {symbolNames.map((symbol) => (
                    <div key={symbol} className="mb-3">
                      <label className="block mb-1 text-sm font-medium" style={{ color: '#213547' }}>
                        {symbol}
                      </label>
                      <input
                        type="text"
                        value={symbolValues[symbol] || ''}
                        onChange={(e) => setSymbolValues({ ...symbolValues, [symbol]: e.target.value })}
                        placeholder={`Enter value for ${symbol}`}
                        className="w-full px-3 py-2 border rounded text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        style={{
                          color: '#213547',
                          backgroundColor: '#ffffff',
                          borderColor: 'var(--color-border)',
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex flex-row gap-4 items-center">
                <button
                  onClick={handleSave}
                  className="px-4 py-2 rounded bg-blue-600 text-white font-medium disabled:opacity-50"
                  disabled={isSaving}
                >
                  Fit, convert and export to RC ladder sim
                </button>
                <button
                  onClick={handleSaveDataPoints}
                  className="px-4 py-2 rounded bg-green-600 text-white font-medium disabled:opacity-50"
                  disabled={isSaving}
                >
                  Save Data Points
                </button>
                {isSaving ? (
                  <span className="text-sm" style={{ color: '#6b7280' }}>
                    Processing...
                  </span>
                ) : null}
              </div>

              {/* Saved Graphs Section */}
              {savedCurves.length > 0 && (
                <div
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
                            Graph {groupIndex + 1} ({group.curves.length} curves)
                          </div>
                          <button
                            className="px-3 py-1 rounded bg-gray-900 text-white text-xs"
                            onClick={() => setCombinedGroupId(group.id)}
                          >
                            View combined
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          {group.curves.map((curve) => (
                            <div
                              key={curve.id}
                              className="rounded p-3 cursor-pointer hover:bg-gray-100"
                              style={{ backgroundColor: '#ffffff', color: '#213547', border: '1px solid var(--color-border)' }}
                              onClick={() => setSelectedCurveId(curve.id)}
                            >
                              <div className="font-semibold mb-1" style={{ color: '#213547' }}>
                                {curve.name || curve.curve_name || `Curve #${curve.id}`}
                              </div>
                              <div className="text-xs mb-1">
                                Points: {curve.points?.length ?? curve.data_points?.length ?? 0}
                              </div>
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
      </div>

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
                      {pt.x_value}
                    </td>
                    <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                      {pt.y_value}
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

import ImageUpload from '../components/ImageUpload';
import GraphCanvas from '../components/GraphCanvas';
import GraphConfig from '../components/GraphConfig';
import CapturedPointsList from '../components/CapturedPointsList';
import { useGraph } from '../context/GraphContext';
import { useState, useEffect } from 'react';

const GraphCapture = () => {
  const { uploadedImage, graphConfig, dataPoints, setGraphConfig, replaceDataPoints } = useGraph();
  const [isSaving, setIsSaving] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [savedCurves, setSavedCurves] = useState([]);
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

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const otherSymbols = searchParams.get('other_symbols') || searchParams.get('other_symb') || '';
    const symbolArray = otherSymbols ? otherSymbols.split(',').map(s => s.trim()) : [];
    
    setSymbolNames(symbolArray);
    const initialSymbolValues = {};
    symbolArray.forEach(symbol => {
      initialSymbolValues[symbol] = '';
    });
    setSymbolValues(initialSymbolValues);
    
    // Extract return parameters (format: return_paramName=value, excluding return_url)
    const returnParamsObj = {};
    const keys = Array.from(searchParams.keys());
    keys.forEach(key => {
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
    setGraphConfig(prevConfig => ({
      ...prevConfig,
      curveName: curveTitle || prevConfig.curveName,
      graphTitle: graphTitle || prevConfig.graphTitle,
      partNumber: partno || prevConfig.partNumber,
      temperature: (tctjValue && tctjValue !== '0') ? tctjValue : prevConfig.temperature,
    }));
  }, [setGraphConfig]);

  const handleSave = async () => {
    console.log('=== HANDLE SAVE STARTED ===');
    console.log('GraphConfig:', graphConfig);
    console.log('DataPoints count:', dataPoints.length);
    console.log('DataPoints:', dataPoints);
    
    if (!graphConfig.curveName) {
      console.error('Γ¥î Validation failed: No curve name');
      alert('Please enter a curve name');
      return;
    }
    if (dataPoints.length === 0) {
      console.error('Γ¥î Validation failed: No data points captured');
      alert('Please capture at least one data point');
      return;
    }
    // Validate min/max values are valid numbers and min < max
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    
    console.log('Parsed min/max values:', { xMin, xMax, yMin, yMax });
    
    if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) {
      console.error('Γ¥î Validation failed: Invalid numeric values');
      alert('Please enter valid numeric values for all min/max fields');
      return;
    }
    if (xMin >= xMax) {
      console.error('Γ¥î Validation failed: X-axis min >= max');
      alert('X-axis: Min must be less than Max');
      return;
    }
    if (yMin >= yMax) {
      console.error('Γ¥î Validation failed: Y-axis min >= max');
      alert('Y-axis: Min must be less than Max');
      return;
    }
    console.log('Γ£à All validations passed');
    
    setIsSaving(true);
    try {
      // Show informative message if backend might be cold starting
      const startTime = Date.now();
      
      // Save to backend
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
        data_points: dataPoints.map(point => ({
          x_value: point.x,
          y_value: point.y,
        })),
      };

      console.log('≡ƒôï URL Params extracted:', urlParams);
      console.log('≡ƒôª Backend payload being sent:', payload);
      console.log('≡ƒôè Data points to be saved:', payload.data_points);

      // Add timeout for cold starts
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout
      
      console.log(`≡ƒîÉ Making POST request to: ${apiUrl}/api/curves`);
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
      
      console.log('≡ƒô¼ Backend response status:', response.status);
      console.log(`ΓÅ▒∩╕Å Backend request took ${(elapsed / 1000).toFixed(1)}s`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Γ¥î Backend error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}. ${errorData.detail || ''}`);
      }

      const result = await response.json();
      console.log('Γ£à Backend save successful! Response:', result);
      console.log('≡ƒôî Graph ID from backend:', result.id);
      
      if (!urlParams.return_url) {
        alert(`Curve saved successfully! (ID: ${result.id})${elapsed > 10000 ? '\n\nNote: First request took longer due to server startup.' : ''}`);
      }
      setIsReadOnly(true);
      
      // After successful save to local backend, send to company's database
      // Get the image URL if available
      const graphImageUrl = uploadedImage || '';
      console.log('Γ£à Local save successful, calling sendToCompanyDatabase...');
      const companyDbResult = await sendToCompanyDatabase(graphImageUrl, result.id);
      console.log('≡ƒôè sendToCompanyDatabase returned:', companyDbResult);
      
      setIsSaving(false);
    } catch (error) {
      console.error('Γ¥î === HANDLE SAVE ERROR ===');
      console.error('Γ¥î Full error object:', error);
      console.error('Γ¥î Error name:', error.name);
      console.error('Γ¥î Error message:', error.message);
      console.error('Γ¥î Error stack:', error.stack);
      
      if (error.name === 'AbortError') {
        console.error('≡ƒÜ¿ Abort error - request timed out');
        alert('Request timed out. The server may be starting up (takes 1-2 minutes on first use). Please try again.');
      } else {
        console.error('≡ƒÜ¿ Other error in handleSave');
        alert('Error saving curve: ' + error.message + '\n\nMake sure backend is running or try again if server is starting up.');
      }
      setIsSaving(false);
    }
  };

  const sendToCompanyDatabase = async (graphImageUrl, graphId) => {
    // ============================================================
    // TESTING MODE: Set to false to skip actual API call
    // ============================================================
    const SEND_TO_API = true;
    
    console.log('≡ƒÜÇ === SENDING TO COMPANY DATABASE STARTED ===');
    console.log('≡ƒôî Local Graph ID:', graphId);
    console.log('≡ƒû╝∩╕Å Graph Image URL:', graphImageUrl);
    console.log('≡ƒôè Full dataPoints object from context:', dataPoints);
    console.log('≡ƒôè dataPoints type:', typeof dataPoints);
    console.log('≡ƒôè dataPoints is array?:', Array.isArray(dataPoints));
    
    try {
      console.log('≡ƒöì Before filtering - dataPoints length:', dataPoints ? dataPoints.length : 'dataPoints is null/undefined');
      
      const xyPoints = dataPoints
        .filter(point => {
          console.log(`  ≡ƒöì Checking point:`, point, `isFinite(x)=${Number.isFinite(point.x)}, isFinite(y)=${Number.isFinite(point.y)}`);
          return Number.isFinite(point.x) && Number.isFinite(point.y);
        })
        .map(point => ({
          x: String(point.x),
          y: String(point.y),
        }));

      console.log('≡ƒôè Raw data points count:', dataPoints.length);
      console.log('Γ£à Filtered valid XY Points count:', xyPoints.length);
      console.log('≡ƒôï Filtered XY Points being sent:', xyPoints);

      if (xyPoints.length === 0) {
        console.error('Γ¥î No valid data points after filtering');
        alert('No valid data points to send to the company API.');
        return false;
      }

      console.log('≡ƒöñ Symbol values:', symbolValues);
      const tctjValue = (symbolValues && Object.keys(symbolValues).length > 0)
        ? symbolValues
        : (graphConfig.temperature || "");
      console.log('≡ƒîí∩╕Å TCTJ Value:', tctjValue);

      const detailPayload = {
        curve_title: urlParams.curve_title || graphConfig.curveName || "",
        xy: xyPoints.map(point => `{x:${point.x},y:${point.y}}`).join(','),
        tctj: tctjValue,
        xscale: graphConfig.xScale || "1",
        yscale: graphConfig.yScale || "1",
        xunit: graphConfig.xUnitPrefix || "1",
        yunit: graphConfig.yUnitPrefix || "1",
      };

      // Build the JSON payload for company's API
      const companyApiPayload = {
        graph: {
          discoveree_cat_id: urlParams.discoveree_cat_id ? String(urlParams.discoveree_cat_id) : "",
          identifier: urlParams.identifier || "",
          partno: urlParams.partno || "",
          manf: urlParams.manufacturer || "",
          graph_title: urlParams.graph_title || "",
          x_title: urlParams.x_label || "",
          y_title: urlParams.y_label || "",
          graph_img: graphImageUrl || "",
          mark_review: "1",
          testuser_id: urlParams.testuser_id || "",
        },
        details: [detailPayload],
      };

      console.log('≡ƒôª Complete Company API Payload:', companyApiPayload);
      console.log('≡ƒôï Graph object:', companyApiPayload.graph);
      console.log('≡ƒôè Details array:', companyApiPayload.details);

      // Skip API call if in testing mode
      if (!SEND_TO_API) {
        console.log('ΓÜá∩╕Å TESTING MODE: Skipping actual API call');
        // Simulate successful response for testing redirect
        if (urlParams.return_url) {
          const returnUrl = constructReturnUrl(urlParams.return_url, graphId);
          console.log('≡ƒöù Redirecting to:', returnUrl);
          window.location.href = returnUrl;
        } else {
          alert('Data saved to local backend successfully! (API call skipped for testing)');
        }
        return true;
      }

      const COMPANY_API_SAVE_URL = 'https://www.discoveree.io/graph_capture_api.php';

      console.log('≡ƒîÉ Making request to Company API:', COMPANY_API_SAVE_URL);
      console.log('≡ƒôñ Request body:', JSON.stringify(companyApiPayload, null, 2));
      
      const response = await fetch(COMPANY_API_SAVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(companyApiPayload),
      });

      console.log('≡ƒô¼ Company API Response status:', response.status);
      console.log('≡ƒô¼ Company API Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Γ¥î Company API Error response:', errorData);
        throw new Error(`Company API error! status: ${response.status}. ${errorData.detail || errorData.message || ''}`);
      }

      const result = await response.json();
      console.log('Γ£à Company API Response received:', result);
      console.log('≡ƒôî Company Graph ID from API:', result?.graph_id);
      const companyGraphId = result?.graph_id ?? graphId;
      
      // Handle return URL redirect if configured
      if (urlParams.return_url) {
        console.log('≡ƒöù Return URL found, constructing redirect...');
        const returnUrl = constructReturnUrl(urlParams.return_url, companyGraphId);
        console.log('≡ƒöù Final redirect URL:', returnUrl);
        console.log('≡ƒöù Redirecting now...');
        window.location.href = returnUrl;
      } else {
        console.log('Γ£à No return URL - showing success message');
        alert('Data saved to company database successfully!');
      }
      return true;
    } catch (error) {
      console.error('Γ¥î Full error object:', error);
      console.error('Γ¥î Error name:', error.name);
      console.error('Γ¥î Error message:', error.message);
      console.error('Γ¥î Error stack:', error.stack);
      
      // Check if it's a CORS or network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        console.error('≡ƒÜ¿ Detected CORS/Network error');
        alert('Error saving to company database: Network or CORS error.\n\nThis is likely a CORS issue. The API at discoveree.io needs to allow requests from Netlify.\n\nPlease contact the API administrator to add CORS headers for: https://graph-capture.netlify.app');
      } else {
        console.error('≡ƒÜ¿ Other error detected');
        alert('Error saving to company database: ' + error.message);
      }
      return false;
    }
  };

  const constructReturnUrl = (baseUrl, graphId) => {
    console.log('≡ƒöù === CONSTRUCTING RETURN URL ===');
    console.log('≡ƒöù Base URL:', baseUrl);
    console.log('≡ƒöù Graph ID:', graphId);
    console.log('≡ƒöù Return params to add:', returnParams);
    
    const url = new URL(baseUrl);
    
    // Add return parameters
    Object.entries(returnParams).forEach(([key, value]) => {
      console.log(`≡ƒöù Adding param: ${key} = ${value}`);
      url.searchParams.append(key, value);
    });
    
    // Add return_graph_id
    if (graphId) {
      console.log(`≡ƒöù Adding return_graph_id = ${graphId}`);

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
      const COMPANY_API_VIEW_URL = 'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11';
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
    dataPoints.forEach(point => {
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
    const COMPANY_API_VIEW_URL = 'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11';
    
    if (COMPANY_API_VIEW_URL === 'https://www.discoveree.io/graph_capture_api.php?graph_title=test&partno=abc&manf=abc&discoveree_cat_id=11') {
      alert('Company database view URL not configured. Please enter your URL in the code.');
      return;
    }

    // Open the company's database view in a new tab
    window.open(COMPANY_API_VIEW_URL, '_blank');
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Graph Capture Tool</h1>
        {/* <p className="text-gray-600">Upload graph images and extract data points easily</p> */}
      </header>

      <div className="flex flex-col gap-8">
        {!uploadedImage ? (
          <ImageUpload />
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="w-full lg:w-2/5 flex flex-col gap-4">
              <GraphCanvas isReadOnly={isReadOnly} partNumber={urlParams.partno} manufacturer={urlParams.manufacturer} />
              <CapturedPointsList isReadOnly={isReadOnly} />
            </div>
            <div className="w-full lg:w-3/5">
              <GraphConfig 
                showTctj={urlParams.tctj !== "0"} 
                isGraphTitleReadOnly={false}
                isCurveNameReadOnly={false}
              />

              {/* Dynamic Symbol Input Boxes - Only show if other_symb exists in URL */}
              {symbolNames && symbolNames.length > 0 && (
                <div className="mt-4 p-4 border border-gray-200 rounded bg-white">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">Symbol Values</h3>
                  {symbolNames.map(symbol => (
                    <div key={symbol} className="mb-3">
                      <label className="block mb-1 text-sm font-medium text-gray-800">
                        {symbol}
                      </label>
                      <input
                        type="text"
                        value={symbolValues[symbol] || ''}
                        onChange={(e) => setSymbolValues({ ...symbolValues, [symbol]: e.target.value })}
                        placeholder={`Enter value for ${symbol}`}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <button 
                  onClick={handleSave} 
                  className="px-4 py-2 rounded bg-blue-600 text-white font-medium disabled:opacity-50"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Fit, convert and export to RC ladder sim'}
                </button>
              </div>

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
                    style={{{
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
    </div>
  );
};

export default GraphCapture;

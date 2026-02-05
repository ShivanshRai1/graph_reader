import ImageUpload from '../components/ImageUpload';
import GraphCanvas from '../components/GraphCanvas';
import GraphConfig from '../components/GraphConfig';
import CapturedPointsList from '../components/CapturedPointsList';
import { useGraph } from '../context/GraphContext';
import { useState, useEffect } from 'react';
import './GraphCapture.css';

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
    
    // Extract return parameters (format: key:value)
    const returnParamsObj = {};
    const keys = Array.from(searchParams.keys());
    keys.forEach(key => {
      if (key.startsWith('return_param_')) {
        const value = searchParams.get(key);
        if (value && value.includes(':')) {
          const [paramKey, paramValue] = value.split(':');
          returnParamsObj[paramKey.trim()] = paramValue.trim();
        }
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
    if (!graphConfig.curveName) {
      alert('Please enter a curve name');
      return;
    }
    if (dataPoints.length === 0) {
      alert('Please capture at least one data point');
      return;
    }
    // Validate min/max values are valid numbers and min < max
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    
    if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) {
      alert('Please enter valid numeric values for all min/max fields');
      return;
    }
    if (xMin >= xMax) {
      alert('X-axis: Min must be less than Max');
      return;
    }
    if (yMin >= yMax) {
      alert('Y-axis: Min must be less than Max');
      return;
    }
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

      console.log('URL Params:', urlParams);
      console.log('Sending payload:', payload);

      console.log('Sending payload:', payload);

      // Add timeout for cold starts
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout
      
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
      
      console.log('Response status:', response.status);
      console.log(`Request took ${(elapsed / 1000).toFixed(1)}s`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}. ${errorData.detail || ''}`);
      }

      const result = await response.json();
      alert(`Curve saved successfully! (ID: ${result.id})${elapsed > 10000 ? '\n\nNote: First request took longer due to server startup.' : ''}`);
      setIsReadOnly(true);
      
      // After successful save to local backend, send to company's database
      // Get the image URL if available
      const graphImageUrl = uploadedImage || '';
      await sendToCompanyDatabase(graphImageUrl, result.id);
      
      setIsSaving(false);
    } catch (error) {
      console.error('Full error:', error);
      if (error.name === 'AbortError') {
        alert('Request timed out. The server may be starting up (takes 1-2 minutes on first use). Please try again.');
      } else {
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
    
    try {
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
        details: [
          {
            curve_title: urlParams.curve_title || graphConfig.curveName || "",
            xy: dataPoints.map(point => ({
              x: String(point.x),
              y: String(point.y),
            })),
            tctj: symbolValues && Object.keys(symbolValues).length > 0 ? symbolValues : (graphConfig.temperature || "data1"),
            xscale: graphConfig.xScale || "1",
            yscale: graphConfig.yScale || "1",
            xunit: graphConfig.xUnitPrefix || "1",
            yunit: graphConfig.yUnitPrefix || "1",
          },
        ],
      };

      console.log('Company API Payload:', companyApiPayload);

      // Skip API call if in testing mode
      if (!SEND_TO_API) {
        console.log('⚠️ TESTING MODE: Skipping actual API call');
        // Simulate successful response for testing redirect
        if (urlParams.return_url) {
          const returnUrl = constructReturnUrl(urlParams.return_url, graphId);
          console.log('Redirecting to:', returnUrl);
          window.location.href = returnUrl;
        } else {
          alert('Data saved to local backend successfully! (API call skipped for testing)');
        }
        return true;
      }

      const COMPANY_API_SAVE_URL = 'https://www.discoveree.io/graph_capture_api.php';

      console.log('Attempting to call company API:', COMPANY_API_SAVE_URL);
      
      const response = await fetch(COMPANY_API_SAVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(companyApiPayload),
      });

      console.log('API Response status:', response.status);
      console.log('API Response headers:', response.headers);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Company API Error:', errorData);
        throw new Error(`Company API error! status: ${response.status}. ${errorData.detail || errorData.message || ''}`);
      }

      const result = await response.json();
      console.log('Company API Response:', result);
      
      // Handle return URL redirect if configured
      if (urlParams.return_url) {
        const returnUrl = constructReturnUrl(urlParams.return_url, graphId);
        console.log('Redirecting to:', returnUrl);
        window.location.href = returnUrl;
      } else {
        alert('Data saved to company database successfully!');
      }
      return true;
    } catch (error) {
      console.error('Full error object:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      
      // Check if it's a CORS or network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        alert('Error saving to company database: Network or CORS error.\n\nThis is likely a CORS issue. The API at discoveree.io needs to allow requests from Netlify.\n\nPlease contact the API administrator to add CORS headers for: https://graph-capture.netlify.app');
      } else {
        alert('Error saving to company database: ' + error.message);
      }
      return false;
    }
  };

  const constructReturnUrl = (baseUrl, graphId) => {
    const url = new URL(baseUrl);
    
    // Add return parameters
    Object.entries(returnParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    
    // Add return_graph_id
    if (graphId) {
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
    <div className="graph-capture-page">
      <header className="page-header">
        <h1>Graph Data Capture Tool</h1>
        <p>Upload graph images and extract data points easily</p>
      </header>

      <div className="page-content">
        {!uploadedImage ? (
          <ImageUpload />
        ) : (
          <div className="capture-workspace">

            <div className="canvas-section">
              <GraphCanvas isReadOnly={isReadOnly} partNumber={urlParams.partno} manufacturer={urlParams.manufacturer} />
              <CapturedPointsList isReadOnly={isReadOnly} />
            </div>

            <div className="config-section">
              <GraphConfig 
                showTctj={urlParams.tctj !== "0"} 
                isGraphTitleReadOnly={!!urlParams.graph_title}
                isCurveNameReadOnly={!!urlParams.curve_title}
              />
              

              {/* Dynamic Symbol Input Boxes - Only show if other_symb exists in URL */}
              {symbolNames && symbolNames.length > 0 && (
                <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8, backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>Symbol Values</h3>
                  {symbolNames.map(symbol => (
                    <div key={symbol} style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500 }}>
                        {symbol}
                      </label>
                      <input
                        type="text"
                        value={symbolValues[symbol] || ''}
                        onChange={(e) => setSymbolValues({ ...symbolValues, [symbol]: e.target.value })}
                        placeholder={`Enter value for ${symbol}`}
                        style={{ width: '100%', padding: '8px', background: '#2d2d2d', color: '#ffffff', border: '1px solid #444', borderRadius: '4px' }}
                      />
                    </div>
                  ))}
                </div>
              )}
              

              <div className="action-buttons">
                <button 
                  onClick={handleSave} 
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Graph and Return'}
                </button>
              </div>

              {/* Temporarily disabled - View Saved Points button */}
              {/* <div style={{ marginTop: 16 }}>
                <button
                  onClick={handleViewSavedPoints}
                  className="btn btn-outline"
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
    </div>
  );
};

export default GraphCapture;

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
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const [urlParams, setUrlParams] = useState({
    partno: '',
    manf: '',
    graph_title: '',
    curve_title: '',
    xlabel: '',
    ylabel: '',
    other_symb: '',
    discoveree_cat_id: '',
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setUrlParams({
      partno: searchParams.get('partno') || '',
      manf: searchParams.get('manf') || '',
      graph_title: searchParams.get('graph_title') || '',
      curve_title: searchParams.get('curve_title') || '',
      xlabel: searchParams.get('xlabel') || '',
      ylabel: searchParams.get('ylabel') || '',
      other_symb: searchParams.get('other_symb') || '',
      discoveree_cat_id: searchParams.get('discoveree_cat_id') || '',
    });
  }, []);

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
        manufacturer: urlParams.manf || null,
        graph_title: urlParams.graph_title || null,
        x_label: urlParams.xlabel || null,
        y_label: urlParams.ylabel || null,
        other_symbols: urlParams.other_symb || null,
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

  const handleViewSavedPoints = async () => {
    setShowSavedPanel(true);
    setIsFetchingSaved(true);
    setSavedCurvesError('');
    try {
      const response = await fetch(`${apiUrl}/api/curves`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const curves = await response.json();
      setSavedCurves(Array.isArray(curves) ? curves : []);
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
              <GraphCanvas isReadOnly={isReadOnly} />
              <CapturedPointsList isReadOnly={isReadOnly} />
            </div>
            
            <div className="config-section">
              <GraphConfig />
              
              <div className="action-buttons">
                <button 
                  onClick={handleSave} 
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Data Points'}
                </button>
                <button 
                  onClick={() => window.location.reload()} 
                  className="btn btn-outline"
                >
                  New Graph
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
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
                        {savedCurves.map((curve) => (
                          <option key={curve.id} value={curve.id}>
                            {curve.curve_name} (ID: {curve.id})
                          </option>
                        ))}
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GraphCapture;

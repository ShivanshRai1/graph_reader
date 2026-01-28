import ImageUpload from '../components/ImageUpload';
import GraphCanvas from '../components/GraphCanvas';
import GraphConfig from '../components/GraphConfig';
import CapturedPointsList from '../components/CapturedPointsList';
import { useGraph } from '../context/GraphContext';
import { useState } from 'react';
import './GraphCapture.css';

const GraphCapture = () => {
  const { uploadedImage, graphConfig, dataPoints } = useGraph();
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!graphConfig.curveName) {
      alert('Please enter a curve name');
      return;
    }
    if (dataPoints.length === 0) {
      alert('Please capture at least one data point');
      return;
    }
    // Validate log min/max
    if (graphConfig.xScale === 'Logarithmic') {
      if (!(parseFloat(graphConfig.xMin) > 0) || !(parseFloat(graphConfig.xMax) > 0)) {
        alert('For logarithmic X axis, min and max must be > 0');
        return;
      }
    }
    if (graphConfig.yScale === 'Logarithmic') {
      if (!(parseFloat(graphConfig.yMin) > 0) || !(parseFloat(graphConfig.yMax) > 0)) {
        alert('For logarithmic Y axis, min and max must be > 0');
        return;
      }
    }
    setIsSaving(true);
    try {
      // Show informative message if backend might be cold starting
      const startTime = Date.now();
      
      // Save to backend
      const payload = {
        part_number: graphConfig.partNumber || null,
        curve_name: graphConfig.curveName,
        x_scale: graphConfig.xScale,
        y_scale: graphConfig.yScale,
        x_unit: graphConfig.xUnitPrefix,
        y_unit: graphConfig.yUnitPrefix,
        x_min: parseFloat(graphConfig.xMin),
        x_max: parseFloat(graphConfig.xMax),
        y_min: parseFloat(graphConfig.yMin),
        y_max: parseFloat(graphConfig.yMax),
        temperature: graphConfig.temperature,
        data_points: dataPoints.map(point => ({
          x_value: point.x,
          y_value: point.y,
        })),
      };

      console.log('Sending payload:', payload);

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      
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
              <GraphCanvas />
              <CapturedPointsList />
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GraphCapture;

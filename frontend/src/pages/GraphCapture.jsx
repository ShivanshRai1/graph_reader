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
    
    setIsSaving(true);
    
    try {
      // Save to backend
      const payload = {
        curve_name: graphConfig.curveName,
        x_scale: graphConfig.xScale,
        y_scale: graphConfig.yScale,
        x_unit: graphConfig.xUnit,
        y_unit: graphConfig.yUnit,
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

      const response = await fetch('http://localhost:8000/api/curves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error response:', errorData);
        throw new Error(`HTTP error! status: ${response.status}. ${errorData.detail || ''}`);
      }

      const result = await response.json();
      alert(`Curve saved successfully! (ID: ${result.id})`);
      setIsSaving(false);
    } catch (error) {
      console.error('Full error:', error);
      alert('Error saving curve: ' + error.message + '\n\nMake sure backend is running at http://localhost:8000');
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
      csv += `${point.x.toFixed(6)},${point.y.toFixed(6)}\n`;
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

import { useGraph } from '../context/GraphContext';
import { parseFile } from '../utils/fileParser';
import './CapturedPointsList.css';
import { useEffect, useState } from 'react';

const CapturedPointsList = ({ isReadOnly = false }) => {
  const { dataPoints, clearDataPoints, importDataPoints, uploadedImage, updateDataPoint, deleteDataPoint, graphConfig, graphArea } = useGraph();
  const [editingIndex, setEditingIndex] = useState(null);
  const [editX, setEditX] = useState('');
  const [editY, setEditY] = useState('');

  // Check if config is set up for import
  const isConfigValid = () => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    
    return (
      !isNaN(xMin) && !isNaN(xMax) && !isNaN(yMin) && !isNaN(yMax) &&
      xMin !== xMax && yMin !== yMax &&
      graphArea.width > 0 && graphArea.height > 0 &&
      graphConfig.xScale && graphConfig.yScale &&
      graphConfig.xScale !== '' && graphConfig.yScale !== '' &&
      graphConfig.xUnitPrefix && graphConfig.xUnitPrefix !== '' &&
      graphConfig.yUnitPrefix && graphConfig.yUnitPrefix !== ''
    );
  };

  useEffect(() => {
    if (isReadOnly && editingIndex !== null) {
      setEditingIndex(null);
      setEditX('');
      setEditY('');
    }
  }, [isReadOnly, editingIndex]);

  const exportToCSV = () => {
    if (dataPoints.length === 0) {
      alert('No data points to export');
      return;
    }

    const csvContent = [
      ['X', 'Y'],
      ...dataPoints.map(point => [
        typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(6) : 'Invalid',
        typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(6) : 'Invalid'
      ])
    ]
      .map(row => row.join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `graph_data_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = () => {
    if (dataPoints.length === 0) {
      alert('No data points to export');
      return;
    }

    const jsonData = dataPoints.map((point, index) => ({
      index: index + 1,
      x: typeof point.x === 'number' && !isNaN(point.x) ? point.x : null,
      y: typeof point.y === 'number' && !isNaN(point.y) ? point.y : null
    }));

    const jsonContent = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `graph_data_${new Date().getTime()}.json`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileImport = async (event) => {
    if (isReadOnly) {
      alert('Points are read-only after saving. Start a new graph to import more points.');
      event.target.value = '';
      return;
    }
    const file = event.target.files[0];
    if (!file) return;

    if (!uploadedImage) {
      alert('Please upload a graph image before importing data points.');
      event.target.value = '';
      return;
    }

    try {
      const importedPoints = await parseFile(file);
      
      if (importedPoints.length === 0) {
        alert('No data points found in the file');
        return;
      }
      
      importDataPoints(importedPoints);
      alert(`Imported ${importedPoints.length} data points from file`);
    } catch (error) {
      alert(`Error importing file: ${error.message}`);
    }
    
    // Reset input so the same file can be imported again if needed
    event.target.value = '';
  };

  const handleEditClick = (index) => {
    if (isReadOnly) {
      return;
    }
    const point = dataPoints[index];
    setEditingIndex(index);
    setEditX(parseFloat(point.x).toFixed(4));
    setEditY(parseFloat(point.y).toFixed(4));
  };

  const handleSaveEdit = (index) => {
    const newX = parseFloat(editX);
    const newY = parseFloat(editY);

    if (isNaN(newX) || isNaN(newY)) {
      alert('Please enter valid numeric values');
      return;
    }

    updateDataPoint(index, newX, newY);
    setEditingIndex(null);
    setEditX('');
    setEditY('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditX('');
    setEditY('');
  };

  const handleDeletePoint = (index) => {
    if (isReadOnly) {
      return;
    }
    if (window.confirm('Are you sure you want to delete this point?')) {
      deleteDataPoint(index);
    }
  };

  // Copy points as tab-separated table for easy pasting
  const copyToClipboard = () => {
    if (dataPoints.length === 0) {
      alert('No data points to copy');
      return;
    }
    const header = ['#', 'X', 'Y'];
    const rows = dataPoints.map((point, idx) => [
      (idx + 1).toString(),
      typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(4) : 'Invalid',
      typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(4) : 'Invalid',
    ]);
    const table = [header, ...rows].map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(table).then(() => {
      alert('Captured points copied to clipboard!');
    }, () => {
      alert('Failed to copy to clipboard.');
    });
  };

  return (
    <div className="captured-points-container">
      <div className="points-header">
        <h3>Captured Points: {dataPoints.length}</h3>
        {isReadOnly && (
          <span className="read-only-badge">Read-only (saved)</span>
        )}
      </div>

      <div className="action-buttons">
        <input 
          type="file" 
          id="file-import" 
          accept=".csv,.json"
          onChange={handleFileImport}
          className="file-input-hidden"
        />
        <button 
          onClick={() => document.getElementById('file-import').click()} 
          className="btn btn-primary"
          disabled={isReadOnly || !isConfigValid()}
          title={isReadOnly ? 'Points are read-only after saving' : !isConfigValid() ? 'Setup required: 1) Draw the graph area (blue box), 2) Set X/Y Min/Max values, 3) Select X/Y Scale, 4) Select X/Y Unit' : 'Import data points from CSV or JSON file'}
        >
          📥 Import from File
        </button>
        <button 
          onClick={exportToCSV} 
          className="btn btn-secondary"
          disabled={dataPoints.length === 0}
        >
          📄 Export CSV
        </button>
        <button 
          onClick={exportToJSON} 
          className="btn btn-secondary"
          disabled={dataPoints.length === 0}
        >
          📋 Export JSON
        </button>
        <button
          onClick={copyToClipboard}
          className="btn btn-secondary"
          disabled={dataPoints.length === 0}
          title="Copy all points as table for pasting into Notepad, Word, etc."
        >
          📋 Copy Table
        </button>
        <button 
          onClick={clearDataPoints} 
          className="btn btn-danger"
          disabled={dataPoints.length === 0 || isReadOnly}
          title={isReadOnly ? 'Points are read-only after saving' : 'Clear all points'}
        >
          🗑️ Clear All
        </button>
      </div>
      
      {dataPoints.length === 0 ? (
        <div className="empty-state">
          <p>No points captured yet. Click on the graph to add points.</p>
        </div>
      ) : (
        <div className="points-table-wrapper">
          <table className="points-table">
            <thead>
              <tr>
                <th>#</th>
                <th>X Value</th>
                <th>Y Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataPoints.map((point, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {editingIndex === index ? (
                    <>
                      <td>
                        <input
                          type="number"
                          value={editX}
                          onChange={(e) => setEditX(e.target.value)}
                          step="any"
                          className="edit-input"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={editY}
                          onChange={(e) => setEditY(e.target.value)}
                          step="any"
                          className="edit-input"
                        />
                      </td>
                      <td className="action-cell">
                        <button
                          onClick={() => handleSaveEdit(index)}
                          className="btn btn-small btn-primary"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="btn btn-small btn-secondary"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="value-cell">
                        {typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(4) : 'Invalid'}
                      </td>
                      <td className="value-cell">
                        {typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(4) : 'Invalid'}
                      </td>
                      <td className="action-cell">
                        {!isReadOnly && (
                          <>
                            <button
                              onClick={() => handleEditClick(index)}
                              className="btn btn-small btn-primary"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeletePoint(index)}
                              className="btn btn-small btn-danger"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CapturedPointsList;

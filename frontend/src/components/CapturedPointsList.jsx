import { useGraph } from '../context/GraphContext';
import { parseFile } from '../utils/fileParser';
import './CapturedPointsList.css';
import { useEffect, useState } from 'react';

const CapturedPointsList = ({ isReadOnly = false }) => {
  const { dataPoints, clearDataPoints, importDataPoints, uploadedImage, updateDataPoint, deleteDataPoint } = useGraph();
  const [editingIndex, setEditingIndex] = useState(null);
  const [editX, setEditX] = useState('');
  const [editY, setEditY] = useState('');

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

  return (
    <div className="captured-points-container">
      <div className="points-header">
        <h3>Captured Points ({dataPoints.length})</h3>
        {isReadOnly ? (
          <span style={{ marginLeft: 12, color: '#555', fontSize: 13 }}>
            Read-only (saved)
          </span>
        ) : null}
        <div className="points-actions">
          <input 
            type="file" 
            id="file-import" 
            accept=".csv,.json"
            onChange={handleFileImport}
            style={{ display: 'none' }}
          />
          <button 
            onClick={() => document.getElementById('file-import').click()} 
            className="btn btn-primary"
            disabled={isReadOnly}
            title={isReadOnly ? 'Points are read-only after saving' : 'Import from file'}
          >
            Import from File
          </button>
          <button 
            onClick={exportToCSV} 
            className="btn btn-primary"
            disabled={dataPoints.length === 0}
          >
            Export CSV
          </button>
          <button 
            onClick={exportToJSON} 
            className="btn btn-primary"
            disabled={dataPoints.length === 0}
          >
            Export JSON
          </button>
          <button 
            onClick={clearDataPoints} 
            className="btn btn-danger"
            disabled={dataPoints.length === 0 || isReadOnly}
            title={isReadOnly ? 'Points are read-only after saving' : 'Clear all points'}
          >
            Clear All
          </button>
        </div>
      </div>
      
      <div className="points-list-wrapper">
        {dataPoints.length === 0 ? (
          <div className="no-points-message">
            No points captured yet. Click on the graph to add points.
          </div>
        ) : (
          <table className="points-table">
            <thead>
              <tr>
                <th>#</th>
                <th>X</th>
                <th>Y</th>
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
                          style={{ width: '100%', padding: '4px' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={editY}
                          onChange={(e) => setEditY(e.target.value)}
                          step="any"
                          style={{ width: '100%', padding: '4px' }}
                        />
                      </td>
                      <td style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleSaveEdit(index)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(4) : 'Invalid'}</td>
                      <td>{typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(4) : 'Invalid'}</td>
                      <td style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleEditClick(index)}
                          disabled={point.imported || isReadOnly}
                          title={isReadOnly ? 'Points are read-only after saving' : (point.imported ? 'Cannot edit imported points' : 'Edit this point')}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: (point.imported || isReadOnly) ? '#ccc' : '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: (point.imported || isReadOnly) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          ✎ Edit
                        </button>
                        <button
                          onClick={() => handleDeletePoint(index)}
                          disabled={point.imported || isReadOnly}
                          title={isReadOnly ? 'Points are read-only after saving' : (point.imported ? 'Cannot delete imported points' : 'Delete this point')}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: (point.imported || isReadOnly) ? '#ccc' : '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: (point.imported || isReadOnly) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          🗑 Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default CapturedPointsList;

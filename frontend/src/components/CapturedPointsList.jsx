import { useGraph } from '../context/GraphContext';
import { parseFile } from '../utils/fileParser';
import './CapturedPointsList.css';

const CapturedPointsList = () => {
  const { dataPoints, clearDataPoints, importDataPoints, uploadedImage } = useGraph();

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

  return (
    <div className="captured-points-container">
      <div className="points-header">
        <h3>Captured Points ({dataPoints.length})</h3>
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
            disabled={dataPoints.length === 0}
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
              </tr>
            </thead>
            <tbody>
              {dataPoints.map((point, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>{typeof point.x === 'number' && !isNaN(point.x) ? point.x.toFixed(4) : 'Invalid'}</td>
                  <td>{typeof point.y === 'number' && !isNaN(point.y) ? point.y.toFixed(4) : 'Invalid'}</td>
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

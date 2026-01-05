import { useGraph } from '../context/GraphContext';
import './CapturedPointsList.css';

const CapturedPointsList = () => {
  const { dataPoints, clearDataPoints } = useGraph();

  const exportToCSV = () => {
    if (dataPoints.length === 0) {
      alert('No data points to export');
      return;
    }

    const csvContent = [
      ['X', 'Y'],
      ...dataPoints.map(point => [point.x.toFixed(6), point.y.toFixed(6)])
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

  return (
    <div className="captured-points-container">
      <div className="points-header">
        <h3>Captured Points ({dataPoints.length})</h3>
        <div className="points-actions">
          <button 
            onClick={exportToCSV} 
            className="btn btn-primary"
            disabled={dataPoints.length === 0}
          >
            Export CSV
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
                  <td>{point.x.toFixed(4)}</td>
                  <td>{point.y.toFixed(4)}</td>
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

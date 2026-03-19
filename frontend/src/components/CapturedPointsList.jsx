import { useGraph } from '../context/GraphContext';
import { parseFile } from '../utils/fileParser';
import { useEffect, useState } from 'react';

const CapturedPointsList = ({ isReadOnly = false, hasReturnUrl = false }) => {
  const { dataPoints, clearDataPoints, importDataPoints, uploadedImage, updateDataPoint, deleteDataPoint, graphConfig, graphArea } = useGraph();
  const [editingIndex, setEditingIndex] = useState(null);
  const [editX, setEditX] = useState('');
  const [editY, setEditY] = useState('');

  const formatDisplayValue = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Invalid';
    return (Math.abs(value) > 0 && Math.abs(value) < 0.0001)
      ? value.toExponential(6)
      : value.toFixed(6);
  };

  const formatExportValue = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Invalid';
    return value.toFixed(6);
  };

  const getExportMeta = () => {
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);

    return {
      graphTitle: graphConfig.graphTitle || '',
      curveName: graphConfig.curveName || '',
      xScale: graphConfig.xScale || '',
      yScale: graphConfig.yScale || '',
      xUnitPrefix: graphConfig.xUnitPrefix || '',
      yUnitPrefix: graphConfig.yUnitPrefix || '',
      xMin: Number.isFinite(xMin) ? formatExportValue(xMin) : '',
      xMax: Number.isFinite(xMax) ? formatExportValue(xMax) : '',
      yMin: Number.isFinite(yMin) ? formatExportValue(yMin) : '',
      yMax: Number.isFinite(yMax) ? formatExportValue(yMax) : '',
      temperature: graphConfig.temperature || '',
      exportedAt: new Date().toISOString(),
    };
  };

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

  const exportToCSV = () => {
    if (dataPoints.length === 0) {
      alert('No data points to export');
      return;
    }
    const meta = getExportMeta();
    const metaRows = [
      ['# Graph Title', meta.graphTitle],
      ['# Curve Name', meta.curveName],
      ['# X Scale', meta.xScale],
      ['# Y Scale', meta.yScale],
      ['# X Unit Prefix', meta.xUnitPrefix],
      ['# Y Unit Prefix', meta.yUnitPrefix],
      ['# X Min', meta.xMin],
      ['# X Max', meta.xMax],
      ['# Y Min', meta.yMin],
      ['# Y Max', meta.yMax],
      ['# Temperature', meta.temperature],
      ['# Exported At', meta.exportedAt],
      [''],
    ];
    const header = ['#', 'X', 'Y'];
    const rows = dataPoints.map((point, idx) => [
      (idx + 1).toString(),
      formatExportValue(point.x),
      formatExportValue(point.y),
    ]);
    const csvContent = [...metaRows, header, ...rows].map(row => row.join(',')).join('\n');
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
    const jsonData = {
      metadata: getExportMeta(),
      points: dataPoints.map((point, index) => ({
        index: index + 1,
        x: formatExportValue(point.x),
        y: formatExportValue(point.y),
      })),
    };

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
    
    event.target.value = '';
  };

  const handleEditClick = (index) => {
    if (isReadOnly) {
      return;
    }
    const point = dataPoints[index];
    setEditingIndex(index);
    setEditX(Number.isFinite(point.x) ? String(point.x) : '');
    setEditY(Number.isFinite(point.y) ? String(point.y) : '');
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

  const copyToClipboard = () => {
    if (dataPoints.length === 0) {
      alert('No data points to copy');
      return;
    }
    const header = ['#', 'X', 'Y'];
    const rows = dataPoints.map((point, idx) => [
      (idx + 1).toString(),
      formatExportValue(point.x),
      formatExportValue(point.y),
    ]);
    const table = [header, ...rows].map(row => row.join(',')).join('\n');
    navigator.clipboard.writeText(table).then(() => {
      alert('Captured points copied to clipboard!');
    }, () => {
      alert('Failed to copy to clipboard.');
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mt-5">
      <div className="flex justify-between items-center mb-4 pb-4 border-b-2 border-gray-100">
        <div>
          <h3 className="text-gray-800 text-lg font-semibold m-0">Captured Points: {dataPoints.length}</h3>
          {hasReturnUrl && dataPoints.length < 5 && dataPoints.length > 0 && (
            <p className="text-xs text-orange-600 mt-1">⚠️ Need at least 5 points for a meaningful fit (currently {dataPoints.length})</p>
          )}
          {dataPoints.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">No points captured yet. Confirm axis mapping first, then click on the graph.</p>
          )}
          {hasReturnUrl && dataPoints.length >= 5 && (
            <p className="text-xs text-green-600 mt-1">✓ Ready to fit/export ({dataPoints.length} points)</p>
          )}
        </div>
        {isReadOnly && (
          <span className="px-3 py-1 bg-gray-100 text-blue-700 text-xs rounded-full font-medium">Read-only (saved)</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input 
          type="file" 
          id="file-import" 
          accept=".csv,.json"
          onChange={handleFileImport}
          className="hidden"
        />
        <button 
          onClick={() => document.getElementById('file-import').click()} 
          className="px-4 py-2 rounded bg-blue-600 text-white font-medium disabled:opacity-50"
          disabled={isReadOnly || !isConfigValid()}
          title={isReadOnly ? 'Points are read-only after saving' : !isConfigValid() ? 'Setup required: 1) Draw the graph area (blue box), 2) Set X/Y Min/Max values, 3) Select X/Y Scale, 4) Select X/Y Unit' : 'Import data points from CSV or JSON file'}
        >
          📥 Import from File
        </button>
        <button 
          onClick={exportToCSV} 
          className="px-4 py-2 rounded bg-gray-700 text-white font-medium disabled:opacity-50"
          disabled={dataPoints.length === 0}
        >
          📄 Export CSV
        </button>
        <button 
          onClick={exportToJSON} 
          className="px-4 py-2 rounded bg-gray-700 text-white font-medium disabled:opacity-50"
          disabled={dataPoints.length === 0}
        >
          📋 Export JSON
        </button>
        <button
          onClick={copyToClipboard}
          className="px-4 py-2 rounded bg-gray-700 text-white font-medium disabled:opacity-50"
          disabled={dataPoints.length === 0}
          title="Copy all points as table for pasting into Notepad, Word, etc."
        >
          📋 Copy Table
        </button>
      </div>

      {dataPoints.length === 0 ? (
        <div className="text-center p-10 text-gray-500 italic bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg">
          <p>No points yet. Click the graph to add points.</p>
        </div>
      ) : (
        <>
          <div className="max-h-96 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-blue-50">
              <tr className="border-b-2 border-gray-300">
                <th className="text-right px-3 py-2 text-sm font-semibold text-gray-900 bg-blue-50 border-r border-gray-300">#</th>
                <th className="text-right px-3 py-2 text-sm font-semibold text-gray-900 bg-blue-50 border-r border-gray-300">
                  X Value
                </th>
                <th className="text-right px-3 py-2 text-sm font-semibold text-gray-900 bg-blue-50 border-r border-gray-300">
                  Y Value
                </th>
                <th className="text-center px-3 py-2 text-sm font-semibold text-gray-900 bg-blue-50">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataPoints.map((point, index) => (
                <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="text-right px-3 py-2 text-sm text-gray-900 bg-white border-r border-gray-300">{index + 1}</td>
                  {editingIndex === index ? (
                    <>
                      <td className="text-right px-3 py-2 border-r border-gray-300">
                        <input
                          type="number"
                          value={editX}
                          onChange={(e) => setEditX(e.target.value)}
                          step="any"
                          className="w-full px-2 py-1 border border-blue-600 rounded font-mono text-sm text-gray-900 bg-white"
                        />
                      </td>
                      <td className="text-right px-3 py-2 border-r border-gray-300">
                        <input
                          type="number"
                          value={editY}
                          onChange={(e) => setEditY(e.target.value)}
                          step="any"
                          className="w-full px-2 py-1 border border-blue-600 rounded font-mono text-sm text-gray-900 bg-white"
                        />
                      </td>
                      <td className="text-center px-3 py-2">
                        <button
                          onClick={() => handleSaveEdit(index)}
                          className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium mr-1"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1 rounded bg-gray-700 text-white text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-right px-3 py-2 font-mono text-sm text-gray-900 bg-white border-r border-gray-300">
                        {formatDisplayValue(point.x)}
                      </td>
                      <td className="text-right px-3 py-2 font-mono text-sm text-gray-900 bg-white border-r border-gray-300">
                        {formatDisplayValue(point.y)}
                      </td>
                      <td className="text-center px-3 py-2">
                        {!isReadOnly && (
                          <>
                            <button
                              onClick={() => handleEditClick(index)}
                              className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium mr-1"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeletePoint(index)}
                              className="px-3 py-1 rounded bg-red-600 text-white text-xs font-medium"
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
        </>
      )}
    </div>
  );
};

export default CapturedPointsList;

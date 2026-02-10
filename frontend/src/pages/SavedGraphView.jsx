import { useEffect, useMemo, useState } from 'react';
import SavedGraphPreview from '../components/SavedGraphPreview';

const buildCurveConfig = (curve) => ({
  xMin: curve.x_min,
  xMax: curve.x_max,
  yMin: curve.y_min,
  yMax: curve.y_max,
  xScale: curve.x_scale,
  yScale: curve.y_scale,
  xUnit: curve.x_unit,
  yUnit: curve.y_unit,
  xLabel: curve.x_label,
  yLabel: curve.y_label,
  graphTitle: curve.graph_title,
});

const SavedGraphView = ({ curveId }) => {
  const [curve, setCurve] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    if (!curveId) {
      setError('Missing curve id.');
      setIsLoading(false);
      return;
    }

    const fetchCurve = async () => {
      try {
        setIsLoading(true);
        setError('');
        const response = await fetch(`${apiUrl}/api/curves/${curveId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        setCurve(result);
      } catch (err) {
        setError(err.message || 'Unable to load curve.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCurve();
  }, [curveId, apiUrl]);

  const config = useMemo(() => (curve ? buildCurveConfig(curve) : null), [curve]);
  const points = curve?.data_points ?? [];

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: '#213547' }}>
        Loading curve...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: '#b91c1c' }}>
        {error}
      </div>
    );
  }

  if (!curve) {
    return (
      <div style={{ padding: 32, color: '#213547' }}>
        Curve not found.
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen p-8" style={{ backgroundColor: '#ffffff', color: '#213547' }}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#213547' }}>
          {curve.curve_name || curve.graph_title || 'Saved Graph'}
        </h1>
        <p className="text-sm mt-2" style={{ color: '#6b7280' }}>
          ID: {curve.id}
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <SavedGraphPreview points={points} config={config} width={900} height={360} animate />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-semibold mb-1">X-Axis</div>
            <div className="text-xs">Scale: {curve.x_scale || 'Linear'}</div>
            <div className="text-xs">Min: {curve.x_min}</div>
            <div className="text-xs">Max: {curve.x_max}</div>
          </div>
          <div>
            <div className="text-sm font-semibold mb-1">Y-Axis</div>
            <div className="text-xs">Scale: {curve.y_scale || 'Linear'}</div>
            <div className="text-xs">Min: {curve.y_min}</div>
            <div className="text-xs">Max: {curve.y_max}</div>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-2">Captured Points ({points.length})</div>
          <table className="w-full text-xs border" style={{ borderColor: 'var(--color-border)' }}>
            <thead>
              <tr style={{ backgroundColor: '#222', color: '#fff' }}>
                <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>
                  X
                </th>
                <th className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#fff' }}>
                  Y
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt, idx) => (
                <tr key={idx}>
                  <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                    {pt.x_value}
                  </td>
                  <td className="px-2 py-1 border" style={{ borderColor: 'var(--color-border)', color: '#213547', background: '#fff' }}>
                    {pt.y_value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SavedGraphView;

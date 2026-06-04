import { useMemo, useState } from 'react';
import SavedGraphCombinedPreview from '../components/SavedGraphCombinedPreview';
import {
  compareTypicalCurveFiles,
  prefixTypicalCurveCurves,
  readTypicalCurveFile,
} from '../utils/tcImport';

const fileInputStyle = {
  display: 'block',
  marginTop: 6,
  fontSize: 14,
};

const panelStyle = {
  maxWidth: 960,
  margin: '0 auto',
  padding: 24,
  color: '#213547',
};

const TcPlotChecker = () => {
  const [reference, setReference] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState('');
  const [sortByX, setSortByX] = useState(true);

  const loadFile = async (file, slot) => {
    if (!file) return;
    setError('');
    try {
      const parsed = await readTypicalCurveFile(file);
      if (slot === 'reference') setReference({ name: file.name, parsed });
      else setCandidate({ name: file.name, parsed });
    } catch (err) {
      setError(err.message || 'Failed to parse .tc file.');
    }
  };

  const comparison = useMemo(() => {
    if (!reference?.parsed || !candidate?.parsed) return null;
    return compareTypicalCurveFiles(reference.parsed, candidate.parsed);
  }, [reference, candidate]);

  const overlayCurves = useMemo(() => {
    const curves = [];
    if (reference?.parsed) {
      curves.push(...prefixTypicalCurveCurves(reference.parsed, 'Reference'));
    }
    if (candidate?.parsed) {
      curves.push(...prefixTypicalCurveCurves(candidate.parsed, 'Yours'));
    }
    return curves;
  }, [reference, candidate]);

  const plotConfig = useMemo(() => {
    const base = reference?.parsed?.config || candidate?.parsed?.config;
    if (!base) return null;
    return {
      ...base,
      graphTitle: [reference?.parsed?.config?.graphTitle, candidate?.parsed?.config?.graphTitle]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .join(' vs ') || base.graphTitle,
    };
  }, [reference, candidate]);

  const hasPlot = overlayCurves.length > 0 && plotConfig;

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f8fafc' }}>
      <div style={panelStyle}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>.tc plot checker</h1>
          <p style={{ marginTop: 8, color: '#475569', lineHeight: 1.5 }}>
            Upload one or two HPPeval .tc files to plot the curves and compare reference vs your export.
            Open this page with{' '}
            <code style={{ fontSize: 13 }}>?view=tc-checker</code>
            {' '}on your Graph Capture URL.
          </p>
          <a
            href={window.location.pathname}
            style={{ fontSize: 14, color: '#2563eb' }}
          >
            Back to Graph Capture
          </a>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <label style={{ display: 'block', padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <strong>Reference .tc</strong> (optional)
            <input
              type="file"
              accept=".tc,application/json"
              style={fileInputStyle}
              onChange={(event) => {
                const file = event.target.files?.[0];
                loadFile(file, 'reference');
                event.target.value = '';
              }}
            />
            {reference?.name && (
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: '#64748b' }}>
                Loaded: {reference.name}
              </span>
            )}
          </label>

          <label style={{ display: 'block', padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <strong>Your .tc</strong>
            <input
              type="file"
              accept=".tc,application/json"
              style={fileInputStyle}
              onChange={(event) => {
                const file = event.target.files?.[0];
                loadFile(file, 'candidate');
                event.target.value = '';
              }}
            />
            {candidate?.name && (
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: '#64748b' }}>
                Loaded: {candidate.name}
              </span>
            )}
          </label>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={sortByX}
            onChange={(event) => setSortByX(event.target.checked)}
          />
          Connect points left-to-right (sort by X)
        </label>

        {error && (
          <p style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</p>
        )}

        {hasPlot && (
          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{plotConfig.graphTitle}</h2>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
              X: {plotConfig.xLabel} ({plotConfig.xMin} – {plotConfig.xMax},{' '}
              {plotConfig.xScale})
              {' · '}
              Y: {plotConfig.yLabel} ({plotConfig.yMin} – {plotConfig.yMax},{' '}
              {plotConfig.yScale})
            </p>
            <SavedGraphCombinedPreview
              curves={overlayCurves}
              config={plotConfig}
              width={900}
              height={360}
              sortByX={sortByX}
            />
          </div>
        )}

        {comparison && (
          <div style={{ marginTop: 20, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Accuracy vs reference</h2>
            {Number.isFinite(comparison.overallMax) && (
              <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                Worst point error (any series):{' '}
                <strong>{comparison.overallMax.toFixed(6)}</strong>
                {' '}
                (same units as Y axis, e.g. % for efficiency)
              </p>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 4px' }}>Series</th>
                  <th style={{ padding: '8px 4px' }}>Points compared</th>
                  <th style={{ padding: '8px 4px' }}>Max |ΔY|</th>
                  <th style={{ padding: '8px 4px' }}>Mean |ΔY|</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={`${row.series}-${row.status}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 4px' }}>{row.series}</td>
                    <td style={{ padding: '8px 4px' }}>
                      {row.status === 'ok' ? row.pointCount : row.status.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.maxAbsError) ? row.maxAbsError.toFixed(6) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.meanAbsError) ? row.meanAbsError.toFixed(6) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
              Curves should overlap on the chart. Small max |ΔY| (e.g. under 0.05 for efficiency %) means your export matches the reference data.
            </p>
          </div>
        )}

        {!hasPlot && !error && (
          <p style={{ color: '#64748b' }}>Upload at least one .tc file to see the plot.</p>
        )}
      </div>
    </div>
  );
};

export default TcPlotChecker;

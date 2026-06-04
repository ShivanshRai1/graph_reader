import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  maxWidth: 1500,
  margin: '0 auto',
  padding: 24,
  color: '#213547',
};

const cardStyle = {
  display: 'block',
  padding: 12,
  background: '#fff',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
};

/** Charts only: reference + export on one plot */
const LAYOUT_OVERLAY = 'overlay';
/** Charts only: reference | export */
const LAYOUT_TC_SPLIT = 'tcSplit';
/** Original image | overlaid .tc */
const LAYOUT_IMAGE_OVERLAY = 'imageOverlay';
/** Original image | reference .tc | export .tc (two charts on the right) */
const LAYOUT_IMAGE_TC_SPLIT = 'imageTcSplit';
/** Original | reference .tc | export .tc in one row */
const LAYOUT_TRIPLE = 'triple';

const imagePanelStyle = {
  flex: '0 1 360px',
  minWidth: 240,
  maxWidth: 420,
};

const TcPlotChecker = () => {
  const [reference, setReference] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [originalImage, setOriginalImage] = useState(null);
  const [error, setError] = useState('');
  const [sortByX, setSortByX] = useState(true);
  const [layoutMode, setLayoutMode] = useState(LAYOUT_OVERLAY);
  const imageUrlRef = useRef(null);

  const revokeImageUrl = useCallback(() => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }
  }, []);

  const setImageFromBlob = useCallback((blob, name) => {
    if (!blob || !String(blob.type || '').startsWith('image/')) {
      setError('Clipboard does not contain an image. Copy a graph screenshot or use file upload.');
      return;
    }
    setError('');
    revokeImageUrl();
    const url = URL.createObjectURL(blob);
    imageUrlRef.current = url;
    setOriginalImage({ name: name || 'Pasted image', url });
    setLayoutMode((prev) => {
      if (prev === LAYOUT_OVERLAY) return LAYOUT_IMAGE_OVERLAY;
      if (prev === LAYOUT_TC_SPLIT) return LAYOUT_IMAGE_TC_SPLIT;
      return prev;
    });
  }, [revokeImageUrl]);

  useEffect(() => () => revokeImageUrl(), [revokeImageUrl]);

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

  const loadImageFile = (file) => {
    if (!file) return;
    setImageFromBlob(file, file.name);
  };

  const clearOriginalImage = () => {
    revokeImageUrl();
    setOriginalImage(null);
    setLayoutMode((prev) => {
      if (prev === LAYOUT_IMAGE_OVERLAY) return LAYOUT_OVERLAY;
      if (prev === LAYOUT_IMAGE_TC_SPLIT) return LAYOUT_TC_SPLIT;
      if (prev === LAYOUT_TRIPLE) return LAYOUT_OVERLAY;
      return prev;
    });
  };

  const handleImagePaste = (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        setImageFromBlob(file, 'Pasted image');
        return;
      }
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

  const referencePlotConfig = useMemo(() => {
    if (!reference?.parsed?.config) return null;
    return {
      ...reference.parsed.config,
      graphTitle: reference.parsed.config.graphTitle || 'Reference',
    };
  }, [reference]);

  const candidatePlotConfig = useMemo(() => {
    if (!candidate?.parsed?.config) return null;
    return {
      ...candidate.parsed.config,
      graphTitle: candidate.parsed.config.graphTitle || 'Your export',
    };
  }, [candidate]);

  const hasPlot = overlayCurves.length > 0 && plotConfig;
  const canComparePlots = Boolean(reference?.parsed && candidate?.parsed);
  const hasImage = Boolean(originalImage?.url);

  const layoutOptions = useMemo(() => {
    const options = [];
    if (hasImage && hasPlot) {
      options.push({
        id: LAYOUT_IMAGE_OVERLAY,
        label: canComparePlots ? 'Original + overlaid .tc' : 'Original + .tc chart',
      });
      if (canComparePlots) {
        options.push({ id: LAYOUT_IMAGE_TC_SPLIT, label: 'Original + .tc side by side' });
        options.push({ id: LAYOUT_TRIPLE, label: 'All three side by side' });
      }
    } else if (canComparePlots) {
      options.push({ id: LAYOUT_OVERLAY, label: 'Overlaid .tc only' });
      options.push({ id: LAYOUT_TC_SPLIT, label: 'Reference | export only' });
    }
    return options;
  }, [hasImage, hasPlot, canComparePlots]);

  useEffect(() => {
    if (layoutOptions.length === 0) return;
    const isValid = layoutOptions.some((option) => option.id === layoutMode);
    if (!isValid) {
      setLayoutMode(layoutOptions[0].id);
    }
  }, [layoutOptions, layoutMode]);

  const showImageInComparison = hasImage && (
    layoutMode === LAYOUT_IMAGE_OVERLAY ||
    layoutMode === LAYOUT_IMAGE_TC_SPLIT ||
    layoutMode === LAYOUT_TRIPLE
  );

  const isTripleLayout = layoutMode === LAYOUT_TRIPLE;
  const isOverlayLayout = layoutMode === LAYOUT_OVERLAY || layoutMode === LAYOUT_IMAGE_OVERLAY;
  const isTcSplitLayout = layoutMode === LAYOUT_TC_SPLIT || layoutMode === LAYOUT_IMAGE_TC_SPLIT;

  const chartWidth = isTripleLayout ? 360 : (isTcSplitLayout ? 400 : 520);
  const chartHeight = isTripleLayout ? 300 : (isTcSplitLayout ? 280 : 340);

  const renderOriginalImage = () => {
    if (!originalImage?.url) return null;
    return (
      <div style={showImageInComparison ? imagePanelStyle : undefined}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Original figure</h3>
        <img
          src={originalImage.url}
          alt={originalImage.name || 'Original graph'}
          style={{
            display: 'block',
            width: '100%',
            maxHeight: isTripleLayout ? 300 : 380,
            objectFit: 'contain',
            borderRadius: 4,
            border: '1px solid #e2e8f0',
            background: '#fff',
          }}
        />
      </div>
    );
  };

  const renderOverlayChart = () => (
    <SavedGraphCombinedPreview
      curves={overlayCurves}
      config={plotConfig}
      width={chartWidth}
      height={chartHeight}
      sortByX={sortByX}
    />
  );

  const renderSplitTcCharts = (compact = false) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12,
        flex: 1,
        minWidth: 0,
      }}
    >
      {reference?.parsed && referencePlotConfig && (
        <div>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Reference .tc</h3>
          <SavedGraphCombinedPreview
            curves={reference.parsed.curves}
            config={referencePlotConfig}
            width={chartWidth}
            height={chartHeight}
            sortByX={sortByX}
          />
        </div>
      )}
      {candidate?.parsed && candidatePlotConfig && (
        <div>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Your .tc</h3>
          <SavedGraphCombinedPreview
            curves={candidate.parsed.curves}
            config={candidatePlotConfig}
            width={chartWidth}
            height={chartHeight}
            sortByX={sortByX}
          />
        </div>
      )}
    </div>
  );

  const renderComparisonWorkspace = () => {
    if (!hasPlot && !hasImage) return null;

    if (isTripleLayout && hasImage && canComparePlots) {
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(240px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {renderOriginalImage()}
          {reference?.parsed && referencePlotConfig && (
            <div>
              <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Reference .tc</h3>
              <SavedGraphCombinedPreview
                curves={reference.parsed.curves}
                config={referencePlotConfig}
                width={chartWidth}
                height={chartHeight}
                sortByX={sortByX}
              />
            </div>
          )}
          {candidate?.parsed && candidatePlotConfig && (
            <div>
              <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Your .tc</h3>
              <SavedGraphCombinedPreview
                curves={candidate.parsed.curves}
                config={candidatePlotConfig}
                width={chartWidth}
                height={chartHeight}
                sortByX={sortByX}
              />
            </div>
          )}
        </div>
      );
    }

    if (showImageInComparison && hasPlot) {
      return (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          {renderOriginalImage()}
          <div style={{ flex: '1 1 480px', minWidth: 280 }}>
            {isOverlayLayout && (
              <>
                <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Reference + export (overlaid)</h3>
                {renderOverlayChart()}
              </>
            )}
            {isTcSplitLayout && canComparePlots && (
              <>
                <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#334155' }}>Reference vs export</h3>
                {renderSplitTcCharts(true)}
              </>
            )}
          </div>
        </div>
      );
    }

    if (hasImage && !hasPlot) {
      return renderOriginalImage();
    }

    if (!hasPlot) return null;

    if (isOverlayLayout) {
      return (
        <>
          {isOverlayLayout && layoutMode === LAYOUT_OVERLAY && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
              X: {plotConfig.xLabel} ({plotConfig.xMin} – {plotConfig.xMax}, {plotConfig.xScale})
              {' · '}
              Y: {plotConfig.yLabel} ({plotConfig.yMin} – {plotConfig.yMax}, {plotConfig.yScale})
            </p>
          )}
          {renderOverlayChart()}
        </>
      );
    }

    return renderSplitTcCharts(false);
  };

  return (
    <div className="w-full min-h-screen" style={{ backgroundColor: '#f8fafc' }}>
      <div style={panelStyle}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>.tc plot checker</h1>
          <p style={{ marginTop: 8, color: '#475569', lineHeight: 1.5 }}>
            Compare the original datasheet figure with reference and exported .tc files.
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <label style={cardStyle}>
            <strong>Original graph image</strong> (optional)
            <input
              type="file"
              accept="image/*"
              style={fileInputStyle}
              onChange={(event) => {
                loadImageFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {originalImage?.name && (
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: '#64748b' }}>
                Loaded: {originalImage.name}
                {' · '}
                <button
                  type="button"
                  onClick={clearOriginalImage}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 13,
                  }}
                >
                  Remove
                </button>
              </span>
            )}
          </label>

          <label style={cardStyle}>
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

          <label style={cardStyle}>
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

        <div
          tabIndex={0}
          onPaste={handleImagePaste}
          style={{
            marginBottom: 16,
            padding: '10px 12px',
            background: '#fff',
            borderRadius: 8,
            border: '1px dashed #cbd5e1',
            fontSize: 13,
            color: '#64748b',
            outline: 'none',
          }}
        >
          <strong style={{ color: '#334155' }}>Paste image:</strong>
          {' '}
          click this box, then press Ctrl+V (Cmd+V on Mac) to paste a screenshot of the original plot.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={sortByX}
              onChange={(event) => setSortByX(event.target.checked)}
            />
            Connect points left-to-right (sort by X)
          </label>

          {layoutOptions.length > 0 && (
            <fieldset
              style={{
                border: 'none',
                margin: 0,
                padding: 0,
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 12,
                fontSize: 14,
              }}
            >
              <legend style={{ display: 'none' }}>Comparison layout</legend>
              <span style={{ color: '#475569', fontWeight: 600 }}>Layout:</span>
              {layoutOptions.map((option) => (
                <label key={option.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="comparison-layout"
                    checked={layoutMode === option.id}
                    onChange={() => setLayoutMode(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>

        {error && (
          <p style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</p>
        )}

        {(hasPlot || hasImage) && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Comparison</h2>
            {renderComparisonWorkspace()}
          </div>
        )}

        {comparison && (
          <div style={{ ...cardStyle }}>
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
              {isOverlayLayout
                ? 'Overlaid curves should sit on top of each other. Small max |ΔY| (e.g. under 0.05 for efficiency %) means your export matches the reference data.'
                : 'Compare each chart to the original figure and to each other. Use overlaid layout for the tightest numeric check.'}
            </p>
          </div>
        )}

        {!hasPlot && !hasImage && !error && (
          <p style={{ color: '#64748b' }}>Upload an image and/or at least one .tc file to begin.</p>
        )}
      </div>
    </div>
  );
};

export default TcPlotChecker;

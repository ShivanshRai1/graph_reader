import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SavedGraphCombinedPreview from '../components/SavedGraphCombinedPreview';
import {
  downloadHtmlFragmentAsPng,
  downloadPanelAsPng,
} from '../utils/downloadPng';
import {
  compareTypicalCurveFiles,
  computeDiscoverEeAnalogRms,
  prefixTypicalCurveCurves,
  readTypicalCurveFile,
} from '../utils/tcImport';

const PNG_EXPORT_SCALE = 2;

const fileInputStyle = {
  display: 'block',
  marginTop: 6,
  fontSize: 14,
};

const panelStyle = {
  width: '100%',
  maxWidth: 1800,
  margin: '0 auto',
  padding: 24,
  color: '#213547',
  boxSizing: 'border-box',
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

/** Set true to show the numeric accuracy table when reference + export are loaded */
const SHOW_ACCURACY_TABLE = false;

/** Set true to show layout radio buttons (default layout stays LAYOUT_TRIPLE) */
const SHOW_LAYOUT_OPTIONS = false;

const LABEL_GRAPH_IMAGE = 'graph image from datasheet';
const LABEL_ANALOG_REFERENCE = 'Analog reference.tc';
const LABEL_DISCOVEREE = 'DiscoverEE Approach.tc';

const imagePanelStyle = {
  flex: '0 1 520px',
  minWidth: 300,
  maxWidth: 580,
};

const downloadBtnStyle = {
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #93c5fd',
  background: '#eff6ff',
  color: '#1d4ed8',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const buildExportSlug = (value) =>
  String(value || 'comparison')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'comparison';

const TcPlotChecker = () => {
  const [reference, setReference] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [originalImage, setOriginalImage] = useState(null);
  const [error, setError] = useState('');
  const [sortByX, setSortByX] = useState(true);
  const [layoutMode, setLayoutMode] = useState(LAYOUT_TRIPLE);
  const [pasteZoneFocused, setPasteZoneFocused] = useState(false);
  const [pasteZoneHovered, setPasteZoneHovered] = useState(false);
  const imageUrlRef = useRef(null);
  const pasteZoneRef = useRef(null);
  const comparisonWorkspaceRef = useRef(null);
  const panelImageRef = useRef(null);
  const panelDiscovereeRef = useRef(null);
  const panelAnalogRef = useRef(null);
  const rmsExportRef = useRef(null);

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
      if (reference?.parsed && candidate?.parsed) return LAYOUT_TRIPLE;
      return prev;
    });
  }, [revokeImageUrl, reference, candidate]);

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
    if (!SHOW_ACCURACY_TABLE || !reference?.parsed || !candidate?.parsed) return null;
    return compareTypicalCurveFiles(reference.parsed, candidate.parsed);
  }, [reference, candidate]);

  const rmsComparison = useMemo(() => {
    if (!reference?.parsed || !candidate?.parsed) return null;
    return computeDiscoverEeAnalogRms(reference.parsed, candidate.parsed);
  }, [reference, candidate]);

  const overlayCurves = useMemo(() => {
    const curves = [];
    if (reference?.parsed) {
      curves.push(...prefixTypicalCurveCurves(reference.parsed, 'Analog reference'));
    }
    if (candidate?.parsed) {
      curves.push(...prefixTypicalCurveCurves(candidate.parsed, 'DiscoverEE Approach'));
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
      graphTitle: reference.parsed.config.graphTitle || LABEL_ANALOG_REFERENCE,
    };
  }, [reference]);

  const candidatePlotConfig = useMemo(() => {
    if (!candidate?.parsed?.config) return null;
    return {
      ...candidate.parsed.config,
      graphTitle: candidate.parsed.config.graphTitle || LABEL_DISCOVEREE,
    };
  }, [candidate]);

  const hasPlot = overlayCurves.length > 0 && plotConfig;
  const canComparePlots = Boolean(reference?.parsed && candidate?.parsed);
  const hasImage = Boolean(originalImage?.url);

  const exportSlug = useMemo(() => {
    const title =
      candidate?.parsed?.config?.graphTitle ||
      reference?.parsed?.config?.graphTitle ||
      originalImage?.name ||
      'comparison';
    return buildExportSlug(title);
  }, [candidate, reference, originalImage]);

  const runPngExport = useCallback(async (exportFn, filename) => {
    try {
      await exportFn();
    } catch (exportError) {
      console.error('PNG export failed:', exportError);
      setError(exportError?.message || 'Failed to download PNG.');
    }
  }, []);

  const handlePanelPngDownload = useCallback(
    (panelRef, label) => {
      if (!panelRef.current) return;
      runPngExport(
        () =>
          downloadPanelAsPng(panelRef.current, `${exportSlug}-${label}`, {
            scale: PNG_EXPORT_SCALE,
          }),
        label
      );
    },
    [exportSlug, runPngExport]
  );

  const handleComparisonPngDownload = useCallback(() => {
    if (!comparisonWorkspaceRef.current) return;
    runPngExport(
      () =>
        downloadHtmlFragmentAsPng(comparisonWorkspaceRef.current, `${exportSlug}-comparison-full`, {
          scale: PNG_EXPORT_SCALE,
        }),
      'comparison-full'
    );
  }, [exportSlug, runPngExport]);

  const handleRmsPngDownload = useCallback(() => {
    if (!rmsExportRef.current) return;
    runPngExport(
      () =>
        downloadHtmlFragmentAsPng(rmsExportRef.current, `${exportSlug}-rms`, {
          scale: PNG_EXPORT_SCALE,
        }),
      'rms'
    );
  }, [exportSlug, runPngExport]);

  const layoutOptions = useMemo(() => {
    const options = [];
    if (hasImage && hasPlot) {
      if (canComparePlots) {
        options.push({ id: LAYOUT_TRIPLE, label: 'All three side by side' });
      }
      options.push({
        id: LAYOUT_IMAGE_OVERLAY,
        label: canComparePlots ? 'Original + overlaid .tc' : 'Original + .tc chart',
      });
      if (canComparePlots) {
        options.push({ id: LAYOUT_IMAGE_TC_SPLIT, label: 'Original + .tc side by side' });
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

  // Always use three-panel view when image + both .tc files are loaded (layout radios hidden).
  useEffect(() => {
    if (hasImage && canComparePlots) {
      setLayoutMode(LAYOUT_TRIPLE);
    }
  }, [hasImage, canComparePlots]);

  const showImageInComparison = hasImage && (
    layoutMode === LAYOUT_IMAGE_OVERLAY ||
    layoutMode === LAYOUT_IMAGE_TC_SPLIT ||
    layoutMode === LAYOUT_TRIPLE
  );

  const isTripleLayout = layoutMode === LAYOUT_TRIPLE;
  const isOverlayLayout = layoutMode === LAYOUT_OVERLAY || layoutMode === LAYOUT_IMAGE_OVERLAY;
  const isTcSplitLayout = layoutMode === LAYOUT_TC_SPLIT || layoutMode === LAYOUT_IMAGE_TC_SPLIT;

  const chartWidth = isTripleLayout ? 500 : (isTcSplitLayout ? 540 : 720);
  const chartHeight = isTripleLayout ? 400 : (isTcSplitLayout ? 380 : 460);
  const imageMaxHeight = isTripleLayout ? 400 : 500;

  const renderPanelHeader = (title, onDownload) => (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 8,
      }}
    >
      <h3 style={{ fontSize: 14, margin: 0, color: '#334155', minWidth: 0 }}>{title}</h3>
      {onDownload ? (
        <button type="button" style={downloadBtnStyle} onClick={onDownload}>
          Download PNG
        </button>
      ) : null}
    </div>
  );

  const renderOriginalImage = (withExport = false) => {
    if (!originalImage?.url) return null;
    return (
      <div ref={withExport ? panelImageRef : null} style={showImageInComparison ? imagePanelStyle : undefined}>
        {renderPanelHeader(
          LABEL_GRAPH_IMAGE,
          withExport ? () => handlePanelPngDownload(panelImageRef, 'datasheet-image') : null
        )}
        <img
          src={originalImage.url}
          alt={originalImage.name || LABEL_GRAPH_IMAGE}
          style={{
            display: 'block',
            width: '100%',
            maxHeight: imageMaxHeight,
            minHeight: isTripleLayout ? 320 : 360,
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

  const renderSplitTcCharts = (compact = false, withExport = false) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 12,
        flex: 1,
        minWidth: 0,
      }}
    >
      {candidate?.parsed && candidatePlotConfig && (
        <div ref={withExport ? panelDiscovereeRef : null}>
          {renderPanelHeader(
            LABEL_DISCOVEREE,
            withExport ? () => handlePanelPngDownload(panelDiscovereeRef, 'discoveree') : null
          )}
          <SavedGraphCombinedPreview
            curves={candidate.parsed.curves}
            config={candidatePlotConfig}
            width={chartWidth}
            height={chartHeight}
            sortByX={sortByX}
          />
        </div>
      )}
      {reference?.parsed && referencePlotConfig && (
        <div ref={withExport ? panelAnalogRef : null}>
          {renderPanelHeader(
            LABEL_ANALOG_REFERENCE,
            withExport ? () => handlePanelPngDownload(panelAnalogRef, 'analog-reference') : null
          )}
          <SavedGraphCombinedPreview
            curves={reference.parsed.curves}
            config={referencePlotConfig}
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

    if (hasImage && canComparePlots) {
      return (
        <div
          ref={comparisonWorkspaceRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(320px, 1fr))',
            gap: 20,
            width: '100%',
            alignItems: 'start',
          }}
        >
          {renderOriginalImage(true)}
          {candidate?.parsed && candidatePlotConfig && (
            <div ref={panelDiscovereeRef}>
              {renderPanelHeader(LABEL_DISCOVEREE, () =>
                handlePanelPngDownload(panelDiscovereeRef, 'discoveree')
              )}
              <SavedGraphCombinedPreview
                curves={candidate.parsed.curves}
                config={candidatePlotConfig}
                width={chartWidth}
                height={chartHeight}
                sortByX={sortByX}
              />
            </div>
          )}
          {reference?.parsed && referencePlotConfig && (
            <div ref={panelAnalogRef}>
              {renderPanelHeader(LABEL_ANALOG_REFERENCE, () =>
                handlePanelPngDownload(panelAnalogRef, 'analog-reference')
              )}
              <SavedGraphCombinedPreview
                curves={reference.parsed.curves}
                config={referencePlotConfig}
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
          ref={comparisonWorkspaceRef}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          {renderOriginalImage(true)}
          <div style={{ flex: '1 1 640px', minWidth: 360 }}>
            {isOverlayLayout && (
              <div ref={panelDiscovereeRef}>
                {renderPanelHeader('Reference + export (overlaid)', () =>
                  handlePanelPngDownload(panelDiscovereeRef, 'overlay')
                )}
                {renderOverlayChart()}
              </div>
            )}
            {isTcSplitLayout && canComparePlots && renderSplitTcCharts(true, true)}
          </div>
        </div>
      );
    }

    if (hasImage && !hasPlot) {
      return (
        <div ref={comparisonWorkspaceRef}>
          {renderOriginalImage(true)}
        </div>
      );
    }

    if (!hasPlot) return null;

    if (isOverlayLayout) {
      return (
        <div ref={comparisonWorkspaceRef}>
          {isOverlayLayout && layoutMode === LAYOUT_OVERLAY && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
              X: {plotConfig.xLabel} ({plotConfig.xMin} – {plotConfig.xMax}, {plotConfig.xScale})
              {' · '}
              Y: {plotConfig.yLabel} ({plotConfig.yMin} – {plotConfig.yMax}, {plotConfig.yScale})
            </p>
          )}
          <div ref={panelDiscovereeRef}>
            {renderPanelHeader('Reference + export (overlaid)', () =>
              handlePanelPngDownload(panelDiscovereeRef, 'overlay')
            )}
            {renderOverlayChart()}
          </div>
        </div>
      );
    }

    return (
      <div ref={comparisonWorkspaceRef}>
        {renderSplitTcCharts(false, true)}
      </div>
    );
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
            <strong>{LABEL_GRAPH_IMAGE}</strong> (optional)
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
            <strong>{LABEL_DISCOVEREE}</strong>
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

          <label style={cardStyle}>
            <strong>{LABEL_ANALOG_REFERENCE}</strong> (optional)
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
        </div>

        <div
          ref={pasteZoneRef}
          tabIndex={0}
          aria-label="Paste original graph image"
          aria-describedby="tc-paste-zone-hint"
          onPaste={handleImagePaste}
          onFocus={() => setPasteZoneFocused(true)}
          onBlur={() => setPasteZoneFocused(false)}
          onMouseEnter={() => setPasteZoneHovered(true)}
          onMouseLeave={() => setPasteZoneHovered(false)}
          onClick={() => pasteZoneRef.current?.focus()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              pasteZoneRef.current?.focus();
            }
          }}
          style={{
            marginBottom: 16,
            padding: '14px 16px',
            borderRadius: 8,
            fontSize: 13,
            outline: 'none',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
            background: pasteZoneFocused ? '#eff6ff' : (pasteZoneHovered ? '#f1f5f9' : '#f8fafc'),
            border: pasteZoneFocused
              ? '2px solid #2563eb'
              : `2px dashed ${pasteZoneHovered ? '#64748b' : '#94a3b8'}`,
            boxShadow: pasteZoneFocused ? '0 0 0 3px rgba(37, 99, 235, 0.2)' : 'none',
            color: pasteZoneFocused ? '#1e40af' : '#475569',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ color: pasteZoneFocused ? '#1d4ed8' : '#334155' }}>Paste image</strong>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                background: pasteZoneFocused ? '#2563eb' : '#e2e8f0',
                color: pasteZoneFocused ? '#fff' : '#64748b',
              }}
            >
              {pasteZoneFocused ? 'Ready — paste now (Ctrl+V / Cmd+V)' : 'Click to activate'}
            </span>
          </div>
          <p id="tc-paste-zone-hint" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
            {pasteZoneFocused
              ? 'This area is active. Paste a screenshot of the original datasheet plot.'
              : 'Click this box, then press Ctrl+V (Cmd+V on Mac) to paste a screenshot of the original plot.'}
          </p>
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

          {SHOW_LAYOUT_OPTIONS && layoutOptions.length > 0 && (
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
          <div style={{ ...cardStyle, marginBottom: 16, width: '100%' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <h2 style={{ fontSize: 16, margin: 0 }}>Comparison</h2>
              <button type="button" style={downloadBtnStyle} onClick={handleComparisonPngDownload}>
                Download full comparison PNG
              </button>
            </div>
            <div style={{ width: '100%', overflowX: 'auto' }}>
              {renderComparisonWorkspace()}
            </div>
          </div>
        )}

        {rmsComparison && canComparePlots && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 8,
              }}
            >
              <h2 style={{ fontSize: 16, margin: 0 }}>
                RMS — DiscoverEE Approach vs Analog reference
              </h2>
              <button type="button" style={downloadBtnStyle} onClick={handleRmsPngDownload}>
                Download RMS PNG
              </button>
            </div>
            <div ref={rmsExportRef}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
                Per series at reference X: sqrt( sum(y² DiscoverEE − y² Analog) / (xmax − xmin) )
              </p>
              {Number.isFinite(rmsComparison.overallRms) && (
                <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                  Largest RMS (any series): <strong>{rmsComparison.overallRms.toFixed(6)}</strong>
                </p>
              )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 4px' }}>Series</th>
                  <th style={{ padding: '8px 4px' }}>Points</th>
                  <th style={{ padding: '8px 4px' }}>x min</th>
                  <th style={{ padding: '8px 4px' }}>x max</th>
                  <th style={{ padding: '8px 4px' }}>x max − x min</th>
                  <th style={{ padding: '8px 4px' }}>RMS</th>
                </tr>
              </thead>
              <tbody>
                {rmsComparison.rows.map((row) => (
                  <tr key={`rms-${row.series}-${row.status}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 4px' }}>{row.series}</td>
                    <td style={{ padding: '8px 4px' }}>
                      {row.status === 'ok' ? row.pointCount : row.status.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.xMin) ? row.xMin.toFixed(4) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.xMax) ? row.xMax.toFixed(4) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.xSpan) ? row.xSpan.toFixed(4) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {Number.isFinite(row.rms) ? row.rms.toFixed(6) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {SHOW_ACCURACY_TABLE && comparison && (
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

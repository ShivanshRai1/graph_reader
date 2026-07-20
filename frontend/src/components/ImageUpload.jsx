import { useEffect, useRef, useState } from 'react';
import { useGraph } from '../context/GraphContext';
import { extractManualGraphFieldsFromImage } from '../utils/manualGraphOcr';

const getUrlParam = (...keys) => {
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of keys) {
      const value = String(params.get(key) || '').trim();
      if (value) return value;
    }
  } catch {
    /* ignore */
  }
  return '';
};

const ImageUpload = ({ onImageLoaded, onAiExtensionCapture, isAiExtractionLoading = false, skipCaptureChoice = false, initialPendingCapture = null, onPendingCaptureChange = () => {} }) => {
  const { setUploadedImage, clearDataPoints, setGraphConfig, setGraphArea } = useGraph();
  const fileInputRef = useRef(null);
  const [pendingCapture, setPendingCapture] = useState(null);
  const [manualOcrStatus, setManualOcrStatus] = useState('');
  const manualOcrRequestIdRef = useRef(0);
  const allowOcrAxisOverwriteRef = useRef(false);

  useEffect(() => {
    if (!initialPendingCapture?.imageBase64) return;
    setPendingCapture((prev) => {
      if (prev?.imageBase64) return prev;
      onPendingCaptureChange(true);
      return {
        imageBase64: initialPendingCapture.imageBase64,
        source: initialPendingCapture.source || 'upload',
      };
    });
  }, [initialPendingCapture, onPendingCaptureChange]);

  useEffect(() => () => {
    manualOcrRequestIdRef.current += 1;
  }, []);

  const resetGraphForManualCapture = (clearImageFirst = false) => {
    if (clearImageFirst) {
      setUploadedImage(null);
    }
    clearDataPoints();
    setGraphArea({ x: 0, y: 0, width: 0, height: 0 });
    const keepGraphTitle = Boolean(getUrlParam('graph_title'));
    const keepCurveTitle = Boolean(getUrlParam('curve_title'));
    const keepXTitle = Boolean(getUrlParam('x_title', 'x_label', 'xlabel'));
    const keepYTitle = Boolean(getUrlParam('y_title', 'y_label', 'ylabel'));
    setGraphConfig((prev) => ({
      ...prev,
      curveName: keepCurveTitle ? prev.curveName : '',
      graphTitle: keepGraphTitle ? prev.graphTitle : '',
      xLabel: keepXTitle ? prev.xLabel : '',
      yLabel: keepYTitle ? prev.yLabel : '',
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
    }));
  };

  const applyManualOcrFields = (fields) => {
    if (!fields) return { filled: [], skipped: ['no-fields'] };

    const urlGraphTitle = getUrlParam('graph_title');
    const urlCurveTitle = getUrlParam('curve_title');
    const urlXTitle = getUrlParam('x_title', 'x_label', 'xlabel');
    const urlYTitle = getUrlParam('y_title', 'y_label', 'ylabel');
    const filled = [];
    const skipped = [];

    setGraphConfig((prev) => {
      const next = { ...prev };
      let changed = false;

      const graphTitle = String(fields.graphTitle || '').trim();
      if (graphTitle && !urlGraphTitle && !String(prev.graphTitle || '').trim()) {
        next.graphTitle = graphTitle;
        filled.push('graph title');
        changed = true;
      } else if (graphTitle && urlGraphTitle) {
        skipped.push('graph title (from URL)');
      }

      const curveTitle = String(fields.curveTitle || fields.graphTitle || '').trim();
      if (curveTitle && !urlCurveTitle && !String(prev.curveName || '').trim()) {
        next.curveName = curveTitle;
        filled.push('curve name');
        changed = true;
      } else if (curveTitle && urlCurveTitle) {
        skipped.push('curve name (from URL)');
      }

      const xTitle = String(fields.xTitle || '').trim();
      if (xTitle && !urlXTitle && !String(prev.xLabel || '').trim()) {
        next.xLabel = xTitle;
        filled.push('X title');
        changed = true;
      } else if (xTitle && urlXTitle) {
        skipped.push('X title (from URL)');
      }

      const yTitle = String(fields.yTitle || '').trim();
      if (yTitle && !urlYTitle && !String(prev.yLabel || '').trim()) {
        next.yLabel = yTitle;
        filled.push('Y title');
        changed = true;
      } else if (yTitle && urlYTitle) {
        skipped.push('Y title (from URL)');
      }

      const hasAxis =
        Number.isFinite(fields.xMin) &&
        Number.isFinite(fields.xMax) &&
        Number.isFinite(fields.yMin) &&
        Number.isFinite(fields.yMax);

      if (hasAxis && allowOcrAxisOverwriteRef.current) {
        next.xMin = fields.xMin;
        next.xMax = fields.xMax;
        next.yMin = fields.yMin;
        next.yMax = fields.yMax;
        filled.push('X/Y min-max');
        changed = true;
        allowOcrAxisOverwriteRef.current = false;
      } else if (!hasAxis) {
        skipped.push('X/Y min-max (OCR could not read ticks)');
      } else {
        skipped.push('X/Y min-max (already edited / not allowed)');
      }

      return changed ? next : prev;
    });

    return { filled, skipped };
  };

  const runManualOcrFill = (imageBase64) => {
    const requestId = ++manualOcrRequestIdRef.current;
    allowOcrAxisOverwriteRef.current = true;
    setManualOcrStatus('OCR reading image… (first run may take a bit)');
    console.log('[MANUAL OCR] Queued for manual capture image');

    void (async () => {
      try {
        const fields = await extractManualGraphFieldsFromImage(imageBase64);
        if (requestId !== manualOcrRequestIdRef.current) return;
        const { filled, skipped } = applyManualOcrFields(fields);
        console.log('[MANUAL OCR] Apply result', { filled, skipped, fields });
        if (filled.length) {
          setManualOcrStatus(`OCR filled: ${filled.join(', ')}. Edit any field if wrong.`);
        } else {
          setManualOcrStatus(
            skipped.length
              ? `OCR finished but nothing new was filled (${skipped[0]}). You can type values manually.`
              : 'OCR finished but found nothing useful. Enter values manually.'
          );
        }
      } catch (error) {
        if (requestId !== manualOcrRequestIdRef.current) return;
        allowOcrAxisOverwriteRef.current = false;
        console.warn('[MANUAL OCR] Auto-fill failed:', error);
        setManualOcrStatus('OCR failed. Enter graph title / axis values manually.');
      }
    })();
  };

  const triggerManualCapture = (imageBase64, source, preserveGraphContext = false) => {
    if (!imageBase64) return;
    resetGraphForManualCapture(source === 'paste');
    setUploadedImage(imageBase64);
    onImageLoaded?.({ source, preserveGraphContext });
    runManualOcrFill(imageBase64);
  };

  const processImage = async (blob, source) => {
    if (!blob) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageBase64 = ev.target.result;
      if (skipCaptureChoice) {
        triggerManualCapture(imageBase64, source, true);
        setPendingCapture(null);
        onPendingCaptureChange(false);
        return;
      }
      setPendingCapture({ imageBase64, source });
      onPendingCaptureChange(true);
    };
    reader.readAsDataURL(blob);
  };

  const handleCaptureManually = () => {
    if (!pendingCapture?.imageBase64) return;
    triggerManualCapture(pendingCapture.imageBase64, pendingCapture.source, false);
    setPendingCapture(null);
    onPendingCaptureChange(false);
  };

  const handleCaptureWithAiExtension = async () => {
    if (!pendingCapture?.imageBase64 || isAiExtractionLoading) return;
    manualOcrRequestIdRef.current += 1;
    allowOcrAxisOverwriteRef.current = false;
    setManualOcrStatus('');
    const succeeded = await onAiExtensionCapture?.(pendingCapture.imageBase64, pendingCapture.source);
    if (succeeded) {
      setPendingCapture(null);
      onPendingCaptureChange(false);
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        processImage(blob, 'paste');
        break;
      }
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      processImage(file, 'upload');
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full p-5 bg-gray-50 rounded-lg mt-5">
      <textarea
        className="w-full resize-vertical text-sm px-3 py-2 border-2 border-gray-300 rounded bg-white text-gray-800 outline-none box-border"
        placeholder="Click here and paste screenshot image"
        onPaste={handlePaste}
        rows={3}
        title="Paste your screenshot image here"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={handleBrowseClick}
        className="mt-2 w-full px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        📁 Browse Files
      </button>
      {manualOcrStatus ? (
        <div className="mt-2 text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded px-3 py-2">
          {manualOcrStatus}
        </div>
      ) : null}
      {pendingCapture && (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2 p-2 border border-green-300 rounded bg-green-50">
            <img
              src={pendingCapture.imageBase64}
              alt="Pasted preview"
              className="h-16 w-24 object-contain rounded border border-gray-200 bg-white shrink-0"
            />
            <span className="text-sm font-medium text-green-700">
              ✓ Image ready — choose how to proceed
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleCaptureManually}
              className="w-full px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              Capture Manually
            </button>
            <button
              onClick={handleCaptureWithAiExtension}
              disabled={isAiExtractionLoading}
              className="w-full px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
            >
              {isAiExtractionLoading ? 'Loading, please wait...' : 'Capture with AI Extraction'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;

import { useEffect, useRef, useState } from 'react';
import { useGraph } from '../context/GraphContext';

const ImageUpload = ({ onImageLoaded, onAiExtensionCapture, isAiExtractionLoading = false, skipCaptureChoice = false, initialPendingCapture = null, onPendingCaptureChange = () => {} }) => {
  const { setUploadedImage, clearDataPoints, setGraphConfig, setGraphArea } = useGraph();
  const fileInputRef = useRef(null);
  const [pendingCapture, setPendingCapture] = useState(null);

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

  const resetGraphForManualCapture = (clearImageFirst = false) => {
    if (clearImageFirst) {
      setUploadedImage(null);
    }
    clearDataPoints();
    setGraphArea({ x: 0, y: 0, width: 0, height: 0 });
    setGraphConfig((prev) => ({
      ...prev,
      curveName: '',
      graphTitle: '',
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
    }));
  };

  const triggerManualCapture = (imageBase64, source, preserveGraphContext = false) => {
    if (!imageBase64) return;
    resetGraphForManualCapture(source === 'paste');
    setUploadedImage(imageBase64);
    onImageLoaded?.({ source, preserveGraphContext });
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
    await onAiExtensionCapture?.(pendingCapture.imageBase64, pendingCapture.source);
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

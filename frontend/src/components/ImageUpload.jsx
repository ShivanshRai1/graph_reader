import { useRef } from 'react';
import { useGraph } from '../context/GraphContext';

const ImageUpload = ({ onImageLoaded, onAiExtensionCapture }) => {
  const { setUploadedImage, clearDataPoints, setGraphConfig, setGraphArea } = useGraph();
  const fileInputRef = useRef(null);

  const askCaptureMode = () => {
    const choice = window.prompt(
      'Choose capture mode:\n1 = Capture manually\n2 = Capture with AI extension',
      '1'
    );

    if (choice === null) return null;
    return String(choice).trim() === '2' ? 'ai_extension' : 'manual';
  };

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

  const processImage = async (blob, source) => {
    if (!blob) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageBase64 = ev.target.result;
      const selectedMode = askCaptureMode();
      if (!selectedMode) {
        return;
      }

      if (selectedMode === 'ai_extension') {
        await onAiExtensionCapture?.(imageBase64, source);
        return;
      }

      resetGraphForManualCapture(source === 'paste');
      setUploadedImage(imageBase64);
      onImageLoaded?.();
    };
    reader.readAsDataURL(blob);
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
    </div>
  );
};

export default ImageUpload;

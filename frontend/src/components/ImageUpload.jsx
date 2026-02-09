import { useState, useRef } from 'react';
import { useGraph } from '../context/GraphContext';

const ImageUpload = () => {
  const { setUploadedImage } = useGraph();
  const fileInputRef = useRef(null);

  const handlePaste = (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => {
          setUploadedImage(ev.target.result);
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setUploadedImage(ev.target.result);
      };
      reader.readAsDataURL(file);
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

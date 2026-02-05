import { useState, useRef } from 'react';
import { useGraph } from '../context/GraphContext';
import './ImageUpload.css';

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
    <div className="image-upload-container">
      <textarea
        className="paste-textarea"
        placeholder="Click here and paste screenshot image"
        onPaste={handlePaste}
        rows={3}
        style={{ width: '100%', resize: 'vertical', fontSize: 15, padding: 8, border: '2px solid #222', borderRadius: 4, background: '#fafafa', color: '#222', outline: 'none', boxSizing: 'border-box' }}
        title="Paste your screenshot image here"
      />
    </div>
  );
};

export default ImageUpload;

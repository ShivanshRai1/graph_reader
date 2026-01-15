import { useState, useRef } from 'react';
import { useGraph } from '../context/GraphContext';
import './ImageUpload.css';

const ImageUpload = () => {
  const { setUploadedImage } = useGraph();
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

  return (
    <div className="image-upload-container">
      <div
        className="upload-area"
        onPaste={handlePaste}
        tabIndex={0}
      >
        <div className="upload-content">
          <p>📷 Click here and paste screenshot image</p>
        </div>
      </div>
    </div>
  );
};

export default ImageUpload;

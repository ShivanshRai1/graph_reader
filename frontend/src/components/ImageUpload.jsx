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

  const handleFileChange = (e) => {
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
    if (fileInputRef.current) {
      fileInputRef.current.click();
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
          <button className="upload-button" type="button" onClick={handleBrowseClick}>
            Browse Files
          </button>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </div>
      </div>
    </div>
  );
};

export default ImageUpload;

# Graph Data Capture Tool - Frontend

A modern React application for capturing data points from graph images.

## Features Built So Far

### ✅ Completed
1. **Image Upload/Paste**
   - Drag and drop image files
   - Paste screenshots directly (Ctrl+V)
   - Click to browse files

2. **Graph Area Selection**
   - Draw a blue box to define the graph region
   - Drag with mouse to select area

3. **Data Point Capture**
   - Click inside the blue box to add data points
   - Visual feedback with red dots
   - Point counter

4. **Graph Configuration**
   - Curve/Line naming
   - X and Y axis configuration (min, max, units, scale)
   - Temperature metadata (TC/TJ)

5. **State Management**
   - React Context API for global state
   - Manages image, config, points, and saved curves

### 🚧 To Be Implemented
- Convert canvas coordinates to actual graph values
- Save data to backend API
- Export to CSV with real coordinates
- Load and display saved curves
- Advanced data point editing/deletion
- Zoom and pan on canvas
- Semi-automatic point detection

## Tech Stack
- **Framework:** React 18 + Vite
- **State Management:** React Context API
- **Styling:** Vanilla CSS
- **HTTP:** Fetch API (to be integrated)

## Project Structure
```
src/
├── components/
│   ├── ImageUpload.jsx       # Image upload/paste component
│   ├── GraphCanvas.jsx        # Canvas for drawing and point capture
│   └── GraphConfig.jsx        # Configuration form
├── context/
│   └── GraphContext.jsx       # Global state management
├── pages/
│   └── GraphCapture.jsx       # Main page
├── utils/                     # Utility functions (to be added)
├── App.jsx                    # App entry point
└── main.jsx                   # React mount point
```

## Development

### Running the App
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

## Next Steps
1. Implement coordinate conversion (canvas → graph values)
2. Connect to FastAPI backend
3. Add CSV export functionality
4. Add visualization for saved curves
5. Deploy to Netlify

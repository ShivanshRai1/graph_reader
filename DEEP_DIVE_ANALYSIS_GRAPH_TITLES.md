# Deep Dive: Multiple Graph Titles Support Analysis

## Executive Summary
**Current Status:** The system currently supports **ONE graph title per graph**. The title field becomes read-only (autofilled) when provided via URL or when a saved graph is loaded.

**Feasibility of Multiple Titles:** Supporting multiple graph titles would require significant architectural changes across frontend and backend. This document outlines the current constraints and a path forward.

---

## Current Architecture

### 1. Data Model (Backend)
**File:** `backend/models.py`

The `Curve` model has a single field for graph title:
```python
class Curve(Base):
    __tablename__ = "curves"
    
    id = Column(Integer, primary_key=True, index=True)
    graph_title = Column(String(255))  # ← Single title field
    curve_name = Column(String(255), nullable=False)
    # ... other fields ...
```

**Key Observations:**
- Only ONE `graph_title` field exists per curve
- Stored as VARCHAR(255) in the database
- No relationship table for multiple titles
- Cannot store multiple titles without schema change

---

### 2. Frontend State Management
**File:** `frontend/src/context/GraphContext.jsx`

```javascript
const [graphConfig, setGraphConfig] = useState({
    graphTitle: '',  // ← Single string field
    curveName: '',
    xLabel: '',
    yLabel: '',
    // ... other config ...
});
```

**Constraint:** React state stores only a single `graphTitle` value.

---

### 3. URL Parameter Handling
**File:** `frontend/src/pages/GraphCapture.jsx` (Line 1902)

```javascript
const graphTitle = searchParams.get('graph_title') || '';
const urlParams = {
    graph_title: graphTitle,
    // ... other params ...
};
```

**Flow:**
1. Single `graph_title` URL parameter is extracted
2. If provided, it's passed as `initialGraphTitle` prop to GraphConfig
3. The title autofills and becomes READ-ONLY

---

### 4. Read-Only Behavior
**File:** `frontend/src/pages/GraphCapture.jsx` (Line 3314)

```javascript
<GraphConfig
    isGraphTitleReadOnly={Boolean(urlParams.graph_id || urlParams.graph_title)}
    initialGraphTitle={urlParams.graph_title}
    // ...
/>
```

**File:** `frontend/src/components/GraphConfig.jsx` (Line 390-400)

```javascript
<input
    type="text"
    name="graphTitle"
    value={graphConfig.graphTitle || ''}
    onChange={handleChange}
    readOnly={isGraphTitleReadOnly || isConfigLocked}  // ← Read-only when URL param provided
    disabled={isGraphTitleReadOnly || isConfigLocked}
    className={`${
        isGraphTitleReadOnly || isConfigLocked
            ? 'bg-gray-100 cursor-not-allowed opacity-70'
            : 'bg-white'
    }`}
/>
```

**Behavior:**
- When `graph_title` in URL: Input is disabled/read-only
- When no URL param: Input is editable
- Validation requires title to not be empty (Line 652)

---

## Current Workflow for Graph Titles

### Scenario 1: Fresh Capture (No URL Parameters)
```
User lands on app without URL params
    ↓
GraphConfig shows empty, editable title field
    ↓
User enters graph title manually
    ↓
Title stored in graphConfig state
    ↓
Title saved to database when curve saved
```

### Scenario 2: Provided via URL
```
User lands with ?graph_title=MyTitle&graph_id=123
    ↓
GraphCapture extracts URL params
    ↓
GraphConfig receives initialGraphTitle prop
    ↓
Title autofills in input field
    ↓
Input becomes READ-ONLY (disabled)
    ↓
Cannot change title without manually editing URL
```

### Scenario 3: Loading Saved Curve for Editing
```
User clicks "Edit" on saved curve
    ↓
handleEditCurveStart() called (Line 984)
    ↓
GraphConfig loads from curve.config.graphTitle or curve.graph_title
    ↓
isEditingCurve = true
    ↓
GraphConfig becomes disabled (all fields)
    ↓
Cannot modify title during edit (only points can be edited)
```

---

## Data Flow to Database

### Save Path
**File:** `frontend/src/pages/GraphCapture.jsx`

When saving a curve:
```javascript
const payload = {
    graph_title: graphConfig.graphTitle,  // ← Single value sent
    curve_name: graphConfig.curveName,
    // ...
};

await fetch(`${apiUrl}/api/curves`, {
    method: 'POST',
    body: JSON.stringify(payload)
});
```

**Backend Receives:** `backend/main.py` (Line ~80)
```python
@app.post("/api/curves", response_model=CurveResponse)
def create_curve(curve: CurveCreate, db: Session = Depends(get_db)):
    db_curve = Curve(
        graph_title=curve.graph_title,  # ← Single field saved
        # ...
    )
```

---

## Current Limitations for Multiple Titles

### 1. **Database Schema**
- Only 1 VARCHAR(255) field available
- No junction table (e.g., `CurveGraphTitles`)
- Would require migration script

### 2. **API Contracts**
- Endpoints expect single `graph_title` parameter
- Schemas defined in `backend/schemas.py` use string, not list

### 3. **React Component Design**
- `GraphConfig` component expects single title
- UI form has single input field
- State management uses single string

### 4. **URL Parameter Convention**
- Single query parameter: `?graph_title=...`
- Would need to support: `?graph_title=Title1&graph_title=Title2` (multiple values)
- Or new format: `?graph_titles=Title1,Title2`

### 5. **Business Logic**
- "Final Check" validation requires title to be filled (Line 652-653)
- Save confirmation shows single title
- Curve display/preview assumes one title

---

## What Would Be Needed to Support Multiple Titles

### Phase 1: Database Changes
```sql
-- Create junction table
CREATE TABLE curve_graph_titles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    curve_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (curve_id) REFERENCES curves(id) ON DELETE CASCADE
);

-- Add or modify index
ALTER TABLE curve_graph_titles ADD UNIQUE KEY (curve_id, display_order);
```

### Phase 2: Backend Model Changes
```python
class CurveGraphTitle(Base):
    __tablename__ = "curve_graph_titles"
    
    id = Column(Integer, primary_key=True)
    curve_id = Column(Integer, ForeignKey("curves.id"), nullable=False)
    title = Column(String(255), nullable=False)
    display_order = Column(Integer, default=0)
    
    curve = relationship("Curve", back_populates="graph_titles")

class Curve(Base):
    # Remove: graph_title = Column(String(255))
    # Add:
    graph_titles = relationship("CurveGraphTitle", back_populates="curve", cascade="all, delete-orphan")
```

### Phase 3: API Schema Changes
```python
class GraphTitleCreate(BaseModel):
    title: str
    display_order: int = 0

class CurveCreate(BaseModel):
    # Remove: graph_title: str
    # Add:
    graph_titles: List[GraphTitleCreate] = []
```

### Phase 4: Frontend State Changes
```javascript
const [graphConfig, setGraphConfig] = useState({
    graphTitles: [],  // Changed from graphTitle
    // ...
});
```

### Phase 5: Component Updates
- Update GraphConfig to handle list of titles
- Add UI for adding/removing/reordering titles
- Update validation logic
- Update save payload

### Phase 6: URL Parameter Support
```
New format: ?graph_titles=Title1&graph_titles=Title2&graph_titles=Title3
Or: ?graph_titles=Title1,Title2,Title3
```

---

## Alternative Lightweight Approach

If full multiple-titles support is not needed, consider:

### Option A: "Comma-Separated Titles" in Single Field
```
Keep database as-is
Store multiple titles as: "Title1|Title2|Title3"
Parse/split in frontend when needed
Keep UI simple with single input showing first title
```

**Pros:** No database changes, backward compatible
**Cons:** Not true separate titles, harder to query individual titles

### Option B: "Subtitle" Field
```
Add second column: graph_subtitle VARCHAR(255)
Keep graph_title as primary title
Keep everything else as-is
```

**Pros:** Minimal changes, works with current workflow
**Cons:** Only 2 titles max, not truly flexible

### Option C: "Title Stack" Preview
```
Keep single database field
In UI, show last 3 entered titles in a dropdown/history
Only the current one is saved
User can select from history or type new
```

**Pros:** No backend changes
**Cons:** History lost on page refresh, not persistent

---

## Current Restrictions Summary

| Aspect | Current Behavior | Reason |
|--------|------------------|--------|
| **Number of Titles** | 1 per graph | Single VARCHAR field |
| **Title EditabilityAfter Load** | Read-only if URL param | `isGraphTitleReadOnly={Boolean(...)}` logic |
| **Title Input Method** | Manual typing or URL | Single input field |
| **Title Storage** | One string in DB | No junction table |
| **Validation** | Required (non-empty) | Line 652 validation |
| **URL Support** | `?graph_title=X` | Standard query param |
| **Editing Saved Curve** | Title locked | `isEditingCurve` disables all fields |
| **Multi-Value Support** | None | No array/list handling |

---

## Questions to Answer Before Implementation

1. **Business Requirement:** Do you need to store multiple titles in a single curve, or manage titles for multiple curves?

2. **Display Requirement:** Should all titles be visible simultaneously, or select one as "primary"?

3. **API Compatibility:** Must maintain backward compatibility with existing saved graphs?

4. **URL Behavior:** If URL has `graph_title=X`, should user be allowed to add more titles, or always read-only?

5. **Editing:** Can users modify the title list after saving the curve?

6. **Versioning:** Should older "titles" be kept as history or completely replaced?

---

## Recommendation

**Current System:** Works well for single-title-per-graph use case.

**To Support Multiple Titles:** Requires comprehensive refactor across:
- Database schema (new junction table)
- Backend API (list instead of string)
- Frontend state management (array instead of string)
- Component rendering (dynamic title list)
- URL parameter handling (multi-value support)
- Validation logic (multiple non-empty titles)

**Estimated Effort:** 2-3 weeks for full implementation + testing

**Suggest:** Clarify business use case first. Multiple titles might be better modeled as:
- Separate "graph labels" instead of "graph titles"
- Metadata/tags on the curve
- Different curve objects with same image
- "Title variants" or "alternate names"


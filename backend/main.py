from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from database import engine, get_db, Base
from models import Curve, DataPoint
from schemas import CurveCreate, CurveResponse, CurveUpdate, DataPointCreate, DataPointResponse
import json
import os
import re
import threading
import time
from sqlalchemy import inspect, text
import requests

# Create tables
Base.metadata.create_all(bind=engine)


def ensure_optional_curve_columns():
    try:
        dialect_name = engine.dialect.name
        inspector = inspect(engine)
        existing_columns = {column["name"] for column in inspector.get_columns("curves")}

        # This project runs on MySQL in production; enforce LONGTEXT for base64 screenshots.
        if dialect_name == "mysql":
            with engine.begin() as connection:
                if "graph_image" not in existing_columns:
                    connection.execute(text("ALTER TABLE curves ADD COLUMN graph_image LONGTEXT"))
                else:
                    connection.execute(text("ALTER TABLE curves MODIFY COLUMN graph_image LONGTEXT"))
                if "discoveree_graph_id" not in existing_columns:
                    connection.execute(text("ALTER TABLE curves ADD COLUMN discoveree_graph_id VARCHAR(64)"))
            return

        if "graph_image" not in existing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE curves ADD COLUMN graph_image TEXT"))
        if "discoveree_graph_id" not in existing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE curves ADD COLUMN discoveree_graph_id VARCHAR(64)"))
    except Exception as error:
        print(f"[SchemaMigration] Optional curve column migration skipped: {error}")


ensure_optional_curve_columns()

app = FastAPI(
    title="Graph Data Capture API",
    description="API for capturing and managing graph data points",
    version="1.0.0"
)

# Add CORS middleware for React frontend
def keep_db_alive():
    while True:
        try:
            db = next(get_db())
            db.execute(text('SELECT 1'))
            db.close()
        except Exception as e:
            print(f"[KeepAlive] DB ping failed: {e}")
        time.sleep(240)  # every 4 minutes

# Start keep-alive thread
threading.Thread(target=keep_db_alive, daemon=True).start()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://graph-capture.netlify.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/")
@app.head("/")
def read_root():
    return {"message": "Graph Capture API is running!", "version": "1.0.0"}

@app.get("/health")
@app.head("/health")
def health_check():
    return {"status": "healthy"}


def parse_company_api_text(raw_text: str):
    object_start = raw_text.find("{")
    array_start = raw_text.find("[")
    start_candidates = [index for index in [object_start, array_start] if index >= 0]
    if not start_candidates:
        raise ValueError("No JSON payload found in response text")
    match_start = min(start_candidates)

    object_end = raw_text.rfind("}")
    array_end = raw_text.rfind("]")
    end_candidates = [index for index in [object_end, array_end] if index >= 0]
    if not end_candidates:
        raise ValueError("No complete JSON payload found in response text")
    match_end = max(end_candidates)
    if match_end == -1 or match_end < match_start:
        raise ValueError("No complete JSON payload found in response text")

    return json.loads(raw_text[match_start:match_end + 1])


def post_ai_extraction_to_company(target_url: str, normalized_payload: dict, send_as_json: bool = False):
    request_headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin": "https://graph-capture.netlify.app",
        "Referer": "https://graph-capture.netlify.app/",
    }

    if send_as_json:
        response = requests.post(
            target_url,
            json=normalized_payload,
            timeout=120,
            headers=request_headers,
        )
    else:
        # Use files= to send multipart/form-data, matching browser FormData semantics.
        multipart_fields = {key: (None, value) for key, value in normalized_payload.items()}
        response = requests.post(
            target_url,
            files=multipart_fields,
            timeout=120,
            headers=request_headers,
        )

    raw_text = response.text
    try:
        parsed_response = parse_company_api_text(raw_text)
    except Exception:
        parsed_response = raw_text

    print(f"[AI_EXTRACTION] URL: {target_url} | Status: {response.status_code} | RawText length: {len(raw_text)} | First 500 chars: {raw_text[:500]}")

    return {
        "target_url": target_url,
        "upstream_status": response.status_code,
        "upstream_ok": response.ok,
        "content_type": response.headers.get("Content-Type", ""),
        "response_headers": dict(response.headers),
        "raw_text": raw_text,
        "response": parsed_response,
    }


@app.post("/api/ai-extraction")
def relay_ai_extraction(payload: dict):
    normalized_payload = {
        str(key): "" if value is None else str(value)
        for key, value in (payload or {}).items()
    }
    if not normalized_payload.get("action"):
        normalized_payload["action"] = "graphcapture"

    base64image = str(normalized_payload.get("base64image") or "")
    base64image = re.sub(r"^data:[^;]+;base64,", "", base64image).strip()
    if not base64image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required field: base64image"
        )
    normalized_payload["base64image"] = base64image

    base64image = re.sub(r"[^A-Za-z0-9+/=]", "", base64image)
    normalized_payload["base64image"] = base64image

    primary_url = "https://www.discoveree.io/vision_upload.php"
    fallback_url = "https://www.discoveree.io/graph_capture_api.php"

    try:
        attempts = []

        primary_result = post_ai_extraction_to_company(primary_url, normalized_payload)
        attempts.append(primary_result)

        primary_content_type = str(primary_result.get("content_type") or "").lower()
        primary_response_is_html = "text/html" in primary_content_type
        should_try_fallback = (
            primary_response_is_html
            or (
                not primary_result.get("upstream_ok")
                and int(primary_result.get("upstream_status") or 0) >= 500
                and not str(primary_result.get("raw_text") or "").strip()
            )
        )

        final_result = primary_result
        if should_try_fallback:
            fallback_result = post_ai_extraction_to_company(fallback_url, normalized_payload, send_as_json=True)
            attempts.append(fallback_result)
            final_result = fallback_result

        response_content = {
            **final_result,
            "attempts": attempts,
        }

        return JSONResponse(
            status_code=int(final_result.get("upstream_status") or status.HTTP_502_BAD_GATEWAY),
            content=response_content,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI extraction relay failed: {str(error)}"
        )

# ============= CURVE ENDPOINTS =============

@app.post("/api/curves", response_model=CurveResponse, status_code=status.HTTP_201_CREATED)
def create_curve(curve: CurveCreate, db: Session = Depends(get_db)):
    """Create a new curve with data points"""
    try:
        # Create curve
        db_curve = Curve(
            part_number=curve.part_number,
            curve_name=curve.curve_name,
            x_scale=curve.x_scale,
            y_scale=curve.y_scale,
            x_unit=curve.x_unit,
            y_unit=curve.y_unit,
            x_min=curve.x_min,
            x_max=curve.x_max,
            y_min=curve.y_min,
            y_max=curve.y_max,
            temperature=curve.temperature,
            manufacturer=curve.manufacturer,
            graph_title=curve.graph_title,
            x_label=curve.x_label,
            y_label=curve.y_label,
            other_symbols=curve.other_symbols,
            discoveree_cat_id=curve.discoveree_cat_id,
            discoveree_graph_id=curve.discoveree_graph_id,
            graph_image=curve.graph_image,
        )
        # Add data points
        for point in curve.data_points:
            db_point = DataPoint(
                x_value=point.x_value,
                y_value=point.y_value,
            )
            db_curve.data_points.append(db_point)
        db.add(db_curve)
        db.commit()
        db.refresh(db_curve)
        return db_curve
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error creating curve: {str(e)}"
        )

@app.get("/api/curves", response_model=List[CurveResponse])
def list_curves(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Get all curves with pagination"""
    try:
        curves = db.query(Curve).offset(skip).limit(limit).all()
        return curves
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curves: {str(e)}"
        )

@app.get("/api/curves/{curve_id}", response_model=CurveResponse)
def get_curve(curve_id: int, db: Session = Depends(get_db)):
    """Get a specific curve by ID"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.get("/api/curves/by-discoveree/{discoveree_id}", response_model=Optional[CurveResponse])
def get_curve_by_discoveree_id(discoveree_id: int, db: Session = Depends(get_db)):
    """Get a specific curve by discoveree_cat_id"""
    try:
        curve = db.query(Curve).filter(Curve.discoveree_cat_id == discoveree_id).first()
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.get("/api/curves/by-graph/{graph_id}", response_model=Optional[CurveResponse])
def get_curve_by_graph_id(graph_id: str, db: Session = Depends(get_db)):
    """Get a specific curve by discoveree_graph_id (the graph_id URL param)"""
    try:
        curve = db.query(Curve).filter(Curve.discoveree_graph_id == str(graph_id)).first()
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.put("/api/curves/{curve_id}", response_model=CurveResponse)
def update_curve(curve_id: int, curve_update: CurveUpdate, db: Session = Depends(get_db)):
    """Update a curve"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # # Update fields
        # update_data = curve_update.model_dump(exclude_unset=True)
        # for field, value in update_data.items():
        #     setattr(curve, field, value)
        # db.commit()
        # db.refresh(curve)
        # return curve
        return {"message": "Curve update disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error updating curve: {str(e)}"
        )

@app.put("/api/curves/{curve_id}/discoveree-id")
def update_discoveree_id(curve_id: int, discoveree_cat_id: int, db: Session = Depends(get_db)):
    """Update only the discoveree_cat_id field for a curve"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        curve.discoveree_cat_id = discoveree_cat_id
        db.commit()
        db.refresh(curve)
        return {"id": curve.id, "discoveree_cat_id": curve.discoveree_cat_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating discoveree_cat_id: {str(e)}"
        )

@app.delete("/api/curves/{curve_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_curve(curve_id: int, db: Session = Depends(get_db)):
    """Delete a curve and its data points"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # db.delete(curve)
        # db.commit()
        # return None
        return {"message": "Curve deletion disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting curve: {str(e)}"
        )

# ============= DATA POINT ENDPOINTS =============

@app.post("/api/curves/{curve_id}/points", response_model=DataPointResponse, status_code=status.HTTP_201_CREATED)
def add_data_point(curve_id: int, point: DataPointCreate, db: Session = Depends(get_db)):
    """Add a single data point to a curve"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # db_point = DataPoint(
        #     curve_id=curve_id,
        #     x_value=point.x_value,
        #     y_value=point.y_value,
        # )
        # db.add(db_point)
        # db.commit()
        # db.refresh(db_point)
        # return db_point
        return {"message": "Data point creation disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error adding data point: {str(e)}"
        )

@app.get("/api/curves/{curve_id}/points", response_model=List[DataPointResponse])
def get_data_points(curve_id: int, db: Session = Depends(get_db)):
    """Get all data points for a curve"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        
        points = db.query(DataPoint).filter(DataPoint.curve_id == curve_id).all()
        return points
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching data points: {str(e)}"
        )

@app.delete("/api/points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_data_point(point_id: int, db: Session = Depends(get_db)):
    """Delete a specific data point"""
    try:
        # point = db.query(DataPoint).filter(DataPoint.id == point_id).first()
        # if not point:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Data point not found"
        #     )
        # db.delete(point)
        # db.commit()
        # return None
        return {"message": "Data point deletion disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting data point: {str(e)}"
        )
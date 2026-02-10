from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from database import engine, get_db, Base
from models import Curve, DataPoint
from schemas import CurveCreate, CurveResponse, CurveUpdate, DataPointCreate, DataPointResponse
import os

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Graph Data Capture API",
    description="API for capturing and managing graph data points",
    version="1.0.0"
import threading
import time
from sqlalchemy import text
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

# ============= CURVE ENDPOINTS =============

@app.post("/api/curves", response_model=CurveResponse, status_code=status.HTTP_201_CREATED)
def create_curve(curve: CurveCreate, db: Session = Depends(get_db)):
    """Create a new curve with data points"""
    try:
        # Create curve
        # db_curve = Curve(
        #     part_number=curve.part_number,
        #     curve_name=curve.curve_name,
        #     x_scale=curve.x_scale,
        #     y_scale=curve.y_scale,
        #     x_unit=curve.x_unit,
        #     y_unit=curve.y_unit,
        #     x_min=curve.x_min,
        #     x_max=curve.x_max,
        #     y_min=curve.y_min,
        #     y_max=curve.y_max,
        #     temperature=curve.temperature,
        #     manufacturer=curve.manufacturer,
        #     graph_title=curve.graph_title,
        #     x_label=curve.x_label,
        #     y_label=curve.y_label,
        #     other_symbols=curve.other_symbols,
        #     discoveree_cat_id=curve.discoveree_cat_id,
        # )
        # # Add data points
        # for point in curve.data_points:
        #     db_point = DataPoint(
        #         x_value=point.x_value,
        #         y_value=point.y_value,
        #     )
        #     db_curve.data_points.append(db_point)
        # db.add(db_curve)
        # db.commit()
        # db.refresh(db_curve)
        # return db_curve
        return {"message": "Curve creation disabled: DB write commented out."}
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
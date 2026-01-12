from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class DataPointCreate(BaseModel):
    x_value: float
    y_value: float

class DataPointResponse(BaseModel):
    id: int
    curve_id: int
    x_value: float
    y_value: float
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CurveCreate(BaseModel):
    curve_name: str
    x_scale: str = "Linear"
    y_scale: str = "Linear"
    x_unit: Optional[str] = None
    y_unit: Optional[str] = None
    x_min: float = 0
    x_max: float = 100
    y_min: float = 0
    y_max: float = 100
    temperature: Optional[str] = None
    data_points: List[DataPointCreate] = []

class CurveUpdate(BaseModel):
    curve_name: Optional[str] = None
    x_scale: Optional[str] = None
    y_scale: Optional[str] = None
    x_unit: Optional[str] = None
    y_unit: Optional[str] = None
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    temperature: Optional[str] = None

class CurveResponse(BaseModel):
    id: int
    curve_name: str
    x_scale: str
    y_scale: str
    x_unit: Optional[str]
    y_unit: Optional[str]
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    temperature: Optional[str]
    created_at: Optional[datetime] = None
    data_points: List[DataPointResponse] = []

    class Config:
        from_attributes = True

class CurveDetailResponse(CurveResponse):
    pass

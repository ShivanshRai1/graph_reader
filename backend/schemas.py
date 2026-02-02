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
    part_number: Optional[str] = None
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
    manufacturer: Optional[str] = None
    graph_title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    other_symbols: Optional[str] = None
    discoveree_cat_id: Optional[int] = None
    data_points: List[DataPointCreate] = []

class CurveUpdate(BaseModel):
    part_number: Optional[str] = None
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
    manufacturer: Optional[str] = None
    graph_title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    other_symbols: Optional[str] = None
    discoveree_cat_id: Optional[int] = None

class CurveResponse(BaseModel):
    id: int
    part_number: Optional[str]
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
    manufacturer: Optional[str]
    graph_title: Optional[str]
    x_label: Optional[str]
    y_label: Optional[str]
    other_symbols: Optional[str]
    discoveree_cat_id: Optional[int]
    created_at: Optional[datetime] = None
    data_points: List[DataPointResponse] = []

    class Config:
        from_attributes = True

class CurveDetailResponse(CurveResponse):
    pass

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class Curve(Base):
    __tablename__ = "curves"

    id = Column(Integer, primary_key=True, index=True)
    curve_name = Column(String(255), nullable=False)
    x_scale = Column(String(50), default="Linear")
    y_scale = Column(String(50), default="Linear")
    x_unit = Column(String(100))
    y_unit = Column(String(100))
    x_min = Column(Float, default=0)
    x_max = Column(Float, default=100)
    y_min = Column(Float, default=0)
    y_max = Column(Float, default=100)
    temperature = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship with data points
    data_points = relationship("DataPoint", back_populates="curve", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "curve_name": self.curve_name,
            "x_scale": self.x_scale,
            "y_scale": self.y_scale,
            "x_unit": self.x_unit,
            "y_unit": self.y_unit,
            "x_min": self.x_min,
            "x_max": self.x_max,
            "y_min": self.y_min,
            "y_max": self.y_max,
            "temperature": self.temperature,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "data_points": [point.to_dict() for point in self.data_points],
        }


class DataPoint(Base):
    __tablename__ = "data_points"

    id = Column(Integer, primary_key=True, index=True)
    curve_id = Column(Integer, ForeignKey("curves.id"), nullable=False)
    x_value = Column(Float, nullable=False)
    y_value = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship back to curve
    curve = relationship("Curve", back_populates="data_points")

    def to_dict(self):
        return {
            "id": self.id,
            "curve_id": self.curve_id,
            "x_value": self.x_value,
            "y_value": self.y_value,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

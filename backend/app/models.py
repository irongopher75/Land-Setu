from sqlalchemy import Column, Integer, String, Float, JSON
from app.db import Base, IS_SQLITE

if not IS_SQLITE:
    try:
        from geoalchemy2 import Geometry
        GeometryType = Geometry("POLYGON", srid=4326)
    except ImportError:
        GeometryType = JSON
else:
    GeometryType = JSON

class Parcel(Base):
    __tablename__ = "parcels"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, unique=True, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    area_sqm = Column(Float, nullable=True)
    geometry = Column(GeometryType, nullable=False)
    layers = Column(JSON, nullable=False, default={})
    raw_record = Column(JSON, nullable=True)

class ProtectedZone(Base):
    __tablename__ = "protected_zones"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(String, unique=True, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    geometry = Column(GeometryType, nullable=False)

class BoundaryChangeRequest(Base):
    __tablename__ = "boundary_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    requester_role = Column(String, nullable=False)
    requested_by = Column(String, nullable=False)
    geometry = Column(JSON, nullable=False)
    area_sqm = Column(Float, nullable=False)
    reason = Column(String, nullable=True)
    status = Column(String, nullable=False, default="PENDING_APPROVAL")
    approved_by = Column(String, nullable=True)
    approver_role = Column(String, nullable=True)
    created_at = Column(String, nullable=False)

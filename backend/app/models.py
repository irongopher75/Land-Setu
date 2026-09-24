from sqlalchemy import Column, Integer, String, Float, JSON
from sqlalchemy.dialects.postgresql import JSONB
from app.db import Base, IS_SQLITE

# JSONB on Postgres, plain JSON on SQLite.
FlagsType = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")

if not IS_SQLITE:
    try:
        from geoalchemy2 import Geometry
        # spatial_index=True makes geoalchemy2 emit
        # CREATE INDEX idx_<table>_geometry ... USING gist on create_table/create_all.
        # Alembic migration 0002 creates the same index name for existing databases.
        GeometryType = Geometry("POLYGON", srid=4326, spatial_index=True)
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
    # Cached RuleEngine output. NULL means stale or never computed: the next
    # reader recomputes and stores it. A list ([]) means "computed, no flags".
    flags = Column(FlagsType, nullable=True)

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
    # Request kind: BOUNDARY | DELETION | SPLIT | MERGE | CORRECTION.
    # Legacy rows are BOUNDARY; deletions are still recognised by status.
    type = Column(String, nullable=False, default="BOUNDARY", server_default="BOUNDARY", index=True)
    # Type specific data. SPLIT: {"parts": [{ulpin, geometry, area_sqm}]}.
    # MERGE: {"merge_ulpins": [..]}. CORRECTION: {layer, field, current, requested, evidence}.
    payload = Column(JSON, nullable=True)
    # Audit trail: [{"at": iso, "status": str, "role": str, "note": str}], oldest first.
    history = Column(JSON, nullable=True)

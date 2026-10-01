"""Real-polygon state detection, backed by the state_boundaries table (ST_Intersects), replacing the
bounding-box / hand-drawn-polygon point check for the states that table covers (the pilot states and
their neighbours — see backend/seed/boundaries/README.md). A state outside that set, or SQLite dev mode
(no PostGIS), falls back to app.states.detect_state_from_coords (approximate, point-in-polygon only;
never reports a border crossing).
"""
from typing import Any, Dict

from sqlalchemy import cast, func
from sqlalchemy.orm import Session

from app.db import IS_SQLITE
from app.models import StateBoundary
from app.rules import _pg_geom, MIN_OVERLAP_SQM
from app.states import detect_state_from_coords

if not IS_SQLITE:
    from geoalchemy2 import Geography


def _fallback_for_geometry(geom_shape) -> Dict[str, Any]:
    centroid = geom_shape.centroid
    approx = detect_state_from_coords(centroid.y, centroid.x)
    return {"code": approx["code"], "name": approx["name"], "crosses_state_boundary": False}


def detect_state_for_point(db: Session, lat: float, lng: float) -> Dict[str, Any]:
    """State containing a single point (lat, lng). Used for the live "identify state" lookup while a
    boundary is being drawn."""
    if IS_SQLITE:
        approx = detect_state_from_coords(lat, lng)
        return {"code": approx["code"], "name": approx["name"]}
    point = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)
    row = (
        db.query(StateBoundary.state_code, StateBoundary.name)
        .filter(func.ST_Intersects(StateBoundary.geometry, point))
        .first()
    )
    if row:
        return {"code": row.state_code, "name": row.name}
    approx = detect_state_from_coords(lat, lng)
    return {"code": approx["code"], "name": approx["name"]}


def detect_state_for_geometry(db: Session, geom_shape) -> Dict[str, Any]:
    """State a parcel boundary lies in: {"code", "name", "crosses_state_boundary"}.

    The assigned state is whichever state_boundaries polygon this geometry intersects with the
    largest area (ST_Intersects + ST_Area on the geography, same measure the boundary-overlap check
    uses). crosses_state_boundary is true when the geometry also meaningfully intersects a second
    state (more than the sliver threshold used elsewhere, MIN_OVERLAP_SQM).
    """
    if IS_SQLITE:
        return _fallback_for_geometry(geom_shape)

    g = _pg_geom(geom_shape)
    inter_area = func.ST_Area(cast(func.ST_Intersection(StateBoundary.geometry, g), Geography))
    rows = (
        db.query(StateBoundary.state_code, StateBoundary.name, inter_area.label("inter_area"))
        .filter(func.ST_Intersects(StateBoundary.geometry, g))
        .order_by(inter_area.desc())
        .all()
    )
    if not rows:
        return _fallback_for_geometry(geom_shape)

    best = rows[0]
    crosses = len(rows) > 1 and rows[1].inter_area > MIN_OVERLAP_SQM
    return {"code": best.state_code, "name": best.name, "crosses_state_boundary": crosses}

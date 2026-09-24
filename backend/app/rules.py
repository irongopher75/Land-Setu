import math
import json
from typing import List, Dict, Any, Optional, Iterable
from sqlalchemy import cast, func, and_, not_, update
from sqlalchemy.orm import Session
from shapely.geometry import shape, mapping, box
from app.db import IS_SQLITE
from app.models import Parcel, ProtectedZone

if not IS_SQLITE:
    from geoalchemy2 import Geography

EARTH_RADIUS_M = 6378137.0  # same radius Turf.js uses
MIN_OVERLAP_SQM = 0.5


def _ring_area_sqm(coords) -> float:
    """Spherical ring area, same algorithm as Turf.js ringArea."""
    n = len(coords)
    if n <= 2:
        return 0.0
    total = 0.0
    for i in range(n):
        if i == n - 2:
            lo, mid, up = n - 2, n - 1, 0
        elif i == n - 1:
            lo, mid, up = n - 1, 0, 1
        else:
            lo, mid, up = i, i + 1, i + 2
        total += (math.radians(coords[up][0]) - math.radians(coords[lo][0])) * math.sin(math.radians(coords[mid][1]))
    return total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0


def compute_geodesic_area_sqm(geom_shape) -> float:
    """
    Geodesic area in square meters for WGS84 lon/lat geometry. Spherical
    formula identical to Turf.js turf.area, so SQLite dev mode matches the
    frontend. Postgres uses PostGIS geography (spheroid) instead, see
    RuleEngine._check_boundary_overlap.
    """
    if not geom_shape or geom_shape.is_empty:
        return 0.0
    if hasattr(geom_shape, "geoms"):
        return sum(compute_geodesic_area_sqm(g) for g in geom_shape.geoms)
    if geom_shape.geom_type != "Polygon":
        return 0.0
    area = abs(_ring_area_sqm(list(geom_shape.exterior.coords)))
    for hole in geom_shape.interiors:
        area -= abs(_ring_area_sqm(list(hole.coords)))
    return float(area)


def parse_geometry_shape(geom_val):
    if isinstance(geom_val, dict):
        return shape(geom_val)
    if isinstance(geom_val, str):
        try:
            return shape(json.loads(geom_val))
        except Exception:
            pass
    try:
        from geoalchemy2.shape import to_shape
        return to_shape(geom_val)
    except Exception:
        pass
    return None


def _pg_geom(geom_shape):
    """Bind a Shapely geometry as a PostGIS geometry literal (SRID 4326)."""
    return func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(mapping(geom_shape))), 4326)


def _overlap_flag(ulpin: str, area_sqm: float) -> Dict[str, Any]:
    return {
        "rule": "boundary_overlap",
        "flag": True,
        "reason": f"Parcel boundary overlaps with neighboring parcel {ulpin}",
        "evidence": {
            "overlapping_parcel": ulpin,
            "overlap_area_sqm": round(area_sqm, 2),
        },
    }


def _zone_flag(name: str, zone_id: str) -> Dict[str, Any]:
    return {
        "rule": "protected_zone_containment",
        "flag": True,
        "reason": f"Parcel falls within protected eco-sensitive area: {name}",
        "evidence": {"protected_zone": name, "zone_id": zone_id},
    }


def _shapely_is_overlap(a, b) -> bool:
    # Interiors intersect. Same as PostGIS: ST_Intersects AND NOT ST_Touches.
    return a.intersects(b) and not a.touches(b)


# ---------------------------------------------------------------------------
# Flag cache (Parcel.flags). NULL = stale, list = computed.
# ---------------------------------------------------------------------------

def invalidate_neighbor_flags(db: Session, geometries: Iterable[Any], state: str,
                              exclude_id: Optional[int] = None) -> None:
    """
    Set flags = NULL on every parcel in `state` whose boundary intersects any
    of `geometries`. Call with BOTH the old and new geometry when a boundary
    moves, and with the old geometry when a parcel is deleted. Does not commit.
    """
    shapes = [s for s in (parse_geometry_shape(g) for g in geometries) if s is not None and not s.is_empty]
    if not shapes:
        return
    if IS_SQLITE:
        # No spatial index: bbox-filter in Python, then null the hits.
        ids = []
        for cand in db.query(Parcel.id, Parcel.geometry).filter(Parcel.state == state).all():
            if exclude_id is not None and cand.id == exclude_id:
                continue
            cs = parse_geometry_shape(cand.geometry)
            if cs is not None and any(box(*cs.bounds).intersects(box(*s.bounds)) for s in shapes):
                ids.append(cand.id)
        if ids:
            db.execute(update(Parcel).where(Parcel.id.in_(ids)).values(flags=None))
        return
    from sqlalchemy import or_
    conds = [func.ST_Intersects(Parcel.geometry, _pg_geom(s)) for s in shapes]
    q = update(Parcel).where(Parcel.state == state, or_(*conds))
    if exclude_id is not None:
        q = q.where(Parcel.id != exclude_id)
    db.execute(q.values(flags=None))


def invalidate_state_flags(db: Session, state: str) -> None:
    """Protected zones changed: every parcel in the state may be affected."""
    db.execute(update(Parcel).where(Parcel.state == state).values(flags=None))


class RuleEngine:
    @staticmethod
    def compute_flags(db: Session, parcel: Parcel) -> List[Dict[str, Any]]:
        """Evaluate all rules now. No cache read, no write."""
        flags = []
        for check in (
            RuleEngine._check_boundary_overlap(db, parcel),
            RuleEngine._check_protected_zone(db, parcel),
            RuleEngine._check_ownership_mismatch(parcel),
            RuleEngine._check_fsi_violation(parcel),
            RuleEngine._check_encumbrance(parcel),
        ):
            if check:
                flags.append(check)
        return flags

    @staticmethod
    def refresh_flags(db: Session, parcel: Parcel) -> List[Dict[str, Any]]:
        """Recompute and store in parcel.flags. Caller commits."""
        parcel.flags = RuleEngine.compute_flags(db, parcel)
        return parcel.flags

    @staticmethod
    def evaluate_parcel_rules(db: Session, parcel: Parcel, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Read cached flags; compute and store on a miss (flags IS NULL)."""
        if force_refresh or parcel.flags is None:
            RuleEngine.refresh_flags(db, parcel)
            db.commit()
        return parcel.flags

    @staticmethod
    def evaluate_parcels_batch(db: Session, parcels: List[Parcel], force_refresh: bool = False) -> Dict[int, List[Dict[str, Any]]]:
        """Flags for many parcels. Only cache misses are computed (one indexed query pair each)."""
        results: Dict[int, List[Dict[str, Any]]] = {}
        dirty = False
        for p in parcels:
            if force_refresh or p.flags is None:
                RuleEngine.refresh_flags(db, p)
                dirty = True
            results[p.id] = p.flags
        if dirty:
            db.commit()
        return results

    @staticmethod
    def _check_boundary_overlap(db: Session, parcel: Parcel) -> Optional[Dict[str, Any]]:
        parcel_shape = parse_geometry_shape(parcel.geometry)
        if parcel_shape is None or parcel_shape.is_empty:
            return None

        if not IS_SQLITE:
            # One indexed query. ST_Intersects is index-assisted (&& on the GIST index).
            # Overlap = interiors intersect = intersects AND NOT touches. This
            # also catches full containment, which ST_Overlaps alone misses.
            # Area is geodesic on the WGS84 spheroid. Largest overlap wins.
            g = _pg_geom(parcel_shape)
            area = func.ST_Area(cast(func.ST_Intersection(Parcel.geometry, g), Geography))
            row = (
                db.query(Parcel.ulpin, area.label("overlap_sqm"))
                .filter(
                    Parcel.id != parcel.id,
                    Parcel.state == parcel.state,
                    func.ST_Intersects(Parcel.geometry, g),
                    not_(func.ST_Touches(Parcel.geometry, g)),
                    area > MIN_OVERLAP_SQM,
                )
                .order_by(area.desc())
                .first()
            )
            return _overlap_flag(row.ulpin, row.overlap_sqm) if row else None

        # SQLite dev fallback: Shapely, bbox prefilter, spherical area.
        p_box = box(*parcel_shape.bounds)
        best = None
        for other in db.query(Parcel).filter(Parcel.id != parcel.id, Parcel.state == parcel.state).all():
            other_shape = parse_geometry_shape(other.geometry)
            if other_shape is None or not p_box.intersects(box(*other_shape.bounds)):
                continue
            if _shapely_is_overlap(parcel_shape, other_shape):
                a = compute_geodesic_area_sqm(parcel_shape.intersection(other_shape))
                if a > MIN_OVERLAP_SQM and (best is None or a > best[1]):
                    best = (other.ulpin, a)
        return _overlap_flag(*best) if best else None

    @staticmethod
    def _check_protected_zone(db: Session, parcel: Parcel) -> Optional[Dict[str, Any]]:
        parcel_shape = parse_geometry_shape(parcel.geometry)
        if parcel_shape is None or parcel_shape.is_empty:
            return None

        if not IS_SQLITE:
            zone = (
                db.query(ProtectedZone.name, ProtectedZone.zone_id)
                .filter(
                    ProtectedZone.state == parcel.state,
                    func.ST_Intersects(ProtectedZone.geometry, _pg_geom(parcel_shape)),
                )
                .order_by(ProtectedZone.zone_id)
                .first()
            )
            return _zone_flag(zone.name, zone.zone_id) if zone else None

        p_box = box(*parcel_shape.bounds)
        for zone in db.query(ProtectedZone).filter(ProtectedZone.state == parcel.state).all():
            zs = parse_geometry_shape(zone.geometry)
            if zs is not None and p_box.intersects(box(*zs.bounds)) and zs.intersects(parcel_shape):
                return _zone_flag(zone.name, zone.zone_id)
        return None

    @staticmethod
    def _check_ownership_mismatch(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        ror_owner = layers.get("ror", {}).get("owner_name")
        reg_buyer = layers.get("registration", {}).get("buyer_name")

        if ror_owner and reg_buyer:
            clean_ror = ror_owner.strip().lower()
            clean_reg = reg_buyer.strip().lower()
            if clean_ror != clean_reg:
                return {
                    "rule": "ownership_mismatch",
                    "flag": True,
                    "reason": f"Record of Rights owner ('{ror_owner}') does not match Sub-Registrar deed buyer ('{reg_buyer}')",
                    "evidence": {
                        "ror_owner": ror_owner,
                        "registration_buyer": reg_buyer
                    }
                }
        return None

    @staticmethod
    def _check_fsi_violation(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        permitted_fsi = layers.get("zoning", {}).get("permitted_fsi")
        approved_fsi = layers.get("building_permit", {}).get("approved_fsi")

        if permitted_fsi is not None and approved_fsi is not None:
            try:
                p_fsi = float(permitted_fsi)
                a_fsi = float(approved_fsi)
                if a_fsi > p_fsi:
                    return {
                        "rule": "zoning_fsi_violation",
                        "flag": True,
                        "reason": f"Approved building permit FSI ({a_fsi}) exceeds permitted zoning FSI limit ({p_fsi})",
                        "evidence": {
                            "permitted_fsi": p_fsi,
                            "approved_fsi": a_fsi
                        }
                    }
            except (ValueError, TypeError):
                pass
        return None

    @staticmethod
    def _check_encumbrance(parcel: Parcel) -> Dict[str, Any]:
        layers = parcel.layers or {}
        encumbrance = layers.get("encumbrance", {})
        if encumbrance.get("active") is True:
            return {
                "rule": "active_encumbrance",
                "flag": True,
                "reason": "Active financial mortgage or legal encumbrance registered against parcel",
                "evidence": {
                    "source": encumbrance.get("source", "sub_registrar")
                }
            }
        return None

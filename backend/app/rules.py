import math
import json
import os
from collections import defaultdict
from typing import List, Dict, Any, Optional, Iterable
from sqlalchemy import cast, func, and_, not_, update
from sqlalchemy.orm import Session, aliased
from shapely.geometry import shape, mapping, box
from app.db import IS_SQLITE
from app.models import Parcel, ProtectedZone

if not IS_SQLITE:
    from geoalchemy2 import Geography

EARTH_RADIUS_M = 6378137.0  # same radius Turf.js uses


def _area_tolerance() -> float:
    raw = os.getenv("AREA_MISMATCH_TOLERANCE", "0.10")
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"AREA_MISMATCH_TOLERANCE must be a number such as 0.10, got {raw!r}")
    if not 0 < value < 10:
        raise RuntimeError(f"AREA_MISMATCH_TOLERANCE must be between 0 and 10, got {value}")
    return value


def _min_overlap_sqm() -> float:
    raw = os.getenv("MIN_OVERLAP_SQM", "1")
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"MIN_OVERLAP_SQM must be a number such as 1, got {raw!r}")
    if value < 0:
        raise RuntimeError(f"MIN_OVERLAP_SQM must not be negative, got {value}")
    return value


# Largest allowed difference between a parcel's recorded extent and the area of its boundary, as a fraction of
# the recorded extent. 0.10 means 10%. Set AREA_MISMATCH_TOLERANCE to change it.
AREA_MISMATCH_TOLERANCE = _area_tolerance()

# Overlap area below this is a digitisation sliver, not a real boundary conflict. Set MIN_OVERLAP_SQM to change it.
MIN_OVERLAP_SQM = _min_overlap_sqm()


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


def recorded_extent_sqm(parcel) -> Optional[float]:
    """The extent the source record states. An approved boundary change keeps the earlier record's figure in
    layers.ror.recorded_extent_sqm; otherwise area_sqm is still the record's own."""
    ror = (parcel.layers or {}).get("ror") or {}
    value = ror.get("recorded_extent_sqm")
    return value if value is not None else parcel.area_sqm


def area_discrepancy(boundary_area: float, recorded: Optional[float]) -> Optional[float]:
    """|boundary - recorded| / recorded, or None when there is no usable recorded extent."""
    if recorded is None or recorded <= 0:
        return None
    return abs(boundary_area - recorded) / recorded


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


def geodesic_area_sqm(db: Session, geom_shape) -> float:
    """Authoritative area in square metres: ST_Area on the WGS84 geography (ellipsoid), same measure the
    boundary-overlap check uses, so a parcel's own area and its overlap with a neighbor agree.

    SQLite dev mode has no PostGIS, so it falls back to the spherical formula (compute_geodesic_area_sqm),
    which is within fractions of a percent of the ellipsoid figure at parcel scale.
    """
    if IS_SQLITE:
        return compute_geodesic_area_sqm(geom_shape)
    return db.query(func.ST_Area(cast(_pg_geom(geom_shape), Geography))).scalar()


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


_NO_OVERLAP_PRECOMPUTED = object()


class RuleEngine:
    @staticmethod
    def compute_flags(db: Session, parcel: Parcel, boundary_overlap: Any = _NO_OVERLAP_PRECOMPUTED) -> List[Dict[str, Any]]:
        """Evaluate all rules now. No cache read, no write.

        `boundary_overlap` lets a caller that already ran the batched overlap
        query (see `evaluate_parcels_batch`) hand in the result instead of
        triggering another one here. Left at the default, it is computed
        standalone (one query, just for this parcel).
        """
        overlap = (
            RuleEngine._check_boundary_overlap(db, parcel)
            if boundary_overlap is _NO_OVERLAP_PRECOMPUTED
            else boundary_overlap
        )
        flags = []
        for check in (
            overlap,
            RuleEngine._check_protected_zone(db, parcel),
            RuleEngine._check_ownership_mismatch(parcel),
            RuleEngine._check_fsi_violation(parcel),
            RuleEngine._check_encumbrance(parcel),
            RuleEngine._check_area_consistency(parcel),
        ):
            if check:
                flags.append(check)
        return flags

    @staticmethod
    def refresh_flags(db: Session, parcel: Parcel, boundary_overlap: Any = _NO_OVERLAP_PRECOMPUTED) -> List[Dict[str, Any]]:
        """Recompute and store in parcel.flags. Caller commits."""
        parcel.flags = RuleEngine.compute_flags(db, parcel, boundary_overlap=boundary_overlap)
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
        """Flags for many parcels. Only cache misses are computed, and their boundary-overlap
        check runs as a single query for the whole miss set (see `_check_boundary_overlap_batch`),
        not one query per parcel."""
        misses = [p for p in parcels if force_refresh or p.flags is None]
        if misses:
            overlaps = RuleEngine._check_boundary_overlap_batch(db, misses)
            for p in misses:
                RuleEngine.refresh_flags(db, p, boundary_overlap=overlaps.get(p.id))
            db.commit()
        return {p.id: p.flags for p in parcels}

    @staticmethod
    def _check_boundary_overlap(db: Session, parcel: Parcel) -> Optional[Dict[str, Any]]:
        return RuleEngine._check_boundary_overlap_batch(db, [parcel]).get(parcel.id)

    @staticmethod
    def _check_boundary_overlap_batch(db: Session, parcels: List[Parcel]) -> Dict[int, Dict[str, Any]]:
        """Largest-overlap flag per parcel in `parcels`, computed in one query (Postgres) or
        one query per distinct state touched (SQLite dev fallback) — never one query per parcel.
        Parcels with no usable geometry, or no overlap above MIN_OVERLAP_SQM, are simply absent
        from the returned dict (callers should use .get(parcel.id), which is None by default)."""
        valid_shapes: Dict[int, Any] = {}
        for p in parcels:
            s = parse_geometry_shape(p.geometry)
            if s is not None and not s.is_empty:
                valid_shapes[p.id] = s
        if not valid_shapes:
            return {}

        if not IS_SQLITE:
            # One indexed query for the whole miss set. ST_Intersects is index-assisted (&& on
            # the GIST index) on both sides of the self-join. Overlap = interiors intersect =
            # intersects AND NOT touches; this also catches full containment, which ST_Overlaps
            # alone misses. Area is geodesic on the WGS84 spheroid. Largest overlap wins per
            # candidate, picked with a window function instead of N separate ORDER BY/LIMIT 1s.
            Cand = aliased(Parcel)
            Other = aliased(Parcel)
            area = func.ST_Area(cast(func.ST_Intersection(Cand.geometry, Other.geometry), Geography))
            ranked = (
                db.query(
                    Cand.id.label("cand_id"),
                    Other.ulpin.label("other_ulpin"),
                    area.label("overlap_sqm"),
                    func.row_number().over(partition_by=Cand.id, order_by=area.desc()).label("rn"),
                )
                .join(
                    Other,
                    and_(Other.state == Cand.state, Other.status == "active", Other.id != Cand.id),
                )
                .filter(
                    Cand.id.in_(list(valid_shapes.keys())),
                    func.ST_Intersects(Cand.geometry, Other.geometry),
                    not_(func.ST_Touches(Cand.geometry, Other.geometry)),
                    area > MIN_OVERLAP_SQM,
                )
                .subquery()
            )
            rows = db.query(ranked.c.cand_id, ranked.c.other_ulpin, ranked.c.overlap_sqm).filter(ranked.c.rn == 1).all()
            return {row.cand_id: _overlap_flag(row.other_ulpin, row.overlap_sqm) for row in rows}

        # SQLite dev fallback: Shapely, bbox prefilter, spherical area. Still batched — the
        # candidate pool for each state touched by the miss set is fetched once, not once per
        # candidate parcel in that state.
        by_state: Dict[str, List[Parcel]] = defaultdict(list)
        for p in parcels:
            if p.id in valid_shapes:
                by_state[p.state].append(p)

        state_pool: Dict[str, List[Parcel]] = {
            state: db.query(Parcel).filter(Parcel.state == state, Parcel.status == "active").all()
            for state in by_state
        }

        results: Dict[int, Dict[str, Any]] = {}
        for state, candidates in by_state.items():
            pool = state_pool[state]
            for p in candidates:
                parcel_shape = valid_shapes[p.id]
                p_box = box(*parcel_shape.bounds)
                best = None
                for other in pool:
                    if other.id == p.id:
                        continue
                    other_shape = parse_geometry_shape(other.geometry)
                    if other_shape is None or not p_box.intersects(box(*other_shape.bounds)):
                        continue
                    if _shapely_is_overlap(parcel_shape, other_shape):
                        a = compute_geodesic_area_sqm(parcel_shape.intersection(other_shape))
                        if a > MIN_OVERLAP_SQM and (best is None or a > best[1]):
                            best = (other.ulpin, a)
                if best is not None:
                    results[p.id] = _overlap_flag(*best)
        return results

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

    @staticmethod
    def _check_area_consistency(parcel: Parcel) -> Optional[Dict[str, Any]]:
        """Recorded extent against the area of the boundary on the map. A large gap means one of them is wrong,
        so the parcel is flagged for review instead of either figure being silently trusted."""
        shape_ = parse_geometry_shape(parcel.geometry)
        if shape_ is None or shape_.is_empty:
            return None
        recorded = recorded_extent_sqm(parcel)
        boundary = compute_geodesic_area_sqm(shape_)
        ratio = area_discrepancy(boundary, recorded)
        if ratio is None or ratio <= AREA_MISMATCH_TOLERANCE:
            return None
        return {
            "rule": "area_mismatch",
            "flag": True,
            "reason": (f"Boundary area ({boundary:,.0f} sq m) differs from the recorded extent ({recorded:,.0f} sq m) "
                       f"by {ratio:.0%}, more than the {AREA_MISMATCH_TOLERANCE:.0%} allowed. Review before relying on either figure."),
            "evidence": {
                "boundary_area_sqm": round(boundary, 2),
                "recorded_extent_sqm": round(recorded, 2),
                "difference_ratio": round(ratio, 4),
                "tolerance": AREA_MISMATCH_TOLERANCE,
            },
        }

"""One-time correction of the synthetic seed geometry in databases seeded before it was fixed.

The first seed polygons were 10x to 157x larger than the extents their records state (docs/security-posture.md,
B2), and every seeded parcel carried an area_mismatch flag once that rule existed. New databases are seeded with
corrected polygons (backend/scripts/generate_seed_geometry.py). Databases seeded earlier, including the hosted
one, are never re-seeded, so this runs at startup and corrects them in place.

Why in place rather than a re-seed: re-seeding means dropping parcels, which would discard live requests,
approvals and the append-only audit log.

In one transaction, and only for rows that need it:
  1. replace the polygon of each seeded parcel whose polygon is outside AREA_MISMATCH_TOLERANCE of its recorded
     extent, unless an approved boundary, split or merge request has changed it (an officer-approved boundary
     is the record and is never overwritten);
  2. append an audit entry for each corrected parcel, so the chain shows the change;
  3. then clear every parcel's cached flags (what Alembic revision 0007 does), so no flag computed from the old
     polygons survives. Clearing happens after the geometry change, never before.
Idempotent: once corrected, a parcel is within tolerance and is left alone.

Safe with several replicas starting at once: on PostgreSQL the work runs under a transaction-level advisory lock
(pg_try_advisory_xact_lock). An instance that cannot take the lock skips the correction; the lock holder does it,
and the lock is released when its transaction commits. Only ULPINs in the seed set are ever considered.

Temporary: CORRECT_SEED_GEOMETRY_ON_STARTUP (default true) switches it off. Once every deployed database has been
corrected, turn it off and delete this module (docs/security-posture.md, B2 part 1).
"""
import json
import os
from typing import Dict, List

from shapely.geometry import shape
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app import audit
from app.db import IS_SQLITE
from app.intelligence.seed_history import fixture_polygons
from app.models import BoundaryChangeRequest, Parcel
from app.rules import AREA_MISMATCH_TOLERANCE, area_discrepancy, compute_geodesic_area_sqm, parse_geometry_shape, recorded_extent_sqm

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_GEOJSON = ("tamilnadu_geometries.geojson", "chandigarh_geometries.geojson")
BOUNDARY_CHANGING_TYPES = ("BOUNDARY", "SPLIT", "MERGE")
# Fixed advisory-lock key for this correction ("LSGC"), so every replica contends for the same lock.
SEED_CORRECTION_LOCK_KEY = 0x4C534743


def startup_correction_enabled() -> bool:
    return os.getenv("CORRECT_SEED_GEOMETRY_ON_STARTUP", "true").strip().lower() not in ("false", "0", "no", "off")


def corrected_seed_polygons() -> Dict[str, object]:
    """ULPIN -> corrected Polygon for every seeded parcel (state records and planted fixtures)."""
    polys = {}
    for name in SEED_GEOJSON:
        with open(os.path.join(BACKEND_DIR, "mock_data", name), encoding="utf-8") as f:
            for feat in json.load(f)["features"]:
                props = feat.get("properties", {})
                if props.get("type") == "parcel" and props.get("ulpin"):
                    polys[props["ulpin"]] = shape(feat["geometry"])
    polys.update(fixture_polygons())
    return polys


def correct_seed_geometry(db: Session) -> List[str]:
    """Correct out-of-tolerance seed polygons in place. Returns the ULPINs changed (empty when nothing was due)."""
    from app.workflow import geom_column_value

    if not IS_SQLITE:
        # Held until this transaction ends. A replica that cannot take it skips; the holder does the work.
        if not db.execute(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": SEED_CORRECTION_LOCK_KEY}).scalar():
            db.rollback()
            print("Seed geometry correction skipped: another instance holds the lock.")
            return []

    targets = corrected_seed_polygons()
    seed_ulpins = frozenset(targets)
    officer_changed = {u for (u,) in db.query(BoundaryChangeRequest.ulpin).filter(
        BoundaryChangeRequest.status == "APPROVED",
        BoundaryChangeRequest.type.in_(BOUNDARY_CHANGING_TYPES)).all()}

    changed = []
    for p in db.query(Parcel).filter(Parcel.ulpin.in_(sorted(seed_ulpins))).all():
        if p.ulpin not in seed_ulpins or p.ulpin in officer_changed:   # seed set only; approved boundaries stand
            continue
        current = parse_geometry_shape(p.geometry)
        recorded = recorded_extent_sqm(p)
        if current is None or recorded is None:
            continue
        before = area_discrepancy(compute_geodesic_area_sqm(current), recorded)
        if before is None or before <= AREA_MISMATCH_TOLERANCE:
            continue
        new = targets[p.ulpin]
        after = area_discrepancy(compute_geodesic_area_sqm(new), recorded)
        if after is None or after > AREA_MISMATCH_TOLERANCE:
            continue   # never swap one wrong polygon for another
        old_area = compute_geodesic_area_sqm(current)
        p.geometry = geom_column_value(new)
        audit.append(db, p.ulpin, "geometry_corrected", "system",
                     note=(f"Synthetic seed polygon replaced to match the recorded extent of {recorded:,.0f} sq m "
                           f"(the old polygon measured {old_area:,.0f} sq m). No record field changed."))
        changed.append(p.ulpin)

    if changed:
        db.flush()
        db.execute(update(Parcel).values(flags=None))   # Alembic 0007's effect, after the geometry change
    db.commit()
    return changed

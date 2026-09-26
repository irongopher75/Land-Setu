#!/usr/bin/env python3
"""Report every seeded parcel whose recorded extent and boundary area disagree.

The seed data pairs each parcel's recorded extent (from the state CSV, through the adapter) with a polygon
(from mock_data/*_geometries.geojson and the intelligence fixtures). This script seeds a throwaway SQLite
database exactly as the API does at startup, then compares the two figures with the same rule the API uses
(`area_mismatch` in backend/app/rules.py) and the same tolerance (AREA_MISMATCH_TOLERANCE, default 0.10).

It never touches the project database or the mock data files.

  ./venv/bin/python scripts/validate_seed_geometry.py            # table
  ./venv/bin/python scripts/validate_seed_geometry.py --csv      # machine-readable

Exit status: 0 if every parcel is within tolerance, 1 otherwise.
"""
import os
import sys
import tempfile

BACKEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")


def main() -> int:
    as_csv = "--csv" in sys.argv[1:]
    workdir = tempfile.mkdtemp(prefix="landsetu-seed-check-")
    # Must be set before app.db is imported.
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(workdir, 'seed.db')}"
    sys.path.insert(0, BACKEND_DIR)

    from app.db import SessionLocal
    from app.models import Parcel
    from app.seed import seed_database
    from app.intelligence.seed_history import backfill_seed_history, plant_fixtures
    from app.rules import (AREA_MISMATCH_TOLERANCE, area_discrepancy, compute_geodesic_area_sqm,
                           parse_geometry_shape, recorded_extent_sqm)

    seed_database()
    rows = []
    with SessionLocal() as db:
        backfill_seed_history(db)
        plant_fixtures(db)
        for p in db.query(Parcel).order_by(Parcel.state, Parcel.ulpin).all():
            shape_ = parse_geometry_shape(p.geometry)
            boundary = compute_geodesic_area_sqm(shape_) if shape_ is not None else 0.0
            recorded = recorded_extent_sqm(p)
            ratio = area_discrepancy(boundary, recorded)
            rows.append((p.state, p.ulpin, recorded, boundary, ratio))

    bad = [r for r in rows if r[4] is None or r[4] > AREA_MISMATCH_TOLERANCE]
    bad.sort(key=lambda r: -(r[4] if r[4] is not None else float("inf")))

    if as_csv:
        print("state,ulpin,recorded_extent_sqm,boundary_area_sqm,boundary_to_recorded,difference_ratio")
        for state, ulpin, rec, geo, ratio in bad:
            print(f"{state},{ulpin},{rec if rec is not None else ''},{geo:.2f},"
                  f"{(geo / rec) if rec else ''},{ratio if ratio is not None else ''}")
    else:
        print(f"Checked {len(rows)} seeded parcels. Tolerance {AREA_MISMATCH_TOLERANCE:.0%} of the recorded extent.")
        print(f"{len(bad)} outside tolerance, {len(rows) - len(bad)} within.\n")
        if bad:
            print(f"{'State':<11} {'ULPIN':<20} {'Recorded m²':>12} {'Boundary m²':>12} {'Boundary/record':>16}")
            for state, ulpin, rec, geo, ratio in bad:
                rec_s = f"{rec:,.0f}" if rec is not None else "none"
                mult = f"{geo / rec:,.1f}x" if rec else "n/a"
                print(f"{state:<11} {ulpin:<20} {rec_s:>12} {geo:>12,.0f} {mult:>16}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

"""Databases seeded with the old oversized polygons are corrected in place at startup (app/seed_corrections.py)."""
import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from shapely import affinity

from app import audit
from app.db import Base, SessionLocal, engine
from app.intelligence.seed_history import backfill_seed_history, plant_fixtures
from app.models import BoundaryChangeRequest, Parcel
from app.rules import AREA_MISMATCH_TOLERANCE, area_discrepancy, compute_geodesic_area_sqm, parse_geometry_shape, recorded_extent_sqm
from app.seed import seed_database
from app.seed_corrections import corrected_seed_polygons, correct_seed_geometry
from app.workflow import geom_column_value

OLD_STYLE = ["TN-CHN-0042-1187", "CHD-SEC-0017-0205", "TN-KPM-0107-2004"]
OFFICER_CHANGED = "TN-KPM-0107-2020"


@pytest.fixture(scope="module")
def db():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with SessionLocal() as s:
        backfill_seed_history(s)
        plant_fixtures(s)
    s = SessionLocal()
    yield s
    # Leave the shared test database as the seed made it.
    targets = corrected_seed_polygons()
    for ulpin in OLD_STYLE + [OFFICER_CHANGED]:
        p = s.query(Parcel).filter(Parcel.ulpin == ulpin).one()
        p.geometry = geom_column_value(targets[ulpin])
    s.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.requested_by == "seed-correction-test").delete()
    s.commit()
    s.close()


def blow_up(db, ulpin, factor=100):
    """Make a parcel look like the old seed: same place, ~factor times the recorded extent."""
    p = db.query(Parcel).filter(Parcel.ulpin == ulpin).one()
    g = parse_geometry_shape(p.geometry)
    p.geometry = geom_column_value(affinity.scale(g, factor ** 0.5, factor ** 0.5))
    return p


def within(p):
    return area_discrepancy(compute_geodesic_area_sqm(parse_geometry_shape(p.geometry)), recorded_extent_sqm(p)) <= AREA_MISMATCH_TOLERANCE


def test_old_seed_polygons_are_corrected_and_flags_cleared_after(db):
    for ulpin in OLD_STYLE:
        blow_up(db, ulpin)
    # An officer-approved boundary is the record: it must never be overwritten.
    blow_up(db, OFFICER_CHANGED)
    db.add(BoundaryChangeRequest(ulpin=OFFICER_CHANGED, state="TamilNadu", requester_role="village_officer",
                                 requested_by="seed-correction-test", geometry={}, area_sqm=1.0, status="APPROVED",
                                 type="BOUNDARY", created_at="2026-09-26T00:00:00"))
    # A flag cached from the old polygon.
    db.query(Parcel).filter(Parcel.ulpin == "TN-CHN-0042-1189").one().flags = [{"rule": "area_mismatch", "flag": True}]
    db.commit()
    chain_len = len(audit.chain(db, "TN-CHN-0042-1187"))

    changed = correct_seed_geometry(db)

    assert sorted(changed) == sorted(OLD_STYLE)
    for ulpin in OLD_STYLE:
        p = db.query(Parcel).filter(Parcel.ulpin == ulpin).one()
        assert within(p), ulpin
        assert parse_geometry_shape(p.geometry).equals(corrected_seed_polygons()[ulpin])
    officer = db.query(Parcel).filter(Parcel.ulpin == OFFICER_CHANGED).one()
    assert not within(officer)                      # left exactly as the approval made it
    assert all(p.flags is None for p in db.query(Parcel).all())   # every cached flag cleared

    entries = audit.chain(db, "TN-CHN-0042-1187")
    assert len(entries) == chain_len + 1 and entries[-1].event == "geometry_corrected"
    assert audit.verify(entries) == (True, None)


def test_correction_is_idempotent(db):
    db.query(Parcel).filter(Parcel.ulpin == "TN-CHN-0042-1189").one().flags = []
    db.commit()
    assert correct_seed_geometry(db) == []
    # Nothing was due, so cached flags are left alone.
    assert db.query(Parcel).filter(Parcel.ulpin == "TN-CHN-0042-1189").one().flags == []


def test_a_correct_seed_is_left_untouched(db):
    assert correct_seed_geometry(db) == []

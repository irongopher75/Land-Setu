import math
import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from shapely.geometry import box, mapping

from app.db import SessionLocal, Base, engine
from app.models import Parcel
from app.rules import RuleEngine, compute_geodesic_area_sqm, invalidate_neighbor_flags
from app.routes.parcels import _refresh_flags_after_change

STATE = "FlagCacheTestState"
LAYERS = {"ror": {"owner_name": "A"}, "registration": {"buyer_name": "A"}}


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=engine)
    s = SessionLocal()
    s.query(Parcel).filter(Parcel.state == STATE).delete()
    s.commit()
    yield s
    s.query(Parcel).filter(Parcel.state == STATE).delete()
    s.commit()
    s.close()


def _mk(db, ulpin, geom):
    p = Parcel(ulpin=ulpin, state=STATE, area_sqm=100, geometry=mapping(geom), layers=LAYERS)
    db.add(p)
    _refresh_flags_after_change(db, p)
    db.commit()
    return p


def test_geodesic_area_matches_spherical_reference():
    # Closed form for a lon/lat box on a sphere: R^2 * dLon * (sin(lat2) - sin(lat1)).
    lon1, lat1, lon2, lat2 = 80.270, 13.080, 80.271, 13.081
    ref = 6378137.0 ** 2 * math.radians(lon2 - lon1) * (math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)))
    assert compute_geodesic_area_sqm(box(lon1, lat1, lon2, lat2)) == pytest.approx(ref, rel=1e-9)


def test_flags_cached_and_stale_marker(db):
    p = _mk(db, "FC-1", box(77.0, 12.0, 77.001, 12.001))
    assert p.flags == []
    p.flags = None
    assert RuleEngine.evaluate_parcel_rules(db, p) == []
    assert p.flags == []


def test_new_overlapping_parcel_flags_neighbor(db):
    a = _mk(db, "FC-A", box(77.0, 12.0, 77.001, 12.001))
    assert a.flags == []
    b = _mk(db, "FC-B", box(77.0005, 12.0005, 77.0015, 12.0015))
    assert [f["rule"] for f in b.flags] == ["boundary_overlap"]
    db.refresh(a)
    assert a.flags is None  # neighbor invalidated, not stale-false
    RuleEngine.evaluate_parcel_rules(db, a)
    assert a.flags[0]["evidence"]["overlapping_parcel"] == "FC-B"
    # overlap is a 0.0005 x 0.0005 deg square
    expected = compute_geodesic_area_sqm(box(77.0005, 12.0005, 77.001, 12.001))
    assert a.flags[0]["evidence"]["overlap_area_sqm"] == pytest.approx(expected, abs=0.01)


def test_moving_boundary_clears_old_and_new_neighbors(db):
    a = _mk(db, "FC-A", box(77.0, 12.0, 77.001, 12.001))
    far = _mk(db, "FC-FAR", box(77.5, 12.5, 77.501, 12.501))
    b = _mk(db, "FC-B", box(77.0005, 12.0005, 77.0015, 12.0015))
    RuleEngine.evaluate_parcels_batch(db, [a, far])
    old = b.geometry
    b.geometry = mapping(box(77.5005, 12.5005, 77.5015, 12.5015))  # move onto FAR
    _refresh_flags_after_change(db, b, old, STATE)
    db.commit()
    db.refresh(a); db.refresh(far)
    assert a.flags is None and far.flags is None  # old neighbor and new neighbor both stale
    RuleEngine.evaluate_parcels_batch(db, [a, far])
    assert a.flags == []
    assert far.flags[0]["evidence"]["overlapping_parcel"] == "FC-B"


def test_delete_clears_neighbors(db):
    a = _mk(db, "FC-A", box(77.0, 12.0, 77.001, 12.001))
    b = _mk(db, "FC-B", box(77.0005, 12.0005, 77.0015, 12.0015))
    RuleEngine.evaluate_parcel_rules(db, a)
    assert a.flags
    invalidate_neighbor_flags(db, [b.geometry], STATE, exclude_id=b.id)
    db.delete(b)
    db.commit()
    db.refresh(a)
    assert a.flags is None
    assert RuleEngine.evaluate_parcel_rules(db, a) == []

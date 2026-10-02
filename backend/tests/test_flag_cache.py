import math
import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")

import pytest
from shapely.geometry import box, mapping

from app.db import SessionLocal, Base, engine
from app.models import Parcel
from app.rules import RuleEngine, compute_geodesic_area_sqm, geodesic_area_sqm, invalidate_neighbor_flags
from app.routes.parcels import _refresh_flags_after_change
from app.workflow import geom_column_value

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
    # Recorded extent matches the boundary, so only the neighbour rules under test can raise a flag.
    p = Parcel(ulpin=ulpin, state=STATE, area_sqm=compute_geodesic_area_sqm(geom), geometry=geom_column_value(geom), layers=LAYERS)
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
    # overlap is a 0.0005 x 0.0005 deg square. The flag's area comes from PostGIS ST_Area on the WGS84
    # geography (ellipsoid); this reference is the sphere formula, so allow the ellipsoid/sphere gap (~1%).
    expected = compute_geodesic_area_sqm(box(77.0005, 12.0005, 77.001, 12.001))
    assert a.flags[0]["evidence"]["overlap_area_sqm"] == pytest.approx(expected, rel=0.01)


def test_moving_boundary_clears_old_and_new_neighbors(db):
    a = _mk(db, "FC-A", box(77.0, 12.0, 77.001, 12.001))
    far = _mk(db, "FC-FAR", box(77.5, 12.5, 77.501, 12.501))
    b = _mk(db, "FC-B", box(77.0005, 12.0005, 77.0015, 12.0015))
    RuleEngine.evaluate_parcels_batch(db, [a, far])
    old = b.geometry
    b.geometry = geom_column_value(box(77.5005, 12.5005, 77.5015, 12.5015))  # move onto FAR
    _refresh_flags_after_change(db, b, old, STATE)
    db.commit()
    db.refresh(a); db.refresh(far)
    assert a.flags is None and far.flags is None  # old neighbor and new neighbor both stale
    RuleEngine.evaluate_parcels_batch(db, [a, far])
    assert a.flags == []
    assert far.flags[0]["evidence"]["overlapping_parcel"] == "FC-B"


def test_touching_only_parcels_are_not_flagged(db):
    # Share exactly one edge (x=77.001); interiors do not intersect, so this is not an overlap.
    # Creating b invalidates a's cached flags (a neighbor changed), so a is re-evaluated before asserting.
    a = _mk(db, "FC-TOUCH-A", box(77.0, 12.0, 77.001, 12.001))
    b = _mk(db, "FC-TOUCH-B", box(77.001, 12.0, 77.002, 12.001))
    assert b.flags == []
    db.refresh(a)
    assert RuleEngine.evaluate_parcel_rules(db, a) == []


def test_sliver_overlap_below_threshold_is_ignored(db):
    # A ~0.6 m^2 sliver, under the default MIN_OVERLAP_SQM (1 m^2) — a digitisation artifact,
    # not a real boundary conflict.
    a = _mk(db, "FC-SLIVER-A", box(77.0, 12.0, 77.001, 12.001))
    b = _mk(db, "FC-SLIVER-B", box(77.00099995000001, 12.0, 77.002, 12.001))
    assert b.flags == []
    db.refresh(a)
    assert RuleEngine.evaluate_parcel_rules(db, a) == []


def test_postgis_area_within_tolerance_of_geodesic_reference(db):
    # Backend area of a known polygon close to the expected geodesic value. The reference here is the
    # sphere formula (compute_geodesic_area_sqm); PostGIS's ST_Area(geography) is WGS84-ellipsoid, which
    # differs from the sphere by a fairly constant ~0.3-0.7% at these latitudes, so the tolerance is 1%,
    # not the 0.5% a from-scratch ellipsoidal reference would allow.
    geom = box(77.3, 11.5, 77.301, 11.501)
    reference = compute_geodesic_area_sqm(geom)
    assert geodesic_area_sqm(db, geom) == pytest.approx(reference, rel=0.01)


def test_batched_overlap_matches_per_row_overlap(db):
    # Fixture: A overlaps B, B overlaps A/C/E, D is isolated, E only slivers against A
    # (below MIN_OVERLAP_SQM) but has a real overlap with B. Covers overlap/no-overlap/
    # sliver in one batch, including a candidate with more than one real neighbor.
    a = _mk(db, "FC-BATCH-A", box(77.0, 12.0, 77.001, 12.001))
    b = _mk(db, "FC-BATCH-B", box(77.0005, 12.0005, 77.0025, 12.0025))
    c = _mk(db, "FC-BATCH-C", box(77.002, 12.002, 77.003, 12.003))
    d = _mk(db, "FC-BATCH-D", box(78.0, 13.0, 78.001, 13.001))
    e = _mk(db, "FC-BATCH-E", box(77.00099995000001, 12.0, 77.002, 12.001))

    for p in (a, b, c, d, e):
        p.flags = None
    db.commit()

    per_row = {p.id: RuleEngine._check_boundary_overlap(db, p) for p in (a, b, c, d, e)}
    batched = RuleEngine._check_boundary_overlap_batch(db, [a, b, c, d, e])

    for p in (a, b, c, d, e):
        assert batched.get(p.id) == per_row[p.id]

    # Sanity: the fixture actually exercises overlap, no-overlap and sliver-below-threshold.
    assert per_row[a.id]["evidence"]["overlapping_parcel"] == "FC-BATCH-B"
    assert per_row[b.id]["evidence"]["overlapping_parcel"] in ("FC-BATCH-A", "FC-BATCH-C", "FC-BATCH-E")
    assert per_row[d.id] is None
    assert per_row[e.id]["evidence"]["overlapping_parcel"] == "FC-BATCH-B"


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

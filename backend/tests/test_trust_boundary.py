"""The approval workflow stores only values the server computed or a source record supplied.

- Area and state come from the approved polygon, whatever the browser sent or the request holds.
- Approving a new parcel requires the officer to enter owner, zoning, tax and encumbrance; nothing is invented,
  and the entry is labelled officer_provided, never verified.
- The adapter labels a layer verified only when the source record supplied it.
- A recorded extent far from the boundary's area is flagged for review.
"""
import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from conftest import insert_parcel
from fastapi.testclient import TestClient
from shapely.geometry import shape

from app.adapter import SchemaAdapter
from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import BoundaryChangeRequest, Parcel
from app.rules import AREA_MISMATCH_TOLERANCE, RuleEngine, compute_geodesic_area_sqm
from app.seed import seed_database
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def hdr(role, uid):
    return {"Authorization": f"Bearer {auth_mod.create_jwt_token(role, uid)}"}


def square(x, y, size=0.001):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]}


def file_boundary(c, ulpin, geometry, **forged):
    """A village officer marks a boundary. Extra keyword arguments are sent as-is, to forge fields."""
    body = {"ulpin": ulpin, "owner_name": "Typed By Officer", "geometry": geometry, **forged}
    return c.post("/parcels/custom", headers=hdr("village_officer", "vo-tb"), json=body)


RECORD = {"owner_name": "Lakshmi Narayanan", "zoning": "residential", "tax_value": 18500, "encumbrance_status": "none"}


def walk_to_approval(c, request_id, record=None):
    """Auditor passes, then the state administrator approves (with a record entry, if given)."""
    r = c.post(f"/parcels/requests/{request_id}/auditor-pass", headers=hdr("auditor", "au-tb"))
    assert r.status_code == 200, r.text
    return approve(c, request_id, record)


def approve(c, request_id, record=None):
    kwargs = {"json": record} if record is not None else {}
    return c.post(f"/parcels/requests/{request_id}/approve", headers=hdr("state_admin", "sa-tb"), **kwargs)


def parcel(ulpin):
    with SessionLocal() as db:
        return db.query(Parcel).filter(Parcel.ulpin == ulpin).first()


# A square inside Tamil Nadu (the backend's point-in-polygon puts 77.4 E, 11.0 N there) and one in Bengaluru.
TN_GEOM = square(77.40, 11.00)
KARNATAKA_GEOM = square(77.59, 12.97)


# --- Area and state are server-computed -------------------------------------------------------------------

def test_forged_area_and_state_at_filing_are_ignored(client):
    r = file_boundary(client, "TB-FORGE-1", TN_GEOM, area_sqm=1.0, state="Karnataka")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "TamilNadu"
    with SessionLocal() as db:
        req = db.get(BoundaryChangeRequest, body["request_id"])
        assert req.state == "TamilNadu"
        assert req.area_sqm == pytest.approx(compute_geodesic_area_sqm(shape(TN_GEOM)), abs=0.01)  # stored to the centimetre

    assert walk_to_approval(client, body["request_id"], RECORD).status_code == 200
    p = parcel("TB-FORGE-1")
    assert p.state == "TamilNadu"
    assert p.area_sqm == pytest.approx(compute_geodesic_area_sqm(shape(TN_GEOM)), abs=0.01)  # stored to the centimetre
    assert p.area_sqm != 1.0


def test_values_stored_on_a_request_are_recomputed_at_approval(client):
    """Requests filed before this fix carried the browser's area and state. Approval must not trust them."""
    r = file_boundary(client, "TB-FORGE-2", square(77.42, 11.00))
    rid = r.json()["request_id"]
    with SessionLocal() as db:
        req = db.get(BoundaryChangeRequest, rid)
        req.area_sqm, req.state = 1.0, "Karnataka"   # as an older client could have stored them
        db.commit()

    assert walk_to_approval(client, rid, RECORD).status_code == 200
    p = parcel("TB-FORGE-2")
    assert p.state == "TamilNadu"
    assert p.area_sqm == pytest.approx(compute_geodesic_area_sqm(shape(square(77.42, 11.00))), abs=0.01)  # stored to the centimetre


def test_approval_cannot_move_an_existing_parcel_to_another_state(client):
    insert_parcel("TB-MOVE-1", square(77.44, 11.00), state="TamilNadu", area_sqm=12_000.0)
    r = file_boundary(client, "TB-MOVE-1", KARNATAKA_GEOM, state="TamilNadu")
    assert r.status_code == 200, r.text
    assert walk_to_approval(client, r.json()["request_id"]).status_code == 409
    p = parcel("TB-MOVE-1")
    assert p.state == "TamilNadu"
    assert shape(p.geometry).equals(shape(square(77.44, 11.00)))


def test_ulpin_state_code_must_match_where_the_boundary_lies(client):
    r = file_boundary(client, "TN-TB-0001-0001", KARNATAKA_GEOM, state="TamilNadu")
    assert r.status_code == 409
    assert "Karnataka" in r.json()["detail"]


def test_reshaping_keeps_the_recorded_extent(client):
    insert_parcel("TB-RESHAPE-1", square(77.46, 11.00), state="TamilNadu", area_sqm=12_000.0)
    r = file_boundary(client, "TB-RESHAPE-1", square(77.46, 11.00, size=0.0005))
    assert walk_to_approval(client, r.json()["request_id"]).status_code == 200
    p = parcel("TB-RESHAPE-1")
    assert p.layers["ror"]["recorded_extent_sqm"] == 12_000.0
    assert p.area_sqm == pytest.approx(compute_geodesic_area_sqm(shape(square(77.46, 11.00, size=0.0005))), abs=0.01)  # stored to the centimetre


# --- Approval invents nothing -----------------------------------------------------------------------------

def test_approving_a_new_parcel_without_a_record_is_refused_and_changes_nothing(client):
    r = file_boundary(client, "TB-NEW-1", square(77.48, 11.00))
    rid = r.json()["request_id"]
    res = walk_to_approval(client, rid)
    assert res.status_code == 422
    detail = res.json()["detail"]
    for field in ("owner_name", "zoning", "tax_value", "encumbrance_status"):
        assert field in detail
    assert parcel("TB-NEW-1") is None
    with SessionLocal() as db:
        assert db.get(BoundaryChangeRequest, rid).status == "PENDING_STATE_ADMIN"


BAD_ENTRIES = [
    ("owner_name", "   "), ("owner_name", "TBD"), ("owner_name", "N/A"), ("owner_name", "New Land Owner"),
    ("zoning", ""), ("zoning", "downtown"),
    ("tax_value", None), ("tax_value", 0), ("tax_value", -500), ("tax_value", 50_000_000),
    ("encumbrance_status", ""), ("encumbrance_status", "maybe"),
]


@pytest.mark.parametrize("i,field,value", [(i, f, v) for i, (f, v) in enumerate(BAD_ENTRIES)])
def test_each_blank_or_implausible_field_is_refused_by_name(client, i, field, value):
    r = file_boundary(client, f"TB-BAD-{i:02d}", square(77.60, 11.00, size=0.0003))
    rid = r.json()["request_id"]
    assert client.post(f"/parcels/requests/{rid}/auditor-pass", headers=hdr("auditor", "au-tb")).status_code == 200
    res = approve(client, rid, {**RECORD, field: value})
    assert res.status_code == 422, res.text
    assert field in res.json()["detail"]


def test_the_officers_entry_is_stored_labelled_officer_provided_never_verified(client):
    r = file_boundary(client, "TB-NEW-3", square(77.62, 11.00))
    entry = {"owner_name": "  Kavitha Subramanian ", "zoning": "Commercial", "tax_value": 42000.5, "encumbrance_status": "active"}
    assert walk_to_approval(client, r.json()["request_id"], entry).status_code == 200
    layers = parcel("TB-NEW-3").layers

    assert layers["ror"]["owner_name"] == "Kavitha Subramanian"
    assert layers["ror"]["claimed_owner_name"] == "Typed By Officer"
    assert layers["zoning"]["land_use"] == "commercial"
    assert layers["tax"]["annual_value"] == 42000.5
    assert layers["encumbrance"]["active"] is True
    for name in ("ror", "zoning", "tax", "encumbrance"):
        assert layers[name]["confidence"] == "officer_provided", name
        assert layers[name]["source"] == "reviewing_officer"
        assert layers[name]["department"]
    for name in ("registration", "building_permit"):
        assert layers[name]["confidence"] == "unverified", name
    assert "verified" not in {layer["confidence"] for layer in layers.values()}


def test_citizens_see_the_officer_entry_and_its_label(client):
    detail = client.get("/parcels/TB-NEW-3").json()
    assert detail["layers"]["ror"]["owner_name"] == "Kavitha Subramanian"
    assert detail["layers"]["ror"]["confidence"] == "officer_provided"
    assert detail["layers"]["encumbrance"]["active"] is True


def test_record_fields_are_refused_when_the_parcel_already_has_a_record(client):
    insert_parcel("TB-EXIST-1", square(77.64, 11.00), state="TamilNadu", area_sqm=12_000.0)
    r = file_boundary(client, "TB-EXIST-1", square(77.64, 11.00, size=0.0009))
    res = walk_to_approval(client, r.json()["request_id"], RECORD)
    assert res.status_code == 422
    assert parcel("TB-EXIST-1").layers["ror"]["confidence"] == "verified"   # the department record is untouched


def test_pending_list_says_which_approvals_need_a_record(client):
    file_boundary(client, "TB-NEED-1", square(77.66, 11.00))
    insert_parcel("TB-NEED-2", square(77.68, 11.00), state="TamilNadu", area_sqm=12_000.0)
    file_boundary(client, "TB-NEED-2", square(77.68, 11.00, size=0.0009))
    rows = {r["ulpin"]: r for r in client.get("/parcels/requests/pending", headers=hdr("state_admin", "sa-list")).json()}
    assert rows["TB-NEED-1"]["needs_record_entry"] is True
    assert rows["TB-NEED-2"]["needs_record_entry"] is False


def test_citizens_do_not_see_the_unverified_owner_claim(client):
    r = file_boundary(client, "TB-NEW-2", square(77.50, 11.00))
    assert walk_to_approval(client, r.json()["request_id"], RECORD).status_code == 200
    detail = client.get("/parcels/TB-NEW-2").json()
    assert "claimed_owner_name" not in detail["layers"].get("ror", {})


# --- Adapter labels only sourced values verified ----------------------------------------------------------

def _normalize(row):
    base = {"ulpin": "TN-TB-0000-0001", "pattadar_peyar": "A Owner", "khatha_num": "KH-1", "extent_hectares": "0.05"}
    return SchemaAdapter().normalize("TamilNadu", {**base, **row})["layers"]


def test_adapter_leaves_a_missing_encumbrance_unknown():
    layers = _normalize({})
    assert layers["encumbrance"]["active"] is None
    assert layers["encumbrance"]["confidence"] == "unverified"


def test_adapter_does_not_verify_layers_the_record_did_not_supply():
    layers = _normalize({})
    for name in ("zoning", "building_permit", "tax", "registration"):
        assert layers[name]["confidence"] == "unverified", name


def test_adapter_invents_no_ror_date():
    layers = _normalize({})
    assert layers["ror"]["last_verified"] is None
    assert layers["ror"]["confidence"] == "stale"   # supplied, but nothing shows it is current


def test_adapter_verifies_a_current_sourced_value():
    layers = _normalize({"tax_annual_value": "42000", "tax_last_updated": "2025-04-01"})
    assert layers["tax"]["confidence"] == "verified"


# --- Recorded extent against boundary area ----------------------------------------------------------------

def test_seed_parcel_with_mismatched_extent_is_flagged(client):
    flags = client.get("/parcels/TN-CHN-0042-1187/flags").json()
    area = next(f for f in flags if f["rule"] == "area_mismatch")
    assert area["evidence"]["recorded_extent_sqm"] == pytest.approx(452.0)
    assert area["evidence"]["boundary_area_sqm"] > 60_000


def test_extent_within_tolerance_is_not_flagged():
    geom = square(77.52, 11.00)
    boundary = compute_geodesic_area_sqm(shape(geom))
    within = Parcel(ulpin="TB-AREA-OK", state="TamilNadu", geometry=geom, layers={},
                    area_sqm=boundary * (1 + AREA_MISMATCH_TOLERANCE * 0.9))
    outside = Parcel(ulpin="TB-AREA-BAD", state="TamilNadu", geometry=geom, layers={},
                     area_sqm=boundary * (1 + AREA_MISMATCH_TOLERANCE * 1.5))
    assert RuleEngine._check_area_consistency(within) is None
    assert RuleEngine._check_area_consistency(outside)["rule"] == "area_mismatch"


def test_recorded_extent_is_preferred_over_area_sqm():
    geom = square(77.54, 11.00)
    boundary = compute_geodesic_area_sqm(shape(geom))
    p = Parcel(ulpin="TB-AREA-REC", state="TamilNadu", geometry=geom, area_sqm=boundary,
               layers={"ror": {"recorded_extent_sqm": boundary * 3}})
    assert RuleEngine._check_area_consistency(p)["evidence"]["recorded_extent_sqm"] == pytest.approx(boundary * 3)


# --- Officer corrections carry their own provenance --------------------------------------------------------

def _correct(c, ulpin, layer, field, value, filer_role="citizen"):
    r = c.post(f"/parcels/{ulpin}/correction-request", headers=hdr(filer_role, "cor-filer"),
               json={"layer": layer, "field": field, "requested_value": value, "requested_by": "Test filer"})
    assert r.status_code == 200, r.text
    return r.json()


def test_high_track_correction_is_labelled_corrected_by_officer_not_verified(client):
    insert_parcel("TB-COR-1", square(77.56, 11.00), owner="Asha Rao")
    before = parcel("TB-COR-1").layers["ror"]
    assert before["confidence"] == "verified"   # the fixture's department record

    body = _correct(client, "TB-COR-1", "ror", "owner_name", "Zubin Shah")
    assert body["track"] == "HIGH"
    rid = body["request_id"]
    assert client.post(f"/parcels/requests/{rid}/village-pass", headers=hdr("village_officer", "vo-cor")).status_code == 200
    assert client.post(f"/parcels/requests/{rid}/auditor-pass", headers=hdr("auditor", "au-cor")).status_code == 200
    assert client.post(f"/parcels/requests/{rid}/approve", headers=hdr("state_admin", "sa-cor")).status_code == 200

    ror = parcel("TB-COR-1").layers["ror"]
    assert ror["owner_name"] == "Zubin Shah"
    assert ror["confidence"] == "corrected_by_officer"
    assert ror["confidence"] != "verified"
    assert ror["corrected_fields"] == ["owner_name"]
    assert ror["corrected_by_request"] == rid
    assert ror["last_verified"] == before["last_verified"]   # the department's date is not refreshed


def test_fast_track_correction_is_also_not_verified(client):
    insert_parcel("TB-COR-2", square(77.58, 11.00), owner="Asha Rao")
    body = _correct(client, "TB-COR-2", "ror", "owner_name", "Asha Rau")   # spelling-level
    assert body["track"] == "FAST"
    assert client.post(f"/parcels/requests/{body['request_id']}/fast-approve",
                       headers=hdr("auditor", "au-cor2")).status_code == 200
    ror = parcel("TB-COR-2").layers["ror"]
    assert ror["owner_name"] == "Asha Rau"
    assert ror["confidence"] == "corrected_by_officer"


def test_citizens_see_that_a_field_was_corrected(client):
    detail = client.get("/parcels/TB-COR-1").json()   # corrected in the HIGH-track test above
    assert detail["layers"]["ror"]["confidence"] == "corrected_by_officer"
    assert detail["layers"]["ror"]["corrected_fields"] == ["owner_name"]


def test_only_a_department_record_restores_verified():
    """The adapter, importing the department's own record, is the one path that labels a layer verified.
    It never produces the officer-correction label."""
    layers = _normalize({"transaction_date": "2025-06-01"})
    assert layers["ror"]["confidence"] == "verified"
    assert all(layer["confidence"] != "corrected_by_officer" for layer in layers.values())

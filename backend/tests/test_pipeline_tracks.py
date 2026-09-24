import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from conftest import insert_parcel
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import Parcel, ParcelAuditLog
from app.seed import seed_database
from app import audit
from app.workflow import route_request, is_spelling_level_edit
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def hdr(role, uid=None):
    return {"Authorization": f"Bearer {auth_mod.create_jwt_token(role, uid or f'user-{role}')}"}


def square(x, y, w=0.001, h=0.001):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]}


def make_parcel(c, ulpin, x, owner="Asha Rao"):
    insert_parcel(ulpin, square(x, 12.0), owner)


def correction(c, ulpin, field, value, role="citizen", uid=None):
    return c.post(f"/parcels/{ulpin}/correction-request", headers=hdr(role, uid),
                  json={"layer": "ror", "field": field, "requested_value": value, "requested_by": "Tester"})


# ---- routing -------------------------------------------------------------------------------

def test_high_rigor_types_always_route_high():
    for t in ("BOUNDARY", "SPLIT", "MERGE", "DELETION", "SOMETHING_NEW"):
        assert route_request(t) == "HIGH"


@pytest.mark.parametrize("a,b,expected", [
    ("R. Kannan", "R Kannan", True),
    ("R. Kannan", "R. Kannam", True),
    ("R. Kannan", "S. Kannan", False),      # different initial: a different person
    ("Asha Rao", "Rahul Rao", False),
    ("KH-1187", "KH1187", True),            # format only
    ("KH-1187", "KH-1188", False),          # different account number
    ("", "Asha", False),
])
def test_spelling_level_edit(a, b, expected):
    assert is_spelling_level_edit(a, b) is expected


def test_correction_fields_route():
    p = lambda layer, field, cur, req: {"layer": layer, "field": field, "current": cur, "requested": req}
    assert route_request("CORRECTION", p("ror", "owner_name", "Asha Rao", "Asha Raoo")) == "FAST"
    assert route_request("CORRECTION", p("ror", "owner_name", "Asha Rao", "Zubin Shah")) == "HIGH"
    assert route_request("CORRECTION", p("ror", "owner_share", "1/1", "1/2")) == "HIGH"
    assert route_request("CORRECTION", p("registration", "buyer_name", "Asha Rao", "Asha Raoo")) == "HIGH"
    assert route_request("CORRECTION", p("zoning", "land_use", "residential", "commercial")) == "HIGH"


# ---- fast track ----------------------------------------------------------------------------

def test_fast_track_single_approver_skips_village_stage(client):
    make_parcel(client, "PT-F1", 76.10)
    r = correction(client, "PT-F1", "owner_name", "Asha Raoo")
    assert r.status_code == 200 and r.json()["track"] == "FAST" and r.json()["status"] == "PENDING_FAST_REVIEW"
    rid = r.json()["request_id"]
    assert client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("village_officer")).status_code == 403
    assert client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("citizen")).status_code == 403
    ok = client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("auditor"))
    assert ok.status_code == 200, ok.text
    db = SessionLocal()
    assert db.query(Parcel).filter(Parcel.ulpin == "PT-F1").first().layers["ror"]["owner_name"] == "Asha Raoo"


def test_substantive_correction_is_high_and_cannot_use_fast_approve(client):
    make_parcel(client, "PT-H1", 76.12)
    r = correction(client, "PT-H1", "owner_name", "Zubin Shah")
    assert r.json()["track"] == "HIGH" and r.json()["status"] == "PENDING_VILLAGE_REVIEW"
    assert client.post(f"/parcels/requests/{r.json()['request_id']}/fast-approve", headers=hdr("state_admin")).status_code == 400


# ---- nobody approves their own request -----------------------------------------------------

def test_super_admin_cannot_approve_own_request_at_any_stage(client):
    make_parcel(client, "PT-S1", 76.14)
    parts = [{"geometry": square(76.14, 12.0, 0.0005, 0.001)}, {"geometry": square(76.1405, 12.0, 0.0005, 0.001)}]
    r = client.post("/parcels/PT-S1/split-request", headers=hdr("super_admin", "sa-1"),
                    json={"parts": parts, "reason": "test", "requested_by": "Root"})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]
    assert client.post(f"/parcels/requests/{rid}/auditor-pass", headers=hdr("super_admin", "sa-1")).status_code == 403
    assert client.post(f"/parcels/requests/{rid}/auditor-pass", headers=hdr("super_admin", "sa-2")).status_code == 200
    assert client.post(f"/parcels/requests/{rid}/approve", headers=hdr("super_admin", "sa-1")).status_code == 403
    # sa-2 already approved at the auditor stage: the same account cannot approve twice on one request
    assert client.post(f"/parcels/requests/{rid}/approve", headers=hdr("super_admin", "sa-2")).status_code == 403
    assert client.post(f"/parcels/requests/{rid}/approve", headers=hdr("super_admin", "sa-3")).status_code == 200


def test_filer_cannot_fast_approve_own_correction(client):
    make_parcel(client, "PT-S2", 76.16)
    rid = correction(client, "PT-S2", "owner_name", "Asha Raoo", role="super_admin", uid="sa-1").json()["request_id"]
    assert client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("super_admin", "sa-1")).status_code == 403
    assert client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("auditor")).status_code == 200


# ---- archival, never deletion --------------------------------------------------------------

def test_deletion_archives_and_keeps_the_record(client):
    make_parcel(client, "PT-A1", 76.18)
    rid = client.post("/parcels/PT-A1/request-deletion", headers=hdr("state_admin")).json()["request_id"]
    assert client.post(f"/parcels/requests/{rid}/village-approve-deletion", headers=hdr("village_officer")).status_code == 200
    done = client.post(f"/parcels/requests/{rid}/auditor-approve-deletion", headers=hdr("auditor"))
    assert done.status_code == 200 and done.json()["status"] == "ARCHIVED"

    db = SessionLocal()
    row = db.query(Parcel).filter(Parcel.ulpin == "PT-A1").first()
    assert row is not None and row.status == "archived" and row.archived_at

    # gone from default views
    assert "PT-A1" not in [p["ulpin"] for p in client.get("/parcels", params={"state": "TamilNadu", "limit": 250}).json()]
    feats = client.get("/parcels/geojson/all", params={"state": "TamilNadu", "limit": 1000}).json()["features"]
    assert "PT-A1" not in [f["properties"]["ulpin"] for f in feats]
    assert client.get("/parcels/search", params={"q": "PT-A1"}).json() == []

    # still readable, with its status and history
    d = client.get("/parcels/PT-A1")
    assert d.status_code == 200 and d.json()["status"] == "archived" and d.json()["flags"] == []
    assert any("ARCHIVED" in str(e).upper() or "archived" in str(e) for e in
               client.get("/parcels/PT-A1/history", headers=hdr("citizen")).json()["events"])
    # and cannot be changed
    assert correction(client, "PT-A1", "owner_name", "Asha Raoo").status_code == 409


# ---- audit chain ---------------------------------------------------------------------------

def test_audit_chain_records_transitions_and_verifies(client):
    make_parcel(client, "PT-C1", 76.20)
    rid = correction(client, "PT-C1", "owner_name", "Asha Raoo").json()["request_id"]
    client.post(f"/parcels/requests/{rid}/fast-approve", headers=hdr("auditor"))
    body = client.get("/parcels/PT-C1/audit-chain").json()
    assert body["verified"] is True and body["broken_at"] is None
    events = [e["event"] for e in body["entries"]]
    assert "submitted" in events and events[-1] == "approved"
    assert [e["seq"] for e in body["entries"]] == list(range(1, len(events) + 1))
    assert body["entries"][0]["prev_hash"] == audit.GENESIS_HASH
    for a, b in zip(body["entries"], body["entries"][1:]):
        assert b["prev_hash"] == a["entry_hash"]
    assert all("email" not in e for e in body["entries"])  # roles only


def test_seeded_parcels_have_an_imported_first_entry(client):
    body = client.get("/parcels/TN-CHN-0042-1187/audit-chain").json()
    assert body["entries"][0]["event"] == "imported" and body["verified"] is True


def test_audit_log_rejects_update_and_delete(client):
    db = SessionLocal()
    for stmt in ("UPDATE parcel_audit_log SET note = 'x'", "DELETE FROM parcel_audit_log"):
        with pytest.raises(Exception):
            db.execute(text(stmt))
            db.commit()
        db.rollback()


def test_verify_detects_a_changed_entry(client):
    db = SessionLocal()
    rows = audit.chain(db, "PT-C1")
    assert audit.verify(rows)[0] is True

    class Tampered:
        def __init__(self, r, **over):
            for k in list(audit.CONTENT_FIELDS) + ["prev_hash", "entry_hash", "actor_ref"]:
                setattr(self, k, over.get(k, getattr(r, k)))

    forged = [Tampered(r) for r in rows]
    forged[1] = Tampered(rows[1], note="rewritten history")
    ok, at = audit.verify(forged)
    assert ok is False and at == rows[1].seq

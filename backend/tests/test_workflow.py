import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from conftest import insert_parcel
from fastapi.testclient import TestClient

from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import Parcel, BoundaryChangeRequest
from app.seed import seed_database
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def as_role(client, role):
    auth_mod.DEMO_LOGIN_ENABLED = True  # other test modules switch it off
    client.cookies.clear()
    tok = client.post("/auth/mock-login", json={"role": role}).json()["token"]
    client.cookies.clear()
    client.cookies.set("landsetu_session", tok)
    return client


def square(x, y, w=0.001, h=0.001):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]}


def make_parcel(c, ulpin, geom, owner="Asha Rao"):
    insert_parcel(ulpin, geom, owner)


def run_pipeline(c, request_id, village_first=False):
    if village_first:
        assert as_role(c, "village_officer").post(f"/parcels/requests/{request_id}/village-pass").status_code == 200
    assert as_role(c, "auditor").post(f"/parcels/requests/{request_id}/auditor-pass").status_code == 200
    return as_role(c, "state_admin").post(f"/parcels/requests/{request_id}/approve")


def test_split_pipeline(client):
    make_parcel(client, "WF-SPLIT", square(80.30, 13.20))
    left, right = square(80.30, 13.20, 0.0005, 0.001), square(80.3005, 13.20, 0.0005, 0.001)
    r = as_role(client, "village_officer").post("/parcels/WF-SPLIT/split-request", json={"parts": [{"geometry": left}, {"geometry": right}]})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]
    assert as_role(client, "citizen").post("/parcels/WF-SPLIT/split-request", json={"parts": []}).status_code == 403
    # cannot skip auditor: it is not the state admin's stage yet
    assert as_role(client, "state_admin").post(f"/parcels/requests/{rid}/approve").status_code == 403
    res = run_pipeline(client, rid)
    assert res.status_code == 200, res.text
    db = SessionLocal()
    src = db.query(Parcel).filter(Parcel.ulpin == "WF-SPLIT").first()
    assert src is not None and src.status == "superseded" and src.superseded_by  # kept, never deleted
    kids = db.query(Parcel).filter(Parcel.ulpin.in_(["WF-SPLIT-S1", "WF-SPLIT-S2"])).all()
    assert len(kids) == 2 and abs(sum(k.area_sqm for k in kids) - 1000) < 1
    assert kids[0].raw_record["lineage"]["split_from"] == "WF-SPLIT"
    db.close()


def test_split_rejects_bad_coverage(client):
    make_parcel(client, "WF-BAD", square(80.31, 13.21))
    r = as_role(client, "village_officer").post("/parcels/WF-BAD/split-request", json={"parts": [
        {"geometry": square(80.31, 13.21, 0.0002, 0.001)}, {"geometry": square(80.3105, 13.21, 0.0002, 0.001)}]})
    assert r.status_code == 422


def test_merge_pipeline(client):
    make_parcel(client, "WF-M1", square(80.32, 13.22))
    make_parcel(client, "WF-M2", square(80.321, 13.22))
    r = as_role(client, "village_officer").post("/parcels/WF-M1/merge-request", json={"merge_with": "WF-M2"})
    assert r.status_code == 200, r.text
    assert run_pipeline(client, r.json()["request_id"]).status_code == 200
    db = SessionLocal()
    other = db.query(Parcel).filter(Parcel.ulpin == "WF-M2").first()
    assert other is not None and other.status == "superseded" and other.superseded_by == "WF-M1"  # kept, never deleted
    m = db.query(Parcel).filter(Parcel.ulpin == "WF-M1").first()
    assert m.area_sqm == 2000
    db.close()


def test_merge_rejects_different_owner_and_non_adjacent(client):
    make_parcel(client, "WF-N1", square(80.33, 13.23), owner="Owner One")
    make_parcel(client, "WF-N2", square(80.331, 13.23), owner="Owner Two")
    make_parcel(client, "WF-N3", square(80.40, 13.30), owner="Owner One")
    vo = as_role(client, "village_officer")
    assert "owners differ" in vo.post("/parcels/WF-N1/merge-request", json={"merge_with": "WF-N2"}).json()["detail"]
    assert "share a boundary" in vo.post("/parcels/WF-N1/merge-request", json={"merge_with": "WF-N3"}).json()["detail"]


def test_citizen_correction_full_pipeline_and_history(client):
    make_parcel(client, "WF-C1", square(80.34, 13.24), owner="Wrong Name")
    r = as_role(client, "citizen").post("/parcels/WF-C1/correction-request", json={
        "layer": "ror", "field": "owner_name", "requested_value": "Right Name", "requested_by": "Right Name", "evidence": "Deed 44/2019"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PENDING_VILLAGE_REVIEW"
    rid = r.json()["request_id"]
    # auditor cannot act before the village officer
    assert as_role(client, "auditor").post(f"/parcels/requests/{rid}/auditor-pass").status_code == 400
    assert run_pipeline(client, rid, village_first=True).status_code == 200
    d = as_role(client, "citizen").get("/parcels/WF-C1").json()
    assert d["layers"]["ror"]["owner_name"] == "Right Name"
    hist = as_role(client, "citizen").get("/parcels/WF-C1/history").json()["events"]
    titles = " | ".join(e["title"] for e in hist)
    assert "Correction requested" in titles and "approved" in titles
    assert as_role(client, "citizen").post("/parcels/WF-C1/correction-request", json={
        "layer": "tax", "field": "annual_value", "requested_value": "1", "requested_by": "x"}).status_code == 422


def test_search_by_owner_khata_ulpin(client):
    make_parcel(client, "WF-S1", square(80.35, 13.25), owner="Zubin Merchant")
    c = as_role(client, "citizen")
    hits = c.get("/parcels/search", params={"q": "zubin"}).json()
    assert any(h["ulpin"] == "WF-S1" and h["matched_on"] == "owner" for h in hits)
    assert any(h["ulpin"] == "WF-S1" for h in c.get("/parcels/search", params={"q": "WF-S1"}).json())
    assert c.get("/parcels/search", params={"q": "KH-MANUAL-F-S1"}).json()  # khata from custom create
    assert c.get("/parcels/search", params={"q": "100%"}).json() == []  # wildcard is escaped


def test_analytics_admin_only(client):
    assert as_role(client, "citizen").get("/parcels/analytics/summary").status_code == 403
    data = as_role(client, "state_admin").get("/parcels/analytics/summary").json()
    assert data["totals"]["total_parcels"] >= 17
    tn = next(s for s in data["states"] if s["state"] == "TamilNadu")
    assert 0 <= tn["flagged_rate"] <= 1 and "pending_requests" in tn and "encumbrance_rate" in tn

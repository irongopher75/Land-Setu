import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import ParcelIntelligence
from app.seed import seed_database
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:   # startup plants the fixtures
        yield c


def hdr(role, uid=None):
    return {"Authorization": f"Bearer {auth_mod.create_jwt_token(role, uid or f'u-{role}')}"}


def signals(c, ulpin):
    r = c.get(f"/parcels/{ulpin}/intelligence", headers=hdr("auditor"))
    assert r.status_code == 200, r.text
    return r.json()


def test_citizens_and_visitors_cannot_read_signals(client):
    assert client.get("/parcels/TN-KPM-0107-2007/intelligence").status_code == 401
    assert client.get("/parcels/TN-KPM-0107-2007/intelligence", headers=hdr("citizen")).status_code == 403


@pytest.mark.parametrize("ulpin,pattern", [
    ("TN-KPM-0107-2007", "rapid_retransfer"), ("TN-KPM-0107-2003", "name_repetition"),
    ("TN-KPM-0107-2019", "lien_timing"), ("TN-CHN-0051-3301", "backdating"), ("TN-CHN-0051-3302", "backdating"),
])
def test_planted_fixtures_are_detected_with_evidence(client, ulpin, pattern):
    body = signals(client, ulpin)
    hit = [f for f in body["fraud_patterns"] if f["pattern"] == pattern]
    assert hit and hit[0]["evidence"] and hit[0]["summary"]
    assert body["synthetic_fixture"]  # planted fixtures say so


def test_zoning_fixture_and_its_explanation(client):
    body = signals(client, "TN-KPM-0107-2013")
    assert body["zoning"]["anomaly"] is True and "residential" in body["zoning"]["explanation"]


def test_seed_parcels_raise_no_false_patterns(client):
    for u in ("TN-CHN-0042-1187", "TN-CHN-0042-1190", "CHD-SEC-0017-0201"):
        assert signals(client, u)["fraud_patterns"] == []


def test_results_are_cached_and_invalidated_by_a_write(client):
    signals(client, "TN-KPM-0107-2001")
    db = SessionLocal()
    first = db.query(ParcelIntelligence).filter_by(ulpin="TN-KPM-0107-2001").one().computed_at
    signals(client, "TN-KPM-0107-2001")
    db.expire_all()
    assert db.query(ParcelIntelligence).filter_by(ulpin="TN-KPM-0107-2001").one().computed_at == first  # read hit
    r = client.post("/parcels/TN-KPM-0107-2002/correction-request", headers=hdr("citizen", "c-1"),
                    json={"layer": "zoning", "field": "land_use", "requested_value": "commercial", "requested_by": "T"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(ParcelIntelligence).filter_by(ulpin="TN-KPM-0107-2001").one().stale is True    # same state
    signals(client, "TN-KPM-0107-2001")
    db.expire_all()
    assert db.query(ParcelIntelligence).filter_by(ulpin="TN-KPM-0107-2001").one().stale is False


def test_admin_summary(client):
    assert client.get("/parcels/analytics/intelligence", headers=hdr("auditor")).status_code == 403
    s = client.get("/parcels/analytics/intelligence", headers=hdr("state_admin")).json()
    assert s["patterns"]["name_repetition"] == 5 and s["zoning_anomalies"] >= 1
    assert s["with_fraud_patterns"] >= 9 and all(t["synthetic_fixture"] for t in s["top"])

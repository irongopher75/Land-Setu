import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

from fastapi.testclient import TestClient

from app.main import app
import app.routes.auth as auth_mod


def test_bearer_header_is_accepted_without_a_cookie():
    auth_mod.DEMO_LOGIN_ENABLED = True
    with TestClient(app) as c:
        tok = c.post("/auth/mock-login", json={"role": "state_admin"}).json()["token"]
        c.cookies.clear()
        assert c.get("/parcels/analytics/summary").status_code == 401
        ok = c.get("/parcels/analytics/summary", headers={"Authorization": f"Bearer {tok}"})
        assert ok.status_code == 200


def test_search_is_public():
    with TestClient(app) as c:
        c.cookies.clear()
        r = c.get("/parcels/search", params={"q": "TN-CHN"})
        assert r.status_code == 200 and isinstance(r.json(), list)


def test_parcel_detail_is_public_with_citizen_fields():
    with TestClient(app) as c:
        c.cookies.clear()
        r = c.get("/parcels/TN-CHN-0042-1187")
        assert r.status_code == 200
        body = r.json()
        assert body["raw_record"] is None  # citizen view hides the raw source record
        assert c.get("/parcels/TN-CHN-0042-1187", headers={"Authorization": "Bearer not-a-token"}).status_code == 401

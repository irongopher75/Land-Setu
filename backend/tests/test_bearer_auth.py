import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")

from fastapi.testclient import TestClient

from app.main import app
import app.routes.auth as auth_mod
from conftest import insert_parcel, pg_citizen_headers


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


def test_parcel_detail_requires_a_session():
    # Parcel reads are no longer public (docs/rbac-migration-plan.md Part B item 7) — anonymous and a
    # garbage bearer token are both 401, same as any other retrofitted read path.
    with TestClient(app) as c:
        c.cookies.clear()
        assert c.get("/parcels/TN-CHN-0042-1187").status_code == 401
        assert c.get("/parcels/TN-CHN-0042-1187", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_parcel_detail_shows_citizen_fields_to_the_owning_citizen():
    insert_parcel("BEARER-CIT-1", {"type": "Polygon", "coordinates": [[[80.0, 13.0], [80.001, 13.0], [80.001, 13.001], [80.0, 13.001], [80.0, 13.0]]]})
    headers = pg_citizen_headers("BEARER-CIT-1")
    with TestClient(app) as c:
        r = c.get("/parcels/BEARER-CIT-1", headers=headers)
        assert r.status_code == 200
        assert r.json()["raw_record"] is None  # citizen view hides the raw source record

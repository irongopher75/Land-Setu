import os
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box

# Set required environment variables before importing app
os.environ["JWT_SECRET"] = "test_secret_key_minimum_32_chars_long_for_security_test"
os.environ["DEMO_LOGIN_ENABLED"] = "false"
os.environ["ALLOW_SQLITE_FALLBACK"] = "true"

from app.db import engine, Base
from app.seed import seed_database
from app.main import app
from app.states import detect_state_from_coords
from app.rules import compute_geodesic_area_sqm

@pytest.fixture(autouse=True, scope="module")
def init_db():
    Base.metadata.create_all(bind=engine)
    seed_database()

client = TestClient(app)

def test_root_and_health_check():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "online"

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"

def test_mock_login_gating_disabled():
    """Verify mock-login raises 404 Not Found when DEMO_LOGIN_ENABLED=False."""
    os.environ["DEMO_LOGIN_ENABLED"] = "false"
    import app.routes.auth as auth_mod
    auth_mod.DEMO_LOGIN_ENABLED = False

    res = client.post("/auth/mock-login", json={"role": "state_admin"})
    assert res.status_code == 404
    assert res.json()["detail"] == "Not Found"

def test_mock_login_enabled():
    """Verify mock-login works when DEMO_LOGIN_ENABLED=True."""
    import app.routes.auth as auth_mod
    auth_mod.DEMO_LOGIN_ENABLED = True

    res = client.post("/auth/mock-login", json={"role": "village_officer"})
    assert res.status_code == 200
    assert res.json()["role"] == "village_officer"
    assert "token" in res.json()
    assert "landsetu_session" in res.cookies

    # Reset
    auth_mod.DEMO_LOGIN_ENABLED = False

def test_spatial_state_detection():
    """Verify precise Shapely Point-in-Polygon state matching."""
    # TamilNadu interior point (lat=12.5, lng=78.5)
    st1 = detect_state_from_coords(12.5, 78.5)
    assert st1 and st1["name"] == "TamilNadu"
    # Chandigarh interior point (lat=30.73, lng=76.75)
    st2 = detect_state_from_coords(30.73, 76.75)
    assert st2 and st2["name"] == "Chandigarh"
    # Maharashtra interior point (lat=19.0, lng=74.0)
    st3 = detect_state_from_coords(19.0, 74.0)
    assert st3 and st3["name"] == "Maharashtra"

def test_geodesic_area_calculation():
    """Verify geodesic area scaling formula with cos(latitude)."""
    # 0.001 deg x 0.001 deg box near Chennai (13.08 deg N)
    test_box = box(80.270, 13.080, 80.271, 13.081)
    area = compute_geodesic_area_sqm(test_box)
    assert 11000 < area < 12500

def test_protected_zones_api():
    res = client.get("/parcels/protected-zones/geojson?state=TamilNadu")
    assert res.status_code == 200
    data = res.json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data

def test_district_hierarchy_metadata():
    """Verify district-level granularity ('one city + one village per state/UT')."""
    from app.states import INDIAN_STATES
    tn = next(s for s in INDIAN_STATES if s["name"] == "TamilNadu")
    assert "urban_city" in tn and tn["urban_city"]["name"] == "Chennai Metropolitan Corp"
    assert "rural_village" in tn and tn["rural_village"]["name"] == "Nemili Revenue Village"

def test_adapter_preview_api():
    """Verify schema adapter normalization engine across state formats."""
    raw_tn = {
        "pattadar_peyar": "R. Kannan",
        "khatha_num": "KH-1187",
        "extent_hectares": "0.0452",
        "patta_type": "record_of_rights",
        "transaction_ref": "REG-2019-88213",
        "transaction_date": "2019-03-14",
        "land_use_code": "residential",
        "fsi_permitted": "1.5"
    }
    res = client.post("/adapter/preview", json={"state": "TamilNadu", "raw_record": raw_tn})
    assert res.status_code == 200
    canonical = res.json()["canonical"]
    assert canonical["layers"]["ror"]["owner_name"] == "R. Kannan"
    assert canonical["area_sqm"] == 452.0

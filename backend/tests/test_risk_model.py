import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app
from app.seed import seed_database
from app.intelligence.features import FEATURES, feature_row, held_out_label
from app.intelligence.risk import load_model, CAVEAT
import app.routes.auth as auth_mod


def parcel(owner="A. Rao", buyer="A. Rao", created="2024-01-15T00:00:00+00:00"):
    return SimpleNamespace(layers={"ror": {"owner_name": owner}, "registration": {"buyer_name": buyer}}, created_at=created)


def test_features_cannot_read_the_label():
    p = parcel(owner="A. Rao", buyer="B. Iyer")
    rules = [{"rule": "ownership_mismatch", "flag": True}, {"rule": "active_encumbrance", "flag": True}]
    rejected = [{"type": "BOUNDARY", "status": "REJECTED"}]
    row = feature_row(p, rules, [], False, [], [], rejected)
    assert row["rule_flag_count"] == 1                 # ownership mismatch excluded
    assert row["boundary_edits_applied"] == 0          # rejected edits do not count
    assert held_out_label(p, rejected) == 1 and held_out_label(parcel(), []) == 0
    assert set(row) == set(FEATURES)


def test_saved_model_loads_and_says_what_it_is():
    m = load_model()
    assert m is not None and m.b["features"] == FEATURES and m.b["positives"] >= 1
    assert "warning" in m.b["validation"] and "leave-one-out" in m.b["validation"]["method"]
    assert m.importances()[0]["feature"] in FEATURES


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def test_risk_score_is_withheld_by_default(client):
    h = {"Authorization": f"Bearer {auth_mod.create_jwt_token('auditor', 'a-risk')}"}
    body = client.get("/parcels/TN-KPM-0107-2019/intelligence", headers=h).json()
    assert body["risk"] is None and "5C" in body["risk_status"]


def test_model_still_scores_with_explanation_and_caveat(client):
    """The model works; it is only withheld from display."""
    from app.db import SessionLocal
    from app.models import Parcel
    from app.intelligence.features import FEATURES as F
    m = load_model()
    db = SessionLocal()
    p = db.query(Parcel).filter_by(ulpin="TN-KPM-0107-2019").one()
    score, factors = m.score(db, p, [], False, [], [{"cleared_at": None}], [])
    assert 0 <= score <= 1 and factors["caveat"] == CAVEAT and set(factors["features"]) == set(F)

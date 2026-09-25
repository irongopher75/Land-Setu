import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import security


@pytest.fixture()
def client(monkeypatch):
    from app.db import Base, engine
    from app.seed import seed_database
    Base.metadata.create_all(bind=engine)
    seed_database()
    monkeypatch.setenv("RATE_LIMIT_DISABLED", "false")
    security.reset_rate_limits()
    with TestClient(app) as c:
        yield c
    security.reset_rate_limits()


def test_security_headers_on_every_response(client):
    r = client.get("/parcels/states/all")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["referrer-policy"] == "no-referrer"


def test_auth_responses_are_not_cached(client):
    assert client.post("/auth/logout").headers["cache-control"] == "no-store"


def test_auth_endpoints_are_rate_limited(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_AUTH", "5")
    codes = [client.post("/auth/firebase-login", json={"id_token": "x"}).status_code for _ in range(8)]
    assert 429 not in codes[:5] and codes[5:] == [429] * 3  # the first five reach the handler, whatever it answers
    limited = client.post("/auth/firebase-login", json={"id_token": "x"})
    assert int(limited.headers["retry-after"]) > 0


def test_health_is_never_limited(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_READ", "2")
    assert all(client.get("/health").status_code == 200 for _ in range(6))


def test_oversized_body_is_refused(client):
    r = client.post("/adapter/preview", content=b"x" * 1_100_000, headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_readiness_checks_the_database(client):
    assert client.get("/health/ready").json() == {"status": "ready"}


def test_mock_login_is_closed_in_production_even_if_enabled(monkeypatch):
    import app.routes.auth as auth_mod
    monkeypatch.setattr(auth_mod, "DEMO_LOGIN_ENABLED", True)
    monkeypatch.setenv("ENVIRONMENT", "production")
    with TestClient(app) as c:
        assert c.post("/auth/mock-login", json={"role": "state_admin"}).status_code == 404


def test_mock_login_never_mints_super_admin(monkeypatch):
    import app.routes.auth as auth_mod
    monkeypatch.setattr(auth_mod, "DEMO_LOGIN_ENABLED", True)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with TestClient(app) as c:
        assert c.post("/auth/mock-login", json={"role": "super_admin"}).json()["role"] == "citizen"


def test_api_refuses_to_start_without_a_strong_jwt_secret():
    import subprocess, sys
    env = {k: v for k, v in os.environ.items() if k != "JWT_SECRET"}
    for bad in (None, "short"):
        if bad:
            env["JWT_SECRET"] = bad
        r = subprocess.run([sys.executable, "-c", "import app.routes.auth"], env=env, capture_output=True, text=True,
                           cwd=os.path.dirname(os.path.dirname(__file__)))
        assert r.returncode != 0 and "JWT_SECRET must be set" in r.stderr


# ---- audit round 2 -------------------------------------------------------------------------

def _hdr(role, uid):
    import app.routes.auth as auth_mod
    return {"Authorization": f"Bearer {auth_mod.create_jwt_token(role, uid)}"}


def test_cookie_only_cross_site_post_is_refused(client):
    import app.routes.auth as auth_mod
    client.cookies.set("landsetu_session", auth_mod.create_jwt_token("auditor", "aud-csrf"))
    r = client.post("/parcels/requests/1/auditor-pass", headers={"Origin": "https://attacker.example"})
    assert r.status_code == 403 and "Cross-site" in r.json()["detail"]
    assert client.post("/parcels/requests/1/auditor-pass").status_code == 403           # no Origin, no Referer
    ok = client.post("/parcels/requests/999999/auditor-pass", headers={"Origin": "https://landsetu-e4e5e.web.app"})
    assert ok.status_code != 403 or "Cross-site" not in ok.text                          # own site passes the check
    client.cookies.clear()
    bearer = client.post("/parcels/requests/999999/auditor-pass", headers={**_hdr("auditor", "a"), "Origin": "https://attacker.example"})
    assert "Cross-site" not in bearer.text                                                # bearer is not sent by browsers


def test_spoofed_forwarded_for_does_not_escape_the_rate_limit(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_AUTH", "3")
    codes = [client.post("/auth/firebase-login", json={"id_token": "x"}, headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code
             for i in range(6)]
    assert codes[3:] == [429, 429, 429]


def test_cloudflare_client_ip_is_the_rate_limit_key(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_AUTH", "2")
    a = [client.post("/auth/logout", headers={"CF-Connecting-IP": "203.0.113.1"}).status_code for _ in range(3)]
    b = client.post("/auth/logout", headers={"CF-Connecting-IP": "203.0.113.2"}).status_code
    assert a[2] == 429 and b != 429


def test_refresh_tokens_are_retired(client):
    assert client.post("/auth/refresh").status_code == 410


def test_session_issued_before_a_role_change_is_refused(client):
    from datetime import datetime, timedelta, timezone
    from app.db import SessionLocal
    from app.models import RoleAudit
    h = _hdr("state_admin", "demote-me")
    assert client.get("/parcels/analytics/summary", headers=h).status_code == 200
    db = SessionLocal()
    db.add(RoleAudit(at=(datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(), actor_uid="root",
                     target_uid="demote-me", action="set_role", old_role="state_admin", new_role="citizen"))
    db.commit()
    r = client.get("/parcels/analytics/summary", headers=h)
    assert r.status_code == 401 and "Sign in again" in r.json()["detail"]


def test_bank_sees_clearance_only(client):
    body = client.get("/parcels/TN-CHN-0042-1189", headers=_hdr("bank", "bank-1")).json()
    assert set(body["layers"]) == {"encumbrance"} and body["raw_record"] is None
    assert "geometry" not in body and all(set(f) == {"rule", "flag"} for f in body["flags"])
    assert client.get("/parcels/requests/pending", headers=_hdr("bank", "bank-1")).status_code == 403


def test_one_citizen_cannot_flood_the_queue(client):
    codes = [client.post(f"/parcels/TN-KPM-0107-20{n:02d}/correction-request", headers=_hdr("citizen", "flooder"),
                         json={"layer": "zoning", "field": "land_use", "requested_value": "industrial", "requested_by": "x"}).status_code
             for n in range(1, 9)]
    assert codes.count(200) == 5 and codes[-2:] == [429, 429]  # a 409 (duplicate) may appear among them


def test_pending_list_never_exposes_account_ids(client):
    rows = client.get("/parcels/requests/pending", headers=_hdr("auditor", "aud-x")).json()
    assert all("uid" not in h for r in rows for h in r["history"])


def test_citizen_history_hides_other_peoples_request_text(client):
    events = client.get("/parcels/TN-KPM-0107-2001/history", headers=_hdr("citizen", "nosy")).json()["events"]
    assert all(e["detail"] == "" for e in events if e["kind"] == "request")


def test_docs_ui_is_off_in_production():
    import subprocess, sys
    code = ("import os; os.environ['ENVIRONMENT']='production'\n"
            "from fastapi.testclient import TestClient\nfrom app.main import app\n"
            "c=TestClient(app); print(c.get('/docs').status_code, c.get('/openapi.json').status_code)")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env={**os.environ, "RATE_LIMIT_DISABLED": "true"},
                       cwd=os.path.dirname(os.path.dirname(__file__)))
    assert r.stdout.strip().endswith("404 200"), r.stderr[-400:]

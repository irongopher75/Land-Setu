import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import security


@pytest.fixture()
def client(monkeypatch):
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

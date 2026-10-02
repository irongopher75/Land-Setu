import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("DEMO_LOGIN_ENABLED", "false")

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import AdminUnit, Citizen, OfficerAssignment, RefreshToken, User
from app.password import hash_password

PREFIX = "PGLOGIN-"


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=engine)
    s = SessionLocal()
    yield s
    s.query(RefreshToken).filter(RefreshToken.user_id.in_(
        s.query(User.id).filter(User.username.like(f"{PREFIX}%"))
    )).delete(synchronize_session=False)
    s.query(OfficerAssignment).filter(OfficerAssignment.user_id.in_(
        s.query(User.id).filter(User.username.like(f"{PREFIX}%"))
    )).delete(synchronize_session=False)
    s.query(Citizen).filter(Citizen.citizen_uid.like(f"{PREFIX}%")).delete(synchronize_session=False)
    s.query(User).filter(User.username.like(f"{PREFIX}%")).delete(synchronize_session=False)
    s.query(AdminUnit).filter(AdminUnit.slug.like(f"{PREFIX.lower()}%")).delete(synchronize_session=False)
    s.commit()
    s.close()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _mk_admin_unit(db, slug):
    u = AdminUnit(level="village", name=slug, slug=slug, path=slug)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_officer(db, username, password, role="village_officer", with_assignment=True, active=True):
    user = User(username=username, user_type="officer", password_hash=hash_password(password),
                is_active=active, created_at=datetime.now(timezone.utc).isoformat())
    db.add(user)
    db.commit()
    db.refresh(user)
    if with_assignment:
        unit = _mk_admin_unit(db, f"{PREFIX.lower()}{user.id}")
        db.add(OfficerAssignment(user_id=user.id, role=role, admin_unit_id=unit.id,
                                  valid_from=datetime.now(timezone.utc).isoformat(), valid_to=None))
        db.commit()
    return user


def _mk_citizen(db, citizen_uid, password, active=True):
    user = User(username=None, user_type="citizen", password_hash=hash_password(password),
                is_active=active, created_at=datetime.now(timezone.utc).isoformat())
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(Citizen(citizen_uid=citizen_uid, user_id=user.id, name="Test Citizen", masked_display="XXXX-1234"))
    db.commit()
    return user


# --- officer login ---------------------------------------------------------

def test_officer_login_succeeds_and_issues_session(db, client):
    _mk_officer(db, f"{PREFIX}alice", "correct horse battery staple")
    r = client.post("/auth/login", json={"username": f"{PREFIX}alice", "password": "correct horse battery staple"})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body and body["user_id"]
    assert "landsetu_pg_session" in r.cookies


def test_officer_login_rejects_wrong_password(db, client):
    _mk_officer(db, f"{PREFIX}bob", "correct horse battery staple")
    r = client.post("/auth/login", json={"username": f"{PREFIX}bob", "password": "wrong"})
    assert r.status_code == 401


def test_officer_login_rejects_unknown_username(client):
    r = client.post("/auth/login", json={"username": f"{PREFIX}nobody", "password": "x"})
    assert r.status_code == 401


def test_officer_login_rejects_inactive_account(db, client):
    _mk_officer(db, f"{PREFIX}carol", "correct horse battery staple", active=False)
    r = client.post("/auth/login", json={"username": f"{PREFIX}carol", "password": "correct horse battery staple"})
    assert r.status_code == 401


def test_officer_login_rejects_account_with_no_assignment(db, client):
    _mk_officer(db, f"{PREFIX}dave", "correct horse battery staple", with_assignment=False)
    r = client.post("/auth/login", json={"username": f"{PREFIX}dave", "password": "correct horse battery staple"})
    assert r.status_code == 403


def test_officer_login_locks_after_repeated_failures(db, client):
    _mk_officer(db, f"{PREFIX}erin", "correct horse battery staple")
    for _ in range(5):
        client.post("/auth/login", json={"username": f"{PREFIX}erin", "password": "wrong"})
    r = client.post("/auth/login", json={"username": f"{PREFIX}erin", "password": "correct horse battery staple"})
    assert r.status_code == 423


# --- citizen login -----------------------------------------------------------

def test_citizen_login_succeeds(db, client):
    _mk_citizen(db, f"{PREFIX}900000000003", "correct horse battery staple")
    r = client.post("/auth/citizen-login", json={"citizen_uid": f"{PREFIX}900000000003", "password": "correct horse battery staple"})
    assert r.status_code == 200
    assert r.json()["user_id"]


def test_citizen_login_rejects_wrong_password(db, client):
    _mk_citizen(db, f"{PREFIX}900000000004", "correct horse battery staple")
    r = client.post("/auth/citizen-login", json={"citizen_uid": f"{PREFIX}900000000004", "password": "wrong"})
    assert r.status_code == 401


def test_citizen_login_rejects_unknown_uid(client):
    r = client.post("/auth/citizen-login", json={"citizen_uid": f"{PREFIX}nope", "password": "x"})
    assert r.status_code == 401


# --- forged-token test (item 6) ----------------------------------------------

def test_forged_role_claim_is_ignored_by_the_new_session_path(db, client):
    """A session token for this path carries no role at all, so there is nothing for a forged role claim
    to override — this test proves that by forging one directly onto a decoded token and confirming
    app.session.decode_session_token ignores the extra claim entirely (it isn't read anywhere)."""
    import jwt as pyjwt
    from app.session import ALGORITHM, SECRET_KEY, decode_session_token

    user = _mk_officer(db, f"{PREFIX}forge", "correct horse battery staple")
    now = datetime.now(timezone.utc)
    import uuid
    from app.models import RefreshToken
    session_id = str(uuid.uuid4())
    db.add(RefreshToken(session_id=session_id, user_id=user.id,
                         token_hash="irrelevant-for-this-test",
                         issued_at=now.isoformat(), expires_at=(now + timedelta(minutes=30)).isoformat(),
                         revoked_at=None))
    db.commit()
    forged = pyjwt.encode(
        {"sub": str(user.id), "session_id": session_id, "iat": now, "exp": now + timedelta(minutes=30),
         "role": "super_admin", "scope": "country"},
        SECRET_KEY, algorithm=ALGORITHM,
    )
    resolved_user_id = decode_session_token(db, forged)
    assert resolved_user_id == user.id

    from app.authz import load_context_for_user
    ctx = load_context_for_user(db, resolved_user_id)
    assert ctx.role == "village_officer"  # the real, Postgres-loaded role — never "super_admin"

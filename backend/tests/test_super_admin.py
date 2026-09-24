import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app
from app.seed import seed_database
import app.routes.auth as auth_mod
import app.routes.admin as admin_mod


class FakeUser:
    def __init__(self, uid, email, role=None, disabled=False):
        self.uid, self.email, self.display_name, self.disabled = uid, email, None, disabled
        self.custom_claims = {"role": role} if role else None
        self.user_metadata = None


class FakePage:
    def __init__(self, users):
        self.users = users

    def get_next_page(self):
        return None


class FakeAuth:
    """Stands in for firebase_admin.auth."""
    def __init__(self):
        self.users = {
            "sa1": FakeUser("sa1", "root@example.test", "super_admin"),
            "o1": FakeUser("o1", "officer@example.test", "village_officer"),
        }
        self.revoked = []

    def list_users(self):
        return FakePage(list(self.users.values()))

    def get_user(self, uid):
        if uid not in self.users:
            raise KeyError(uid)
        return self.users[uid]

    def create_user(self, email, password, display_name=None, email_verified=True):
        u = FakeUser(f"new{len(self.users)}", email)
        self.users[u.uid] = u
        return u

    def set_custom_user_claims(self, uid, claims):
        self.users[uid].custom_claims = claims

    def update_user(self, uid, disabled=None):
        self.users[uid].disabled = disabled

    def revoke_refresh_tokens(self, uid):
        self.revoked.append(uid)


@pytest.fixture()
def env(monkeypatch):
    Base.metadata.create_all(bind=engine)
    seed_database()
    fake = FakeAuth()
    monkeypatch.setattr(admin_mod, "_firebase_auth", lambda: fake)
    with TestClient(app) as c:
        yield c, fake


def token(role, uid):
    return auth_mod.create_jwt_token(role, uid)


def hdr(role, uid):
    return {"Authorization": f"Bearer {token(role, uid)}"}


def test_only_super_admin_can_manage_accounts(env):
    c, _ = env
    for role in ("citizen", "village_officer", "auditor", "state_admin"):
        assert c.get("/admin/users", headers=hdr(role, "x")).status_code == 403
    assert c.get("/admin/users").status_code == 401
    assert c.get("/admin/users", headers=hdr("super_admin", "sa1")).status_code == 200


def test_assign_role_and_audit(env):
    c, fake = env
    r = c.put("/admin/users/o1/role", json={"role": "auditor"}, headers=hdr("super_admin", "sa1"))
    assert r.status_code == 200 and r.json()["role"] == "auditor"
    assert fake.users["o1"].custom_claims == {"role": "auditor"} and "o1" in fake.revoked
    log = c.get("/admin/audit", headers=hdr("super_admin", "sa1")).json()
    assert log[0]["action"] == "set_role" and log[0]["old_role"] == "village_officer" and log[0]["new_role"] == "auditor"


def test_invalid_role_rejected(env):
    c, _ = env
    assert c.put("/admin/users/o1/role", json={"role": "emperor"}, headers=hdr("super_admin", "sa1")).status_code == 422
    assert c.put("/admin/users/o1/role", json={"role": "officer"}, headers=hdr("super_admin", "sa1")).status_code == 422


def test_cannot_change_own_role_or_remove_last_super_admin(env):
    c, fake = env
    assert c.put("/admin/users/sa1/role", json={"role": "citizen"}, headers=hdr("super_admin", "sa1")).status_code == 409
    # a second super admin acts on the first: the first is then not the last one only if another remains
    fake.users["sa2"] = FakeUser("sa2", "second@example.test", "super_admin")
    ok = c.put("/admin/users/sa1/role", json={"role": "citizen"}, headers=hdr("super_admin", "sa2"))
    assert ok.status_code == 200
    last = c.put("/admin/users/sa2/role", json={"role": "citizen"}, headers=hdr("super_admin", "sa1"))
    assert last.status_code == 409


def test_create_account_returns_one_time_password(env):
    c, fake = env
    r = c.post("/admin/users", json={"email": "new.officer@example.test", "role": "auditor"}, headers=hdr("super_admin", "sa1"))
    assert r.status_code == 201
    body = r.json()
    assert body["role"] == "auditor" and len(body["temporary_password"]) >= 8
    assert c.post("/admin/users", json={"email": "bad", "role": "auditor"}, headers=hdr("super_admin", "sa1")).status_code == 422


def test_disable_blocks_self_and_last_super_admin(env):
    c, fake = env
    assert c.put("/admin/users/sa1/disabled", json={"disabled": True}, headers=hdr("super_admin", "sa1")).status_code == 409
    assert c.put("/admin/users/o1/disabled", json={"disabled": True}, headers=hdr("super_admin", "sa1")).status_code == 200
    assert fake.users["o1"].disabled is True


def test_super_admin_passes_every_role_gate(env):
    c, _ = env
    h = hdr("super_admin", "sa1")
    assert c.get("/parcels/analytics/summary", headers=h).status_code == 200
    assert c.get("/parcels/requests/pending", headers=h).status_code == 200
    assert c.get("/parcels/TN-CHN-0042-1187/passport", headers=h).status_code == 200
    assert c.get("/parcels/analytics/summary", headers=hdr("auditor", "a1")).status_code == 403
    d = c.get("/parcels/TN-CHN-0042-1187", headers=h).json()
    assert d["raw_record"] is not None  # full record, not the citizen view

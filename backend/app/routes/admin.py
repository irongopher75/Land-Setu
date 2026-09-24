"""Account and role administration. Super administrators only.

Roles live in the `role` custom claim on each Firebase account. The API reads that claim at sign-in
(app/routes/auth.py), so changing the claim here changes what the account can do the next time it
signs in. A LandSetu session already issued keeps its old role until it expires (30 minutes).
"""
import json
import os
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import RoleAudit
from app.routes.auth import ASSIGNABLE_ROLES, get_current_payload, require_roles

router = APIRouter(prefix="/admin", tags=["Administration"])


def _firebase_auth():
    """The Firebase Admin auth module, initialised on first use."""
    try:
        import firebase_admin
        from firebase_admin import auth, credentials
        if not firebase_admin._apps:
            key = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
            if not key:
                raise RuntimeError("no service account")
            firebase_admin.initialize_app(credentials.Certificate(json.loads(key)))
        return auth
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Account management needs the Firebase service account key set on the server (FIREBASE_SERVICE_ACCOUNT_JSON).",
        )


def _role_of(user) -> str:
    role = (user.custom_claims or {}).get("role")
    return role if role in ASSIGNABLE_ROLES else "citizen"


def _view(user) -> dict:
    last = user.user_metadata.last_sign_in_timestamp if user.user_metadata else None
    return {
        "uid": user.uid,
        "email": user.email,
        "display_name": user.display_name,
        "role": _role_of(user),
        "disabled": bool(user.disabled),
        "last_sign_in": datetime.fromtimestamp(last / 1000, tz=timezone.utc).isoformat() if last else None,
    }


def _log(db: Session, actor: dict, fb, target, action: str, old: Optional[str], new: Optional[str]):
    actor_email = None
    try:
        actor_email = fb.get_user(actor["sub"]).email
    except Exception:
        pass
    db.add(RoleAudit(
        at=datetime.now(timezone.utc).isoformat(), actor_uid=actor["sub"], actor_email=actor_email,
        target_uid=target.uid, target_email=target.email, action=action, old_role=old, new_role=new,
    ))
    db.commit()


def _super_admins(fb, exclude_uid: str) -> int:
    n = 0
    page = fb.list_users()
    while page:
        for u in page.users:
            if u.uid != exclude_uid and not u.disabled and _role_of(u) == "super_admin":
                n += 1
        page = page.get_next_page()
    return n


class CreateUser(BaseModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    display_name: Optional[str] = Field(default=None, max_length=120)
    role: str


class SetRole(BaseModel):
    role: str


class SetDisabled(BaseModel):
    disabled: bool


def _check_role(role: str):
    if role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of: {', '.join(ASSIGNABLE_ROLES)}")


@router.get("/users")
def list_users(role: str = Depends(require_roles("super_admin"))):
    fb = _firebase_auth()
    out = []
    page = fb.list_users()
    while page and len(out) < 1000:
        out.extend(_view(u) for u in page.users)
        page = page.get_next_page()
    return sorted(out, key=lambda u: (u["email"] or ""))


@router.post("/users", status_code=201)
def create_user(body: CreateUser, actor: dict = Depends(get_current_payload), role: str = Depends(require_roles("super_admin")),
                db: Session = Depends(get_db)):
    _check_role(body.role)
    fb = _firebase_auth()
    password = secrets.token_urlsafe(9)
    try:
        user = fb.create_user(email=body.email, password=password, display_name=body.display_name, email_verified=True)
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"Could not create the account: {getattr(e, 'code', 'error')}")
    fb.set_custom_user_claims(user.uid, {"role": body.role})
    _log(db, actor, fb, user, "create", None, body.role)
    return {**_view(fb.get_user(user.uid)), "temporary_password": password}


@router.put("/users/{uid}/role")
def set_role(uid: str, body: SetRole, actor: dict = Depends(get_current_payload),
             role: str = Depends(require_roles("super_admin")), db: Session = Depends(get_db)):
    _check_role(body.role)
    if uid == actor["sub"]:
        raise HTTPException(status_code=409, detail="You cannot change your own role. Ask another super administrator.")
    fb = _firebase_auth()
    try:
        user = fb.get_user(uid)
    except Exception:
        raise HTTPException(status_code=404, detail="Account not found")
    old = _role_of(user)
    if old == "super_admin" and body.role != "super_admin" and _super_admins(fb, uid) < 1:
        raise HTTPException(status_code=409, detail="This is the last super administrator. Assign another one first.")
    fb.set_custom_user_claims(uid, {"role": body.role})
    fb.revoke_refresh_tokens(uid)  # forces the account to sign in again and pick up the new role
    _log(db, actor, fb, user, "set_role", old, body.role)
    return _view(fb.get_user(uid))


@router.put("/users/{uid}/disabled")
def set_disabled(uid: str, body: SetDisabled, actor: dict = Depends(get_current_payload),
                 role: str = Depends(require_roles("super_admin")), db: Session = Depends(get_db)):
    if uid == actor["sub"]:
        raise HTTPException(status_code=409, detail="You cannot disable your own account.")
    fb = _firebase_auth()
    try:
        user = fb.get_user(uid)
    except Exception:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.disabled and _role_of(user) == "super_admin" and _super_admins(fb, uid) < 1:
        raise HTTPException(status_code=409, detail="This is the last super administrator.")
    fb.update_user(uid, disabled=body.disabled)
    if body.disabled:
        fb.revoke_refresh_tokens(uid)
    _log(db, actor, fb, user, "disable" if body.disabled else "enable", _role_of(user), _role_of(user))
    return _view(fb.get_user(uid))


@router.get("/audit")
def role_audit(limit: int = 100, role: str = Depends(require_roles("super_admin")), db: Session = Depends(get_db)):
    rows = db.query(RoleAudit).order_by(RoleAudit.id.desc()).limit(max(1, min(limit, 500))).all()
    return [
        {"at": r.at, "actor": r.actor_email or r.actor_uid, "target": r.target_email or r.target_uid,
         "action": r.action, "old_role": r.old_role, "new_role": r.new_role}
        for r in rows
    ]

"""Postgres-native session tokens (docs/rbac-migration-plan.md Phase 2 Part B) — issued by
`/auth/login` and `/auth/citizen-login`, decoded by retrofitted routes via `app.authz`'s UserContext
loader. Deliberately separate from `app.routes.auth`'s legacy flat-role JWT (`landsetu_session` cookie,
`iss`/`aud`/`role` claims): the two coexist on this branch (dual-path, per 2026-10 decision) and must
never be confused for one another, so this uses its own cookie name and claim shape.

The JWT payload is only `sub` (user.id), `session_id`, `iat`, `exp` — no role, no scope. A route cannot
decide anything from the token alone; every request re-loads the account's current role/scope/active
status from Postgres via `session_id` (see `decode_session_token` below and `app.authz.load_context_for_user`).
This is what makes deactivating a user or logging out take effect immediately, instead of waiting up to
`SESSION_MINUTES` for the JWT to expire on its own.
"""
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import RefreshToken, User

ALGORITHM = "HS256"
SESSION_MINUTES = 30
PG_SESSION_COOKIE = "landsetu_pg_session"

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET must be set to a random value of at least 32 characters")


class SessionInvalid(Exception):
    """Token signature/shape is wrong, or the session it names is revoked, expired, or belongs to a
    now-inactive account. Callers map this to 401 — it is never a 404/403 (authz) decision."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_session(db: Session, user_id: int) -> str:
    """Mint a new session JWT and its matching `refresh_tokens` row. `token_hash` records this access
    token's hash (not a separate long-lived refresh secret — no `/auth/refresh` endpoint exists for this
    token shape yet); `session_id` is what every later lookup actually keys on, per `RefreshToken`'s own
    docstring in app/models.py."""
    now = _now()
    exp = now + timedelta(minutes=SESSION_MINUTES)
    session_id = str(uuid.uuid4())
    token = jwt.encode(
        {"sub": str(user_id), "session_id": session_id, "iat": now, "exp": exp},
        SECRET_KEY, algorithm=ALGORITHM,
    )
    db.add(RefreshToken(
        session_id=session_id,
        user_id=user_id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        issued_at=now.isoformat(),
        expires_at=exp.isoformat(),
        revoked_at=None,
    ))
    db.commit()
    return token


def decode_session_token(db: Session, token: str) -> int:
    """Returns the user_id, or raises SessionInvalid. Checks the JWT itself (signature, `sub`,
    `session_id`, not expired) AND the matching refresh_tokens row (exists, not revoked, not past its
    own `expires_at`) AND that the owning user is still active — the JWT alone proves nothing about
    current account status by design."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["sub", "iat", "exp"]})
    except jwt.PyJWTError:
        raise SessionInvalid("invalid or expired session token")

    sub, session_id = payload.get("sub"), payload.get("session_id")
    if not sub or not session_id:
        raise SessionInvalid("malformed session token")

    row = db.query(RefreshToken).filter(RefreshToken.session_id == session_id).first()
    if row is None or row.revoked_at is not None:
        raise SessionInvalid("session revoked")
    if row.expires_at < _now().isoformat():
        raise SessionInvalid("session expired")

    try:
        user_id = int(sub)
    except ValueError:
        raise SessionInvalid("malformed session token")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise SessionInvalid("account inactive")
    return user_id


def revoke_session(db: Session, session_id: str) -> None:
    db.query(RefreshToken).filter(RefreshToken.session_id == session_id).update({"revoked_at": _now().isoformat()})
    db.commit()


def get_user_context(
    authorization: str | None = Header(None),
    landsetu_pg_session: str | None = Cookie(None),
    db: Session = Depends(get_db),
):
    """FastAPI dependency a retrofitted route uses instead of `app.routes.auth.get_current_role`: decodes
    this (new, dual-path) session cookie/bearer token and loads a real `app.authz.UserContext` from
    Postgres on every call — see module docstring for why the token alone is never trusted. Raises the
    appropriate HTTPException itself so route code just does `ctx: UserContext = Depends(get_user_context)`.
    """
    from app.authz import AccountInactive, AmbiguousRole, NoActiveAssignment, load_context_for_user

    token = landsetu_pg_session
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        user_id = decode_session_token(db, token)
    except SessionInvalid:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    try:
        return load_context_for_user(db, user_id)
    except AccountInactive:
        raise HTTPException(status_code=401, detail="Account inactive")
    except NoActiveAssignment:
        raise HTTPException(status_code=403, detail="Account has no active assignment")
    except AmbiguousRole:
        raise HTTPException(status_code=501, detail="Multiple simultaneous roles are not supported yet")


def set_pg_session_cookie(response, token: str) -> None:
    secure = os.getenv("COOKIE_SECURE", "false" if os.getenv("ENVIRONMENT") == "development" else "true").lower() == "true"
    samesite = os.getenv("COOKIE_SAMESITE", "lax").lower()
    if samesite == "none":
        secure = True
    response.set_cookie(
        PG_SESSION_COOKIE, token, httponly=True,
        secure=secure, samesite=samesite, max_age=SESSION_MINUTES * 60, path="/",
    )

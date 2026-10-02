import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import Citizen, OfficerAssignment, User
from app.password import verify_password
from app.schemas import (
    AuthLoginRequest, AuthLoginResponse, CitizenLoginRequest, FirebaseLoginRequest,
    OfficerLoginRequest, SessionLoginResponse,
)
from app.session import issue_session, set_pg_session_cookie

ALGORITHM = "HS256"
COOKIE_NAME = "landsetu_session"
REFRESH_COOKIE_NAME = "landsetu_refresh"
DEMO_LOGIN_ENABLED = os.getenv("DEMO_LOGIN_ENABLED", "false").lower() == "true"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false" if os.getenv("ENVIRONMENT") == "development" else "true").lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()
if COOKIE_SAMESITE == "none":
    COOKIE_SECURE = True

SECRET_KEY = os.getenv("JWT_SECRET")

if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET must be set to a random value of at least 32 characters")

router = APIRouter(prefix="/auth", tags=["Auth"])

VALID_ROLES = {"citizen", "village_officer", "auditor", "state_admin", "officer", "bank", "super_admin"}
# Roles an administrator may assign. "officer" is a legacy role and is not assignable.
ASSIGNABLE_ROLES = ("citizen", "village_officer", "auditor", "state_admin", "bank", "super_admin")

def create_jwt_token(role: str, uid: str = "") -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": uid or f"user-{role}",
        "role": role,
        "type": "access",
        "ts": now.isoformat(),  # precise issue time, compared with role changes
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=30),
        "iss": "landsetu",
        "aud": "landsetu-web",
    }, SECRET_KEY, algorithm=ALGORITHM)

def set_auth_cookies(response: Response, role: str, uid: str = "") -> tuple[str, None]:
    """Issue a 30-minute session. There is no refresh token: a refresh token carried the role for 7 days, so a
    demoted officer kept their old role. The site signs in again with a fresh Firebase ID token instead, and
    Firebase re-reads the account's current role claim each time."""
    access_token = create_jwt_token(role, uid)
    response.set_cookie(
        COOKIE_NAME, access_token, httponly=True,
        secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=30 * 60, path="/"
    )
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/auth")  # clear any cookie issued by older versions
    return access_token, None

def get_current_payload(authorization: str | None = Header(None), landsetu_session: str | None = Cookie(None)) -> dict:
    """Decoded session token: sub (account uid) and role."""
    token = landsetu_session
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer="landsetu", audience="landsetu-web")
        if payload.get("type") and payload.get("type") != "access":
            raise ValueError("Invalid token type")
        if payload.get("role") not in VALID_ROLES:
            raise ValueError("Unknown role")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if _changed_since(payload.get("sub"), payload.get("ts") or payload.get("iat")):
        raise HTTPException(status_code=401, detail="Your role or account status changed. Sign in again.")
    return payload


def _changed_since(uid, issued_at) -> bool:
    """True if an administrator changed this account's role, or disabled it, after the token was issued.
    Closes the window in which a demoted or disabled account kept acting on an old session."""
    if not uid or issued_at is None:
        return False
    from datetime import datetime, timezone
    from app.db import SessionLocal
    from app.models import RoleAudit
    cutoff = issued_at if isinstance(issued_at, str) else datetime.fromtimestamp(int(issued_at), tz=timezone.utc).isoformat()
    with SessionLocal() as db:
        return db.query(RoleAudit.id).filter(RoleAudit.target_uid == uid, RoleAudit.at > cutoff).first() is not None

def get_current_role(payload: dict = Depends(get_current_payload)) -> str:
    return payload["role"]

def get_optional_role(authorization: str | None = Header(None), landsetu_session: str | None = Cookie(None)) -> str:
    """Role for public reads. A visitor with no session is treated as a citizen.
    A session that is present but invalid or expired still fails with 401, so a client can refresh it."""
    if not landsetu_session and not (authorization and authorization.lower().startswith("bearer ")):
        return "citizen"
    return get_current_payload(authorization, landsetu_session)["role"]

def require_roles(*allowed_roles: str):
    def dependency(role: str = Depends(get_current_role)) -> str:
        # super_admin passes every role check.
        if role != "super_admin" and role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return role
    return dependency

@router.post("/mock-login", response_model=AuthLoginResponse)
def mock_login(req: AuthLoginRequest, response: Response):
    """Local demo authentication endpoint.
    
    Strictly hidden (404 Not Found) unless DEMO_LOGIN_ENABLED environment variable is set to true.
    """
    # Off unless explicitly enabled, and never available in production even if the flag is set by mistake.
    if not DEMO_LOGIN_ENABLED or os.getenv("ENVIRONMENT", "").lower() == "production":
        raise HTTPException(
            status_code=404,
            detail="Not Found"
        )
    role = req.role.lower() if req.role else "citizen"
    # A demo session can never be a super administrator: that role manages accounts.
    if role not in VALID_ROLES or role == "super_admin":
        role = "citizen"
    access_token, refresh_token = set_auth_cookies(response, role)
    return AuthLoginResponse(role=role, token=access_token, refresh_token=refresh_token)

@router.post("/firebase-login", response_model=AuthLoginResponse)
def firebase_login(req: FirebaseLoginRequest, response: Response):
    """Exchange a verified Firebase ID token for a LandSetu session.

    Official governance roles (citizen, village_officer, auditor, state_admin, officer, bank)
    are extracted directly from server-verified Firebase custom claims `claims.get('role')`.
    The browser client never chooses or specifies the role.
    """
    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth, credentials
        if not firebase_admin._apps:
            service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
            if service_account:
                import json
                firebase_admin.initialize_app(credentials.Certificate(json.loads(service_account)))
            else:
                firebase_admin.initialize_app()
        claims = firebase_auth.verify_id_token(req.id_token)
    except ImportError:
        raise HTTPException(status_code=503, detail="Firebase Admin SDK is not configured")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase identity token")

    raw_role = str(claims.get("role", "citizen")).lower().strip()
    role = raw_role if raw_role in VALID_ROLES else "citizen"
    uid = claims.get("uid", "")
    
    access_token, refresh_token = set_auth_cookies(response, role, uid)
    return AuthLoginResponse(role=role, token=access_token, refresh_token=refresh_token)

PG_LOCKOUT_THRESHOLD = 5
PG_LOCKOUT_MINUTES = 15


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_not_locked(user: "User | None") -> None:
    if user and user.locked_until and user.locked_until > _now_iso():
        raise HTTPException(status_code=423, detail="Account temporarily locked. Try again later.")


def _record_failed_login(db: Session, user: "User | None") -> None:
    if user is None:
        return
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= PG_LOCKOUT_THRESHOLD:
        user.locked_until = (datetime.now(timezone.utc) + timedelta(minutes=PG_LOCKOUT_MINUTES)).isoformat()
    db.commit()


def _reset_failed_logins(db: Session, user: User) -> None:
    user.failed_logins = 0
    user.locked_until = None
    db.commit()


@router.post("/login", response_model=SessionLoginResponse)
def officer_login(req: OfficerLoginRequest, response: Response, db: Session = Depends(get_db)):
    """Postgres-native officer login (docs/rbac-migration-plan.md Phase 2 Part B). Coexists with
    /auth/firebase-login (dual-path, 2026-10 decision) — this does not replace it."""
    user = db.query(User).filter(User.username == req.username, User.user_type == "officer").first()
    _check_not_locked(user)
    if user is None or not user.is_active or not verify_password(user.password_hash, req.password):
        _record_failed_login(db, user)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    has_assignment = db.query(OfficerAssignment.id).filter(OfficerAssignment.user_id == user.id).first() is not None
    if not has_assignment:
        raise HTTPException(status_code=403, detail="Account has no officer assignment")

    _reset_failed_logins(db, user)
    token = issue_session(db, user.id)
    set_pg_session_cookie(response, token)
    return SessionLoginResponse(user_id=user.id, token=token)


@router.post("/citizen-login", response_model=SessionLoginResponse)
def citizen_login(req: CitizenLoginRequest, response: Response, db: Session = Depends(get_db)):
    """Postgres-native citizen login (docs/rbac-migration-plan.md Phase 2 Part B). Coexists with
    /auth/firebase-login (dual-path, 2026-10 decision) — this does not replace it."""
    citizen = db.query(Citizen).filter(Citizen.citizen_uid == req.citizen_uid).first()
    user = db.query(User).filter(User.id == citizen.user_id, User.user_type == "citizen").first() if citizen else None
    _check_not_locked(user)
    if user is None or not user.is_active or not verify_password(user.password_hash, req.password):
        _record_failed_login(db, user)
        raise HTTPException(status_code=401, detail="Invalid citizen ID or password")

    _reset_failed_logins(db, user)
    token = issue_session(db, user.id)
    set_pg_session_cookie(response, token)
    return SessionLoginResponse(user_id=user.id, token=token)


@router.post("/refresh")
def refresh_session():
    """Retired. Sessions are renewed by signing in again with a fresh Firebase ID token."""
    raise HTTPException(status_code=410, detail="Refresh tokens are no longer issued. Sign in again.")

@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/auth")

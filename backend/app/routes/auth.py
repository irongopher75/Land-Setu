import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from app.schemas import AuthLoginRequest, AuthLoginResponse, FirebaseLoginRequest

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

VALID_ROLES = {"citizen", "village_officer", "auditor", "state_admin", "officer", "bank"}

def create_jwt_token(role: str, uid: str = "") -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": uid or f"user-{role}",
        "role": role,
        "type": "access",
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=30),
        "iss": "landsetu",
        "aud": "landsetu-web",
    }, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(role: str, uid: str = "") -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": uid or f"user-{role}",
        "role": role,
        "type": "refresh",
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(days=7),
        "iss": "landsetu",
        "aud": "landsetu-web",
    }, SECRET_KEY, algorithm=ALGORITHM)

def set_auth_cookies(response: Response, role: str, uid: str = "") -> tuple[str, str]:
    access_token = create_jwt_token(role, uid)
    refresh_token = create_refresh_token(role, uid)
    
    # 30-minute access token cookie
    response.set_cookie(
        COOKIE_NAME, access_token, httponly=True,
        secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=30 * 60, path="/"
    )
    # 7-day refresh token cookie
    response.set_cookie(
        REFRESH_COOKIE_NAME, refresh_token, httponly=True,
        secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=7 * 86400, path="/auth"
    )
    return access_token, refresh_token

def get_current_role(authorization: str | None = None, landsetu_session: str | None = Cookie(None)) -> str:
    token = landsetu_session
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer="landsetu", audience="landsetu-web")
        if payload.get("type") and payload.get("type") != "access":
            raise ValueError("Invalid token type")
        role = payload.get("role")
        if role not in VALID_ROLES:
            raise ValueError("Unknown role")
        return role
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")

def require_roles(*allowed_roles: str):
    def dependency(role: str = Depends(get_current_role)) -> str:
        if role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return role
    return dependency

@router.post("/mock-login", response_model=AuthLoginResponse)
def mock_login(req: AuthLoginRequest, response: Response):
    """Local demo authentication endpoint.
    
    Strictly hidden (404 Not Found) unless DEMO_LOGIN_ENABLED environment variable is set to true.
    """
    if not DEMO_LOGIN_ENABLED:
        raise HTTPException(
            status_code=404, 
            detail="Not Found"
        )
    role = req.role.lower() if req.role else "citizen"
    if role not in VALID_ROLES:
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

@router.post("/refresh", response_model=AuthLoginResponse)
def refresh_session(response: Response, landsetu_refresh: str | None = Cookie(None)):
    """Exchange a valid 7-day refresh token for a new 30-minute access token."""
    if not landsetu_refresh:
        raise HTTPException(status_code=401, detail="Refresh token required")
    try:
        payload = jwt.decode(landsetu_refresh, SECRET_KEY, algorithms=[ALGORITHM], issuer="landsetu", audience="landsetu-web")
        if payload.get("type") != "refresh":
            raise ValueError("Token is not a refresh token")
        role = payload.get("role", "citizen")
        uid = payload.get("sub", "")
        if role not in VALID_ROLES:
            raise ValueError("Invalid role in refresh token")
        
        access_token, refresh_token = set_auth_cookies(response, role, uid)
        return AuthLoginResponse(role=role, token=access_token, refresh_token=refresh_token)
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh session")

@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/auth")

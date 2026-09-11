import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from app.schemas import AuthLoginRequest, AuthLoginResponse, FirebaseLoginRequest

ALGORITHM = "HS256"
COOKIE_NAME = "landsetu_session"
DEMO_LOGIN_ENABLED = os.getenv("DEMO_LOGIN_ENABLED", "false").lower() == "true"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"
SECRET_KEY = os.getenv("JWT_SECRET")

if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET must be set to a random value of at least 32 characters")

router = APIRouter(prefix="/auth", tags=["Auth"])

def create_jwt_token(role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": f"user-{role}", "role": role, "iat": now, "nbf": now,
        "exp": now + timedelta(minutes=30), "iss": "landsetu", "aud": "landsetu-web",
    }, SECRET_KEY, algorithm=ALGORITHM)

VALID_ROLES = {"citizen", "village_officer", "auditor", "state_admin", "officer", "bank"}

def get_current_role(authorization: str | None = None, landsetu_session: str | None = Cookie(None)) -> str:
    token = landsetu_session
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer="landsetu", audience="landsetu-web")
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
    """Officer and citizen authentication endpoint."""
    role = req.role.lower() if req.role else "citizen"
    if role not in VALID_ROLES:
        role = "citizen"
    token = create_jwt_token(role)
    response.set_cookie(COOKIE_NAME, token, httponly=True,
                        secure=COOKIE_SECURE, samesite="lax", max_age=86400, path="/")
    return AuthLoginResponse(role=role)

@router.post("/firebase-login", response_model=AuthLoginResponse)
def firebase_login(req: FirebaseLoginRequest, response: Response):
    """Exchange a verified Firebase ID token for a LandSetu session.

    Officer access is controlled by the Firebase custom claim `role: officer`.
    The browser never chooses the role.
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

    role = claims.get("role", "citizen")
    if role not in {"citizen", "officer"}:
        role = "citizen"
    response.set_cookie(COOKIE_NAME, create_jwt_token(role), httponly=True,
                        secure=COOKIE_SECURE, samesite="lax", max_age=30 * 60, path="/")
    return AuthLoginResponse(role=role)

@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")

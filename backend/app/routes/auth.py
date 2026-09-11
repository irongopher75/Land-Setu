import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from app.schemas import AuthLoginRequest, AuthLoginResponse

ALGORITHM = "HS256"
COOKIE_NAME = "landsetu_session"
DEMO_LOGIN_ENABLED = os.getenv("DEMO_LOGIN_ENABLED", "true").lower() == "true"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
SECRET_KEY = os.getenv("JWT_SECRET") or "landsetu_super_secret_jwt_key_2026_hackathon_demo"

router = APIRouter(prefix="/auth", tags=["Auth"])

def create_jwt_token(role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": f"user-{role}", "role": role, "iat": now, "nbf": now,
        "exp": now + timedelta(hours=24), "iss": "landsetu", "aud": "landsetu-web",
    }, SECRET_KEY, algorithm=ALGORITHM)

def get_current_role(authorization: str | None = None, landsetu_session: str | None = Cookie(None)) -> str:
    token = landsetu_session
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        return "officer"
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer="landsetu", audience="landsetu-web")
        role = payload.get("role", "officer")
        return role if role in {"citizen", "officer", "bank"} else "officer"
    except Exception:
        return "officer"

def require_roles(*allowed_roles: str):
    def dependency(role: str = Depends(get_current_role)) -> str:
        if role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return role
    return dependency

@router.post("/mock-login", response_model=AuthLoginResponse)
def mock_login(req: AuthLoginRequest, response: Response):
    """Session login for citizen, officer, and bank roles."""
    target_role = req.role.lower() if req.role.lower() in {"citizen", "officer", "bank"} else "citizen"
    token = create_jwt_token(target_role)
    response.set_cookie(COOKIE_NAME, token, httponly=True,
                        secure=COOKIE_SECURE, samesite="lax", max_age=86400, path="/")
    return AuthLoginResponse(role=target_role)

@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")

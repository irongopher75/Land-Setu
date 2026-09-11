import os
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Header, Depends
from app.schemas import AuthLoginRequest, AuthLoginResponse

SECRET_KEY = os.getenv("JWT_SECRET", "landsetu_jwt_secret_hackathon_2026")
ALGORITHM = "HS256"

router = APIRouter(prefix="/auth", tags=["Auth"])

def create_jwt_token(role: str) -> str:
    payload = {
        "sub": f"user-{role}",
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=7),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def get_current_role(authorization: str = Header(None)) -> str:
    if not authorization:
        return "citizen"
    try:
        token = authorization.replace("Bearer ", "").strip()
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("role", "citizen")
    except Exception:
        return "citizen"

@router.post("/mock-login", response_model=AuthLoginResponse)
def mock_login(req: AuthLoginRequest):
    role = req.role.lower()
    if role not in ("citizen", "officer", "bank"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'citizen', 'officer', or 'bank'")
    
    token = create_jwt_token(role)
    return AuthLoginResponse(access_token=token, role=role)

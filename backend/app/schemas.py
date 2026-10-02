from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class ConfidenceBadge(BaseModel):
    value: str  # verified | self_declared | stale
    reason: Optional[str] = None

class FlagEvidence(BaseModel):
    overlapping_parcel: Optional[str] = None
    overlap_area_sqm: Optional[float] = None
    protected_zone: Optional[str] = None
    ror_owner: Optional[str] = None
    registration_buyer: Optional[str] = None
    permitted_fsi: Optional[float] = None
    approved_fsi: Optional[float] = None

class FlagItem(BaseModel):
    rule: str
    flag: bool
    reason: str
    evidence: Optional[Dict[str, Any]] = None

class GeometryGeoJSON(BaseModel):
    type: str = "Polygon"
    coordinates: List[List[List[float]]]

class ParcelListItem(BaseModel):
    id: int
    ulpin: str
    state: str
    area_sqm: Optional[float] = None
    centroid: List[float]  # [lng, lat]
    has_flags: bool = False
    flag_count: int = 0

class CanonicalParcelResponse(BaseModel):
    ulpin: str
    state: str
    geometry: Optional[Dict[str, Any]] = None
    area_sqm: Optional[float] = None
    layers: Dict[str, Any]
    flags: List[FlagItem] = []
    raw_record: Optional[Dict[str, Any]] = None

class AdapterPreviewRequest(BaseModel):
    state: str
    raw_record: Dict[str, Any]

class AdapterPreviewResponse(BaseModel):
    state: str
    source_format: str
    canonical: Dict[str, Any]

class AuthLoginRequest(BaseModel):
    role: str  # citizen | officer | bank

class AuthLoginResponse(BaseModel):
    role: str
    token: Optional[str] = None
    refresh_token: Optional[str] = None

class FirebaseLoginRequest(BaseModel):
    id_token: str

class OfficerLoginRequest(BaseModel):
    username: str
    password: str

class CitizenLoginRequest(BaseModel):
    citizen_uid: str
    password: str

class SessionLoginResponse(BaseModel):
    """Response for the Postgres-native /auth/login and /auth/citizen-login — deliberately separate
    from AuthLoginResponse (the legacy flat-role shape): no `role` field, since the session JWT itself
    carries no role (app/session.py) and a client must not infer one from the login response either."""
    user_id: int
    token: str

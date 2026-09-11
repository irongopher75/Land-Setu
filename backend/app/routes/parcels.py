import json
import jwt
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Parcel, ProtectedZone
from app.schemas import ParcelListItem, CanonicalParcelResponse, FlagItem
from app.rules import RuleEngine, parse_geometry_shape
from app.routes.auth import get_current_role, require_roles, SECRET_KEY, ALGORITHM
from app.states import INDIAN_STATES, detect_state_from_coords

router = APIRouter(prefix="/parcels", tags=["Parcels"])

@router.get("/states/all")
def get_all_states():
    """Returns all supported Indian States and Union Territories with geographic centers & bboxes."""
    return INDIAN_STATES

@router.get("/identify-state")
def identify_state_by_coords(lat: float = Query(...), lng: float = Query(...)):
    """Automatically identifies the exact Indian state from pointer latitude and longitude coordinates."""
    return detect_state_from_coords(lat, lng)

def filter_fields_by_role(parcel_dict: dict, role: str) -> dict:
    if role == "citizen":
        public_fields = {
            "ror": {"confidence", "last_verified", "patta_type"},
            "registration": {"confidence", "date"},
            "zoning": {"confidence", "land_use", "permitted_fsi"},
            "building_permit": {"confidence", "status", "approved_fsi"},
            "tax": {"confidence", "last_verified"},
            "encumbrance": {"confidence", "active"},
        }
        cleaned_layers = {}
        for dept, data in parcel_dict.get("layers", {}).items():
            if isinstance(data, dict):
                clean_dept = {k: v for k, v in data.items() if k in public_fields.get(dept, set())}
                cleaned_layers[dept] = clean_dept
            else:
                cleaned_layers[dept] = data

        return {
            "ulpin": parcel_dict["ulpin"],
            "state": parcel_dict["state"],
            "geometry": parcel_dict.get("geometry"),
            "area_sqm": parcel_dict.get("area_sqm"),
            "layers": cleaned_layers,
            "flags": parcel_dict.get("flags", []),
            "raw_record": None
        }

    return parcel_dict

@router.get("", response_model=List[ParcelListItem])
def list_parcels(state: Optional[str] = Query(None), offset: int = Query(0, ge=0),
                 limit: int = Query(100, ge=1, le=250), db: Session = Depends(get_db)):
    query = db.query(Parcel)
    if state:
        query = query.filter(Parcel.state == state)

    parcels = query.order_by(Parcel.id).offset(offset).limit(limit).all()
    result = []

    for p in parcels:
        geom_shape = parse_geometry_shape(p.geometry)
        centroid_coords = [0.0, 0.0]
        if geom_shape:
            centroid = geom_shape.centroid
            centroid_coords = [round(centroid.x, 6), round(centroid.y, 6)]

        flags = RuleEngine.evaluate_parcel_rules(db, p)

        result.append(ParcelListItem(
            id=p.id,
            ulpin=p.ulpin,
            state=p.state,
            area_sqm=p.area_sqm,
            centroid=centroid_coords,
            has_flags=len(flags) > 0,
            flag_count=len(flags)
        ))

    return result

@router.get("/protected-zones/geojson")
def get_protected_zones_geojson(state: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(ProtectedZone)
    if state:
        query = query.filter(ProtectedZone.state == state)

    zones = query.all()
    features = []

    for z in zones:
        geom_shape = parse_geometry_shape(z.geometry)
        if geom_shape:
            features.append({
                "type": "Feature",
                "properties": {
                    "zone_id": z.zone_id,
                    "name": z.name,
                    "state": z.state
                },
                "geometry": geom_shape.__geo_interface__
            })

    return {
        "type": "FeatureCollection",
        "features": features
    }

@router.get("/geojson/all")
def get_all_parcels_geojson(state: Optional[str] = Query(None), offset: int = Query(0, ge=0),
                            limit: int = Query(500, ge=1, le=1000), db: Session = Depends(get_db)):
    query = db.query(Parcel)
    if state:
        query = query.filter(Parcel.state == state)

    parcels = query.order_by(Parcel.id).offset(offset).limit(limit).all()
    features = []

    for p in parcels:
        geom_shape = parse_geometry_shape(p.geometry)
        if geom_shape:
            flags = RuleEngine.evaluate_parcel_rules(db, p)

            features.append({
                "type": "Feature",
                "properties": {
                    "id": p.id,
                    "ulpin": p.ulpin,
                    "state": p.state,
                    "area_sqm": p.area_sqm,
                    "has_flags": len(flags) > 0,
                    "flag_count": len(flags),
                },
                "geometry": geom_shape.__geo_interface__
            })

    return {
        "type": "FeatureCollection",
        "features": features
    }

@router.get("/{ulpin}")
def get_parcel_detail(ulpin: str, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    geom_shape = parse_geometry_shape(parcel.geometry)
    flags = RuleEngine.evaluate_parcel_rules(db, parcel)

    full_canonical = {
        "ulpin": parcel.ulpin,
        "state": parcel.state,
        "geometry": geom_shape.__geo_interface__ if geom_shape else None,
        "area_sqm": parcel.area_sqm,
        "layers": parcel.layers or {},
        "flags": flags,
        "raw_record": parcel.raw_record
    }

    return filter_fields_by_role(full_canonical, role)

@router.get("/{ulpin}/geometry")
def get_parcel_geometry(ulpin: str, db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    geom_shape = parse_geometry_shape(parcel.geometry)
    return {
        "type": "Feature",
        "properties": {
            "ulpin": parcel.ulpin,
            "state": parcel.state
        },
        "geometry": geom_shape.__geo_interface__ if geom_shape else None
    }

@router.get("/{ulpin}/flags", response_model=List[FlagItem])
def get_parcel_flags(ulpin: str, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    return RuleEngine.evaluate_parcel_rules(db, parcel)

@router.get("/{ulpin}/passport")
def get_parcel_passport(ulpin: str, role: str = Depends(require_roles("officer", "bank")), db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    flags = RuleEngine.evaluate_parcel_rules(db, parcel)
    payload = {
        "ulpin": parcel.ulpin,
        "state": parcel.state,
        "is_verified": len([f for f in flags if f.get("flag")]) == 0,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(minutes=5),
        "iss": "landsetu",
        "aud": "landsetu-passport",
        "jti": f"passport-{parcel.id}-{int(datetime.utcnow().timestamp())}",
    }

    signed_token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

    return {
        "ulpin": parcel.ulpin,
        "signed_token": signed_token,
        "expires_in_seconds": 300,
        "payload": {"ulpin": parcel.ulpin, "state": parcel.state, "is_verified": payload["is_verified"]}
    }

class CreateCustomParcelRequest(BaseModel):
    ulpin: str = Field(min_length=4, max_length=80, pattern=r"^[A-Za-z0-9-]+$")
    state: Optional[str] = Field(default=None, max_length=80)
    owner_name: str = Field(min_length=1, max_length=160)
    geometry: dict
    area_sqm: float = Field(gt=0, le=100_000_000)

@router.post("/custom")
def create_custom_parcel(req: CreateCustomParcelRequest, role: str = Depends(require_roles("officer")), db: Session = Depends(get_db)):
    from app.db import IS_SQLITE
    from shapely.geometry import shape

    try:
        s_shape = shape(req.geometry)
    except Exception:
        raise HTTPException(status_code=422, detail="geometry must be a valid GeoJSON geometry")
    if s_shape.geom_type != "Polygon" or s_shape.is_empty or not s_shape.is_valid:
        raise HTTPException(status_code=422, detail="geometry must be a valid, non-empty Polygon")
    if len(s_shape.exterior.coords) > 1_000:
        raise HTTPException(status_code=422, detail="geometry has too many vertices")

    # Auto-detect state if state is not specified or set to auto
    target_state = req.state
    if not target_state or target_state.lower() in ("auto", "unknown"):
        centroid = s_shape.centroid
        detected = detect_state_from_coords(centroid.y, centroid.x)
        target_state = detected["name"]

    if not IS_SQLITE:
        from geoalchemy2.shape import from_shape
        geom_val = from_shape(s_shape, srid=4326)
    else:
        geom_val = req.geometry

    layers = {
        "ror": {
            "owner_name": req.owner_name,
            "khata_no": f"KH-MANUAL-{req.ulpin[-4:]}",
            "source": "manual_gis_entry",
            "last_verified": datetime.utcnow().strftime("%Y-%m-%d"),
            "confidence": "verified"
        },
        "registration": {
            "last_transaction_id": f"REG-MANUAL-{req.ulpin[-4:]}",
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "buyer_name": req.owner_name,
            "source": "sub_registrar",
            "confidence": "verified"
        },
        "zoning": {
            "land_use": "residential",
            "permitted_fsi": 1.5,
            "source": "master_plan_2021",
            "confidence": "verified"
        },
        "building_permit": {
            "status": "approved",
            "permit_id": f"BP-MANUAL-{req.ulpin[-4:]}",
            "approved_fsi": 1.5,
            "source": "municipal_corp",
            "confidence": "self_declared"
        },
        "tax": {
            "annual_value": 45000,
            "source": "revenue_dept",
            "confidence": "verified",
            "last_verified": datetime.utcnow().strftime("%Y-%m-%d")
        },
        "encumbrance": {
            "active": False,
            "source": "sub_registrar",
            "confidence": "verified"
        }
    }

    # Check if ULPIN already exists
    existing = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if existing:
        raise HTTPException(status_code=409, detail="ULPIN already exists; use the reviewed update workflow")
    parcel_model = Parcel(
        ulpin=req.ulpin,
        state=target_state,
        area_sqm=req.area_sqm,
        geometry=geom_val,
        layers=layers,
        raw_record={"ulpin": req.ulpin, "owner": req.owner_name, "source": "Manual GIS Drawer"}
    )
    db.add(parcel_model)
    db.commit()
    db.refresh(parcel_model)

    flags = RuleEngine.evaluate_parcel_rules(db, parcel_model)
    return {
        "ulpin": parcel_model.ulpin,
        "state": parcel_model.state,
        "area_sqm": parcel_model.area_sqm,
        "layers": parcel_model.layers,
        "flags": flags
    }

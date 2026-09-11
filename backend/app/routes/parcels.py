import json
import jwt
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Parcel, ProtectedZone
from app.schemas import ParcelListItem, CanonicalParcelResponse, FlagItem
from app.rules import RuleEngine, parse_geometry_shape
from app.routes.auth import get_current_role, SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/parcels", tags=["Parcels"])

def filter_fields_by_role(parcel_dict: dict, role: str) -> dict:
    if role == "citizen":
        cleaned_layers = {}
        for dept, data in parcel_dict.get("layers", {}).items():
            if isinstance(data, dict):
                clean_dept = {k: v for k, v in data.items() if k not in ("source", "internal_audit_id")}
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
def list_parcels(state: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Parcel)
    if state:
        query = query.filter(Parcel.state == state)

    parcels = query.all()
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
def get_all_parcels_geojson(state: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Parcel)
    if state:
        query = query.filter(Parcel.state == state)

    parcels = query.all()
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
                    "ror_owner": p.layers.get("ror", {}).get("owner_name", "N/A") if p.layers else "N/A"
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
def get_parcel_flags(ulpin: str, db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    return RuleEngine.evaluate_parcel_rules(db, parcel)

@router.get("/{ulpin}/passport")
def get_parcel_passport(ulpin: str, db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    flags = RuleEngine.evaluate_parcel_rules(db, parcel)
    ror_owner = parcel.layers.get("ror", {}).get("owner_name", "N/A") if parcel.layers else "N/A"

    payload = {
        "ulpin": parcel.ulpin,
        "state": parcel.state,
        "owner": ror_owner,
        "area_sqm": parcel.area_sqm,
        "is_verified": len([f for f in flags if f.get("flag")]) == 0,
        "issued_at": datetime.utcnow().isoformat(),
        "issuer": "LandSetu Sovereign GIS Platform"
    }

    signed_token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

    return {
        "ulpin": parcel.ulpin,
        "signed_token": signed_token,
        "passport_url": f"http://localhost:5173/passport/{parcel.ulpin}?token={signed_token}",
        "payload": payload
    }

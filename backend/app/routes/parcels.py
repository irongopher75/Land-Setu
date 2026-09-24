import json
import jwt
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Parcel, ProtectedZone, BoundaryChangeRequest
from app.schemas import ParcelListItem, CanonicalParcelResponse, FlagItem
from app.rules import RuleEngine, parse_geometry_shape, invalidate_neighbor_flags
from app.routes.auth import get_current_role, get_optional_role, require_roles, SECRET_KEY, ALGORITHM
from app.states import INDIAN_STATES, detect_state_from_coords
from app.workflow import advance_request, apply_request, NEW_TYPES

router = APIRouter(prefix="/parcels", tags=["Parcels"])

def _refresh_flags_after_change(db: Session, parcel: Parcel, old_geom=None, old_state: Optional[str] = None) -> None:
    """
    Keep Parcel.flags correct after a create/edit. Overlap depends on neighbors,
    so neighbors of both the old and new boundary are marked stale (flags=NULL,
    refilled lazily on next read). Does not commit.
    """
    db.flush()  # autoflush is off: neighbor queries must see the new geometry
    geoms = [parcel.geometry] + ([old_geom] if old_geom is not None else [])
    invalidate_neighbor_flags(db, geoms, parcel.state, exclude_id=parcel.id)
    if old_state and old_geom is not None and old_state != parcel.state:
        invalidate_neighbor_flags(db, [old_geom], old_state, exclude_id=parcel.id)
    RuleEngine.refresh_flags(db, parcel)

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
            "ror": {"owner_name", "owner_share", "khata_no", "confidence", "last_verified", "patta_type"},
            "registration": {"confidence", "date", "transaction_type"},
            "zoning": {"confidence", "land_use", "permitted_fsi"},
            "building_permit": {"confidence", "status", "approved_fsi"},
            "tax": {"confidence", "last_verified", "annual_value"},
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
    batch_flags = RuleEngine.evaluate_parcels_batch(db, parcels)
    result = []

    for p in parcels:
        geom_shape = parse_geometry_shape(p.geometry)
        centroid_coords = [0.0, 0.0]
        if geom_shape:
            centroid = geom_shape.centroid
            centroid_coords = [round(centroid.x, 6), round(centroid.y, 6)]

        flags = batch_flags.get(p.id, [])

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
    batch_flags = RuleEngine.evaluate_parcels_batch(db, parcels)
    features = []

    for p in parcels:
        geom_shape = parse_geometry_shape(p.geometry)
        if geom_shape:
            flags = batch_flags.get(p.id, [])

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
def get_parcel_detail(ulpin: str, role: str = Depends(get_optional_role), db: Session = Depends(get_db)):
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
def get_parcel_flags(ulpin: str, role: str = Depends(get_optional_role), db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")

    return RuleEngine.evaluate_parcel_rules(db, parcel)

@router.get("/{ulpin}/passport")
def get_parcel_passport(ulpin: str, role: str = Depends(require_roles("officer", "bank", "auditor", "state_admin")), db: Session = Depends(get_db)):
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
def create_custom_parcel(req: CreateCustomParcelRequest, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    if role == "citizen":
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Citizens are in Read-Only mode and cannot mark or reshape land boundaries. Please switch to Revenue Officer role."
        )

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

    # Validate strict Geographical Boundaries of India (Lat: 6.5°N - 35.7°N, Lng: 68.1°E - 97.4°E)
    coords = s_shape.exterior.coords
    for lng, lat in coords:
        if not (6.5 <= lat <= 35.7 and 68.1 <= lng <= 97.4):
            raise HTTPException(
                status_code=422,
                detail="Land allocation is strictly restricted within the territory of India (Lat: 6.5°N-35.7°N, Lng: 68.1°E-97.4°E)."
            )

    # Auto-detect state if state is not specified or set to auto
    target_state = req.state
    if not target_state or target_state.lower() in ("auto", "unknown"):
        centroid = s_shape.centroid
        detected = detect_state_from_coords(centroid.y, centroid.x)
        target_state = detected["name"]

    # Check if user role is village_officer (Lower Authority)
    # Lower level authority cannot directly modify approved boundaries; they issue a request for change
    if role == "village_officer":
        change_req = BoundaryChangeRequest(
            ulpin=req.ulpin,
            state=target_state,
            requester_role="village_officer",
            requested_by=req.owner_name,
            geometry=req.geometry,
            area_sqm=req.area_sqm,
            reason="Village Office boundary modification request",
            status="PENDING_APPROVAL",
            type="BOUNDARY",
            history=[],
            created_at=datetime.utcnow().isoformat()
        )
        db.add(change_req)
        db.commit()
        db.refresh(change_req)

        return {
            "status": "PENDING_APPROVAL",
            "message": f"Boundary change request for ULPIN '{req.ulpin}' submitted successfully! Awaiting review and approval from State Administration / Auditor.",
            "request_id": change_req.id,
            "is_approval_pending": True,
            "ulpin": req.ulpin,
            "state": target_state
        }

    # Upper Authority (State Admin / Auditor / Officer) Direct Save & Auto Approval
    if not IS_SQLITE:
        from geoalchemy2.shape import from_shape
        geom_val = from_shape(s_shape, srid=4326)
    else:
        geom_val = req.geometry

    # Auto-approve any pending change request for this ULPIN
    pending_reqs = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.ulpin == req.ulpin,
        BoundaryChangeRequest.status == "PENDING_APPROVAL"
    ).all()
    for pr in pending_reqs:
        advance_request(pr, "APPROVED", role, "Superseded by direct save")
        pr.approved_by = req.owner_name
        pr.approver_role = role

    existing = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if existing:
        old_geom, old_state = existing.geometry, existing.state
        existing.geometry = geom_val
        existing.area_sqm = req.area_sqm
        existing.state = target_state
        _refresh_flags_after_change(db, existing, old_geom, old_state)
        db.commit()
        db.refresh(existing)
        parcel_model = existing
    else:
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
        parcel_model = Parcel(
            ulpin=req.ulpin,
            state=target_state,
            area_sqm=req.area_sqm,
            geometry=geom_val,
            layers=layers,
            raw_record={"ulpin": req.ulpin, "owner": req.owner_name, "source": "Manual GIS Drawer"}
        )
        db.add(parcel_model)
        _refresh_flags_after_change(db, parcel_model)
        db.commit()
        db.refresh(parcel_model)

    flags = RuleEngine.evaluate_parcel_rules(db, parcel_model)
    return {
        "status": "APPROVED",
        "ulpin": parcel_model.ulpin,
        "state": parcel_model.state,
        "area_sqm": parcel_model.area_sqm,
        "layers": parcel_model.layers,
        "flags": flags
    }

@router.get("/requests/pending")
def list_pending_requests(role: str = Depends(require_roles("officer", "bank", "auditor", "state_admin", "village_officer")), db: Session = Depends(get_db)):
    """Lists all boundary change and deletion requests in the multi-stage governance pipeline."""
    reqs = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.status.in_([
            "PENDING_AUDITOR_REVIEW", "PENDING_STATE_ADMIN", "PENDING_APPROVAL",
            "PENDING_DELETION_VILLAGE", "PENDING_DELETION_AUDITOR", "PENDING_VILLAGE_REVIEW"
        ])
    ).order_by(BoundaryChangeRequest.id.desc()).all()

    result = []
    for r in reqs:
        is_deletion = str(r.status or "").startswith("PENDING_DELETION")
        result.append({
            "id": r.id,
            "ulpin": r.ulpin,
            "state": r.state,
            "requester_role": r.requester_role,
            "requested_by": r.requested_by,
            "area_sqm": r.area_sqm,
            "reason": r.reason,
            "status": r.status,
            "type": "DELETION" if is_deletion else (r.type or "BOUNDARY"),
            "payload": r.payload,
            "history": r.history or [],
            "created_at": r.created_at,
            "geometry": r.geometry
        })
    return result

class RequestDeletionPayload(BaseModel):
    reason: Optional[str] = "State Admin requested land parcel deletion"

@router.post("/{ulpin}/request-deletion")
def request_parcel_deletion(ulpin: str, payload: Optional[RequestDeletionPayload] = None, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """State Admin endpoint to initiate a parcel deletion request requiring Auditor + Land Officer approval."""
    if role not in ("state_admin", "super_admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only State Administration Officers (state_admin) can initiate land deletion requests."
        )

    duplicate = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.ulpin == ulpin,
        BoundaryChangeRequest.status.in_(["PENDING_DELETION_VILLAGE", "PENDING_DELETION_AUDITOR"])
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"A deletion request for ULPIN '{ulpin}' is already pending ({duplicate.status})."
        )

    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    state_val = parcel.state if parcel else "Unknown State"
    area = parcel.area_sqm if parcel else 0.0
    geom = parse_geometry_shape(parcel.geometry).__geo_interface__ if (parcel and parcel.geometry) else {}

    change_req = BoundaryChangeRequest(
        ulpin=ulpin,
        state=state_val,
        requester_role="state_admin",
        requested_by="State Admin Officer",
        geometry=geom,
        area_sqm=area,
        reason=payload.reason if payload else "State Admin requested land parcel deletion",
        status="PENDING_DELETION_VILLAGE",
        type="DELETION",
        history=[],
        created_at=datetime.utcnow().isoformat()
    )
    db.add(change_req)
    db.commit()
    db.refresh(change_req)

    return {
        "status": "PENDING_DELETION_VILLAGE",
        "message": f"Land deletion request for ULPIN '{ulpin}' submitted! Stage 1: Awaiting Village Land Officer review & approval.",
        "request_id": change_req.id,
        "ulpin": ulpin
    }

@router.post("/requests/{request_id}/village-approve-deletion")
def village_approve_deletion(request_id: int, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """Village Officer endpoint to approve land deletion (Stage 1)."""
    if role not in ("village_officer", "super_admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only Village Land Officers can approve Stage 1 deletion. State Admin cannot self-approve."
        )

    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    if req.status != "PENDING_DELETION_VILLAGE":
        raise HTTPException(status_code=400, detail=f"Deletion request is not awaiting village officer approval (current: {req.status}).")

    advance_request(req, "PENDING_DELETION_AUDITOR", role, "Village officer approved deletion")
    req.approved_by = "Village Land Officer (Deletion Stage 1 Approved)"
    req.approver_role = role
    db.commit()

    return {
        "status": "PENDING_DELETION_AUDITOR",
        "message": f"Land deletion request #{request_id} for ULPIN '{req.ulpin}' approved by Village Officer! Stage 2: Forwarded to Auditor for final audit authorization."
    }

@router.post("/requests/{request_id}/auditor-approve-deletion")
def auditor_approve_deletion(request_id: int, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """Auditor endpoint to authorize final land deletion (Stage 2)."""
    if role not in ("auditor", "super_admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only Compliance Auditors can issue final deletion authorization. State Admin cannot self-approve."
        )

    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    if req.status != "PENDING_DELETION_AUDITOR":
        raise HTTPException(status_code=400, detail=f"Deletion request is not awaiting auditor authorization (current: {req.status}).")

    parcel = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if parcel:
        invalidate_neighbor_flags(db, [parcel.geometry], parcel.state, exclude_id=parcel.id)
        db.delete(parcel)

    advance_request(req, "DELETED", role, "Auditor authorized deletion")
    req.approved_by = "Compliance Auditor (Final Deletion Authorized)"
    req.approver_role = role
    db.commit()

    return {
        "status": "DELETED",
        "message": f"Land deletion for ULPIN '{req.ulpin}' fully authorized by Auditor & Village Officer! Parcel record permanently removed from master GIS database."
    }

@router.post("/requests/{request_id}/auditor-pass")
def auditor_pass_request(request_id: int, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """Auditor endpoint to pass compliance audit and forward request to State Admin."""
    if role not in ("auditor", "state_admin", "super_admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only Compliance Auditors can pass audit and forward to State Admin."
        )

    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Boundary change request not found")

    if req.type in NEW_TYPES and req.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=400, detail=f"Request is not awaiting auditor review (current: {req.status}).")
    advance_request(req, "PENDING_STATE_ADMIN", role, "Audit passed")
    req.approved_by = "Compliance Auditor (Audit Passed)"
    req.approver_role = role
    db.commit()

    return {"status": "PENDING_STATE_ADMIN", "message": f"Boundary change request #{request_id} passed auditor review and forwarded to State Admin!"}

@router.post("/requests/{request_id}/approve")
def approve_boundary_request(request_id: int, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """State Admin approval endpoint to commit a lower authority boundary change request."""
    if role not in ("state_admin", "super_admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only State Administration Officers (state_admin) can issue final approval for boundary change requests."
        )

    from app.db import IS_SQLITE
    from shapely.geometry import shape

    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Boundary change request not found")

    if req.type in NEW_TYPES:
        if req.status != "PENDING_STATE_ADMIN":
            raise HTTPException(status_code=400, detail=f"Request is not awaiting state admin approval (current: {req.status}).")
        apply_request(db, req)
        advance_request(req, "APPROVED", role, f"{req.type.title()} applied")
        req.approved_by = "State Administration Officer"
        req.approver_role = role
        db.commit()
        return {"status": "APPROVED", "message": f"{req.type.title()} request #{request_id} for ULPIN '{req.ulpin}' approved and applied."}

    try:
        s_shape = shape(req.geometry)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid GeoJSON geometry in request")

    if not IS_SQLITE:
        from geoalchemy2.shape import from_shape
        geom_val = from_shape(s_shape, srid=4326)
    else:
        geom_val = req.geometry

    existing = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    old_geom, old_state = None, None
    if existing:
        old_geom, old_state = existing.geometry, existing.state
        existing.geometry = geom_val
        existing.area_sqm = req.area_sqm
        existing.state = req.state
    else:
        layers = {
            "ror": {"owner_name": req.requested_by, "khata_no": f"KH-MANUAL-{req.ulpin[-4:]}", "source": "village_office_approval", "confidence": "verified"},
            "registration": {"last_transaction_id": f"REG-MANUAL-{req.ulpin[-4:]}", "date": datetime.utcnow().strftime("%Y-%m-%d"), "source": "sub_registrar", "confidence": "verified"},
            "zoning": {"land_use": "residential", "permitted_fsi": 1.5, "source": "master_plan_2021", "confidence": "verified"},
            "building_permit": {"status": "approved", "approved_fsi": 1.5, "source": "municipal_corp", "confidence": "self_declared"},
            "tax": {"annual_value": 45000, "source": "revenue_dept", "confidence": "verified"},
            "encumbrance": {"active": False, "source": "sub_registrar", "confidence": "verified"}
        }
        existing = Parcel(ulpin=req.ulpin, state=req.state, area_sqm=req.area_sqm, geometry=geom_val, layers=layers)
        db.add(existing)

    _refresh_flags_after_change(db, existing, old_geom, old_state)
    advance_request(req, "APPROVED", role, "Boundary change applied")
    req.approved_by = "State Administration Officer"
    req.approver_role = role
    db.commit()

    return {"status": "APPROVED", "message": f"Boundary change request #{request_id} for ULPIN '{req.ulpin}' approved and committed!"}

@router.post("/requests/{request_id}/reject")
def reject_boundary_request(request_id: int, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    """Rejection / withdrawal for boundary-change and deletion requests."""
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Boundary change request not found")

    village_can_reject = role in ("village_officer", "super_admin") and req.status in ("PENDING_DELETION_VILLAGE", "PENDING_VILLAGE_REVIEW")
    auditor_can_reject = role in ("auditor", "super_admin") and (
        req.status in ("PENDING_DELETION_AUDITOR", "PENDING_AUDITOR_REVIEW", "PENDING_APPROVAL")
    )
    admin_can_reject = role in ("state_admin", "super_admin")

    if not (village_can_reject or auditor_can_reject or admin_can_reject):
        raise HTTPException(
            status_code=403,
            detail="Permission denied: you cannot reject this request at the current pipeline stage."
        )

    advance_request(req, "REJECTED", role, "Rejected")
    req.approved_by = f"Rejected by {role}"
    req.approver_role = role
    db.commit()

    return {"status": "REJECTED", "message": f"Boundary change request #{request_id} for ULPIN '{req.ulpin}' rejected."}

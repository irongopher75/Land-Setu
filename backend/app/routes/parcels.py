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
from app.rules import RuleEngine, parse_geometry_shape, invalidate_neighbor_flags, compute_geodesic_area_sqm
from app.routes.auth import get_current_role, get_current_payload, get_optional_role, require_roles, SECRET_KEY, ALGORITHM
from app.states import INDIAN_STATES, detect_state_from_coords
from app.workflow import (advance_request, apply_request, archive_parcel, NEW_TYPES,
                          FAST_STATUS)
from app import audit
from app import permissions
from app.flags import flag_views, flag_rows_for
from app.models import RequestFlag

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

STATE_CODES = {s["code"]: s["name"] for s in INDIAN_STATES}


def server_area_and_state(s_shape, ulpin: str) -> tuple:
    """Area and state of a boundary as the records service computes them from the polygon.

    Whatever a browser sends for area or state is never stored: area is the geodesic area of the polygon
    (the same spherical formula Turf.js uses), and state is point-in-polygon on the centroid. A ULPIN whose
    state code names a different state than the one the boundary lies in is refused rather than guessed.
    """
    area = round(compute_geodesic_area_sqm(s_shape), 2)
    centroid = s_shape.centroid
    detected = detect_state_from_coords(centroid.y, centroid.x)
    prefix = ulpin.split("-", 1)[0].upper()
    if prefix in STATE_CODES and prefix != detected["code"]:
        raise HTTPException(
            status_code=409,
            detail=f"ULPIN '{ulpin}' belongs to {STATE_CODES[prefix]}, but this boundary lies in {detected['name']}.",
        )
    return area, detected["name"]


def filter_fields_by_role(parcel_dict: dict, role: str) -> dict:
    if role == "bank":
        # Lenders see clearance only: whether the parcel is encumbered and whether any rule is flagged.
        # No owner, deed, tax or raw source data.
        enc = (parcel_dict.get("layers") or {}).get("encumbrance") or {}
        flags = parcel_dict.get("flags") or []
        return {
            "ulpin": parcel_dict["ulpin"], "state": parcel_dict["state"], "area_sqm": parcel_dict.get("area_sqm"),
            "status": parcel_dict.get("status", "active"),
            "layers": {"encumbrance": {k: enc.get(k) for k in ("active", "type", "confidence", "last_verified") if k in enc}},
            "flags": [{"rule": f.get("rule"), "flag": f.get("flag")} for f in flags],
            "raw_record": None,
        }
    if role == "citizen":
        public_fields = {
            "ror": {"owner_name", "owner_share", "khata_no", "confidence", "last_verified", "patta_type", "corrected_fields", "corrected_at"},
            "registration": {"confidence", "date", "transaction_type", "corrected_fields", "corrected_at"},
            "zoning": {"confidence", "land_use", "permitted_fsi", "corrected_fields", "corrected_at"},
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
            "raw_record": None,
            "status": parcel_dict.get("status", "active"),
            "archived_at": parcel_dict.get("archived_at"),
            "archived_reason": parcel_dict.get("archived_reason"),
            "superseded_by": parcel_dict.get("superseded_by"),
        }

    return parcel_dict

@router.get("", response_model=List[ParcelListItem])
def list_parcels(state: Optional[str] = Query(None), offset: int = Query(0, ge=0),
                 limit: int = Query(100, ge=1, le=250), db: Session = Depends(get_db)):
    query = db.query(Parcel).filter(Parcel.status == "active")
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
    query = db.query(Parcel).filter(Parcel.status == "active")
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
    # An archived or superseded parcel stays readable. Its rule flags are not evaluated.
    flags = RuleEngine.evaluate_parcel_rules(db, parcel) if parcel.status == "active" else []

    full_canonical = {
        "ulpin": parcel.ulpin,
        "state": parcel.state,
        "geometry": geom_shape.__geo_interface__ if geom_shape else None,
        "area_sqm": parcel.area_sqm,
        "layers": parcel.layers or {},
        "flags": flags,
        "raw_record": parcel.raw_record,
        "status": parcel.status,
        "archived_at": parcel.archived_at,
        "archived_reason": parcel.archived_reason,
        "superseded_by": parcel.superseded_by,
    }

    return filter_fields_by_role(full_canonical, role)


@router.get("/{ulpin}/audit-chain")
def get_audit_chain(ulpin: str, db: Session = Depends(get_db)):
    """The tamper-evident audit log of one parcel. Roles only, no personal data, so it is public.
    The hashes are recomputed here on every call; `verified` is false if any entry was altered."""
    if not db.query(Parcel.id).filter(Parcel.ulpin == ulpin).first():
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")
    rows = audit.chain(db, ulpin)
    ok, broken_at = audit.verify(rows)
    return {
        "ulpin": ulpin, "verified": ok, "broken_at": broken_at, "genesis_hash": audit.GENESIS_HASH,
        "head_hash": rows[-1].entry_hash if rows else audit.GENESIS_HASH,
        "entries": [
            {"seq": r.seq, "event": r.event, "from_status": r.from_status, "to_status": r.to_status,
             "actor_role": r.actor_role, "note": r.note, "request_id": r.request_id,
             "created_at": r.created_at, "prev_hash": r.prev_hash, "entry_hash": r.entry_hash}
            for r in rows
        ],
    }

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
    owner_name: str = Field(min_length=1, max_length=160)
    geometry: dict
    # Accepted for older clients and ignored: the service computes both from the geometry.
    state: Optional[str] = Field(default=None, max_length=80)
    area_sqm: Optional[float] = None

@router.post("/custom")
def create_custom_parcel(req: CreateCustomParcelRequest, role: str = Depends(get_current_role),
                         actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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

    # Area and state come from the polygon, computed here. req.area_sqm and req.state are ignored.
    area_sqm, target_state = server_area_and_state(s_shape, req.ulpin)

    # Every boundary marking is a request. Nobody, whatever their role, saves a boundary directly, and a new
    # marking never approves someone else's pending request. A village officer's marking counts as the village
    # stage; anyone else's starts at the village stage so a village officer still verifies it.
    existing = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if existing and existing.status != "active":
        raise HTTPException(status_code=409, detail=f"Parcel '{req.ulpin}' is {existing.status} and cannot be changed.")
    open_dup = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.ulpin == req.ulpin,
        BoundaryChangeRequest.type == "BOUNDARY",
        BoundaryChangeRequest.status.in_(list(permissions.STAGE_REVIEWERS)),
    ).first()
    if open_dup:
        raise HTTPException(status_code=409, detail=f"A boundary request for '{req.ulpin}' is already under review (#{open_dup.id}).")

    first = "PENDING_APPROVAL" if role == "village_officer" else "PENDING_VILLAGE_REVIEW"
    change_req = BoundaryChangeRequest(
        ulpin=req.ulpin,
        state=target_state,
        requester_role=role,
        requested_by=req.owner_name,
        geometry=req.geometry,
        area_sqm=area_sqm,
        reason=("Boundary change for an existing parcel" if existing else "New parcel boundary"),
        status=first,
        type="BOUNDARY",
        history=[],
        track="HIGH",
        requester_uid=actor.get("sub"),
        created_at=datetime.utcnow().isoformat()
    )
    db.add(change_req)
    db.flush()
    advance_request(change_req, first, role, "Submitted", db=db, submitted=True, actor_uid=actor.get("sub"))
    db.commit()
    db.refresh(change_req)

    next_role = "auditor" if first == "PENDING_APPROVAL" else "village land officer"
    return {
        "status": first,
        "message": f"Boundary request #{change_req.id} for ULPIN '{req.ulpin}' filed. It goes to the {next_role} next, then on to the state administrator. Nothing changes on the map until final approval.",
        "request_id": change_req.id,
        "is_approval_pending": True,
        "ulpin": req.ulpin,
        "state": target_state
    }


@router.get("/requests/pending")
def list_pending_requests(role: str = Depends(require_roles("officer", "auditor", "state_admin", "village_officer")),
                          actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Lists all boundary change and deletion requests in the multi-stage governance pipeline."""
    reqs = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.status.in_([
            "PENDING_AUDITOR_REVIEW", "PENDING_STATE_ADMIN", "PENDING_APPROVAL",
            "PENDING_DELETION_VILLAGE", "PENDING_DELETION_AUDITOR", "PENDING_VILLAGE_REVIEW", FAST_STATUS
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
            "history": [{k: v for k, v in h.items() if k != "uid"} for h in (r.history or [])],  # account ids stay server-side
            "created_at": r.created_at,
            "geometry": r.geometry,
            "track": r.track or "HIGH",
            "filed_by_you": bool(r.requester_uid and r.requester_uid == actor.get("sub")),
            "flags": flag_views(db, r.id, actor.get("sub")),
            "permissions": permissions.decide(r, actor.get("sub"), role, sum(1 for f in flag_rows_for(db, r.id) if f.status in permissions.UNRESOLVED)).as_dict(),
        })
    return result


def _unresolved_flags(db: Session, req: BoundaryChangeRequest) -> int:
    return db.query(RequestFlag).filter(RequestFlag.request_id == req.id, RequestFlag.status.in_(permissions.UNRESOLVED)).count()

class RequestDeletionPayload(BaseModel):
    reason: Optional[str] = "State Admin requested land parcel deletion"

@router.post("/{ulpin}/request-deletion")
def request_parcel_deletion(ulpin: str, payload: Optional[RequestDeletionPayload] = None, role: str = Depends(get_current_role),
                            actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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
    if parcel and parcel.status != "active":
        raise HTTPException(status_code=409, detail=f"Parcel '{ulpin}' is already {parcel.status}.")
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
        track="HIGH",
        requester_uid=actor.get("sub"),
        created_at=datetime.utcnow().isoformat()
    )
    db.add(change_req)
    db.flush()
    advance_request(change_req, "PENDING_DELETION_VILLAGE", role, "Archival requested", db=db, submitted=True, actor_uid=actor.get("sub"))
    db.commit()
    db.refresh(change_req)

    return {
        "status": "PENDING_DELETION_VILLAGE",
        "message": f"Archival request for ULPIN '{ulpin}' submitted! Stage 1: Awaiting Village Land Officer review & approval.",
        "request_id": change_req.id,
        "ulpin": ulpin
    }

@router.post("/requests/{request_id}/village-approve-deletion")
def village_approve_deletion(request_id: int, role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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

    permissions.require(req, actor.get("sub"), role, "approve", _unresolved_flags(db, req))
    advance_request(req, "PENDING_DELETION_AUDITOR", role, "Village officer approved archival", db=db, actor_uid=actor.get("sub"))
    req.approved_by = "Village Land Officer (Deletion Stage 1 Approved)"
    req.approver_role = role
    db.commit()

    return {
        "status": "PENDING_DELETION_AUDITOR",
        "message": f"Land deletion request #{request_id} for ULPIN '{req.ulpin}' approved by Village Officer! Stage 2: Forwarded to Auditor for final audit authorization."
    }

@router.post("/requests/{request_id}/auditor-approve-deletion")
def auditor_approve_deletion(request_id: int, role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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

    permissions.require(req, actor.get("sub"), role, "approve", _unresolved_flags(db, req))
    parcel = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if parcel and parcel.status == "active":
        invalidate_neighbor_flags(db, [parcel.geometry], parcel.state, exclude_id=parcel.id)
        archive_parcel(db, parcel, "archived", req.reason or "Archived by approved request", role, request_id=req.id)

    advance_request(req, "ARCHIVED", role, "Auditor authorized archival", db=db, event="approved", actor_uid=actor.get("sub"))
    req.approved_by = "Compliance Auditor (Final Deletion Authorized)"
    req.approver_role = role
    db.commit()

    return {
        "status": "ARCHIVED",
        "message": f"Archival of ULPIN '{req.ulpin}' authorized. The parcel is removed from active views. Its record and full history stay on file."
    }

@router.post("/requests/{request_id}/auditor-pass")
def auditor_pass_request(request_id: int, role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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
    permissions.require(req, actor.get("sub"), role, "approve", _unresolved_flags(db, req))
    advance_request(req, "PENDING_STATE_ADMIN", role, "Audit passed", db=db, actor_uid=actor.get("sub"))
    req.approved_by = "Compliance Auditor (Audit Passed)"
    req.approver_role = role
    db.commit()

    return {"status": "PENDING_STATE_ADMIN", "message": f"Boundary change request #{request_id} passed auditor review and forwarded to State Admin!"}

@router.post("/requests/{request_id}/approve")
def approve_boundary_request(request_id: int, role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
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

    permissions.require(req, actor.get("sub"), role, "approve", _unresolved_flags(db, req))
    if req.type in NEW_TYPES:
        if req.status != "PENDING_STATE_ADMIN":
            raise HTTPException(status_code=400, detail=f"Request is not awaiting state admin approval (current: {req.status}).")
        apply_request(db, req, role)
        advance_request(req, "APPROVED", role, f"{req.type.title()} applied", db=db, actor_uid=actor.get("sub"))
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

    # Recompute at approval from the geometry being approved. The area and state stored on the request are
    # not trusted either: requests filed before this check carried the browser's values.
    area_sqm, state = server_area_and_state(s_shape, req.ulpin)

    existing = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    old_geom, old_state = None, None
    if existing:
        if existing.state != state:
            raise HTTPException(
                status_code=409,
                detail=f"Parcel '{req.ulpin}' is recorded in {existing.state}, but the approved boundary lies in {state}. "
                       "A boundary change cannot move a parcel to another state.",
            )
        old_geom, old_state = existing.geometry, existing.state
        # Keep the extent from the source record, so the area check can still compare it with the new survey.
        layers = dict(existing.layers or {})
        ror = dict(layers.get("ror") or {})
        if ror.get("recorded_extent_sqm") is None and existing.area_sqm is not None:
            ror["recorded_extent_sqm"] = existing.area_sqm
            layers["ror"] = ror
            existing.layers = layers
        existing.geometry = geom_val
        existing.area_sqm = area_sqm
    else:
        # A new parcel starts with no departmental record. Approving a boundary attests the boundary, not the
        # owner, zoning, tax or encumbrance: those stay empty and unverified until a department's own record is
        # imported through the adapter. The name typed on the request is kept only as the requester's claim.
        layers = {
            "ror": {"owner_name": None, "claimed_owner_name": req.requested_by, "source": None, "confidence": "unverified"},
            "registration": {"source": None, "confidence": "unverified"},
            "zoning": {"land_use": None, "source": None, "confidence": "unverified"},
            "building_permit": {"status": None, "source": None, "confidence": "unverified"},
            "tax": {"annual_value": None, "source": None, "confidence": "unverified"},
            "encumbrance": {"active": None, "source": None, "confidence": "unverified"},
        }
        existing = Parcel(ulpin=req.ulpin, state=state, area_sqm=area_sqm, geometry=geom_val, layers=layers,
                          created_at=datetime.utcnow().isoformat() + "+00:00")
        db.add(existing)
        db.flush()
        audit.append(db, req.ulpin, "created", role, request_id=req.id, to_status="active",
                     note="Created by an approved boundary request", actor_uid=actor.get("sub"))

    req.area_sqm, req.state = area_sqm, state
    _refresh_flags_after_change(db, existing, old_geom, old_state)
    advance_request(req, "APPROVED", role, "Boundary change applied", db=db, actor_uid=actor.get("sub"))
    req.approved_by = "State Administration Officer"
    req.approver_role = role
    db.commit()

    return {"status": "APPROVED", "message": f"Boundary change request #{request_id} for ULPIN '{req.ulpin}' approved and committed!"}

@router.post("/requests/{request_id}/reject")
def reject_boundary_request(request_id: int, role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Rejection / withdrawal for boundary-change and deletion requests."""
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Boundary change request not found")

    permissions.require(req, actor.get("sub"), role, "reject", _unresolved_flags(db, req))

    advance_request(req, "REJECTED", role, "Rejected", db=db, actor_uid=actor.get("sub"))
    req.approved_by = f"Rejected by {role}"
    req.approver_role = role
    db.commit()

    return {"status": "REJECTED", "message": f"Boundary change request #{request_id} for ULPIN '{req.ulpin}' rejected."}

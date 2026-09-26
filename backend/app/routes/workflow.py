"""Split / merge / correction requests, parcel history, search and analytics.

Included BEFORE routes.parcels in main.py so /parcels/search is not captured by /parcels/{ulpin}.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from shapely.geometry import mapping
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Parcel, BoundaryChangeRequest
from app.rules import RuleEngine, parse_geometry_shape
from app.routes.auth import get_current_role, get_current_payload, require_roles
from app import permissions
from app.models import RequestFlag
from app.workflow import (
    advance_request, validate_split, validate_merge, validate_correction,
    build_history, NEW_TYPES, route_request, apply_request,
    TRACK_FAST, FAST_STATUS, FAST_APPROVER_ROLES, enforce_open_request_cap,
)

router = APIRouter(prefix="/parcels", tags=["Workflow"])

PIPELINE_OPEN = (
    "PENDING_VILLAGE_REVIEW", "PENDING_APPROVAL", "PENDING_STATE_ADMIN", FAST_STATUS,
    "PENDING_DELETION_VILLAGE", "PENDING_DELETION_AUDITOR",
)


def _get_parcel(db: Session, ulpin: str, active_only: bool = False) -> Parcel:
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")
    if active_only and parcel.status != "active":
        raise HTTPException(status_code=409, detail=f"Parcel '{ulpin}' is {parcel.status} and cannot be changed. Its record stays available for reading.")
    return parcel


def _unresolved(db: Session, req: BoundaryChangeRequest) -> int:
    return db.query(RequestFlag).filter(RequestFlag.request_id == req.id, RequestFlag.status.in_(permissions.UNRESOLVED)).count()


def _reject_duplicate(db: Session, ulpin: str, req_type: str):
    dup = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.ulpin == ulpin,
        BoundaryChangeRequest.type == req_type,
        BoundaryChangeRequest.status.in_(PIPELINE_OPEN),
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"A {req_type.lower()} request for '{ulpin}' is already pending (#{dup.id}, {dup.status}).")


def _open_request(db: Session, parcel: Parcel, req_type: str, role: str, requested_by: str,
                  reason: str, payload: Dict[str, Any], geometry: Dict[str, Any], first_status: str,
                  requester_uid: Optional[str] = None, track: str = "HIGH"):
    enforce_open_request_cap(db, requester_uid, role)
    req = BoundaryChangeRequest(
        ulpin=parcel.ulpin, state=parcel.state, requester_role=role, requested_by=requested_by,
        geometry=geometry, area_sqm=float(parcel.area_sqm or 0), reason=reason,
        type=req_type, payload=payload, history=[], status=first_status, track=track,
        requester_uid=requester_uid, created_at=datetime.utcnow().isoformat(),
    )
    db.add(req)
    db.flush()  # assigns the id the audit entry refers to
    advance_request(req, first_status, role, "Submitted", db=db, submitted=True, actor_uid=requester_uid)
    db.commit()
    db.refresh(req)
    return {"request_id": req.id, "status": req.status, "type": req_type, "track": track, "ulpin": parcel.ulpin}


class SplitRequest(BaseModel):
    parts: List[Dict[str, Any]]  # two entries, each {"geometry": GeoJSON Polygon}
    reason: str = Field("Parcel split", max_length=500)
    requested_by: str = Field("Village Land Officer", max_length=120)


class MergeRequest(BaseModel):
    merge_with: str
    reason: str = Field("Parcel merge", max_length=500)
    requested_by: str = Field("Village Land Officer", max_length=120)


class CorrectionRequest(BaseModel):
    layer: str
    field: str
    requested_value: str = Field(max_length=200)
    evidence: Optional[str] = Field(None, max_length=1000)
    requested_by: str = Field(max_length=120)
    # Set when the correction reports a problem with a decision already made. The old request is not reopened.
    references_request_id: Optional[int] = None


@router.post("/{ulpin}/split-request")
def create_split_request(ulpin: str, body: SplitRequest,
                         role: str = Depends(require_roles("village_officer", "officer", "state_admin")),
                         actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin, active_only=True)
    _reject_duplicate(db, ulpin, "SPLIT")
    parts = validate_split(parcel, body.parts)
    return _open_request(db, parcel, "SPLIT", role, body.requested_by, body.reason,
                         {"parts": parts}, parse_geometry_shape(parcel.geometry).__geo_interface__, "PENDING_APPROVAL",
                         requester_uid=actor.get("sub"), track=route_request("SPLIT"))


@router.post("/{ulpin}/merge-request")
def create_merge_request(ulpin: str, body: MergeRequest,
                         role: str = Depends(require_roles("village_officer", "officer", "state_admin")),
                         actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin, active_only=True)
    other = _get_parcel(db, body.merge_with, active_only=True)
    _reject_duplicate(db, ulpin, "MERGE")
    _reject_duplicate(db, other.ulpin, "MERGE")
    union = validate_merge(parcel, other)
    return _open_request(db, parcel, "MERGE", role, body.requested_by, body.reason,
                         {"merge_ulpins": [parcel.ulpin, other.ulpin]}, mapping(union), "PENDING_APPROVAL",
                         requester_uid=actor.get("sub"), track=route_request("MERGE"))


@router.post("/{ulpin}/correction-request")
def create_correction_request(ulpin: str, body: CorrectionRequest,
                              role: str = Depends(get_current_role), actor: dict = Depends(get_current_payload),
                              db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin, active_only=True)
    _reject_duplicate(db, ulpin, "CORRECTION")
    payload = validate_correction(parcel, body.layer, body.field, body.requested_value)
    payload["evidence"] = body.evidence
    if body.references_request_id is not None:
        ref = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == body.references_request_id).first()
        if not ref or ref.ulpin != ulpin:
            raise HTTPException(status_code=422, detail="The request you refer to does not belong to this parcel.")
        payload["references_request_id"] = ref.id
    reason = f"Correct {body.layer}.{body.field}: '{payload['current']}' to '{payload['requested']}'"
    track = route_request("CORRECTION", payload)
    if track == TRACK_FAST:
        first = FAST_STATUS  # one approver; the village stage is skipped, also for citizen filings
    else:
        first = "PENDING_APPROVAL" if role == "village_officer" else "PENDING_VILLAGE_REVIEW"
    return _open_request(db, parcel, "CORRECTION", role, body.requested_by, reason, payload,
                         parse_geometry_shape(parcel.geometry).__geo_interface__, first,
                         requester_uid=actor.get("sub"), track=track)


@router.post("/requests/{request_id}/village-pass")
def village_pass_request(request_id: int, role: str = Depends(require_roles("village_officer")),
                         actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Village officer verifies a citizen request and forwards it to the auditor."""
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "PENDING_VILLAGE_REVIEW":
        raise HTTPException(status_code=400, detail=f"Request is not awaiting village review (current: {req.status}).")
    permissions.require(req, actor.get("sub"), role, "approve", _unresolved(db, req))
    advance_request(req, "PENDING_APPROVAL", role, "Village officer verified", db=db, actor_uid=actor.get("sub"))
    db.commit()
    return {"status": req.status, "message": f"Request #{request_id} verified and forwarded to the auditor."}


@router.post("/requests/{request_id}/fast-approve")
def fast_approve_request(request_id: int, role: str = Depends(require_roles(*FAST_APPROVER_ROLES)),
                         actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Single-approver track: an auditor or a state admin approves a metadata-only correction."""
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != FAST_STATUS or req.track != TRACK_FAST:
        raise HTTPException(status_code=400, detail=f"Request is not on the fast track awaiting review (current: {req.status}).")
    permissions.require(req, actor.get("sub"), role, "approve", _unresolved(db, req))
    apply_request(db, req, role)
    advance_request(req, "APPROVED", role, "Approved on the fast track", db=db, actor_uid=actor.get("sub"))
    req.approved_by = "Single-approver review"
    req.approver_role = role
    db.commit()
    return {"status": "APPROVED", "message": f"Correction #{request_id} for ULPIN '{req.ulpin}' approved and applied."}


@router.get("/{ulpin}/history")
def get_parcel_history(ulpin: str, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin)
    reqs = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.ulpin == ulpin) \
        .order_by(BoundaryChangeRequest.id).all()
    events = build_history(parcel, reqs)
    if role in ("citizen", "bank"):
        # Request text can name people and values from someone else's filing. Keep the dated event only.
        for e in events:
            if e.get("kind") == "request":
                e["detail"] = ""
    return {"ulpin": ulpin, "events": events}


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/search")
def search_parcels(q: str = Query(..., min_length=2, max_length=80), state: Optional[str] = Query(None),
                   limit: int = Query(20, ge=1, le=50),
                   db: Session = Depends(get_db)):
    """Find parcels by ULPIN, owner name or khata number. Public: it returns only the public record fields."""
    like = _like(q.strip())
    owner = Parcel.layers["ror"]["owner_name"].as_string()
    khata = Parcel.layers["ror"]["khata_no"].as_string()
    query = db.query(Parcel).filter(
        Parcel.status == "active",
        (Parcel.ulpin.ilike(like, escape="\\") | owner.ilike(like, escape="\\") | khata.ilike(like, escape="\\"))
    )
    if state:
        query = query.filter(Parcel.state == state)
    out = []
    ql = q.strip().lower()
    for p in query.order_by(Parcel.ulpin).limit(limit).all():
        ror = (p.layers or {}).get("ror") or {}
        shp = parse_geometry_shape(p.geometry)
        c = shp.centroid if shp is not None and not shp.is_empty else None
        matched = "ulpin" if ql in p.ulpin.lower() else "owner" if ql in str(ror.get("owner_name", "")).lower() else "khata"
        out.append({
            "ulpin": p.ulpin, "state": p.state,
            "owner_name": ror.get("owner_name"), "khata_no": ror.get("khata_no"),
            "centroid": [round(c.x, 6), round(c.y, 6)] if c else None,
            "matched_on": matched,
        })
    return out


@router.get("/analytics/summary")
def analytics_summary(role: str = Depends(require_roles("state_admin")), db: Session = Depends(get_db)):
    """Per-state counts aggregated from cached flags, layers and open requests."""
    parcels = db.query(Parcel).filter(Parcel.status == "active").all()
    RuleEngine.evaluate_parcels_batch(db, [p for p in parcels if p.flags is None])  # fills stale rows

    states: Dict[str, Dict[str, Any]] = {}
    def row(name):
        return states.setdefault(name, {
            "state": name, "total_parcels": 0, "flagged_parcels": 0, "encumbered_parcels": 0,
            "pending_requests": 0, "flags_by_rule": {},
        })

    for p in parcels:
        r = row(p.state)
        r["total_parcels"] += 1
        if p.flags:
            r["flagged_parcels"] += 1
            for f in p.flags:
                r["flags_by_rule"][f["rule"]] = r["flags_by_rule"].get(f["rule"], 0) + 1
        if ((p.layers or {}).get("encumbrance") or {}).get("active") is True:
            r["encumbered_parcels"] += 1

    for req in db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.status.in_(PIPELINE_OPEN)).all():
        row(req.state)["pending_requests"] += 1

    result = sorted(states.values(), key=lambda r: r["state"])
    for r in result:
        t = r["total_parcels"] or 1
        r["flagged_rate"] = round(r["flagged_parcels"] / t, 4)
        r["encumbrance_rate"] = round(r["encumbered_parcels"] / t, 4)
    totals = {k: sum(r[k] for r in result) for k in ("total_parcels", "flagged_parcels", "encumbered_parcels", "pending_requests")}
    t = totals["total_parcels"] or 1
    totals["flagged_rate"] = round(totals["flagged_parcels"] / t, 4)
    totals["encumbrance_rate"] = round(totals["encumbered_parcels"] / t, 4)
    return {"states": result, "totals": totals}


@router.get("/audit-log")
def list_audit_log(ulpin: Optional[str] = Query(None, max_length=80), event: Optional[str] = Query(None, max_length=40),
                   actor_role: Optional[str] = Query(None, max_length=40),
                   date_from: Optional[str] = Query(None, max_length=10, description="YYYY-MM-DD, inclusive"),
                   date_to: Optional[str] = Query(None, max_length=10, description="YYYY-MM-DD, inclusive"),
                   offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
                   role: str = Depends(require_roles("auditor", "state_admin")), db: Session = Depends(get_db)):
    """The records service's audit log across all parcels, newest first, filtered and paginated.

    Entries are the same hash-chained rows served per parcel at /parcels/{ulpin}/audit-chain; that endpoint
    re-verifies a chain. Account ids never leave the server (actor_ref is a keyed hash)."""
    from app.models import ParcelAuditLog
    q = db.query(ParcelAuditLog)
    if ulpin:
        q = q.filter(ParcelAuditLog.ulpin.ilike(f"%{ulpin.strip()}%"))
    if event:
        q = q.filter(ParcelAuditLog.event == event)
    if actor_role:
        q = q.filter(ParcelAuditLog.actor_role == actor_role)
    if date_from:
        q = q.filter(ParcelAuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(ParcelAuditLog.created_at < f"{date_to}T99")   # inclusive of the whole day (ISO strings)
    total = q.count()
    rows = q.order_by(ParcelAuditLog.created_at.desc(), ParcelAuditLog.id.desc()).offset(offset).limit(limit).all()
    return {"total": total, "offset": offset, "limit": limit, "items": [
        {"ulpin": r.ulpin, "seq": r.seq, "event": r.event, "actor_role": r.actor_role, "actor_ref": r.actor_ref,
         "request_id": r.request_id, "from_status": r.from_status, "to_status": r.to_status, "note": r.note,
         "created_at": r.created_at, "entry_hash": r.entry_hash} for r in rows]}

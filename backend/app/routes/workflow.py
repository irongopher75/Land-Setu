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
from app.routes.auth import get_current_role, require_roles
from app.workflow import (
    advance_request, validate_split, validate_merge, validate_correction,
    build_history, NEW_TYPES,
)

router = APIRouter(prefix="/parcels", tags=["Workflow"])

PIPELINE_OPEN = (
    "PENDING_VILLAGE_REVIEW", "PENDING_APPROVAL", "PENDING_STATE_ADMIN",
    "PENDING_DELETION_VILLAGE", "PENDING_DELETION_AUDITOR",
)


def _get_parcel(db: Session, ulpin: str) -> Parcel:
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")
    return parcel


def _reject_duplicate(db: Session, ulpin: str, req_type: str):
    dup = db.query(BoundaryChangeRequest).filter(
        BoundaryChangeRequest.ulpin == ulpin,
        BoundaryChangeRequest.type == req_type,
        BoundaryChangeRequest.status.in_(PIPELINE_OPEN),
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"A {req_type.lower()} request for '{ulpin}' is already pending (#{dup.id}, {dup.status}).")


def _open_request(db: Session, parcel: Parcel, req_type: str, role: str, requested_by: str,
                  reason: str, payload: Dict[str, Any], geometry: Dict[str, Any], first_status: str):
    req = BoundaryChangeRequest(
        ulpin=parcel.ulpin, state=parcel.state, requester_role=role, requested_by=requested_by,
        geometry=geometry, area_sqm=float(parcel.area_sqm or 0), reason=reason,
        type=req_type, payload=payload, history=[], status=first_status,
        created_at=datetime.utcnow().isoformat(),
    )
    advance_request(req, first_status, role, "Submitted")
    db.add(req)
    db.commit()
    db.refresh(req)
    return {"request_id": req.id, "status": req.status, "type": req_type, "ulpin": parcel.ulpin}


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


@router.post("/{ulpin}/split-request")
def create_split_request(ulpin: str, body: SplitRequest,
                         role: str = Depends(require_roles("village_officer", "officer", "state_admin")),
                         db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin)
    _reject_duplicate(db, ulpin, "SPLIT")
    parts = validate_split(parcel, body.parts)
    return _open_request(db, parcel, "SPLIT", role, body.requested_by, body.reason,
                         {"parts": parts}, parse_geometry_shape(parcel.geometry).__geo_interface__, "PENDING_APPROVAL")


@router.post("/{ulpin}/merge-request")
def create_merge_request(ulpin: str, body: MergeRequest,
                         role: str = Depends(require_roles("village_officer", "officer", "state_admin")),
                         db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin)
    other = _get_parcel(db, body.merge_with)
    _reject_duplicate(db, ulpin, "MERGE")
    _reject_duplicate(db, other.ulpin, "MERGE")
    union = validate_merge(parcel, other)
    return _open_request(db, parcel, "MERGE", role, body.requested_by, body.reason,
                         {"merge_ulpins": [parcel.ulpin, other.ulpin]}, mapping(union), "PENDING_APPROVAL")


@router.post("/{ulpin}/correction-request")
def create_correction_request(ulpin: str, body: CorrectionRequest,
                              role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin)
    _reject_duplicate(db, ulpin, "CORRECTION")
    payload = validate_correction(parcel, body.layer, body.field, body.requested_value)
    payload["evidence"] = body.evidence
    reason = f"Correct {body.layer}.{body.field}: '{payload['current']}' to '{payload['requested']}'"
    first = "PENDING_APPROVAL" if role == "village_officer" else "PENDING_VILLAGE_REVIEW"
    return _open_request(db, parcel, "CORRECTION", role, body.requested_by, reason, payload,
                         parse_geometry_shape(parcel.geometry).__geo_interface__, first)


@router.post("/requests/{request_id}/village-pass")
def village_pass_request(request_id: int, role: str = Depends(require_roles("village_officer")),
                         db: Session = Depends(get_db)):
    """Village officer verifies a citizen request and forwards it to the auditor."""
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "PENDING_VILLAGE_REVIEW":
        raise HTTPException(status_code=400, detail=f"Request is not awaiting village review (current: {req.status}).")
    advance_request(req, "PENDING_APPROVAL", role, "Village officer verified")
    db.commit()
    return {"status": req.status, "message": f"Request #{request_id} verified and forwarded to the auditor."}


@router.get("/{ulpin}/history")
def get_parcel_history(ulpin: str, role: str = Depends(get_current_role), db: Session = Depends(get_db)):
    parcel = _get_parcel(db, ulpin)
    reqs = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.ulpin == ulpin) \
        .order_by(BoundaryChangeRequest.id).all()
    return {"ulpin": ulpin, "events": build_history(parcel, reqs)}


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
        Parcel.ulpin.ilike(like, escape="\\") | owner.ilike(like, escape="\\") | khata.ilike(like, escape="\\")
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
    parcels = db.query(Parcel).all()
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

"""Concerns raised against open requests, and withdrawal by the filer.

Permission logic lives in app/permissions.py. These endpoints only apply it.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import audit, permissions
from app.db import get_db
from app.flags import flag_views, flag_rows_for
from app.models import BoundaryChangeRequest, RequestFlag
from app.routes.auth import get_current_payload
from app.workflow import advance_request, note_history

router = APIRouter(prefix="/parcels", tags=["Concerns"])


class RaiseConcern(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)


class ResolveConcern(BaseModel):
    note: str = Field(min_length=5, max_length=1000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request(db: Session, request_id: int) -> BoundaryChangeRequest:
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


def _unresolved(db: Session, request_id: int) -> int:
    return sum(1 for f in flag_rows_for(db, request_id) if f.status in permissions.UNRESOLVED)


@router.post("/requests/{request_id}/flags", status_code=201)
def raise_concern(request_id: int, body: RaiseConcern, actor: dict = Depends(get_current_payload),
                  db: Session = Depends(get_db)):
    """Raise a concern with the reviewer who currently holds the request."""
    uid, role = actor["sub"], actor["role"]
    req = _request(db, request_id)
    d = permissions.decide(req, uid, role, _unresolved(db, request_id))
    if not d.can_flag:
        detail = d.reasons.get("all") or d.reasons.get("flag")
        raise HTTPException(status_code=409 if not permissions.is_open(req.status) else 403, detail=detail)
    flag = RequestFlag(request_id=req.id, ulpin=req.ulpin, raised_by_uid=uid, raised_by_role=role,
                       raised_at=_now(), stage_at_raise=req.status, reason=body.reason.strip(), status="open")
    db.add(flag)
    db.flush()
    note_history(req, "flag", role, uid, "Concern raised")
    # The reason can hold personal detail and the audit log is public, so it is kept as a digest there.
    audit.append(db, req.ulpin, "concern_raised", role, request_id=req.id, from_status=req.status, to_status=req.status,
                 note=f"Concern raised while {req.status.replace('_', ' ').lower()}", payload={"reason": flag.reason}, actor_uid=uid)
    db.commit()
    holders = sorted(permissions.STAGE_REVIEWERS[req.status])
    return {"flag_id": flag.id, "status": flag.status, "notified": holders,
            "message": f"Concern recorded. It is now with the {' or '.join(h.replace('_', ' ') for h in holders)}."}


@router.get("/requests/{request_id}/flags")
def list_concerns(request_id: int, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    if actor["role"] == "citizen":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    _request(db, request_id)
    return flag_views(db, request_id, actor["sub"])


def _flag_for_holder(db: Session, flag_id: int, actor: dict):
    flag = db.query(RequestFlag).filter(RequestFlag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Concern not found")
    req = _request(db, flag.request_id)
    d = permissions.decide(req, actor["sub"], actor["role"], _unresolved(db, req.id))
    if not permissions.is_open(req.status):
        raise HTTPException(status_code=409, detail=d.reasons["all"])
    if not d.can_resolve:
        raise HTTPException(status_code=403, detail="Only the reviewer who now holds this request can respond to a concern.")
    if flag.raised_by_uid == actor["sub"]:
        raise HTTPException(status_code=403, detail="You raised this concern, so someone else must respond to it.")
    return flag, req


@router.post("/flags/{flag_id}/acknowledge")
def acknowledge_concern(flag_id: int, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    flag, req = _flag_for_holder(db, flag_id, actor)
    if flag.status != "open":
        raise HTTPException(status_code=409, detail=f"This concern is already {flag.status}.")
    flag.status, flag.acknowledged_by_uid, flag.acknowledged_at = "acknowledged", actor["sub"], _now()
    db.commit()
    return {"flag_id": flag.id, "status": flag.status}


@router.post("/flags/{flag_id}/resolve")
def resolve_concern(flag_id: int, body: ResolveConcern, actor: dict = Depends(get_current_payload),
                    db: Session = Depends(get_db)):
    """Dismiss the concern with a note. The other way to answer one is to reject the request."""
    flag, req = _flag_for_holder(db, flag_id, actor)
    if flag.status == "resolved":
        raise HTTPException(status_code=409, detail="This concern is already resolved.")
    flag.status, flag.resolved_by_uid, flag.resolved_by_role = "resolved", actor["sub"], actor["role"]
    flag.resolved_at, flag.resolution_note = _now(), body.note.strip()
    note_history(req, "flag_resolved", actor["role"], actor["sub"], "Concern resolved")
    audit.append(db, req.ulpin, "concern_resolved", actor["role"], request_id=req.id, from_status=req.status,
                 to_status=req.status, note="Concern resolved", payload={"note": flag.resolution_note}, actor_uid=actor["sub"])
    db.commit()
    return {"flag_id": flag.id, "status": flag.status, "unresolved_left": _unresolved(db, req.id)}


@router.post("/requests/{request_id}/withdraw")
def withdraw_request(request_id: int, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """The filer withdraws a request that no reviewer has acted on yet."""
    req = _request(db, request_id)
    d = permissions.decide(req, actor["sub"], actor["role"], _unresolved(db, request_id))
    if not permissions.is_open(req.status):
        raise HTTPException(status_code=409, detail=d.reasons["all"])
    if not (req.requester_uid and req.requester_uid == actor["sub"]):
        raise HTTPException(status_code=403, detail="Only the person who filed a request can withdraw it.")
    if not d.can_withdraw:
        raise HTTPException(status_code=409, detail=d.reasons.get("withdraw", "A reviewer has already acted on this request."))
    advance_request(req, "REJECTED", actor["role"], "Withdrawn by the filer", db=db, actor_uid=actor["sub"])
    req.approved_by = "Withdrawn by the filer"
    req.approver_role = actor["role"]
    db.commit()
    return {"status": "REJECTED", "message": f"Request #{request_id} withdrawn."}

"""Read helpers for request concerns (flags)."""
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import RequestFlag


def flag_rows_for(db: Session, request_id: int) -> List[RequestFlag]:
    return db.query(RequestFlag).filter(RequestFlag.request_id == request_id).order_by(RequestFlag.id).all()


def flag_views(db: Session, request_id: int, actor_uid: Optional[str] = None) -> List[Dict[str, Any]]:
    return [{
        "id": f.id, "status": f.status, "reason": f.reason, "stage_at_raise": f.stage_at_raise,
        "raised_by_role": f.raised_by_role, "raised_at": f.raised_at, "raised_by_you": f.raised_by_uid == actor_uid,
        "acknowledged_at": f.acknowledged_at, "resolved_by_role": f.resolved_by_role,
        "resolved_at": f.resolved_at, "resolution_note": f.resolution_note,
    } for f in flag_rows_for(db, request_id)]

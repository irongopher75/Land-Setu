"""Append-only, hash-chained audit log (table parcel_audit_log)."""
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import IS_SQLITE
from app.models import ParcelAuditLog

GENESIS_HASH = "0" * 64
CONTENT_FIELDS = ("ulpin", "seq", "request_id", "event", "from_status", "to_status",
                  "actor_role", "note", "payload_digest", "created_at")

# Request status -> audit event. Anything not listed is logged as under_review.
# concern_raised and concern_resolved are written directly by the concern endpoints.
_EVENT_FOR_STATUS = {"APPROVED": "approved", "REJECTED": "rejected", "ARCHIVED": "archived", "DELETED": "archived"}


def event_for(status: str, submitted: bool) -> str:
    if submitted:
        return "submitted"
    return _EVENT_FOR_STATUS.get(status, "under_review")


def digest(payload: Any) -> Optional[str]:
    if payload is None:
        return None
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def actor_ref(uid: Optional[str]) -> Optional[str]:
    """Keyed hash of an account id. The same account always gives the same value; the id is not recoverable."""
    if not uid:
        return None
    return hmac.new(os.getenv("JWT_SECRET", "").encode(), str(uid).encode(), hashlib.sha256).hexdigest()[:24]


def _content(row: Dict[str, Any]) -> str:
    content = {k: row.get(k) for k in CONTENT_FIELDS}
    if row.get("actor_ref") is not None:   # rows written before actor_ref existed hash without it
        content["actor_ref"] = row["actor_ref"]
    return json.dumps(content, sort_keys=True, separators=(",", ":"))


def compute_hash(prev_hash: str, row: Dict[str, Any]) -> str:
    return hashlib.sha256((prev_hash + _content(row)).encode()).hexdigest()


def append(db: Session, ulpin: str, event: str, actor_role: str, *, request_id: Optional[int] = None,
           from_status: Optional[str] = None, to_status: Optional[str] = None, note: str = "",
           payload: Any = None, actor_uid: Optional[str] = None) -> ParcelAuditLog:
    """Add one entry to the chain of `ulpin`. The caller commits."""
    db.flush()  # sessions here do not autoflush; make earlier entries in this transaction visible
    q = db.query(ParcelAuditLog).filter(ParcelAuditLog.ulpin == ulpin).order_by(ParcelAuditLog.seq.desc())
    last = (q.with_for_update() if not IS_SQLITE else q).first()
    row = {
        "ulpin": ulpin, "seq": (last.seq + 1) if last else 1, "request_id": request_id, "event": event,
        "from_status": from_status, "to_status": to_status, "actor_role": actor_role, "note": note or None,
        "payload_digest": digest(payload), "created_at": datetime.now(timezone.utc).isoformat(),
        "actor_ref": actor_ref(actor_uid),
    }
    prev = last.entry_hash if last else GENESIS_HASH
    entry = ParcelAuditLog(**row, prev_hash=prev, entry_hash=compute_hash(prev, row))
    db.add(entry)
    db.flush()
    return entry


def verify(rows: Iterable[Any]) -> Tuple[bool, Optional[int]]:
    """Recompute every hash in order. Returns (ok, seq of the first bad entry)."""
    prev = GENESIS_HASH
    expected_seq = 1
    for r in rows:
        data = {k: getattr(r, k) for k in CONTENT_FIELDS}
        data["actor_ref"] = getattr(r, "actor_ref", None)
        if r.seq != expected_seq or r.prev_hash != prev or r.entry_hash != compute_hash(prev, data):
            return False, r.seq
        prev = r.entry_hash
        expected_seq += 1
    return True, None


def chain(db: Session, ulpin: str) -> List[ParcelAuditLog]:
    return db.query(ParcelAuditLog).filter(ParcelAuditLog.ulpin == ulpin).order_by(ParcelAuditLog.seq).all()


def backfill_imported(db: Session) -> int:
    """Give every parcel that has no chain a first entry, so history never starts blank."""
    from app.models import Parcel
    have = {u for (u,) in db.query(ParcelAuditLog.ulpin).distinct().all()}
    n = 0
    for (ulpin,) in db.query(Parcel.ulpin).all():
        if ulpin not in have:
            append(db, ulpin, "imported", "system", to_status="active", note="Initial record loaded from the source register")
            n += 1
    if n:
        db.commit()
    return n


def install_append_only_guard(engine) -> None:
    """Refuse UPDATE, DELETE and TRUNCATE on the audit table at the database level."""
    with engine.begin() as conn:
        if IS_SQLITE:
            for op in ("UPDATE", "DELETE"):
                conn.execute(text(
                    f"CREATE TRIGGER IF NOT EXISTS parcel_audit_log_no_{op.lower()} BEFORE {op} ON parcel_audit_log "
                    "BEGIN SELECT RAISE(ABORT, 'parcel_audit_log is append-only'); END"
                ))
        else:
            conn.execute(text(
                "CREATE OR REPLACE FUNCTION parcel_audit_log_guard() RETURNS trigger AS $$ "
                "BEGIN RAISE EXCEPTION 'parcel_audit_log is append-only'; END; $$ LANGUAGE plpgsql"
            ))
            conn.execute(text("DROP TRIGGER IF EXISTS parcel_audit_log_no_change ON parcel_audit_log"))
            conn.execute(text(
                "CREATE TRIGGER parcel_audit_log_no_change BEFORE UPDATE OR DELETE ON parcel_audit_log "
                "FOR EACH ROW EXECUTE FUNCTION parcel_audit_log_guard()"
            ))
            conn.execute(text("DROP TRIGGER IF EXISTS parcel_audit_log_no_truncate ON parcel_audit_log"))
            conn.execute(text(
                "CREATE TRIGGER parcel_audit_log_no_truncate BEFORE TRUNCATE ON parcel_audit_log "
                "FOR EACH STATEMENT EXECUTE FUNCTION parcel_audit_log_guard()"
            ))

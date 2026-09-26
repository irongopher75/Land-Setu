from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Float, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from app.db import Base, IS_SQLITE

# JSONB on Postgres, plain JSON on SQLite.
FlagsType = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")

if not IS_SQLITE:
    try:
        from geoalchemy2 import Geometry
        # spatial_index=True makes geoalchemy2 emit
        # CREATE INDEX idx_<table>_geometry ... USING gist on create_table/create_all.
        # Alembic migration 0002 creates the same index name for existing databases.
        GeometryType = Geometry("POLYGON", srid=4326, spatial_index=True)
    except ImportError:
        GeometryType = JSON
else:
    GeometryType = JSON

class Parcel(Base):
    __tablename__ = "parcels"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, unique=True, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    area_sqm = Column(Float, nullable=True)
    geometry = Column(GeometryType, nullable=False)
    layers = Column(JSON, nullable=False, default={})
    raw_record = Column(JSON, nullable=True)
    # Cached RuleEngine output. NULL means stale or never computed: the next
    # reader recomputes and stores it. A list ([]) means "computed, no flags".
    flags = Column(FlagsType, nullable=True)
    # Lifecycle. A parcel is never removed: an approved deletion sets `archived`, and a split or merge
    # sets `superseded` on the parcel it replaces. Default views show only `active`.
    status = Column(String, nullable=False, default="active", server_default="active", index=True)
    archived_at = Column(String, nullable=True)
    archived_reason = Column(String, nullable=True)
    superseded_by = Column(String, nullable=True)  # ULPIN(s) that replace this parcel, comma separated
    # When this record was entered into LandSetu, as opposed to dates inside the source records.
    created_at = Column(String, nullable=True)
    district = Column(String, nullable=True, index=True)

class ProtectedZone(Base):
    __tablename__ = "protected_zones"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(String, unique=True, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    geometry = Column(GeometryType, nullable=False)

class BoundaryChangeRequest(Base):
    __tablename__ = "boundary_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    requester_role = Column(String, nullable=False)
    requested_by = Column(String, nullable=False)
    geometry = Column(JSON, nullable=False)
    area_sqm = Column(Float, nullable=False)
    reason = Column(String, nullable=True)
    status = Column(String, nullable=False, default="PENDING_APPROVAL")
    approved_by = Column(String, nullable=True)
    approver_role = Column(String, nullable=True)
    created_at = Column(String, nullable=False)
    # Request kind: BOUNDARY | DELETION | SPLIT | MERGE | CORRECTION.
    # Legacy rows are BOUNDARY; deletions are still recognised by status.
    type = Column(String, nullable=False, default="BOUNDARY", server_default="BOUNDARY", index=True)
    # Type specific data. SPLIT: {"parts": [{ulpin, geometry, area_sqm}]}.
    # MERGE: {"merge_ulpins": [..]}. CORRECTION: {layer, field, current, requested, evidence}.
    payload = Column(JSON, nullable=True)
    # Audit trail: [{"at": iso, "status": str, "role": str, "note": str}], oldest first.
    history = Column(JSON, nullable=True)
    # HIGH: village officer, auditor, state admin. FAST: one auditor or state admin. See app/workflow.py.
    track = Column(String, nullable=False, default="HIGH", server_default="HIGH")
    # Account that filed the request. Nobody may approve a request they filed, at any stage.
    requester_uid = Column(String, nullable=True)


class RoleAudit(Base):
    """Who changed which account, when. Written by the admin endpoints."""
    __tablename__ = "role_audit"

    id = Column(Integer, primary_key=True, index=True)
    at = Column(String, nullable=False)
    actor_uid = Column(String, nullable=False)
    actor_email = Column(String, nullable=True)
    target_uid = Column(String, nullable=False, index=True)
    target_email = Column(String, nullable=True)
    action = Column(String, nullable=False)  # create | set_role | disable | enable
    old_role = Column(String, nullable=True)
    new_role = Column(String, nullable=True)


class ParcelAuditLog(Base):
    """Append-only, hash-chained record of every state transition of a parcel or its requests.

    entry_hash = SHA-256(prev_hash + canonical JSON of the entry). The chain is per ULPIN and starts
    from a fixed genesis value. Rows are never updated or deleted (a database trigger enforces it).
    """
    __tablename__ = "parcel_audit_log"
    __table_args__ = (UniqueConstraint("ulpin", "seq", name="uq_parcel_audit_seq"),)

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, index=True, nullable=False)
    seq = Column(Integer, nullable=False)
    request_id = Column(Integer, nullable=True)
    event = Column(String, nullable=False)  # imported, created, submitted, under_review, approved, rejected, archived, superseded
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=True)
    actor_role = Column(String, nullable=False)
    note = Column(String, nullable=True)
    payload_digest = Column(String, nullable=True)  # SHA-256 of the request payload at that moment
    created_at = Column(String, nullable=False)
    prev_hash = Column(String, nullable=False)
    entry_hash = Column(String, nullable=False)
    # Keyed hash of the acting account id. Lets the log tie entries to one account without publishing it.
    actor_ref = Column(String, nullable=True)


class RequestFlag(Base):
    """A concern raised against an open request by someone who filed or already forwarded it.

    status: open -> acknowledged -> resolved. While any flag is unresolved the current reviewer cannot approve.
    """
    __tablename__ = "request_flags"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, nullable=False, index=True)
    ulpin = Column(String, nullable=False, index=True)
    raised_by_uid = Column(String, nullable=False)
    raised_by_role = Column(String, nullable=False)
    raised_at = Column(String, nullable=False)
    stage_at_raise = Column(String, nullable=False)   # request status when the concern was raised
    reason = Column(String, nullable=False)
    status = Column(String, nullable=False, default="open", index=True)  # open | acknowledged | resolved
    acknowledged_by_uid = Column(String, nullable=True)
    acknowledged_at = Column(String, nullable=True)
    resolved_by_uid = Column(String, nullable=True)
    resolved_by_role = Column(String, nullable=True)
    resolved_at = Column(String, nullable=True)
    resolution_note = Column(String, nullable=True)


class RegistrationTransaction(Base):
    """One registered deed on a parcel (Sub-Registrar). layers.registration keeps only the latest; this keeps all.

    deed_date is when the deed was executed. recorded_at is when the Sub-Registrar entered it. The Registration
    Act, 1908 (section 23) expects a deed to be presented within four months of execution.
    """
    __tablename__ = "registration_transactions"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, index=True, nullable=False)
    transaction_id = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="sale")  # sale | gift | inheritance | partition
    seller_name = Column(String, nullable=True)
    buyer_name = Column(String, nullable=True)
    deed_date = Column(String, nullable=False)       # YYYY-MM-DD
    recorded_at = Column(String, nullable=False)     # ISO timestamp
    source = Column(String, nullable=False, default="sub_registrar")
    synthetic_fixture = Column(String, nullable=True)  # name of the planted test case, or NULL for seed history


class EncumbranceEvent(Base):
    """A mortgage, lien or attachment raised on a parcel, and when it was cleared (NULL while active)."""
    __tablename__ = "encumbrance_events"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, index=True, nullable=False)
    kind = Column(String, nullable=False)            # mortgage | lien | court_attachment
    holder = Column(String, nullable=True)           # bank or court
    raised_at = Column(String, nullable=False)       # ISO timestamp
    cleared_at = Column(String, nullable=True)
    source = Column(String, nullable=False, default="sub_registrar")
    synthetic_fixture = Column(String, nullable=True)


class ParcelIntelligence(Base):
    """Cached statistical signals for one parcel. stale=True means recompute on next read (same pattern as flags)."""
    __tablename__ = "parcel_intelligence"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, unique=True, index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    fraud_flags = Column(FlagsType, nullable=True)
    risk_score = Column(Float, nullable=True)
    risk_score_factors = Column(FlagsType, nullable=True)
    zoning_anomaly = Column(Boolean, nullable=False, default=False)
    zoning_explanation = Column(String, nullable=True)
    computed_at = Column(String, nullable=True)
    stale = Column(Boolean, nullable=False, default=True, index=True)


class LandTransaction(Base):
    """One ownership change (sale, gift, inheritance, partition) moving through several departments.

    `details` (JSONB) holds the layered part: the department plan for this parcel's state, the parties taken from
    the registration record, the auto-mutation classifier result and the municipal re-key result.
    """
    __tablename__ = "land_transactions"

    id = Column(Integer, primary_key=True, index=True)
    ulpin = Column(String, ForeignKey("parcels.ulpin"), index=True, nullable=False)
    state = Column(String, index=True, nullable=False)
    transaction_type = Column(String, nullable=False)   # sale | gift | inheritance | partition
    deed_reference = Column(String, nullable=False)     # resolves to registration_transactions.transaction_id
    initiated_at = Column(String, nullable=False)
    initiated_by_ref = Column(String, nullable=True)    # audit.actor_ref of the Sub-Registrar; never the raw account id
    current_department = Column(String, nullable=False)
    current_stage = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending", index=True)  # pending | in_review | objected | approved | rejected
    details = Column(FlagsType, nullable=True)


class MutationStage(Base):
    """One officer-level step inside one department. Rows are created when the department becomes active."""
    __tablename__ = "mutation_stages"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("land_transactions.id"), index=True, nullable=False)
    department = Column(String, nullable=False)
    stage_name = Column(String, nullable=False)
    stage_order = Column(Integer, nullable=False)       # 1-based across the whole transaction
    role_required = Column(String, nullable=False)
    officer_id = Column(String, nullable=True)          # audit.actor_ref of the acting officer; "system" for automatic steps
    action = Column(String, nullable=True)              # approved | objected | rejected | auto_verified | auto_rekeyed | NULL while pending
    remarks = Column(String, nullable=True)
    acted_at = Column(String, nullable=True)


class DepartmentHandoff(Base):
    """A move of the transaction from one department to another. Shown as its own step in the audit trail."""
    __tablename__ = "department_handoffs"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("land_transactions.id"), index=True, nullable=False)
    from_department = Column(String, nullable=True)     # NULL for the opening entry
    to_department = Column(String, nullable=False)
    handoff_reason = Column(String, nullable=False)
    handoff_at = Column(String, nullable=False)
    actor_ref = Column(String, nullable=True)


class DisputeCase(Base):
    """Opened when a Revenue stage objects. Escalated to the SDM / RDO / District Collector by a handoff."""
    __tablename__ = "dispute_cases"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("land_transactions.id"), index=True, nullable=False)
    ulpin = Column(String, index=True, nullable=False)
    objection_reason = Column(String, nullable=False)
    objected_at = Column(String, nullable=False)
    escalated_at = Column(String, nullable=True)
    resolved_at = Column(String, nullable=True)
    resolution = Column(String, nullable=True)          # dismissed (mutation resumes) | upheld (transaction rejected)
    resolution_remarks = Column(String, nullable=True)


class TransactionNotification(Base):
    """Message to the next holder of a transaction, or to a downstream department system."""
    __tablename__ = "transaction_notifications"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("land_transactions.id"), index=True, nullable=False)
    ulpin = Column(String, index=True, nullable=False)
    event = Column(String, nullable=False)              # stage_completed | department_handoff | municipal_push | ...
    recipient_department = Column(String, nullable=False)
    recipient_role = Column(String, nullable=True)
    message = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

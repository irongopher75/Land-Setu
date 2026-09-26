"""Cross-department land transaction workflow.

A transaction moves through the departments a state's config lists (`transaction_workflow` in backend/configs/*.yaml).
Each department owns its own officer-level stages. Moving from one department to the next is a separate event
(DepartmentHandoff) with its own audit entry and notification.

Rules that hold everywhere
  * Registration opens the transaction. Its deed_reference must resolve to a registration_transactions row of that parcel.
  * Municipal (property tax) starts on its own, and only once Revenue has approved.
  * Auto-mutation fast-tracks Revenue's field stages only. Registration, Revenue's final approval and Municipal still run.
  * A Revenue objection opens a DisputeCase. A handoff escalates it. The hearing either dismisses the objection
    (Revenue resumes at the stage that objected) or upholds it (the transaction is rejected).
  * Stage rows are created when a stage is reached, so the table is a record of what happened. Stages not yet reached
    come from `details.plan`.
"""
import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import audit
from app.adapter import SchemaAdapter, CORRECTED_BY_OFFICER
from app.models import (BoundaryChangeRequest, DepartmentHandoff, DisputeCase, LandTransaction, MutationStage,
                        Parcel, RegistrationTransaction, TransactionNotification)
from app.rules import RuleEngine

REGISTRATION, REVENUE, ESTATE_OFFICE, MUNICIPAL, PLANNING, DISPUTE = (
    "REGISTRATION", "REVENUE", "ESTATE_OFFICE", "MUNICIPAL", "PLANNING", "DISPUTE")
DEPARTMENTS = (REGISTRATION, REVENUE, ESTATE_OFFICE, MUNICIPAL, PLANNING, DISPUTE)
TRANSACTION_TYPES = ("sale", "gift", "inheritance", "partition")
STATUSES = ("pending", "in_review", "objected", "approved", "rejected")
OPEN_STATUSES = ("pending", "in_review", "objected")
DEPARTMENT_LABEL = {
    REGISTRATION: "Registration (Sub-Registrar)", REVENUE: "Revenue", ESTATE_OFFICE: "Estate Office",
    MUNICIPAL: "Municipal (property tax)", PLANNING: "Town and Country Planning", DISPUTE: "Dispute (SDM / RDO / Collector)",
}
SECTION_23_WINDOW_DAYS = 120  # Registration Act, 1908, s.23: present a deed within four months of execution

# Used for a state whose config has no `transaction_workflow` block.
DEFAULT_CHAIN = {
    "departments": [
        {"department": REGISTRATION, "stages": [{"name": "Sub-Registrar deed verification", "role": "officer"}]},
        {"department": REVENUE, "stages": [
            {"name": "Village officer verification", "role": "village_officer"},
            {"name": "Supervisor review", "role": "auditor", "when": "ri_required"},
            {"name": "Final approval", "role": "state_admin"}]},
        {"department": MUNICIPAL, "auto": True, "stages": [{"name": "Property tax re-keyed to new owner", "role": "state_admin"}]},
    ],
    "dispute": {"stages": [{"name": "Dispute hearing", "role": "state_admin"}]},
}

_adapter: Optional[SchemaAdapter] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(name: Optional[str]) -> str:
    return " ".join((name or "").lower().split())


# --- config, conditions, classifier -------------------------------------------------------------

def chain_for(state: str) -> Dict[str, Any]:
    global _adapter
    _adapter = _adapter or SchemaAdapter()
    try:
        cfg = _adapter.get_config(state)
    except ValueError:
        return DEFAULT_CHAIN
    return cfg.get("transaction_workflow") or DEFAULT_CHAIN


def conditions_for(db: Session, parcel: Parcel, tx_type: str, land_use_change_to: Optional[str]) -> Dict[str, bool]:
    layers = parcel.layers or {}
    ownership = " ".join(str(v) for v in (layers.get("ror") or {}).values()).lower()
    land_use = (layers.get("zoning") or {}).get("land_use")
    change = bool(land_use_change_to) and _norm(land_use_change_to) != _norm(land_use)
    encumbered = bool((layers.get("encumbrance") or {}).get("active"))
    simple = tx_type == "sale" and not encumbered and not change
    return {
        "leasehold": "lease" in ownership,
        "land_use_change": change,
        "encumbered": encumbered,
        "ri_required": not simple,
    }


def classify_auto_mutation(db: Session, parcel: Parcel, reg: RegistrationTransaction, tx_type: str,
                           cond: Dict[str, bool]) -> Dict[str, Any]:
    """Decide whether Revenue's field stages can be auto-verified. Every failed check is listed."""
    layers = parcel.layers or {}
    reasons: List[str] = []
    if tx_type != "sale":
        reasons.append(f"{tx_type} needs field verification")
    if cond["encumbered"]:
        reasons.append("an encumbrance is active on the parcel")
    if cond["land_use_change"]:
        reasons.append("land use would change")
    if cond["leasehold"]:
        reasons.append("leasehold parcel")
    if not reg.seller_name or _norm(reg.seller_name) != _norm((layers.get("ror") or {}).get("owner_name")):
        reasons.append("seller on the deed does not match the Record of Rights owner")
    try:
        gap = (datetime.fromisoformat(reg.recorded_at.replace("Z", "+00:00")).date()
               - datetime.fromisoformat(reg.deed_date).date()).days
        if gap > SECTION_23_WINDOW_DAYS or gap < 0:
            reasons.append("deed was recorded outside the four month window")
    except ValueError:
        reasons.append("deed dates could not be read")
    if db.query(BoundaryChangeRequest.id).filter(
            BoundaryChangeRequest.ulpin == parcel.ulpin,
            BoundaryChangeRequest.status.notin_(("APPROVED", "REJECTED", "ARCHIVED", "DELETED"))).first():
        reasons.append("another request is open on the parcel")
    if RuleEngine.compute_flags(db, parcel):   # read only: nothing is cached or written
        reasons.append("the parcel has open rule flags")
    return {"eligible": not reasons, "reasons": reasons}


def build_plan(chain: Dict[str, Any], cond: Dict[str, bool], auto_eligible: bool) -> List[Dict[str, Any]]:
    plan = []
    for dept in chain["departments"]:
        if dept.get("when") and not cond.get(dept["when"]):
            continue
        stages = [{"name": s["name"], "role": s["role"]} for s in dept["stages"]
                  if not s.get("when") or cond.get(s["when"])]
        if dept["department"] == REVENUE and auto_eligible:
            for s in stages[:-1]:
                s["auto_verify"] = True   # only the last Revenue stage, the approval, always needs a person
        plan.append({"department": dept["department"], "auto": bool(dept.get("auto")), "stages": stages})
    return plan


# --- helpers -----------------------------------------------------------------------------------

def _plan(tx: LandTransaction) -> List[Dict[str, Any]]:
    return (tx.details or {}).get("plan", [])


def _dept_plan(tx: LandTransaction, dept: str) -> Optional[Dict[str, Any]]:
    if dept == DISPUTE:
        return {"department": DISPUTE, "auto": False, "stages": (tx.details or {}).get("dispute_stages", [])}
    return next((d for d in _plan(tx) if d["department"] == dept), None)


def _rows(db: Session, tx_id: int, dept: Optional[str] = None) -> List[MutationStage]:
    q = db.query(MutationStage).filter(MutationStage.transaction_id == tx_id)
    if dept:
        q = q.filter(MutationStage.department == dept)
    return q.order_by(MutationStage.stage_order).all()


def _pending(db: Session, tx: LandTransaction) -> Optional[MutationStage]:
    return next((r for r in _rows(db, tx.id, tx.current_department) if r.action is None), None)


def _next_department(tx: LandTransaction) -> Optional[str]:
    names = [d["department"] for d in _plan(tx)]
    if tx.current_department == DISPUTE:
        return REVENUE
    i = names.index(tx.current_department)
    return names[i + 1] if i + 1 < len(names) else None


def _role_label(role: str) -> str:
    return role.replace("_", " ")


def _notify(db: Session, tx: LandTransaction, event: str, dept: str, role: Optional[str], message: str) -> None:
    db.add(TransactionNotification(transaction_id=tx.id, ulpin=tx.ulpin, event=event, recipient_department=dept,
                                   recipient_role=role, message=message, created_at=_now()))


def _audit(db: Session, tx: LandTransaction, event: str, role: str, note: str, uid: Optional[str],
           from_status: Optional[str] = None) -> None:
    audit.append(db, tx.ulpin, event, role, from_status=from_status, to_status=tx.status,
                 note=f"Transaction #{tx.id}: {note}", actor_uid=uid)


def _add_stage(db: Session, tx: LandTransaction, dept: str, name: str, role: str, action: Optional[str] = None,
               officer: Optional[str] = None, remarks: Optional[str] = None) -> MutationStage:
    order = len(_rows(db, tx.id)) + 1
    row = MutationStage(transaction_id=tx.id, department=dept, stage_name=name, stage_order=order, role_required=role,
                        officer_id=officer, action=action, remarks=remarks, acted_at=_now() if action else None)
    db.add(row)
    db.flush()
    return row


def _reach_next_stage(db: Session, tx: LandTransaction) -> bool:
    """Create the row for the next stage of the current department. Auto-verified stages are recorded and skipped.
    Returns True when the department has no stage left."""
    dept = _dept_plan(tx, tx.current_department)
    while True:
        done = sum(1 for r in _rows(db, tx.id, tx.current_department) if r.action in ("approved", "auto_verified", "auto_rekeyed"))
        if done >= len(dept["stages"]):
            return True
        stage = dept["stages"][done]
        if stage.get("auto_verify"):
            _add_stage(db, tx, tx.current_department, stage["name"], stage["role"], "auto_verified", "system",
                       "Auto-mutation: routine sale with clean records")
            continue
        _add_stage(db, tx, tx.current_department, stage["name"], stage["role"])
        tx.current_stage = stage["name"]
        if not dept["auto"]:   # an automatic department needs no one to be told
            _notify(db, tx, "stage_waiting", tx.current_department, stage["role"],
                    f"Transaction #{tx.id} on {tx.ulpin} is waiting for {stage['name']}.")
        return False


def _enter_department(db: Session, tx: LandTransaction, dept: str, reason: str, role: str, uid: Optional[str]) -> None:
    prev = tx.current_department
    prev_status = tx.status
    tx.current_department = dept
    tx.status = "in_review"
    db.add(DepartmentHandoff(transaction_id=tx.id, from_department=prev, to_department=dept, handoff_reason=reason,
                             handoff_at=_now(), actor_ref=audit.actor_ref(uid)))
    _notify(db, tx, "department_handoff", dept, None,
            f"Transaction #{tx.id} on {tx.ulpin} passed from {DEPARTMENT_LABEL[prev]} to {DEPARTMENT_LABEL[dept]}. {reason}")
    _audit(db, tx, "department_handoff", role, f"{DEPARTMENT_LABEL[prev]} to {DEPARTMENT_LABEL[dept]}. {reason}", uid, prev_status)
    if _reach_next_stage(db, tx):   # every stage of the department was auto-verified
        _finish_department(db, tx, role, uid)


def _rekey_municipal(db: Session, tx: LandTransaction, role: str, uid: Optional[str]) -> None:
    """The downstream event: Revenue has approved, so the property tax record follows the new owner."""
    revenue = _rows(db, tx.id, REVENUE)
    if not any(r.action == "approved" and r.stage_name == _dept_plan(tx, REVENUE)["stages"][-1]["name"] for r in revenue):
        raise HTTPException(status_code=409, detail="Municipal can only act after Revenue has approved.")
    parcel = db.query(Parcel).filter(Parcel.ulpin == tx.ulpin).first()
    buyer = (tx.details or {}).get("buyer_name")
    layers = copy.deepcopy(parcel.layers or {})
    tax = dict(layers.get("tax") or {})
    previous = tax.get("assessee_name")
    tax.update({"assessee_name": buyer, "rekeyed_by_transaction": tx.id, "last_verified": _now()[:10],
                "confidence": CORRECTED_BY_OFFICER})
    layers["tax"] = tax
    parcel.layers = layers
    details = dict(tx.details or {})
    details["municipal_push"] = {"at": _now(), "assessee_before": previous, "assessee_after": buyer, "status": "delivered"}
    tx.details = details
    _notify(db, tx, "municipal_push", MUNICIPAL, None,
            f"Property tax on {tx.ulpin} re-keyed to the new owner after Revenue approval (transaction #{tx.id}).")
    _audit(db, tx, "municipal_tax_rekeyed", "system", "Property tax record re-keyed to the new owner", None, tx.status)


def _finish_department(db: Session, tx: LandTransaction, role: str, uid: Optional[str]) -> None:
    dept = tx.current_department
    if dept == REVENUE:
        _apply_revenue_mutation(db, tx)
    nxt = _next_department(tx)
    if nxt is None:
        tx.status = "approved"
        tx.current_stage = "Completed"
        _audit(db, tx, "transaction_completed", role, "All departments finished", uid)
        return
    nxt_plan = _dept_plan(tx, nxt)
    if nxt_plan["auto"]:
        _enter_department(db, tx, nxt, f"{DEPARTMENT_LABEL[dept]} finished; {DEPARTMENT_LABEL[nxt]} starts on its own.", "system", None)
        if nxt == MUNICIPAL and tx.status == "in_review":
            _complete_municipal(db, tx)
        return
    tx.current_stage = f"Waiting for handoff to {DEPARTMENT_LABEL[nxt]}"


def _complete_municipal(db: Session, tx: LandTransaction) -> None:
    pending = _pending(db, tx)
    if pending is not None:
        _rekey_municipal(db, tx, "system", None)
        pending.action, pending.officer_id, pending.acted_at = "auto_rekeyed", "system", _now()
        pending.remarks = "Re-keyed by the municipal system"
        db.flush()
    if _reach_next_stage(db, tx):
        _finish_department(db, tx, "system", None)


def _apply_revenue_mutation(db: Session, tx: LandTransaction) -> None:
    """Revenue approved: the Record of Rights names the new owner. Officer-approved, so never shown as verified."""
    parcel = db.query(Parcel).filter(Parcel.ulpin == tx.ulpin).first()
    buyer = (tx.details or {}).get("buyer_name")
    layers = copy.deepcopy(parcel.layers or {})
    ror = dict(layers.get("ror") or {})
    ror.update({"owner_name": buyer, "mutated_by_transaction": tx.id, "last_verified": _now()[:10], "confidence": CORRECTED_BY_OFFICER})
    layers["ror"] = ror
    parcel.layers = layers
    parcel.flags = None   # stale: recomputed on next read
    from app.intelligence.service import mark_stale
    mark_stale(db, parcel.state, [buyer])
    _audit(db, tx, "mutation_applied", "system", "Record of Rights updated to the new owner", None, tx.status)


# --- public operations --------------------------------------------------------------------------

def open_transaction(db: Session, parcel: Parcel, tx_type: str, deed_reference: str, role: str, uid: str,
                     land_use_change_to: Optional[str] = None) -> LandTransaction:
    if tx_type not in TRANSACTION_TYPES:
        raise HTTPException(status_code=422, detail=f"transaction_type must be one of {', '.join(TRANSACTION_TYPES)}")
    if parcel.status != "active":
        raise HTTPException(status_code=409, detail=f"Parcel '{parcel.ulpin}' is {parcel.status} and cannot be mutated.")
    reg = db.query(RegistrationTransaction).filter(RegistrationTransaction.ulpin == parcel.ulpin,
                                                   RegistrationTransaction.transaction_id == deed_reference).first()
    if not reg:
        raise HTTPException(status_code=422, detail=f"Deed '{deed_reference}' is not a registered deed of parcel '{parcel.ulpin}'.")
    if reg.kind != tx_type:
        raise HTTPException(status_code=422, detail=f"Deed '{deed_reference}' is registered as a {reg.kind}, not a {tx_type}.")
    if db.query(LandTransaction.id).filter(LandTransaction.deed_reference == deed_reference,
                                           LandTransaction.status != "rejected").first():
        raise HTTPException(status_code=409, detail=f"Deed '{deed_reference}' already has a transaction.")
    if db.query(LandTransaction.id).filter(LandTransaction.ulpin == parcel.ulpin,
                                           LandTransaction.status.in_(OPEN_STATUSES)).first():
        raise HTTPException(status_code=409, detail=f"Parcel '{parcel.ulpin}' already has an open transaction.")

    chain = chain_for(parcel.state)
    if chain["departments"][0]["department"] != REGISTRATION:
        raise HTTPException(status_code=500, detail="The department chain for this state must start with REGISTRATION.")
    cond = conditions_for(db, parcel, tx_type, land_use_change_to)
    auto = classify_auto_mutation(db, parcel, reg, tx_type, cond)
    plan = build_plan(chain, cond, auto["eligible"])
    tx = LandTransaction(
        ulpin=parcel.ulpin, state=parcel.state, transaction_type=tx_type, deed_reference=deed_reference,
        initiated_at=_now(), initiated_by_ref=audit.actor_ref(uid), current_department=REGISTRATION,
        status="pending", details={
            "plan": plan, "conditions": cond, "auto_mutation": auto,
            "dispute_stages": (chain.get("dispute") or DEFAULT_CHAIN["dispute"])["stages"],
            "seller_name": reg.seller_name, "buyer_name": reg.buyer_name, "land_use_change_to": land_use_change_to,
        })
    db.add(tx)
    db.flush()
    db.add(DepartmentHandoff(transaction_id=tx.id, from_department=None, to_department=REGISTRATION,
                             handoff_reason=f"Deed {deed_reference} presented for registration", handoff_at=_now(),
                             actor_ref=audit.actor_ref(uid)))
    reg_stage = _dept_plan(tx, REGISTRATION)["stages"][0]
    _add_stage(db, tx, REGISTRATION, reg_stage["name"], reg_stage["role"], "approved", audit.actor_ref(uid),
               f"Deed {deed_reference} matches the registration record")
    first = _plan(tx)[1]["department"] if len(_plan(tx)) > 1 else None
    tx.current_stage = f"Waiting for handoff to {DEPARTMENT_LABEL[first]}" if first else "Completed"
    _notify(db, tx, "transaction_opened", first or REGISTRATION, None,
            f"Transaction #{tx.id} ({tx_type}) opened on {parcel.ulpin}. Deed {deed_reference} is verified and ready to hand off.")
    _audit(db, tx, "transaction_opened", role, f"{tx_type} opened, deed {deed_reference} verified", uid)
    return tx


def _guard_open(tx: LandTransaction) -> None:
    if tx.status in ("approved", "rejected"):
        raise HTTPException(status_code=409, detail=f"Transaction is {tx.status}. Nothing more can be done to it.")


def act_on_stage(db: Session, tx: LandTransaction, role: str, uid: str, action: str, remarks: str) -> None:
    """approve | object | reject on the current stage. In DISPUTE, approve dismisses the objection and reject upholds it."""
    _guard_open(tx)
    if tx.status == "pending":
        raise HTTPException(status_code=409, detail="Hand the transaction off to the next department first.")
    if tx.status == "objected":
        raise HTTPException(status_code=409, detail="The objection must be escalated to the dispute authority first.")
    if action not in ("approve", "object", "reject"):
        raise HTTPException(status_code=422, detail="action must be approve, object or reject")
    if action != "approve" and len((remarks or "").strip()) < 10:
        raise HTTPException(status_code=422, detail="Remarks of at least 10 characters are required to object or reject.")
    if action == "object" and tx.current_department != REVENUE:
        raise HTTPException(status_code=422, detail="Only a Revenue stage can object. Other departments reject.")
    stage = _pending(db, tx)
    if stage is None:
        raise HTTPException(status_code=409, detail="No stage is waiting for action.")
    if role != "super_admin" and role != stage.role_required:
        raise HTTPException(status_code=403, detail=f"This stage is for the {_role_label(stage.role_required)}.")
    ref = audit.actor_ref(uid)
    if ref == tx.initiated_by_ref:
        raise HTTPException(status_code=403, detail="You opened this transaction, so another person must act on it.")
    same_dept = _rows(db, tx.id, tx.current_department)
    if tx.current_department == DISPUTE:
        same_dept = _rows(db, tx.id, REVENUE)   # a hearing officer cannot have decided the matter earlier
    if any(r.officer_id == ref for r in same_dept if r.id != stage.id):
        raise HTTPException(status_code=403, detail="You already acted on this transaction in this department.")

    prev_status = tx.status
    stage.officer_id, stage.remarks, stage.acted_at = ref, (remarks or "").strip() or None, _now()
    dept = tx.current_department
    if dept == DISPUTE:
        return _resolve_dispute(db, tx, stage, action, role, uid, prev_status)
    if action == "reject":
        stage.action, tx.status, tx.current_stage = "rejected", "rejected", "Rejected"
        _notify(db, tx, "transaction_rejected", REGISTRATION, "officer",
                f"Transaction #{tx.id} on {tx.ulpin} was rejected at {stage.stage_name}.")
        _audit(db, tx, "stage_rejected", role, f"{stage.stage_name} rejected", uid, prev_status)
        return
    if action == "object":
        stage.action, tx.status, tx.current_stage = "objected", "objected", "Objected: waiting for escalation"
        db.add(DisputeCase(transaction_id=tx.id, ulpin=tx.ulpin, objection_reason=stage.remarks, objected_at=_now()))
        _notify(db, tx, "stage_objected", DISPUTE, "state_admin",
                f"Transaction #{tx.id} on {tx.ulpin} was objected at {stage.stage_name}. Escalate to the dispute authority.")
        _audit(db, tx, "stage_objected", role, f"{stage.stage_name} objected", uid, prev_status)
        return
    stage.action = "approved"
    _audit(db, tx, "stage_approved", role, f"{stage.stage_name} approved", uid, prev_status)
    if _reach_next_stage(db, tx):
        _finish_department(db, tx, role, uid)


def _resolve_dispute(db: Session, tx: LandTransaction, stage: MutationStage, action: str, role: str,
                     uid: Optional[str], prev_status: str) -> None:
    case = db.query(DisputeCase).filter(DisputeCase.transaction_id == tx.id, DisputeCase.resolved_at.is_(None)).first()
    if action == "object":
        raise HTTPException(status_code=422, detail="A hearing decides: approve to dismiss the objection, reject to uphold it.")
    case.resolved_at, case.resolution_remarks = _now(), stage.remarks
    if action == "reject":
        case.resolution, stage.action = "upheld", "rejected"
        tx.status, tx.current_stage = "rejected", "Rejected: objection upheld"
        _notify(db, tx, "dispute_resolved", REGISTRATION, "officer", f"Objection on transaction #{tx.id} was upheld. Transaction rejected.")
        _audit(db, tx, "dispute_resolved", role, "Objection upheld, transaction rejected", uid, prev_status)
        return
    case.resolution, stage.action = "dismissed", "approved"
    _audit(db, tx, "dispute_resolved", role, "Objection dismissed, Revenue resumes", uid, prev_status)
    if _reach_next_stage(db, tx):
        _enter_department(db, tx, REVENUE, "Objection dismissed; Revenue resumes at the stage that objected.", role, uid)


def handoff(db: Session, tx: LandTransaction, role: str, uid: str, to_department: str, reason: str) -> None:
    _guard_open(tx)
    if to_department not in DEPARTMENTS:
        raise HTTPException(status_code=422, detail=f"to_department must be one of {', '.join(DEPARTMENTS)}")
    current = _dept_plan(tx, tx.current_department)
    allowed = {s["role"] for s in current["stages"]}
    if role != "super_admin" and role not in allowed:
        raise HTTPException(status_code=403, detail=f"Only {DEPARTMENT_LABEL[tx.current_department]} officers can hand this transaction off.")
    if to_department == DISPUTE:
        if tx.status != "objected":
            raise HTTPException(status_code=409, detail="Only an objected transaction goes to the dispute authority.")
        case = db.query(DisputeCase).filter(DisputeCase.transaction_id == tx.id, DisputeCase.resolved_at.is_(None)).first()
        case.escalated_at = _now()
        _enter_department(db, tx, DISPUTE, f"Objection escalated: {case.objection_reason}", role, uid)
        return
    if tx.status == "objected":
        raise HTTPException(status_code=409, detail="An objected transaction can only be escalated to the dispute authority.")
    if tx.current_department == DISPUTE:
        raise HTTPException(status_code=409, detail="The hearing decides where the transaction goes next.")
    if _pending(db, tx) is not None:
        raise HTTPException(status_code=409, detail=f"{DEPARTMENT_LABEL[tx.current_department]} has not finished its stages.")
    nxt = _next_department(tx)
    if nxt is None:
        raise HTTPException(status_code=409, detail="This is the last department.")
    if to_department != nxt:
        raise HTTPException(status_code=422, detail=f"The next department is {nxt}.")
    if _dept_plan(tx, nxt)["auto"]:
        raise HTTPException(status_code=409, detail=f"{DEPARTMENT_LABEL[nxt]} starts on its own and cannot be handed to.")
    _enter_department(db, tx, nxt, reason, role, uid)


# --- views -------------------------------------------------------------------------------------

def view(db: Session, tx: LandTransaction, detail: bool = True) -> Dict[str, Any]:
    d = tx.details or {}
    out = {
        "id": tx.id, "ulpin": tx.ulpin, "state": tx.state, "transaction_type": tx.transaction_type,
        "deed_reference": tx.deed_reference, "initiated_at": tx.initiated_at, "current_department": tx.current_department,
        "current_stage": tx.current_stage, "status": tx.status,
    }
    if not detail:
        return out
    stages = _rows(db, tx.id)
    handoffs = db.query(DepartmentHandoff).filter(DepartmentHandoff.transaction_id == tx.id).order_by(DepartmentHandoff.id).all()
    cases = db.query(DisputeCase).filter(DisputeCase.transaction_id == tx.id).order_by(DisputeCase.id).all()
    notes = db.query(TransactionNotification).filter(TransactionNotification.transaction_id == tx.id).order_by(TransactionNotification.id).all()
    dispute_seen = bool(cases)
    departments = []
    for entry in _plan(tx) + ([_dept_plan(tx, DISPUTE)] if dispute_seen else []):
        name = entry["department"]
        rows = [r for r in stages if r.department == name]
        reached = {r.stage_name for r in rows}
        finished = sum(1 for r in rows if r.action in ("approved", "auto_verified", "auto_rekeyed"))
        if any(r.action == "rejected" for r in rows):
            state = "rejected"
        elif finished >= len(entry["stages"]) and rows:
            state = "complete"
        elif name == tx.current_department and tx.status in OPEN_STATUSES:
            state = "active"
        else:
            state = "paused" if rows else "upcoming"   # paused: Revenue while the dispute authority holds the case
        departments.append({
            "department": name, "label": DEPARTMENT_LABEL[name], "auto": entry["auto"], "state": state,
            "stages": [_stage_view(r) for r in rows],
            "upcoming_stages": [{"stage_name": s["name"], "role_required": s["role"], "auto_verify": bool(s.get("auto_verify"))}
                                for s in entry["stages"] if s["name"] not in reached],
        })
    out.update({
        "conditions": d.get("conditions"), "auto_mutation": d.get("auto_mutation"), "municipal_push": d.get("municipal_push"),
        "buyer_name": d.get("buyer_name"), "seller_name": d.get("seller_name"),
        "departments": departments,
        "handoffs": [{"from_department": h.from_department, "to_department": h.to_department, "handoff_reason": h.handoff_reason,
                      "handoff_at": h.handoff_at} for h in handoffs],
        "dispute_cases": [{"id": c.id, "objection_reason": c.objection_reason, "objected_at": c.objected_at,
                           "escalated_at": c.escalated_at, "resolved_at": c.resolved_at, "resolution": c.resolution,
                           "resolution_remarks": c.resolution_remarks} for c in cases],
        "notifications": [{"event": n.event, "recipient_department": n.recipient_department, "recipient_role": n.recipient_role,
                           "message": n.message, "created_at": n.created_at} for n in notes],
    })
    return out


def _stage_view(r: MutationStage) -> Dict[str, Any]:
    return {"stage_order": r.stage_order, "stage_name": r.stage_name, "role_required": r.role_required,
            "officer_id": r.officer_id, "action": r.action, "remarks": r.remarks, "acted_at": r.acted_at}

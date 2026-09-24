"""Who may approve, reject, withdraw, flag or resolve on a request, right now.

One function, `decide`, answers for an account and a request. The endpoints call `require` so the API
enforces exactly what the interface is told (`decide` is also returned with each queued request).

Rules
  * Only the current stage's designated reviewer acts on a request. A super admin may act at any stage but is bound
    by every personal rule below.
  * Nobody acts on a request they filed.
  * An account that already approved or forwarded a request cannot approve or reject it again, at any stage.
    It may only raise a concern.
  * A request with an unresolved concern (open or acknowledged) cannot be approved.
  * A filer may withdraw only while no reviewer has acted.
  * A closed request (approved, rejected, archived) accepts nothing further.
"""
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

STAGE_REVIEWERS = {
    "PENDING_VILLAGE_REVIEW": {"village_officer"},
    "PENDING_DELETION_VILLAGE": {"village_officer"},
    "PENDING_APPROVAL": {"auditor"},
    "PENDING_AUDITOR_REVIEW": {"auditor"},   # legacy status
    "PENDING": {"auditor"},                  # legacy status
    "PENDING_DELETION_AUDITOR": {"auditor"},
    "PENDING_STATE_ADMIN": {"state_admin"},
    "PENDING_FAST_REVIEW": {"auditor", "state_admin"},
}
UNRESOLVED = ("open", "acknowledged")


def is_open(status: Optional[str]) -> bool:
    return status in STAGE_REVIEWERS


def _kind(entry: Dict[str, Any], index: int) -> str:
    """submit | approve | reject | flag. Older entries carry no `kind`, so infer it."""
    if entry.get("kind"):
        return entry["kind"]
    if index == 0:
        return "submit"
    return "reject" if entry.get("status") == "REJECTED" else "approve"


def approved_before(history: List[Dict[str, Any]], uid: str, role: str) -> bool:
    """True if this account already approved or forwarded the request. Entries written before account ids
    were recorded are matched by role."""
    for i, h in enumerate(history or []):
        if _kind(h, i) != "approve":
            continue
        if h.get("uid") == uid or (not h.get("uid") and h.get("role") == role):
            return True
    return False


def reviewer_has_acted(history: List[Dict[str, Any]]) -> bool:
    return any(_kind(h, i) in ("approve", "reject") for i, h in enumerate(history or []))


@dataclass
class Decision:
    can_approve: bool = False
    can_reject: bool = False
    can_withdraw: bool = False
    can_flag: bool = False
    can_resolve: bool = False
    reasons: Dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


def decide(req: Any, uid: str, role: str, unresolved_flags: int = 0) -> Decision:
    d = Decision()
    if not is_open(req.status):
        d.reasons["all"] = "This request is closed. Nothing more can be done to it. To fix the record, report an issue on the parcel."
        return d

    history = req.history or []
    holder = role == "super_admin" or role in STAGE_REVIEWERS[req.status]
    filed = bool(req.requester_uid) and req.requester_uid == uid
    prior = approved_before(history, uid, role)

    if not holder:
        why = "It is not waiting on your role."
        d.reasons["approve"] = d.reasons["reject"] = why
    elif filed:
        why = "You filed this request, so another person must act on it."
        d.reasons["approve"] = d.reasons["reject"] = why
    elif prior:
        why = "You already approved this request at an earlier stage. You can raise a concern instead."
        d.reasons["approve"] = d.reasons["reject"] = why
    else:
        d.can_reject = True
        d.can_approve = unresolved_flags == 0
        if unresolved_flags:
            d.reasons["approve"] = "Resolve the open concerns first, or reject the request."

    d.can_withdraw = filed and not reviewer_has_acted(history)
    if filed and not d.can_withdraw:
        d.reasons["withdraw"] = "A reviewer has already acted. You can raise a concern instead."

    # Concern: filers and anyone who already forwarded it, but not the account that now holds it.
    d.can_flag = filed or prior
    if not d.can_flag:
        d.reasons["flag"] = "Only the person who filed the request, or someone who already approved it, can raise a concern."
    # Resolving is the current holder's job. It is not the person who raised the concern (checked per flag).
    d.can_resolve = holder and not filed
    return d


def require(req: Any, uid: str, role: str, action: str, unresolved_flags: int = 0) -> None:
    """Raise unless `action` ('approve' or 'reject') is allowed for this account on this request."""
    d = decide(req, uid, role, unresolved_flags)
    if getattr(d, f"can_{action}"):
        return
    reason = d.reasons.get(action) or d.reasons.get("all") or "You cannot do this on this request."
    code = 409 if not is_open(req.status) or (action == "approve" and unresolved_flags and d.can_reject) else 403
    raise HTTPException(status_code=code, detail=reason)

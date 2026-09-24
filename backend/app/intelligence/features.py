"""Feature rows for the dispute-risk classifier, and the held-out label.

LABEL (what the model is trained to predict), deliberately NOT built from the features:
    1 if the Record of Rights owner differs from the Sub-Registrar deed buyer (an ownership mismatch),
      or if any change request on the parcel was rejected;
    0 otherwise.
These stand in for "this parcel became disputed". They are not adjudicated dispute outcomes: no such data
exists for this prototype. Everything here is synthetic demonstration data.

Leakage guards, so the model cannot read its own label:
    - The ownership_mismatch rule is removed from the rule-flag count.
    - Request outcomes are not features. Boundary-edit frequency counts only edits that were applied
      (approved boundary, split and merge requests), never rejected ones.
"""
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from app.intelligence.detectors import detect_flipping, _day

FEATURES = [
    "rule_flag_count",          # deterministic rule flags, excluding ownership mismatch
    "fraud_pattern_count",      # statistical patterns from the detectors
    "transfers_total",          # registered transfers on record
    "max_transfers_90d",        # most transfers inside any 90-day window
    "encumbrance_events",       # mortgages, liens and attachments ever raised
    "encumbrance_active",       # 1 if one is active now
    "boundary_edits_applied",   # approved boundary, split and merge requests
    "parcel_age_years",         # years since the earliest deed, or since entry if there is none
    "zoning_anomaly",           # 1 if the parcel does not match its neighbourhood
]

DESCRIBE = {
    "rule_flag_count": lambda v: f"{int(v)} rule flag{'s' if v != 1 else ''} other than ownership",
    "fraud_pattern_count": lambda v: f"{int(v)} transaction or ownership pattern{'s' if v != 1 else ''}",
    "transfers_total": lambda v: f"{int(v)} registered transfer{'s' if v != 1 else ''}",
    "max_transfers_90d": lambda v: f"{int(v)} ownership transfer{'s' if v != 1 else ''} within 90 days",
    "encumbrance_events": lambda v: f"{int(v)} encumbrance{'s' if v != 1 else ''} on record",
    "encumbrance_active": lambda v: "an active encumbrance" if v else "no active encumbrance",
    "boundary_edits_applied": lambda v: f"{int(v)} applied boundary change{'s' if v != 1 else ''}",
    "parcel_age_years": lambda v: f"{v:.0f} years since the first deed",
    "zoning_anomaly": lambda v: "land use unlike its neighbourhood" if v else "land use matching its neighbourhood",
}
APPLIED_EDIT_TYPES = {"BOUNDARY", "SPLIT", "MERGE"}


def _max_in_window(transactions, days=90) -> int:
    f = detect_flipping(transactions, window_days=days, min_transfers=1)
    return len(f.evidence) if f else 0


def feature_row(parcel, rule_flags: List[Dict[str, Any]], fraud: List[Dict[str, Any]], zoning_anomaly: bool,
                transactions: List[Any], encumbrances: List[Any], requests: List[Any],
                today: Optional[date] = None) -> Dict[str, float]:
    today = today or datetime.now(timezone.utc).date()
    deeds = [d for d in (_day(getattr(t, "deed_date", None) if not isinstance(t, dict) else t.get("deed_date")) for t in transactions) if d]
    first = min(deeds) if deeds else _day(parcel.created_at) or today
    get = lambda r, k: r.get(k) if isinstance(r, dict) else getattr(r, k, None)
    return {
        "rule_flag_count": float(sum(1 for f in rule_flags or [] if f.get("flag") and f.get("rule") != "ownership_mismatch")),
        "fraud_pattern_count": float(len(fraud or [])),
        "transfers_total": float(len(deeds)),
        "max_transfers_90d": float(_max_in_window(transactions)),
        "encumbrance_events": float(len(encumbrances)),
        "encumbrance_active": float(any(get(e, "cleared_at") is None for e in encumbrances)),
        "boundary_edits_applied": float(sum(1 for r in requests if get(r, "type") in APPLIED_EDIT_TYPES and get(r, "status") == "APPROVED")),
        "parcel_age_years": round(max(0.0, (today - first).days / 365.25), 2),
        "zoning_anomaly": float(bool(zoning_anomaly)),
    }


def held_out_label(parcel, requests: List[Any]) -> int:
    layers = parcel.layers or {}
    ror = str((layers.get("ror") or {}).get("owner_name") or "").strip().lower()
    buyer = str((layers.get("registration") or {}).get("buyer_name") or "").strip().lower()
    mismatch = bool(ror and buyer and ror != buyer)
    get = lambda r, k: r.get(k) if isinstance(r, dict) else getattr(r, k, None)
    rejected = any(get(r, "status") == "REJECTED" for r in requests)
    return int(mismatch or rejected)

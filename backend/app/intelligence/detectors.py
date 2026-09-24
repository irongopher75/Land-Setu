"""Fraud-pattern detectors. Pure functions: plain records in, a result out. No database access here.

Every result names the pattern, a severity and a confidence, and lists the exact records that triggered it.
A detector returns None when its pattern is absent.
"""
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from app.intelligence import config
from app.workflow import is_spelling_level_edit, _normalise

# Request types that change geometry, ownership or legal status.
SUBSTANTIVE_TYPES = {"BOUNDARY", "SPLIT", "MERGE", "DELETION"}
OWNERSHIP_FIELDS = {("ror", "owner_name"), ("ror", "owner_share"), ("registration", "buyer_name")}


@dataclass
class Finding:
    pattern: str
    severity: str            # low | medium | high
    confidence: float        # 0 to 1: how sure the detector is that this is the pattern, not a coincidence
    summary: str
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    thresholds: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _day(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date() if "T" in text else date.fromisoformat(text[:10])
    except ValueError:
        return None


def _get(r, k):
    return r.get(k) if isinstance(r, dict) else getattr(r, k, None)


# ---- 1. rapid re-transfer --------------------------------------------------------------------

def detect_flipping(transactions: Iterable[Any], window_days: Optional[int] = None,
                    min_transfers: Optional[int] = None) -> Optional[Finding]:
    """N or more ownership transfers inside any window of `window_days`."""
    window = window_days or config.flip_window_days()
    need = min_transfers or config.flip_min_transfers()
    sales = sorted(
        [t for t in transactions if _get(t, "kind") in (None, "sale", "gift") and _day(_get(t, "deed_date"))],
        key=lambda t: _day(_get(t, "deed_date")))
    best = []
    j = 0
    for i in range(len(sales)):
        while (_day(_get(sales[i], "deed_date")) - _day(_get(sales[j], "deed_date"))).days > window:
            j += 1
        if i - j + 1 > len(best):
            best = sales[j:i + 1]
    if len(best) < need:
        return None
    span = (_day(_get(best[-1], "deed_date")) - _day(_get(best[0], "deed_date"))).days
    extra = len(best) - need
    return Finding(
        pattern="rapid_retransfer",
        severity="high" if len(best) >= need + 1 or span <= window / 3 else "medium",
        confidence=round(min(0.95, 0.6 + 0.1 * extra + 0.2 * (1 - span / window)), 2),
        summary=f"{len(best)} ownership transfers in {span} days (flag at {need} within {window} days).",
        evidence=[{"transaction_id": _get(t, "transaction_id"), "deed_date": str(_get(t, "deed_date")),
                   "seller": _get(t, "seller_name"), "buyer": _get(t, "buyer_name")} for t in best],
        thresholds={"window_days": window, "min_transfers": need},
    )


# ---- 2. benami-style name repetition ---------------------------------------------------------

def same_person_name(a: str, b: str) -> bool:
    """Same name, or a spelling-level variant of it (the rule used for fast-track corrections)."""
    if not a or not b:
        return False
    return _normalise(a) == _normalise(b) or is_spelling_level_edit(a, b)


def detect_benami(ulpin: str, owner_name: str, holdings: Iterable[Dict[str, Any]],
                  min_parcels: Optional[int] = None, min_districts: Optional[int] = None) -> Optional[Finding]:
    """One name, or near-identical spellings of it, on an implausible number of parcels or districts.

    `holdings` is every active parcel as {ulpin, owner_name, district, state}.
    """
    need_p = min_parcels or config.benami_min_parcels()
    need_d = min_districts or config.benami_min_districts()
    matches = [h for h in holdings if same_person_name(owner_name, h.get("owner_name"))]
    if not any(h.get("ulpin") == ulpin for h in matches):
        matches.append({"ulpin": ulpin, "owner_name": owner_name, "district": None, "state": None})
    districts = sorted({h.get("district") for h in matches if h.get("district")})
    variants = sorted({h.get("owner_name") for h in matches if h.get("owner_name")})
    hit_p, hit_d = len(matches) >= need_p, len(districts) >= need_d
    if not (hit_p or hit_d):
        return None
    why = []
    if hit_p:
        why.append(f"{len(matches)} parcels (flag at {need_p})")
    if hit_d:
        why.append(f"{len(districts)} districts (flag at {need_d})")
    return Finding(
        pattern="name_repetition",
        severity="high" if hit_p and hit_d else "medium",
        confidence=round(0.9 if len(variants) == 1 else 0.7, 2),   # spelling variants may be different people
        summary=f"The name {owner_name!r}{' or a near-identical spelling' if len(variants) > 1 else ''} holds " + " across ".join(why) + ".",
        evidence=[{"ulpin": h.get("ulpin"), "owner_name": h.get("owner_name"), "district": h.get("district")}
                  for h in sorted(matches, key=lambda h: str(h.get("ulpin")))],
        thresholds={"min_parcels": need_p, "min_districts": need_d, "name_variants": variants},
    )


# ---- 3. lien-timing anomaly ------------------------------------------------------------------

def _substantive(req) -> bool:
    kind = _get(req, "type") or "BOUNDARY"
    if kind in SUBSTANTIVE_TYPES:
        return True
    p = _get(req, "payload") or {}
    return kind == "CORRECTION" and (p.get("layer"), p.get("field")) in OWNERSHIP_FIELDS


def detect_lien_timing(encumbrances: Iterable[Any], requests: Iterable[Any],
                       window_days: Optional[int] = None) -> Optional[Finding]:
    """A boundary, ownership or status change filed within `window_days` of an encumbrance being raised."""
    window = window_days or config.lien_window_days()
    pairs = []
    for e in encumbrances:
        raised = _day(_get(e, "raised_at"))
        if not raised:
            continue
        for r in requests:
            if not _substantive(r):
                continue
            filed = _day(_get(r, "created_at"))
            if filed is None:
                continue
            gap = (filed - raised).days
            if abs(gap) <= window:
                pairs.append((abs(gap), gap, e, r))
    if not pairs:
        return None
    pairs.sort(key=lambda x: x[0])
    closest = pairs[0][0]
    return Finding(
        pattern="lien_timing",
        severity="high" if closest <= window / 4 else "medium",
        confidence=round(max(0.5, 0.9 - closest / (window * 2)), 2),
        summary=f"A change was filed {closest} days {'after' if pairs[0][1] >= 0 else 'before'} an encumbrance was raised "
                f"(flag within {window} days).",
        evidence=[{"encumbrance": {"kind": _get(e, "kind"), "holder": _get(e, "holder"), "raised_at": str(_get(e, "raised_at")),
                                   "cleared_at": _get(e, "cleared_at")},
                   "request": {"id": _get(r, "id"), "type": _get(r, "type"), "filed_at": str(_get(r, "created_at")),
                               "status": _get(r, "status")},
                   "days_apart": gap} for _, gap, e, r in pairs],
        thresholds={"window_days": window},
    )


# ---- 4. backdating ---------------------------------------------------------------------------

def detect_backdating(transactions: Iterable[Any], parcel_created_at: Optional[str] = None,
                      parcel_is_derived: bool = False, late_days: Optional[int] = None) -> Optional[Finding]:
    """Deeds whose dates do not fit when they were recorded.

    - Dated after it was recorded (future-dated).
    - Presented more than `late_days` after execution (the Registration Act expects four months).
    - Dated before the parcel itself existed, for parcels created in LandSetu by a split, merge or approval.
      Legacy imports are excluded: their deeds naturally predate the import.
    """
    limit = late_days or config.late_registration_days()
    created = _day(parcel_created_at)
    hits = []
    for t in transactions:
        deed, rec = _day(_get(t, "deed_date")), _day(_get(t, "recorded_at"))
        if not deed or not rec:
            continue
        ev = {"transaction_id": _get(t, "transaction_id"), "deed_date": deed.isoformat(), "recorded_at": str(_get(t, "recorded_at"))}
        if deed > rec:
            hits.append({**ev, "issue": "dated after it was recorded", "days": (deed - rec).days, "weight": 3})
        elif (rec - deed).days > limit:
            hits.append({**ev, "issue": "presented long after execution", "days": (rec - deed).days, "weight": 2})
        if parcel_is_derived and created and deed < created:
            hits.append({**ev, "issue": "dated before the parcel existed", "days": (created - deed).days, "weight": 3})
    if not hits:
        return None
    top = max(hits, key=lambda h: h["weight"])
    for h in hits:
        h.pop("weight")
    return Finding(
        pattern="backdating",
        severity="high" if top["issue"] != "presented long after execution" or top["days"] > 3 * limit else "medium",
        confidence=0.9 if top["issue"] != "presented long after execution" else round(min(0.9, 0.5 + top["days"] / (10 * limit)), 2),
        summary=f"Deed {top['transaction_id']} was {top['issue']} ({top['days']} days).",
        evidence=hits,
        thresholds={"late_registration_days": limit},
    )


def run_all(ulpin: str, owner_name: str, transactions: List[Any], encumbrances: List[Any], requests: List[Any],
            holdings: List[Dict[str, Any]], created_at: Optional[str], derived: bool) -> List[Dict[str, Any]]:
    found = [
        detect_flipping(transactions),
        detect_benami(ulpin, owner_name, holdings),
        detect_lien_timing(encumbrances, requests),
        detect_backdating(transactions, created_at, derived),
    ]
    return [f.as_dict() for f in found if f is not None]

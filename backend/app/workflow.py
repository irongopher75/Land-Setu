"""Request pipeline helpers shared by routes: audit trail and per-type apply logic."""
import copy
import difflib
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from sqlalchemy.orm import Session

from app.db import IS_SQLITE
from app.models import Parcel, BoundaryChangeRequest
from app.rules import RuleEngine, parse_geometry_shape, invalidate_neighbor_flags
from app import audit

NEW_TYPES = ("SPLIT", "MERGE", "CORRECTION")

# Fields a correction request may change. Everything else needs a boundary or deletion request.
CORRECTABLE_FIELDS = {
    "ror": {"owner_name", "khata_no", "owner_share"},
    "registration": {"buyer_name"},
    "zoning": {"land_use"},
}

SPLIT_COVERAGE_TOLERANCE = 0.02  # parts may differ from the source by at most 2% of its area


# ---------------------------------------------------------------------------------------------
# Approval tracks
#
#   HIGH  village officer proposes, auditor reviews, state admin gives final approval.
#         Anything that touches geometry, ownership or a parcel's legal status.
#   FAST  one approver, an auditor or a state admin. Metadata-only corrections.
#
# The request `type` decides the track. Ownership changes are corrections to owner or buyer fields,
# so those fields are always HIGH. There is no separate transfer type.
# ---------------------------------------------------------------------------------------------
TRACK_HIGH, TRACK_FAST = "HIGH", "FAST"
FAST_STATUS = "PENDING_FAST_REVIEW"
FAST_APPROVER_ROLES = ("auditor", "state_admin", "super_admin")

HIGH_RIGOR_TYPES = ("BOUNDARY", "SPLIT", "MERGE", "DELETION")
# Correction fields that may be fast-tracked, and only for a spelling-level edit.
FAST_CORRECTION_FIELDS = {"ror": {"owner_name", "khata_no"}}
SPELLING_SIMILARITY = 0.85


def _normalise(text: str) -> str:
    joined = re.sub(r"[-_/]", "", str(text or "").lower())  # KH-1187 and KH1187 are the same reference
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", joined)).strip()


def is_spelling_level_edit(current: Any, requested: Any) -> bool:
    """True when `requested` is the same name or reference as `current` with a spelling or format fix.

    Same initials in order, same digits, and at least 85% similar after ignoring case and punctuation.
    A different person or a different account number fails one of these and is escalated.
    """
    a, b = _normalise(current), _normalise(requested)
    if not a or not b:
        return False
    if [w[0] for w in a.split()] != [w[0] for w in b.split()]:
        return False
    if re.sub(r"\D", "", a) != re.sub(r"\D", "", b):
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= SPELLING_SIMILARITY


def route_request(req_type: str, payload: Optional[Dict[str, Any]] = None) -> str:
    """Decide which approval track a request follows."""
    if req_type in HIGH_RIGOR_TYPES:
        return TRACK_HIGH
    if req_type == "CORRECTION":
        p = payload or {}
        if p.get("field") in FAST_CORRECTION_FIELDS.get(p.get("layer"), set()) and \
                is_spelling_level_edit(p.get("current"), p.get("requested")):
            return TRACK_FAST
        return TRACK_HIGH
    return TRACK_HIGH  # unknown types get the stricter track


def forbid_self_approval(req: BoundaryChangeRequest, actor: Dict[str, Any]) -> None:
    """Nobody, including a super admin, may act on a request they filed."""
    if req.requester_uid and req.requester_uid == actor.get("sub"):
        raise HTTPException(status_code=403, detail="You filed this request, so another person must act on it.")


def advance_request(req: BoundaryChangeRequest, status: str, role: str, note: str = "",
                    db: Optional[Session] = None, submitted: bool = False, event: Optional[str] = None,
                    actor_uid: Optional[str] = None) -> None:
    """Set status and append to the request history and, when `db` is given, to the audit chain.
    Each history entry records who acted (`uid`) and what kind of act it was (`kind`), which the
    separation-of-duties rules read. Caller commits. `req` must already have an id when `db` is given."""
    previous = req.status
    kind = "submit" if submitted else ("reject" if status == "REJECTED" else "approve")
    req.history = list(req.history or []) + [{
        "at": datetime.utcnow().isoformat(),
        "status": status,
        "role": role,
        "uid": actor_uid,
        "kind": kind,
        "note": note,
    }]
    req.status = status
    if db is not None:
        from app.intelligence.service import mark_stale
        p = req.payload or {}
        mark_stale(db, req.state, [p.get("current"), p.get("requested")] if p.get("field") == "owner_name" else [])
        audit.append(db, req.ulpin, event or audit.event_for(status, submitted), role, request_id=req.id,
                     from_status=None if submitted else previous, to_status=status, note=note, payload=req.payload,
                     actor_uid=actor_uid)


def note_history(req: BoundaryChangeRequest, kind: str, role: str, uid: Optional[str], note: str) -> None:
    """Record a non-status event (a concern) in the request history."""
    req.history = list(req.history or []) + [{
        "at": datetime.utcnow().isoformat(), "status": req.status, "role": role, "uid": uid, "kind": kind, "note": note,
    }]


def archive_parcel(db: Session, parcel: Parcel, status: str, reason: str, role: str,
                   superseded_by: Optional[str] = None, request_id: Optional[int] = None) -> None:
    """Retire a parcel without removing it. `status` is 'archived' or 'superseded'."""
    parcel.status = status
    parcel.archived_at = datetime.utcnow().isoformat()
    parcel.archived_reason = reason
    parcel.superseded_by = superseded_by
    audit.append(db, parcel.ulpin, "archived" if status == "archived" else "superseded", role,
                 request_id=request_id, from_status="active", to_status=status, note=reason)


def geom_column_value(geom_shape):
    if IS_SQLITE:
        return mapping(geom_shape)
    from geoalchemy2.shape import from_shape
    return from_shape(geom_shape, srid=4326)


def _require_polygon(geojson: Dict[str, Any], label: str):
    try:
        g = shape(geojson)
    except Exception:
        raise HTTPException(status_code=422, detail=f"{label}: invalid GeoJSON")
    if g.geom_type != "Polygon" or g.is_empty or not g.is_valid:
        raise HTTPException(status_code=422, detail=f"{label}: must be a valid, non-empty Polygon")
    return g


def validate_split(source: Parcel, parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(parts) != 2:
        raise HTTPException(status_code=422, detail="A split needs exactly two parts.")
    src = parse_geometry_shape(source.geometry)
    shapes = [_require_polygon(p.get("geometry"), f"Part {i + 1}") for i, p in enumerate(parts)]
    if shapes[0].intersection(shapes[1]).area > src.area * 0.001:
        raise HTTPException(status_code=422, detail="The two parts overlap each other.")
    mismatch = src.symmetric_difference(unary_union(shapes)).area / src.area
    if mismatch > SPLIT_COVERAGE_TOLERANCE:
        raise HTTPException(
            status_code=422,
            detail=f"The two parts must together cover the original parcel ({mismatch:.1%} differs, limit {SPLIT_COVERAGE_TOLERANCE:.0%}).",
        )
    total_area = float(source.area_sqm or 0)
    src_geo_area = src.area or 1.0
    return [
        {
            "ulpin": f"{source.ulpin}-S{i + 1}",
            "geometry": mapping(sh),
            "area_sqm": round(total_area * sh.area / src_geo_area, 2),
        }
        for i, sh in enumerate(shapes)
    ]


def validate_merge(primary: Parcel, other: Parcel):
    if primary.ulpin == other.ulpin:
        raise HTTPException(status_code=422, detail="Pick two different parcels to merge.")
    if primary.state != other.state:
        raise HTTPException(status_code=422, detail="Parcels in different states cannot be merged.")
    o1 = ((primary.layers or {}).get("ror") or {}).get("owner_name")
    o2 = ((other.layers or {}).get("ror") or {}).get("owner_name")
    if o1 and o2 and o1.strip().lower() != o2.strip().lower():
        raise HTTPException(
            status_code=422,
            detail=f"Record of Rights owners differ ('{o1}' and '{o2}'). Correct the ownership record before merging.",
        )
    union = unary_union([parse_geometry_shape(primary.geometry), parse_geometry_shape(other.geometry)])
    if union.geom_type != "Polygon":
        raise HTTPException(status_code=422, detail="Parcels must share a boundary to be merged.")
    return union


def validate_correction(parcel: Parcel, layer: str, field: str, requested: Any) -> Dict[str, Any]:
    if field not in CORRECTABLE_FIELDS.get(layer, set()):
        allowed = ", ".join(f"{l}.{f}" for l, fs in CORRECTABLE_FIELDS.items() for f in sorted(fs))
        raise HTTPException(status_code=422, detail=f"'{layer}.{field}' cannot be corrected here. Allowed: {allowed}.")
    if requested is None or str(requested).strip() == "":
        raise HTTPException(status_code=422, detail="Requested value is required.")
    current = ((parcel.layers or {}).get(layer) or {}).get(field)
    return {"layer": layer, "field": field, "current": current, "requested": str(requested).strip()}


def _fresh_ulpin_check(db: Session, ulpin: str):
    if db.query(Parcel.id).filter(Parcel.ulpin == ulpin).first():
        raise HTTPException(status_code=409, detail=f"ULPIN '{ulpin}' already exists.")


def apply_request(db: Session, req: BoundaryChangeRequest, role: str = "system") -> None:
    """Commit an approved SPLIT / MERGE / CORRECTION to the parcels table. Caller commits."""
    payload = req.payload or {}
    source = db.query(Parcel).filter(Parcel.ulpin == req.ulpin).first()
    if not source:
        raise HTTPException(status_code=404, detail=f"Parcel '{req.ulpin}' no longer exists.")
    if source.status != "active":
        raise HTTPException(status_code=409, detail=f"Parcel '{req.ulpin}' is {source.status} and cannot be changed.")
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if req.type == "SPLIT":
        old_geom, state = source.geometry, source.state
        children = []
        for part in payload.get("parts", []):
            _fresh_ulpin_check(db, part["ulpin"])
            child = Parcel(
                ulpin=part["ulpin"], state=state, area_sqm=part["area_sqm"],
                geometry=geom_column_value(shape(part["geometry"])),
                layers=copy.deepcopy(source.layers or {}),
                raw_record={"lineage": {"split_from": source.ulpin, "request_id": req.id, "on": today}},
                district=source.district, created_at=datetime.utcnow().isoformat() + "+00:00",
            )
            db.add(child)
            children.append(child)
        invalidate_neighbor_flags(db, [old_geom], state, exclude_id=source.id)
        archive_parcel(db, source, "superseded", f"Split into {', '.join(c.ulpin for c in children)}", role,
                       superseded_by=",".join(c.ulpin for c in children), request_id=req.id)
        db.flush()
        for c in children:
            audit.append(db, c.ulpin, "created", role, request_id=req.id, to_status="active", note=f"Created by splitting {source.ulpin}")
            invalidate_neighbor_flags(db, [c.geometry], state, exclude_id=c.id)
            RuleEngine.refresh_flags(db, c)

    elif req.type == "MERGE":
        other = db.query(Parcel).filter(Parcel.ulpin == (payload.get("merge_ulpins") or [None, None])[1]).first()
        if not other:
            raise HTTPException(status_code=404, detail="The parcel to merge in no longer exists.")
        union = validate_merge(source, other)
        old_geoms = [source.geometry, other.geometry]
        state = source.state
        source.geometry = geom_column_value(union)
        source.area_sqm = float(source.area_sqm or 0) + float(other.area_sqm or 0)
        source.raw_record = {**(source.raw_record or {}), "lineage": {"merged_from": [other.ulpin], "request_id": req.id, "on": today}}
        invalidate_neighbor_flags(db, old_geoms, state, exclude_id=source.id)
        archive_parcel(db, other, "superseded", f"Merged into {source.ulpin}", role, superseded_by=source.ulpin, request_id=req.id)
        db.flush()
        invalidate_neighbor_flags(db, [source.geometry], state, exclude_id=source.id)
        RuleEngine.refresh_flags(db, source)

    elif req.type == "CORRECTION":
        layer, field = payload["layer"], payload["field"]
        if field not in CORRECTABLE_FIELDS.get(layer, set()):
            raise HTTPException(status_code=422, detail="Field is not correctable.")
        layers = copy.deepcopy(source.layers or {})
        layers.setdefault(layer, {})[field] = payload["requested"]
        layers[layer]["last_verified"] = today
        source.layers = layers  # reassign so JSON change is tracked
        db.flush()
        RuleEngine.refresh_flags(db, source)


def build_history(parcel: Parcel, requests: List[BoundaryChangeRequest]) -> List[Dict[str, Any]]:
    """Chronological events from department layers, lineage and the request audit trail."""
    layers = parcel.layers or {}
    ev: List[Dict[str, Any]] = []

    def add(date, kind, title, detail="", source=None, confidence=None):
        ev.append({"date": date, "kind": kind, "title": title, "detail": detail,
                   "source": source, "confidence": confidence})

    ror = layers.get("ror") or {}
    if ror:
        add(ror.get("last_verified"), "ror", f"Record of Rights: owner {ror.get('owner_name', 'not recorded')}",
            f"Khata {ror.get('khata_no', 'not recorded')}", ror.get("source"), ror.get("confidence"))
    reg = layers.get("registration") or {}
    if reg:
        add(reg.get("date"), "registration",
            f"Registration: {reg.get('transaction_type', 'transaction')} {reg.get('last_transaction_id', '')}".strip(),
            f"Buyer {reg.get('buyer_name')}" if reg.get("buyer_name") else "", reg.get("source"), reg.get("confidence"))
    permit = layers.get("building_permit") or {}
    if permit:
        add(permit.get("date") or permit.get("approved_on"), "permit",
            f"Building permit {permit.get('permit_id', '')} {permit.get('status', '')}".strip(),
            f"Approved FSI {permit.get('approved_fsi')}" if permit.get("approved_fsi") is not None else "",
            permit.get("source"), permit.get("confidence"))
    tax = layers.get("tax") or {}
    if tax:
        add(tax.get("last_verified"), "tax", "Property tax assessed",
            f"Annual value Rs {tax.get('annual_value')}" if tax.get("annual_value") else "",
            tax.get("source"), tax.get("confidence"))
    lineage = (parcel.raw_record or {}).get("lineage")
    if lineage:
        src = lineage.get("split_from") or ", ".join(lineage.get("merged_from", []))
        kind = "Split from" if lineage.get("split_from") else "Merged with"
        add(lineage.get("on"), "request", f"{kind} {src}", f"Request #{lineage.get('request_id')}")

    for r in requests:
        label = {"BOUNDARY": "Boundary change", "DELETION": "Deletion", "SPLIT": "Split",
                 "MERGE": "Merge", "CORRECTION": "Correction"}.get(r.type or "BOUNDARY", "Request")
        if str(r.status or "").startswith("PENDING_DELETION") or (r.status in ("DELETED", "ARCHIVED")):
            label = "Deletion"
        add(r.created_at, "request", f"{label} requested (#{r.id})", r.reason or "", r.requester_role)
        for h in (r.history or []):
            add(h.get("at"), "request", f"{label} #{r.id}: {h.get('status', '').replace('_', ' ').lower()}",
                h.get("note", ""), h.get("role"))

    ev.sort(key=lambda e: (e["date"] is None, str(e["date"] or "")))
    return ev


MAX_OPEN_REQUESTS_PER_ACCOUNT = 5


def enforce_open_request_cap(db: Session, requester_uid: Optional[str], role: str) -> None:
    """One account may hold at most this many open requests at a time, so nobody can flood the review queue.
    Officers file as part of their job and are exempt."""
    if not requester_uid or role not in ("citizen", "bank"):
        return
    import os
    from app.permissions import STAGE_REVIEWERS
    cap = int(os.getenv("MAX_OPEN_REQUESTS_PER_ACCOUNT", MAX_OPEN_REQUESTS_PER_ACCOUNT))
    n = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.requester_uid == requester_uid,
                                               BoundaryChangeRequest.status.in_(list(STAGE_REVIEWERS))).count()
    if n >= cap:
        raise HTTPException(status_code=429, detail=f"You already have {n} requests under review. Wait for a decision before filing more.")

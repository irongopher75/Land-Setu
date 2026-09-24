"""Compute, cache and invalidate parcel intelligence. Same pattern as rule flags: computed on write-driven
invalidation, read from the cache, recomputed only when a row is stale or missing."""
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.intelligence import detectors, zoning
from app.models import (BoundaryChangeRequest, EncumbranceEvent, Parcel, ParcelIntelligence, RegistrationTransaction)
from app.rules import parse_geometry_shape


def _owner(p: Parcel) -> Optional[str]:
    return ((p.layers or {}).get("ror") or {}).get("owner_name")


def _derived(p: Parcel) -> bool:
    """Created inside LandSetu (split, merge or an approved new boundary), not loaded from a source register."""
    raw = p.raw_record or {}
    return bool(raw.get("lineage")) or not raw


def _holdings(db: Session) -> List[Dict[str, Any]]:
    return [{"ulpin": p.ulpin, "owner_name": _owner(p), "district": p.district, "state": p.state}
            for p in db.query(Parcel).filter(Parcel.status == "active").all()]


def compute_state(db: Session, state: str, risk_model=None) -> int:
    """Recompute every active parcel in `state`. Zoning is a per-state computation, so this is the unit of work."""
    parcels = db.query(Parcel).filter(Parcel.state == state, Parcel.status == "active").all()
    if not parcels:
        return 0
    ulpins = [p.ulpin for p in parcels]
    txns, encs, reqs = {}, {}, {}
    for t in db.query(RegistrationTransaction).filter(RegistrationTransaction.ulpin.in_(ulpins)).all():
        txns.setdefault(t.ulpin, []).append(t)
    for e in db.query(EncumbranceEvent).filter(EncumbranceEvent.ulpin.in_(ulpins)).all():
        encs.setdefault(e.ulpin, []).append(e)
    for r in db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.ulpin.in_(ulpins)).all():
        reqs.setdefault(r.ulpin, []).append(r)
    holdings = _holdings(db)

    points = []
    for p in parcels:
        shp = parse_geometry_shape(p.geometry)
        c = shp.centroid if shp is not None and not shp.is_empty else None
        points.append({"ulpin": p.ulpin, "lng": c.x if c else None, "lat": c.y if c else None,
                       "land_use": ((p.layers or {}).get("zoning") or {}).get("land_use")})
    zones = zoning.find_zoning_anomalies(points)

    existing = {r.ulpin: r for r in db.query(ParcelIntelligence).filter(ParcelIntelligence.ulpin.in_(ulpins)).all()}
    now = datetime.now(timezone.utc).isoformat()
    for p in parcels:
        fraud = detectors.run_all(p.ulpin, _owner(p), txns.get(p.ulpin, []), encs.get(p.ulpin, []), reqs.get(p.ulpin, []),
                                  holdings, p.created_at, _derived(p))
        z = zones.get(p.ulpin, {})
        row = existing.get(p.ulpin) or ParcelIntelligence(ulpin=p.ulpin, state=p.state)
        row.state = p.state
        row.fraud_flags = fraud
        row.zoning_anomaly = bool(z.get("anomaly"))
        row.zoning_explanation = z.get("explanation")
        row.risk_score, row.risk_score_factors = None, None
        if risk_model is not None:
            row.risk_score, row.risk_score_factors = risk_model.score(db, p, fraud, row.zoning_anomaly,
                                                                      txns.get(p.ulpin, []), encs.get(p.ulpin, []),
                                                                      reqs.get(p.ulpin, []))
        row.computed_at = now
        row.stale = False
        if p.ulpin not in existing:
            db.add(row)
    db.commit()
    return len(parcels)


def _model():
    try:
        from app.intelligence.risk import load_model
        return load_model()
    except Exception:
        return None


def get(db: Session, ulpin: str) -> Optional[ParcelIntelligence]:
    """Cached row, recomputing the parcel's state if the row is stale or missing."""
    p = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not p:
        return None
    row = db.query(ParcelIntelligence).filter(ParcelIntelligence.ulpin == ulpin).first()
    if p.status == "active" and (row is None or row.stale):
        compute_state(db, p.state, _model())
        row = db.query(ParcelIntelligence).filter(ParcelIntelligence.ulpin == ulpin).first()
    return row


def ensure_fresh(db: Session) -> None:
    """Recompute every state that has stale or missing rows. Used before aggregate views."""
    states = {s for (s,) in db.query(Parcel.state).filter(Parcel.status == "active").distinct().all()}
    have = {u for (u,) in db.query(ParcelIntelligence.ulpin).filter(ParcelIntelligence.stale.is_(False)).all()}
    model = None
    for st in sorted(states):
        active = {u for (u,) in db.query(Parcel.ulpin).filter(Parcel.state == st, Parcel.status == "active").all()}
        if not active <= have:
            model = model or _model()
            compute_state(db, st, model)


def mark_stale(db: Session, state: Optional[str] = None, owner_names: Iterable[str] = ()) -> None:
    """Invalidate after a write. Zoning depends on the whole state; name repetition depends on everyone with a
    similar name, in any state. The caller commits."""
    if state:
        db.execute(update(ParcelIntelligence).where(ParcelIntelligence.state == state).values(stale=True))
    names = [n for n in owner_names if n]
    if names:
        hits = [p.ulpin for p in db.query(Parcel).filter(Parcel.status == "active").all()
                if any(detectors.same_person_name(n, _owner(p)) for n in names)]
        if hits:
            db.execute(update(ParcelIntelligence).where(ParcelIntelligence.ulpin.in_(hits)).values(stale=True))

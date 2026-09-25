"""Statistical signals per parcel and in aggregate. Officers only.

Name-repetition findings list other people's holdings, which is a profile of a person. That is why these
routes need an officer session even though the parcel record itself is public.
"""
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.intelligence import service
from app.models import ParcelIntelligence, Parcel
from app.routes.auth import require_roles

router = APIRouter(prefix="/parcels", tags=["Intelligence"])
OFFICERS = ("village_officer", "auditor", "state_admin", "officer")

RISK_WITHHELD = ("A dispute-risk model was trained but its score is not shown: with 3 positive examples its output is not "
                 "reliable. See section 5C of the technical document.")

NOTE = ("Statistical signals, not findings. Each one is a prompt to check the listed records. The demonstration "
        "data includes planted synthetic cases; see the synthetic_fixture field on those parcels.")


def _view(row: ParcelIntelligence, parcel: Parcel):
    fixture = (parcel.raw_record or {}).get("synthetic_fixture")
    return {
        "ulpin": row.ulpin, "computed_at": row.computed_at, "note": NOTE,
        "synthetic_fixture": fixture,
        "fraud_patterns": row.fraud_flags or [],
        "zoning": {"anomaly": bool(row.zoning_anomaly), "explanation": row.zoning_explanation},
        "risk": None if row.risk_score is None else {"score": row.risk_score, **(row.risk_score_factors or {})},
        "risk_status": None if row.risk_score is not None else RISK_WITHHELD,
    }


@router.get("/analytics/intelligence")
def intelligence_summary(role: str = Depends(require_roles("state_admin")), db: Session = Depends(get_db)):
    service.ensure_fresh(db)
    rows = db.query(ParcelIntelligence).filter(ParcelIntelligence.stale.is_(False)).all()
    active = {p.ulpin: p for p in db.query(Parcel).filter(Parcel.status == "active").all()}
    rows = [r for r in rows if r.ulpin in active]
    patterns = Counter(f["pattern"] for r in rows for f in (r.fraud_flags or []))
    scored = [r.risk_score for r in rows if r.risk_score is not None]
    bands = Counter("high" if s >= 0.66 else "medium" if s >= 0.33 else "low" for s in scored)
    by_state = {}
    for r in rows:
        s = by_state.setdefault(r.state, {"state": r.state, "parcels": 0, "with_patterns": 0, "zoning_anomalies": 0})
        s["parcels"] += 1
        s["with_patterns"] += int(bool(r.fraud_flags))
        s["zoning_anomalies"] += int(bool(r.zoning_anomaly))
    top = sorted((r for r in rows if r.fraud_flags or r.zoning_anomaly),
                 key=lambda r: (-(r.risk_score or 0), -len(r.fraud_flags or []), r.ulpin))[:15]
    return {
        "note": NOTE,
        "parcels": len(rows),
        "with_fraud_patterns": sum(1 for r in rows if r.fraud_flags),
        "patterns": dict(patterns),
        "zoning_anomalies": sum(1 for r in rows if r.zoning_anomaly),
        "risk_status": RISK_WITHHELD if not scored else None,
        "risk": {"scored": len(scored), "bands": dict(bands),
                 "histogram": [sum(1 for s in scored if i / 10 <= s < (i + 1) / 10 or (i == 9 and s == 1.0)) for i in range(10)]},
        "states": sorted(by_state.values(), key=lambda s: s["state"]),
        "top": [{"ulpin": r.ulpin, "state": r.state, "patterns": [f["pattern"] for f in (r.fraud_flags or [])],
                 "zoning_anomaly": bool(r.zoning_anomaly), "risk_score": r.risk_score,
                 "synthetic_fixture": (active[r.ulpin].raw_record or {}).get("synthetic_fixture")} for r in top],
    }


@router.get("/{ulpin}/intelligence")
def parcel_intelligence(ulpin: str, role: str = Depends(require_roles(*OFFICERS)), db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")
    row = service.get(db, ulpin)
    if row is None:
        return {"ulpin": ulpin, "note": "This parcel is not active, so no signals are computed for it.",
                "fraud_patterns": [], "zoning": {"anomaly": False, "explanation": None}, "risk": None}
    return _view(row, parcel)

import os
from datetime import datetime

# Rate limits are switched off for the suite. test_security.py turns them on for its own checks.
os.environ.setdefault("RATE_LIMIT_DISABLED", "true")


def insert_parcel(ulpin, geometry, owner="Asha Rao", state="TamilNadu", area_sqm=1000.0):
    """Put an approved parcel straight into the database for test setup.

    The API has no direct-save path: every boundary goes through the approval pipeline. Tests that are
    about something else use this instead of walking three reviewers each time.
    """
    from shapely.geometry import shape
    from app.db import SessionLocal
    from app.models import Parcel
    from app.workflow import geom_column_value
    from app import audit

    today = datetime.utcnow().strftime("%Y-%m-%d")
    tail = ulpin[-4:]
    layers = {
        "ror": {"owner_name": owner, "khata_no": f"KH-MANUAL-{tail}", "source": "manual_gis_entry", "last_verified": today, "confidence": "verified"},
        "registration": {"last_transaction_id": f"REG-MANUAL-{tail}", "date": today, "buyer_name": owner, "source": "sub_registrar", "confidence": "verified"},
        "zoning": {"land_use": "residential", "permitted_fsi": 1.5, "source": "master_plan_2021", "confidence": "verified"},
        "building_permit": {"status": "approved", "permit_id": f"BP-MANUAL-{tail}", "approved_fsi": 1.5, "source": "municipal_corp", "confidence": "verified"},
        "tax": {"annual_value": 45000, "source": "revenue_dept", "last_verified": today, "confidence": "verified"},
        "encumbrance": {"active": False, "source": "sub_registrar", "confidence": "verified"},
    }
    db = SessionLocal()
    try:
        db.add(Parcel(ulpin=ulpin, state=state, area_sqm=area_sqm, geometry=geom_column_value(shape(geometry)), layers=layers))
        db.flush()
        audit.append(db, ulpin, "imported", "system", to_status="active", note="Test setup")
        db.commit()
    finally:
        db.close()

import os
from datetime import datetime

# Rate limits are switched off for the suite. test_security.py turns them on for its own checks.
os.environ.setdefault("RATE_LIMIT_DISABLED", "true")


def insert_parcel(ulpin, geometry, owner="Asha Rao", state="TamilNadu", area_sqm=1000.0, admin_path=None):
    """Put an approved parcel straight into the database for test setup.

    The API has no direct-save path: every boundary goes through the approval pipeline. Tests that are
    about something else use this instead of walking three reviewers each time.

    `admin_path` sets Parcel.admin_path directly (no Phase 4 jurisdiction-backfill script exists yet, see
    docs/rbac-migration-plan.md) — pass the same path used for a pg_officer_session's admin unit so
    app.authz.can_read_parcel finds a match for tests exercising the new Postgres-native read paths.
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
        db.add(Parcel(ulpin=ulpin, state=state, area_sqm=area_sqm, geometry=geom_column_value(shape(geometry)),
                      layers=layers, admin_path=admin_path,
                      jurisdiction_status="resolved" if admin_path else "unresolved"))
        db.flush()
        audit.append(db, ulpin, "imported", "system", to_status="active", note="Test setup")
        db.commit()
    finally:
        db.close()


def pg_officer_headers(role="village_officer", admin_path="test.unit"):
    """Create a Postgres-native officer account + active assignment over an admin_unit at `admin_path`,
    mint a session directly (app.session.issue_session — skips the password login round trip, which
    isn't what these tests are about), and return Bearer headers for it. Pass the same `admin_path` to
    `insert_parcel` so the parcel is inside this officer's scope.
    """
    import uuid
    from datetime import datetime, timezone
    from app.db import SessionLocal
    from app.models import AdminUnit, OfficerAssignment, User
    from app.password import hash_password
    from app.session import issue_session

    db = SessionLocal()
    try:
        user = User(username=f"test-{role}-{uuid.uuid4().hex[:8]}", user_type="officer",
                    password_hash=hash_password("x"), is_active=True,
                    created_at=datetime.now(timezone.utc).isoformat())
        db.add(user)
        db.commit()
        db.refresh(user)

        unit = db.query(AdminUnit).filter(AdminUnit.path == admin_path).first()
        if unit is None:
            unit = AdminUnit(level="village", name=admin_path, slug=f"{admin_path.replace('.', '_')}", path=admin_path)
            db.add(unit)
            db.commit()
            db.refresh(unit)

        db.add(OfficerAssignment(user_id=user.id, role=role, admin_unit_id=unit.id,
                                  valid_from=datetime.now(timezone.utc).isoformat(), valid_to=None))
        db.commit()
        token = issue_session(db, user.id)
        return {"Authorization": f"Bearer {token}"}
    finally:
        db.close()


def pg_citizen_headers(*ulpins, citizen_uid=None):
    """Create a Postgres-native citizen account that owns every ulpin in `ulpins` (a parcel_owners row
    each — the only way app.authz.can_read_parcel lets a citizen read a parcel under the new system),
    mint a session, and return Bearer headers for it."""
    import uuid
    from datetime import datetime, timezone
    from app.db import SessionLocal
    from app.models import Citizen, ParcelOwner, User
    from app.password import hash_password
    from app.session import issue_session

    citizen_uid = citizen_uid or ("2" + uuid.uuid4().hex[:11])
    db = SessionLocal()
    try:
        user = User(username=None, user_type="citizen", password_hash=hash_password("x"), is_active=True,
                    created_at=datetime.now(timezone.utc).isoformat())
        db.add(user)
        db.commit()
        db.refresh(user)
        db.add(Citizen(citizen_uid=citizen_uid, user_id=user.id, name="Test Citizen", masked_display="XXXX-0000"))
        for ulpin in ulpins:
            db.add(ParcelOwner(ulpin=ulpin, citizen_uid=citizen_uid, share_fraction=1.0, source="seed"))
        db.commit()
        token = issue_session(db, user.id)
        return {"Authorization": f"Bearer {token}"}
    finally:
        db.close()

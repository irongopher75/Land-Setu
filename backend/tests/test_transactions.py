import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from conftest import insert_parcel
from fastapi.testclient import TestClient
from datetime import datetime, timedelta

from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import Parcel, RegistrationTransaction
from app import audit
from app.seed import seed_database
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def as_role(client, role, uid=None):
    """Sign in with a bearer token. Each role gets its own account id unless `uid` names another person."""
    client.cookies.clear()
    client.headers["Authorization"] = f"Bearer {auth_mod.create_jwt_token(role, uid or f'u-{role}')}"
    return client


AREA = 12000.0  # about the geodesic area of a 0.001 degree square at these latitudes; other areas raise a rule flag


def square(x, y, w=0.001, h=0.001):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]}


def setup_parcel(ulpin, x, y, state="TamilNadu", kind="sale", buyer="Meena Iyer", leasehold=False, land_use=None):
    insert_parcel(ulpin, square(x, y), owner="Asha Rao", state=state, area_sqm=AREA)
    db = SessionLocal()
    today = datetime.utcnow()
    db.add(RegistrationTransaction(ulpin=ulpin, transaction_id=f"REG-T-{ulpin}", kind=kind, seller_name="Asha Rao",
                                   buyer_name=buyer, deed_date=(today - timedelta(days=10)).strftime("%Y-%m-%d"),
                                   recorded_at=today.isoformat()))
    if leasehold:
        p = db.query(Parcel).filter(Parcel.ulpin == ulpin).first()
        layers = dict(p.layers)
        layers["ror"] = {**layers["ror"], "owner_share": "leasehold"}
        p.layers = layers
    db.commit()
    db.close()
    return f"REG-T-{ulpin}"


def open_tx(client, ulpin, deed, kind="sale", **extra):
    return as_role(client, "officer").post("/transactions", json={
        "ulpin": ulpin, "transaction_type": kind, "deed_reference": deed, **extra})


def act(client, role, tx_id, action="approve", remarks="", uid=None):
    return as_role(client, role, uid).patch(f"/transactions/{tx_id}/stage", json={"action": action, "remarks": remarks})


def dept(tx, name):
    return next(d for d in tx["departments"] if d["department"] == name)


def test_deed_must_resolve_to_registration_record(client):
    deed = setup_parcel("TX-DEED", 80.40, 13.30)
    assert open_tx(client, "TX-DEED", "REG-NOPE").status_code == 422
    assert open_tx(client, "TX-DEED", deed, kind="gift").status_code == 422   # deed is registered as a sale
    assert as_role(client, "citizen").post("/transactions", json={
        "ulpin": "TX-DEED", "transaction_type": "sale", "deed_reference": deed}).status_code == 403


def test_tamil_nadu_auto_mutation_runs_whole_chain(client):
    deed = setup_parcel("TX-TN", 80.41, 13.31)
    r = open_tx(client, "TX-TN", deed)
    assert r.status_code == 201, r.text
    tx = r.json()
    assert tx["status"] == "pending" and tx["current_department"] == "REGISTRATION"
    assert tx["auto_mutation"]["eligible"], tx["auto_mutation"]
    assert [d["department"] for d in tx["departments"]] == ["REGISTRATION", "REVENUE", "MUNICIPAL"]  # no RI, no planning
    tid = tx["id"]

    assert act(client, "village_officer", tid).status_code == 409      # not handed off yet
    assert as_role(client, "village_officer").post(f"/transactions/{tid}/handoff", json={
        "to_department": "REVENUE", "reason": "Deed registered"}).status_code == 403
    r = as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    assert r.status_code == 200, r.text
    tx = r.json()
    rev = dept(tx, "REVENUE")
    assert [s["action"] for s in rev["stages"]] == ["auto_verified", None]   # field stage fast-tracked, approval waits
    assert tx["current_stage"] == "Tahsildar approval"

    assert act(client, "village_officer", tid).status_code == 403     # not this role's stage
    r = act(client, "state_admin", tid)
    assert r.status_code == 200, r.text
    tx = r.json()
    # Municipal started on its own after Revenue approved, re-keyed tax, and the chain is finished.
    assert tx["status"] == "approved" and tx["current_stage"] == "Completed"
    assert tx["municipal_push"]["assessee_after"] == "Meena Iyer"
    assert [(h["from_department"], h["to_department"]) for h in tx["handoffs"]] == [
        (None, "REGISTRATION"), ("REGISTRATION", "REVENUE"), ("REVENUE", "MUNICIPAL")]
    assert dept(tx, "MUNICIPAL")["stages"][0]["action"] == "auto_rekeyed"
    assert any(n["event"] == "municipal_push" for n in tx["notifications"])
    db = SessionLocal()
    layers = db.query(Parcel).filter(Parcel.ulpin == "TX-TN").first().layers
    assert layers["ror"]["owner_name"] == "Meena Iyer" and layers["tax"]["assessee_name"] == "Meena Iyer"
    db.close()
    lst = as_role(client, "citizen").get("/parcels/TX-TN/transactions")
    assert lst.status_code == 200 and lst.json()[0]["id"] == tid
    assert act(client, "state_admin", tid).status_code == 409         # closed


def test_gift_needs_every_revenue_stage_and_planning(client):
    deed = setup_parcel("TX-GIFT", 80.42, 13.32, kind="gift")
    tx = open_tx(client, "TX-GIFT", deed, kind="gift", land_use_change_to="commercial").json()
    assert not tx["auto_mutation"]["eligible"]
    assert [d["department"] for d in tx["departments"]] == ["REGISTRATION", "REVENUE", "MUNICIPAL", "PLANNING"]
    tid = tx["id"]
    as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    assert act(client, "village_officer", tid).status_code == 200
    assert act(client, "auditor", tid).status_code == 200
    tx = act(client, "state_admin", tid).json()
    assert tx["current_department"] == "MUNICIPAL" and tx["status"] == "in_review"   # planning still to come
    assert tx["current_stage"] == "Waiting for handoff to Town and Country Planning"
    assert as_role(client, "state_admin").post(f"/transactions/{tid}/handoff", json={
        "to_department": "PLANNING", "reason": "Land use changes to commercial"}).status_code == 200
    tx = act(client, "state_admin", tid).json()
    assert tx["status"] == "approved"


def test_chandigarh_leasehold_goes_through_estate_office_before_municipal(client):
    deed = setup_parcel("TX-CHD", 76.78, 30.73, state="Chandigarh", leasehold=True)
    tx = open_tx(client, "TX-CHD", deed).json()
    assert [d["department"] for d in tx["departments"]] == ["REGISTRATION", "REVENUE", "ESTATE_OFFICE", "MUNICIPAL"]
    tid = tx["id"]
    as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    for role in ("village_officer", "auditor", "state_admin"):
        assert act(client, role, tid).status_code == 200
    r = as_role(client, "state_admin").get(f"/transactions/{tid}").json()
    assert r["current_department"] == "REVENUE" and r["current_stage"] == "Waiting for handoff to Estate Office"
    r = as_role(client, "state_admin").post(f"/transactions/{tid}/handoff", json={"to_department": "MUNICIPAL", "reason": "Skip the estate office"})
    assert r.status_code in (409, 422)   # Estate Office is next
    r = as_role(client, "state_admin").post(f"/transactions/{tid}/handoff", json={"to_department": "ESTATE_OFFICE", "reason": "Leasehold transfer"})
    assert r.status_code == 200, r.text
    tx = act(client, "state_admin", tid).json()
    assert tx["status"] == "approved" and tx["municipal_push"]["assessee_after"] == "Meena Iyer"


def test_revenue_objection_escalates_to_dispute_and_resumes(client):
    deed = setup_parcel("TX-DISP", 80.43, 13.33)
    tid = open_tx(client, "TX-DISP", deed).json()["id"]
    as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    assert act(client, "state_admin", tid, "object", "short").status_code == 422
    r = act(client, "state_admin", tid, "object", "Seller signature differs from the record")
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["status"] == "objected" and tx["dispute_cases"][0]["escalated_at"] is None
    assert act(client, "state_admin", tid).status_code == 409           # must escalate first
    assert as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "again"}).status_code in (403, 409, 422)
    r = as_role(client, "state_admin").post(f"/transactions/{tid}/handoff", json={"to_department": "DISPUTE", "reason": "Escalate"})
    assert r.status_code == 200, r.text
    assert r.json()["dispute_cases"][0]["escalated_at"]
    # the officer who objected cannot hear it
    assert act(client, "state_admin", tid, "approve", "Objection dismissed after hearing").status_code == 403
    r = act(client, "state_admin", tid, "approve", "Objection dismissed after hearing", uid="collector-2")
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["dispute_cases"][0]["resolution"] == "dismissed"
    assert tx["current_department"] == "REVENUE" and tx["status"] == "in_review"
    assert tx["handoffs"][-1]["to_department"] == "REVENUE"
    # Revenue resumed at the stage that objected. The officer who objected may not decide it again.
    assert act(client, "state_admin", tid).status_code == 403
    assert act(client, "state_admin", tid, uid="tahsildar-2").status_code == 200


def test_dispute_upheld_rejects_transaction(client):
    deed = setup_parcel("TX-UPH", 80.44, 13.34)
    tid = open_tx(client, "TX-UPH", deed).json()["id"]
    as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    act(client, "state_admin", tid, "object", "Boundary dispute with neighbour")
    as_role(client, "state_admin").post(f"/transactions/{tid}/handoff", json={"to_department": "DISPUTE", "reason": "Escalate"})
    r = act(client, "state_admin", tid, "reject", "Objection upheld after hearing", uid="collector-2")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected" and r.json()["dispute_cases"][0]["resolution"] == "upheld"
    # parcel record is untouched
    db = SessionLocal()
    assert db.query(Parcel).filter(Parcel.ulpin == "TX-UPH").first().layers["ror"]["owner_name"] == "Asha Rao"
    db.close()


def test_audit_entry_for_every_stage_and_handoff(client):
    deed = setup_parcel("TX-AUD", 80.45, 13.35)
    tid = open_tx(client, "TX-AUD", deed).json()["id"]
    as_role(client, "officer").post(f"/transactions/{tid}/handoff", json={"to_department": "REVENUE", "reason": "Deed registered"})
    act(client, "state_admin", tid)
    db = SessionLocal()
    rows = audit.chain(db, "TX-AUD")
    db.close()
    events = [r.event for r in rows]
    for wanted in ("transaction_opened", "department_handoff", "stage_approved", "mutation_applied", "municipal_tax_rekeyed"):
        assert wanted in events, events
    assert events.count("department_handoff") == 2   # Registration to Revenue, Revenue to Municipal
    assert audit.verify(rows)[0]

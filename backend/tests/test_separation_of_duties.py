import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")
os.environ.setdefault("ALLOW_SQLITE_FALLBACK", "true")

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine, SessionLocal
from app.main import app
from app.models import BoundaryChangeRequest, RequestFlag
from app.seed import seed_database
from app import audit, permissions
import app.routes.auth as auth_mod


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    seed_database()
    with TestClient(app) as c:
        yield c


def hdr(role, uid):
    return {"Authorization": f"Bearer {auth_mod.create_jwt_token(role, uid)}"}


def square(x, y):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + .001, y], [x + .001, y + .001], [x, y + .001], [x, y]]]}


def make_parcel(c, ulpin, x):
    r = c.post("/parcels/custom", headers=hdr("state_admin", "root-admin"), json={
        "ulpin": ulpin, "owner_name": "Asha Rao", "state": "TamilNadu", "land_use": "residential",
        "area_sqm": 1000, "geometry": square(x, 11.0)})
    assert r.status_code == 200, r.text


def high_request(c, ulpin, filer="cit-1"):
    """A citizen correction that changes the owner: full three-stage review, starts at the village stage."""
    r = c.post(f"/parcels/{ulpin}/correction-request", headers=hdr("citizen", filer),
               json={"layer": "ror", "field": "owner_name", "requested_value": "Zubin Shah", "requested_by": "T"})
    assert r.status_code == 200 and r.json()["track"] == "HIGH", r.text
    return r.json()["request_id"]


def post(c, path, role, uid, **kw):
    return c.post(path, headers=hdr(role, uid), **kw)


def set_status(rid, status):
    db = SessionLocal()
    db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == rid).first().status = status
    db.commit()


# ---- reject is for the current reviewer only ------------------------------------------------

def test_state_admin_cannot_reject_at_an_earlier_stage(client):
    make_parcel(client, "SD-1", 77.10)
    rid = high_request(client, "SD-1")
    r = post(client, f"/parcels/requests/{rid}/reject", "state_admin", "sa-x")
    assert r.status_code == 403 and "not waiting on your role" in r.json()["detail"].lower()
    assert post(client, f"/parcels/requests/{rid}/reject", "village_officer", "vo-1").status_code == 200


def test_prior_approver_cannot_reject_even_if_returned_to_their_stage(client):
    make_parcel(client, "SD-2", 77.12)
    rid = high_request(client, "SD-2")
    assert post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1").status_code == 200
    assert post(client, f"/parcels/requests/{rid}/reject", "village_officer", "vo-1").status_code == 403  # not their stage
    set_status(rid, "PENDING_VILLAGE_REVIEW")  # simulate a return to a stage they touched
    back = post(client, f"/parcels/requests/{rid}/reject", "village_officer", "vo-1")
    assert back.status_code == 403 and "already approved" in back.json()["detail"]
    assert post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1").status_code == 403
    db = SessionLocal()
    r = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == rid).first()
    d = permissions.decide(r, "vo-2", "village_officer")  # a different account may act
    assert d.can_approve and d.can_reject


def test_same_account_cannot_approve_twice_on_one_request(client):
    make_parcel(client, "SD-3", 77.14)
    rid = high_request(client, "SD-3")
    assert post(client, f"/parcels/requests/{rid}/village-pass", "super_admin", "sa-1").status_code == 200
    assert post(client, f"/parcels/requests/{rid}/auditor-pass", "super_admin", "sa-1").status_code == 403
    assert post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1").status_code == 200


def test_closed_requests_accept_nothing(client):
    make_parcel(client, "SD-4", 77.16)
    rid = high_request(client, "SD-4")
    post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1")
    post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1")
    assert post(client, f"/parcels/requests/{rid}/approve", "state_admin", "sa-1").status_code == 200
    late = post(client, f"/parcels/requests/{rid}/reject", "state_admin", "sa-2")
    assert late.status_code == 409 and "report an issue" in late.json()["detail"].lower()  # was possible before
    flag = post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-1", json={"reason": "I think this is wrong."})
    assert flag.status_code == 409


# ---- concerns -------------------------------------------------------------------------------

def test_raise_block_acknowledge_resolve_then_approve(client):
    make_parcel(client, "SD-5", 77.18)
    rid = high_request(client, "SD-5")
    post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1")

    # only someone who filed or forwarded it may raise a concern
    assert post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-2", json={"reason": "Uninvolved officer."}).status_code == 403
    assert post(client, f"/parcels/requests/{rid}/flags", "auditor", "a-1", json={"reason": "The holder cannot flag."}).status_code == 403
    assert post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-1", json={"reason": "short"}).status_code == 422

    raised = post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-1",
                  json={"reason": "The deed number does not match the field survey."})
    assert raised.status_code == 201 and raised.json()["notified"] == ["auditor"]
    fid = raised.json()["flag_id"]
    filer_flag = post(client, f"/parcels/requests/{rid}/flags", "citizen", "cit-1", json={"reason": "I filed this and spotted a typo."})
    assert filer_flag.status_code == 201  # the filer may raise one too

    # the auditor sees it in the queue and cannot approve past it
    q = client.get("/parcels/requests/pending", headers=hdr("auditor", "a-1")).json()
    mine = next(r for r in q if r["id"] == rid)
    assert len([f for f in mine["flags"] if f["status"] == "open"]) == 2
    assert mine["permissions"]["can_approve"] is False and mine["permissions"]["can_reject"] is True
    assert post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1").status_code == 409

    # acknowledged is not enough
    assert post(client, f"/parcels/flags/{fid}/acknowledge", "auditor", "a-1").status_code == 200
    assert post(client, f"/parcels/flags/{fid}/resolve", "auditor", "a-1", json={"note": "Checked the deed. It matches."}).status_code == 200
    assert post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1").status_code == 409  # second flag still open
    fid2 = filer_flag.json()["flag_id"]
    assert post(client, f"/parcels/flags/{fid2}/resolve", "auditor", "a-1", json={"note": "Typo is in the note only."}).status_code == 200
    assert post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1").status_code == 200

    # once the request has moved on, the earlier reviewer cannot respond to anything on it
    assert post(client, f"/parcels/flags/{fid}/resolve", "village_officer", "vo-1", json={"note": "Never mind."}).status_code == 403

    events = [e["event"] for e in client.get("/parcels/SD-5/audit-chain").json()["entries"]]
    assert events.count("concern_raised") == 2 and events.count("concern_resolved") == 2
    assert client.get("/parcels/SD-5/audit-chain").json()["verified"] is True


def test_raiser_never_resolves_their_own_concern(client):
    make_parcel(client, "SD-11", 77.30)
    rid = high_request(client, "SD-11")
    post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1")
    fid = post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-1", json={"reason": "Second thoughts on this one."}).json()["flag_id"]
    set_status(rid, "PENDING_VILLAGE_REVIEW")  # returned to a stage vo-1 holds again
    own = post(client, f"/parcels/flags/{fid}/resolve", "village_officer", "vo-1", json={"note": "Dismissing my own."})
    assert own.status_code == 403 and "someone else" in own.json()["detail"]


def test_rejecting_is_the_other_way_to_answer_a_concern(client):
    make_parcel(client, "SD-6", 77.20)
    rid = high_request(client, "SD-6")
    post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1")
    post(client, f"/parcels/requests/{rid}/flags", "village_officer", "vo-1", json={"reason": "Boundary looks wrong to me."})
    assert post(client, f"/parcels/requests/{rid}/reject", "auditor", "a-1").status_code == 200


def test_audit_log_ties_entries_to_an_account_without_exposing_it(client):
    body = client.get("/parcels/SD-5/audit-chain").json()
    assert all("uid" not in e and "actor_ref" not in e for e in body["entries"])
    db = SessionLocal()
    refs = {r.actor_ref for r in audit.chain(db, "SD-5") if r.actor_ref}
    assert audit.actor_ref("vo-1") in refs and "vo-1" not in refs


# ---- withdrawal -----------------------------------------------------------------------------

def test_filer_withdraws_only_before_a_reviewer_acts(client):
    make_parcel(client, "SD-7", 77.22)
    rid = high_request(client, "SD-7", filer="cit-7")
    assert post(client, f"/parcels/requests/{rid}/withdraw", "citizen", "someone-else").status_code == 403
    assert post(client, f"/parcels/requests/{rid}/withdraw", "citizen", "cit-7").status_code == 200

    make_parcel(client, "SD-8", 77.24)
    rid2 = high_request(client, "SD-8", filer="cit-8")
    post(client, f"/parcels/requests/{rid2}/village-pass", "village_officer", "vo-1")
    late = post(client, f"/parcels/requests/{rid2}/withdraw", "citizen", "cit-8")
    assert late.status_code == 409 and "raise a concern" in late.json()["detail"]


# ---- fast track and re-routing --------------------------------------------------------------

def test_fast_approver_cannot_later_kill_a_request_that_was_rerouted_to_high(client):
    make_parcel(client, "SD-9", 77.26)
    r = client.post("/parcels/SD-9/correction-request", headers=hdr("citizen", "cit-9"),
                    json={"layer": "ror", "field": "owner_name", "requested_value": "Asha Raoo", "requested_by": "T"})
    rid = r.json()["request_id"]
    assert post(client, f"/parcels/requests/{rid}/fast-approve", "auditor", "a-9").status_code == 200
    # no re-route exists today; simulate one to prove the rule reads history, not the track
    db = SessionLocal()
    req = db.query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == rid).first()
    req.status, req.track = "PENDING_APPROVAL", "HIGH"
    db.commit()
    kill = post(client, f"/parcels/requests/{rid}/reject", "auditor", "a-9")
    assert kill.status_code == 403 and "already approved" in kill.json()["detail"]
    assert post(client, f"/parcels/requests/{rid}/reject", "auditor", "a-10").status_code == 200


# ---- reporting an issue after a decision ----------------------------------------------------

def test_report_an_issue_creates_a_new_request_that_references_the_old_one(client):
    make_parcel(client, "SD-10", 77.28)
    rid = high_request(client, "SD-10")
    post(client, f"/parcels/requests/{rid}/village-pass", "village_officer", "vo-1")
    post(client, f"/parcels/requests/{rid}/auditor-pass", "auditor", "a-1")
    post(client, f"/parcels/requests/{rid}/approve", "state_admin", "sa-1")
    body = {"layer": "ror", "field": "owner_name", "requested_value": "Zubin Shaah", "requested_by": "T", "references_request_id": rid}
    r = client.post("/parcels/SD-10/correction-request", headers=hdr("citizen", "cit-2"), json=body)
    assert r.status_code == 200 and r.json()["request_id"] != rid and r.json()["track"] == "FAST"
    bad = client.post("/parcels/SD-1/correction-request", headers=hdr("citizen", "cit-2"), json=body)
    assert bad.status_code == 422
    old = SessionLocal().query(BoundaryChangeRequest).filter(BoundaryChangeRequest.id == rid).first()
    assert old.status == "APPROVED"  # history is not reopened


# ---- the decision function itself -----------------------------------------------------------

class Fake:
    def __init__(self, status, history, uid="filer"):
        self.status, self.history, self.requester_uid = status, history, uid


def test_decide_table():
    h = [{"kind": "submit", "role": "citizen", "uid": "filer"},
         {"kind": "approve", "role": "village_officer", "uid": "vo-1", "status": "PENDING_APPROVAL"}]
    r = Fake("PENDING_APPROVAL", h)
    a = permissions.decide(r, "a-1", "auditor")
    assert (a.can_approve, a.can_reject, a.can_flag) == (True, True, False)
    assert permissions.decide(r, "a-1", "auditor", unresolved_flags=1).can_approve is False
    assert permissions.decide(r, "a-1", "auditor", unresolved_flags=1).can_reject is True
    vo = permissions.decide(r, "vo-1", "village_officer")
    assert (vo.can_approve, vo.can_reject, vo.can_flag, vo.can_withdraw) == (False, False, True, False)
    f = permissions.decide(r, "filer", "citizen")
    assert (f.can_approve, f.can_flag, f.can_withdraw) == (False, True, False)
    assert permissions.decide(r, "sa-1", "state_admin").can_reject is False       # not their stage
    assert permissions.decide(Fake("APPROVED", h), "a-1", "auditor").can_approve is False
    fresh = Fake("PENDING_VILLAGE_REVIEW", [{"kind": "submit", "role": "citizen", "uid": "filer"}])
    assert permissions.decide(fresh, "filer", "citizen").can_withdraw is True
    legacy = Fake("PENDING_STATE_ADMIN", [{"status": "PENDING_APPROVAL", "role": "village_officer"},
                                          {"status": "PENDING_STATE_ADMIN", "role": "auditor"}], uid=None)
    assert permissions.decide(legacy, "any", "auditor").can_reject is False       # entries with no uid match by role

"""Transfer and encumbrance history for the seed parcels, plus planted fixtures for the detectors.

Two kinds of data are written here, and they are kept apart on purpose:

1. Seed history. One registered transfer per seed parcel, taken from its source CSV row, and an encumbrance
   event where the row says the parcel is encumbered. This is the same synthetic seed data the map already shows.

2. PLANTED SYNTHETIC TEST FIXTURES (every row carries `synthetic_fixture`). Invented parcels and records built
   to demonstrate that each detector fires: a flipped parcel, a benami-style name cluster, an edit filed days
   after a mortgage, late and future-dated deeds, and a commercial parcel inside a residential neighbourhood.
   They are examples that show the detectors work. They are not findings about any real person, parcel or
   activity. All names are invented.
"""
import math
import random
from datetime import date, datetime, timedelta, timezone

from shapely.geometry import Polygon

from app.adapter import adapter_engine
from app.models import (BoundaryChangeRequest, EncumbranceEvent, Parcel, RegistrationTransaction)

LEGACY_IMPORT_AT = "2024-01-15T00:00:00+00:00"   # when the seed registers were loaded into LandSetu
DISTRICT_BY_STATE = {"TamilNadu": "Chennai", "Chandigarh": "Chandigarh"}
FIXTURE_MARKER = "TN-KPM-0107-2013"               # present once the fixtures are loaded


def _iso(d: date, days: int = 0, hour: int = 11) -> str:
    return datetime.combine(d + timedelta(days=days), datetime.min.time(), tzinfo=timezone.utc).replace(hour=hour).isoformat()


def _geom(poly: Polygon):
    from app.workflow import geom_column_value
    return geom_column_value(poly)


def backfill_seed_history(db) -> int:
    """History for the seed parcels, from each parcel's own source row. Idempotent."""
    n = 0
    for p in db.query(Parcel).all():
        changed = False
        if not p.created_at:
            p.created_at = LEGACY_IMPORT_AT
            changed = True
        if not p.district:
            p.district = DISTRICT_BY_STATE.get(p.state)
            changed = True
        raw = p.raw_record or {}
        if raw and not db.query(RegistrationTransaction.id).filter(RegistrationTransaction.ulpin == p.ulpin).first():
            reg = (p.layers or {}).get("registration") or {}
            ror = (p.layers or {}).get("ror") or {}
            deed = reg.get("date")
            if deed and reg.get("last_transaction_id"):
                d = date.fromisoformat(str(deed)[:10])
                db.add(RegistrationTransaction(
                    ulpin=p.ulpin, transaction_id=reg["last_transaction_id"], kind="sale", seller_name=None,
                    buyer_name=reg.get("buyer_name") or ror.get("owner_name"), deed_date=d.isoformat(),
                    recorded_at=_iso(d, 6), source=reg.get("source", "sub_registrar")))
                if (p.layers or {}).get("encumbrance", {}).get("active"):
                    db.add(EncumbranceEvent(ulpin=p.ulpin, kind="mortgage", holder="Scheduled bank",
                                            raised_at=_iso(d, 200), cleared_at=None))
                changed = True
        n += int(changed)
    db.commit()
    return n


# ---------------------------------------------------------------------------------------------------------
# PLANTED SYNTHETIC TEST FIXTURES. Invented data that demonstrates each detector. Not findings.
# ---------------------------------------------------------------------------------------------------------

_GIVEN = ["Anbu", "Bharathi", "Chitra", "Deepa", "Elango", "Gowri", "Ilango", "Jothi", "Kavitha", "Lalitha", "Mani",
          "Nandhini", "Pandian", "Rekha", "Senthil", "Thilaga", "Uma", "Vasanth", "Yamuna", "Arul", "Bala", "Dinesh"]
_INITIAL = "ABCDGKMNPRSTV"


def _name(rng) -> str:
    return f"{rng.choice(_INITIAL)}. {rng.choice(_GIVEN)}"


def _raw(ulpin, owner, buyer, land_use, deed_date, hectares, txn, encumbered=False):
    return {
        "ulpin": ulpin, "pattadar_peyar": owner, "khatha_num": f"KH-{ulpin[-4:]}", "extent_hectares": str(hectares),
        "patta_type": "Patta", "transaction_ref": txn, "transaction_date": deed_date, "registration_owner": buyer,
        "land_use_code": land_use, "fsi_permitted": "1.5", "permit_ref": f"BP-{ulpin[-4:]}", "permit_status": "approved",
        "permit_fsi_approved": "1.5", "tax_annual_value": "30000", "tax_last_updated": "2025-04-01",
        "encumbrance_flag": "true" if encumbered else "false",
    }


def _parcel(db, ulpin, district, poly, raw, fixture, created_at="2025-03-01T10:00:00+00:00"):
    canon = adapter_engine.normalize("TamilNadu", raw, None)
    raw = {**raw, "synthetic_fixture": fixture}
    p = Parcel(ulpin=ulpin, state="TamilNadu", district=district, area_sqm=canon["area_sqm"], geometry=_geom(poly),
               layers=canon["layers"], raw_record=raw, created_at=created_at)
    db.add(p)
    return p


def _plot(lng, lat, width_m, depth_m):
    """A rectangular plot whose south-west corner is at (lng, lat), sized in metres. Every fixture's polygon matches
    the extent its record states (extent_hectares * 10,000 = width_m * depth_m), so the area_mismatch rule stays
    quiet on them; see scripts/validate_seed_geometry.py."""
    dlng = width_m / (111_320.0 * math.cos(math.radians(lat)))
    dlat = depth_m / 110_574.0
    return Polygon([(lng, lat), (lng + dlng, lat), (lng + dlng, lat + dlat), (lng, lat + dlat)])


# Plot sizes, in metres, for each fixture's recorded extent.
VILLAGE_PLOT = (12.0, 25.0)     # 0.03 ha house plot in Nemili village, narrow frontage onto the village street
FIELD_PLOT = (50.0, 80.0)       # 0.4 ha agricultural field in Chengalpattu and Tiruvallur
CITY_PLOT = (16.0, 31.25)       # 0.05 ha urban plot in Chennai


# Where each planted fixture sits. plant_fixtures() and app/seed_corrections.py both read this, so a database
# seeded with the old oversized squares is corrected to exactly these polygons.
KPM_ORIGIN, KPM_STEP = (79.7640, 12.9850), 0.00058
OUTSIDE_FIXTURES = [("TN-CGL-0311-0041", "Chengalpattu", 79.9760, 12.6920, "R. Venkatesan"),
                    ("TN-TVL-0205-0077", "Tiruvallur", 79.9080, 13.1430, "R. Venkatesen")]


def fixture_polygons() -> dict:
    """ULPIN -> Polygon for every planted fixture parcel."""
    lng0, lat0 = KPM_ORIGIN
    polys = {}
    for i in range(25):
        r, c = divmod(i, 5)
        polys[f"TN-KPM-0107-20{i + 1:02d}"] = _plot(lng0 + c * KPM_STEP, lat0 + r * KPM_STEP, *VILLAGE_PLOT)
    for ulpin, _district, lng, lat, _owner in OUTSIDE_FIXTURES:
        polys[ulpin] = _plot(lng, lat, *FIELD_PLOT)
    for k, ulpin in enumerate(("TN-CHN-0051-3301", "TN-CHN-0051-3302")):
        polys[ulpin] = _plot(80.2860 + k * 0.0012, 13.0960, *CITY_PLOT)
    return polys


def plant_fixtures(db) -> bool:
    """Insert the planted fixtures once. Returns True if it inserted them."""
    if db.query(Parcel.id).filter(Parcel.ulpin == FIXTURE_MARKER).first():
        return False
    rng = random.Random(26014)

    # Fixture A: a residential neighbourhood of 25 plots near Nemili, Kanchipuram, in a 5 by 5 grid.
    # Plot 13 (the centre) is declared commercial: the zoning-anomaly fixture.
    # Plot 7 changes hands three times in 75 days: the flipping fixture.
    # Plots 3, 17 and 22 carry the benami name cluster (with plots outside the grid below).
    # Plot 19 gets a mortgage and a boundary request six days later: the lien-timing fixture.
    benami = {3: "R. Venkatesan", 17: "R. Venkatesan", 22: "R Venkatesan"}
    polys = fixture_polygons()
    lng0, lat0 = KPM_ORIGIN
    step = KPM_STEP
    for i in range(25):
        r, c = divmod(i, 5)
        n = i + 1
        ulpin = f"TN-KPM-0107-20{n:02d}"
        owner = benami.get(n) or _name(rng)
        use = "commercial" if n == 13 else "residential"
        deed = date(2016 + rng.randrange(8), 1 + rng.randrange(12), 1 + rng.randrange(27))
        tag = {13: "zoning_anomaly", 7: "flipping", 19: "lien_timing"}.get(n, "benami" if n in benami else "neighbourhood")
        _parcel(db, ulpin, "Kanchipuram", polys[ulpin],
                _raw(ulpin, owner, owner, use, deed.isoformat(), 0.03, f"REG-{deed.year}-K{n:03d}"), tag)
        if n != 7:
            db.add(RegistrationTransaction(ulpin=ulpin, transaction_id=f"REG-{deed.year}-K{n:03d}", kind="sale",
                                           buyer_name=owner, deed_date=deed.isoformat(), recorded_at=_iso(deed, 5),
                                           synthetic_fixture=tag))

    # Flipping: A to B to C to D within 75 days.
    chain = [("S. Kumaresan", "M. Farook", date(2025, 1, 6)), ("M. Farook", "P. Rajendran", date(2025, 2, 11)),
             ("P. Rajendran", "V. Saravanan", date(2025, 3, 21))]
    for k, (seller, buyer, d) in enumerate(chain):
        db.add(RegistrationTransaction(ulpin="TN-KPM-0107-2007", transaction_id=f"REG-2025-FL{k + 1}", kind="sale",
                                       seller_name=seller, buyer_name=buyer, deed_date=d.isoformat(),
                                       recorded_at=_iso(d, 3), synthetic_fixture="flipping"))

    # Lien timing: mortgage raised, then a boundary change filed six days later.
    db.add(EncumbranceEvent(ulpin="TN-KPM-0107-2019", kind="mortgage", holder="Synthetic Co-operative Bank",
                            raised_at="2025-05-02T10:30:00+00:00", synthetic_fixture="lien_timing"))
    lien_req = BoundaryChangeRequest(
        ulpin="TN-KPM-0107-2019", state="TamilNadu", requester_role="village_officer", requested_by="Fixture filer",
        geometry=_plot(lng0 + 3 * step, lat0 + 3 * step, *VILLAGE_PLOT).__geo_interface__, area_sqm=300.0,
        reason="Planted synthetic fixture: boundary change filed six days after a mortgage", status="REJECTED",
        type="BOUNDARY", track="HIGH", requester_uid="synthetic-fixture",
        history=[{"at": "2025-05-08T09:00:00+00:00", "status": "PENDING_APPROVAL", "role": "village_officer",
                  "uid": "synthetic-fixture", "kind": "submit", "note": "Submitted"},
                 {"at": "2025-05-20T12:00:00+00:00", "status": "REJECTED", "role": "auditor",
                  "uid": "synthetic-auditor", "kind": "reject", "note": "Rejected"}],
        created_at="2025-05-08T09:00:00+00:00")
    db.add(lien_req)

    # Benami cluster continued outside the grid: two more districts, spelling variants.
    for ulpin, district, lng, lat, owner in OUTSIDE_FIXTURES:
        d = date(2024, 8, 12)
        _parcel(db, ulpin, district, polys[ulpin], _raw(ulpin, owner, owner, "agricultural", d.isoformat(), 0.4,
                                                             f"REG-2024-{ulpin[-4:]}"), "benami")
        db.add(RegistrationTransaction(ulpin=ulpin, transaction_id=f"REG-2024-{ulpin[-4:]}", buyer_name=owner,
                                       deed_date=d.isoformat(), recorded_at=_iso(d, 4), synthetic_fixture="benami"))

    # Backdating: one deed presented six years after execution, one dated after it was recorded.
    late = ("TN-CHN-0051-3301", date(2019, 2, 1), "2025-06-10T10:00:00+00:00", "backdating_late")
    future = ("TN-CHN-0051-3302", date(2025, 9, 30), "2025-07-04T10:00:00+00:00", "backdating_future")
    for k, (ulpin, deed, recorded, tag) in enumerate((late, future)):
        owner = "K. Aravind" if k == 0 else "N. Shobana"
        _parcel(db, ulpin, "Chennai", polys[ulpin],
                _raw(ulpin, owner, owner, "residential", deed.isoformat(), 0.05, f"REG-X-{ulpin[-4:]}"), tag,
                created_at=recorded)
        db.add(RegistrationTransaction(ulpin=ulpin, transaction_id=f"REG-X-{ulpin[-4:]}", buyer_name=owner,
                                       deed_date=deed.isoformat(), recorded_at=recorded, synthetic_fixture=tag))

    db.commit()
    return True

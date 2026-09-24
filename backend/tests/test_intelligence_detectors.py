"""Each detector against constructed fixture data: one case that must fire, one near miss that must not."""
import os

os.environ.setdefault("JWT_SECRET", "test_secret_key_minimum_32_chars_long_for_security_test")

from app.intelligence.detectors import detect_flipping, detect_benami, detect_lien_timing, detect_backdating
from app.intelligence.zoning import find_zoning_anomalies


def t(tid, deed, recorded=None, seller=None, buyer=None, kind="sale"):
    return {"transaction_id": tid, "deed_date": deed, "recorded_at": recorded or f"{deed}T10:00:00+00:00",
            "seller_name": seller, "buyer_name": buyer, "kind": kind}


# ---- flipping --------------------------------------------------------------------------------

def test_flipping_fires_on_three_transfers_in_sixty_days():
    f = detect_flipping([t("A", "2025-01-01", seller="P", buyer="Q"), t("B", "2025-01-30", seller="Q", buyer="R"),
                         t("C", "2025-03-01", seller="R", buyer="S"), t("OLD", "2019-05-05")])
    assert f and f.pattern == "rapid_retransfer"
    assert [e["transaction_id"] for e in f.evidence] == ["A", "B", "C"]  # the old deed is not evidence
    assert "3 ownership transfers in 59 days" in f.summary


def test_flipping_ignores_transfers_spread_out_and_inheritance():
    assert detect_flipping([t("A", "2025-01-01"), t("B", "2025-03-15"), t("C", "2025-06-20")]) is None
    assert detect_flipping([t("A", "2025-01-01"), t("B", "2025-01-10", kind="inheritance"), t("C", "2025-01-20")]) is None


def test_flipping_thresholds_are_configurable(monkeypatch):
    txns = [t("A", "2025-01-01"), t("B", "2025-02-15")]
    assert detect_flipping(txns) is None
    assert detect_flipping(txns, min_transfers=2).thresholds == {"window_days": 90, "min_transfers": 2}
    monkeypatch.setenv("INTEL_FLIP_MIN_TRANSFERS", "2")
    assert detect_flipping(txns) is not None


# ---- name repetition -------------------------------------------------------------------------

def holding(u, name, district):
    return {"ulpin": u, "owner_name": name, "district": district, "state": "TamilNadu"}


def test_benami_fires_on_spelling_variants_across_districts():
    hs = [holding("P1", "R. Venkatesan", "Kanchipuram"), holding("P2", "R Venkatesan", "Chengalpattu"),
          holding("P3", "R. Venkatesen", "Tiruvallur"), holding("P4", "S. Venkatesan", "Chennai"),
          holding("P5", "Asha Rao", "Chennai")]
    f = detect_benami("P1", "R. Venkatesan", hs)
    assert f and f.pattern == "name_repetition"
    assert [e["ulpin"] for e in f.evidence] == ["P1", "P2", "P3"]     # a different initial is a different person
    assert "3 districts" in f.summary and f.confidence < 0.9           # variants lower the confidence


def test_benami_fires_on_parcel_count_in_one_district_and_not_below_it():
    hs = [holding(f"P{i}", "M. Farook", "Chennai") for i in range(4)]
    assert detect_benami("P0", "M. Farook", hs).severity == "medium"
    assert detect_benami("P0", "M. Farook", hs[:3]) is None
    assert detect_benami("P0", "M. Farook", hs[:3], min_parcels=3) is not None


# ---- lien timing -----------------------------------------------------------------------------

ENC = {"kind": "mortgage", "holder": "Bank", "raised_at": "2025-05-02T10:00:00+00:00", "cleared_at": None}


def req(i, kind, filed, payload=None):
    return {"id": i, "type": kind, "created_at": filed, "status": "PENDING_APPROVAL", "payload": payload}


def test_lien_timing_fires_on_boundary_edit_days_after_a_mortgage():
    f = detect_lien_timing([ENC], [req(1, "BOUNDARY", "2025-05-08T09:00:00+00:00")])
    assert f and f.pattern == "lien_timing" and f.evidence[0]["days_apart"] == 6 and f.severity == "high"


def test_lien_timing_counts_ownership_corrections_but_not_spelling_fixes_elsewhere():
    own = req(2, "CORRECTION", "2025-05-20T09:00:00+00:00", {"layer": "ror", "field": "owner_name"})
    land = req(3, "CORRECTION", "2025-05-20T09:00:00+00:00", {"layer": "zoning", "field": "land_use"})
    assert detect_lien_timing([ENC], [own]) is not None
    assert detect_lien_timing([ENC], [land]) is None


def test_lien_timing_ignores_changes_long_before_or_after():
    assert detect_lien_timing([ENC], [req(4, "SPLIT", "2025-09-30T09:00:00+00:00")]) is None


# ---- backdating ------------------------------------------------------------------------------

def test_backdating_flags_future_dated_and_late_presented_deeds():
    fut = detect_backdating([t("F", "2025-09-30", "2025-07-04T10:00:00+00:00")])
    assert fut and "dated after it was recorded" in fut.summary and fut.severity == "high"
    late = detect_backdating([t("L", "2019-02-01", "2025-06-10T10:00:00+00:00")])
    assert late and late.evidence[0]["issue"] == "presented long after execution"


def test_backdating_accepts_normal_registration():
    assert detect_backdating([t("N", "2025-01-01", "2025-02-15T10:00:00+00:00")]) is None


def test_backdating_deed_older_than_a_derived_parcel():
    txns = [t("D", "2020-01-01", "2020-01-10T10:00:00+00:00")]
    assert detect_backdating(txns, "2025-03-01T00:00:00+00:00", parcel_is_derived=False) is None  # legacy import
    f = detect_backdating(txns, "2025-03-01T00:00:00+00:00", parcel_is_derived=True)
    assert f and f.evidence[0]["issue"] == "dated before the parcel existed"


# ---- zoning ----------------------------------------------------------------------------------

def grid(n=5, step=0.0006, lng0=79.76, lat0=12.98, odd=None, odd_use="commercial"):
    out = []
    for i in range(n * n):
        r, c = divmod(i, n)
        out.append({"ulpin": f"G{i}", "lng": lng0 + c * step, "lat": lat0 + r * step,
                    "land_use": odd_use if i == odd else "residential"})
    return out


def test_zoning_flags_the_odd_parcel_out():
    res = find_zoning_anomalies(grid(odd=12))
    assert res["G12"]["anomaly"] is True and "24 of the 24" in res["G12"]["explanation"]
    assert sum(r["anomaly"] for r in res.values()) == 1


def test_zoning_mixed_neighbourhood_is_not_an_anomaly():
    pts = grid()
    for i in range(0, 25, 3):
        pts[i]["land_use"] = "commercial"
    assert not any(r["anomaly"] for r in find_zoning_anomalies(pts).values())


def test_zoning_isolated_parcels_are_not_judged():
    far = grid(odd=None) + [{"ulpin": "FAR", "lng": 80.5, "lat": 13.5, "land_use": "industrial"}]
    res = find_zoning_anomalies(far)
    assert res["FAR"]["anomaly"] is False and "No neighbourhood" in res["FAR"]["explanation"]

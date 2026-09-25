"""Detector thresholds. Each can be overridden with an environment variable of the same name."""
import os


def _num(name: str, default):
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return type(default)(raw)
    except ValueError:
        return default


def flip_window_days() -> int:          # transfers counted inside this many days
    return _num("INTEL_FLIP_WINDOW_DAYS", 90)


def flip_min_transfers() -> int:        # this many transfers inside the window is flipping
    return _num("INTEL_FLIP_MIN_TRANSFERS", 3)


def benami_min_parcels() -> int:        # one name (or near-identical names) on this many parcels
    return _num("INTEL_BENAMI_MIN_PARCELS", 4)


def benami_min_districts() -> int:      # ... or across this many districts
    return _num("INTEL_BENAMI_MIN_DISTRICTS", 3)


def lien_window_days() -> int:          # a change filed this close to an encumbrance
    return _num("INTEL_LIEN_WINDOW_DAYS", 30)


def late_registration_days() -> int:    # Registration Act, 1908, s. 23: four months to present a deed
    return _num("INTEL_LATE_REGISTRATION_DAYS", 120)


def zoning_eps_m() -> float:            # DBSCAN neighbourhood radius, metres, between parcel centroids
    return _num("INTEL_ZONING_EPS_M", 120.0)


def zoning_min_samples() -> int:        # DBSCAN core-point size
    return _num("INTEL_ZONING_MIN_SAMPLES", 4)


def zoning_min_cluster() -> int:        # a neighbourhood must hold this many parcels to judge one
    return _num("INTEL_ZONING_MIN_CLUSTER", 6)


def zoning_dominance() -> float:        # share of the neighbourhood's dominant use needed to call a mismatch
    return _num("INTEL_ZONING_DOMINANCE", 0.75)


def risk_score_visible() -> bool:
    """The trained risk score is withheld from every screen and response by decision (see the technical
    document, section 5C). Setting INTEL_RISK_SCORE_VISIBLE=true computes and returns it again."""
    return os.getenv("INTEL_RISK_SCORE_VISIBLE", "false").lower() == "true"

"""Zoning-anomaly clustering with DBSCAN.

Parcels are clustered by where they are (centroids projected to metres), per state, because zoning patterns
are local. Inside each neighbourhood the declared land use is compared with the neighbourhood's dominant use.
A parcel is anomalous when the other parcels in its neighbourhood overwhelmingly share one use and it does not.

Clustering uses location only, and land use is compared afterwards. Mixing a categorical land use into the
distance would let use differences split a neighbourhood, which hides exactly the parcel we want to find.
"""
import math
from collections import Counter
from typing import Any, Dict, List

import numpy as np
from sklearn.cluster import DBSCAN

from app.intelligence import config

M_PER_DEG_LAT = 110_540.0


def project(points: List[tuple]) -> np.ndarray:
    """Equirectangular projection around the points' mean latitude. Accurate to well under 1% at district scale."""
    lat0 = sum(p[1] for p in points) / len(points)
    kx = 111_320.0 * math.cos(math.radians(lat0))
    return np.array([[lng * kx, lat * M_PER_DEG_LAT] for lng, lat in points])


def find_zoning_anomalies(parcels: List[Dict[str, Any]], eps_m: float = None, min_samples: int = None,
                          min_cluster: int = None, dominance: float = None) -> Dict[str, Dict[str, Any]]:
    """`parcels`: [{ulpin, lng, lat, land_use}] for one state. Returns {ulpin: {anomaly, explanation, ...}}."""
    eps = eps_m or config.zoning_eps_m()
    k = min_samples or config.zoning_min_samples()
    need = min_cluster or config.zoning_min_cluster()
    share_needed = dominance or config.zoning_dominance()
    out: Dict[str, Dict[str, Any]] = {}
    usable = [p for p in parcels if p.get("lng") is not None and p.get("land_use")]
    for p in parcels:
        out[p["ulpin"]] = {"anomaly": False, "explanation": "Not enough location or land-use data to compare.", "cluster": None}
    if len(usable) < k:
        for p in usable:
            out[p["ulpin"]]["explanation"] = "Too few parcels in this state to form neighbourhoods."
        return out

    labels = DBSCAN(eps=eps, min_samples=k).fit_predict(project([(p["lng"], p["lat"]) for p in usable]))
    members: Dict[int, List[Dict[str, Any]]] = {}
    for p, lab in zip(usable, labels):
        members.setdefault(int(lab), []).append(p)

    for lab, group in members.items():
        for p in group:
            if lab == -1:
                out[p["ulpin"]] = {"anomaly": False, "cluster": None,
                                   "explanation": f"No neighbourhood: fewer than {k} parcels within {eps:.0f} m."}
                continue
            if len(group) < need:
                out[p["ulpin"]] = {"anomaly": False, "cluster": lab,
                                   "explanation": f"Neighbourhood of {len(group)} parcels is too small to judge (needs {need})."}
                continue
            others = Counter(o["land_use"] for o in group if o["ulpin"] != p["ulpin"])
            top, count = others.most_common(1)[0]
            share = count / sum(others.values())
            anomaly = p["land_use"] != top and share >= share_needed
            if anomaly:
                text = (f"Declared {p['land_use']}, but {count} of the {sum(others.values())} other parcels within this "
                        f"{eps:.0f} m neighbourhood are {top} ({share:.0%}).")
            else:
                text = (f"Consistent with its neighbourhood of {len(group)} parcels"
                        f"{f' (mostly {top}, {share:.0%})' if p['land_use'] == top else ' (no single dominant use)'}.")
            out[p["ulpin"]] = {"anomaly": anomaly, "cluster": lab, "explanation": text,
                               "neighbourhood_size": len(group), "dominant_use": top, "dominant_share": round(share, 3),
                               "declared_use": p["land_use"]}
    return out

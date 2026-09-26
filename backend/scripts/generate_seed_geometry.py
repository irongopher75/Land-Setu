#!/usr/bin/env python3
"""
Regenerate the synthetic parcel polygons in backend/mock_data/*_geometries.geojson so each one matches the
extent its source record states (within 1%, well inside AREA_MISMATCH_TOLERANCE).

The earlier polygons were drawn for visibility at city zoom and were 74x to 157x larger than their records.
These are laid out as real plots would be, not scaled copies of the old shapes:

* Chennai, Park Town (TN-CHN-0042-*): nine urban house plots in three groups across the ward. In each group,
  plots front a road to the north or south and meet at a rear boundary line. Frontages 12 to 20 m, depths set
  by the recorded extent (about 25 to 42 m).
* Chandigarh, Sector 17 (CHD-SEC-0017-*): eight rectangular sector plots in three groups along 9 m internal
  roads, as Chandigarh sectors are laid out.

Planted rule fixtures kept on purpose (the demo relies on them):
* TN-CHN-0042-1188 encroaches 2.5 m into TN-CHN-0042-1187 along their shared side wall (boundary_overlap).
* TN-CHN-0042-1190's rear wall sits 2 m into TN-CHN-0042-1188's rear (boundary_overlap).
* CHD-SEC-0017-0203 is the corner plot nearest the eco-sensitive zone and extends into it (protected_zone).

Protected zones are copied through unchanged. Run from the repository root:

  ./venv/bin/python backend/scripts/generate_seed_geometry.py
"""
import csv
import json
import math
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M_PER_DEG_LAT = 110_574.0


def m_per_deg_lng(lat):
    return 111_320.0 * math.cos(math.radians(lat))


def plot(origin, x_m, y_m, frontage_m, area_sqm, skew_m=0.0, faces="north"):
    """A surveyed plot: frontage along x, depth along y, fitted to area_sqm.

    origin is (lng, lat) of the block's south-west corner; x_m, y_m place the plot's south-west corner in metres
    from it. skew_m shifts the far edge sideways (plots are rarely perfect rectangles), which keeps the area:
    a parallelogram of base b and height h has area b*h. faces is recorded for documentation only.
    """
    depth = area_sqm / frontage_m
    pts_m = [(x_m, y_m), (x_m + frontage_m, y_m), (x_m + frontage_m + skew_m, y_m + depth), (x_m + skew_m, y_m + depth)]
    lng0, lat0 = origin
    kx = m_per_deg_lng(lat0)
    ring = [[round(lng0 + x / kx, 7), round(lat0 + y / M_PER_DEG_LAT, 7)] for x, y in pts_m]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}, depth


def recorded_areas(csv_path, field, factor):
    with open(csv_path, encoding="utf-8") as f:
        return {r["ulpin"]: float(r[field]) * factor for r in csv.DictReader(f)}


# The records in each state's extract are plots from one revenue ward or sector, not one contiguous block, so they
# are laid out as small groups of two or three neighbouring plots, 170 m or more apart. Groups of fewer than four
# plots within 120 m form no neighbourhood for the zoning detector (app/intelligence/zoning.py), so the ordinary
# commercial and eco-sensitive records do not read as planted zoning anomalies.
GROUP_GAP_M = 200.0


def tamil_nadu():
    area = recorded_areas(os.path.join(BACKEND, "mock_data", "tamilnadu_parcels.csv"), "extent_hectares", 10_000)
    origin = (80.27000, 13.08300)          # Park Town ward, north of the eco-zone
    rear = 38.0                            # rear boundary line of each group, metres north of the origin
    geoms = {}

    def north(ulpin, x, frontage):         # fronts a road to the north; rear wall on the rear line
        geoms[ulpin], _ = plot(origin, x, rear, frontage, area[ulpin], faces="north")

    def south(ulpin, x, frontage, past_rear=0.0):   # fronts a road to the south; rear wall on the rear line
        depth = area[ulpin] / frontage
        geoms[ulpin], _ = plot(origin, x, rear - depth + past_rear, frontage, area[ulpin], faces="south")

    # Group A: the disputed plots. TN-CHN-0042-1188 sits 2.5 m into TN-CHN-0042-1187 along their side wall, and
    # TN-CHN-0042-1190, behind 1188, has its rear wall 2 m past the rear line into 1188 (both boundary_overlap).
    north("TN-CHN-0042-1187", 0.0, 15.0)
    north("TN-CHN-0042-1188", 12.5, 16.0)
    south("TN-CHN-0042-1190", 16.5, 12.0, past_rear=2.0)
    # Group B, 200 m east.
    g = GROUP_GAP_M
    north("TN-CHN-0042-1193", g, 13.5)
    north("TN-CHN-0042-1189", g + 13.5, 17.0)
    south("TN-CHN-0042-1191", g + 6.0, 14.0)
    # Group C, 400 m east.
    g = 2 * GROUP_GAP_M
    north("TN-CHN-0042-1195", g, 18.0)
    south("TN-CHN-0042-1194", g, 16.0)
    south("TN-CHN-0042-1192", g + 16.0, 20.0)
    return geoms


def chandigarh():
    area = recorded_areas(os.path.join(BACKEND, "mock_data", "chandigarh_parcels.csv"), "area_sqyd", 0.836127)
    # Sector 17 plots front 9 m internal roads (y = 0 is a road's south edge; north-side plots start at y = 9).
    # Group A sits by the eco-sensitive zone, whose western edge lies near 76.7862 E at this latitude:
    # CHD-SEC-0017-0203, across a side lane, extends about 10 m into it (protected_zone); the others stay clear.
    origin = (76.785469, 30.73460)
    geoms = {}

    def north(ulpin, x, frontage):
        geoms[ulpin], _ = plot(origin, x, 9.0, frontage, area[ulpin])

    def south(ulpin, x, frontage):
        depth = area[ulpin] / frontage
        geoms[ulpin], _ = plot(origin, x, -depth, frontage, area[ulpin])

    north("CHD-SEC-0017-0205", 30.0, 20.0)
    north("CHD-SEC-0017-0203", 64.0, 16.0)
    south("CHD-SEC-0017-0208", 34.0, 16.0)
    # Group B, 200 m west.
    g = -GROUP_GAP_M
    south("CHD-SEC-0017-0201", g, 17.0)
    south("CHD-SEC-0017-0202", g + 17.0, 17.5)
    north("CHD-SEC-0017-0206", g + 4.0, 14.0)
    # Group C, 400 m west.
    g = -2 * GROUP_GAP_M
    north("CHD-SEC-0017-0207", g, 18.0)
    north("CHD-SEC-0017-0204", g + 18.0, 16.0)
    return geoms


def rewrite(path, geoms):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    seen = set()
    for feat in data["features"]:
        ulpin = feat["properties"].get("ulpin")
        if feat["properties"].get("type") == "parcel" and ulpin in geoms:
            feat["geometry"] = geoms[ulpin]
            seen.add(ulpin)
    missing = set(geoms) - seen
    if missing:
        raise SystemExit(f"{path}: no feature for {sorted(missing)}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"{path}: {len(seen)} parcel polygons rewritten; protected zones unchanged")


if __name__ == "__main__":
    rewrite(os.path.join(BACKEND, "mock_data", "tamilnadu_geometries.geojson"), tamil_nadu())
    rewrite(os.path.join(BACKEND, "mock_data", "chandigarh_geometries.geojson"), chandigarh())

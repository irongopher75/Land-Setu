# State boundary seed data

`state_boundaries.geojson` holds seven Indian state/UT polygons: Chandigarh, Tamil Nadu, Punjab,
Haryana, Kerala, Karnataka and Andhra Pradesh — the pilot states (Chandigarh, Tamil Nadu) and
their neighbours, used for `ST_Intersects`-based state detection and border-crossing flags.

## Source

- Dataset: geoBoundaries IND ADM1 (India, administrative level 1 — state/union territory),
  2011 boundaries as represented by the Election Commission of India / DataMeet India community.
- Fetched from: `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson`
  (geoBoundaries' own pre-simplified release, commit `9469f09`, built Dec 12, 2023).
- Licence: Creative Commons Attribution 2.5 India (CC BY 2.5 IN). Attribution: geoBoundaries
  (Runfola et al. 2020, PLOS ONE), underlying data from DataMeet India / Election Commission of
  India. See `github.com/datameet/maps` for the original source repository.

## Processing

The seven features were extracted by `shapeName`, each geometry simplified further with Shapely
`simplify(tolerance=0.01, preserve_topology=True)` (~1 km tolerance in degrees) to keep the file
small while preserving containment and intersection behaviour at state-border resolution, and
normalized to `MultiPolygon` under `properties: {state_code, name}` matching the
`state_boundaries` table schema (see `alembic/versions/0009_state_boundaries.py`). `name` uses
LandSetu's existing no-space state-name convention (`TamilNadu`, not `Tamil Nadu`), matching
`Parcel.state` and `app/states.py::INDIAN_STATES`, not geoBoundaries' own `shapeName` spelling.

This is simplified for application logic (state containment, border-crossing detection), not for
cartographic or legal use.

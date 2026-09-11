# LandSetu — AI Build Specification

## Purpose
Build a working prototype of LandSetu: a parcel-centric GIS platform that unifies land-governance data across departments (Record of Rights, Registration, Zoning, Building Permits, Tax) using a config-driven schema adapter, an explainable rule engine, and a citizen/officer/bank-facing interface. This is a hackathon MVP, not production software — prioritize a working, demoable vertical slice over completeness.

Build everything end-to-end and runnable via a single `docker-compose up`. Do not stop to ask for missing design decisions — where this spec is silent, make the simplest reasonable choice and note the assumption in a `DECISIONS.md` file at the repo root.

---

## Tech Stack (do not substitute without strong reason)
- Frontend: React + Leaflet (map), plain CSS or Tailwind
- Backend: FastAPI (Python)
- Database: PostgreSQL + PostGIS extension
- Auth: JWT, mocked role selection (no real user registration needed)
- Containerization: Docker + docker-compose (one command to run everything)
- No cloud dependencies — everything must run fully offline/local

---

## Repository Structure
```
landsetu/
  docker-compose.yml
  DECISIONS.md
  backend/
    app/
      main.py
      models.py          # SQLAlchemy + PostGIS models
      schemas.py         # Pydantic request/response models
      adapter.py          # schema-mapping engine
      rules.py            # rule engine (spatial + record checks)
      routes/
        parcels.py
        adapter.py
        rules.py
        auth.py
      db.py
    configs/
      tamilnadu.yaml
      chandigarh.yaml
    mock_data/
      tamilnadu_parcels.csv
      chandigarh_parcels.csv
      tamilnadu_geometries.geojson
      chandigarh_geometries.geojson
    Dockerfile
    requirements.txt
  frontend/
    src/
      App.jsx
      components/
        MapView.jsx
        ParcelPanel.jsx
        ConfidenceBadge.jsx
        RoleSwitcher.jsx
        ParcelPassportQR.jsx
      api.js
    package.json
    Dockerfile
  README.md               # setup + run instructions + demo script
```

---

## 1. Canonical Parcel Schema (target format — all state data normalizes into this)

```json
{
  "ulpin": "TN-CHN-0042-1187",
  "state": "TamilNadu",
  "geometry": { "type": "Polygon", "coordinates": [[[lng, lat], ...]] },
  "area_sqm": 452.3,
  "layers": {
    "ror": {
      "owner_name": "R. Kannan",
      "owner_share": "1/1",
      "khata_no": "KH-1187",
      "source": "registration_dept",
      "last_verified": "2019-03-14",
      "confidence": "verified"
    },
    "registration": {
      "last_transaction_id": "REG-2019-88213",
      "transaction_type": "sale",
      "date": "2019-03-14",
      "source": "sub_registrar",
      "confidence": "verified"
    },
    "zoning": {
      "land_use": "residential",
      "permitted_fsi": 1.5,
      "eco_sensitive": false,
      "source": "master_plan_2021",
      "confidence": "verified"
    },
    "building_permit": {
      "status": "approved",
      "permit_id": "BP-2022-441",
      "approved_fsi": 1.5,
      "source": "municipal_corp",
      "confidence": "self_declared"
    },
    "tax": {
      "annual_value": 42000,
      "source": "revenue_dept",
      "confidence": "stale",
      "last_verified": "2016-01-01"
    },
    "encumbrance": {
      "active": false,
      "type": null,
      "source": "sub_registrar",
      "confidence": "verified"
    }
  },
  "flags": []
}
```

`confidence` values: `verified` (authoritative dept source, `last_verified` within 2 years), `self_declared` (citizen-submitted), `stale` (`last_verified` older than 3 years). Compute this server-side from `source` + `last_verified`, don't hardcode it in mock data except as a sanity check.

---

## 2. Mock Data Requirements

Create **15-20 parcels total**, split across two "states" (TamilNadu, Chandigarh), each in that state's own raw format (NOT the canonical schema — the whole point is the adapter normalizes them).

**TamilNadu raw CSV columns** (fictional but realistic-sounding TN land record fields):
`pattadar_peyar, khatha_num, extent_hectares, patta_type, transaction_ref, transaction_date, land_use_code, fsi_permitted, permit_ref, permit_status, tax_annual_value, tax_last_updated, encumbrance_flag`

**Chandigarh raw CSV columns** (deliberately different names/units):
`owner_full_name, record_no, area_sqyd, ownership_type, deed_number, deed_date, zone_category, max_fsi, building_license_no, license_status, property_tax_value, tax_year, mortgage_status`

Include:
- At least 2 parcels with a **boundary overlap** (two polygons that intersect) — for the `ST_Overlaps` rule demo
- At least 1 parcel inside a defined **eco-sensitive/protected zone** polygon — for `ST_Contains` rule demo
- At least 1 parcel where **RoR owner name ≠ registration owner name** — for ownership-mismatch rule demo
- At least 1 parcel where **building_permit.approved_fsi > zoning.permitted_fsi** — for zoning-violation rule demo
- At least 2 parcels with `tax.last_verified` older than 3 years — for stale-confidence badge demo
- Geometries as a separate GeoJSON file per state, keyed by the record identifier, roughly clustered around two plausible real coordinates (e.g., a Chennai-area cluster and a Chandigarh-area cluster) so the map looks geographically sensible

---

## 3. Schema Adapter (config-driven — this is the core innovation, must actually work generically)

Each state gets a YAML config. The adapter must be a generic engine that reads ANY such config and applies it — do not hardcode per-state logic in Python.

```yaml
# configs/tamilnadu.yaml
state: "TamilNadu"
source_format: "TN_RoR_v3"
field_mappings:
  - source_field: "pattadar_peyar"
    target: "layers.ror.owner_name"
  - source_field: "khatha_num"
    target: "layers.ror.khata_no"
  - source_field: "extent_hectares"
    target: "area_sqm"
    unit_conversion: "hectares_to_sqm"
  - source_field: "transaction_ref"
    target: "layers.registration.last_transaction_id"
  - source_field: "transaction_date"
    target: "layers.registration.date"
  - source_field: "land_use_code"
    target: "layers.zoning.land_use"
  - source_field: "fsi_permitted"
    target: "layers.zoning.permitted_fsi"
  - source_field: "permit_status"
    target: "layers.building_permit.status"
  - source_field: "tax_annual_value"
    target: "layers.tax.annual_value"
  - source_field: "tax_last_updated"
    target: "layers.tax.last_verified"
terminology_map:
  "patta": "record_of_rights"
  "adangal": "land_use_register"
```

Write a second, structurally different `chandigarh.yaml` covering its own field names and at least one different `unit_conversion` (e.g., `sqyd_to_sqm`).

**Adapter engine requirements (`adapter.py`):**
- Load a YAML config, iterate `field_mappings`, and for each, read `source_field` from a raw record and write to the nested `target` path (dot-notation → nested dict) in canonical schema
- Implement `unit_conversion` as a small registry of named functions (`hectares_to_sqm`, `sqyd_to_sqm`, etc.) — extensible, not a hardcoded if/else chain per state
- Fill `source` and `last_verified`/`confidence` fields using sensible defaults where the raw data doesn't specify them (e.g., default `source` to the dept name implied by the layer)
- Expose an API endpoint `POST /adapter/preview` that takes `{state, raw_record}` and returns the normalized canonical JSON — this is what proves the adapter works live during the demo

---

## 4. Rule Engine (`rules.py`)

Implement these checks, each returning a structured flag object:
```json
{
  "rule": "boundary_overlap",
  "flag": true,
  "reason": "Parcel geometry overlaps with parcel TN-CHN-0044",
  "evidence": { "overlapping_parcel": "TN-CHN-0044", "overlap_area_sqm": 12.4 }
}
```

Required rules:
1. **Boundary overlap**: `ST_Overlaps` (PostGIS) between a parcel's geometry and all others in the same state — flag any true overlap
2. **Protected-zone containment**: `ST_Contains` — check if a parcel geometry falls within a predefined eco-sensitive/protected zone polygon (define 1-2 such zone polygons in mock data)
3. **Ownership mismatch**: compare `layers.ror.owner_name` vs a name field implied on the registration side (in mock data, deliberately mismatch at least one) — simple string inequality check is fine for MVP, no fuzzy matching needed
4. **Zoning/FSI violation**: `layers.building_permit.approved_fsi > layers.zoning.permitted_fsi`
5. **Active encumbrance**: surface `layers.encumbrance.active == true` as an informational flag (not necessarily a "violation," just a required disclosure)

Expose `GET /parcels/{ulpin}/flags` returning all applicable flags for a parcel, and ensure `flags` array on the parcel detail response is populated from this.

---

## 5. Backend API Contract

- `GET /parcels` → list all parcels (id, ulpin, state, centroid) for map markers
- `GET /parcels/{ulpin}` → full canonical parcel record including `flags`
- `GET /parcels/{ulpin}/geometry` → GeoJSON geometry for map rendering
- `POST /adapter/preview` → `{state, raw_record}` → canonical JSON (live adapter demo endpoint)
- `GET /parcels/{ulpin}/passport` → returns a signed short string/URL + QR-encodable payload (a JWT or HMAC-signed token containing `ulpin` + timestamp is sufficient — no need for real PKI)
- `POST /auth/mock-login` → `{role: "citizen"|"officer"|"bank"}` → returns a JWT with that role claim
- Role-based field filtering: `citizen` role sees a reduced field set (no internal audit/source metadata), `officer`/`bank` see full detail — enforce this server-side based on JWT role claim, not just hidden in the frontend

---

## 6. Frontend Requirements

- **MapView**: Leaflet map, load `/parcels`, render each as a clickable polygon (fetch geometry on click or preload all). Color-code parcels with active flags (e.g., red outline) vs clean (green/neutral).
- **ParcelPanel**: on parcel click, fetch `/parcels/{ulpin}`, display all layers grouped by department (RoR, Registration, Zoning, Permit, Tax, Encumbrance), each field showing its `ConfidenceBadge`.
- **ConfidenceBadge**: small colored badge — green "Verified", yellow "Self-declared", red "Stale" — next to each field, driven by that field's `confidence` value.
- **Flags section**: within ParcelPanel, list any active flags from `/parcels/{ulpin}/flags`, each showing rule name, reason, and evidence in plain text.
- **RoleSwitcher**: dropdown (Citizen / Officer / Bank) that calls `/auth/mock-login`, stores the JWT, and refetches parcel data — panel content visibly changes field set based on role.
- **AdapterDemo view**: a simple secondary page/tab — pick a state, load one raw mock record (from the CSVs), show it next to the live `/adapter/preview` output side-by-side. This is the single most important screen for judges — it must visibly work with two different state formats producing identical canonical shape.
- **ParcelPassportQR**: button on ParcelPanel that fetches `/parcels/{ulpin}/passport` and renders a QR code (use a lightweight JS QR library) encoding that signed payload.

---

## 7. Build Order (so the AI builds and validates incrementally, not all-at-once)

1. Docker Compose skeleton: Postgres+PostGIS container, backend container, frontend container — confirm all three start and can reach each other
2. Backend: DB models + migrations for canonical parcel schema in PostGIS; seed script loads mock CSVs + GeoJSON through the adapter into the DB
3. Backend: `/parcels`, `/parcels/{ulpin}`, `/parcels/{ulpin}/geometry` endpoints working against seeded data
4. Frontend: MapView rendering seeded parcels from `/parcels`
5. Frontend: ParcelPanel wired to `/parcels/{ulpin}`, showing raw layer data (badges can come after)
6. Backend: rule engine implemented + `/parcels/{ulpin}/flags`; frontend flags section wired in
7. Backend: `/adapter/preview` endpoint; frontend AdapterDemo view
8. ConfidenceBadge computation + display
9. Auth mock + RoleSwitcher + server-side field filtering
10. ParcelPassportQR
11. Polish pass: styling consistency, error states, loading states, README with exact run + demo-walkthrough instructions

At each step, the AI should confirm the feature works (e.g., curl the endpoint, or describe expected screenshot) before moving to the next — don't build all layers of the stack blind and debug everything at the end.

---

## 8. Deliverables Checklist
- [ ] `docker-compose up` starts DB + backend + frontend with one command
- [ ] Seed data loads automatically on first run (or via a documented seed command)
- [ ] Map shows parcels from both states, clickable
- [ ] Parcel panel shows unified cross-department data with confidence badges
- [ ] At least one flagged parcel visibly shows a rule violation with reason + evidence
- [ ] Adapter demo page proves two different state formats normalize to the same schema, live
- [ ] Role switcher visibly changes visible fields
- [ ] QR Parcel Passport renders and scans to a valid payload
- [ ] README documents setup, run instructions, and the exact click-through demo path for judges
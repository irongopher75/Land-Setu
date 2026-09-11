# LandSetu Architecture & Design Decisions

This document records technical and design decisions made during the development of the LandSetu MVP prototype.

## 1. Schema & Data Storage
- **PostgreSQL + PostGIS**: Chosen for native spatial query support (`ST_Overlaps`, `ST_Intersects`, `ST_Contains`, `ST_Centroid`, `ST_AsGeoJSON`).
- **Canonical Schema Storage**: Stored as relational columns (`ulpin`, `state`, `area_sqm`, `geometry`) combined with PostgreSQL `JSONB` for department layers (`ror`, `registration`, `zoning`, `building_permit`, `tax`, `encumbrance`). This balances fast spatial indexing with flexible schema mapping.
- **WGS84 (SRID 4326)**: Standard coordinate reference system used across GeoJSON geometries and Leaflet map rendering.

## 2. Config-Driven Adapter Engine (`adapter.py`)
- **Dot-Notation Target Mapping**: Field mappings translate source key names directly into canonical paths (e.g., `pattadar_peyar` -> `layers.ror.owner_name`).
- **Extensible Unit Conversion Registry**: Unit conversions (`hectares_to_sqm`, `sqyd_to_sqm`) are handled by named conversion handlers rather than state-specific conditionals.
- **Server-Side Confidence Calculation**: Fields dynamically compute `confidence` based on layer source and timestamp:
  - `verified`: Authoritative department source and verified within 2 years.
  - `self_declared`: Citizen or municipal submission.
  - `stale`: Last verified over 3 years ago.

## 3. Explainable Rule Engine (`rules.py`)
- **Spatial Checks**: Uses PostGIS / Shapely spatial primitives:
  - `ST_Overlaps` to detect parcel boundary overlaps between neighboring parcels.
  - `ST_Intersects` / `ST_Contains` to check if a parcel falls within designated eco-sensitive or protected zones.
- **Record & Logical Checks**:
  - `ownership_mismatch`: Compares owner names between Record of Rights (RoR) and Sub-Registrar transactions.
  - `zoning_fsi_violation`: Compares building permit approved FSI against zoning permitted FSI.
  - `active_encumbrance`: Flags active encumbrances/mortgages.

## 4. Role-Based Field Filtering & Security
- **JWT Mock Authentication**: Issues signed JWT tokens with role claims (`citizen`, `officer`, `bank`).
- **Server-Side Enforced Scoping**: Citizens receive sanitized parcel responses where sensitive internal administrative source fields and audit logs are stripped before transmission.

## 5. Offline Local Execution
- **Containerized Stack**: Complete stack runs via `docker-compose up` without external cloud dependencies.

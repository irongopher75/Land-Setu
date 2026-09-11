# LandSetu — Sovereign GIS Land Governance Platform

LandSetu is a parcel-centric GIS platform designed to unify land-governance data across multiple government departments (Record of Rights, Registration, Zoning, Building Permits, Tax, Encumbrances) using a **config-driven schema adapter**, an **explainable spatial rule engine**, and a **verifiable QR parcel passport**.

---

## 🚀 Quickstart (One Command Run)

Run the full local stack (PostGIS + FastAPI Backend + Vite React Frontend) with Docker Compose:

```bash
docker-compose up --build
```

Access the applications:
- **Interactive GIS Map Dashboard**: [http://localhost:5173](http://localhost:5173)
- **FastAPI OpenAPI Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **PostgreSQL / PostGIS Database**: `localhost:5432` (User: `landsetu`, Pass: `landsetu_pass`, DB: `landsetu_db`)

---

## 🏛️ System Architecture

```
landsetu/
  ├── docker-compose.yml        # Multi-container orchestration
  ├── DECISIONS.md              # Architecture & MVP design choices
  ├── backend/
  │   ├── app/
  │   │   ├── main.py           # FastAPI entrypoint
  │   │   ├── models.py         # SQLAlchemy + PostGIS geometry models
  │   │   ├── schemas.py        # Canonical Pydantic schemas & response models
  │   │   ├── adapter.py        # Config-driven Schema Adapter Engine
  │   │   ├── rules.py          # Spatial & data rule engine (PostGIS + Shapely)
  │   │   ├── seed.py           # Seeding script loading CSVs through adapter
  │   │   └── routes/           # REST endpoints (/parcels, /adapter, /auth)
  │   ├── configs/
  │   │   ├── tamilnadu.yaml    # TN_RoR_v3 field mapping config
  │   │   └── chandigarh.yaml   # CHD_Jamabandi_v2 field mapping config
  │   └── mock_data/            # Raw state CSVs & GeoJSON polygons
  └── frontend/
      └── src/
          ├── components/
          │   ├── MapView.jsx          # Leaflet GIS Map with status highlights
          │   ├── ParcelPanel.jsx      # Slide-out cross-department drawer
          │   ├── ConfidenceBadge.jsx  # Verified, Self-declared, Stale badges
          │   ├── RoleSwitcher.jsx     # Role-based API field view toggle
          │   ├── ParcelPassportQR.jsx # Verifiable QR code generator
          │   └── AdapterDemo.jsx      # Live schema adapter sandbox
          └── App.jsx
```

---

## 🎯 Demo Walkthrough Script for Judges

Follow this step-by-step click-through path to evaluate all hackathon criteria:

### Step 1: Config-Driven Schema Adapter Engine Sandbox
1. Click on the **Adapter Sandbox** tab in the top navigation bar.
2. Select **Tamil Nadu (TN_RoR_v3 Config)** and choose `Record #1 (TN-CHN-0042-1187)`.
3. Notice how raw CSV fields like `pattadar_peyar` convert to `layers.ror.owner_name`, and unit conversions automatically transform `extent_hectares` into `area_sqm`.
4. Switch state to **Chandigarh (CHD_Jamabandi_v2 Config)**.
5. Notice how completely different column names (`owner_full_name`, `record_no`, `area_sqyd`) pass through the engine and output the exact same canonical JSON schema structure.

### Step 2: Interactive GIS Map & Rule Violation Flags
1. Click **GIS Map View** in the navbar.
2. Toggle the **State Cluster** selector to **Tamil Nadu (Chennai)**:
   - Click on parcel `TN-CHN-0042-1187` or `TN-CHN-0042-1188` (highlighted red border).
   - Observe the **Boundary Overlap Flag** (`ST_Overlaps` detected between neighboring polygons).
   - Inspect the **Stale Tax Badge** (last verified in 2016).
   - Click on parcel `TN-CHN-0042-1189` to view an **Ownership Mismatch Flag** (Record of Rights owner != Sub-Registrar deed buyer).
   - Click on parcel `TN-CHN-0042-1190` to view a **Zoning/FSI Violation Flag** (Approved building FSI 2.8 > Permitted zoning FSI 2.0).
3. Switch State Cluster to **Chandigarh**:
   - Click on parcel `CHD-SEC-0017-0203` inside the purple dashed polygon.
   - Observe the **Protected Eco-Sensitive Zone Containment Flag** (`ST_Contains` on Sukhna Lake Eco-Zone).

### Step 3: Role-Based Field Visibility Scoping
1. Open parcel `TN-CHN-0042-1187` in the right drawer.
2. In the top navbar **Role Switcher**, change role from **Revenue Officer** to **Citizen**.
3. Notice how internal department audit sources and raw CSV rows are stripped server-side from the response, presenting a clean, citizen-facing summary.

### Step 4: Verifiable Parcel Passport QR Code
1. Open any parcel in the drawer.
2. Click **Generate Verifiable QR Passport**.
3. Scan the generated QR code with any camera or QR scanner to inspect the cryptographically signed JWT payload containing ULPIN, owner details, timestamp, and verification status.

---

## 🛠️ Local Development (Without Docker)

### Backend Setup:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup:
```bash
cd frontend
npm install
npm run dev
```

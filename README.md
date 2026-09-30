# LandSetu — Sovereign GIS Land Governance Platform

LandSetu is a parcel-centric GIS platform that puts one parcel's records from several government departments (Record of Rights, Registration, Zoning, Building Permits, Tax, Encumbrances) side by side and flags where they disagree. It combines a **config-driven schema adapter**, an **explainable spatial rule engine**, a **role-gated approval pipeline**, a **cross-department transaction workflow**, a **hash-chained audit log** and a **verifiable QR parcel passport**.

Built for Smart India Hackathon problem statement SIH26014 (Department of Land Resources, "Land Stack") by team Logic Lords. This is a prototype. All parcels, owners and identifiers are synthetic; none describe a real person or property. The pilot states are Chandigarh (urban) and Tamil Nadu, with SVAMITVA terminology for rural records. ULPIN is the canonical parcel identifier.

---

## Quickstart

Run the full local stack (PostGIS, FastAPI backend, Vite React frontend) with Docker Compose:

```bash
docker-compose up --build
```

- **Map and portal**: [http://localhost:5173](http://localhost:5173)
- **API documentation (OpenAPI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **PostgreSQL / PostGIS**: `localhost:5432` (user `landsetu`, password `landsetu_pass`, database `landsetu_db`; local development credentials only)

Signing in as an officer, auditor, state admin or bank user needs a verified identity. For local work, use the Firebase emulator path below.

---

## System architecture

```
landsetu/
  docker-compose.yml          # Multi-container orchestration
  DECISIONS.md                # Architecture and MVP design choices
  firestore.rules             # Firestore rules (the profile document users/{uid})
  backend/
    app/
      main.py                 # FastAPI entrypoint, startup seeding
      models.py               # SQLAlchemy + PostGIS models
      schemas.py              # Canonical Pydantic schemas
      adapter.py              # Config-driven schema adapter engine
      rules.py                # Spatial and data rule engine (PostGIS, Shapely fallback)
      flags.py                # Rule flags and their cache
      transactions.py         # Cross-department transaction workflow (chain read from configs)
      audit.py                # Append-only, hash-chained audit log
      permissions.py          # Role checks
      intelligence/           # Statistical signals and planted synthetic cases
      seed.py                 # Seeds the database from mock_data through the adapter
      routes/                 # auth, parcels, workflow, transactions, adapter, flags, intelligence, admin
    configs/*.yaml            # Per-state field mappings and transaction_workflow chains
    mock_data/                # Raw state CSVs and GeoJSON polygons
    scripts/                  # Emulator users, role and account management
    tests/                    # pytest suite
  frontend/
    src/
      api.js                  # The only client of the backend API
      firebase.js             # Firebase Auth setup (sign-in)
      firebaseFirestore.js    # Writes the signed-in user's profile document only
      components/             # MapView, ParcelPanel, TransactionTimeline, ApprovalQueueModal,
                              # StateLogModal, AuditLogViewer, ParcelPassportQR, AdapterDemo, ...
      pages/                  # Search, Bank (lender verification), Developers, officer console, ...
  scripts/
    demo_reset.sh             # Reset the local demo to a clean seed
```

---

## Roles

| Role | Can do |
|---|---|
| Citizen | Search, view public record fields, report an issue with a parcel (correction request), track own requests |
| Village officer (Patwari) | First review of corrections, boundary changes, splits and merges; Revenue field verification in a transaction |
| Revenue Officer (Sub-Registrar) | Start a transaction, verify the deed, hand it off to Revenue |
| Auditor | Second review of requests; Supervisor stage in a transaction; audit log |
| State admin | Final approval; archival requests; State activity log; final Revenue stage |
| Bank (lender) | Read-only parcel verification and passport; cannot file corrections or boundary markings |

The API enforces every role (`require_roles`). The interface only hides actions the API would refuse. Confidence labels (verified, self-declared, stale) are computed on the server.

---

## Demo

The step-by-step filming script, with credentials and exact clicks, is in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). Known gaps are in [`DEMO_KNOWN_ISSUES.md`](DEMO_KNOWN_ISSUES.md). Highlights:

1. **Map and flags.** Open the map for Tamil Nadu (Chennai) or Chandigarh. Flagged parcels have a red dashed outline, so the flag is never shown by colour alone. In Tamil Nadu, `TN-CHN-0042-1187` and `-1188` show a boundary overlap, `-1189` an ownership mismatch (Record of Rights owner differs from the deed buyer), `-1190` a zoning violation (approved FSI 2.8 against permitted 2.0). Chandigarh has a protected eco-sensitive zone polygon.
2. **Search.** Search by ULPIN, owner name or khata number. Results load 20 at a time with a Load more button.
3. **Correction pipeline.** A citizen reports an issue on a parcel. The village officer, auditor and state admin review it in turn, and the citizen sees the outcome and any rejection remarks under "Your requests".
4. **Transactions.** On a parcel's History tab, a Sub-Registrar starts a sale, hands it to Revenue, and each officer role advances or rejects it at its own stage. Municipal property tax re-keys on its own at the end. There is no lender stage in the chain.
5. **Audit.** The state admin's "State activity" dialog lists every recorded change from the append-only, hash-chained audit log.
6. **Schema adapter.** In the officer console, the Import page runs a raw state record through the adapter and shows the canonical JSON. Tamil Nadu (`pattadar_peyar`, `extent_hectares`) and Chandigarh (`owner_full_name`, `area_sqyd`) produce the same structure.
7. **QR passport.** Officers, auditors, state admins and bank users can generate a signed passport QR for a parcel.

---

## Local development (without Docker)

### Required security configuration

Copy `.env.example` to `.env`, generate a random `JWT_SECRET` (at least 32 characters, no default), and load those values before starting the backend. `DEMO_LOGIN_ENABLED` is off by default; it enables an unverified citizen-only login and is for isolated HTTP-only local demos only (with `COOKIE_SECURE=false`). Never use those values in a deployed environment. Officer and bank roles come from verified Firebase custom claims.

The backend refuses to start on SQLite in production and never falls back silently. For throwaway local work only, set `ALLOW_SQLITE_FALLBACK=true`.

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
JWT_SECRET=$(openssl rand -hex 32) ALLOW_SQLITE_FALLBACK=true uvicorn app.main:app --reload --port 8000
```

The database is seeded on first start.

### Frontend

```bash
cd frontend
npm install
npm run dev        # development server
npm run build      # production build
```

### Signing in as each role locally (Firebase emulators, dev only)

This path is opt-in. It is active only when `VITE_USE_AUTH_EMULATOR=true`, which no committed env file sets, and production builds contain none of it.

```bash
# Terminal 1: Auth and Firestore emulators, with the repo's firestore.rules (UI at http://127.0.0.1:4000)
firebase emulators:start --only auth,firestore

# Terminal 2: one test user per role, in the emulator only (prints the emails and a password)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 ./venv/bin/python backend/scripts/seed_emulator_users.py

# Terminal 3: backend that accepts emulator tokens
cd backend && FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=landsetu-e4e5e \
  JWT_SECRET=$(openssl rand -hex 32) ALLOW_SQLITE_FALLBACK=true uvicorn app.main:app --port 8000

# Terminal 4: frontend wired to the emulators
cd frontend && npm run dev:emulator
```

**Never set `FIREBASE_AUTH_EMULATOR_HOST` outside local development.** With it set, the Firebase Admin SDK accepts unsigned tokens, so anyone could sign in as any role.

For a demo on PostGIS (Homebrew Postgres, emulators, a reset command and the full filming order), follow section 0 of [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). `scripts/demo_reset.sh` returns the local demo to a clean seed.

### Tests

```bash
cd backend
PYTHONPATH=. ../venv/bin/pytest tests/ -q
```

The tests use a SQLite file (`backend/landsetu.db`) and leave rows behind. Move that file aside before rerunning. There is no frontend test suite.

---

## Data and persistence

- **PostgreSQL + PostGIS is the only store for records.** Parcels, correction and boundary requests, transactions and the audit log are all read and written through the REST API (`/parcels`, `/transactions`, `/adapter`, `/auth`). It provides GIST-indexed spatial queries and server-side role checks.
- **Firebase Authentication** signs users in. The backend verifies the ID token and reads the role from its custom claim.
- **Firestore holds only the signed-in user's profile document** (`users/{uid}`). The browser does not read or write parcels, requests or the ledger there.
- **The audit log is append-only.** Each entry's hash covers the previous entry for the same ULPIN, and a database trigger blocks updates and deletes.
- **Synthetic data only.** Do not add real land records or real individuals' ownership data (see `docs/important.md`).

The architecture rationale is in [`DECISIONS.md`](DECISIONS.md). Any new write path must be enforced both in the backend (`require_roles`) and in `firestore.rules`; updating only one reopens a role bypass.

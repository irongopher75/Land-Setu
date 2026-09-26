# LandSetu security and correctness posture

**Re-verified:** 26 September 2026, against `main` at `acdc640`. **Updated** the same day for the trust-boundary fixes (`247446d`, `94360b0`, `05bc7b3`, `62c3c3e`).
**Replaces:** the original point-in-time audit (`audit.md`, not tracked) and the open items listed in `SKILLS.md`. Those documents are now stale in several places. This file is the current source of truth until it is merged into the Standard Technical Document.

## Method

Each finding was checked against the current source code by reading it directly, not against the wording of the earlier audit. Where a finding could be exercised, it was reproduced against a local backend (`uvicorn`, SQLite dev mode, `DEMO_LOGIN_ENABLED=false`) at `http://localhost:8000`. **Nothing was changed in this pass.**

The source code shows what *would* be deployed. It does not prove what *is* deployed. Where a finding depends on live configuration (deployed Firestore rules, Render environment variables, secrets actually in use), the entry says so and gives the check that would confirm it.

| Status | Meaning |
|---|---|
| **Fixed** | The code that closes the finding is cited. |
| **Partially mitigated** | What is done is cited, and what remains is located. |
| **Open** | The gap is confirmed in current code and located. |
| **Needs live check** | Source is correct, but the risk depends on deployed state. The check is given. |

---

## A. Original critical findings

### A1. Firestore in open test mode / credentials committed

**Status: Fixed. The deployed ruleset matches the repo byte for byte (checked 2026-09-26, deployment record below).**

- **Default deny.** `firestore.rules`, final block: `match /{document=**} { allow read, write: if false; }`.
- **Role checks.** Access is gated on the custom claim, through `hasRole()`: `request.auth.token.role in allowedRoles`. It is used by `isGovernanceOfficer()`, `isAdminOrAuditor()` and `isStateAdmin()`.
- **Live evidence.** The Phase 0 crawl ran signed out against the real project `landsetu-e4e5e`. Its reads of `custom_parcels` and `deleted_parcels` were refused with `Missing or insufficient permissions` (`docs/ui-baseline/crawl-results.json`). The deployed rules therefore deny unauthenticated reads of those collections. That does not prove the whole deployed ruleset equals the committed file.
- **No service-account key or private key is tracked.** `git ls-files | xargs grep -l "private_key\|BEGIN PRIVATE"` finds no key material. The only files it matches are under `frontend/node_modules/.bin`, and those are not keys (see C9). The Firebase web config in `frontend/.env.production` is public by design; it identifies the project and is not a credential.

**Live check (read-only):**
```sh
# Show the ruleset currently released for Firestore, then diff it against the repo copy.
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firebaserules.googleapis.com/v1/projects/landsetu-e4e5e/releases/cloud.firestore"
#   -> note "rulesetName", then:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firebaserules.googleapis.com/v1/<rulesetName>" | jq -r '.source.files[0].content' > /tmp/deployed.rules
diff /tmp/deployed.rules firestore.rules
```
You can also open the Firebase console at Firestore Database, then Rules, and compare the text with the repo file. `firebase deploy --only firestore:rules --dry-run` only compiles the local file. It does not show what is deployed.

**New while re-checking:** the rules are role-gated, but they still let officers bypass the backend approval workflow. This is recorded separately as **C4**.

#### Deployment record, 26 September 2026

`gcloud` is not installed on the deploying machine, so the check used `scripts/show_live_firestore_rules.cjs`. The script reads the released ruleset through the signed-in Firebase CLI account and is read-only:

```sh
node scripts/show_live_firestore_rules.cjs landsetu-e4e5e > /tmp/live.rules
diff /tmp/live.rules firestore.rules && echo "live rules match the repo"
```

**Before deploying** (checked 2026-09-26, about 08:02 UTC):
```
release projects/landsetu-e4e5e/releases/cloud.firestore -> projects/landsetu-e4e5e/rulesets/b2d1c634-3827-4dbe-a339-122f8c5d16de (updated 2026-09-24T16:10:15.930473Z)
live ruleset: 245 lines, sha256 40e29513ee6aa9a8174b6f1ffb048ee51c8440a7edfe5c2c4a5ae9bf64647b2b
repo firestore.rules at cb70db2 (before 247446d): sha256 40e29513ee6aa9a8174b6f1ffb048ee51c8440a7edfe5c2c4a5ae9bf64647b2b  -> IDENTICAL
repo firestore.rules at 2414d28: sha256 8ac48876eb39e9d4e0b5624994299937cde36b66a449dce7b5beb130a536adfc  -> differs
```
So the live project was running exactly the committed pre-fix rules. That confirms the C4 bypasses were live until this deploy.

**Deploy** (`firebase deploy --only firestore:rules --project landsetu-e4e5e`):
```
i  cloud.firestore: checking firestore.rules for compilation errors...
⚠  [W] 128:14 - Unused function: isValidCustomParcel.
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  firestore: uploading rules firestore.rules...
✔  firestore: released rules firestore.rules to cloud.firestore
✔  Deploy complete!
```
The warning is expected. `isValidCustomParcel` is kept to document the shape the records service writes, now that no client may write `custom_parcels`.

**After deploying** (checked 2026-09-26T08:03:48Z):
```
release projects/landsetu-e4e5e/releases/cloud.firestore -> projects/landsetu-e4e5e/rulesets/ff87e911-3bda-4062-9661-96fdb09cb637 (updated 2026-09-26T08:03:36.403156Z)
live ruleset: sha256 8ac48876eb39e9d4e0b5624994299937cde36b66a449dce7b5beb130a536adfc
repo firestore.rules at 2414d28: sha256 8ac48876eb39e9d4e0b5624994299937cde36b66a449dce7b5beb130a536adfc  -> IDENTICAL
```

**Effect on the site that is currently deployed.** The frontend on Firebase Hosting predates `247446d`. Its browser-side Firestore writes are now refused:

- officer writes to `custom_parcels`;
- `boundary_requests` without `requesterUid`;
- deletion markers without `requestId`.

Those helpers catch the error and log a console warning, so nothing breaks visibly. Records-service (API) actions are unaffected. Redeploying the frontend brings its writes in line with the new rules.

### A2. Hardcoded fallback JWT secret

**Status: Fixed in source. One leftover item needs a live check.**

- **Compose:** `docker-compose.yml:28` reads `JWT_SECRET=${JWT_SECRET:?JWT_SECRET must be set in environment or .env}`, so compose refuses to start without the variable.
- **Application:** `backend/app/routes/auth.py:16-19` reads `SECRET_KEY = os.getenv("JWT_SECRET")` and raises `RuntimeError` if the value is missing or shorter than 32 characters. There is no fallback value.
- **Render:** `render.yaml` sets `JWT_SECRET: generateValue: true`.
- **Re-grep today:** `JWT_SECRET` appears only in the four places above plus `.env.example`, whose value is `replace-with-a-random-64-character-secret`. No fallback has been reintroduced.
- **Still in history.** The old literal `landsetu_jwt_secret_hackathon_2026` remains in public git history (commits `83a0c94` and `c44069a`). The repository is public: `https://api.github.com/repos/irongopher75/Land-Setu` returns 200 without authentication. Anyone can mint valid session tokens for any environment that was ever started with that value. The local `.env` does not contain it.

**Live check.** Confirm that the Render service's `JWT_SECRET` is the generated value and not the old literal (Render dashboard, then `landsetu-api`, then Environment). If there is any doubt, rotate it. Rotation logs everyone out and has no other effect. Rewriting git history is optional once no environment uses the value.

### A3. O(n²) Python-side spatial overlap checks

**Status: Fixed on the production (PostGIS) path. The planned bulk set-based query has not landed.**

- **GiST index.** `backend/app/models.py:13` declares `Geometry("POLYGON", srid=4326, spatial_index=True)`. `backend/alembic/versions/0002_parcel_flags_and_gist.py:31-32` creates `idx_parcels_geometry` and `idx_protected_zones_geometry USING gist`.
- **Indexed overlap query.** `backend/app/rules.py:190-208` (`_check_boundary_overlap`, PostGIS branch) runs one indexed query per parcel, `ST_Intersects AND NOT ST_Touches`, with the overlap area computed on `geography`.
- **Flag cache.** `Parcel.flags` caches the result. `invalidate_neighbor_flags` (`rules.py:104-132`) marks as stale only the neighbours whose bounding boxes intersect the edited parcel.
- **Remaining Python scan.** The full scan over a state's parcels (`rules.py:210-222`) runs only when `IS_SQLITE`, which is dev mode.
- **Not landed:** a bulk set-based self-join for state or district re-validation. `RuleEngine.evaluate_parcels_batch` (`rules.py:170-181`) still loops over parcels and calls `refresh_flags` on each. It is called synchronously from read endpoints: `routes/parcels.py:101` and `:160`, and `workflow.py:231`.

**To finish it:** replace the loop in `evaluate_parcels_batch` with a single `ST_Intersects` self-join (`a.id < b.id`, scoped by state or district) for cache misses. Move bulk recomputation out of GET handlers and into a worker (`docs/std/deployment-scalability.md`, section 4.4).

### A4. Split brain from SQLite fallback with multiple replicas

**Status: Partially mitigated. The fallback is opt-in and off in every committed deployment configuration. The planned production refusal has not been added.**

- **Opt-in.** `backend/app/db.py:11` defaults `ALLOW_SQLITE_FALLBACK` to `false`. `db.py:23-32` raises instead of falling back unless the flag is `true`.
- **Deploy configs.** `docker-compose.yml` and `render.yaml` both set `ALLOW_SQLITE_FALLBACK=false`.
- **Not added:** nothing refuses the fallback when `ENVIRONMENT=production`. `db.py` reads only `ALLOW_SQLITE_FALLBACK`. Setting the flag to `true` on a production replica would still enable it.

**Target:** `backend/app/db.py:23`. Make the condition `ALLOW_SQLITE_FALLBACK and os.getenv("ENVIRONMENT","").lower() != "production"`. The same guard is also needed for a `DATABASE_URL` that is explicitly `sqlite:` (`db.py:14`).

**Live check:** Render dashboard, `landsetu-api`, Environment. Confirm `ALLOW_SQLITE_FALLBACK=false` and `ENVIRONMENT=production`.

---

## B. Findings re-checked in this pass

### B1. `DEMO_LOGIN_ENABLED` declared but never enforced

**Status: Fixed. The audit finding is outdated. The flag is enforced, with a production override on top.**

- **Real path:** `POST /auth/mock-login`. The router prefix is `/auth` (`routes/auth.py:21`) and the handler is at `routes/auth.py:103`.
- **Gate:** `routes/auth.py:110`. `if not DEMO_LOGIN_ENABLED or os.getenv("ENVIRONMENT","").lower() == "production": raise HTTPException(404)`. The check runs *before* the client-supplied role is read.
- **`super_admin` is never issued through this endpoint** (`auth.py:117`). An unknown role becomes `citizen`.
- **Flag defaults:** `false` in `auth.py:10`, `docker-compose.yml:30` and `.env.example:5`. `render.yaml` also sets `DEMO_LOGIN_ENABLED=false` with `ENVIRONMENT=production`.
- **Frontend:** normal sign-in never calls the endpoint. `mockLogin` in `frontend/src/api.js:71` has no caller in `src/`. `LoginPage.jsx` uses Firebase sign-in followed by `/auth/firebase-login`, where the role comes only from the verified custom claim (`auth.py:140-148`).

**Corrected reproduction.** This sends the request to the real endpoint:
```sh
# Local, flag off (default):
curl -si -X POST http://localhost:8000/auth/mock-login \
  -H 'Content-Type: application/json' -d '{"role":"state_admin"}' | head -1
# -> HTTP/1.1 404 Not Found            (observed 26 Sep 2026)

# Local, flag deliberately on, not production -> demo token is issued (by design):
DEMO_LOGIN_ENABLED=true JWT_SECRET=$(openssl rand -hex 32) ALLOW_SQLITE_FALLBACK=true uvicorn app.main:app --port 8001
curl -si -X POST http://localhost:8001/auth/mock-login -H 'Content-Type: application/json' -d '{"role":"state_admin"}'
# -> 200, role "state_admin"; with {"role":"super_admin"} -> role "citizen"

# Flag on AND ENVIRONMENT=production -> 404 regardless.
```

**Residual risk.** Any environment that sets `DEMO_LOGIN_ENABLED=true` without `ENVIRONMENT=production` hands out `state_admin` to anyone. That is intended for an isolated demo.

**Live check (one request, read-only effect):**
```sh
curl -si -X POST https://landsetu-api.onrender.com/auth/mock-login \
  -H 'Content-Type: application/json' -d '{"role":"citizen"}' | head -1   # expect 404
```

### B2. Flat-degree overlap area vs. Turf.js geodesic area (TN-CHN-0042-1187: 5,860 m² overlap on a 452 m² parcel)

**Status: The area formula is fixed. Of the three problems behind the live symptom, parts 2 and 3 are Fixed (`62c3c3e`, `05bc7b3`). Part 1, the seed data, is Open, and the list of affected parcels is below.**

- **Part 2 fixed in `62c3c3e`.** `RuleEngine._check_area_consistency` raises an `area_mismatch` flag when the difference between boundary area and recorded extent, divided by the recorded extent, exceeds `AREA_MISMATCH_TOLERANCE` (default `0.10`, set by environment variable). Alembic `0007` clears cached flags so existing databases evaluate it.
- **Part 3 fixed in `05bc7b3`.** Area is computed on the server from the polygon at filing and again at approval. The client value is ignored, and so is any value already stored on the request. The source record's extent is kept in `layers.ror.recorded_extent_sqm` before `area_sqm` is replaced.
- **Part 1 open (data fix, not scheduled here).** `scripts/validate_seed_geometry.py` reports **all 46 seeded parcels** outside the 10% tolerance: 17 Chennai and Chandigarh parcels at 74× to 157×, 25 Kanchipuram fixtures at 10×, two at 6×, and two at 0.8×. Every seeded parcel therefore shows an `area_mismatch` flag until the geometry is regenerated.

**The area formula is correct.**

- **Dev path:** `rules.py:17-31` (`_ring_area_sqm`) is the spherical ring-area algorithm Turf.js uses, with the same `EARTH_RADIUS_M = 6378137.0`. `compute_geodesic_area_sqm` (`rules.py:34-50`) applies it.
- **PostGIS path:** overlap area is computed as `ST_Area(ST_Intersection(...)::geography)` (`rules.py:195`), which is geodesic on the spheroid.
- **There is no flat-degree calculation anywhere in either path.**

**What actually produces 5,860 vs 452.** Computed with `compute_geodesic_area_sqm` on the served geometries:

| ULPIN | Recorded `area_sqm` | Area of stored geometry | Ratio |
|---|---|---|---|
| TN-CHN-0042-1187 | 452 | 63,615 m² | 141× |
| TN-CHN-0042-1188 | 520 | 58,198 m² | 112× |
| Intersection of the two | | **5,860.7 m²** | |

The overlap figure is geometrically correct for the polygons stored. The polygons themselves are about 100 times larger than the parcels' recorded extent. `mock_data/tamilnadu_parcels.csv` has `0.0452` ha, which the adapter correctly converts to 452 m². The mismatch runs through the seed data:

- Chennai (`TN-CHN-0042-*`): 74× to 145×.
- Chandigarh (`CHD-SEC-0017-*`): 77× to 157×.
- Kanchipuram (`TN-KPM-0107-*`): 10×.
- Two parcels are the other way round: `TN-CGL-0311-0041` and `TN-TVL-0205-0077` are 0.8×.

**Three separate problems, each with its own fix target:**
1. **Seed geometry is out of scale** with the recorded extents. Targets: `backend/mock_data/tamilnadu_geometries.geojson` and `backend/mock_data/chandigarh_geometries.geojson`. The fix is to regenerate them, or to rescale about each centroid to the recorded area.
2. **No rule compares recorded area with surveyed (geometry) area.** A 100× discrepancy goes unflagged. For a land registry this is itself a primary check. Target: add a rule next to `_check_boundary_overlap` in `backend/app/rules.py` (the `compute_flags` list at `rules.py:144`). It should flag when `|geometry_area − area_sqm| / area_sqm` exceeds a tolerance.
3. **Approval writes the client-supplied area** (`routes/parcels.py:594`, `existing.area_sqm = req.area_sqm`; `:605` for new parcels). The area comes from the browser (`calculatePolygonAreaSqm`, `MapView.jsx:31`, a spherical formula rather than Turf.js) and is never recomputed on the server. Target: compute `area_sqm` from the approved geometry on the server at approval time, and keep the recorded (RoR) extent in `layers.ror` as a separate field.

The UI shows `area_sqm` with no label for which of the two figures it is (Phase 0 finding 4).

### B3. Bounding-box state detection misassigns parcels near state borders

**Status: Partially mitigated. The persisted state is Fixed in `05bc7b3`; the frontend's bounding-box guess no longer reaches the database. The frontend still uses bounding boxes to decide which state the map shows while panning, and the state outlines are still hand-drawn.**

`05bc7b3`: `server_area_and_state()` derives the state from the polygon's centroid by point-in-polygon, at filing and at approval. The client's `state` is ignored.

- A ULPIN whose state code names another state is refused (409).
- An approval that would move an existing parcel to another state is refused (409).
- The frontend no longer sends `state`. After filing, it switches the map to the state the service returned.
- Remaining work: make `identifyStateByCoords` call the backend first, and use official boundaries.

**Backend (fixed in principle).** `backend/app/states.py:185-205` (`detect_state_from_coords`) does Shapely point-in-polygon, then falls back to the nearest polygon by distance. Remaining gaps:

- The polygons are hand-drawn outlines of 12 to 18 vertices (for example Tamil Nadu at `states.py:18-22`), not official boundaries.
- The first polygon that matches wins, so overlapping outlines resolve by list order.

**Frontend (still bbox).** `frontend/src/api.js:1053-1087` (`identifyStateByCoords`):

- It checks `LOCAL_STATES` bounding boxes first (`api.js:1037-1050`).
- It returns on the first bounding-box hit without calling the backend.
- It calls `/parcels/identify-state` only when no bounding box matches.

**Reproduction.** Bengaluru (12.9716, 77.5946) lies inside the Tamil Nadu bounding box (lat 8.0 to 13.6, lng 76.2 to 80.4), and Tamil Nadu is first in the list.

- The frontend returns **TamilNadu**.
- The backend `GET /parcels/identify-state?lat=12.9716&lng=77.5946` returns **Karnataka** (observed).

**Why it matters.** When an officer draws a boundary, `MapView.jsx:705-711` sends the frontend's answer as `state` to `POST /parcels/custom`. The backend uses the client value whenever one is given (`routes/parcels.py:321-325`). On approval it writes that value to the parcel (`routes/parcels.py:595`, `existing.state = req.state`). A misdetected state can therefore move an existing parcel into the wrong state's partition.

**Targets:**
- `identifyStateByCoords` should call the backend first and use bounding boxes only as the offline fallback.
- `create_custom_parcel` should derive the state on the server from the geometry, and reject a mismatch with the ULPIN's state prefix.
- Approval should never change `Parcel.state` for an existing ULPIN.
- Replace the hand-drawn outlines with official state and district boundaries (main document, section 8 item 4).

### B4. Missing features versus the brief

This reconciles the original "missing" list with what the Phase 0 crawl and the code actually contain.

| Feature | Status | Evidence |
|---|---|---|
| Service requests (submit and track) | **Exists** | `CitizenServiceTrackerModal.jsx`, reached from the parcel panel's "Report an issue" and from `/grievance`. Backend: `POST /parcels/{ulpin}/correction-request` (`workflow.py:122`), `routes/flags.py` |
| Transaction / mutation tracking | **Exists** | Parcel panel History tab (`ParcelTimeline.jsx`, `GET /parcels/{ulpin}/history`). Tables `registration_transactions` and `encumbrance_events` (`models.py:152`, `:168`) |
| Audit log UI | **Exists, with one dead entry point** | `/officer/audit` (`pages/officer/AuditPage.jsx`), `StateLogModal.jsx`, per-parcel hash chain (`GET /parcels/{ulpin}/audit-chain`). `AuditLogModal.jsx` cannot be reached: `setShowAuditLog(true)` is never called (`App.jsx`) |
| Real boundary polygons | **Open** | Parcel geometries are synthetic and out of scale (B2). State outlines are hand-drawn (B3) |
| AI/ML integration | **Partial, and deliberately limited** | The statistical-signals layer and classifier exist (`backend/app/intelligence/`). The risk score is withheld from every screen (main document, section 5C). The satellite change-detection modal is unreachable (`setShowSatelliteAi(true)` is never called) and produces its numbers with `Math.random()` (`SatelliteAiChangeDetectionModal.jsx:24-25`). If it is ever wired up, it must be labelled a simulation |
| **Notifications** | **Open, confirmed missing** | No notification model, route, delivery channel or UI. The `notified` field returned when a concern is raised (`routes/flags.py:65`) lists role names only; nothing is sent. This matches main document section 8, item 13 |

### B5. UI gaps (cross-referenced with Phase 0; no new crawl)

| Gap | Status | Evidence |
|---|---|---|
| Demo/live data badge | **Open** | No badge in the shell (`Navbar.jsx`). The prototype notice is only in the footer, and the footer is hidden on `/map` (`App.jsx`, `activeView !== 'map'`). An "Offline demo mode" toast appears only on fallback. Phase 0 report, finding 7 |
| Consolidated role state | **Open** | The role is held in `App.jsx` state, in `localStorage.landsetu_role` (written in 5 places across `App.jsx` and `LoginPage.jsx`, read in 8 places), in `AuthContext` (`isSuper` only), and in `api.js` `roleDiagnostic`. `RoleSwitcher.jsx` is dead code. The client-side role controls only what the UI shows; the server enforces access |
| Mobile responsiveness | **Open** | `/map` is 465 px wide on a 375 px viewport (sideways scroll). The parcel panel covers the whole map at 375 and 768 px. Phase 0 report, findings 1 and 2 |

---

## C. Findings raised this session

### C1. The map shows an arbitrary first page of parcels, not the parcels in view

**Status: Open. This is a correctness bug.**

`frontend/src/api.js:154-179` (`getParcelsGeoJSON`) makes one request to `GET /parcels/geojson/all?state=…` and never follows up with further pages. The endpoint (`routes/parcels.py:152-185`) pages by `ORDER BY id OFFSET … LIMIT`, returning 500 rows by default and at most 1,000.

Once a state has more than 500 active parcels, the map silently shows the 500 with the lowest ids, whatever part of the state is on screen. Nothing tells the user the map is incomplete. An officer can therefore conclude a parcel does not exist, or that a boundary has no neighbours, because the neighbour was never drawn.

**Targets:**
- Add a `bbox` parameter to `/parcels/geojson/all` and filter with `ST_Intersects(geometry, ST_MakeEnvelope(...))` on the GiST index.
- Have `MapView.jsx` request the current bounds on `moveend`. It already debounces at 400 ms (`MapView.jsx:286-294`).
- Until that is done, show a visible "showing N of M parcels" notice.

### C2. `parcels.layers` is `JSON`, not `JSONB`

**Status: Open. This affects performance and scale; it is not a security risk.**

`backend/app/models.py:28` declares `layers = Column(JSON, ...)`, and the initial migration (`257b89b6dada_...py:41`) uses `sa.JSON()`. Only `flags` is `JSONB` (`models.py:6`).

The public search (`routes/workflow.py:198-207`) filters with `ilike` on `layers['ror']['owner_name'].as_string()`. That cannot use an index, so every search is a full scan of the table.

**Target:** an Alembic migration that converts `layers` to `JSONB`. Add a `pg_trgm` GIN index on the owner-name and khata expressions used by the search.

### C3. `officer` and `bank` roles are silently downgraded to the citizen UI

**Status: Open. Found by reading the code.** The emulator role crawl has not run yet; Step 1 of the emulator work is still awaiting approval.

`frontend/src/api.js:111` defines `KNOWN_ROLES = ['citizen','village_officer','auditor','state_admin','super_admin']`. `resolveRole` (`api.js:120-142`) accepts a role only if it is in that list, so `bank` and `officer` fall back to `citizen`. The backend accepts both roles (`auth.py:23`), and the passport endpoint is restricted to them (`routes/parcels.py:257`, `require_roles("officer","bank","auditor","state_admin")`).

- **Effect on bank users:** they see citizen screens and cannot reach lender views through the role check.
- **Security effect:** none. The downgrade fails closed.
- **About `officer`:** it is a legacy role that cannot be assigned (`auth.py:24-25`).

**Target:** add `bank` to `KNOWN_ROLES`. Decide whether `officer` should be mapped to `village_officer` or dropped.

### C4. Firestore rules let officers bypass the backend approval workflow

**Status: Fixed. Parcel-state paths were fixed in `247446d` and deployed on 2026-09-26 (A1). The `deed_blockchain` sub-item was fixed in `02ecf1b` and deployed on 2026-09-26 (C4a).**

`247446d`: `custom_parcels` is read-only for every client role, and deletion markers need a boundary request that reached `DELETED` for the same ULPIN. Requests are filed only at their first stage and move one stage at a time, by that stage's reviewer, never by the filer. Only `state_admin` and `super_admin` can finalise. Proven by 30 emulator tests in `tests/firestore-rules/rules.test.mjs` (`62c3c3e`).

What changed, item by item:

- **`custom_parcels`:** `allow create, update, delete: if false`. Only the records service (Admin SDK) writes a live parcel. The frontend no longer writes it, and it refuses to "approve" a request that exists only in the browser copy.
- **`deleted_parcels`:** `create` needs `isAdminOrAuditor()` and `isPipelineDeletion()`, which is a `requestId` pointing at a `boundary_requests` document with `status == 'DELETED'` and the same `ulpin`. `update` and `delete` are `false`.
- **`boundary_requests`:**
  - Create needs `requesterUid == request.auth.uid`, no decision fields, and a first-stage status only.
  - Updates may change only `status`, `approverRole` and `approvedAt`, and `approverRole` must equal the caller's role claim.
  - The filer cannot decide. `isAllowedTransition()` mirrors `STAGE_REVIEWERS` in `backend/app/permissions.py`.
  - `delete` is `false`.
- **`protected_zones`:** edits by state admin only.
- **`deed_blockchain` (fixed in `02ecf1b`):** `allow create, update, delete: if false` for every client role, proven by two rules tests.
  - The browser code that assembled "blocks" was deleted: `frontend/src/blockchain.js`, with fixed timestamps, invented owners and fake `ECDSA_SECP256K1_VERIFIED_…` signature strings.
  - The ledger the app shows is now only the records service's append-only audit log. Its hashes are recomputed and checked on the server at `GET /parcels/{ulpin}/audit-chain`.
  - Passports take their block hash and height from that log only. No invented fallback hash or token remains.
- **Side effect:** the Firestore seed scripts (`frontend/src/seedCloudFirestore.mjs`, `seedAllLegacyDataToFirestore.mjs`) use the client SDK. Under the new rules they can only write through the Admin SDK or the emulator.

Original finding, for the record. The rules checked roles, but they did not enforce the workflow the backend enforces:

- **`custom_parcels`.** Any governance officer, including a `village_officer`, may create or update any parcel directly (`firestore.rules`, `match /custom_parcels`). The map merges these documents into every signed-in user's view (`api.js:196-216` `getApprovedCustomParcels`, used by `MapView.jsx:552`). A single officer can therefore publish a boundary without the village, auditor and state-admin approvals the backend requires (`routes/parcels.py:327-331`: "Nobody, whatever their role, saves a boundary directly").
- **`deleted_parcels`.** An auditor or state admin may create an entry directly, and the map then hides that parcel for everyone. The backend's two-stage deletion is bypassed.
- **`boundary_requests` updates.**
  - A request can move straight to `APPROVED` from any status, provided the writer is a state admin. The rules do not check that the previous status was the preceding stage.
  - Any governance officer may rewrite `ulpin`, `requestedBy` or `approverRole` as long as the status stays the same.
  - Nothing stops a writer approving their own request, which the backend forbids.
- **`deed_blockchain`.** Any officer can append a block with arbitrary `prevHash` and `currentHash`, so the "tamper-evident" chain in Firestore can be forged.

**Targets (as written before the fix):**
- Preferred: make Firestore read-only for these collections. Set `allow write: if false`, and have the backend (Admin SDK) be the only writer, matching the main document's statement that PostgreSQL is authoritative. *Done for `custom_parcels`.*
- Otherwise: add previous-status checks (`resource.data.status`), immutability of identity fields, and a requester-not-approver check. *Done for `boundary_requests` and `deleted_parcels`.*

#### C4a. Deployment record for the `deed_blockchain` lock, 26 September 2026

Checked with `node scripts/show_live_firestore_rules.cjs landsetu-e4e5e`, same method as A1.

**Before deploying** (checked 2026-09-26T08:11:06Z):
```
release projects/landsetu-e4e5e/releases/cloud.firestore -> projects/landsetu-e4e5e/rulesets/ff87e911-3bda-4062-9661-96fdb09cb637 (updated 2026-09-26T08:03:36.403156Z)
live ruleset: sha256 8ac48876eb39e9d4e0b5624994299937cde36b66a449dce7b5beb130a536adfc  (= repo at 2414d28, the A1 deploy)
repo firestore.rules at 02ecf1b: sha256 929af87de22e561e1dd9b11bbd3e3057ae0a2c06db165562adf25c2e15ae14ee  -> differs
```

**Deploy** (`firebase deploy --only firestore:rules --project landsetu-e4e5e`):
```
⚠  [W] 128:14 - Unused function: isValidCustomParcel.
⚠  [W] 210:14 - Unused function: isValidDeedBlock.
✔  cloud.firestore: rules file firestore.rules compiled successfully
✔  firestore: released rules firestore.rules to cloud.firestore
✔  Deploy complete!
```
Both warnings are expected. Each unused validator documents the shape of a collection that no client may write.

**After deploying** (checked 2026-09-26T08:11:21Z):
```
release projects/landsetu-e4e5e/releases/cloud.firestore -> projects/landsetu-e4e5e/rulesets/770aee2d-4f08-4484-b2dd-5d76a66bd3c4 (updated 2026-09-26T08:11:20.979529Z)
live ruleset: sha256 929af87de22e561e1dd9b11bbd3e3057ae0a2c06db165562adf25c2e15ae14ee  -> IDENTICAL to repo at 02ecf1b
```

**Live probe.** An unauthenticated REST create on `deed_blockchain` returns `403 PERMISSION_DENIED`.

### C5. Approving a new parcel invents "verified" departmental records

**Status: Fixed in `94360b0`.**

`94360b0`: approving a new ULPIN now writes every departmental layer empty, with `confidence: "unverified"`. Owner, zoning, tax, permit and encumbrance are `None`. The typed name is kept only as `ror.claimed_owner_name`, which is hidden from citizens.

Every other `"verified"` literal was checked:

- **Adapter (`backend/app/adapter.py`, `_enrich_layers`):** a layer is labelled `verified` only when the source record supplied its value and that value is current. Missing values are `unverified`. An undated RoR, registration or tax record is `stale`. The invented RoR date `2022-01-01` and the default "no encumbrance" are removed. Seed confidence labels are unchanged.
- **Frontend:** the offline sample records and the offline adapter preview in `api.js` are labelled `unverified_placeholder`. The browser-only approval path that built a "verified" parcel was removed in `247446d`.
- **`ConfidenceBadge.jsx`:** no longer shows a missing or unknown confidence as Verified.
- **`ParcelPanel.jsx`:** shows an unknown encumbrance status as unknown, not as "None on record".

Tested in `backend/tests/test_trust_boundary.py` (`62c3c3e`).

**Remaining literals, reviewed and left in place:**
- `routes/parcels.py:222`, where `"verified"` is the audit-chain check result, not a data label.
- The test fixture in `backend/tests/conftest.py`.
- CSS tone classes.
- The Firestore seed scripts, which carry sample source records.

**Officer corrections (fixed in `ce99672`).** An approved correction (`workflow.py`, CORRECTION) now sets the layer's confidence to `corrected_by_officer`. It also records `corrected_fields`, `corrected_at` and `corrected_by_request`, and keeps the department's `last_verified` date instead of resetting it to today.

- Only an adapter import of the department's own record can label a layer `verified` again. Tests cover both the HIGH and the FAST correction tracks.
- The badge reads "Corrected by officer, not independently confirmed", with a pencil icon and its own style, distinct from verified, self-declared and sample values.
- Citizens can see which fields were corrected, and when.

Original finding, for the record. `backend/app/routes/parcels.py:597-604`. When a boundary request for a *new* ULPIN is approved, the handler writes placeholder layers and marks them `"confidence": "verified"`:

- `ror.owner_name` is set to the requester's free-text `owner_name`;
- zoning is fixed as `"residential"`;
- tax is fixed at `45000`;
- encumbrance is set to `false`.

None of these values came from the department they are attributed to. This contradicts the project's rule that confidence is computed on the server from source and recency (AGENTS.md, "Conventions").

**Target:** create new parcels with those layers empty and `confidence: "self_declared"`, or pending. Only an adapter import from the source department may set `verified`.

### C6. Any role other than citizen can file boundary requests, including `bank`

**Status: Open. Low to medium risk.**

`routes/parcels.py:293` blocks only `role == "citizen"`, so a `bank` session can call `POST /parcels/custom`. The request still has to pass the full HIGH-track approval chain, which limits the impact.

**Target:** replace the check with `require_roles("village_officer", "officer", "state_admin")`, the same roles as split and merge (`workflow.py:98`).

### C7. Anonymous owner-name enumeration through search

**Status: Open, as a policy decision.**

`GET /parcels/search` (`routes/workflow.py:198`) is public. It accepts a 2-character query and returns up to 50 matches, each with the owner name and khata number. For example, `q=an` returned 20 rows. The rate limit is 300 reads per minute per client, held in memory per instance (`backend/app/security.py`).

Whether owner names should be public is a policy question. Some states publish RoR extracts. Bulk harvesting, however, should be deliberately allowed or deliberately prevented.

**Target:** a minimum query length of about 4 characters for owner-name matches, or owner-name search for signed-in users only, and a lower anonymous rate limit on `/parcels/search`.

### C8. Postgres defaults and exposed port in compose

**Status: Partially mitigated. Acceptable for local development only.**

`docker-compose.yml:5-9` falls back to `POSTGRES_PASSWORD=landsetu_pass` and publishes `5432:5432` on all host interfaces. The hosted deployment uses a Render-managed database, so this does not affect it.

**Target:** use `${POSTGRES_PASSWORD:?}` and bind to `127.0.0.1:5432:5432`, or drop the port mapping.

### C9. `frontend/node_modules` is still tracked in git

**Status: Open. This is repository hygiene.**

`git ls-files frontend/node_modules | wc -l` returns **5,918** files. They were added in `a3dc9ec`, and `.gitignore` lists `frontend/node_modules/`, but ignoring does not untrack files already committed. `*.db` and `__pycache__` are not tracked.

**Target:** `git rm -r --cached frontend/node_modules`, in a commit of its own.

---

### C10. Refused Firestore writes failed silently in the frontend

**Status: Fixed in `f25fe4d` and `9212ba2`, and deployed to Firebase Hosting on 2026-09-26.**

Before the fix, every browser write to Firestore caught its error and only logged it. Once the rules started refusing writes, a user's action could appear to succeed and do nothing.

- **The helpers now throw.** The write helpers in `frontend/src/firebaseFirestore.js` throw a plain-language error: permission refused, no such document, or store unreachable.
- **`writeSharedCopy()` in `api.js` decides what the user sees:**
  - If the records service already accepted the action, a banner stays up until dismissed: "<action>: the shared copy was not updated. <reason>".
  - If the shared copy was the only record of the action, the action fails with an error the UI shows.
- **Covered paths:** filing a deletion, village and auditor deletion approvals, the audit pass, and rejection.
- **Profile sync fix.** The sign-in profile write sent `photoURL: null`, which the rules reject, so every sign-in's profile write had been failing silently. It now omits the field, and any failure raises the banner.
- **No workaround writes.** No client-side write was added to get around the rules.

**Compatibility fix (`9212ba2`).** The API on Render predates `05bc7b3`, and its `POST /parcels/custom` still requires `area_sqm`. The frontend therefore still sends its area estimate, which current API versions ignore. It does not send state, so the server detects state in every API version.

**Hosting redeploy, 2026-09-26.** I built the frontend at `9212ba2` and ran `firebase deploy --only hosting --project landsetu-e4e5e`. The release completed and 17 files were served. The bundle changed from `assets/index-BgCio-3Z.js` to `assets/index-DgYslzle.js`, and the live bundle contains the new banner text.

**Checks:**
- **Local, full path, against the live rules.** Signed out, the app's own `saveBoundaryRequestToFirestore` and `markParcelDeletedInFirestore` threw `The shared record store refused it: your role, or the request's current stage, does not allow this change. [permission-denied]`. The banner rendered with a visible Dismiss button.
- **Live site.** `https://landsetu-e4e5e.web.app/#/map` loaded with no console errors. The deployed banner renders when its event fires.
- **Not checked live.** No officer account was available, so no refused write was triggered through the live UI.

**Not yet live: the records service (API).** The Render service still runs the code from before `05bc7b3`. The server-computed area and state, the approval that invents no records, the `corrected_by_officer` label and the `area_mismatch` rule are all in the repository but not deployed. They go live when the API is redeployed.

## D. Remaining items from the original `audit.md`

| Original finding | Status | Evidence |
|---|---|---|
| Unauthenticated callers can create or overwrite parcels (`POST /parcels/custom`) | **Fixed** | Requires a session (`routes/parcels.py:291`). Citizens are refused. Every write becomes a request in the approval pipeline and never a direct save (`:327-362`). Remaining gap: C6 |
| Parcel PII and passports public | **Fixed / policy** | GeoJSON properties are limited to ULPIN, state, area and flag count (`routes/parcels.py:170-177`). Detail responses are filtered by role (`filter_fields_by_role`, `:47-80`), and lenders see encumbrance only. Passports require the `officer`, `bank`, `auditor` or `state_admin` role (`:257`). Public search: see C7 |
| Passport JWT leaks PII and never expires | **Fixed** | 5-minute `exp`, `iss`, `aud=landsetu-passport` and `jti`. The payload carries only `ulpin`, `state` and `is_verified` (`routes/parcels.py:264-273`). Session validation requires `aud=landsetu-web`, so a passport cannot be used as a session |
| CORS allows any origin with credentials | **Fixed** | An explicit origin list comes from `CORS_ORIGINS`, with a localhost and Firebase Hosting default (`backend/app/main.py:25-35`). There is no wildcard. `render.yaml` pins it to the two Firebase Hosting origins |
| Login form ignores its values | **Fixed** | Sign-in goes through Firebase `signInWithEmailAndPassword`, then `/auth/firebase-login`, where the role comes from the verified custom claim |
| DigiLocker mock claims a real integration | **Partially mitigated** | The modal now says "Sandbox. No real UIDAI call is made." Remaining issues: it uses a DigiLocker-style wordmark, and on completion it submits the email form with empty fields (`LoginPage.jsx:288-290`). Phase 0 finding 8 |
| JWT stored in `localStorage` | **Fixed** | The session is an HttpOnly cookie (`auth.py:46-50`). The Bearer copy is kept in memory only (`api.js:77-89`). No token is written to `localStorage`. Only the display role is stored there (B5) |
| Missing or invalid auth silently becomes citizen | **Fixed** | Public reads treat *no* session as a citizen. A present but invalid session returns 401 (`auth.py:88-92`). Protected routes return 401 or 403 |
| No geometry, size or coordinate validation | **Fixed** | Polygon type, validity, at most 1,000 vertices and an India bounding range are checked (`routes/parcels.py:302-318`). The body is capped at 1 MB (`security.py:13`). Field limits are set on the request model (`:283-288`) |
| Auto-detected state is discarded on insert | **Fixed, but see B3** | `target_state` is now stored (`routes/parcels.py:344`), but the client-supplied state still takes precedence over detection |
| Map `moveend` not debounced | **Fixed** | 400 ms debounce (`MapView.jsx:286-294`). There is no in-flight cancellation, which is minor |
| Vite dev server in the frontend Docker image | **Fixed** | Multi-stage build with `npm ci` and `vite build`, served by `nginx:1.27-alpine` (`frontend/Dockerfile`) |
| Non-deterministic dependency builds | **Partially mitigated** | Python dependencies are pinned with `==` except `numpy>=1.26,<2.3` and `joblib>=1.4` (`backend/requirements.txt`). The frontend uses caret ranges, but `npm ci` installs exactly what `package-lock.json` records |
| Generated artifacts tracked | **Partially mitigated** | `*.db` and `__pycache__` are untracked and ignored. `frontend/node_modules` is still tracked (C9) |
| Rate limiting | **Partially mitigated** | Per-client limits for auth, write and read requests exist (`backend/app/security.py`). They are held in memory per instance, so they do not hold across replicas (main document, section 8 item 11) |

---

## Closed since the original audit

- Client-chosen role at login: `/auth/mock-login` returns 404 unless the flag is on, and always in production; roles come from verified custom claims (B1).
- Hardcoded JWT secret in code and compose (A2). The old value remains in git history and needs a live check.
- Firestore open to any caller: default deny, role-gated rules, unauthenticated reads confirmed denied live (A1). See C4 for what the rules still allow.
- Unauthenticated parcel writes (D).
- Wildcard CORS with credentials (D).
- Passport PII and non-expiring passport tokens (D).
- JWT in `localStorage` (D).
- Python O(n²) overlap on the production path (A3).
- Silent SQLite fallback (A4, opt-in only).
- Flat-degree area maths (B2). The formula was never the cause of the live symptom.
- Missing geometry and size validation (D).
- Officers writing live parcel state through Firestore (C4, `247446d`), deployed 2026-09-26.
- Officers appending deed blocks through Firestore, and the browser-assembled ledger (C4, `02ecf1b`), deployed 2026-09-26.
- Officer corrections inheriting a `verified` label (C5, `ce99672`).
- Refused Firestore writes failing silently (C10, `f25fe4d`), deployed to Hosting 2026-09-26.
- Approval inventing "verified" departmental records (C5, `94360b0`).
- Client-supplied area and state stored as authoritative (B2 part 3 and B3 persisted state, `05bc7b3`).
- No check between recorded extent and boundary area (B2 part 2, `62c3c3e`).
- Vite dev server in the container (D).
- Map `moveend` not debounced (D).

## Still open, ranked by actual risk

This ranking judges impact on a land registry, not how serious each item sounded in the original audit.

1. **The map shows the wrong set of parcels (C1).** This is the most serious open item even though no original audit raised it. It silently shows an incomplete map with no warning, and officers act on what the map shows. Every other safeguard (overlap flags, approvals) is only as good as the parcels actually drawn.
2. **The old JWT secret is in public git history (A2).** High if any live environment ever used it, none otherwise. Resolved by one dashboard check or a rotation.
3. **The live API predates every backend fix in this document (C10).** Server-computed area and state, the approval that invents no records, correction labels and the area rule go live only when Render redeploys from the repository.
4. **The seed geometry is out of scale (B2 part 1).** Every seeded parcel now carries an `area_mismatch` flag, so the demo map shows all parcels as flagged until `mock_data/*_geometries.geojson` is regenerated. The list is from `scripts/validate_seed_geometry.py`.
5. **No refused write has been checked through the live UI with an officer account (C10).** Local and live checks cover the code path and the banner.
6. **The frontend state detection is bounding-box based (B3 remainder).** It now only decides which state the map shows. Official boundary data is still needed.
7. **Anonymous owner-name enumeration (C7).** Needs a policy decision.
8. **Production refusal for the SQLite fallback is not implemented (A4).** Configuration currently prevents it. Only a mistaken flag would re-open it.
9. **`bank` and `officer` downgraded to the citizen UI (C3).** A functional gap; it fails closed.
10. **`bank` can file boundary requests (C6).** Mitigated by the approval chain.
11. **Bulk flag recompute runs inside GET handlers, and `layers` is `JSON` (A3 remainder, C2).** A performance issue that becomes a correctness issue (timeouts) at pilot data volumes.
12. **UX and feature gaps: no notifications, no demo/live badge, mobile layout, scattered role state (B4, B5).** No security impact. The missing badge does weaken honesty about synthetic data.
13. **Hygiene: tracked `node_modules`, compose Postgres defaults, two unpinned Python dependencies (C9, C8, D).**

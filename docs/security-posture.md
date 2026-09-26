# LandSetu security and correctness posture

**Re-verified:** 26 September 2026, against `main` at `acdc640`.
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

**Status: Fixed in source. The unauthenticated-read denial is confirmed live. The full deployed ruleset still needs a live check.**

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

**Status: The area formula is fixed. The live symptom is a different bug, a data-integrity one, and it is Open.**

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

**Status: Partially mitigated. The backend uses point-in-polygon. The frontend is still bounding-box first, and its answer is the one that gets saved.**

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

**Status: Open. This is new; it was hidden behind the "rules are open" finding that has since been fixed.**

The rules check roles, but they do not enforce the workflow the backend enforces:

- **`custom_parcels`.** Any governance officer, including a `village_officer`, may create or update any parcel directly (`firestore.rules`, `match /custom_parcels`). The map merges these documents into every signed-in user's view (`api.js:196-216` `getApprovedCustomParcels`, used by `MapView.jsx:552`). A single officer can therefore publish a boundary without the village, auditor and state-admin approvals the backend requires (`routes/parcels.py:327-331`: "Nobody, whatever their role, saves a boundary directly").
- **`deleted_parcels`.** An auditor or state admin may create an entry directly, and the map then hides that parcel for everyone. The backend's two-stage deletion is bypassed.
- **`boundary_requests` updates.**
  - A request can move straight to `APPROVED` from any status, provided the writer is a state admin. The rules do not check that the previous status was the preceding stage.
  - Any governance officer may rewrite `ulpin`, `requestedBy` or `approverRole` as long as the status stays the same.
  - Nothing stops a writer approving their own request, which the backend forbids.
- **`deed_blockchain`.** Any officer can append a block with arbitrary `prevHash` and `currentHash`, so the "tamper-evident" chain in Firestore can be forged.

**Targets:**
- Preferred: make Firestore read-only for these collections. Set `allow write: if false`, and have the backend (Admin SDK) be the only writer, matching the main document's statement that PostgreSQL is authoritative.
- Otherwise: add previous-status checks (`resource.data.status`), immutability of identity fields, and a requester-not-approver check. Stop the map merging `custom_parcels` into the authoritative view.

### C5. Approving a new parcel invents "verified" departmental records

**Status: Open. This is a data-integrity problem.**

`backend/app/routes/parcels.py:597-604`. When a boundary request for a *new* ULPIN is approved, the handler writes placeholder layers and marks them `"confidence": "verified"`:

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
- Vite dev server in the container (D).
- Map `moveend` not debounced (D).

## Still open, ranked by actual risk

This ranking judges impact on a land registry, not how serious each item sounded in the original audit.

1. **The map shows the wrong set of parcels (C1).** This is the most serious open item even though no original audit raised it. It silently shows an incomplete map with no warning, and officers act on what the map shows. Every other safeguard (overlap flags, approvals) is only as good as the parcels actually drawn.
2. **Officers can bypass the approval workflow through Firestore (C4).** A single village officer can publish a boundary that every signed-in user sees. An auditor can hide a parcel. Both skip the multi-stage approvals the backend enforces.
3. **Approvals write unverified or client-supplied data as authoritative (C5, B2 part 3, B3 state write).** New parcels get invented "verified" departmental layers. Area and state are taken from the browser and never recomputed on the server. A bounding-box misdetection can move a parcel into the wrong state.
4. **Recorded area and surveyed area disagree by up to 157× with no flag (B2 parts 1 and 2).** The seed data is synthetic, so the parcels themselves do not matter. The missing rule does: it is the check that would catch this in real data.
5. **The old JWT secret is in public git history (A2).** High if any live environment ever used it, none otherwise. Resolved by one dashboard check or a rotation.
6. **The frontend state detection is bounding-box based (B3).** Mostly covered by item 3 once the server derives the state. Also needs official boundary data.
7. **Anonymous owner-name enumeration (C7).** Needs a policy decision.
8. **Production refusal for the SQLite fallback is not implemented (A4).** Configuration currently prevents it. Only a mistaken flag would re-open it.
9. **`bank` and `officer` downgraded to the citizen UI (C3).** A functional gap; it fails closed.
10. **`bank` can file boundary requests (C6).** Mitigated by the approval chain.
11. **Bulk flag recompute runs inside GET handlers, and `layers` is `JSON` (A3 remainder, C2).** A performance issue that becomes a correctness issue (timeouts) at pilot data volumes.
12. **UX and feature gaps: no notifications, no demo/live badge, mobile layout, scattered role state (B4, B5).** No security impact. The missing badge does weaken honesty about synthetic data.
13. **Hygiene: tracked `node_modules`, compose Postgres defaults, two unpinned Python dependencies (C9, C8, D).**

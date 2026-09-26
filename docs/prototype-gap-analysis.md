# LandSetu prototype: gap analysis

**As of:** 26 September 2026, after the live verification recorded in `docs/security-posture.md` through C12 (`fc7f7ad`).
**Scope:** this consolidates findings already recorded in `docs/security-posture.md`, `docs/std/deployment-scalability.md`, `docs/ui-baseline/` and `docs/ui-baseline-roles/`. No new investigation was done for it, and nothing was fixed.

## Headline

Two trust failures were live on the public site, and both are now fixed and verified live.

- **For about 15 days, the interface labelled unconfirmed values as "Verified"** (posture C5b). From the first commit (`83a0c94`, 2026-09-11) until the fixed build reached Hosting on 2026-09-26, a record field with no confidence value, or an unrecognised one, was shown with the green Verified badge. A land registry that says "verified" about something nothing verified is failing at its central claim. Fixed in `94360b0`. On the live site, a missing field, `""`, `null` and unknown strings all render "Not confirmed".
- **For about 14 days, four real Tamil Nadu parcels were hidden from every signed-in user** (posture C12). They were `TN-CHN-0042-1188`, `1190`, `1191` and `1192`, hidden by deletion markers that browsers had written to Firestore before the rules were locked. Over the same period, 13 browser-written copies replaced the records service's own parcels on the map, and four parcels that do not exist were drawn as "Approved". The window runs from 2026-09-12 05:22 UTC until `b37b649` was deployed on 2026-09-26. Nothing told the user anything was wrong. The map now draws only the records service's parcels. The 22 stale documents were exported, then deleted on 2026-09-26 between 09:53 and 09:55 UTC. The live map shows 38 Tamil Nadu and 8 Chandigarh parcels, exactly the API's counts.

Both were real exposure. Both were found by re-checking the code and the live data rather than trusting earlier audits, fixed at the source, and confirmed on the live site.

---

## 1. Blockers: would visibly break or embarrass a demo now

### 1.1 Seed geometry is out of scale (46 of 46 parcels)

- **Status: open, not started** (posture B2 part 1).
  - `scripts/validate_seed_geometry.py` (`62c3c3e`) lists every seeded parcel outside the 10% tolerance: 17 Chennai and Chandigarh parcels at 74× to 157×, 25 Kanchipuram fixtures at 10×, two at 6×, and two at 0.8×.
  - The `area_mismatch` rule (`62c3c3e`) flags all 46.
- **How it shows up:**
  - **Local and fresh stacks** (local dev, emulator mode, CI): every parcel is drawn as flagged, with a 100× area discrepancy in its record.
  - **Live site:** it doesn't show there yet. Migration `0007`, which clears cached flags, has not been applied to the Render database (posture C11), so live parcels still carry flags computed before the rule existed.
  - **The trap:** applying `0007` without fixing the geometry would flag every live parcel. The two must ship together.
  - **The live database won't update itself:** it was seeded once and is never re-seeded, so corrected geometry reaches it only through a deliberate re-seed or an update migration.
- **What finishing requires:**
  - Regenerate the polygons in `backend/mock_data/tamilnadu_geometries.geojson`, `backend/mock_data/chandigarh_geometries.geojson` and the planted fixtures in `backend/app/intelligence/seed_history.py`, each to its recorded extent, as a plausible plot shape for its setting. A 452 m² Chennai urban plot is about 21 × 21 m; a Kanchipuram village plot of 300 m² is a narrow strip.
  - Keep the planted overlap and zone relationships that the rule and intelligence tests depend on.
  - Re-run the validator to zero mismatches.
  - Then, together: a data migration that rewrites live geometries and clears flags, and `0007` on Render.
- **Effort: about half a day.** Roughly 2 to 3 hours for the geometry and passing tests, plus 1 to 2 hours for the live migration and its check.

### 1.2 Mobile `/map` is broken at phone width

- **Status: open.** Found in Phase 0 (`982ea47`) and confirmed for all seven roles in the signed-in crawl (`505b6cc`). It is the first item of the surface pass, which is starting now.
  - At 375 px the page is 465 px wide, so it scrolls sideways.
  - The parcel panel covers the whole map, with no minimise or sheet behaviour.
  - `/map` has no `h1`.
- **What finishing requires:**
  - The masthead and map toolbar must wrap within the viewport.
  - A bottom sheet with a visible handle and a collapsed state.
  - An `h1` for the map route.
- **Effort:** 1 to 2 hours for the overflow and `h1`; about half a day for the bottom sheet.

### 1.3 `officer` and `bank` sign in as "Citizen"

- **Status: open; needs your approval** (posture C3, confirmed live in the role crawl `505b6cc`).
  - `KNOWN_ROLES` in `frontend/src/api.js:111` omits both roles, so the interface downgrades them.
  - A bank user cannot reach lender views.
  - It fails closed, so there is no security exposure.
- **What finishing requires:**
  - Add `bank` to `KNOWN_ROLES`.
  - Decide whether the legacy `officer` role maps to `village_officer` or is dropped.
  - Add a role-crawl check.
- **Effort:** under an hour once approved. The approval has not been requested as a separate change yet.

### 1.4 The map shows only the first 500 parcels of a state

- **Status: open, not started** (posture C1). `getParcelsGeoJSON` requests only the first page of an offset-paginated endpoint.
- **Demo risk: none today.** The largest pilot state has 38 parcels.
- **Correctness risk: severe past 500 parcels.** The map would silently draw an arbitrary subset, and officers act on what it shows.
- **What finishing requires:** a `bbox` parameter filtered through the GiST index, and fetch-on-`moveend` in `MapView.jsx`. Vector tiles come later (`docs/std/deployment-scalability.md` section 4.3).
- **Effort:** half a day to a day, with tests.

### Removed from this list since the last pass

- **Stale browser-written Firestore data:** done. Exported, deleted and re-checked live (posture C12, `fc7f7ad`).

---

## 2. Missing features compared with the original brief

| Feature | Status | Evidence |
|---|---|---|
| Transaction / mutation tracking | **Exists** | Parcel panel History tab (`ParcelTimeline.jsx`, `GET /parcels/{ulpin}/history`); `registration_transactions` and `encumbrance_events` tables (posture B4) |
| Service requests (submit and track) | **Exists** | `CitizenServiceTrackerModal.jsx`, reached from "Report an issue" and `/grievance`; `POST /parcels/{ulpin}/correction-request`; the officer approval queue |
| Audit log UI | **Exists, with one dead entry point** | `/officer/audit`, `StateLogModal.jsx`, and the per-parcel audit log with server-rechecked hashes (`GET /parcels/{ulpin}/audit-chain`). `AuditLogModal.jsx` has no path to open it (surface pass). |
| Real boundary polygons | **Does not exist** | Parcel geometries are synthetic and out of scale (1.1). State outlines are hand-drawn polygons of 12 to 18 vertices (posture B3). |
| AI/ML integration | **Partial** | A statistical-signals layer and a dispute-risk classifier exist (`backend/app/intelligence/`), but the risk score is deliberately withheld from every screen (Standard Technical Document section 5C). The satellite change-detection modal generates its figures with `Math.random()` and cannot be opened. There is no AI/ML output a user can see. |
| Notifications | **Does not exist** | No model, route, delivery channel or UI. The `notified` field returned when a concern is raised lists role names only; nothing is sent (posture B4). |

---

## 3. Data-model gaps

### 3.1 `parcels.layers` is `JSON`, not `JSONB` (posture C2)

- **Effect:** owner-name and khata search run `ilike` over `layers['ror']` with no index possible, so every public search is a full table scan.
- **Demo risk:** none at 46 parcels.
- **At pilot scale:** it blocks attribute search.
- **What finishing requires:** an Alembic migration to `JSONB`, plus `pg_trgm` GIN indexes on the owner and khata expressions.
- **Effort:** 2 to 3 hours, including a PostGIS-backed test.

### 3.2 Frontend state detection is still bounding-box based (posture B3)

- **What was fixed:** since `05bc7b3` the server derives state from the polygon and ignores the browser's value, so a wrong guess can no longer be written to a parcel.
- **What remains:** `identifyStateByCoords` (`frontend/src/api.js`) still takes the first matching bounding box. On a pan it can pick the wrong state (Bengaluru reads as Tamil Nadu), which changes which state's parcels the map loads.
- **What finishing requires:** call the backend's point-in-polygon first and keep bounding boxes as the offline fallback. Official state boundaries are a separate data task.
- **Effort:** about an hour.

---

## 4. UI/UX: in progress

The surface-by-surface pass starts now. This section will be updated when it lands.

**Covered by `433f472` (tokens and badge system):**
- design tokens, with reserved provenance and flag colours and colour-blindness checks;
- the Noto type stack for Latin, Devanagari and Tamil;
- motion tokens with a reduced-motion override;
- one provenance badge system covering all seven states, plus a legend;
- unknown values render as "Not confirmed";
- the parcel record uses the full badges.

**Still needed from the surface pass:**
- Masthead with an always-visible "Prototype, synthetic records" label, including on the map.
- Map legend, scale bar, coordinate readout and layer control.
- Mobile bottom sheet, and the `/map` overflow and `h1` fixes (1.2).
- Separate designs for the empty ("no records for this state"), not-found and permission-denied states. Permission-denied currently looks the same as an error.
- The refused-write banner as a proper component (it works today, but is styled ad hoc).
- A data-quality flag indicator distinct from the provenance badges.
- `h1` on `/login`.
- The DigiLocker flow's empty-field sign-in on completion. The DigiLocker-style wordmark needs a legal and trademark check, which is not ours to decide.
- The two unreachable modals (`AuditLogModal`, satellite change-detection): wire them in or remove them.
- **Silent 403s:** pages call APIs the role cannot use (`/admin/users`, `/admin/audit`, `/parcels/requests/pending`).
- **Actions offered to roles that cannot use them:** QR passport for citizens, "Reshape boundary" for auditors.

---

## 5. Infrastructure not yet verified end to end

- **Docker Compose has never started on the development machine.** No container runtime is installed; the `docker` symlinks point into an unmounted disk image. Only three paths have run:
  - the local SQLite plus Vite path,
  - the emulator path,
  - the Render and Firebase Hosting deployment.

  Nginx headers, the Compose network and the Postgres container are unverified.
- **No load test has been run.** The capacity figures in `docs/std/deployment-scalability.md` come from formulas, and several inputs are explicit placeholders: 75 requests/s per replica, and 20 million and 0.5 million parcels for Tamil Nadu and Chandigarh.
- **No real department data integration.** Every provenance label other than a seeded `verified` or `stale` is a stand-in: `officer_provided`, `corrected_by_officer`, sample values. The seeded department records are themselves synthetic. This is out of scope for a hackathon prototype, not a bug; but no label in the system today reflects a live department feed.
- **No end-to-end or visual regression suite.** Coverage today:
  - backend unit and integration tests (145);
  - Firestore rules tests (32);
  - a frontend build check;
  - one-off Playwright crawls and live checks.

  The planned Phase 6 suite (`frontend/e2e/`) does not exist yet.

---

## 6. Closed since the last pass

- **Firestore rules** now make parcel state server-only and enforce the approval pipeline stage by stage. They are covered by 32 emulator tests and deployed, with before and after live-ruleset hashes recorded (posture A1, C4a).
- **All three trust-boundary holes are fixed:**
  - approval no longer invents departmental records (`94360b0`);
  - area and state are computed by the server, never taken from the browser (`05bc7b3`);
  - the deed ledger is the server's audit log, and browsers cannot append blocks (`02ecf1b`).
- **Four-field officer entry at approval:** validated and labelled `officer_provided` (`a21e7fb`). The live API schema is confirmed (posture C11). Enforcement is covered by CI tests but was not exercised against the live database.
- **Officer corrections** are labelled `corrected_by_officer`, never `verified` (`ce99672`).
- **Badge-default bug** fixed, with its ~15-day exposure recorded (posture C5b).
- **Stale Firestore data** exported and deleted, with its ~14-day exposure recorded (posture C12).
- **Refused Firestore writes** are shown to the user, never swallowed (`f25fe4d`).
- **The map draws only the records service's parcels.** No invented parcels appear for states without records (`b37b649`).
- **Guards re-verified:**
  - `JWT_SECRET` is required, with no fallback in code or Compose;
  - demo login returns 404 unless enabled, and always in production (checked live);
  - the SQLite fallback is opt-in and off in every deployment configuration (posture A2, A4, B1).
- **Tests:** backend 145 passed, Firestore rules 32 passed.

**Not closed, although easy to assume they are:**
- **A2:** the old JWT secret is still in public git history. Whether any live environment used it still needs one Render dashboard check, or a rotation.
- **A4:** the planned refusal of the SQLite fallback when `ENVIRONMENT=production` has not been implemented. Configuration prevents the fallback today; code does not.
- **C6 and C7:** `bank` can file boundary requests, and anonymous owner-name enumeration through search is possible.
- **C8 and C9:** Compose Postgres defaults, and `frontend/node_modules` is still tracked.

---

## Ranking (sections 1 to 3 together)

Each item is scored on demo risk (how likely it is to appear in a demo, and how broken it looks when it does) against effort.

| Rank | Item | Demo risk | Looks | Effort | Notes |
|---|---|---|---|---|---|
| 1 | Seed geometry (1.1) | Certain on any fresh stack; on live, the moment `0007` is applied | Every parcel flagged; record areas 100× off | About half a day | Must ship together with the live migration |
| 2 | Mobile `/map` (1.2) | High on any phone demo | Sideways scroll; panel swallows the map | 1–2 h (overflow, `h1`); half a day (sheet) | Already first in the surface pass |
| 3 | `officer` / `bank` as Citizen (1.3) | Only if demoing the lender or legacy officer role | Wrong role in the header, lender views unreachable | Under 1 h | Blocked on your approval |
| 4 | Frontend state detection (3.2) | Low: only when panning near a state border | Map loads the wrong state | About 1 h | Cheap, but rarely seen in a demo |
| 5 | 500-parcel cap (1.4) | None at current data sizes | Invisible until a state passes 500 | Half a day to 1 day | Correctness-critical at pilot scale; not a demo blocker |
| 6 | `layers` `JSON` to `JSONB` (3.1) | None | Invisible | 2–3 h | Scale item |

### With one day

**Start with seed geometry, and ship it together with the live data migration.** This matches your expectation. The reasoning:

- It is the only item that makes every parcel look wrong at once.
- It blocks two other steps: applying `0007` on Render (which would otherwise flag everything live) and showing the new area-mismatch flag working as intended on a real discrepancy.

It takes about half the day. The remaining half goes to the mobile `/map` overflow, the `h1` and the bottom sheet, which lead the surface pass anyway, plus the `KNOWN_ROLES` fix if you approve it: under an hour, and it removes the one wrong label a lender demo would show.

The 500-parcel cap matters more for correctness than anything above, but it cannot appear with 38 parcels. It belongs in the first week, not the first day.

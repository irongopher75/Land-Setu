# UI baseline (Phase 0)

Captured 2026-09-26, before any UI changes. This is the reference point for `docs/ui-before-after.md` in Phase 6.

## How this was captured

- **Stack:** `docker compose up` could not run on this machine. The `docker` CLI is not installed: `~/.docker/bin/docker` is a symlink into `/Volumes/Docker/Docker.app/...`, a Docker Desktop disk image that is not mounted. No other container runtime (OrbStack, Colima, Podman) is present.
- **Fallback used:** the local dev path documented in `AGENTS.md`:
  - Backend: `uvicorn app.main:app` with `ALLOW_SQLITE_FALLBACK=true`, `DEMO_LOGIN_ENABLED=false`, a throwaway `JWT_SECRET`, and `DATABASE_URL` pointed at a fresh SQLite file outside the repo. The checked-in-path `backend/landsetu.db` has an old schema (`no such column: parcels.flags`), so seeding against it failed; that file was left untouched.
  - Frontend: `npm run dev` (Vite 5.4.21) on `http://localhost:5173`.
  - The local venv was missing `scikit-learn`, which `backend/requirements.txt` pins. Running `pip install -r backend/requirements.txt` in `venv/` fixed it.
- **Browser:** Playwright 1.x, headless Chromium, light colour scheme. **The app has no dark mode**: no `prefers-color-scheme` or theme attribute anywhere in `frontend/src`. So there are no dark-mode captures.
- **Viewports:** 375×812, 768×812 and 1440×900. All screenshots are full page.
- **Roles:** only the **signed-out / citizen** view was crawled. Roles come only from Firebase sign-in: `resolveRole` in `api.js` uses the server session, then custom claims. The login UI does not call `/auth/mock-login`, and demo login is off. The frontend is not wired to the Firebase Auth emulator. Crawling the officer, auditor, state_admin, bank and super_admin views needs one of these:
  1. test Firebase accounts for each role (credentials supplied by you, used only locally, never committed), or
  2. wiring the frontend to the Firebase Auth emulator in dev. This touches auth code, so it needs your approval first.
- **Raw data:** `crawl-results.json` holds, per capture, the console errors and warnings, failed requests, HTTP status ≥ 400, requests slower than 1.5 s, load time, title and `h1`.

## Routes crawled

There are 24 routes. Routing is hash-based (`#/path`) through `src/router.js`, with a view map in `App.jsx`. Each route was captured at 3 widths.

| Route | h1 | Signed-out result | Screens |
|---|---|---|---|
| `/` | Compare one parcel's land records across five departments. | Landing | `screens/home@{375,768,1440}.png` |
| `/map` | **none** | Map with 39 parcel/zone paths | `screens/map@*.png` |
| `/login` | **none** (card title is not an h1) | Citizen / Land officer tabs | `screens/login@*.png` |
| `/search` | Search parcels | Empty form | `screens/search@*.png` |
| `/search?q=TN-CHN-0042-1187` | Search parcels | One result row | `screens/search_q_TN-CHN-0042-1187@*.png` |
| `/about` `/how-it-works` `/coverage` `/services` `/faq` `/grievance` `/terms` `/privacy` `/accessibility` `/bank` `/developers` | one each | Static content | `screens/<route>@*.png` |
| `/officer` `/officer/queue` `/officer/editor` `/officer/audit` `/officer/import` `/officer/analytics` `/officer/users` | one each | Permission callout: "This page is for land officers. Sign in with an officer account" | `screens/officer*@*.png` |
| `/does-not-exist` | Page not found | 404 page | `screens/does-not-exist@*.png` |

Extra flow captures:

| Flow | Screens |
|---|---|
| Map, then click a parcel, then the detail panel opens | `screens/flow-map-parcel-click@*.png` |
| Search by ULPIN, then "Open on map", then the map opens with the parcel panel | `screens/flow-search-open-parcel@*.png` |
| Search with no match | `screens/flow-search-no-results@*.png` |
| Login, "Land officer" tab | `screens/flow-login-officer-tab@{375,1440}.png` |
| Login, "Continue with DigiLocker" modal | `screens/flow-login-digilocker@{375,1440}.png` |

## Health summary

- **Failed network requests:** 0 across all 81 crawl captures.
- **HTTP ≥ 400:** 0.
- **Console errors:** 0.
- **Console warnings:** only on routes that load the map. Each map load logs 8 warnings: `Firestore fetch deleted parcels notice: Missing or insufficient permissions.` (6×) and `Firestore fetch custom parcels notice: Missing or insufficient permissions.` (2×). A signed-out visitor makes Firestore reads that the rules deny, and it makes them repeatedly: 6 identical calls on one page load.
- **Load time:** every non-map route settles in about 2 s. That time includes Vite dev-mode module loading, so it is not a production figure. `/map` never reaches Playwright's `networkidle` state within 45 s, although parcels do render. Likely cause: a long-lived Firestore listen channel. **Not verified.**
- **Slow requests (>1.5 s):** none recorded.

## Layout findings visible in the captures

These are raw observations. Severity grading happens in Phase 1 (`docs/ui-audit.md`).

1. **Horizontal overflow at 375 px on `/map`.** The page renders 465 px wide. The header row (search, state select, language, sign-in) does not wrap on the map route. No other route overflows.
2. **Mobile parcel panel covers the whole map.** At 375 and 768 px the detail panel replaces the map view. There is no bottom sheet and no way to see the parcel and its detail together.
3. **Map tooltip overlaps the detail panel** at 1440 px. The hover tooltip ("Overlapping parcels... Status: Overlap conflict") is clipped by the panel edge.
4. **Area has no method label.** The panel shows "520 sq m" with no source (record value or geometry calculation). In the same panel, "Overlap Area Sqm 5860.68" is larger than the parcel's own area. That suggests the record `area_sqm` and the geometry-derived area disagree. Logged, not investigated; it touches spatial logic.
5. **Raw state key shown:** "TamilNadu · 520 sq m". The state select shows "Tamil Nadu (Chennai)".
6. **Map and login have no `h1`.**
7. **No demo/live indicator in the shell.** The "Prototype notice" appears only in the footer, and the footer is hidden on `/map`. A transient toast ("Offline demo mode…") appears only when an API call falls back.
8. **DigiLocker modal:** styled with a DigiLocker wordmark block and pre-filled with a sample Aadhaar-format number. The modal does say "Sandbox. No real UIDAI call is made." In code (`LoginPage.jsx:288`), completing it calls the email sign-in handler with the email and password fields empty.
9. **Icons:** `lucide-react` is used throughout (`package.json`).
10. **Fonts:** Fraunces (headings), Public Sans (body), IBM Plex Mono (IDs), plus Noto Sans for 9 Indic scripts. They load in one Google Fonts request.

## Current user flows (as they behave today)

### Citizen / signed-out
1. **Landing (`/`)**: hero, then "Search a parcel" or "Open the parcel map".
2. **Search (`/search`)**: one field for ULPIN, owner name or khata number. The result table has ULPIN, owner, khata, state, "matched on", and an "Open on map" button. Clicking the ULPIN text does nothing; only the button navigates. No match shows the plain line `No parcel matches "…"`.
3. **Map (`/map`)**: Tamil Nadu (Chennai) by default. The header gets a ULPIN/owner/khata search box and a state select. Chips on the map read "Tamil Nadu (Chennai)", "My location", and "Read-only view. Sign in as an officer to edit boundaries." Parcels are drawn as polygons: grey for clear, red dashed for overlap conflict, grey dashed for protected zone. There is no visible legend panel, no scale bar, no coordinate readout, and no layer control.
4. **Parcel detail (side panel, full-width on mobile)**: ULPIN, state, area, then "QR passport", a disabled "Read only" button, "Report an issue with this parcel", and Record/History tabs. Below: a title hash chain card with "Audit hash chain", a flags card (boundary overlap evidence), and Record of Rights (owner, khata) with a "Stale Data" confidence badge.
5. **Report an issue** opens `CitizenServiceTrackerModal`, which is service request submission plus tracking. **Grievance (`/grievance`)** opens the same modal.

### Sign-in (`/login`)
- Two tabs: **Citizen** (DigiLocker, Google, email/password, create account) and **Land officer** (email/password only). The officer tab explains: "Officer accounts are issued by your state land records office. Your role comes from that account."
- After Firebase sign-in, `resolveRole` asks the backend (`/auth/firebase-login`), then falls back to custom claims. The role is stored in `localStorage.landsetu_role`, and the app redirects to `/map`.

### Officer roles (from code; not crawled)
- The header nav gains "Officer console". state_admin and super_admin also get "State activity" (`StateLogModal`).
- The `/officer/*` sub-nav comes from `OfficerFrame.jsx`: Dashboard, Approval queue, Parcel editor, Audit log, Data import (state_admin), Analytics (state_admin), Users and roles (super_admin only).
- On the map, village_officer, officer and state_admin get split/merge (`RestructurePanel`). state_admin gets deletion requests. Boundary reshape is available from the panel.
- super_admin is treated as state_admin everywhere except Users and roles (`App.jsx` `effectiveRole`).

## Role state today (for the Phase 1 "scattered role state" finding)

Role is held in several places:
- `App.jsx` `currentRole` state, seeded from `localStorage`.
- `localStorage.landsetu_role`: written in 5 places (`App.jsx` and `LoginPage.jsx`) and read in 8 places across `src/` (mostly `api.js` approval functions).
- `AuthContext` carries only `isSuper`.
- `api.js` keeps a module-level `roleDiagnostic`.
- `RoleSwitcher.jsx` still exists but offers only "Citizen (read only)". Nothing imports it.

## Existing UI related to the "missing features" list

Several of these partly exist already, so Phase 3 should extend them rather than rebuild.

| Feature | What exists |
|---|---|
| Service requests | `CitizenServiceTrackerModal.jsx` (submit and track), `WorkflowRequestCard.jsx`, officer `QueuePage` |
| Audit log | `/officer/audit` (`AuditPage`), `AuditLogModal.jsx` (its open flag `showAuditLog` is never set to true, so it is unreachable), `StateLogModal.jsx` |
| Transaction / mutation tracking | `ParcelTimeline.jsx` in the History tab, `BlockchainExplorerModal.jsx` |
| Notifications | none |
| Satellite change detection | `SatelliteAiChangeDetectionModal.jsx`: its open flag `showSatelliteAi` is never set to true, so it is unreachable |

## Not captured, and why

- Signed-in role views: no credentials or emulator (see above).
- Dark mode: the app has none.
- Production build over Nginx: Docker is unavailable. These captures come from the Vite dev server.

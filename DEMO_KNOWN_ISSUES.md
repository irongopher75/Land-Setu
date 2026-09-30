# Demo known issues

Found on 2026-09-30 while walking the demo flows on PostGIS with the Firebase emulators. None of these block a flow, except where noted as fixed. Nothing here has been fixed unless it says so.

## Fixed

- **Search had no pagination in the UI.** The backend returns 20 results per page with `X-Total-Count`, and `searchParcelsPage()` existed in `frontend/src/api.js`, but `frontend/src/pages/SearchPage.jsx` called the unpaginated `searchParcels()`. A query with more than 20 matches silently showed only 20. `SearchPage.jsx` now uses `searchParcelsPage`, shows "Showing N of M" and has a **Load more** button. This is uncommitted, on branch `cleanup/firestore-removal`.

## Differences from what the demo brief assumed

- **There is no lender step in the transaction workflow.** The chain in `backend/configs/*.yaml` and `backend/app/transactions.py` is Registration, Revenue (village officer, auditor in Chandigarh, state admin), optional Estate Office, Municipal. The `bank` role appears nowhere in it. A lender can only look up parcels (Lender verification page, parcel panel, passport) and cannot file corrections (`403 Insufficient permissions`).
- **Transactions can be started and advanced from the History tab,** but only one role at a time, so a full Chandigarh transaction needs four sign-ins (officer, village officer, auditor, state admin). The parcel record on the Record tab does not refresh by itself after the last approval; reload the page.
- **Objecting to a transaction is not in the UI** (Revenue "object" and the escalation to the dispute authority). Advance and Reject with remarks are.
- **The `officer` role (Revenue Officer, the Sub-Registrar) cannot approve corrections.** Corrections wait on the village officer, then the auditor, then the state admin. The officer's queue shows the requests with "It is not waiting on your role."
- **Corrections: one pending per parcel.** A second correction on the same parcel returns 409 with a clear message. Use a different parcel for the reject case.

## Cosmetic or noisy

- **`/parcels/{ulpin}/intelligence` returns 403 for the bank role.** It shows as a red error in the browser console each time a lender opens a parcel. The panel still renders. Keep devtools closed when filming as the lender.
- **Correction dialog does not reset on a hash-only navigation.** Changing `#/map?ulpin=...` while the dialog is open leaves it open with the old ULPIN in the field, and it blocks clicks on the page behind it. Close the dialog and reload before filing on another parcel.
- **Search deep link does not update the input.** Navigating from `#/search?q=CHD` to `#/search?q=TN-` in the same page load does not change the search box (`initialQuery` is read only on mount). Typing works.
- **Switching state on the map takes about 5 seconds to settle.** The fly animation runs first. The map can look empty or half-drawn during it and the top-left state pill can still show the old state. Wait before the shot.
- **At 390 px the header clips.** The state dropdown text is cut off ("Tamil Nadu (Chennai" ) and the main nav strip runs past the edge ("Cove..."). The page itself does not scroll sideways (`scrollWidth` 390 = `clientWidth` 390), so the earlier `/map` fix holds.
- **Dev-server page title lags.** The browser tab title can show the previous page ("Approval queue | LandSetu" on the map) after client-side navigation.
- **Seed request #1** ("Fixture filer", TN-KPM-0107-2019, REJECTED) comes from `backend/app/intelligence/seed_history.py`. It is a planted synthetic case, not left over from testing. Request IDs for what you file start at 2.
- **Vite warning at build:** `AnalyticsDashboard.jsx` is both dynamically and statically imported, so the dynamic import does not split a chunk. Harmless.

## Environment notes

- **Docker is not installed** on this machine. `docker-compose up` cannot be used for filming.
- **Port 5432 is taken** by two EDB Postgres installs (`/Library/PostgreSQL/17` and `/18`). The demo uses Homebrew `postgresql@17` (has PostGIS 3.6) on port 5544 with role `landsetu` and database `landsetu_db`. The Homebrew `postgresql@15` launch agent is in an error state and has no PostGIS; ignore it.
- **The stale SQLite file was moved,** not deleted: `backend/landsetu.db` is now `/tmp/landsetu.db.stale-backup` (schema lacked `parcels.flags`). Running `pytest` from `backend/` created a fresh `backend/landsetu.db` (git-ignored). Backend tests: 165 passed.
- **Firestore profile write at sign-in was verified against the emulator only,** with the repo's `firestore.rules`. All five signed-in roles (citizen, officer, village officer, state admin, bank) wrote `users/{uid}` and none showed an error. The auditor signed in through the API only. The production Firestore rules were not exercised.
- **The earlier dev servers were replaced.** A backend on SQLite (`.work/local.db`) and a frontend without emulator mode were already running on ports 8000 and 5173. Both were stopped and restarted with the settings in DEMO_SCRIPT.md.

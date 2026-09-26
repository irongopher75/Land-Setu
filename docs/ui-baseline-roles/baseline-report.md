# Signed-in role baseline (before the redesign)

Captured 2026-09-26 on the UI that shipped before the redesign surfaces. This baseline is the comparison point for the post-redesign crawl.

**Caveat about badges.** The token and badge commit (`433f472`) was being written while this crawl ran, against a hot-reloading dev server. Parcel-record captures from the first roles (citizen, village_officer) show the old badges; later roles show the new provenance badges. Nothing else on screen changed during the crawl.

## How it was captured

- **Stack.** The local dev stack in emulator mode, as described in the README ("Signing in as each role locally"):
  - the Firebase Auth and Firestore emulators, with the repo's `firestore.rules`;
  - the backend with `FIREBASE_AUTH_EMULATOR_HOST`, on a fresh SQLite database;
  - the frontend via `npm run dev:emulator`, on port 5174.
- **Accounts.** One emulator user per role, created by `backend/scripts/seed_emulator_users.py`. Each has the matching custom claim; `citizen` has no claim. The password is random per run and is not stored.
- **Sign-in.** Each role signs in through the real `/login` form: the Land officer tab for officer roles, the Citizen tab otherwise.
- **Widths.** 375×812, 768×812 and 1440×900. Full-page JPEG, quality 70.
- **What was captured per role and width:** `/`, `/map`, `/search?q=TN-CHN-0042-1187`, the seven `/officer/*` routes and `/bank`, plus a map flow that opens a parcel. In total: 7 roles × 3 widths × 12 captures = 252 screenshots in `screens/`, named `<role>__<route>@<width>.jpg`.
- **Recorded per capture:** `h1`, page scroll width, permission callout text, console errors and warnings, HTTP responses ≥ 400, and (for the map flow) the parcel panel's buttons. All of this is in `crawl-results.json`.

## Role resolution

| Role signed in | Header shows |
|---|---|
| citizen | Citizen |
| village_officer | Village Land Officer |
| auditor | Land Auditor |
| state_admin | State Admin Officer |
| **officer** | **Citizen** |
| **bank** | **Citizen** |
| super_admin | Super Administrator |

The `officer` and `bank` rows confirm the `KNOWN_ROLES` gap (`frontend/src/api.js:111`; security-posture C3). Both roles are downgraded to the citizen interface. A bank user therefore cannot reach lender views through the role check.

## Findings

1. **Sideways scroll at 375 px on `/map` for every role.** The page is 465 px wide, both when idle and with a parcel open. No other route overflows.
2. **`/map` has no `h1` for any role.** `/login` was not part of this signed-in crawl; the signed-out baseline records it without an `h1` too.
3. **Silent 403s.**
   - The Users and roles page calls `/admin/users` and `/admin/audit` even for roles that the page itself tells "not allowed": 36 of each, logged as console errors.
   - The map calls `/parcels/requests/pending` for citizen, officer and bank sessions: 12 in total.
   - All of these are refused correctly by the server, but the frontend should not make the calls.
4. **Actions offered that the role cannot use.**
   - **QR passport:** shown to citizen, officer and bank sessions. The API allows passports only for `officer`, `bank`, `auditor` and `state_admin`. The officer and bank rows are affected by finding 2 in the role table: those accounts see the citizen UI.
   - **Reshape boundary:** shown to the auditor. `RESTRUCTURE_ROLES` excludes auditors from split and merge, but not from reshape.
5. **Permission-denied callouts** on `/officer/*` match the officer frame's rules:

   | Role | Denied routes |
   |---|---|
   | citizen, officer, bank | all seven |
   | village_officer, auditor | import, analytics, users |
   | state_admin | users |
   | super_admin | none |

   The denied state is the same red callout as an error. The redesign should give it its own design.
6. **Parcel panel actions by role (1440 px).**

   | Role | Actions |
   |---|---|
   | citizen, officer, bank | QR passport, Read only, Report an issue |
   | village_officer | adds Reshape, Split, Merge |
   | auditor | adds Reshape |
   | state_admin, super_admin | adds Reshape, Request archival, Split, Merge |

## Not captured

- **Modals.** The approval queue, state activity, and the unreachable `AuditLogModal` and satellite change-detection modals. The last two have no UI path to open them.
- **Write flows.** Filing and approving requests change data. They belong in the Phase 6 end-to-end tests, not a screenshot baseline.

# LandSetu demo script

Verified on 2026-09-30 against PostGIS (Postgres 17.x + PostGIS 3.6) with the Firebase Auth and Firestore emulators. All data is synthetic.

## 0. Start the stack (do this before filming)

Docker is not installed on this machine, so `docker-compose up` is not available. Port 5432 is held by two other Postgres installs (EDB 17 and 18) whose passwords are not known, so the demo Postgres runs on **port 5544**.

Run each block in its own terminal, from the repo root.

```bash
# 1. PostGIS database (Homebrew postgresql@17). Skip if `pg_isready -p 5544` already says "accepting connections".
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -o "-p 5544" -l /tmp/pg17-5544.log start

# 2. Firebase emulators (Auth 9099, Firestore 8088). Emulator data is in memory: users vanish when it stops.
firebase emulators:start --only auth,firestore --project landsetu-e4e5e

# 3. One test user per role. Password for every user: DemoPass2026x
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 EMULATOR_SEED_PASSWORD='DemoPass2026x' \
  GOOGLE_CLOUD_PROJECT=landsetu-e4e5e PYTHONPATH=backend ./venv/bin/python backend/scripts/seed_emulator_users.py

# 4. Backend on PostGIS (seeds 46 parcels on first start)
cd backend && FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=landsetu-e4e5e \
  JWT_SECRET=$(openssl rand -hex 32) \
  DATABASE_URL=postgresql://landsetu:landsetu_pass@localhost:5544/landsetu_db \
  CORS_ORIGINS=http://localhost:5173 COOKIE_SECURE=false ENVIRONMENT=development \
  ../venv/bin/uvicorn app.main:app --port 8000

# 5. Frontend wired to the emulators
cd frontend && npm run dev:emulator -- --port 5173 --strictPort
```

Open http://localhost:5173. Do not set `ALLOW_SQLITE_FALLBACK`: with Postgres unreachable it would silently fall back to `backend/landsetu.db`.

### Reset between takes

One command, from the repo root, with Postgres (step 1) and the Auth emulator (step 2) running:

```bash
scripts/demo_reset.sh
```

It stops the backend on port 8000, drops and recreates `landsetu_db` with PostGIS, restarts the backend (startup reseeds the 46 parcels, plants the synthetic fixtures and runs the seed geometry correction under its advisory lock), and recreates the emulator users with password `DemoPass2026x`. Everything filed since the seed is gone: correction requests (so 0201 and 0202 have no pending correction and their owners are back to Harpreet Singh and Gurpreet Kaur), approvals, transactions and audit entries. The audit log is append-only, so the whole database is recreated instead of edited. It refuses any database not named `landsetu*`. The backend it starts logs to `/tmp/backend-8000.log`. Takes about 15 seconds. Reload the browser tab afterwards and sign in again.

Checked on 2026-09-30 against the live `landsetu_db`: 46 parcels, no transactions, no requests except the planted fixture #1 (TN-KPM-0107-2019), 46 audit rows, 0201/0202/0206/0207 back to their seed owners, all six roles sign in and land on `#/map`. The role label in the header can read "Citizen" for up to a second after sign-in; wait for it before the shot.

## Credentials

Password for all: `DemoPass2026x`

| Role | Email | Label shown in the header |
|---|---|---|
| Citizen (requester) | citizen@landsetu.test | Citizen |
| Sub-Registrar / Revenue Officer | officer@landsetu.test | Revenue Officer |
| Patwari / village officer | village-officer@landsetu.test | Village Land Officer |
| Auditor | auditor@landsetu.test | Auditor |
| State admin | state-admin@landsetu.test | State Admin Officer |
| Bank / lender | bank@landsetu.test | Lender |

Sign in at http://localhost:5173/#/login (wait about 2 seconds for the form to appear on a cold load). Sign out: avatar (top right) > Sign out. Every role lands on `#/map`.

## Filming order

### Scene 1: Map, Tamil Nadu and Chandigarh (all roles)

1. Sign in as `citizen@landsetu.test`. You land on the Tamil Nadu map (Chennai). Red dashed outlines are flagged parcels. A banner says the map is read-only for this account.
2. In the header, open the **State** dropdown and choose **Chandigarh (Chandigarh)**. Wait about 5 seconds for the map to fly there. Eight Sector 17 parcels and the protected zone appear.
3. Optional phone view: resize the window to 390 px wide and open `#/map`. There is no sideways page scroll.

### Scene 2: Search with Load more

1. Click **Search** in the top nav.
2. Type `CHD-SEC-0017-0203`. One row, "Matched on ULPIN".
3. Clear the box and type `Kaur`. Owner-name matches appear.
4. Clear the box and type `TN-`. The page says "Showing 20 of 38". Click **Load more**. It then says "Showing 38 of 38".
5. Click **Open on map** on any row to jump to the parcel.

### Scene 3: Citizen files a correction and sees it under "Your requests"

1. Signed in as the citizen, open `#/map?ulpin=CHD-SEC-0017-0201` (or search the ULPIN and click **Open on map**). After a direct URL load, wait for the side panel.
2. Click **Report an issue with this parcel**.
3. Leave **What is wrong** on "Owner name (Record of Rights)". Type `Asha Verma` in **Correct value**, `Demo Citizen` in **Your name**, and `Deed 2025/CHD/0871` in **Supporting document**.
4. Click **Submit correction request**. The dialog shows "Request #2 filed. Waiting for the village land officer to verify your documents." and lists it under **Your requests**.
5. Close the dialog. Open `#/map?ulpin=CHD-SEC-0017-0202` and reload the page (the dialog and its ULPIN field do not reset on a hash change alone; see known issues).
6. File a second correction: **Correct value** `Meera Kaur`, name `Demo Citizen`, document `Mutation order M-77`. This becomes request #3.
7. Only one correction can be pending per parcel. Filing a second one on the same parcel shows: "A correction request for 'CHD-SEC-0017-0201' is already pending (#2, PENDING_VILLAGE_REVIEW)."

### Scene 4: Lender cannot file

1. Sign out. Sign in as `bank@landsetu.test`. The header shows **Lender**.
2. Open `#/map?ulpin=CHD-SEC-0017-0203` and reload. The panel has no **Report an issue** button, no **Reshape boundary**, and says "Viewing only: your role cannot change this parcel's boundary." A passport link is present.
3. API proof for the camera (optional): in a terminal, a lender POST to `/parcels/CHD-SEC-0017-0203/correction-request` returns `403 {"detail":"Insufficient permissions"}`.

### Scene 5: Village officer approves one, rejects one with remarks

The correction pipeline is village officer, then auditor, then state admin. The **Revenue Officer** (`officer@`) cannot act on corrections: its queue shows "It is not waiting on your role."

1. Sign in as `village-officer@landsetu.test`. Go to `#/officer/queue` (or the **Officer console** tab, then **Approval queue**). Two cards: #3 (CHD-SEC-0017-0202) and #2 (CHD-SEC-0017-0201).
2. On card #3 click **Reject**. A remarks box opens. Type `Deed number does not match the mutation register. Attach the certified copy and refile.` and click **Reject with remarks**. Message: "Request #3 rejected. The requester sees your remarks."
3. On card #2 click **Verify and forward to auditor**.
4. Sign out. Sign in as `auditor@landsetu.test`, open `#/officer/queue`, click the pass button on #2.
5. Sign out. Sign in as `state-admin@landsetu.test`, open `#/officer/queue`, approve #2. Parcel CHD-SEC-0017-0201 now shows owner **Asha Verma**.

Steps 4 and 5 were verified through the API (`auditor-pass`, `approve`), not by clicking. Click through them once before filming.

### Scene 6: Requester sees the remark

1. Sign out. Sign in as `citizen@landsetu.test`.
2. Open `#/map?ulpin=CHD-SEC-0017-0202`, reload, click **Report an issue with this parcel**.
3. **Your requests** shows "#3 CHD-SEC-0017-0202: Rejected. Reviewer's remarks: Deed number does not match the mutation register. Attach the certified copy and refile." and "#2 CHD-SEC-0017-0201: Approved and applied".

### Scene 7: Cross-department transaction (Registration, Revenue, Municipal)

Everything is done from the parcel's **History** tab. Use a parcel with a registered deed and no earlier transaction: `CHD-SEC-0017-0206` was tested (deed `DEED-2023-221`); `0203` to `0205` and `0208` are also free. Chandigarh's chain is Registration (Sub-Registrar), Revenue (village officer, auditor, state admin), Municipal (starts on its own). Actions appear only for the role the API expects; everyone else sees "Waiting for <role>. Sign in as that role to continue."

Each role needs its own sign-in (avatar > Sign out, then sign in). For each one, open `#/map?ulpin=CHD-SEC-0017-0206`, wait for the side panel, click the **History** tab.

1. Sign in as `officer@landsetu.test`. Click **Start transaction for deed DEED-2023-221**. The card shows "Waiting for handoff" and Registration COMPLETE (the deed matched the registration record).
2. Click **Hand off to Revenue**. The card shows "Now: Patwari field verification" and "Waiting for Village officer".
3. Sign out. Sign in as `village-officer@landsetu.test`. Open the same parcel > **History**. Click **Advance: approve Patwari field verification**. Now: "Kanungo / Circle Officer review", waiting for Supervisor.
4. Sign out. Sign in as `auditor@landsetu.test`. Same parcel > **History**. Click **Advance: approve Kanungo / Circle Officer review**. Now: "Tehsildar approval", waiting for State officer.
5. Sign out. Sign in as `state-admin@landsetu.test`. Same parcel > **History**. Click **Advance: approve Tehsildar approval**. The card turns **APPROVED**: Registration, Revenue and Municipal (property tax re-keyed automatically) are all COMPLETE, and "Notifications sent" lists the messages. **Record tab: reload the page after the final approval.** The Record tab does not refresh by itself; after a reload it shows the new owner.

Reject variant (shorter, good for a second take): after step 2, sign in as the village officer and click **Reject with remarks**. The **Reject transaction** button stays disabled until the remarks reach 10 characters. Type `Field visit found the plot boundary does not match the deed.` and click **Reject transaction**. The card shows REJECTED with the remarks under the Patwari stage.

Notes:
- Separation of duties is enforced by the API. The person who opened a transaction cannot decide a stage on it, and nobody can act twice in the same department. The API's message is shown in red under the buttons if it refuses.
- **Tamil Nadu** parcels (for example `TN-CHN-0042-1188`) have no auditor stage: officer, village officer, state admin.
- Each parcel takes one transaction per deed. To repeat the scene, use another parcel or reset the database.
- After the transaction completes, the **State activity** dialog (scene 8) lists `transaction_opened`, `department_handoff`, `stage_approved` (or `stage_rejected`), `mutation_applied`, `municipal_tax_rekeyed` and `transaction_completed`.

### Scene 8: State activity (audit log)

1. Sign in as `state-admin@landsetu.test`.
2. In the top nav click **State activity**. The dialog shows "Entries 1 to 50 of 60" (the count grows with what you did), with filters for ULPIN, event, actor and dates, an **Export this page** button and **Newer / Older** paging.
3. The newest rows are the transaction events (`transaction_completed`, `municipal_tax_rekeyed`, `department_handoff`, `mutation_applied`). Scroll or filter by ULPIN `CHD-SEC-0017-0201` to see `submitted` (citizen), `under_review` (village officer, auditor) and `approved` (state admin). Filter by `CHD-SEC-0017-0202` to see `submitted` and `rejected`.
4. Close the dialog.

### Scene 9: Approval queue modal

1. Still as state admin, on `#/map` click **Approval queue** (top-left of the map).
2. With nothing pending it says "No open requests. Every boundary change, split, merge, correction and deletion has been processed."
3. To show a populated queue in this modal, file a fresh correction as the citizen first, then open it as the village officer (cards with **Verify and forward to auditor** and **Reject**).

## Before you press record

- Do one full dry run. Steps that were only verified through the API are marked above.
- The emulator loses its users when it stops. Re-run step 3 after any emulator restart.
- After any database reset, restart the backend so it reseeds.

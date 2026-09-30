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

To get the seed data back (request #2 and #3 gone, parcel 0201 back to Harpreet Singh, transaction #1 gone):

```bash
PGPASSWORD=landsetu_pass /opt/homebrew/opt/postgresql@17/bin/psql -h localhost -p 5544 -U landsetu -d postgres \
  -c "DROP DATABASE landsetu_db" -c "CREATE DATABASE landsetu_db OWNER landsetu"
PGPASSWORD=landsetu_pass /opt/homebrew/opt/postgresql@17/bin/psql -h localhost -p 5544 -U landsetu -d landsetu_db \
  -c "CREATE EXTENSION postgis"
```

Stop the backend first (`DROP DATABASE` fails while it is connected). Then restart the backend (step 4). It reseeds.

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

The browser can only **display** transactions. Opening one and advancing its stages is API-only (no button exists). There is no lender stage in the chain. Do the actions in `http://localhost:8000/docs` (Swagger) or with curl, then show the result in the browser.

Tamil Nadu chain: Sub-Registrar (`officer`) opens and verifies the deed, hands off to Revenue, village officer approves, state admin approves, Municipal re-keys the property tax on its own. (Chandigarh adds an auditor stage.)

1. Get a session for each role. In a terminal, for each of `officer`, `village-officer`, `state-admin`:
   ```bash
   ROLE=officer   # then village-officer, then state-admin
   IDT=$(curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x" \
     -H 'Content-Type: application/json' \
     -d "{\"email\":\"$ROLE@landsetu.test\",\"password\":\"DemoPass2026x\",\"returnSecureToken\":true}" \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
   curl -s -c /tmp/cj-$ROLE -X POST localhost:8000/auth/firebase-login -H 'Content-Type: application/json' -d "{\"id_token\":\"$IDT\"}" >/dev/null
   ```
2. Open the transaction (officer):
   ```bash
   H='Origin: http://localhost:5173'; C='Content-Type: application/json'
   curl -s -b /tmp/cj-officer -H "$H" -H "$C" -X POST localhost:8000/transactions \
     -d '{"ulpin":"TN-CHN-0042-1187","transaction_type":"sale","deed_reference":"REG-2019-88213"}'
   ```
   The Registration stage auto-approves. Status: "Waiting for handoff to Revenue".
3. Hand off to Revenue (officer):
   ```bash
   curl -s -b /tmp/cj-officer -H "$H" -H "$C" -X POST localhost:8000/transactions/1/handoff \
     -d '{"to_department":"REVENUE","reason":"Deed verified, forward to Revenue"}'
   ```
4. Village officer approves:
   ```bash
   curl -s -b /tmp/cj-village-officer -H "$H" -H "$C" -X PATCH localhost:8000/transactions/1/stage -d '{"action":"approve","remarks":"Field verified"}'
   ```
5. State admin approves (this completes the chain; Municipal then re-keys the tax):
   ```bash
   curl -s -b /tmp/cj-state-admin -H "$H" -H "$C" -X PATCH localhost:8000/transactions/1/stage -d '{"action":"approve","remarks":"Approved"}'
   ```
6. In the browser, signed in as any officer role, open `#/map?ulpin=TN-CHN-0042-1187`, reload, and click the **History** tab. The timeline shows the sale as APPROVED, with Registration, Revenue and Municipal each COMPLETE, the handoffs, and "Notifications sent (6)".

If you reset the database, the transaction ID is 1 again. Otherwise use the ID the open call returns. The `Origin` header is required: the API refuses cross-site requests without it.

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

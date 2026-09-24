# LandSetu operations runbook

Covers the hosted setup: Firebase Hosting and Auth (site), Render web service `landsetu-api`, Render Postgres `landsetu-db`.

## Health and monitoring

| Check | URL | Meaning |
|---|---|---|
| Liveness | `https://landsetu-api.onrender.com/health` | The process is up. Does not touch the database. |
| Readiness | `https://landsetu-api.onrender.com/health/ready` | The database answers. Point an uptime monitor here. |

Set up a free external monitor (for example UptimeRobot or Better Stack) on `/health/ready`, checking every 5 minutes, with email alerts. On the free plan the service sleeps after about 15 idle minutes, so a 5 minute check also keeps it awake.

## Backups

The Render free Postgres plan has no automated backups and expires 30 days after creation. Until the database is on a paid plan:

1. In Render, open `landsetu-db`, copy the **External Database URL**.
2. Back up from your own machine:
   `pg_dump --format=custom --no-owner "$EXTERNAL_DATABASE_URL" > landsetu-$(date +%F).dump`
3. Keep the file somewhere that is not the repository. It holds request history and the audit log.
4. Restore into a new database: `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" landsetu-YYYY-MM-DD.dump`

On a paid plan, turn on Render's daily backups and test a restore once. Do not treat a backup as real until it has been restored.

Seed parcels are rebuilt from `backend/mock_data/` when the database is empty, but request history and the audit log are not. The audit log is only as durable as the backups.

## Before the free database expires (30 days)

Move to a paid Postgres instance in the same region, or restore a dump into a new database and change `DATABASE_URL` on the API. The API creates missing tables, adds new columns and installs the audit-log guard at startup.

## Secrets

| Secret | Where | Rotate by |
|---|---|---|
| `JWT_SECRET` | Render env (generated) | Change the value in Render and redeploy. Every session ends and everyone signs in again. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Render env | Firebase console, Project settings, Service accounts: create a new key, paste it into Render, then delete the old key. |
| Firebase web config | Committed on purpose | These identify the project and are public in every page. They are not secrets. |

A key that has ever appeared in a chat, a ticket, an email or a repository is compromised. Delete it and issue a new one.

## Rolling back

- **Site:** Firebase console, Hosting, Release history, roll back to the previous release. Or revert the commit and push. CI redeploys.
- **API:** Render, `landsetu-api`, Events, choose the previous deploy and roll back. Database changes are additive (new columns and tables), so an older API version keeps working against the newer schema.
- **Firestore rules:** `git revert` the rules commit, then `firebase deploy --only firestore:rules`.

## Roles

Set the first super administrator on your own machine with a service-account key:
`python backend/scripts/manage_accounts.py set-role <email> super_admin`
After that, use Officer console, Users and roles. Every change is recorded in `role_audit`.

## Limits of this deployment

- Free web service: sleeps when idle, first request takes 30 to 60 seconds. A paid instance is always on.
- Rate limits are counted in memory on one instance. Several instances need a shared store.
- Hosted in Singapore, outside India. Acceptable for synthetic data only. See the data-residency section of `STANDARD_TECHNICAL_DOCUMENT.md`.

#!/usr/bin/env bash
# Reset the LandSetu demo to a clean seed. Local demo only.
#
#   scripts/demo_reset.sh
#
# What it does:
#   1. Stops the backend on $DEMO_PORT (default 8000).
#   2. Drops and recreates the demo database on the Homebrew Postgres at $DEMO_PGPORT (default 5544), with PostGIS.
#      Every request, approval, transaction and audit entry made since the seed is gone. The audit log is append-only
#      (a database trigger blocks UPDATE and DELETE), so the whole demo database is recreated instead of edited.
#   3. Starts the backend again. Its startup reseeds the parcels, plants the synthetic fixtures and runs the seed
#      geometry correction under its Postgres advisory lock, exactly as on a normal first start.
#   4. Recreates the Firebase Auth emulator users (same password for every role). Needs the emulators running.
#
# It refuses to touch any database whose name does not start with "landsetu", and any Postgres that is not on localhost.
# It never touches firestore.rules, the SQLite files, or any Firebase project outside the emulator.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
DEMO_DB="${DEMO_DB:-landsetu_db}"
DEMO_PGPORT="${DEMO_PGPORT:-5544}"
DEMO_PORT="${DEMO_PORT:-8000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPass2026x}"
PROJECT="landsetu-e4e5e"
export PGPASSWORD="landsetu_pass"

case "$DEMO_DB" in landsetu*) ;; *) echo "Refusing: database '$DEMO_DB' does not start with 'landsetu'." >&2; exit 1 ;; esac

psql_admin() { "$PG_BIN/psql" -h localhost -p "$DEMO_PGPORT" -U landsetu -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

"$PG_BIN/pg_isready" -h localhost -p "$DEMO_PGPORT" -q || {
  echo "Postgres is not accepting connections on localhost:$DEMO_PGPORT. Start it first (see DEMO_SCRIPT.md, section 0)." >&2; exit 1; }

echo "1/4 Stopping the backend on port $DEMO_PORT"
PIDS="$(lsof -tiTCP:"$DEMO_PORT" -sTCP:LISTEN || true)"
[ -n "$PIDS" ] && kill $PIDS && sleep 2

echo "2/4 Recreating database $DEMO_DB"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DEMO_DB' AND pid <> pg_backend_pid()" >/dev/null
psql_admin -c "DROP DATABASE IF EXISTS $DEMO_DB" -c "CREATE DATABASE $DEMO_DB OWNER landsetu"
"$PG_BIN/psql" -h localhost -p "$DEMO_PGPORT" -U landsetu -d "$DEMO_DB" -v ON_ERROR_STOP=1 -qAt -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null

echo "3/4 Starting the backend (it reseeds on startup)"
cd "$ROOT/backend"
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT="$PROJECT" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  DATABASE_URL="postgresql://landsetu:landsetu_pass@localhost:$DEMO_PGPORT/$DEMO_DB" \
  CORS_ORIGINS=http://localhost:5173 COOKIE_SECURE=false ENVIRONMENT=development \
  nohup "$ROOT/venv/bin/uvicorn" app.main:app --port "$DEMO_PORT" > "/tmp/backend-$DEMO_PORT.log" 2>&1 &
for _ in $(seq 1 60); do
  N="$(curl -s "localhost:$DEMO_PORT/parcels/search?q=CHD-SEC&limit=1" -D - -o /dev/null 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="x-total-count"{print $2}' || true)"
  [ -n "${N:-}" ] && [ "$N" -gt 0 ] && break
  sleep 1
done
[ -n "${N:-}" ] && [ "$N" -gt 0 ] || { echo "Backend did not come up seeded. See /tmp/backend-$DEMO_PORT.log" >&2; exit 1; }
echo "    seeded: $N Chandigarh parcels found"

echo "4/4 Recreating emulator users"
if (exec 3<>/dev/tcp/127.0.0.1/9099) 2>/dev/null; then
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 EMULATOR_SEED_PASSWORD="$DEMO_PASSWORD" GOOGLE_CLOUD_PROJECT="$PROJECT" \
    PYTHONPATH="$ROOT/backend" "$ROOT/venv/bin/python" "$ROOT/backend/scripts/seed_emulator_users.py" | tail -8
else
  echo "    Auth emulator is not running on 127.0.0.1:9099. Start it, then run:" >&2
  echo "    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 EMULATOR_SEED_PASSWORD='$DEMO_PASSWORD' GOOGLE_CLOUD_PROJECT=$PROJECT PYTHONPATH=backend ./venv/bin/python backend/scripts/seed_emulator_users.py" >&2
fi

echo "Done. Demo state is clean: no requests, transactions or extra audit entries. Reload the browser tab."

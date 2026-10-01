"""app.db refuses to start without a usable database, and SQLite is never used in production.

There is no automatic SQLite fallback: an unreachable PostgreSQL, or a missing DATABASE_URL,
always fails fast. SQLite is only ever used when DATABASE_URL explicitly names a sqlite:/// URL,
which app.db decides at import time, so each case imports it in a fresh interpreter with its own
environment.
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def import_db(**env):
    clean = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "ENVIRONMENT")}
    clean.update(env)
    return subprocess.run([sys.executable, "-c", "import app.db as d; print('IS_SQLITE', d.IS_SQLITE)"],
                          cwd=BACKEND, env=clean, capture_output=True, text=True, timeout=60)


UNREACHABLE_PG = "postgresql://nobody:nothing@127.0.0.1:1/none"   # port 1: connection refused at once


def test_missing_database_url_fails_fast():
    r = import_db()
    assert r.returncode != 0
    assert "DATABASE_URL is not set" in r.stderr


def test_production_refuses_a_sqlite_database_url(tmp_path):
    r = import_db(ENVIRONMENT="production", DATABASE_URL=f"sqlite:///{tmp_path}/x.db")
    assert r.returncode != 0
    assert "Refusing to start" in r.stderr and "ENVIRONMENT=production" in r.stderr


def test_production_is_case_insensitive_for_the_sqlite_guard(tmp_path):
    r = import_db(ENVIRONMENT=" Production ", DATABASE_URL=f"sqlite:///{tmp_path}/x.db")
    assert r.returncode != 0 and "Refusing to start" in r.stderr


def test_local_development_can_opt_into_sqlite_explicitly(tmp_path):
    r = import_db(ENVIRONMENT="development", DATABASE_URL=f"sqlite:///{tmp_path}/x.db")
    assert r.returncode == 0, r.stderr
    assert "IS_SQLITE True" in r.stdout


def test_an_unreachable_postgres_never_falls_back_to_sqlite():
    r = import_db(DATABASE_URL=UNREACHABLE_PG)
    assert r.returncode != 0
    assert "There is no SQLite fallback" in r.stderr

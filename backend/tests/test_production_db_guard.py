"""app.db refuses SQLite whenever ENVIRONMENT=production, whatever ALLOW_SQLITE_FALLBACK says.

app.db decides at import time, so each case imports it in a fresh interpreter with its own environment.
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def import_db(**env):
    clean = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "ALLOW_SQLITE_FALLBACK", "ENVIRONMENT")}
    clean.update(env)
    return subprocess.run([sys.executable, "-c", "import app.db as d; print('IS_SQLITE', d.IS_SQLITE)"],
                          cwd=BACKEND, env=clean, capture_output=True, text=True, timeout=60)


UNREACHABLE_PG = "postgresql://nobody:nothing@127.0.0.1:1/none"   # port 1: connection refused at once


def test_production_refuses_a_sqlite_database_url(tmp_path):
    r = import_db(ENVIRONMENT="production", DATABASE_URL=f"sqlite:///{tmp_path}/x.db", ALLOW_SQLITE_FALLBACK="true")
    assert r.returncode != 0
    assert "Refusing to start" in r.stderr and "ENVIRONMENT=production" in r.stderr and "ALLOW_SQLITE_FALLBACK" in r.stderr


def test_production_refuses_the_fallback_even_when_the_flag_allows_it():
    r = import_db(ENVIRONMENT="production", DATABASE_URL=UNREACHABLE_PG, ALLOW_SQLITE_FALLBACK="true")
    assert r.returncode != 0
    assert "Refusing to start" in r.stderr and "fallback would be taken" in r.stderr
    assert "ALLOW_SQLITE_FALLBACK (currently 'true')" in r.stderr


def test_production_is_case_insensitive():
    r = import_db(ENVIRONMENT=" Production ", DATABASE_URL=UNREACHABLE_PG, ALLOW_SQLITE_FALLBACK="true")
    assert r.returncode != 0 and "Refusing to start" in r.stderr


def test_local_development_can_still_opt_in(tmp_path):
    r = import_db(ENVIRONMENT="development", DATABASE_URL=f"sqlite:///{tmp_path}/x.db")
    assert r.returncode == 0, r.stderr
    assert "IS_SQLITE True" in r.stdout


def test_without_the_flag_an_unreachable_database_still_fails_outside_production():
    r = import_db(DATABASE_URL=UNREACHABLE_PG)
    assert r.returncode != 0
    assert "Silent fallback to local SQLite is disabled" in r.stderr

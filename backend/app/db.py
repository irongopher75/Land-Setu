import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Refusing to start: DATABASE_URL is not set. Point it at the PostgreSQL/PostGIS database "
        "(or, for local single-node testing, an explicit sqlite:/// URL)."
    )

IS_PRODUCTION = os.getenv("ENVIRONMENT", "").strip().lower() == "production"
IS_SQLITE = False


def _refuse_sqlite_in_production(reason: str) -> None:
    """Production never runs on SQLite: each replica would keep its own file and accept writes the
    others never see (split brain in land records)."""
    if IS_PRODUCTION:
        raise RuntimeError(
            f"Refusing to start: {reason} while ENVIRONMENT=production. SQLite is never used in production. "
            "Set DATABASE_URL to the shared PostgreSQL/PostGIS database, or unset ENVIRONMENT=production for local work."
        )


if "sqlite" in DATABASE_URL:
    # Explicit opt-in only (DATABASE_URL set to sqlite:/// by the caller), for local/test single-node use.
    # There is no automatic fallback: an unreachable PostgreSQL never silently degrades to SQLite, which
    # would risk multi-node split-brain state in land records.
    _refuse_sqlite_in_production("DATABASE_URL points at SQLite")
    IS_SQLITE = True
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 3})
        with engine.connect() as conn:
            pass
    except Exception as e:
        raise RuntimeError(
            f"Database connection error for '{make_url(DATABASE_URL).render_as_string(hide_password=True)}': {type(e).__name__}. "
            "Ensure PostgreSQL is running and reachable. There is no SQLite fallback."
        )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

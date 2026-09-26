import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://landsetu:landsetu_pass@localhost:5432/landsetu_db"
)

ALLOW_SQLITE_FALLBACK = os.getenv("ALLOW_SQLITE_FALLBACK", "false").lower() == "true"
IS_PRODUCTION = os.getenv("ENVIRONMENT", "").strip().lower() == "production"
IS_SQLITE = False


def _refuse_sqlite_in_production(reason: str) -> None:
    """Production never runs on SQLite, whatever ALLOW_SQLITE_FALLBACK says: each replica would keep its own
    file and accept writes the others never see (split brain in land records)."""
    if IS_PRODUCTION:
        raise RuntimeError(
            f"Refusing to start: {reason} while ENVIRONMENT=production. SQLite is never used in production, "
            f"regardless of ALLOW_SQLITE_FALLBACK (currently {os.getenv('ALLOW_SQLITE_FALLBACK', 'unset')!r}). "
            "Set DATABASE_URL to the shared PostgreSQL/PostGIS database, or unset ENVIRONMENT=production for local work."
        )


if "sqlite" in DATABASE_URL:
    _refuse_sqlite_in_production("DATABASE_URL points at SQLite")
    IS_SQLITE = True
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 3})
        with engine.connect() as conn:
            pass
    except Exception as e:
        # Checked before ALLOW_SQLITE_FALLBACK, so a misset flag cannot enable the fallback in production.
        _refuse_sqlite_in_production(f"PostgreSQL is unreachable ({type(e).__name__}) and the SQLite fallback would be taken")
        if ALLOW_SQLITE_FALLBACK:
            print(f"Notice: PostgreSQL unavailable ({type(e).__name__}). Falling back to local SQLite database (sqlite:///./landsetu.db).")
            IS_SQLITE = True
            DATABASE_URL = "sqlite:///./landsetu.db"
            engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
        else:
            raise RuntimeError(
                f"Database connection error for '{make_url(DATABASE_URL).render_as_string(hide_password=True)}': {type(e).__name__}. "
                "Silent fallback to local SQLite is disabled to prevent multi-node split-brain state. "
                "Ensure PostgreSQL is running or set ALLOW_SQLITE_FALLBACK=true for local single-node testing."
            )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

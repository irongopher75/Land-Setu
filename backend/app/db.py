import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://landsetu:landsetu_pass@localhost:5432/landsetu_db"
)

ALLOW_SQLITE_FALLBACK = os.getenv("ALLOW_SQLITE_FALLBACK", "false").lower() == "true"
IS_SQLITE = False

if "sqlite" in DATABASE_URL:
    IS_SQLITE = True
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 3})
        with engine.connect() as conn:
            pass
    except Exception as e:
        if ALLOW_SQLITE_FALLBACK:
            print(f"Notice: PostgreSQL unavailable ({e}). Falling back to local SQLite database (sqlite:///./landsetu.db).")
            IS_SQLITE = True
            DATABASE_URL = "sqlite:///./landsetu.db"
            engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
        else:
            raise RuntimeError(
                f"Database connection error for '{DATABASE_URL}': {e}. "
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

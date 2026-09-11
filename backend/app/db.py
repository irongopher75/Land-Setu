import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://landsetu:landsetu_pass@localhost:5432/landsetu_db"
)

# Test if PostgreSQL is reachable; fallback to SQLite if PostgreSQL is unavailable
IS_SQLITE = False

try:
    if "sqlite" in DATABASE_URL:
        IS_SQLITE = True
        engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
    else:
        # Attempt PostgreSQL connection test with short timeout
        engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 2})
        with engine.connect() as conn:
            pass
except Exception as e:
    print(f"Notice: PostgreSQL unavailable ({e}). Falling back to local SQLite database (sqlite:///./landsetu.db).")
    IS_SQLITE = True
    DATABASE_URL = "sqlite:///./landsetu.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

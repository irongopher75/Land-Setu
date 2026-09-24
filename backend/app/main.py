import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from app.db import engine, Base, IS_SQLITE
from app.routes import auth, adapter, parcels, workflow, admin
from app.seed import seed_database
from app.schema_upgrade import upgrade_schema
from app.security import SecurityMiddleware
from app.audit import install_append_only_guard, backfill_imported
from app.db import SessionLocal

app = FastAPI(
    title="LandSetu — Unified GIS Land Governance API",
    description="Config-driven schema adapter, spatial rule engine, and parcel passport platform",
    version="1.0.0"
)

default_origins = "http://localhost:5173,http://127.0.0.1:5173,https://landsetu-e4e5e.web.app,https://landsetu-e4e5e.firebaseapp.com"
raw_origins = os.getenv("CORS_ORIGINS", default_origins)
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
)

# Added last so it runs first: rate limit and size cap before any handler, headers on every response.
app.add_middleware(SecurityMiddleware)

# Register APIRouters
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(adapter.router)
app.include_router(workflow.router)  # before parcels: /parcels/search must win over /parcels/{ulpin}
app.include_router(parcels.router)

@app.on_event("startup")
def startup_db_event():
    try:
        print("Initializing database tables and PostGIS extension...")
        if not IS_SQLITE:
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        Base.metadata.create_all(bind=engine)
        upgrade_schema(engine)
        seed_database()
        install_append_only_guard(engine)
        with SessionLocal() as db:
            backfill_imported(db)
    except Exception as e:
        print(f"Startup DB Initialization Notice: {e}")

@app.get("/")
def root_status():
    return {
        "status": "online",
        "system": "LandSetu Sovereign GIS Platform",
        "docs": "/docs"
    }

@app.get("/health/ready")
def readiness_check():
    """Answers only when the database does. Use this for uptime monitoring."""
    from fastapi import HTTPException
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database not reachable")
    return {"status": "ready"}

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "landsetu-backend",
        "node_id": os.getenv("NODE_ID", "backend-node-primary")
    }


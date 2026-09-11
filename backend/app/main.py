import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import engine, Base
from app.routes import auth, adapter, parcels
from app.seed import seed_database

app = FastAPI(
    title="LandSetu — Unified GIS Land Governance API",
    description="Config-driven schema adapter, spatial rule engine, and parcel passport platform",
    version="1.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register APIRouters
app.include_router(auth.router)
app.include_router(adapter.router)
app.include_router(parcels.router)

@app.on_event("startup")
def startup_db_event():
    try:
        print("Initializing database tables and PostGIS extension...")
        Base.metadata.create_all(bind=engine)
        seed_database()
    except Exception as e:
        print(f"Startup DB Initialization Notice: {e}")

@app.get("/")
def root_status():
    return {
        "status": "online",
        "system": "LandSetu Sovereign GIS Platform",
        "docs": "/docs"
    }

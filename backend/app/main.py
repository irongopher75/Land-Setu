import os
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.db import engine, Base
from app.routes import auth, adapter, parcels
from app.seed import seed_database

app = FastAPI(
    title="LandSetu — Unified GIS Land Governance API",
    description="Config-driven schema adapter, spatial rule engine, and parcel passport platform",
    version="1.0.0"
)

class StrictCORSMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origin = None
        for k, v in scope.get("headers", []):
            if k.lower() == b"origin":
                origin = v.decode("utf-8")
                break

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                new_headers = []
                for k, v in message.get("headers", []):
                    if k.lower() not in (b"access-control-allow-origin", b"access-control-allow-credentials", b"access-control-allow-methods", b"access-control-allow-headers"):
                        new_headers.append((k, v))
                target_origin = origin.encode("utf-8") if origin else b"https://landsetu-e4e5e.firebaseapp.com"
                new_headers.append((b"access-control-allow-origin", target_origin))
                new_headers.append((b"access-control-allow-credentials", b"true"))
                new_headers.append((b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS, PATCH"))
                new_headers.append((b"access-control-allow-headers", b"Content-Type, Authorization, X-Requested-With, Accept"))
                message["headers"] = new_headers
            await send(message)

        if scope["method"] == "OPTIONS":
            target_origin = origin.encode("utf-8") if origin else b"https://landsetu-e4e5e.firebaseapp.com"
            await send({
                "type": "http.response.start",
                "status": 204,
                "headers": [
                    (b"access-control-allow-origin", target_origin),
                    (b"access-control-allow-credentials", b"true"),
                    (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS, PATCH"),
                    (b"access-control-allow-headers", b"Content-Type, Authorization, X-Requested-With, Accept")
                ]
            })
            await send({"type": "http.response.body", "body": b""})
            return

        await self.app(scope, receive, send_wrapper)

app.add_middleware(StrictCORSMiddleware)

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

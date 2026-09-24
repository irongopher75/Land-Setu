"""HTTP hardening for the API: response headers, request size cap and per-client rate limits.

The rate limiter keeps counts in memory, so each API instance limits on its own. That is enough for one
instance. With several instances, move the counters to a shared store such as Redis.
"""
import os
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

MAX_BODY_BYTES = 1_000_000
WINDOW_SECONDS = 60
DOC_PATHS = ("/docs", "/redoc", "/openapi.json")   # Swagger UI loads scripts from a CDN, so no strict CSP there
PRODUCTION = os.getenv("ENVIRONMENT", "").lower() == "production"

_hits = defaultdict(deque)


def _limit(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _bucket(method: str, path: str):
    """Which limit applies to this request."""
    if path.startswith(("/auth", "/admin")):
        return "auth", _limit("RATE_LIMIT_AUTH", 20)
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        return "write", _limit("RATE_LIMIT_WRITE", 60)
    return "read", _limit("RATE_LIMIT_READ", 300)


def reset_rate_limits() -> None:
    _hits.clear()


def _allow(client: str, bucket: str, limit: int):
    now = time.monotonic()
    q = _hits[(client, bucket)]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    if len(q) >= limit:
        return False, int(WINDOW_SECONDS - (now - q[0])) + 1
    q.append(now)
    if len(_hits) > 50_000:  # keep memory bounded under a flood of distinct clients
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > WINDOW_SECONDS][:10_000]:
            _hits.pop(k, None)
    return True, 0


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if os.getenv("RATE_LIMIT_DISABLED", "false").lower() != "true" and path not in ("/health", "/health/ready") \
                and request.method != "OPTIONS":
            client = request.client.host if request.client else "unknown"
            bucket, limit = _bucket(request.method, path)
            ok, retry = _allow(client, bucket, limit)
            if not ok:
                return JSONResponse({"detail": "Too many requests. Wait a moment and try again."}, status_code=429,
                                    headers={"Retry-After": str(retry)})

        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Request body is too large."}, status_code=413)

        response = await call_next(request)
        h = response.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        h["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        if not path.startswith(DOC_PATHS):
            h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if path.startswith(("/auth", "/admin")):
            h["Cache-Control"] = "no-store"
        if PRODUCTION:
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

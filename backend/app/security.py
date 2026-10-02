"""HTTP hardening for the API: CSRF origin check, response headers, request size cap and per-client rate limits.

The rate limiter keeps counts in memory, so each API instance limits on its own. That is enough for one
instance. With several instances, move the counters to a shared store such as Redis.
"""
import os
import time
from collections import defaultdict, deque

import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

MAX_BODY_BYTES = 1_000_000
WINDOW_SECONDS = 60
DOC_PATHS = ("/docs", "/redoc", "/openapi.json")   # Swagger UI loads scripts from a CDN, so no strict CSP there
PRODUCTION = os.getenv("ENVIRONMENT", "").lower() == "production"
# Duplicated from app.routes.auth rather than imported, so this middleware has no import-order
# dependency on the auth router — it only ever needs to peek at a token's subject, never mint one.
_JWT_SECRET = os.getenv("JWT_SECRET")
_JWT_ALGORITHM = "HS256"

_hits = defaultdict(deque)


def _limit(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _bucket(method: str, path: str, is_authenticated: bool):
    """Which limit applies to this request. /auth and /admin are inherently anonymous-at-the-door
    (nobody has a session yet when calling login) and already get their own deliberately strict,
    directly-configured ceiling — RATE_LIMIT_AUTH controls it exactly, no extra penalty layered on.

    /parcels-style read/write traffic is different: it's IP-keyed only for a caller with no valid
    session, and an IP bucket is also this app's only defence against one anonymous client opening many
    sessions — so an unauthenticated caller there gets a stricter, separately-configured ceiling than
    the generous per-user limit an officer gets once signed in (the NAT-sharing concern this fixes is
    about authenticated officers getting their own bucket, not about loosening the anonymous one)."""
    if path.startswith(("/auth", "/admin")):
        return "auth", _limit("RATE_LIMIT_AUTH", 20)
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        name, default = "write", 60
    else:
        name, default = "read", 300
    if not is_authenticated:
        return f"{name}_anon", _limit(f"RATE_LIMIT_{name.upper()}_ANON", max(default // 4, 5))
    return name, _limit(f"RATE_LIMIT_{name.upper()}", default)


def _client_ip(request) -> str:
    """Render sits behind Cloudflare, which sets CF-Connecting-IP to the real client and overwrites any
    value a client sends. X-Forwarded-For is never used: clients can write it freely, and trusting it
    let one client spread requests over unlimited buckets."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.scope.get("client", ("unknown",))[0] or "unknown"


def _authenticated_subject(request) -> str | None:
    """The `sub` of a validly-signed session token, or None. Signature-verified (not just decoded) —
    an unverified sub would let an unauthenticated caller mint arbitrary distinct keys for themselves
    and dodge the per-IP ceiling entirely, which defeats the point of having one."""
    if not _JWT_SECRET:
        return None
    token = request.cookies.get("landsetu_session")
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
    if not token:
        return None
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM],
                              issuer="landsetu", audience="landsetu-web")
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def client_key(request) -> tuple[str, bool]:
    """(identity, is_authenticated). Who to count a request against: a validly-signed session's `sub`
    when present (so officers sharing an office NAT don't share one IP's bucket), otherwise the client
    IP — and the caller applies a stricter ceiling for the IP-keyed (unauthenticated) case, since an IP
    bucket is also the only defence against one anonymous client opening many sessions."""
    sub = _authenticated_subject(request)
    if sub:
        return f"user:{sub}", True
    return f"ip:{_client_ip(request)}", False


def _allowed_origins():
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,https://landsetu-e4e5e.web.app,https://landsetu-e4e5e.firebaseapp.com")
    return {o.strip().rstrip("/") for o in raw.split(",") if o.strip()}


def csrf_blocked(request) -> bool:
    """A state-changing request authenticated only by the session cookie must come from a known site.

    The session cookie is SameSite=None (the site and the API are on different domains), so a browser would
    attach it to a form posted from any website. Requests carrying a Bearer token are not at risk: a browser
    never adds that header on its own.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return False
    if "landsetu_session" not in request.headers.get("cookie", ""):
        return False
    origin = request.headers.get("origin")
    if not origin:
        ref = request.headers.get("referer", "")
        origin = "/".join(ref.split("/")[:3]) if ref else ""
    return origin.rstrip("/") not in _allowed_origins()


def reset_rate_limits() -> None:
    _hits.clear()


def _allow(client: str, bucket: str, limit: int):
    now = time.monotonic()
    q = _hits[(client, bucket)]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    if len(q) >= limit:
        return False, int(WINDOW_SECONDS - (now - q[0])) + 1, 0
    q.append(now)
    if len(_hits) > 50_000:  # keep memory bounded under a flood of distinct clients
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > WINDOW_SECONDS][:10_000]:
            _hits.pop(k, None)
    return True, 0, max(limit - len(q), 0)


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if csrf_blocked(request):
            return JSONResponse({"detail": "Cross-site request refused."}, status_code=403)
        rate_limit_headers = {}
        if os.getenv("RATE_LIMIT_DISABLED", "false").lower() != "true" and path not in ("/health", "/health/ready") \
                and request.method != "OPTIONS":
            client, is_authenticated = client_key(request)
            bucket, limit = _bucket(request.method, path, is_authenticated)
            ok, retry, remaining = _allow(client, bucket, limit)
            if not ok:
                return JSONResponse({"detail": "Too many requests. Wait a moment and try again."}, status_code=429,
                                    headers={"Retry-After": str(retry), "X-RateLimit-Remaining": "0"})
            rate_limit_headers["X-RateLimit-Remaining"] = str(remaining)

        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Request body is too large."}, status_code=413)

        response = await call_next(request)
        h = response.headers
        for k, v in rate_limit_headers.items():
            h[k] = v
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

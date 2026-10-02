# Access model

This file is a working draft — only the section below is filled in so far (see
docs/rbac-migration-plan.md for overall phase status). The role ladder, scope rules, workflow diagram
and map-visibility-per-role sections are a pending Phase 2/3/7 deliverable, not yet written.

## Rate limits (`backend/app/security.py`)

In-memory, per-API-instance, fixed 60-second sliding window (`WINDOW_SECONDS`). With more than one API
instance, counters would need a shared store (Redis) — noted in the module docstring, not built, since
this deploys as a single free-tier instance today.

**Key**: a request is counted against the `sub` of its signed session token when one verifies correctly
(`user:<sub>`), otherwise the client IP (`ip:<addr>`, from Cloudflare's `CF-Connecting-IP` header, never
the client-writable `X-Forwarded-For`). This means several officers behind one office NAT each get
their own budget once signed in — only a caller with no valid session shares a bucket by IP.

**Buckets and defaults** (`RATE_LIMIT_*` env vars, requests per 60s):

| Path / method | Bucket | Authenticated default | Unauthenticated default | Env var(s) |
|---|---|---|---|---|
| `/auth/*`, `/admin/*` | `auth` | — (always IP-keyed; login has no session yet) | 20 | `RATE_LIMIT_AUTH` |
| Any other `POST`/`PUT`/`PATCH`/`DELETE` | `write` | 60 | 15 | `RATE_LIMIT_WRITE`, `RATE_LIMIT_WRITE_ANON` |
| Any other `GET`/etc. | `read` | 300 | 75 | `RATE_LIMIT_READ`, `RATE_LIMIT_READ_ANON` |

The unauthenticated default is `max(authenticated_default // 4, 5)` unless its own `_ANON` env var is
set. `/auth` and `/admin` have no separate anonymous tier — a login endpoint is definitionally
unauthenticated traffic and already gets its own deliberately strict, directly-configured limit.

`/health` and `/health/ready` are never limited (`BaseHTTPMiddleware` in `app/security.py` short-circuits
on path). `RATE_LIMIT_DISABLED=true` turns the whole limiter off (used in some test fixtures, never in
production env vars).

**Response**: exceeding a bucket returns `429` with `Retry-After` (seconds until the oldest hit in the
window expires) and `X-RateLimit-Remaining: 0`. A successful request under the limit gets
`X-RateLimit-Remaining` set to the budget left in the current window.

**Phase 9 test hook**: `tests/test_security.py` asserts against these exact bucket names and env var
overrides (`RATE_LIMIT_READ`, `RATE_LIMIT_READ_ANON`, etc.) — a future test should keep using the env
var override pattern rather than hardcoding the default numbers, since those defaults are a tuning knob,
not a contract.

**Resolved — firebase-login rate-limit discrepancy (2026-10-02)**: an earlier diagnosis flagged that the
live (`main`/prod) `/auth/firebase-login` behavior didn't match what this document describes. Confirmed
by diffing `main` against `feat/rbac-district-scoping` on `backend/app/security.py`: `main` still has the
pre-`b67ad63` single IP-keyed `_bucket`/`client_key` (no per-user split, no `_ANON` tier). This branch's
`b67ad63` is what introduced the per-user key, the `_ANON` ceilings, and this file. `/auth` and `/admin`
are identical on both sides of that diff — always `RATE_LIMIT_AUTH`, IP-keyed, default 20 — so
`/auth/firebase-login` itself behaves the same on `main` and here. The discrepancy was this document
describing branch-only code that hasn't reached `main` yet, not a runtime bug. No fix needed; it resolves
itself when this branch merges.

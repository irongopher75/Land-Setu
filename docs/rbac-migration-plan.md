# RBAC / district-scoping migration plan

Status: **Phase 0 (research) complete, nothing coded yet.** This doc is the pause point required
before any schema or route changes — see "Scope decision needed" at the end.

## 1. What exists today

### Auth (`backend/app/routes/auth.py`)
- Flat role set, `VALID_ROLES = {citizen, village_officer, auditor, state_admin, officer, bank, super_admin}`.
  No district/state/village scoping on a role — a `village_officer` token works on every parcel in the DB.
- `/auth/mock-login`: 404 unless `DEMO_LOGIN_ENABLED=true` (default `false` in `docker-compose.yml:29` and
  code default). Cannot mint `super_admin`. Already matches the spec's Phase 0 "self-assign" ask.
- `/auth/firebase-login`: role comes only from a server-verified Firebase custom claim
  (`claims.get("role")`), never from client input. No client-supplied role or jurisdiction path exists to
  ignore — there is no jurisdiction concept in the token at all yet.
- Session: 30 min JWT in an httpOnly cookie, `iss`/`aud` checked, role-change invalidation via
  `RoleAudit` (`_changed_since`). No refresh-token table (refresh was deliberately removed — re-login
  re-reads the Firebase claim instead). `JWT_SECRET` has no fallback; `db.py` raises if `DATABASE_URL`
  unset or points at unreachable Postgres, and refuses SQLite in production (`ENVIRONMENT=production`).
- `/docs`/`/redoc` already gated off `ENVIRONMENT=production` (`main.py:19-20`); `/openapi.json` is
  intentionally still public ("stays for integrators") — spec Phase 0 wants it off too; conflicts.

**Phase 0 items from the pasted spec that are already done:** JWT fallback removal, `DEMO_LOGIN_ENABLED`
default-false + pre-seeded-only intent, SQLite fallback removal, `/docs`/`/redoc` gating, Firestore
land-data lockdown (see below). Genuinely open: `/openapi.json` still public in prod; no
`officer_assignments`/jurisdiction tables exist so "ignore client jurisdiction claim" has nothing to ignore yet.

### Firestore
`firestore.rules` already denies all client writes on `custom_parcels`, `boundary_requests` (role-gated
create only), `deleted_parcels`, `deed_blockchain`, `protected_zones`. `frontend/src/firebaseFirestore.js`
now writes only the `users` profile doc. The untracked `scripts/cleanup_legacy_firestore.cjs` (uncommitted
in this working tree) is a one-off export-then-delete of the five legacy collections — not yet run per
its own comments. `SKILLS.md`'s "Open as of 2026-09-23" list (Firestore bypass, `DEMO_LOGIN_ENABLED=true`
in compose) is **stale** — both are already fixed in code; the skill file itself needs updating, separate
from this plan.

### Data model (`backend/app/models.py`)
- `Parcel.state` (string) and `Parcel.district` (string, nullable) exist. No `admin_units` table, no
  `ltree` path, no polygon boundaries below state level. `StateBoundary` holds real state/UT MultiPolygons
  seeded from geoBoundaries IND ADM1 (pilot states + neighbours only, per recent commits
  `8eddef0`/`0a517f6`/`b6b7569` on this branch's parent `fix/spatial-correctness`).
- `backend/app/states.py` is the **legacy fallback only** (bbox + Shapely point-in-polygon), explicitly
  superseded by `ST_Covers`/`ST_Intersects` against `state_boundaries` for the real path — the spec's
  "delete the bbox code" ask is already ~90% done; the file is kept as a documented non-PostGIS fallback,
  not deleted.
- No `admin_units`, `officer_assignments`, `citizens`, `parcel_owners`, `citizen_merge_candidates` tables.
  No LGD codes anywhere. No district/tehsil/village polygons below state level.
- Existing heavyweight machinery the spec doesn't mention but any migration must not break:
  `ParcelAuditLog` (SHA-256 hash-chained, append-only, trigger-enforced), `LandTransaction` /
  `MutationStage` / `DepartmentHandoff` / `DisputeCase` (a working multi-department mutation workflow —
  this is effectively the spec's Phase 3, already built, just not jurisdiction-scoped), `RequestFlag`
  (maker-checker-style flag-before-approve on `BoundaryChangeRequest`), `ParcelIntelligence` (fraud/risk
  scoring cache).

### Authorization enforcement
- No `authz.py`. Role checks are inline `Depends(require_roles(...))` per route
  (`backend/app/routes/parcels.py:296,443`, similar in `workflow.py`, `transactions.py`, `admin.py`).
  `require_roles` has no scope/jurisdiction argument — it checks role membership only.
- **Confirmed gap**: nothing filters parcel reads/writes by district or state today. A `village_officer`
  or `auditor` token is valid against every parcel row regardless of which state/district it belongs to.
  This is the core problem the pasted spec's Phase 2/3/6 target, and it is real and unaddressed.
- No Postgres RLS. No per-request `SET LOCAL app.user_id`/scope.

### Frontend
No `frontend/public/`. No static GeoJSON/mock-data bundle to strip — the spec's Phase 7 "remove parcel
GeoJSON from the bundle" has no target in this repo; parcels already only arrive via authenticated API
calls per `frontend/src/api.js`. Map scoping (jurisdiction `maxBounds`, citizen single-parcel view,
per-role clipping) does not exist yet — this part of Phase 7/8 is genuinely open.

### Conventions this plan must respect (`AGENTS.md`)
- State adapter pattern (`backend/app/adapter.py` + `backend/configs/*.yaml`) is the only sanctioned way
  to add a state — 13 states already configured (2 deep-tier: Chandigarh, Tamil Nadu; 11 lightweight).
  Any district/admin-hierarchy work should extend this pattern, not bypass it.
- `VALID_ROLES` in `auth.py` is called out as the fixed role set; any new role ladder is a conscious
  break from a documented convention, not an additive change.
- Repo is explicitly scoped to **synthetic/mock data only** — no real government integrations, no real
  individuals' ownership data (`AGENTS.md` "Don't", `docs/important.md`). The spec's placeholder-Aadhaar
  `citizens.citizen_uid` design fits this (clearly labelled placeholder), but LGD codes, real boundary
  polygon sourcing, and "real individuals" framing need to stay inside the synthetic-data line.

## 2. Gap summary against the pasted spec

| Spec phase | State |
|---|---|
| 0 — close bypass holes | Mostly done already (JWT, DEMO_LOGIN, SQLite, Firestore lockdown). Open: `/openapi.json` in prod. |
| 1 — admin_units + real boundaries | Not started. Only state-level boundaries exist (`StateBoundary`). No LGD, no ltree, no district/tehsil/village polygons. |
| 2 — role ladder + assignments | Not started. Current role set is flat, no jurisdiction scoping of any kind. This is the real, confirmed gap. |
| 3 — workflow state machine | **Partially exists** as `LandTransaction`/`MutationStage`/`DepartmentHandoff`/`DisputeCase` + `BoundaryChangeRequest` tracks — not jurisdiction-scoped, not using the spec's exact role ladder or transition table shape. |
| 4 — legacy migration | Not applicable yet — there is no legacy district/jurisdiction data to migrate, because jurisdiction doesn't exist as a concept yet. This phase is really "backfill jurisdiction for existing seeded parcels," not "migrate a legacy production DB." |
| 5 — credential seeding | Partial: `seed.py` seeds mock parcels; no per-district/per-role account seeding exists. |
| 6 — auth/API enforcement, RLS | Not started. No `authz.py`, no RLS, no scoped repository layer. |
| 7 — constrained map | Not started on the frontend. Backend has no viewport-scoped, jurisdiction-filtered parcel endpoint. |
| 8 — frontend shells | Not started (single shell today, role-conditional rendering only). |
| 9 — test matrix | Not started; existing tests cover flags/spatial correctness/auth basics, not jurisdiction. |

## 3. Scope decision needed before Phase 1

The pasted spec is written for a production-grade, real-deployment land-governance system: Alembic
migrations with `pg_dump` backups, Postgres RLS with a non-superuser app role, LGD code imports, argon2id
with lockouts, 24 districts across 11 states seeded with real sub-district hierarchies, a legacy-data
quarantine/reconciliation pipeline. This repo is a hackathon MVP (`CLAUDE.md`, `AGENTS.md`) on synthetic
data, already running a simpler flat-role model that the project's own conventions treat as fixed.

Building the full spec (Phases 1–9 as written) is a multi-week effort and a deliberate break from the
documented role-set convention, not an incremental fix. Before I touch any code, I'd like a decision on
scope:

**Recommendation**: implement the part that closes the real, confirmed security gap — jurisdiction
scoping — without the full production apparatus the spec assumes doesn't exist yet (no real LGD import,
no RLS, no argon2id/lockout rebuild of an already-working auth flow, no 24-district seed). Concretely:
a minimal `admin_units` + `officer_assignments` layer wired into the existing `require_roles` call sites
via a new `authz.py`, scoped to the two deep-tier states (Chandigarh, Tamil Nadu) where mock parcels
actually exist, extending `district` on `Parcel` into a real hierarchy instead of inventing a parallel one.

Options, roughly in order of effort:
1. **Minimal jurisdiction scoping** (above) — closes the actual gap, fits hackathon scope, reuses existing
   workflow/audit machinery. Days, not weeks.
2. **Full spec, deep-tier states only** (Chandigarh + 8 Tamil Nadu districts) — admin_units with ltree,
   officer_assignments, the full role ladder, RLS, map constraints — but skip the 16-state shallow tier,
   LGD import, and legacy-migration tooling (nothing to migrate). Still large.
3. **Full spec as written**, all 24 districts, LGD, Alembic+pg_dump migration pipeline, RLS, 9-phase test
   matrix. Multi-week; also requires sourcing real boundary/LGD files I don't have (`data/lgd/`,
   `data/boundaries/*.geojson` don't exist in this repo).

I have not written any code yet. Tell me which option (or a different scope) to proceed with, then I'll
come back with the Phase 1/2 implementation plan for that scope specifically.

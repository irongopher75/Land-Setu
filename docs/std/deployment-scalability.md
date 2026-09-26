# Deployment and Scalability: Reference Architecture

**Part of:** LandSetu Standard Technical Document (extends section 7, "Deployment and Scalability Considerations")
**Problem statement:** SIH26014, Department of Land Resources, "Land Stack"
**Date:** 26 September 2026
**Status:** Target architecture. Only items tagged **[Implemented]** exist in the repository today. Everything else describes intended design and is tagged **[Planned]** or **[Partial]**, following the convention in the main document.

---

## 1. Purpose and scope

This section sets out how LandSetu would be deployed and scaled from the two pilot states (Chandigarh and Tamil Nadu) to national coverage as a land-governance digital public infrastructure (DPI). It explains:

- which parts of the system carry the load;
- how each part scales;
- what capacity each rollout phase needs;
- where the current prototype falls short of that target.

All capacity figures are engineering estimates, derived from the assumptions in section 2. They are not benchmark results. None of them has been measured on real land records. Each must be confirmed by load testing during the pilot before it is used for procurement.

---

## 2. Planning assumptions

### 2.1 Data scale

The number of parcels, not the number of users, sets the size of the system.

| # | Assumption | Basis |
|---|---|---|
| D1 | About 200 million land parcels nationally | Planning figure given in the brief |
| D2 | Tamil Nadu: 20 million parcel records (planning figure) | About 10% of D1, for a large state with 38 districts and fragmented rural holdings. Replace with the state's actual survey and subdivision count. |
| D3 | Chandigarh: under 0.5 million parcel records (planning figure) | A small urban Union Territory. Replace with the actual property count. |
| D4 | Each parcel is one row: ULPIN, a polygon geometry, and layered attributes from six departments (Record of Rights, registration, zoning, building permit, tax, encumbrance) | Canonical parcel schema, main document section 2.3 |
| D5 | Stored size is about 5 KB per parcel, including indexes. Plan for 10 KB to allow for table bloat, edit history and audit rows. | Estimate: polygon of about 20 vertices (~0.35 KB); departmental attributes as JSONB (~2 KB); original source record (~1 KB); scalar columns and row overhead (~0.3 KB); B-tree and GiST index entries (~0.3 KB); rounded up |
| D6 | Parcel data changes slowly. Reads far outnumber writes. | A parcel's boundary or ownership changes on the order of once in years. Map viewing and lookups happen every working day. |

### 2.2 User scale

| # | Assumption | Pilot (TN + Chandigarh) | National |
|---|---|---|---|
| U1 | State administrators: about 3 per district | 39 districts × 3 ≈ **120** | 766 districts × 3 ≈ **2,300** |
| U2 | Land and revenue officers | Low thousands. Planning figure: **3,000** | Low hundred-thousands. Planning figure: **150,000** |
| U3 | Auditors | Between U1 and U2. Planning figure: **300** | Planning figure: **20,000** |
| | **Named staff users** | **≈ 3,400** | **≈ 172,000** |
| U4 | Public (citizen and lender) lookups | Not sized. See section 3.3. | Not sized. See section 3.3. |

### 2.3 Load model

Staff users work during office hours on transactional tasks: looking up a parcel, reviewing a request, approving a change. They are not a real-time audience. Peak concurrent sessions are estimated as:

> **Concurrent sessions = named users × daily-active share × (active hours per day ÷ 8 working hours)**

| # | Parameter | Low case | High case |
|---|---|---|---|
| L1 | Share of named users active on a given day | 20% | 40% |
| L2 | Active hours per active user | 1.5 h | 3 h |
| L3 | API requests per active session (excluding map tiles) | 1 every 15 s | 1 every 15 s |
| L4 | Peak-hour factor over the working-day average | 1.5 | 1.5 |
| L5 | Throughput per API replica (2 to 4 worker processes, database-bound endpoints) | 75 requests/s | 75 requests/s |

L5 is a conservative planning figure for a FastAPI service whose requests are mostly single indexed database queries. It must be replaced with a measured figure from the pilot load test.

---

## 3. What actually carries the load

### 3.1 Staff users are a small transactional workload

Applying section 2.3:

| | Pilot | National |
|---|---|---|
| Peak concurrent staff sessions | 130 to 510 | 6,500 to 26,000 |
| Peak staff API requests | about 10 to 50 per second | 650 to 2,600 per second |

Even the national high case is thousands to low tens of thousands of sessions, and at most a few thousand requests per second. That is a mid-sized transactional web application. It is not consumer scale.

This changes the architecture in three ways:

1. **The API tier needs no specialised technology.** Stateless replicas behind a load balancer cover the whole range (section 4.2). Cost grows linearly and predictably.
2. **Write volume is low, so a single write primary per data partition is enough.** Approvals and boundary edits number in the thousands per day nationally. There is no need for multi-primary databases or distributed consensus in the write path, which would add risk to the integrity of land records for no benefit.
3. **Engineering effort belongs in the spatial data tier and the map-read path.** These scale with parcel count and map traffic, not with the number of officers.

### 3.2 The spatial tier and the map are the real bottlenecks

Three workloads grow with data volume rather than with staff numbers:

- **Parcel lookup and viewport queries.** Every map pan asks for the parcels inside a bounding box.
- **Overlap and adjacency checks.** An edit to one parcel requires checking its neighbours for overlap and protected-zone conflicts.
- **Bulk boundary computation.** Importing a district, or re-validating a state after a rule change, means checking millions of parcels.

Map tiles outnumber API calls by roughly an order of magnitude. A single map view needs a few dozen tiles, and each pan needs several more. They are, however, the most cacheable requests in the system, because parcel geometry changes rarely (D6).

### 3.3 Public lookups are the uncertain variable

Citizen and lender lookups are read-only. Their volume is not predictable: it depends on public awareness and can spike after a news item or a policy announcement. This document does not size them. Instead, the architecture ensures that public traffic can reach only caches and read replicas, never the write primary (section 4.3). Public demand is the first quantity to measure during the pilot.

---

## 4. Target architecture

```
                         ┌────────────── CDN (static app, parcel vector tiles) ─────────────┐
 Browser (React,         │                                                                  │
 Leaflet, Turf.js) ──────┤                                                                  │
                         └──► Load balancer / Nginx (TLS, rate limits)                      │
                                   │                                                        │
               ┌───────────────────┼───────────────────────┐                                │
               ▼                   ▼                       ▼                                ▼
      FastAPI read replicas   FastAPI write replicas   Tile service (PostGIS ──► MVT) ◄─────┘
      (lookups, map data)     (requests, approvals)          │
               │                   │                         │
               ▼                   ▼                         ▼
      PostGIS read replicas ◄── PostGIS primary (per state partition) ──► standby (HA)
                                   ▲
                                   │ jobs table / queue
                          Spatial workers (bulk overlap, re-validation, imports)
```

### 4.1 Spatial data tier: the load-bearing decision

**Design.**

- **Single source of truth.** PostgreSQL with PostGIS holds the authoritative data. Parcel geometry is stored as `geometry(POLYGON, 4326)` with a GiST index.
- **Spatial predicates run in the database.** Overlap, containment and protected-zone checks are indexed queries (`ST_Intersects` with `NOT ST_Touches`, using the `&&` bounding-box operator on the GiST index). Geodesic area is computed on the `geography` type.
- **Map requests are bounded to the viewport.** They use `ST_MakeEnvelope` against the same GiST index, so they return the parcels on screen rather than a whole state.

**Status.**

- **[Implemented]** The PostGIS path already does most of this. `backend/app/models.py` declares the geometry column with `spatial_index=True`, and Alembic migration `0002_parcel_flags_and_gist.py` creates the GiST index. `RuleEngine._check_boundary_overlap` in `backend/app/rules.py` issues one indexed `ST_Intersects`/`ST_Touches` query per parcel and computes overlap area on `geography`. Computed flags are cached on the parcel row. After an edit, only the neighbours whose bounding boxes intersect the edited parcel are invalidated.
- **[Partial]** The Python and Shapely overlap check is a scan over all parcels in the same state, which is O(n) per parcel and O(n²) across a full recompute. It runs only in the SQLite development mode. Production must never take that path (section 4.2). The remaining PostGIS inefficiency is that a bulk recompute issues one query per parcel. For a district or state re-validation, the target is a single set-based self-join, `ST_Intersects` of `parcels a` with `parcels b` where `a.id < b.id`, partitioned by district and run by the worker tier (section 4.4).
- **[Planned]** `parcels.layers` is currently a `JSON` column, not `JSONB`. Only `flags` is `JSONB`. The target is `JSONB`, with GIN indexes on the attribute paths that are queried. Owner-name search needs a trigram (`pg_trgm`) index.

**Why a single node goes a long way.** Under D5, Tamil Nadu (D2) is about 100 GB, or 200 GB with headroom. Its GiST index is roughly 2 GB, which fits in memory on a modest database server. At national scale (D1) the data is about 1 to 2 TB and the GiST index about 20 GB. That is still within a single well-provisioned PostgreSQL node for storage and index residency. A lookup by ULPIN or bounding box on a memory-resident index is expected to take milliseconds, although this must be confirmed with `EXPLAIN ANALYZE` on pilot data.

The conclusion follows. **Keeping spatial work inside indexed PostGIS queries, and removing per-parcel query loops, is worth more than any amount of horizontal scaling.** Adding API replicas does not help if each request triggers a full-state scan.

**Partitioning, then sharding.** Past a single node, the data divides naturally by state. Land is a state subject: records, adapters and administrative ownership are all state-level. Almost every query already filters on `state`, and the ULPIN carries the state code.

1. **Partitioning [Planned].** Native PostgreSQL list partitioning on `state`. Each state's indexes stay small, maintenance runs one state at a time, and state-scoped queries prune to one partition.
2. **Sharding [Planned].** Place state partitions, or groups of small states, on separate primaries. Routing follows the existing config-driven state adapters (`backend/configs/*.yaml`): each state's configuration names its database. National dashboards read from periodically refreshed summary tables rather than querying every shard live.
3. **Cross-border parcels.** The small number of parcels on state boundaries are checked by a scheduled worker job that reads both neighbouring partitions.

### 4.2 API tier

**Design [Planned].** FastAPI replicas run as stateless containers behind Nginx or a managed load balancer, and scale horizontally. Sessions are signed tokens in HTTP-only cookies, so replicas need neither a shared session store nor sticky sessions. Read endpoints (lookup, map data, passports) and write endpoints (requests, approvals, edits) can be scaled as separate pools, so a burst of public reads cannot slow down officers' approvals.

**Single shared source of truth.** Every replica connects to the same PostgreSQL/PostGIS primary for writes. **SQLite is not permitted in any multi-replica or production deployment.** If two replicas each fell back to their own local SQLite file, they would accept writes that the other never sees: a split brain in land records.

- **[Implemented]** `backend/app/db.py` already refuses to fall back to SQLite unless `ALLOW_SQLITE_FALLBACK=true`. `docker-compose.yml` sets it to `false`.
- **[Planned]** Add a startup check that also refuses the fallback when `ENVIRONMENT=production`, whatever the flag says.

**Other requirements for horizontal scaling.**

- **[Partial]** Schema creation runs as `create_all` at application startup. With many replicas starting at once, that is a race. Alembic migrations must run as a single release step before new replicas start.
- **[Partial]** Rate limits are per Nginx instance. With several load-balancer or API instances, they need a shared store.

**Sizing.** Under L5, the pilot needs one replica for capacity. Two to three are recommended so that one can fail or be replaced during a rolling update. The national range of 650 to 2,600 requests per second (section 3.1) implies about 10 to 35 replicas in total, spread across regions. The exact number follows the measured L5, and the cost is linear.

### 4.3 Map-read path

**Current behaviour.** The map calls `GET /parcels/geojson/all?state=…`. The endpoint pages by row offset, with 500 rows by default and 1,000 at most. The frontend (`frontend/src/api.js`, `getParcelsGeoJSON`) requests only the first page. At pilot data volumes this has two effects: the map would show an arbitrary first 500 parcels of the state rather than the parcels in view, and any flags missing from the cache are computed inside that request.

**Design [Planned].**

1. **Viewport-bounded queries first.** Replace offset paging with a bounding-box parameter, filtered through the GiST index.
2. **Vector tiles.** Serve parcels as Mapbox Vector Tiles (`.mvt`), generated by PostGIS (`ST_AsMVT`) through a tile service such as pg_tileserv or Martin. Leaflet requests only the visible tiles. Parcel status and flag count go into tile attributes so the map can style parcels without a second request.
3. **CDN-fronted tile cache.** Parcel geometry changes rarely (D6), so tiles are cached at the CDN with a version key. Approving a boundary change invalidates only the tiles that cover that parcel. Most map traffic then never reaches the database.
4. **Read replicas.** Tile generation and parcel lookups read from PostGIS streaming replicas. Only the request and approval workflow writes to the primary. Replica lag of a few seconds is acceptable for viewing. Once a change is approved, the officer's own confirmation view reads from the primary, so they see their change immediately.
5. **Public isolation.** Unauthenticated public traffic is served only from the CDN and read replicas, with rate limits applied at the edge (section 3.3).

### 4.4 Asynchronous spatial computation

**Problem.** Some spatial work is too large to run inside an HTTP request:

- importing a district;
- re-validating a state after a zoning or protected-zone change;
- recomputing overlap flags after a bulk correction.

Today, flags missing from the cache are computed inside the GET request that first reads them. That is one indexed query per parcel, which is acceptable for a few hundred parcels. At state scale, a bulk import that leaves millions of flags uncomputed would push that cost onto whichever user loads the map next.

**Design [Planned].**

- Bulk jobs go to a job queue. A separate pool of spatial workers processes them in district-sized chunks using set-based PostGIS queries (section 4.1). Results are written back to the cached flag column.
- API requests never compute more than a bounded number of flags inline. A parcel whose flags are pending shows as "validation pending" rather than blocking.
- **Pilot:** the queue can be a PostgreSQL jobs table polled with `SELECT … FOR UPDATE SKIP LOCKED`. That adds no new infrastructure and keeps jobs transactional with the data they change.
- **Multi-state:** a dedicated broker (Redis or RabbitMQ, with a Python worker framework) once job volume or scheduling needs justify it.
- Workers are containers from the same image as the API, so they share the rule engine code.

### 4.5 Authentication and authorisation

- **[Implemented]** Roles (`citizen`, `village_officer`, `auditor`, `state_admin`, `officer`, `bank`, `super_admin`) are Firebase Auth custom claims, set only by server-side administration. The API reads the role from the verified ID token at `/auth/firebase-login` and enforces it with `require_roles(...)` on each route.
- **[Implemented]** Where the browser writes directly to Firestore, the deployed `firestore.rules` checks `request.auth.token.role` against the allowed roles. Each write path needs a matching backend role check and a matching rules clause. Main document section 5 describes this dual-path requirement.
- **[Planned] Emulator and production isolation.** Local development and automated tests use the Firebase Auth and Firestore emulators. The frontend connects to them only when the explicit opt-in flag `VITE_USE_AUTH_EMULATOR=true` is set, and no committed environment file sets it. On the backend, the Firebase Admin SDK accepts unsigned tokens whenever `FIREBASE_AUTH_EMULATOR_HOST` is set. The API must therefore refuse to start if that variable is present while `ENVIRONMENT=production`. The deployment pipeline should also check that neither variable appears in production configuration.
- **Production identity.** Firebase Auth is a foreign-operated service (main document section 7.4). A production deployment would move to an identity provider under the department's control, or to an approved government provider such as a state SSO or DigiLocker for citizens. The custom-claim model of one signed role per account carries over unchanged.

### 4.6 Deployment and operations

**Current state.**

- **[Implemented]** `docker-compose.yml` runs PostGIS, the API, the frontend and an Nginx load balancer for development and demonstration. The hosted prototype runs on Render (API and PostGIS) and Firebase Hosting (frontend), as described in main document section 7.1.
- **[Implemented]** The API exposes `/health` (liveness) and `/health/ready` (database reachable).

**Target by phase.**

| Concern | Pilot | Multi-state and national |
|---|---|---|
| Orchestration | Docker Compose, or a managed container service, on India-region infrastructure | Kubernetes, or a managed equivalent, on a MeitY-empanelled cloud or NIC/state data centre |
| Health checks | Liveness on `/health`, readiness on `/health/ready` | The same checks gate load-balancer registration and rolling updates |
| Releases | Alembic migration step, then replace containers | Rolling updates with readiness gates. Migrations must be backward-compatible (expand, then contract) so old and new replicas can run side by side. |
| Database | Managed PostgreSQL with PostGIS: primary, standby, one read replica, daily backups with a tested restore | One primary with a standby per state partition group, one or two read replicas each, point-in-time recovery |
| Secrets | Managed secret store | Managed secret store with rotation |
| Observability | Structured logs, request latency and error rates, database slow-query log | The same, plus per-state dashboards and alerting on replica lag and job-queue depth |

Data residency requirements (main document section 7.4) apply at every phase that holds real records.

---

## 5. Capacity estimate

These figures follow from the assumptions in section 2. They are orders of magnitude for planning and are not procurement quantities.

| | (a) Single pilot state: Tamil Nadu | (b) National rollout |
|---|---|---|
| Parcels | 20 million (D2) | 200 million (D1) |
| Primary data size | ~100 GB; plan 200 GB (D5) | ~1 TB; plan 2 TB (D5), divided across state partitions |
| GiST index size | ~2 GB (fits in memory) | ~20 GB in total; each partition's share fits in memory on its own node |
| Database servers | 1 primary (8 vCPU, 32 GB RAM class), 1 standby, 1 read replica | 1 primary and standby per state group, with 1 or 2 read replicas each. On the order of 10 to 15 primaries if large states are placed on their own nodes. |
| Peak staff sessions | 130 to 510 | 6,500 to 26,000 |
| Peak staff API load | about 10 to 50 requests/s | 650 to 2,600 requests/s |
| API replicas | 2 to 3 (for availability, not capacity) | About 10 to 35, across regions |
| Spatial workers | 1 or 2 (imports and re-validation) | Several per region, scaled on queue depth |
| Map tiles | CDN-cached; database load limited to cache misses and invalidations | Same design; CDN capacity is bought as a service |

**Where the first bottleneck appears.** It is the map-read path as currently implemented, and it appears well before any limit on users or database size. An offset-paged whole-state GeoJSON endpoint, with flags computed on read, cannot serve a state with millions of parcels. It would show incomplete maps and slow first loads on a single node with a single user. The second bottleneck is synchronous flag computation after bulk imports. Both are fixed by design changes (sections 4.3 and 4.4), not by adding hardware. After those changes, the next constraint is database I/O on a single primary during bulk re-validation of a large state. State partitioning (section 4.1) addresses that.

---

## 6. Phased rollout

| Phase | Scope | Data tier | API and map | What changes from the previous phase |
|---|---|---|---|---|
| **1. Pilot** | Chandigarh and Tamil Nadu | **Single node.** One PostGIS primary with a standby and a read replica. JSONB layers with GIN indexes. | 2 to 3 API replicas. Viewport-bounded queries, then vector tiles behind a CDN. PostgreSQL-table job queue with 1 or 2 workers. | Move from prototype hosting to India-region managed hosting. Real records under a data-sharing agreement. Remove the per-parcel flag loop from request handling. Load test to replace assumptions L1 to L5 and D2, D3 and D5 with measurements. |
| **2. Multi-state** | Roughly 5 to 10 states onboarded through adapter configuration | **Partitioned.** List partitioning by `state` on one primary, or on a few primaries grouped by state size. | Separate read and write API pools. Dedicated job broker. Tile cache invalidation on approval. | Partitioning introduced. Adapter configuration gains a database routing entry per state. Shared rate-limit store. Orchestrated deployment with rolling updates. |
| **3. National** | All states and Union Territories | **Fully sharded.** Large states on dedicated primaries, small states grouped. Summary tables for national reporting. | Regional API and read-replica pools. CDN in front of all public and map traffic. | Shards added one state at a time by configuration. Cross-border overlap job. Per-state operational dashboards. |

Each phase changes one dimension of the system: first hosting and correctness, then data layout, then geographic distribution. A failure can therefore be traced to the change that caused it.

---

## 7. Current MVP compared with production requirements

The current codebase is a working prototype on synthetic data. It already uses PostGIS with a GiST-indexed geometry column, runs its overlap and protected-zone checks as indexed `ST_Intersects` queries on the PostGIS path, caches computed flags on the parcel row, and refuses a silent fallback to SQLite. It does not yet provide what production requires:

- The map endpoint is offset-paged per state, not viewport-bounded, and the frontend fetches only its first page.
- Flags missing from the cache are computed inside read requests, one query per parcel.
- There is no job queue or worker tier.
- There are no read replicas, partitioning or vector tiles.
- Schema creation still runs at application startup.
- Rate limits are per instance.
- Parcel attributes are stored as `JSON` rather than indexed `JSONB`.
- Hosting is on free-tier services outside India.
- The SQLite development mode uses a Python full-scan overlap check. That check is acceptable only for local development at demo scale.
- The emulator and production isolation guards in section 4.5 are designed but not yet in the code.

Nothing in this document should be read as a claim that the prototype currently operates at pilot or national scale.

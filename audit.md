 ## Audit result: not production-ready

  The app builds and loads locally, but authentication, authorization, secret handling, and write access have critical gaps. I made no source changes. A temporary audit parcel created during testing was removed.

  ### Verified checks

  - Frontend production build: passed (vite build).
  - Local frontend page: 200 OK.
  - Backend root, parcel list, login, anonymous parcel detail, and passport endpoints: 200 OK.
  - npm audit --omit=dev: 0 known production dependency vulnerabilities.
  - Docker Compose configuration parses; it warns that the top-level version field is obsolete.
  - Browser-level click automation was not available; login-flow checks were exercised through the running frontend/backend and API requests.

  ## Critical security findings

   Severity    Finding                                                    Evidence / impact
  ━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Critical    Anyone can mint an officer or bank token                   Documents/GitHub/Land-Setu/backend/app/routes/auth.py:31 accepts only a client-supplied role—no password, identity, OAuth callback, account lookup, or authorization
                                                                          check. The UI also exposes a role switcher that calls this endpoint.
  ──────────  ─────────────────────────────────────────────────────────  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   Critical    Unauthenticated callers can create or overwrite parcels    Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:220 has no authentication/role dependency. It updates an existing parcel when the caller supplies its ULPIN
                                                                          (line 282 (Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:282)). This permits data tampering and denial of service.
  ──────────  ─────────────────────────────────────────────────────────  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   Critical    JWT signing secret is hard-coded and committed             Documents/GitHub/Land-Setu/backend/app/routes/auth.py:7 provides a known fallback secret; Documents/GitHub/Land-Setu/docker-compose.yml:30 repeats it. Anyone with
                                                                          repository access can forge valid officer tokens. Rotate it immediately.
  ──────────  ─────────────────────────────────────────────────────────  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   High        Parcel PII and signed passports are public                 Only GET /parcels/{ulpin} uses the role dependency. GeoJSON exposes owner names (Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:107); flags, geometry,
                                                                          passport, and custom-write routes have no access control. Anonymous passport generation returned 200.
  ──────────  ─────────────────────────────────────────────────────────  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   High        Passport JWT leaks personal data and does not expire       Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:185 places owner and parcel data in a JWT, returns the raw token, and inserts it into a URL query string
                                                                          (line 209 (Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:209)). Query strings leak to browser history, logs, referrers, and QR scans. Passport tokens have
                                                                          no exp, aud, iss, jti, or revocation strategy.
  ──────────  ─────────────────────────────────────────────────────────  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   High        CORS authorizes arbitrary origins with credentials         Documents/GitHub/Land-Setu/backend/app/main.py:18 uses wildcard origins and credentials. I confirmed a preflight from https://attacker.example received Access-
                                                                          Control-Allow-Origin: https://attacker.example and credential support. Restrict this to explicit trusted origins.

  ## Important issues

  - Login form values are ignored: any empty or arbitrary identifier/password still receives the chosen role token. See Documents/GitHub/Land-Setu/frontend/src/components/LoginPage.jsx:17.
  - The “DigiLocker” path is a mock UI, yet its text claims encrypted government OAuth integration. It bypasses real authentication and marks the UI logged in without acquiring a token. See Documents/GitHub/Land-Setu/frontend/src/components/
    DigiLockerModal.jsx:45.

  - JWTs are kept in localStorage (Documents/GitHub/Land-Setu/frontend/src/api.js:14), so any XSS can steal them. Prefer secure, HttpOnly, SameSite cookies with CSRF protection.
  - Missing/invalid authorization silently becomes citizen rather than returning 401 (Documents/GitHub/Land-Setu/backend/app/routes/auth.py:18). This conceals auth failures and makes policy handling inconsistent.
  - No request-size, geometry validity, coordinate-range, or ownership validation exists on custom parcel writes. Invalid or huge geometry can create server errors or expensive spatial processing.
  - Custom parcel state autodetection is calculated but discarded on insert: target_state is set, then req.state is stored (Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:228, line 293 (Documents/GitHub/Land-Setu/backend/app/
    routes/parcels.py:293)).

  - PostgreSQL credentials are hard-coded and port 5432 is exposed to the host in Documents/GitHub/Land-Setu/docker-compose.yml:7. Use secret injection and avoid publishing the database port outside development.
  - The app silently falls back from Postgres to a local SQLite file (Documents/GitHub/Land-Setu/backend/app/db.py:15). In production this can hide an outage and produce a split/stale data source.

  ## Performance and code-quality findings

  - N+1 / quadratic spatial work: list and GeoJSON routes evaluate rules for every parcel, and each overlap check loads all state parcels. See Documents/GitHub/Land-Setu/backend/app/routes/parcels.py:56 and Documents/GitHub/Land-Setu/
    backend/app/rules.py:38. This becomes approximately O(n²) and executes Python/Shapely spatial comparisons rather than indexed PostGIS predicates.

  - No pagination or field projection: /parcels and GeoJSON endpoints load all matching records. Large jurisdictions will produce slow responses and large map payloads.
  - Map requests are not debounced: every moveend triggers state identification (Documents/GitHub/Land-Setu/frontend/src/components/MapView.jsx:125). Add debounce, cancellation, and avoid calls unless crossing relevant bounds.
  - Production bundle is sizable: main JS is 417 KB uncompressed / 129 KB gzip. Code-split map, QR, adapter, and landing views; lazy-load Leaflet and the adapter screen.
  - Development server is used in Docker: Documents/GitHub/Land-Setu/frontend/Dockerfile:12 runs Vite dev mode. Build static assets and serve through a hardened web server for deployment.
  - Dependency builds are not deterministic: backend requirements use only lower bounds, and the frontend Dockerfile runs npm install rather than npm ci.
  - Generated artifacts are tracked, including node_modules, Python __pycache__, .pyc files, and backend/landsetu.db. Add .gitignore and remove generated/runtime data from version control.

  ## Recommended remediation order

  1. Disable public /auth/mock-login and /parcels/custom outside a clearly isolated demo environment.
  2. Implement real identity verification and server-side RBAC; authorize every route according to least privilege.
  3. Rotate JWT/database secrets; load them from a secret manager or environment only; fail startup if absent.
  4. Lock CORS to deployed frontend origins; use HTTPS and secure cookie-based sessions.
  5. Redesign passport verification: short-lived, opaque or minimally scoped token; no PII/token in query strings; add a verifier endpoint and revocation.
  6. Validate GeoJSON strictly, rate-limit sensitive endpoints, add audit trails and tests for authorization boundaries.
  7. Move spatial queries into PostGIS with indexes; paginate/map-tile results; cache computed flags where appropriate.
  8. Add CI checks: backend dependency auditing, unit/integration tests, auth tests, linting, secret scanning, and container scanning.

  The current setup is appropriate only as a clearly labelled hackathon/demo prototype with non-sensitive mock data.


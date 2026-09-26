# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Citizens** checking the record for a parcel they own, are buying or live on. They look it up by ULPIN, owner name or khata number. They are usually on a phone and do this rarely, so they need plain answers.
- **Village land officers** who review boundary markings and corrections at the first stage of the approval queue.
- **Auditors** who review requests at the second stage and approve spelling-level corrections on the fast track.
- **State administrators** who give final approval. When an approval creates a new parcel, they enter its record. They also see state-level activity and analytics.
- **Lenders (bank role)** who check whether a parcel is encumbered or flagged before lending. By design they see clearance only, not owner or deed details.
- **Super administrators** who manage accounts and roles.

Officer work happens during office hours, as transactions. It is not real-time, consumer-scale use.

## Product Purpose

LandSetu shows one parcel's records from several departments (Record of Rights, registration, zoning, building permit, tax, encumbrance) side by side. It flags where the records disagree. It says exactly which values a department confirmed and which it did not.

Success is when a citizen, officer or lender can tell confirmed fact from provisional data at a glance, and can act on a parcel's record without being misled about where a value came from.

It is a prototype for the Department of Land Resources "Land Stack" brief (SIH26014, team Logic Lords). It runs on synthetic data only.

## Positioning

Its difference is provenance shown per field. Every value carries where it came from:

- **verified**: from a department record, imported through the adapter;
- **officer_provided**: entered by the reviewing officer when approval created the parcel;
- **corrected_by_officer**: changed by an approved correction;
- **stale**: a department record, but out of date;
- **unverified** or **sample**: nothing confirms it.

A value is never labelled verified unless a department record supplied it. The map, the approvals and the flags are built on that rule.

## Operating Context

- The map is the main working surface. The detail panel opens beside it on desktop and over it on mobile.
- Officers work an approval queue with defined stages: village officer, then auditor, then state administrator, plus a fast track for spelling-level corrections. Nobody may approve their own request.
- The records service (FastAPI + PostGIS) is authoritative. Firestore is a read-only shared copy for browsers. The browser never writes a live parcel, a ledger block or a verified value.
- Pilot states are Tamil Nadu and Chandigarh. Other states have no records yet and must say so plainly.
- Citizens report problems through correction requests and the grievance page. Parcel passports are short-lived signed tokens for lenders and officers.

## Capabilities and Constraints

- ULPIN is the canonical parcel identifier.
- Area and state are computed by the server from the polygon, never taken from the browser.
- Rule flags: boundary overlap, protected zone, ownership mismatch, FSI violation, active encumbrance, and a mismatch between recorded extent and boundary area (more than 10%).
- The tamper-evident ledger is the server's append-only audit log, with hashes re-checked on every read.
- Write failures to the shared copy must be shown to the user, never swallowed.
- Known open items, fixed elsewhere and not in the UI: the 500-parcel map pagination, the officer/bank role display gap, and the seed geometry (all seeded parcels currently carry the area-mismatch flag).
- Languages: English, Hindi and Tamil, with more planned. Layouts must not assume English string lengths.
- Current stack: React + Vite, Leaflet, Turf.js, Firebase Auth. The icon set is lucide-react.

## Brand Commitments

- Name: LandSetu.
- Government DPI tone: trustworthy, calm, legible. No glassmorphism, neon, gimmick motion, or heavy animation or blur on the map and workspace.
- Colour never carries meaning alone. Every colour has a label or legend entry, and the palette must be colourblind-safe.
- The DigiLocker-style wordmark in the sign-in flow is pending a legal and trademark check. Do not extend it.

## Evidence on Hand

- Synthetic records for Tamil Nadu and Chandigarh (`backend/mock_data/`) and planted intelligence fixtures.
- `docs/security-posture.md` (the verified security and correctness record), `docs/std/deployment-scalability.md`, and `STANDARD_TECHNICAL_DOCUMENT.md`.
- Phase 0 screenshots in `docs/ui-baseline/`.
- There are no real users, testimonials, adoption figures or government endorsements. Never imply any.

## Product Principles

1. Provenance before polish. Where a value came from is as visible as the value.
2. Say what is missing. No records, not found, no permission and failed to save are each stated plainly and separately, never as a blank screen or a made-up record.
3. The map is the workspace. Nothing on it slows panning, hides parcels or competes with the data.
4. Prototype honesty. Demo and synthetic data are always labelled as such, including on the map.

## Accessibility & Inclusion

- GIGW 3.0 and WCAG 2.1 AA: contrast, keyboard access, visible focus, skip link, alt text, a lang attribute, and one `h1` per route.
- Multilingual typography for Latin, Devanagari and Tamil scripts, with more planned.
- Must work at 320px width and at 200% zoom.

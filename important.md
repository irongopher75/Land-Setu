# Prompt: India Boundary, Real-Time Location, District Layer & Owned-Land Overlay

Add the following to LandSetu's frontend and backend. This extends the existing map (which currently shows mock parcels nationally + deep in 4 pilot states) with real administrative boundaries and real-time user location, while keeping individual land-ownership data as the existing mock dataset (real government land-ownership registries are not publicly API-accessible, and this must remain synthetic/demo data).

## 1. Real India country + state + district boundaries

Use real, openly-licensed boundary data — do not hand-draw or approximate India's outline.

- Country outline: use India's national boundary GeoJSON (available from `udit-001/india-maps-data` on GitHub, or GADM-derived data via `divya-akula/GeoJson-Data-India`)
- State boundaries: per-state GeoJSON from the same sources (`udit-001/india-maps-data` provides direct per-state GeoJSON/TopoJSON links)
- District boundaries: use `guneetnarula/indian-district-boundaries` (Datameet community dataset, covers all Government-of-India-recognized districts as of 2019) or the district-level files in `udit-001/india-maps-data`

Implementation:
- Download the needed GeoJSON files at build time (or fetch once and cache locally in `backend/mock_data/boundaries/`) — do NOT fetch these from a live GitHub raw URL on every page load; bundle them locally so the demo doesn't depend on internet access to a third-party repo during judging
- Add a backend endpoint `GET /boundaries/country`, `GET /boundaries/states`, `GET /boundaries/districts?state=<name>` serving the locally-stored GeoJSON
- Frontend: render the country outline as the base layer (styled as a subtle border, not filled), state boundaries as a toggleable layer, and district boundaries as a toggleable layer that loads on-demand when a user zooms into a specific state (don't load all ~750 districts' full-resolution geometry at once — lazy-load per state to keep the map responsive)

## 2. Real-time user location

Use the browser's native Geolocation API — this is a real, standard web capability, not mocked.

```js
navigator.geolocation.getCurrentPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    map.setView([latitude, longitude], 12); // zoom into user's actual location
    L.marker([latitude, longitude]).addTo(map).bindPopup("You are here");
  },
  (error) => {
    // fallback: keep default India-wide view if permission denied or unavailable
    console.warn("Geolocation unavailable, showing national view", error);
  }
);
```

Requirements:
- Request location only on explicit user action (a "Locate me" button), not automatically on page load — auto-requesting permission on load is bad UX and many browsers block it silently anyway
- Always have a graceful fallback to the default India-wide view (`setView([22.9734, 78.6569], 5)`) if the user denies permission or geolocation fails
- Once located, determine which state/district the coordinates fall into using a point-in-polygon check against the boundary GeoJSON (use Turf.js: `turf.booleanPointInPolygon`) and auto-highlight that state/district on the map — this is what actually connects "your real location" to "the district you're standing in," not just a marker

## 3. District-level area info panel

When a user clicks a district (or is auto-located into one):
- Show a lightweight info panel: district name, state, and count of mock parcels within that district (from existing mock data, if any fall inside it)
- If the district is one of your 4 deep-tier pilot states, indicate that richer data is available and link/zoom into the relevant pilot parcels
- If it's a lightweight-tier district, show a simple "basic parcel identity records available" message consistent with the existing two-tier data model

## 4. Individual-owned land overlay (stays mock — do not connect to real registries)

- Continue using the existing canonical parcel schema and mock dataset for individual ownership (`layers.ror.owner_name`, etc.) — do not attempt to fetch, scrape, or connect to any real state land-record system for actual ownership data. These are not public APIs, and using real individuals' real ownership data without authorization is out of scope and not something to build.
- Render owned parcels as before (clickable polygons/markers with the parcel panel), now spatially aware of which real district each parcel geometry falls into via the same point-in-polygon check — so a mock parcel correctly reports "District: Chennai, State: Tamil Nadu" derived from the real boundary data, not a hardcoded label
- This is the actual integration point: real geography (district/state boundaries) + real user location, combined with existing synthetic ownership records — do not blur this distinction in the demo narrative. State clearly in the pitch: "boundaries and location are real; land records are simulated for demo purposes, consistent with the problem statement's own allowance for mock datasets."

## Libraries needed
- `turf` (npm) for point-in-polygon and spatial joins
- Leaflet's built-in `L.geoJSON()` for rendering boundary layers
- No new backend dependencies beyond serving static GeoJSON files

## Definition of done
- [ ] Map renders India's real national outline, not a placeholder shape
- [ ] State boundaries toggle on/off as a layer
- [ ] District boundaries lazy-load per state on zoom-in
- [ ] "Locate me" button requests real geolocation, centers map, and correctly identifies the containing state/district
- [ ] Clicking a district shows a real district name (not mock) and count of parcels within it
- [ ] Mock parcels correctly report their real containing district/state via spatial join, not hardcoded strings
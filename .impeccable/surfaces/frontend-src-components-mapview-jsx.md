---
version: 1
slug: "frontend-src-components-mapview-jsx"
primary_target: "frontend/src/components/MapView.jsx"
related_targets: ["frontend/src/App.jsx","frontend/src/components/ParcelPanel.jsx","frontend/src/components/ConfidenceBadge.jsx"]
---

# Map workspace and shared UI system

Scope: the whole LandSetu frontend shares one visual world; the map workspace (/map with the parcel panel) is the first surface built in it. Visitor mode: Operate. Landing and public pages inherit the world later at higher variance.

Audience and task: citizens look up a parcel and read its record; officers work the approval queue; lenders check clearance. The one job every screen serves: tell confirmed fact from provisional data at a glance.

Constraints: GIGW 3.0, WCAG 2.1 AA; Latin, Devanagari, Tamil; map performance first (no blur or heavy motion on map routes); colour never alone; lucide-react icons only; no backend or rules changes.

## Direction contract

THESIS: Every parcel reads as a numbered notice; each value is a clause that ends by citing the authority behind it. Refuses the category default of a blue portal header over service cards, and its opposite, a dark SaaS map dashboard.

OWN-WORLD: Cool newsprint-white ground (#FAFAF7), ink black text, hairline and double rules as the only structure; no cards, no shadows. Colour exists only as provenance: green for department-verified, blue for officer-provided, ochre for corrected by officer, grey for unverified or sample, each paired with a glyph and a word and used for nothing else. Noto Serif for notice headings with stacked bilingual lines, Noto Sans for interface text, tabular figures for ULPINs, areas and rupees.

STORY: The visitor sees the prototype masthead, finds a parcel on the schedule-plate map, opens its notice, and reads each clause with its source; they understand which values a department confirmed and act on that.

FIRST VIEWPORT: Full-width masthead strip with LandSetu, a permanent Prototype, synthetic records label and state selector. Below, three ruled bays: a narrow numbered schedule legend on the left, the map plate in the centre with scale bar and live coordinates in its lower rule, and the parcel notice on the right with numbered clauses and source citations. On phones the notice becomes a bottom sheet over the map with a visible handle.

FORM: Gazette Notice, position 7 of 7 on the ranked list, raised by: reserved provenance colours (wayfinding), measured map frame (oscilloscope), tabular figures (datamatics), literal state naming (quote grammar), ruled bays as grid (elbow panel). Seed key 334dbca5.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Risk and mitigation: a gazette look could be mistaken for an official notification; no national emblem, no notification numbers, and the prototype label is visible on every screen, including the map.

Unresolved: landing-page expression of the world; whether Hindi or Tamil leads the stacked headings when the interface language changes.

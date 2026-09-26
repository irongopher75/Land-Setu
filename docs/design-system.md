# LandSetu design system

*Status: tokens and the provenance badge system are in place. The rest of this document (map layers, states, banner, masthead, layout) fills in as each surface moves to the new system. This file is meant to be lifted into the Standard Technical Document's "UI/UX guidelines" and "Colour schema" sections with minimal edits.*

## 1. Direction

The chosen visual direction is the **Gazette Notice**. Every parcel reads as a numbered notice, and each value is a clause that ends by citing the authority behind it.

Structure comes from ruled lines (hairlines between clauses, heavier rules between bays). There are no cards, and no shadows except on the few things that float over the map. Colour appears only to say where a value came from, or to flag a data-quality problem on a parcel. Each colour is reserved for that one meaning.

Why this direction: the product's distinguishing feature is showing, field by field, who confirmed a value. A notice that cites its authority on every line puts that feature in the layout itself instead of in decoration.

**Guardrail.** A gazette-like look must never be mistaken for an official notification. The interface therefore:
- uses no national emblem,
- uses no notification numbers,
- shows a "Prototype, synthetic records" label on every screen, including the map.

## 2. Tokens

The tokens are defined in `frontend/src/styles/tokens.css` and carry the `--ls-` prefix while older screens are migrated.

### 2.1 Colour

| Token | Value | Meaning | Contrast on paper |
|---|---|---|---|
| `--ls-paper` | `#FAFAF7` | Page ground (light, chosen from the use scene: phones outdoors, desktops under office light) | n/a |
| `--ls-paper-sunk` | `#F1F1EC` | Table heads, wells, the map's ruled margin | n/a |
| `--ls-ink` | `#141414` | Text and heavy rules | 17.6:1 |
| `--ls-ink-muted` | `#4E4E4A` | Secondary text | 8.0:1 |
| `--ls-rule` | `#C4C4BC` | Hairlines between clauses (decorative) | n/a |
| `--ls-verified` / tint | `#00704F` / `#E2F1EA` | A department record, current | 5.9:1 |
| `--ls-officer` / tint | `#005A8C` / `#E1EDF6` | Entered by the reviewing officer when approval created the parcel | 7.1:1 |
| `--ls-corrected` / tint | `#A33D00` / `#F7E8DF` | Changed by an officer-approved correction | 6.2:1 |
| `--ls-unconfirmed` | `#3E3E3B` (no tint) | Out of date, self-declared, not confirmed, or sample | 10.7:1 |
| `--ls-flag` / tint | `#8C3A72` / `#F4E5EE` | Data-quality flag on a parcel (area mismatch, overlap, protected zone) | 6.8:1 |
| `--ls-notice-bg` / `-fg` | `#141414` / `#FAFAF7` | System notices, such as a refused write (inverted ink, no hue) | 17.6:1 |

**Colour rules:**
- **Reserved hues.** The four provenance hues and the flag hue appear nowhere else in the interface. They are never used for decoration, links or buttons.
- **Colour is never alone.** Every hue is paired with a glyph, a border style and a word (section 3).
- **Colour-vision checks.** The five hues stay at least ΔE 9.8 apart under simulated deuteranopia, protanopia and tritanopia. Under deuteranopia, verified green and the unconfirmed ink converge. They stay distinct because:
  - verified has a tinted field and unconfirmed has none;
  - verified uses a solid border and unconfirmed a dotted one;
  - their glyphs differ.

### 2.2 Type

| Token | Family | Use |
|---|---|---|
| `--ls-font-notice` | Noto Serif (+ Devanagari, Tamil) | Notice and page headings |
| `--ls-font-ui` | Noto Sans (+ Devanagari, Tamil) | All interface text |
| `--ls-font-id` | Noto Sans Mono | Identifiers only: ULPIN, khata, request numbers |

- **Why Noto.** One design covers Latin, Devanagari, Tamil and the other scripts planned, so a label keeps its weight and rhythm when the language changes.
- **Scale.** Sizes run 13 / 14 / 16 / 18 / 22 / 28 / 36 px. 13 px is the floor, used for badge and legal text.
- **Line height and measure.** Body line height is 1.55, which leaves room for Devanagari and Tamil. Body width is capped at 68 characters.
- **Figures.** Numbers in tables and records (areas, rupees, dates) use tabular figures.

### 2.3 Space, rules, layers, motion

- **Space.** A 4 px base: `--ls-space-1` to `--ls-space-8` (4, 8, 12, 16, 24, 32, 48, 64 px). The workspace uses 1 to 4; public pages use 4 to 8.
- **Rules and corners.**
  - Hairline 1 px between clauses; 2 px rule between bays; double rule for officer-provided values and the masthead.
  - Corners are square. Controls get 2 px corners for touch.
- **Elevation.** One shadow, `--ls-shadow-float`, and only for things over the map: the mobile sheet, toasts, popovers.
- **Layers.** Map 0; map controls 400 (above Leaflet's panes); panel 500; sheet 600; masthead 700; modal 900; toast 1000.
- **Motion.** Workspace motion is state change only, at 120 or 180 ms with an exponential ease-out. Public pages may use the 320 ms duration once. `prefers-reduced-motion` sets every duration to 0.
- **Focus.** A two-tone ring (paper, then ink) that stays visible on paper, on the tints and on the inverted notice.

## 3. Provenance badges

Component: `frontend/src/components/ConfidenceBadge.jsx`. Styles: `frontend/src/styles/provenance.css`.

Every value in a parcel record carries one badge. All badges share one shape: a square-cornered label with a glyph and a word. They differ in hue, border style and glyph together.

| State (`confidence`) | Label | Glyph | Border | Field | Meaning |
|---|---|---|---|---|---|
| `verified` | Verified | BadgeCheck | solid | green tint | From the department's own record, and current |
| `officer_provided` | Provided by reviewing officer | UserCheck | double | blue tint | Entered when the parcel was approved; not confirmed by the department |
| `corrected_by_officer` | Corrected by officer | PencilLine | dashed | vermillion tint | Changed by an approved correction; not confirmed by the department |
| `stale` | Out of date | Clock | dotted | none | Department record, not confirmed in the last three years |
| `self_declared` | Self-declared | MessageSquareQuote | dotted | none | Stated by the applicant |
| `unverified` (and any missing or unknown value) | Not confirmed | HelpCircle | dotted | none | No department record supplies it |
| `unverified_placeholder` | Sample value | FlaskConical | dotted | none | Bundled sample shown while the records service is unreachable |

**Sizes:**
- **`compact`** (tables, map popups) shows the label. The qualifier goes in the tooltip and in screen-reader text.
- **`full`** (the parcel record) shows the label and the plain-language qualifier. It names the department when the record supplies one.

**Rules:**
- **Do** show a badge on every departmental layer of a parcel record.
- **Do** show the legend (`ProvenanceLegend`) wherever badges appear in bulk, such as the parcel record and the map legend.
- **Don't** set `verified` in the interface. Only the records service assigns it, from a department record.
- **Don't** treat a missing value as verified. The component renders anything unknown as "Not confirmed".
- **Don't** reuse a provenance hue for any other purpose, such as a status chip, a link or a chart series.

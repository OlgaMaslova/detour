# Detour Madrid MVP product audit

**Scope:** the deployed experience at `https://detour-app.supernaut.to` and the frontend checked out at `supernaut/managed-app` (`9ebbb5e`, reviewed 2026-07-14).

**Positioning standard:** Detour should feel like a deliberately edited route through Madrid's exceptional tables. The map should be the first act; awards and sources should make a choice credible without making the product read like a data-verification interface.

## Executive decision

The production app has a working live catalogue, a genuine interactive map, source links, filters, name search, and an unusually solid accessibility foundation for an MVP. The core product direction is already visible in the warm editorial palette and the selective, award-backed catalogue.

It is not yet map-first. At both tested widths, visitors encounter a large hero and five control groups before the map. On desktop, the venue list receives more width and visual weight than the 420px map panel. On mobile, all controls come before the map, and the detail panel appears between the map and the results after selection. Provenance is accurate but currently repeated in the hero, every card, and the detail panel; raw verification mechanics can become the most memorable part of a venue.

The next implementation should solve hierarchy and language before adding more discovery features.

## Reproducible production observations

### Test method

- Loaded the production URL with a 1440×1000 desktop viewport and a 390×844 mobile viewport.
- The live view loaded **43 venues**, four guide sources, award/category/source filters, name search, a location opt-in, map pins, and official source links.
- Filtered to **Pizza** on desktop: the result count changed to two, the list and pins narrowed to Baldoria and Fratelli Figurato, and selecting a Baldoria map pin selected its card and opened the matching detail panel.
- Searched for `zzzzzz` on mobile: the app reported zero venues, rendered the no-results explanation and reset action, and kept the Madrid map visible with a matching no-pins message. Reset restored the live selection.
- Selected Coque at both widths. The selected state, map popup, source links, and detail panel all updated. The production view reported two venues without map pins.

### What is already working

- Live results load into one canonical card per venue and preserve multiple awards. See `src/main.ts` `loadLiveVenues()` and `filteredVenues()`.
- Award, category, source, and name filters all update result count, cards, and map pins together. The empty state has a useful reset. See `render()` and `mapPanel()` in `src/main.ts`.
- Card selection and map-pin selection synchronize in both directions. The selected card, popup, and detail panel visibly agree.
- Official source links remain available for every rendered award in `venueCard()` and `detailPanel()`.
- The visual base is coherent: warm paper, dark umber, restrained ember accent, serif venue names, generous card spacing, and a muted map treatment. See the token system and map styles in `src/styles.css`.
- Buttons have persistent selected state, inputs have labels, the count and empty state use live announcements, visible focus styling exists, the map pins implement Enter/Space activation, and reduced-motion CSS is present. See `src/main.ts` `mountMap()` and `src/styles.css` focus/reduced-motion rules.

## Prioritized implementation plan

### P0 — launch blockers

#### 1. Put the map in the first discovery moment

**Observed:** the top of the desktop page is hero plus five lines of controls; the map begins below them. At 1440px, the list is the dominant left column while the map is constrained to 420px and 320px minimum height. At 390px, the visitor must move through award, category, guide, search, and location controls before reaching the map. The current mobile screenshot also shows an empty detail prompt directly after the map and before the cards.

**Why it blocks launch:** “Mapped” is the promise in the H1, but the current interaction begins as a long filter-and-list interface. The map feels like a supporting visual rather than the decision surface.

**Change:** restructure the post-hero composition so the map is directly below the compact introduction on mobile and is the dominant desktop pane. Place only the essential discovery control(s) over or immediately adjacent to the map: search, a concise filters trigger, and the nearby opt-in. Move award, category, and source choices into a compact expandable/filter tray with a clear active-filter summary and reset. Keep the list as the map's responsive companion rather than the competing primary pane. On mobile, selected venue information should appear as a compact map-adjacent sheet or explicit detail state, not as a full block between the map and the results.

**Files/components:** `src/main.ts` `render()` layout order, `mapPanel()`, `detailPanel()`; `src/styles.css` `.layout`, `.side`, `.map-panel-live`, `.venue-map`, and the `max-width: 860px` rules.

**Acceptance signal:** at 1440px and 390px, a first-time visitor sees and can act on the Madrid map before—or alongside—the primary discovery controls, without scrolling through a filter stack.

#### 2. Make provenance trustworthy but secondary

**Observed:** provenance appears in the large hero guide string, a “Source-attributed” badge, source lines on every card, full verification notes in the selected detail, and source links again in the facts block. The selected Coque detail exposed “Exact name; Sol level; Madrid locality checked in the official 2026 booklet (printed listing pages 90-91)” and an OSM node identifier. The selected Baldoria detail exposed the source-list count and country-validation mechanics.

**Why it blocks launch:** the current selection proves its work repeatedly. It reads as an audit ledger rather than a luxurious editorial guide, and source-fact detail displaces the cue that should make a diner want to explore a place.

**Change:** retain one discreet official-guide line and source link per selected venue. Collapse detail notes into a short “Why it’s here” proof line only when it is useful to a diner, with an optional “About this selection” disclosure for methodology. Remove raw record IDs, printed-page citations, field-check phrasing, source-list entry counts, and country/city-validation narration from the consumer view. Keep that information in data/repository documentation, not venue discovery copy.

**Files/components:** `src/main.ts` `venueCard()`, `detailPanel()`, hero badges in `render()`; the data-driven `award.verification_note` / `note` content loaded in `loadLiveVenues()`; fallback notes in `src/data.ts`; visual density in `.card-sources`, `.detail-note`, `.hero-badges`, and `.badge` in `src/styles.css`.

**Acceptance signal:** a diner can confirm the guide and open its official page in one step, while the card and selected view lead with venue, award, neighbourhood/address, and an editorial reason to consider it.

#### 3. Replace technical fallback and map-coverage language

**Observed:** the fallback banner says “Showing a local demo selection — the live catalogue isn’t connected yet.” Map states use “Locations pending verification,” “no verified venue pins,” and “not pinned — location pending verification.”

**Why it blocks launch:** failure/fallback handling exposes implementation state and turns legitimate coverage limitations into coordinate workflow language.

**Change:** use an honest visitor-facing availability state: for example, “Madrid’s selection is temporarily unavailable. Please try again shortly.” Only show a curated fallback if it is deliberately labelled as a limited preview, never as “local demo.” For individual coverage gaps, use editorial language such as “Map position being refined” and keep an address where it is available. Do not claim precision that the data cannot support.

**Files/components:** `src/main.ts` `render()` `demoBanner`, `mapPanel()`, `venueCard()`, `detailPanel()`, boot fallback; `src/data.ts` demo-note content; `.demo-banner`, `.status-banner`, `.map-note`, `.approx` in `src/styles.css`.

**Acceptance signal:** no visitor-facing backend, demo, verification-workflow, or coordinate-process language remains when live loading fails or a venue cannot be pinned.

### P1 — high-value polish

#### 4. Reduce the control wall and make filtering feel selective

**Observed:** all award levels, categories, and four guide sources are independently exposed as pill groups before discovery. At mobile width, long source pills create a multi-row control wall. There is no visible active-filter summary or reset until the zero-results state.

**Change:** begin with search and a single “Refine” action. Treat awards as a curated lens and sources as a secondary trust filter. Show selected filters as removable chips near the map, surface result count there, and offer an always-available clear action. Preserve the existing filter semantics and keyboard operation.

**Files/components:** `src/main.ts` `awardFilters()`, `categoryNames()`, `sourceNames()`, `render()` event bindings; `src/styles.css` `.controls`, `.filters`, `.filter`, `.count`, `.search-control`, mobile styles.

#### 5. Sharpen editorial copy and the premium visual system

**Observed:** “Madrid’s trusted table, mapped.” is a strong start. The longer hero paragraph and hero guide list explain the data model before creating appetite. The product's visual language is warm and consistent, but the visual hierarchy spends substantial top-of-page space on explanatory badges rather than the city/map.

**Change:** shorten the hero to a clear city promise and a single line of editorial framing. Reframe labels from operational terms—“Award level,” “Guide source,” “Source-attributed,” “guide year,” and “Award source(s)”—to guest-recognizable terms such as “Recognition,” “Guide,” “Official guide,” and “2026 selections,” where accuracy permits. Make the map's selected state and venue cards the characteristic visual moment; keep the palette and type pairing, but reduce rounded pill repetition and guide-name density.

**Files/components:** hero and control copy in `src/main.ts` `render()`; `detailPanel()` fact labels; metadata in `index.html`; typography, badge, filter, card, and map styles in `src/styles.css`.

#### 6. Make selection continuity clear across map, list, and detail

**Observed:** map-to-card selection works. However, map selection opens a popup and detail while the list remains visually separate; on mobile, a selected result can land the user at the map/detail area while the selected card sits below. The neutral detail prompt consumes a large block ahead of results before anything is selected.

**Change:** define one explicit selected-venue presentation per breakpoint. On desktop, the selected detail should be visually bound to the map. On mobile, use a compact sheet below the map and ensure its close action returns focus to the invoking pin/card. Replace the large unselected detail box with a smaller, useful map instruction or omit it.

**Files/components:** `src/main.ts` `mountMap()` selection callback, card event handler, `detailPanel()`; `.detail`, `.detail-empty`, `.side`, media rules in `src/styles.css`.

#### 7. Improve map handling and empty/loading states

**Observed:** the map remains useful during filters and zero results. The loading copy is clear, but loading starts with a generic “Loading map…” panel in the later layout position. The map reports unpinned venues with process language.

**Change:** reserve the final map footprint early to avoid hierarchy shifts, show a minimal editorial loading treatment, and give no-results a map-first recovery path (“Clear filters” plus the city frame). Keep attribution legally required but visually quiet. Add a specific error state for failed live loading rather than silently changing the product's data mode.

**Files/components:** `src/main.ts` `render()`, `mapPanel()`, boot promise; `.loading`, `.map-panel`, `.map-empty`, `.map-note`, Leaflet attribution styles in `src/styles.css`.

### P2 — later enhancements

- Add a lightweight saved/shortlist affordance only after the core map path is coherent; it would reinforce selective discovery but is not required for Madrid launch.
- Add opening-hours, reservation, cuisine, and neighbourhood enrichment only where an approved source supports it. Do not replace the current trusted selection with generic directory metadata.
- Consider guide-specific editorial collections or routes after the single Madrid map journey succeeds.
- Add an accessible textual “Browse this map” alternative only if user research shows the map itself is not sufficient for discovery; do not dilute the default route before validating it.

## User-facing location and coordinate language to remove or reframe

The frontend does not print latitude or longitude values today. It does, however, expose coordinate verification and location-processing language. These are all current deterministic consumer strings that should be removed or reframed in the premium experience:

- `src/main.ts` `mapPanel()`:
  - “No venues match your current search or filters — no pins to show. The map stays centered on Madrid.”
  - “Locations pending verification — no verified venue pins to show yet. The map stays centered on Madrid.”
  - “{n} venue(s) not pinned — location pending verification.”
- `src/main.ts` `venueCard()`:
  - “approx. location”
  - “Location pending verification”
- `src/main.ts` `detailPanel()`:
  - “approximate location”
  - “Location pending verification”
- `src/main.ts` location opt-in and fallback:
  - “Your location”
  - “Use my location”
  - “Requesting your location…”
  - “We couldn’t get your location, so the map stays centered on Madrid — everything else works as usual.”
  - “Your location is shown on the map as a blue dot.”
  - “Your approximate location” (the map tooltip)
- `src/data.ts` fallback `note` values:
  - “Address and coordinates verified … via OpenStreetMap/Nominatim …”
  - “Coordinates are OpenStreetMap-sourced …”
  - “Coordinates are OpenStreetMap/Nominatim-sourced …”
- `src/main.ts` data-driven detail notes: every raw `award.verification_note` / `note` is rendered verbatim. Production examples observed include “OSM restaurant node 7006949434 matches name and Madrid-city address,” printed-listing page references, “city Madrid, country Spain as listed by the ranking,” and ranking-entry counts. The render path must stop displaying these operational notes verbatim.

**Recommended treatment:** retain the street address when known. Reframe an uncertain pin as “Map position being refined” or hide the map marker while keeping the place discoverable. Rename the voluntary location action to “Show nearby” and make its error text brief and plain. Keep raw coordinate, gazetteer, record-ID, and validation information in repository provenance records, never in the public venue detail.

## Accessibility and responsive review

### Good foundations to preserve

- Native buttons and labelled search control are used throughout.
- Selection uses `aria-pressed`; venue cards expose `aria-expanded`; count, empty state, detail, map note, and geolocation status have live semantics.
- `mountMap()` makes the actual map pin keyboard-operable with Enter and Space, includes an accessible label, and manages selected state.
- Shared `:focus-visible` rules are obvious against the palette.
- The CSS includes a `prefers-reduced-motion` block.
- At 390px, filters wrap without observed horizontal overflow; cards, source links, and the map fit the viewport.

### Risks to address in the implementation

- **Visual vs keyboard order diverges on mobile.** `.side { order: -1; }` moves map/detail before cards visually, but the DOM in `render()` places results before `.side`. Keyboard users therefore reach the entire venue list before the visually earlier map/detail. Restructure the DOM rather than relying on CSS ordering for the new map-first layout.
- **No skip link.** The page has a substantial header/control sequence. Add a “Skip to map” or “Skip to results” link once the information architecture is changed.
- **Selection focus needs intent.** Cards call `scrollIntoView({ behavior: 'smooth' })` even under a reduced-motion preference, while map selection does not move focus to the updated detail. Restore focus to the invoking card/pin when detail closes; use a motion-aware scroll strategy; announce the selected venue in a concise, non-duplicative way.
- **Map control inspection is still required.** Leaflet supplies a focusable map container and zoom controls in addition to Detour's inner pin buttons. The next QA pass should test sequential Tab/Shift+Tab order, pin activation by keyboard, popup dismissal, and that tiles never obscure a focused pin or control.
- **Touch targets need confirmation after the redesign.** Current filter/button padding is reasonable, but the future compact filter trigger, map control overlay, close button, and any mobile sheet must retain a 44px-equivalent usable target.

## Implementation guardrails

- Preserve live PocketBase loading, filtering, search, geolocation opt-in, official source links, and keyboard-operable map selection. The audit does not recommend changing the backend or adding a framework.
- Continue plotting only known venue positions. The public wording changes; the underlying provenance standard does not.
- Keep source attribution accurate and linked. Do not copy guide editorial text, imagery, or branding into the new presentation.
- Preserve the no-results reset path and distinct failed-loading state.
- Keep the product title, description, and existing location-pin favicon in `index.html`, but revise the title/description when the map-first editorial copy is finalized.

## Suggested implementation order

1. Recompose `render()` and responsive DOM/CSS around a dominant map, compact discovery controls, and selected-venue state.
2. Rewrite the consumer copy and remove/contain technical provenance notes.
3. Rework filters into progressive disclosure while preserving existing predicates and reset behavior.
4. Add focus, skip-link, and reduced-motion fixes.
5. Build and run focused desktop/mobile QA covering live load, filters, search/reset, map/list selection, source links, geolocation denial, keyboard traversal, and no-results.

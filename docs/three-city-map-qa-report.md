# Three-city map frontend — QA evidence report

## Validation context

- **Where:** Local Vite dev server (`npm run dev`, http://127.0.0.1:5173) in the development sandbox, tested in a real Chromium browser at desktop (1280×900) and mobile (375×812) viewports, against the **current live PocketBase backend**.
- **Live data at test time:** the backend served **43 Madrid venues only** (Guía Repsol, Michelin, 50 Top Pizza, 100 Best Coffee Shops). The Paris and San Francisco seed migrations exist in `pb_migrations/` but were **not yet deployed to the live backend** — so Paris and San Francisco were validated in their configured "not published here yet" state. No claim is made here that Paris/SF production data is deployed.
- **Fallback:** the demo fallback remains Madrid-only and is used **only** when the live catalogue is unreachable/empty; the live path was active during all tests below.

## Tested scenarios and actual outcomes

| # | Scenario | Outcome |
|---|----------|---------|
| 1 | **Build** — `npm run build` (`tsc --noEmit && vite build`) | Passed; 11 modules transformed, no TypeScript errors. |
| 2 | **Desktop city switch** — select Madrid → Paris → San Francisco | Hero, tagline, footer, search placeholder, map aria labels and map centre all switch per city; count re-scopes (43 → 0 → 0). No Madrid record appears under Paris/SF. |
| 3 | **Mobile city switch** (375×812) | Selector renders full-width with 44px touch height; SF switch re-centres the map on San Francisco and shows the SF empty state. |
| 4 | **City-scoped filtering/search** — searched "DiverXO" in Madrid (count "1 place"), then switched to Paris | Search, filters, selection, saved map view and location all reset on switch; Paris shows "0 places" with its own empty state — no leaked Madrid results. |
| 5 | **Map state per city** | Madrid: live pins fitted to bounds, "2 places … map position being refined" note. Paris: hero/tagline/footer say map positions are being refined (no pins implied); map holds the Paris fallback view. San Francisco: fallback SF view; copy supports verified pins once data is live. |
| 6 | **Selection & detail** — clicked the DiverXO map pin | Detail panel opened with both awards (3 Soles Guía Repsol, 3 Stars Michelin), address, and working official-guide source links. Detail lookup is city-scoped. |
| 7 | **Keyboard/selector accessibility** | Native `<select>` with a programmatic "City" label (exposed as a labelled combobox in the accessibility tree); standard keyboard operation; visible `:focus-visible` outline retained across all controls; focus returns to the selector after a switch. |
| 8 | **URL restoration** — `?city=san-francisco`, `?city=paris` | Boot restores the requested city. Switching cities updates the URL via `history.replaceState`; a full reload after switching to Paris restored Paris. |
| 9 | **Invalid URL value** — `?city=tokyo` | Falls back safely to Madrid; app behaves normally. |
| 10 | **No-results / reset** — non-matching search in Madrid | City-specific empty state with "Show everything" reset; cities with no published selection instead show a graceful "isn't published here yet" state without a misleading reset button. |
| 11 | **Geolocation (opt-in)** | Fallback/status copy is city-aware ("…the map stays on Paris…"). A position outside the active city's conservative bounds is neither drawn nor framed, and the status says so. No latitude/longitude or technical terminology is ever displayed. |
| 12 | **Reduced motion** | Detail scroll-into-view checks `prefers-reduced-motion` and uses instant scrolling when reduced motion is requested (code-level expectation; unchanged behavior from the audited existing implementation). |

## Known limitations

- Paris and San Francisco live records were not present in the backend at test time, so their populated (cards + pins) states could not be exercised against live data; they will light up automatically once the seed migrations are deployed, with no frontend change needed.
- Geolocation grant flows were validated by code review and the deny/fallback path; a real in-city GPS fix was not available in the test environment.

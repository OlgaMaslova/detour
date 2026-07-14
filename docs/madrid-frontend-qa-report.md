# Detour Madrid frontend QA report

**Date:** 2026-07-14  
**Frontend under test:** `supernaut/managed-app` at `18643b5` (`feat: make Madrid discovery map-first`)  
**Test environment:** local Vite build backed by the deployed Madrid catalogue, checked in Chromium at **1440×1000** and **390×844**. The production URL was not used as release evidence because it still serves the previous frontend until the follow-up deployment.

## Result

**PASS — no launch-blocking frontend defects found.**

`npm run build` completed successfully before and after QA (`tsc --noEmit && vite build`). The working tree needed only this QA report; no product-code fix was required.

## Coverage and outcomes

| Area | Desktop (1440×1000) | Mobile (390×844) | Outcome |
| --- | --- | --- | --- |
| Initial hierarchy and live catalogue | Map appeared immediately after compact search/refinement controls; **43 places** loaded from the live catalogue. | Same map-first order; compact controls wrapped cleanly above the map. | Pass |
| Responsive presentation | Dominant map, visible zoom controls, result cards, attribution, and selected state all fit the viewport. | No observed horizontal overflow; controls remained usable and the map controls were unobscured. | Pass |
| Filter tray | Recognition, category, and guide controls opened in one labelled tray with clear and done actions. | Same tray remained readable and touch-friendly. | Pass |
| Filter predicates and reset | Recognition `3 Soles` reduced the catalogue to **4 places**. Category `Pizza` reduced it to **2 places**; the map and cards stayed in sync. Clear/reset restored the full selection. | Pizza filtering and active-filter state were also confirmed at the narrow viewport. | Pass |
| Search and empty state | — | Searching `zzzzzz` returned **0 places**, retained the Madrid map, explained recovery, and `Show everything` restored the full selection. | Pass |
| Map/list/detail sync | A Baldoria map pin opened its matching selected card and map-adjacent detail, including the address and official guide link. | Selecting Coque from a result card opened its matching detail and retained the map selection. | Pass |
| Source links | Baldoria’s detail link opened the live official 50 Top Pizza Europa 2026 page. | Official guide links remained present in card and detail states. | Pass |
| Location opt-in fallback | — | A denied/unavailable browser location produced the non-technical fallback message and kept Madrid usable. | Pass |
| Keyboard and focus | Map pin activation via keyboard was confirmed after closing detail: focus returned to the invoking pin and Enter reopened its matching detail. | The first Tab stops on the visible `Skip to the map` link; Enter moves the narrow viewport directly to the map. | Pass |
| Motion safety | The implementation uses the reduced-motion media query for scrolling, transitions, and animations; selection scrolling uses the same preference. | Same stylesheet path. | Pass (implementation review) |
| Unavailable-catalogue fallback | — | Starting with an intentionally unreachable API endpoint showed the limited Madrid preview, **23 places**, working pins, filters, cards, and source links without technical implementation copy. | Pass |

## Accessibility and content checks

- Search has an associated label.
- Filter controls expose pressed and expanded states, and active filters are removable.
- Map pins are announced as buttons with venue and recognition context, and support Enter/Space activation.
- The selected detail, result count, map notes, empty state, and location status use live/status semantics where updates matter.
- Visible focus treatment was confirmed for the skip link, refinement control, and map controls.
- Public UI strings were checked for latitude/longitude, coordinate-validation, local-demo, and backend terminology. None was exposed.

## Non-blocking limitations

- Browser emulation in this pass did not expose an operating-system reduced-motion toggle. The report therefore records the dedicated CSS and motion-aware scroll path as implementation-review evidence rather than a separate OS-preference screenshot.
- The current public deployment still serves the earlier interface. This is expected at this stage; deploy the tested commit before treating the production journey as release-verified.
- Two live Madrid places intentionally remain unpinned while their map position is refined. They stay discoverable in the list, and the map note communicates the limitation without technical provenance language.

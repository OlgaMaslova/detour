# 2026-07-12 — Detour Madrid public verification checklist

Public URL: https://detour-app.supernaut.to

Release: `731dd0c` (`feat: add searchable venue empty state`). The frontend reads
its 2026 Madrid selection from the live API. Test viewports: desktop 1440×1000
and mobile 390×844.

## Result: pass

- [x] **Initial map and list:** both viewports loaded 20 live venues and 20
  OpenStreetMap pins, with visible OpenStreetMap attribution.
- [x] **Award/source filters:** the 3-Soles filter returned exactly 4 venues
  and the same 4 pins: Coque, DiverXO, DSTAgE, and Ramón Freixa Atelier.
- [x] **List/pin synchronization and detail:** selecting the Coque pin opened
  its matched card and detail panel, including the official Guía Repsol award
  source link.
- [x] **Reachable empty state:** entering `No such Detour venue` in **Search by
  name** produced 0 venues, the helpful no-match state, the
  **Clear search & filters** action, and the Madrid-centred no-pins map note.
  Clearing restored all 20 live venues and pins.
- [x] **Location fallback:** an unavailable/denied browser-location request
  showed “We couldn’t get your location…” and retained the Madrid map view
  without creating a user pin.
- [x] **Responsive usability:** at 390×844 the map, filters, search, cards,
  details, and empty-state reset control fit without horizontal overflow.

## Coordinate provenance

All 20 pin coordinates were verified 2026-07-12 against OpenStreetMap/Nominatim
and are stored with per-record notes. Otoro Jukusei remains a street-level
approximation; Deessa remains the Mandarin Oriental Ritz building centroid.

# 2026-07-12 — Madrid venue coordinates verification & public URL checklist

## Release note

**Coordinates/pins were changed in this release.** Migration
`pb_migrations/1767973000_verify_madrid_venue_coordinates.js` updates all 20
Madrid venue seed rows (`venueseed000001`–`venueseed000020`) with
OpenStreetMap/Nominatim-verified street addresses and lat/lng (verified
2026-07-12; per-record OSM node/way/relation ids are recorded in each row's
`coord_verification_note`). Map pin positions **must be rechecked post-deploy**
against the live database.

Coordinate source: OpenStreetMap via https://nominatim.openstreetmap.org/
(data © OpenStreetMap contributors, ODbL 1.0). Notable per-record caveats:

- Otoro Jukusei: street-level only (no OSM house-number node for Fernández de
  la Hoz 35); pin is approximate.
- Deessa: pin is the Mandarin Oriental Ritz building centroid (restaurant is
  inside the hotel).
- Ugo Chan: address-level match at Félix Boix 6 (OSM node unnamed).
- Ramón Freixa Atelier / Tradición: intentionally share one pin (Velázquez 24).

## Public URL verification — desktop 1440×1000 and mobile 390×844

Verify each item at both viewports after deploy:

- [ ] Live list shows exactly **20 records** (10 new-Sol + 10 continuing 2026
      Madrid Sol holders).
- [ ] **3-Sol filter returns exactly 4**: Coque, DiverXO, DSTAgE,
      Ramón Freixa Atelier.
- [ ] Detail view opens and shows **source attribution** (Guía Repsol source
      link / booklet provenance) per record.
- [ ] **Map state before pins**: initial map render is sane before/without
      venue pins loading (no broken tiles, correct Madrid extent).
- [ ] **Location denied fallback**: with browser geolocation denied, the app
      falls back gracefully (no error state; default Madrid view retained).
- [ ] **Mobile visual usability** at 390×844: filters, list, detail, and map
      are readable and tappable without horizontal overflow.
- [ ] **Pins recheck (this release)**: spot-check pins for Coque, DiverXO,
      Deessa (hotel centroid), Otoro Jukusei (approximate) and La Catapa
      against their listed addresses.

## Zero-results note

Zero results **cannot currently be invoked** through the UI: every supplied
award/source combination (Guía Repsol 2026 × 1/2/3 Soles × Madrid) has data,
so the empty state is unreachable with the seeded dataset and was not
verifiable.

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

## Public URL verification — completed 2026-07-12

Public URL: https://detour-app.supernaut.to

- [x] **Desktop 1440×1000:** live list rendered **20 records**; the Leaflet/OpenStreetMap map rendered 20 pins and visible attribution.
- [x] **Mobile 390×844:** the map, controls, list, and detail view rendered without horizontal overflow.
- [x] **Filtering:** the 3-Sol filter returned exactly **4** venues — Coque, DiverXO, DSTAgE, and Ramón Freixa Atelier — and the map refit to those four pins.
- [x] **Selection/detail/attribution:** choosing Coque from the map opened the matched list detail and Guía Repsol award source link.
- [x] **Pin spot checks:** Coque, DiverXO, Deessa, Otoro Jukusei, and La Catapa matched the migrated address data. Deessa remains a hotel-centroid pin; Otoro remains an approximate street-level pin.
- [x] **Location fallback:** in a denied/unavailable browser-location run, the app kept its Madrid map view and showed a clear fallback message.

## Zero-results note

Zero results **cannot currently be invoked** through the UI: every supplied
award/source combination (Guía Repsol 2026 × 1/2/3 Soles × Madrid) has data,
so the empty state is unreachable with the seeded dataset and was not
verifiable.

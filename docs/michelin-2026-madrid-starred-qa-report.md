# QA report — 2026 Michelin Guide Madrid-city starred dataset

**Status: PASS** — generated deterministically by `npm run validate:michelin-madrid` from `data/michelin-2026-madrid-city-starred.csv`.

## Scope shape

- Total records: 30 (expected 30)
- 3-star: 1 (expected 1); 2-star: 6 (expected 6); 1-star: 23 (expected 23)
- Total stars: 38 (expected 38)

## Errors

None.

## Deliberate out-of-scope exclusions (official capture 2026-07-12)

These appeared on the official 1-star “Madrid y alrededores” category page but sit outside Madrid city and are excluded by design:

- Ancestral (Pozuelo de Alarcón, 1-star)
- Chirón (Valdemoro, 1-star)

Non-starred categories (Bib Gourmand / Selected) are entirely out of scope and unenumerated.

## Coordinate quality breakdown

- osm_verified (named restaurant identity in OSM): 18
- osm_address_verified (exact OSM address/building geometry, venue identity not necessarily tagged): 9
- osm_approximate (explicit location approximation, not exact venue geometry): 1
- needs_review (blank coordinates, no pin asserted): 2

## Coordinate exceptions (blank coordinates, retained records)

2 of 30 records are retained without coordinates rather than asserting an unverified pin:

- OSA (1-star) — needs_review: Listed on the official 2026 one-star category page; Nominatim returns only unrelated street/burger matches for this short name so no pin is asserted.
- Pabú (1-star) — needs_review: Listed on the official 2026 one-star category page; no matching OSM/Nominatim restaurant object found so coordinates are deliberately left blank.

## Approximate coordinates (retained, explicitly not exact venue geometry)

- RavioXO (1-star) — osm_approximate: Approximate pin: OSM way 891287353 is the plaza footway at Manuel Gómez-Moreno, not the exact venue entrance; treated as a location approximation, not an OSM venue or address match.

Coordinate-carrying records: 28 of 30 (source: OpenStreetMap/Nominatim, independent of Michelin). Address/building-level and approximate pins are labelled and are never presented as named-restaurant OSM matches.

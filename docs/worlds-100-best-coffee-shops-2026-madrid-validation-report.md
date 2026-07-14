# Validation report — The World's 100 Best Coffee Shops 2026, Madrid source dataset

**Status: PASS** — generated deterministically by `npm run validate:coffee-madrid` from `data/worlds-100-best-coffee-shops-2026-madrid.csv` and `data/madrid-2026-unified-venues.json`. Facts as of access date 2026-07-14 (no other timestamps generated).

Policy: `docs/2026-07-14-madrid-pizza-coffee-source-policy.md`.

## Errors

None.

## Source coverage

- Records: 1 (expected 1). The current 2026 global top-100 contains exactly one Madrid entry.
- Candidate: Hola Coffee Lagasca, global rank 19, Madrid, Spain (edition: The World's 100 Best Coffee Shops 2026, status current).
- Provenance: manual capture on 2026-07-14; review status verified.
- Official ranking URL: https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/
- Official venue record URL: https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/

## Excluded non-governing related display

- "Hola Coffee Roastery" appears at #8 on the official Europe subset page. It is a related, non-governing regional display name: it is not auto-merged with the global record and is validated as absent from the source rows.

## Location evidence (kept separate from imported source facts)

- Official venue record address: Calle Lagasca, 42, 28001, Madrid, Spain (source: official-venue-record).
- Independent corroboration: OpenStreetMap Nominatim named cafe node 12147737601 with matching address; coordinates within Madrid-city bounds; status osm_verified, source openstreetmap-nominatim.
- Coordinates are OSM-sourced (independent of the guide) and never copied from source editorial material.

## Dedupe decision

- Checked against `data/madrid-2026-unified-venues.json` (40 canonical Michelin/Repsol venues) using exact normalized full-name matching only (NFC, trim, collapse whitespace, lower case; no diacritic folding, no fuzzy/prefix matching).
- Outcome: **no_match** — No existing canonical venue matches; candidate remains a standalone source row (no Detour canonical venue linkage). No merge performed.
- Machine-readable artifact: `data/worlds-100-best-coffee-shops-2026-madrid-dedupe.json`. No fuzzy merge is performed under any circumstance.

## Rights and provenance constraints

- Links and facts only: source name, list, edition, rank, venue spelling, city/country, official URLs, access date, compact verification notes.
- No guide prose, images, logos, reviews, or other editorial material is copied; no reuse licence is assumed for any source content.
- Each fact is attributed to its official source URL; corrections/removals on request are recorded in the verification note per the source policy.
- This dataset is standalone: it is NOT integrated into the unified venues dataset and makes no merge decisions.

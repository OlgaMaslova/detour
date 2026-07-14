# Validation report — 50 Top Pizza Europa 2026, Madrid source dataset

**Status: PASS** — generated deterministically by `npm run validate:pizza-madrid` from `data/50-top-pizza-europa-2026-madrid.csv` and `data/madrid-2026-unified-venues.json`. Facts as of access date 2026-07-14 (no other timestamps generated).

Policy: `docs/2026-07-14-madrid-pizza-coffee-source-policy.md`.

## Errors

None.

## Source coverage

- Records: 2 (expected 2). The official 60-entry 50 Top Pizza Europa 2026 ranking contains exactly two Madrid entries.
- Candidates: Baldoria (rank 2) and Fratelli Figurato (rank 11), Madrid, Spain (edition: 50 Top Pizza Europa 2026, status current).
- Provenance: manual capture on 2026-07-14; review status verified.
- Official ranking URL: https://www.50toppizza.it/50-top-pizza-europa-2026/
- Official venue URLs: https://baldoriamadrid.com/en/ ; https://www.fratellifigurato.es/pizzeria-madrid

## Explicitly rejected candidates

- 50 Top Pizza Europa 2026 (official 60-entry ranking): No other Madrid entry appears in the official 60-entry Europa 2026 ranking; only Baldoria (rank 2) and Fratelli Figurato (rank 11) qualify.
- 50 Top Pizza World 2025: Historic edition; excluded per source policy (current-edition-only import).
- 50 Top Pizza World 2026: Future/unpublished-at-access edition relative to the 2026-07-14 access date; excluded per source policy.

## Branch/address caveat (Fratelli Figurato)

- The 50 Top Pizza ranking names only "Fratelli Figurato" with city Madrid and does not identify a specific branch; the operator runs multiple Madrid locations (evidence: official booking page https://www.fratellifigurato.es/reserva-mesa).
- For deterministic location, the primary "Pizzeria Fratelli Figurato" at Calle Alonso Cano, 37, 28003 Madrid is used, identified via the official operator page https://www.fratellifigurato.es/pizzeria-madrid and corroborated by OSM node 6131891485.
- This is a separately corroborated named Pizzeria venue — never an invented claim that the guide awarded a particular branch.

## Location evidence (kept separate from imported source facts)

- Baldoria: official address "C. de José Ortega y Gasset, 100, 28006 Madrid" (source: official-venue-site); OSM node 11916159225 at (40.4294985, -3.6707425) within Madrid-city bounds; status osm_verified, source openstreetmap.
- Fratelli Figurato: official address "Calle Alonso Cano, 37, 28003 Madrid" (source: official-operator-page); OSM node 6131891485 at (40.4389910, -3.6978429) within Madrid-city bounds; status osm_verified, source openstreetmap.
- Coordinates are OSM-sourced (independent of the guide) and never copied from source editorial material.

## Dedupe decision

- Checked against `data/madrid-2026-unified-venues.json` (40 canonical Michelin/Repsol venues) using exact normalized full-name matching only (NFC, trim, collapse whitespace, lower case; no diacritic folding, no fuzzy/prefix matching).
- Baldoria: **no_match** — No existing canonical venue matches; candidate remains a standalone source row (no canonical venue linkage). No merge performed.
- Fratelli Figurato: **no_match** — No existing canonical venue matches; candidate remains a standalone source row (no canonical venue linkage). No merge performed.
- Machine-readable artifact: `data/50-top-pizza-europa-2026-madrid-dedupe.json`. No fuzzy merge is performed under any circumstance.

## Rights and provenance constraints

- Links and facts only: source name, list, edition, rank, venue spelling, city/country, official URLs, access date, compact verification notes.
- No guide prose, images, logos, reviews, or other editorial material is copied; no reuse licence is assumed for any source content.
- Each fact is attributed to its official source URL; corrections/removals on request are recorded in the verification note per the source policy.
- This dataset is standalone: it is NOT integrated into the unified venues dataset and makes no merge decisions.

# Validation report — San Francisco catalogue expansion

**Status: PASS** — generated deterministically by `npm run validate:sf-catalogue-expansion`.

Inputs: `data/san-francisco-catalogue-expansion.csv`, `data/michelin-2026-san-francisco-two-three-starred.csv`, and `pb_migrations/1767984000_add_san_francisco_catalogue_expansion.js`.

## Coverage

- New canonical venues: 15
- MICHELIN 2026 Bib Gourmands: 12
- MICHELIN 2026 one-star additions: 2
- 50 Top Pizza USA 2025 entries: 1
- Categories: Casual 12, Fine dining 2, Pizza 1
- Named OSM/Nominatim pins (including Rintaro under its exact short name): 12
- Address-level OSM/Nominatim pins: 3
- Nonzero map coordinates: 15
- Unique row-authority source URLs: 15

## Provenance rules checked

- Each MICHELIN row uses its individual official restaurant record as row authority.
- The 12 Bib rows retain the [official 2026 roundup](https://guide.michelin.com/us/en/article/michelin-guide-ceremony/california-s-most-affordable-restaurants-in-2026) as a shared source record.
- The two one-star rows retain the [California edition announcement](https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california) published 2026-06-24.
- Tony’s Pizza Napoletana retains the [official 50 Top Pizza USA 2025 ranking](https://www.50toppizza.it/50-top-usa-2025/) and rank 3.
- Coordinate provenance is independently attributed to OpenStreetMap/Nominatim, never to either guide.
- Exact normalized-name comparison found no collision with the 10 existing San Francisco canonical rows.
- Unranked MICHELIN recognitions use numeric rank `0` in both awards and source entries; the migration generates no SQL `NULL` for rank columns.
- The migration adds no schema field and uses bulk `INSERT OR IGNORE` for every seeded table.

## Validation errors

None.

## Approved roster

| Venue | Category | Distinction | Coordinate status |
|---|---|---|---|
| A16 | Casual | bib-gourmand | osm_verified |
| Anchor Oyster Bar | Casual | bib-gourmand | osm_verified |
| Bansang | Casual | bib-gourmand | osm_address_verified |
| Dumpling Home | Casual | bib-gourmand | osm_verified |
| Good Good Culture Club | Casual | bib-gourmand | osm_verified |
| Izakaya Rintaro | Casual | bib-gourmand | osm_verified |
| Okane | Casual | bib-gourmand | osm_verified |
| Outerlands | Casual | bib-gourmand | osm_verified |
| Trestle | Casual | bib-gourmand | osm_verified |
| Yank Sing | Casual | bib-gourmand | osm_verified |
| Z & Y | Casual | bib-gourmand | osm_address_verified |
| Kitchen Istanbul | Casual | bib-gourmand | osm_verified |
| Hilda and Jesse | Fine dining | one-star | osm_verified |
| Nisei | Fine dining | one-star | osm_address_verified |
| Tony’s Pizza Napoletana | Pizza | 50 Top Pizza USA 2025 — No. 3 | osm_verified |

Checks passed: 683/683.

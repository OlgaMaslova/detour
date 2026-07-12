# Source, rights, and ingestion memo — 2026 Michelin Guide Madrid-city starred dataset

Dataset: `data/michelin-2026-madrid-city-starred.csv` (30 records).
Validator: `npm run validate:michelin-madrid` → `docs/michelin-2026-madrid-starred-qa-report.md`.

## Official source surfaces

All award facts come from official `guide.michelin.com` pages, accessed 2026-07-12:

- 3-star category listing: <https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/3-estrellas-michelin>
- 2-star category listing: <https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/2-estrellas-michelin>
- 1-star category listing: <https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/1-estrella-michelin>
- Corroborating official 2026 Spain/Andorra star announcement article (published 2025-11-25):
  <https://guide.michelin.com/es/es/articulo/michelin-guide-ceremony/todos-los-restaurantes-con-estrellas-michelin-en-espana-2026>

Each CSV row's `source_url` is the exact per-star category listing URL that names it,
with `source_type=official-category-listing` and `source_accessed_at=2026-07-12`.

## Collection procedure

Manual, small-scale reading of the three official category listing pages — **no
large-scale automated scrape of Michelin** was performed. Only minimal factual
fields were recorded: restaurant name (with source spelling), star category,
guide year, locality/country. Addresses and coordinates were then validated
**independently** against OpenStreetMap via the public Nominatim API (one
polite, rate-limited lookup per restaurant), not taken from Michelin.

## No-copy / risk policy

- No Michelin editorial prose, inspector descriptions, cuisine labels, images,
  badges, rank data, or profile text is copied. The dataset retains only minimal
  factual metadata (award, name, year, place) needed for provenance and matching.
- **No express reuse licence from Michelin is claimed or implied.** This memo is
  not a legal conclusion that any individual fact, the guide's compilation, or
  the collection as a whole is unrestricted. Keep the selection attributable and
  limited; seek permission before expanding it into a broad reproduction, and
  pause affected use on a credible rights-holder objection.
- Coordinates/addresses derive from OpenStreetMap (© OpenStreetMap
  contributors, ODbL 1.0); attribution is required where they are displayed.
- Correction/removal policy: on any rights-holder or venue request, or on
  discovery of an error, the affected row is corrected or removed and the
  validator expectations updated in the same change.

## Scope, coverage counts, and out-of-scope listings

Scope is deliberately **Michelin-starred restaurants in the city of Madrid
only**, even though the official category pages label their geography
“Madrid y alrededores”.

- In scope: 30 records = 1 three-star (DiverXO) + 6 two-star + 23 one-star; 38 stars total (1×3 + 6×2 + 23×1).
- Excluded out-of-city 1-star results (2): Ancestral (Pozuelo de Alarcón), Chirón (Valdemoro).
- Out of scope entirely: non-starred categories. The official general Madrid
  listing page showed 171 total restaurant cards on 2026-07-12; the 141
  non-starred (Bib Gourmand / Selected) listings are unenumerated by design.

## Precision and known limitations

- Coordinates are present only where a responsible OSM/Nominatim basis was
  established (`coord_source=openstreetmap-nominatim`), qualified by
  `coord_validation_status`:
  - `osm_verified` — a named OSM restaurant object confirms the venue identity;
  - `osm_address_verified` — exact OSM address/building geometry at the venue's
    published address, but the venue identity is not (necessarily) tagged in
    OSM; these are never presented as named-restaurant matches;
  - `osm_approximate` — an explicit location approximation (e.g. a plaza
    centroid), not exact venue geometry.
  Where no responsible coordinate could be established, the record is retained
  with blank coordinates and `coord_validation_status=needs_review`; every
  blank or approximate row is enumerated in the QA report rather than being
  given an invented pin.
- Some verified OSM addresses lack house numbers; they are recorded as-is.
- The dataset is a point-in-time capture (2026-07-12) and may drift from the
  live guide as it is updated.

## Reproducible commands

```
npm run validate:michelin-madrid
```

Regenerates `docs/michelin-2026-madrid-starred-qa-report.md` deterministically
(output depends only on the CSV) and exits non-zero on any validation failure.

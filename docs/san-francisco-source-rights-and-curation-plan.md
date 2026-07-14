# San Francisco source-rights and curation plan

- **Date:** 2026-07-14 (research access date)
- **Scope:** A conservative, rights-aware specification for Detour’s first San Francisco restaurant seed. This is research and import guidance only. It does not add data, migrations, coordinates, frontend changes, or make a claim of licence or partnership.
- **Decision:** Use the official **MICHELIN Guide California 2026** announcement and its individual official restaurant records as the governing award evidence. Start with the ten San Francisco restaurants holding two or three MICHELIN Stars. Do not import the broader one-star population in the first seed.

## 1. Why this is the governing source

The selected source is a durable first-party award surface with both a dated edition announcement and record-level pages:

- **Edition announcement and statewide roster:** [Every MICHELIN-Starred Restaurant in California for 2026](https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california), published **24 June 2026**. The article says the latest California selection was revealed on that date and identifies 83 starred restaurants statewide.
- **Current city discovery surface:** [San Francisco all-starred restaurants](https://guide.michelin.com/us/en/california/san-francisco/restaurants/all-starred). On 2026-07-14 it showed `San Francisco and surroundings: 1–29 of 29`. This is useful for record discovery, but it is not the geographic authority for the seed because its scope includes nearby cities.
- **Record-level evidence:** the ten individual official MICHELIN Guide restaurant records listed in Section 3. They supply the source venue name, city, award level, guide year, and a stable first-party URL per candidate.

The official 2026 announcement is the edition authority. The individual record is the row authority. The live city list is a navigation and cross-check surface only; because it is mutable, a later import must never use its current count as a historical edition count.

### 1.1 Explicitly out of scope

- Third-party rankings, reviews, reservation platforms, social posts, map listings, blogs, press coverage, and search-result text are **not** award or provenance sources.
- The MICHELIN list’s nearby-city entries are out of scope. The live all-starred page also displayed Oakland, San Anselmo, and San Mateo entries on the access date; these must not enter a City and County of San Francisco seed.
- Bib Gourmand, “selected” restaurants without stars, hotels, bars, individual special awards, past editions, and announced-but-unpublished future editions are out of scope.
- The one-star population is deliberately deferred. Its absence from the launch seed is an editorial coverage choice, not a quality judgement.

## 2. Geographic and edition rules

A source entry is eligible only when **all** of these conditions hold:

1. Its official MICHELIN record identifies the locality as `San Francisco, CA, USA`.
2. The physical venue is inside the City and County of San Francisco. “San Francisco and surroundings,” Bay Area, Peninsula, or California is insufficient.
3. The official 2026 record currently identifies a two- or three-star distinction.
4. The restaurant is operating at the official location on the final manual verification date.
5. A first-party restaurant site or official MICHELIN record supplies an address suitable for later location corroboration. The address must be checked independently from the award assertion before it becomes a map pin.

The governing edition is **MICHELIN Guide California 2026**, status `current` as of this document’s access date. The 2026 edition replaces California 2025 for the seed. A future edition replaces 2026 only after MICHELIN has officially published its complete selection. Historical records may corroborate a venue identity but never govern the award field.

## 3. Conservative launch cohort

The recommended cohort is intentionally narrow: **10 restaurant records, 4 three-star and 6 two-star**. Each is a municipal San Francisco restaurant in the official 2026 selection. This gives Detour a small, clearly premium starting set with a direct award source for every record.

### 3.1 Three-star cohort

- **Quince** — `three-stars`, `3`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/quince>; operator site: <https://www.quincerestaurant.com/>.
- **Californios** — `three-stars`, `3`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/californios>; operator site: <https://www.californiossf.com/>.
- **Benu** — `three-stars`, `3`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/benu>; operator site: <https://www.benusf.com/>.
- **Atelier Crenn** — `three-stars`, `3`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/atelier-crenn>; operator site: <https://www.ateliercrenn.com/>.

### 3.2 Two-star cohort

- **Acquerello** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/acquerello>; operator site: <https://www.acquerellosf.com/>.
- **Kiln** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/kiln-1210355>; operator site: <https://www.kilnsf.com/>.
- **Lazy Bear** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/lazy-bear>; operator site: <https://www.lazybearsf.com/contact-info/>.
- **Sons & Daughters** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/sons-daughters>; operator site: <https://www.sonsanddaughterssf.com/>.
- **Saison** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/saison>; operator site: <https://saisonsf.com/contact/>.
- **Birdsong** — `two-stars`, `2`; official record: <https://guide.michelin.com/us/en/california/san-francisco/restaurant/birdsong>; operator site: <https://www.birdsongsf.com/info>.

### 3.3 Final capture rule

The dataset worker must manually open the announcement, current city list, and every individual record on the same capture day. The worker must confirm exact source spelling, `San Francisco, CA, USA`, and the two- or three-star distinction before setting `verification_status = verified`.

A failed, moved, closed, renamed, inaccessible, or conflicting entry is **not** guessed or substituted. Set it to `needs_review`, omit it from the migration, and document the reason in the generated validation report. This makes the seed able to ship with fewer than ten rows rather than publishing unsupported data.

## 4. Rights, attribution, and permitted factual use

### 4.1 Permitted, minimal factual use

Capture only the facts necessary to identify and attribute a verified award entry:

- source and list names;
- edition year/status and award level/star count;
- source-provided venue spelling and locality/country;
- canonical official source URLs and access date;
- the restaurant’s own official URL when it is used for location verification;
- a short factual verification note, status, and correction history.

Every Detour record must preserve a link to the exact official MICHELIN record used for the distinction. Discovery UI may display a restrained factual attribution such as “MICHELIN Guide California 2026 — 2 Stars” linked to that record. It must not imply sponsorship, endorsement, or partnership.

### 4.2 Prohibited use

Do **not** copy, transform, summarize, or train on:

- inspector reviews, editorial descriptions, menu prose, cuisine descriptions, rankings commentary, quotations, or any other expressive MICHELIN text;
- MICHELIN photographs, video, logos, badges, stars-as-graphics, typography, page layout, trademarks, or page screenshots;
- restaurant imagery, menus, logos, brand marks, or editorial copy from operator sites;
- bulk copies, automated scraping, crawling, or republication of guide or restaurant pages;
- claims that the cohort is exhaustive, officially partnered, approved by MICHELIN, or a licensed guide.

No reuse licence is assumed. The use here is limited to a small manual capture of verifiable factual assertions with URLs and attribution. If a source or restaurant requests correction or removal, remove or correct the affected entry promptly, mark the provenance `corrected` or `removed`, and record the action without retaining removed editorial content.

### 4.3 Location data is separate evidence

An award page proves an award; it does not automatically clear or verify a map coordinate. For each candidate, validate the current street address against the restaurant’s own site (preferred) or, if absent, the official MICHELIN record. Store the location source URL and status separately from the award source.

Coordinates require an additional reproducible geospatial check. Follow the existing Madrid policy: use a named OpenStreetMap/Nominatim match when available; label building-centroid and approximate pins explicitly; leave latitude and longitude blank with `needs_review` if a responsible match cannot be established. Do not reverse-geocode a pin to invent an address or derive a venue identity from a nearby result.

## 5. Import specification for the dataset worker

### 5.1 Proposed files and command

Create these in the subsequent data milestone, without modifying previously applied migrations:

- `data/michelin-2026-san-francisco-two-three-starred.csv` — normalized input, one row per source assertion.
- `scripts/validate-michelin-2026-san-francisco-starred.mjs` — dependency-free deterministic validator.
- `docs/michelin-2026-san-francisco-starred-validation-report.md` — generated committed report with no run timestamp.
- a new later-timestamp migration, named after the approved cohort, which seeds the rows idempotently into the existing normalized collections.

The expected verified output is **10 source entries, 10 canonical venues, 10 awards, 10 row-level MICHELIN record URLs, and 0 unresolved locations**. The validator must instead fail, with an explicit exception list, if a row lacks mandatory award provenance, fails the city/award rules, duplicates another canonical candidate, or has unresolved address/coordinate data that is proposed for publication. A location-unresolved row may remain in the input report but must be excluded from the map-facing migration.

### 5.2 Required input columns

Use the established Madrid data style, with these fields at minimum:

```text
restaurant_name
source_restaurant_name
michelin_distinction
michelin_stars
guide_year
locality
country
street_address
latitude
longitude
source_url
source_type
source_published_or_updated_at
source_accessed_at
venue_official_url
location_source_url
location_verification_status
coord_source
coord_validation_status
verification_status
note
```

Field constraints:

- `restaurant_name` initially equals the verified official source spelling. A later canonical normalization may change only after the exact-match rules in Section 6 are satisfied.
- `michelin_distinction` is exactly `two-stars` or `three-stars`; `michelin_stars` is respectively `2` or `3`.
- `guide_year` is exactly `2026`; `locality` is exactly `San Francisco`; `country` is exactly `United States`.
- `source_url` is the individual HTTPS MICHELIN record from Section 3; `source_type = official-restaurant-record`.
- The dated announcement must be represented once in `source_records` as the governing edition source, with source type `official-edition-announcement`, date `2026-06-24`, and access date. It is corroborating edition evidence, not a substitute for a row URL.
- `source_accessed_at` is the final manual verification date in `YYYY-MM-DD` format.
- `venue_official_url` and `location_source_url` must be first-party restaurant URLs or the official MICHELIN record. Do not use a booking platform, a search engine, or a third-party directory as location evidence.
- `verification_status` starts `verified` only after every row-level check in Section 7 passes. Otherwise it is `needs_review` and the row does not seed a public venue.
- `street_address`, latitude, and longitude are blank until independently supported. Never populate sentinel coordinates.

### 5.3 Normalized collection mapping

The existing `guide_sources`, `source_records`, `import_provenance`, `venues`, `venue_awards`, and `venue_source_entries` model remains the target. The following mapping is required:

- One guide source: `michelin-guide` (reuse the existing source record rather than creating a duplicate source).
- One edition-announcement source record for the 24 June 2026 California announcement, plus one official-record source record per imported restaurant URL. Source records are keyed by exact URL and should use deterministic identifiers where the current schema permits them.
- One import provenance row: `michelin-2026-san-francisco-two-three-starred`, recording the final verified row count, scope, guide source, access date, and status.
- One canonical `venues` record per accepted physical restaurant, with `city = San Francisco` and `country = United States`.
- One 2026 current `venue_awards` record per accepted venue, with level `2 Stars` or `3 Stars`, linked to its individual record-level source and the import provenance row.
- One `venue_source_entries` record per input row, retaining the source spelling, distinction, row URL, validation qualifiers, and exact match evidence.

The migration must use bulk idempotent inserts/updates with deterministic identities and `INSERT OR IGNORE`-style safeguards. It must not edit prior migrations, create duplicate guide sources, merge uncertain records, or overwrite a pre-existing venue’s location with weaker data.

## 6. Dedupe and identity rules

No canonical merge decision is made by this plan. The data worker applies this sequence:

1. Normalize source name with Unicode normalization, lowercase, trimmed/collapsed whitespace, and diacritic removal.
2. Compare only `normalized full name + city + country` against existing canonical venues.
3. Auto-merge only an exact normalized-name match. The source record and award still remain separate, linked source assertions.
4. Use an independently verified exact address only as corroboration; an address never creates a match by itself.
5. Send aliases, punctuation variants with materially different names, parent venues, moves, closures, branches, and all non-exact results to a manual exception file. Never fuzzy-match.

Potentially confusing identities require special attention: **Atelier Crenn** and any co-located Crenn venue are distinct unless an exact-name rule proves otherwise; restaurant sites that operate multiple concepts are not evidence that those concepts share a canonical venue. Do not infer an award for a related venue, a hotel, a chef, or a group.

## 7. Deterministic validation and acceptance checks

The validator must be dependency-free and fail nonzero on any failure. It must produce a human-readable report containing exact counts and the rejected-row list. Required checks:

1. Exactly the Section 3 cohort is present, unless the report lists an excluded candidate with a documented verification failure.
2. No duplicate `source_restaurant_name + guide_year + michelin_distinction` rows.
3. Every imported row has a valid HTTPS `guide.michelin.com` individual record URL, a valid first-party location URL, and access date `2026-07-14` or later.
4. Every row has `guide_year = 2026`, `locality = San Francisco`, `country = United States`, `verification_status = verified`, and star level 2 or 3.
5. The source URL is not the mutable all-starred landing page, a search result, or an unrelated category page.
6. Street address and coordinate qualifier are non-empty for every row intended for the map. Coordinate labels are only `osm_verified`, `osm_address_verified`, `osm_approximate`, or `needs_review`; `needs_review` rows are excluded from the public map seed.
7. Each row has a record-level source, an import provenance link, and a deterministic migration identifier.
8. The generated report states source-entry, canonical-venue, award, official-record, location-verified, coordinate-qualified, excluded, and unresolved counts. It must state that the cohort is selective, not an exhaustive San Francisco guide.

## 8. Manual verification procedure

Perform this immediately before data capture, without scraping:

1. Open the dated [California 2026 announcement](https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california). Confirm the 24 June 2026 publication date and that it is the California 2026 selection.
2. Open the [all-starred city page](https://guide.michelin.com/us/en/california/san-francisco/restaurants/all-starred). Use it only to find records and to confirm that nearby cities are excluded from the municipal scope.
3. Open each of the ten Section 3 MICHELIN URLs. Confirm source spelling, the `San Francisco, CA, USA` locality, 2026 edition, and two- or three-star distinction. Record the final access date.
4. Open the linked operator site for each accepted entry. Confirm the currently operating restaurant and address. Retain only the minimal address fact and URL; do not copy its menus, editorial copy, imagery, or branding.
5. Validate a location only if there is a reproducible named-place or address-level geospatial basis. Document the exact qualifier. Otherwise leave it unresolved and exclude the row from the public map migration.
6. Run the validator, inspect every exception, regenerate the committed report, and only then create the later timestamped idempotent migration.

## 9. Update cadence, corrections, and coverage limits

- Recheck the governing MICHELIN announcement and every individual URL when a new California edition is officially published, before a seed refresh, and at least annually while the cohort is presented as current.
- Re-review immediately after a source correction, a venue closure/relocation/rename, record removal, operator correction/removal request, or conflicting first-party location evidence.
- Retain a factual correction note and the old source URL when necessary for auditability, but do not retain copied source content or removed imagery.
- The launch cohort covers only 2026 two- and three-star restaurants that pass the defined municipal, award, and location checks. It is **not** the complete MICHELIN San Francisco selection, a complete San Francisco dining guide, or an assertion about restaurants omitted from the list.
- No data-rights clearance, endorsement, sponsorship, or partnership is implied by this plan. The factual-use and no-copy limits in Section 4 remain in force unless a written licence says otherwise.

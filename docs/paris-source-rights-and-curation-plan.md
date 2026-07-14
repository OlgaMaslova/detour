# Paris source-rights and curation plan

**Purpose.** This is the governing research and ingestion plan for a small,
verifiable Paris launch cohort. It authorizes a limited set of attributed
factual claims; it is **not** a restaurant directory, a reproduction of a
guide, a licence analysis, or a claim of affiliation with any source.

**Research date:** 2026-07-14  
**Launch geography:** the administrative City of Paris only (`city = Paris`,
`country = France`). “Paris and surroundings”, Île-de-France, Hauts-de-Seine,
and other suburbs do not qualify without a separately approved expansion.

## 1. Decision: a deliberately narrow launch cohort

The approved first cohort is the **29 City-of-Paris restaurants shown on the
official 2026 MICHELIN Guide Paris 3-Star and 2-Star category pages** on the
research date:

- **9 three-star restaurants** from the official 3-Star page.
- **20 two-star restaurants** from the official 2-Star page.
- **Excluded:** `Le Corot`, because the same 2-Star page identifies it as
  Ville-d'Avray, France rather than Paris. It must not enter the Paris import.
- **Not yet included:** any one-star, Bib Gourmand, Selected, hotel, bar, or
  unstarred venue. Those sources can be studied in a later, separately
  approved cohort; absence is not a quality judgement.

This yields a premium, bounded launch that can be checked manually, avoids
claiming the page's broader “Paris and surroundings” result set as the city,
and does not require bulk collection.

### 1.1 Exact approved candidate roster

Use the source spelling below in `source_venue_name`; retain it even when a
canonical name is normalized separately.

**3 Stars (9)**

1. Le Gabriel - La Réserve Paris
2. Épicure
3. Kei
4. Plénitude - Cheval Blanc Paris
5. Le Cinq
6. Pierre Gagnaire
7. Arpège
8. Alléno Paris au Pavillon Ledoyen
9. Le Pré Catelan

**2 Stars (20)**

1. La Scène
2. L'Oiseau Blanc
3. Le Grand Restaurant - Jean-François Piège
4. Restaurant Le Meurice Alain Ducasse
5. Maison Rostang
6. Le Taillevent
7. Alliance
8. Marsan par Hélène Darroze
9. Le Clarence
10. David Toutain
11. Blanc
12. Hakuba
13. L'Abysse Paris
14. L'Orangerie
15. Guy Savoy
16. Table - Bruno Verjus
17. L'Ambroisie
18. Le Jules Verne
19. Virtus
20. Sushi Yoshinaga

A dataset worker must re-open both source pages immediately before importing.
A record remains `pending` rather than silently carried forward if its name,
city label, or distinction differs from this plan.

## 2. Approved source surfaces

### 2.1 Governing award and category evidence — approved

All primary award facts come from these first-party MICHELIN Guide pages:

1. **Paris 3 Stars MICHELIN Restaurants**  
   <https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/3-stars-michelin>
   - Manual review on 2026-07-14 showed 9 results, each labelled Paris,
     France.
   - It establishes the source spelling, Paris locality, and 3-Star
     distinction for the approved 3-Star roster.

2. **Paris 2 Stars MICHELIN Restaurants**  
   <https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/2-stars-michelin>
   - Manual review on 2026-07-14 showed 21 results. Twenty were labelled
     Paris, France; `Le Corot` was labelled Ville-d'Avray, France and is
     excluded by the city rule.
   - It establishes the source spelling, displayed locality, and 2-Star
     distinction for the approved 2-Star roster.

3. **Every MICHELIN-Starred Restaurant in France for 2026 and the Year's Key
   Trends** (published 2026-03-17)  
   <https://guide.michelin.com/kr/en/article/news-and-views/michelin-star-restaurants-france-full-list>
   - The official announcement says the latest France selection was revealed
     on 2026-03-16 and covers 668 starred restaurants.
   - It is the edition-level corroboration for `guide_year = 2026`; it is not
     a substitute for the city/category pages as the per-entry evidence.

The category pages are dynamic pages, so their URL alone is not a permanent
snapshot. Record the access date and the exact displayed values on every
source entry. Do not scrape a hidden API, app traffic, search index, or an
undocumented map endpoint.

### 2.2 Optional secondary source — assessed, not approved for this launch

**The World's 50 Best Restaurants** has a first-party list and record pages
that support limited record-level verification, for example:

- official list: <https://www.theworlds50best.com/restaurants/best-in-the-world/list/1-50>
- Table by Bruno Verjus: <https://www.theworlds50best.com/restaurants/best-in-the-world/the-list/table-by-bruno-verjus.html>
- Septime: <https://www.theworlds50best.com/restaurants/best-in-the-world/the-list/septime.html>

The 2025 record pages identify Table by Bruno Verjus (No. 8) and Septime
(No. 40) as Paris venues and display contact information. The official list
also shows Paris placements including Table, Plénitude, Septime, and Arpège.

**Decision:** do not import 50 Best data in the first Paris seed. Its awards
would introduce a second ranking model, overlap directly with three MICHELIN
cohort records, and its profile pages are editorially dense. A future,
separate source review may authorize only `venue name`, `city`, `edition`,
`rank`, official URLs, access date, and verification status after confirming
the then-current edition and terms. It must not copy profile prose, images,
contact details, awards copy, or presentation assets.

### 2.3 Venue-owned pages — limited supporting use

A restaurant's own official website may support a separate `official_url` or
street-address claim only when the page is clearly controlled by that venue or
its hotel/operator, is recorded per venue, and is manually checked. It does
**not** establish a MICHELIN award. Do not infer an official website from a
search result, directory, social profile, booking service, or a matching
brand name.

## 3. Rights, attribution, and no-copy boundary

The MICHELIN Guide terms reserve copyright, database, trademark, and other
proprietary rights. See: <https://guide.michelin.com/us/en/terms-of-use>.
No reuse licence is claimed or implied by this plan.

### 3.1 Permitted minimal factual record

For each approved source assertion, retain only the following fields needed
for matching, verification, and public provenance:

- source venue name and Detour canonical venue name;
- `city = Paris`, `country = France`, and the source's displayed city;
- distinction (`3 Stars` or `2 Stars`) and `guide_year = 2026`;
- canonical first-party category URL, source type, source access date, and
  edition-announcement URL;
- import key, source-record identifier, verification status, and a concise
  factual verification note;
- a separately sourced venue-owned official URL or street address only if its
  own provenance fields are completed;
- independently sourced coordinates only with their own source, licence/
  attribution treatment, and confidence status.

Display a compact source attribution with a link to the official MICHELIN
page. The attribution must identify the source, but never suggest that
MICHELIN endorses, sponsors, or partners with Detour.

### 3.2 Prohibited source use

Do **not** copy, store, train on, or republish from the MICHELIN Guide or
other source pages:

- inspector/editorial descriptions, reviews, quotations, cuisine descriptions,
  tasting notes, menus, prices, service claims, or evaluative copy;
- photos, logos, badges, icons, page layouts, map tiles, typography, video,
  screenshots, or page scans;
- source HTML, API responses, bulk text, a cached/mirrored catalogue, or
  content gathered through automated bulk scraping;
- booking, account, user, or other non-public data;
- an inferred address, coordinates, opening information, contact number, or
  category presented as if it came from MICHELIN;
- a claim of completeness for Paris, France, Europe, or a guide edition.

Names, locality, distinction, and year remain limited factual claims with
source links. This does not resolve copyright, database-right, trademark,
contract, or other rights in the source compilation. If terms change, a venue
or rightsholder objects, or a claim cannot be re-verified, stop using the
affected content pending review.

## 4. Required provenance and import specification

The Paris worker should follow the existing multi-source model rather than
create a parallel schema. One source guide, three source records, one import
record, 29 canonical venues as needed, 29 award records, and 29 raw source
entries are expected before any later deduplication with other Paris sources.

### 4.1 Source registry records

Create or reuse these source records. `source_url` must be HTTPS and
first-party.

```text
source.slug: michelin-guide
source.name: MICHELIN Guide
source.current_year: 2026

source_record keys:
  michelin-2026-paris-3-stars-category
    source_type: official-category-listing
    url: https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/3-stars-michelin
    accessed_at: 2026-07-14 (replace with import-day date on data creation)
  michelin-2026-paris-2-stars-category
    source_type: official-category-listing
    url: https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/2-stars-michelin
    accessed_at: 2026-07-14 (replace with import-day date on data creation)
  michelin-2026-france-starred-announcement
    source_type: official-edition-announcement
    url: https://guide.michelin.com/kr/en/article/news-and-views/michelin-star-restaurants-france-full-list
    published_or_updated_at: 2026-03-17
    accessed_at: 2026-07-14 (replace with import-day date on data creation)

import_key: michelin-2026-paris-two-and-three-starred
expected_source_entry_count: 29
expected_award_count: 29
```

The edition-announcement record corroborates the year. The category source
record is the exact evidence linked from every corresponding award and source
entry. Do not manufacture per-restaurant MICHELIN profile URLs; add one only
when it is manually verified as the exact official profile for that restaurant.

### 4.2 Required row fields

A normalized input CSV should contain at least:

```text
source_venue_name
canonical_venue_name
city
country
distinction
guide_year
source_url
source_record_key
source_type
edition_announcement_url
source_accessed_at
source_published_or_updated_at
verification_status
verification_note
venue_official_url
venue_official_url_source
street_address
address_source_url
lat
lng
coordinate_source
coordinate_validation_status
```

Initial values that have not been independently supported must be blank, not
invented. In particular, `venue_official_url`, `street_address`, `lat`, and
`lng` are blank in the first award import unless their distinct provenance
fields are valid. Use a true null/blank value, never a `0,0` sentinel.

Set `verification_status = verified` only after the worker confirms all of the
following on the import date:

1. the source name is displayed on the expected official category page;
2. the category page labels the venue Paris, France;
3. the displayed distinction matches `2 Stars` or `3 Stars`;
4. the France 2026 announcement still supports `guide_year = 2026`;
5. the source and access URLs are first-party HTTPS URLs.

Otherwise use `needs_review`, explain the failed condition in
`verification_note`, and do not make that record publicly discoverable as a
verified award.

### 4.3 Validation rules

The deterministic validator for the later seed must fail when any condition
below is false:

- exactly 29 input rows: 9 `3 Stars` and 20 `2 Stars`;
- every source name is in the approved roster exactly once;
- `Le Corot` and all non-Paris city values are absent;
- all `city` values equal `Paris`, all `country` values equal `France`, and all
  `guide_year` values equal `2026`;
- every row references one of the two category source records and has a
  first-party `guide.michelin.com` HTTPS source URL;
- each row has an import date, a non-empty factual verification note, and
  `verification_status = verified`;
- no source editorial material, image URL, rank, copied description, or
  unverified address/coordinate is included;
- generated counts for source entries, canonical venues before dedupe,
  awards, locations with verified coordinates, and unresolved locations are
  reported separately;
- raw source entries and awards are unique on source + source name + guide
  year + distinction; canonical merge decisions never alter raw provenance.

The generated coverage report must label the result as **“29 verified
MICHELIN 2026 two- and three-star source entries in the City of Paris”**. It
must not call it the complete Paris MICHELIN selection.

## 5. Matching, deduplication, and location policy

### 5.1 Canonical venue matching

- First create source entries without modifying their source spelling.
- Auto-merge only on the normalized exact full name + city + country key:
  lowercase, Unicode-normalized/diacritics-folded, punctuation-normalized,
  whitespace collapsed. Preserve the original spelling on each source entry.
- A venue-owned official site or independently verified exact street address
  may corroborate an exact match, but does not make a fuzzy match safe.
- Do not fuzzy-match, prefix-match, or merge on chef, hotel, neighbourhood,
  cuisine, or substring alone.
- Names with hotel/operator qualifiers require special review. Examples:
  `Plénitude - Cheval Blanc Paris`, `Le Gabriel - La Réserve Paris`,
  `Table - Bruno Verjus`, and `Restaurant Le Meurice Alain Ducasse` must not
  be shortened and merged with another record on assumption.
- Maintain a match-exception report for every rejected near-match or manual
  decision. Never drop the raw source entry when a canonical match is unclear.

### 5.2 Address and coordinates

MICHELIN award evidence is not address or coordinate evidence for this plan.
Use the following sequence:

1. award import with address and coordinates blank;
2. separately verify a venue-owned page for street address where practical;
3. conduct a separately logged, licence-aware coordinate check only after an
   address is supported;
4. store `coordinate_source` and a status such as `verified`, `approximate`,
   or `needs_review`;
5. do not place a venue on a precision map until its location quality supports
   that presentation. A missing location remains an unresolved record, not a
   guessed pin.

If OpenStreetMap data is later used, preserve the required attribution and
licence treatment in the data/provenance documentation. Do not imply that
MICHELIN supplied the location.

## 6. Refresh, corrections, and removal

- Recheck both category pages and the France edition announcement immediately
  before initial import, at each France guide release, and before a public
  refresh. The 2026 announcement was published 2026-03-17 after the selection
  was revealed 2026-03-16; no later edition is assumed until officially
  published.
- Trigger an immediate targeted review when an official page changes, a venue
  closes, renames, relocates, or corrects a claim, a source/rightsholder
  objects, or a user reports an inaccurate listing.
- On a credible correction request, mark affected awards/source entries
  `needs_review`, remove disputed nonessential enrichment from public display,
  and re-check the official source. Remove a public award assertion if it
  cannot be re-verified.
- Retain the minimal provenance event and correction note needed for audit;
  do not keep copied source bodies, screenshots, or cached pages as a
  workaround for a takedown request.
- Keep every import a point-in-time, attributed selection. A later edition is
  a new source event, not an overwrite that erases the prior verification
  trail.

## 7. Known limits and handoff

- The current category pages use the phrase “Paris and surroundings”; the
  plan's City-of-Paris rule is intentionally stricter and excludes
  Ville-d'Avray.
- The plan establishes 29 verified source entries, not a complete count of all
  Paris starred restaurants, all MICHELIN categories, or Paris fine dining.
- It contains no imported addresses or coordinates. Mapping readiness requires
  the follow-on, separately attributed location-validation work.
- 50 Best has credible record-level official pages but is deliberately deferred
  to avoid conflating rankings with the first award cohort and to avoid
  carrying editorial material.
- This is a conservative operational policy, not legal advice or a rights
  clearance. Escalate a material terms, permission, or rights question before
  expanding source use.

# Madrid Bars & Hotels — Source Policy and Verification (The World's 50 Best Bars, The World's 50 Best Hotels)

- **Date:** 2026-07-14 (facts as of this access date)
- **Scope:** Source-policy/research document only. Defines governing editions, Madrid qualification rules, candidate rows, rights-conscious provenance, dedupe handoff, update cadence, and a reproducible verification method for two external sources. No product code, data, migration, frontend, package-script, or validation changes are made by this document.

## 1. Edition selection semantics

Rule: for each source, the governing edition is the most recent **officially published** award set capable of containing Madrid venues. Future (announced-but-unpublished) editions are never used; historic editions may only corroborate, never govern.

- Governing edition for **both** sources is **2025** — status `current`. No 2026 edition of either list is published as of 2026-07-14; a 2026 edition must not be inferred or created, and 2026 results supersede 2025 only once officially published.
- Official canonical list entry points redirect to:
  - Bars: https://www.theworlds50best.com/bars/best-in-the-world/list/1-50
  - Hotels: https://www.theworlds50best.com/hotels/best-in-the-world/list/1-50
- The official list UI exposes **1–50** and **51–100** tabs. The current published **1–100 result surface is in scope**, tracked with a field `list_segment` valued `1-50` or `51-100`.
- Segment nuance: positions 51–100 are **not** part of the titled top-50 award; they are the **official extended list** published by the same organization. Never describe a 51–100 entry as "World's 50 Best" placement.
- The official Hotels about page confirms the third Hotels edition was revealed 2025-10-30: https://www.theworlds50best.com/hotels/best-in-the-world/about-us.html
- Official 51–100 hotels publication confirming the extended 2025 list: https://www.theworlds50best.com/stories/News/the-worlds-50-best-hotels-2025-the-51-100-list.html

### 1.1 Methodology (cited, not reproduced)

- Bars voting system: https://www.theworlds50best.com/bars/best-in-the-world/voting/the-voting-system — global expert academy; voters vote from experiences in the prior 18 months.
- Hotels voting: https://www.theworlds50best.com/hotels/best-in-the-world/how-the-voting-works.html — global academy; voters require visits/stays during the prior 36 months.
- These lists are **voting-based snapshots**, not exhaustive Madrid directories; absence implies nothing about a venue's quality. Cite the official methodology pages; do not reproduce lengthy source text.

## 2. Madrid qualification rule

A candidate qualifies as Madrid only if:

1. The exact city string `Madrid` appears in the **current official ranking display** or the **official current venue record** of the governing edition.
2. City means the **City of Madrid** — not metro area, Comunidad de Madrid, or region.
3. The entry is a **physical, fixed venue** (no pop-ups, no brands without a fixed address).

Excluded: all non-Madrid entries; historic lists; future/unpublished 2026 editions; individual awards absent an independently qualifying ranking; temporary or closed venues; ambiguous branches until manual verification.

Category note: the named hotels physically contain bars and restaurants, but this policy tracks the **listed property as a distinct hotel venue**. Bar and hotel candidates are distinct categories and must **not** be merged across types.

## 3. Candidate rows (facts as of 2026-07-14)

Expected candidates: **2 bars + 2 hotels**, all in the 2025 global published lists.

### 3.1 Bars — The World's 50 Best Bars 2025

- **Salmon Guru** — Madrid, Spain; rank **37**; segment `1-50`.
  - Official list: https://www.theworlds50best.com/bars/best-in-the-world/list/1-50
  - Official venue profile: https://www.theworlds50best.com/bars/best-in-the-world/the-list/salmon-guru.html (gives its Madrid contact address)
- **Angelita** — Madrid, Spain; rank **51**; segment `51-100` (official extended list, not the titled top-50 award).
  - Official list evidence: https://www.theworlds50best.com/bars/best-in-the-world/list/1-50 (51–100 tab)
  - No verified official 2025 profile URL has been established; retain the ranking URL as source evidence and set `record_url` **null/pending** rather than guessing a path.

### 3.2 Hotels — The World's 50 Best Hotels 2025

- **Four Seasons Madrid** — Madrid, Spain; rank **66**; segment `51-100`.
- **Mandarin Oriental Ritz Madrid** — Madrid, Spain; rank **71**; segment `51-100`.
- Official list evidence for both: https://www.theworlds50best.com/hotels/best-in-the-world/list/1-50 and https://www.theworlds50best.com/hotels/best-in-the-world/list/51-100
- Official 51–100 publication: https://www.theworlds50best.com/stories/News/the-worlds-50-best-hotels-2025-the-51-100-list.html
- No official profile URLs verified for either hotel; use the official list/publication as evidence and record `record_url` **null/pending**.

## 4. Allowed minimal stored fields

Small, manual capture of minimal facts only:

- source slug/name
- venue name (source spelling), city/country
- rank and `list_segment`
- edition year and edition status
- official list/source/record URLs
- accessed date
- capture method
- review status
- minimal verification note

Address and coordinates must be **independently sourced and attributed** with their own source and validation status; they are never taken from copied editorial content, and 50 Best pages provide no basis to infer exact address/coordinates absent an explicit official record.

## 5. Rights and provenance

- **Prohibited:** copying editorial prose, images, logos, reviews, ratings badges, or venue profiles; bulk scraping or republication of source sites.
- **No reuse licence is assumed** for any source content.
- Store **links and facts only** (names, ranks, segments, city, official URLs).
- Attribute each fact to its source with the official URL.
- Correction/removal procedure: on request from a source or venue, or on discovery of an error, correct or remove the affected row promptly and record the change in the verification note.

### Import-provenance schema

```
provenance:
  source_slug: string            # e.g. w50-best-bars, w50-best-hotels
  list_name: string              # e.g. "The World's 50 Best Bars 2025"
  edition_year: int              # 2025
  edition_status: current | future | historic
  rank: int
  list_segment: "1-50" | "51-100"
  official_list_url: url         # canonical list entry point
  record_url: url | null         # official venue record if verified; null/pending otherwise
  accessed_date: date            # YYYY-MM-DD
  capture_method: manual         # manual URL check for this policy
  review_status: pending | verified | corrected | removed
  verification_note: string      # minimal, factual
```

## 6. Deterministic dedupe handoff (deferred; no merges made here)

- **No canonical dedupe decisions are made now.**
- Later match key: **exact normalized full venue name + city + country** (lowercase, trim, collapse whitespace, strip diacritics), optionally corroborated by an independently sourced physical address.
- **Never fuzzy matching.**
- Manual review required for branches, brands, aliases/alternate display names, and closures.
- Distinct categories (bar vs hotel) are **not automatically merged**, even where a hotel physically contains a listed-style bar.

## 7. Update cadence and re-review triggers

- Check the official list pages at each edition release; revalidate all candidate info before any import.
- 2026 results supersede 2025 **only once officially published**.
- Re-review triggers: source correction/removal requests; venue closure, rename, or relocation; changes to the official source pages; publication of new official venue profiles (which may fill pending `record_url` values).

## 8. Reproducible verification method

Manual check of the official URLs (no scraping tooling). Note: the list UIs may render both segments on either tab — verify by **rank, city string, and list segment**, not by assuming URL isolation.

1. Open https://www.theworlds50best.com/bars/best-in-the-world/list/1-50 — confirm the current edition is 2025; confirm **Salmon Guru, Madrid, rank 37** (segment 1-50).
2. On the same list UI, open the 51–100 tab — confirm **Angelita, Madrid, rank 51** (segment 51-100, official extended list).
3. Open https://www.theworlds50best.com/bars/best-in-the-world/the-list/salmon-guru.html — confirm the official profile and its Madrid contact address.
4. Open https://www.theworlds50best.com/hotels/best-in-the-world/list/1-50 and https://www.theworlds50best.com/hotels/best-in-the-world/list/51-100 — confirm **Four Seasons Madrid, rank 66** and **Mandarin Oriental Ritz Madrid, rank 71**, both Madrid, segment 51-100.
5. Open https://www.theworlds50best.com/stories/News/the-worlds-50-best-hotels-2025-the-51-100-list.html — confirm the official extended 2025 hotels list, and https://www.theworlds50best.com/hotels/best-in-the-world/about-us.html — confirm the third edition revealed 2025-10-30.
6. Record the access date; keep any snapshots private, minimal, and for verification only — never republication.

**Fixed expected output:** 2/2 bar candidates and 2/2 hotel candidates; no ranks invented; city, rank, and segment verified from official pages. Independent address/coordinate corroboration happens only later and is kept clearly separate from the imported source facts.

## 9. Known limitations

- Absence from these lists does **not** mean a venue lacks quality; they are voting-based selection data, not directories.
- No exact address or coordinates can be inferred from 50 Best content absent an explicit official record; location data requires independent sourcing.
- 51–100 classification nuance: extended-list entries are official but not the titled top-50 award; the `list_segment` field preserves this distinction.
- **No claim of data-rights clearance is made**; Section 5 rules apply until any explicit permission exists.

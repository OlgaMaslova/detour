# Madrid Pizza & Coffee — Source Policy and Verification (50 Top Pizza, World's 100 Best Coffee Shops)

- **Date:** 2026-07-14 (facts as of this access date)
- **Scope:** Source-policy/research document only. Defines governing editions, Madrid qualification rules, candidate rows, rights-conscious provenance, dedupe rules, and a reproducible verification method for two external sources. No product code, data, or migration changes are made by this document.

## 1. Edition selection semantics

Rule: for each source, the governing edition is the most recent **officially published** award set capable of containing Madrid venues. Future (announced-but-unpublished) editions are never used; historic editions may only corroborate, never govern.

### 1.1 50 Top Pizza

- Governing edition: **50 Top Pizza Europa 2026** — status `current`.
- The 50 Top Pizza **World 2026** ceremony is scheduled for 8 September 2026 and has not been published as of 2026-07-14 — status `future`. The World 2026 list must not be inferred or created.
- **World 2025** (Baldoria #8, Fratelli Figurato #54) — status `historic`; corroboration only, not the governing current award set.
- Official URLs:
  - Ranking: https://www.50toppizza.it/50-top-pizza-europa-2026/
  - Announcement: https://www.50toppizza.it/50-top-pizza-europa-2026-napoli-on-the-road-in-london-is-the-best-pizzeria-in-europe-for-2026/
  - Guide home: https://www.50toppizza.it/
- The official 60-entry Europa 2026 ranking contains exactly **two** entries with city "Madrid, Spain": **Baldoria (rank 2)** and **Fratelli Figurato (rank 11)**.
- Per the official 50 Top Pizza page, the Europe Top 20 qualify for the World 100; ranks 2 and 11 therefore **qualify** but this implies **no** World placement or rank.
- This ranking is not a complete Madrid pizza directory; absence from it implies nothing.

### 1.2 The World's 100 Best Coffee Shops

- Governing edition: **World 2026** (second edition) — status `current`.
- Official URLs:
  - Global ranking: https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/
  - Official venue record: https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/
  - Home/method: https://theworlds100bestcoffeeshops.com/
  - Europe subset: https://theworlds100bestcoffeeshops.com/top-100-coffee-shops-europe/
- Global **#19 = Hola Coffee Lagasca, Spain** — the **only** Madrid entry in the current global top-100. Its official record identifies city Madrid and address `Calle Lagasca, 42, 28001, Madrid, Spain`, and links https://hola.coffee/. Do not copy the editorial description.
- The Europe subset page lists **"Hola Coffee Roastery" at #8**. This is a related, **non-governing regional display name**. It must **NOT** be auto-merged with the global record beyond identity validation; the global list and record govern.

## 2. Madrid qualification rule

A candidate qualifies as Madrid only if:

1. The explicit city string "Madrid" appears in the **official result row** or the **official venue record** of the governing edition.
2. City means the city of Madrid — **not** metro area, Comunidad de Madrid, or region.
3. The entry is a **physical venue** (no brands, roasteries-without-venue, pop-ups without a fixed address).

## 3. Candidate rows (facts as of 2026-07-14)

| Source | Edition/List | Source spelling | Madrid evidence | Award | Official ranking URL | Venue source URL | Inclusion |
|---|---|---|---|---|---|---|---|
| 50 Top Pizza | 50 Top Pizza Europa 2026 (current) | Baldoria | "Madrid, Spain" in official ranking entry | Rank 2 | https://www.50toppizza.it/50-top-pizza-europa-2026/ | | Include |
| 50 Top Pizza | 50 Top Pizza Europa 2026 (current) | Fratelli Figurato | "Madrid, Spain" in official ranking entry | Rank 11 | https://www.50toppizza.it/50-top-pizza-europa-2026/ | | Include |
| The World's 100 Best Coffee Shops | World 2026, global top-100 (current) | Hola Coffee Lagasca | Official record: city Madrid; address Calle Lagasca, 42, 28001, Madrid, Spain | Rank 19 (global) | https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/ | https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/ | Include |

Corroboration only (non-governing): World 2025 pizza (Baldoria #8, Fratelli Figurato #54); Europe coffee subset "Hola Coffee Roastery" #8.

## 4. Current baseline

Existing unified data contains only **Michelin** and **Repsol** sources. There is no overlap population for these new sources yet, so **dedupe is deferred**; this policy makes **no merge decisions**.

## 5. Allowed minimal stored fields

Exactly these fields may be stored per imported candidate:

- source slug/name
- list name
- edition/year
- rank or award
- source venue name (verbatim spelling)
- locality/country
- first-party source URLs
- accessed date
- source type
- review status
- minimal verification note

Additionally, kept **separate** from the imported row:

- address/location that is separately corroborated, with its **own source and validation status**
- canonical venue ID / match fields — populated **only after dedupe**, never at import.

## 6. Rights and provenance

- **Prohibited:** copying guide prose, images, logos, reviews, cuisine descriptions, scorecards; bulk copies of source sites.
- **No reuse licence is assumed** for any source content.
- Store **links and facts only** (names, ranks, city, official URLs).
- Attribute each fact to its source with the official URL.
- Correction/removal process: on request from a source or venue, or on discovery of an error, correct or remove the affected row promptly and record the change in the verification note.

### Import-provenance schema

Each imported row carries:

```
provenance:
  source_slug: string           # e.g. 50-top-pizza, w100-best-coffee-shops
  list_name: string             # e.g. "50 Top Pizza Europa 2026"
  edition_year: int
  edition_status: current | future | historic
  official_url: url             # ranking page
  record_url: url | null        # official venue record if any
  accessed_date: date           # YYYY-MM-DD
  capture_method: manual        # manual URL check for this policy
  review_status: pending | verified | corrected | removed
  verification_note: string     # minimal, factual
```

## 7. Deterministic dedupe rules (deferred; no merges made here)

- Match key: **normalized exact full venue name + city + country** (lowercase, trim, collapse whitespace, strip diacritics).
- A separately corroborated address may **corroborate** a match; it never creates one.
- **Never fuzzy matching.**
- Manual review required for: aliases/alternate display names (e.g. "Hola Coffee Roastery" vs "Hola Coffee Lagasca"), branches, moved venues, closed venues.
- **No merge decisions are made in this policy.**

## 8. Reproducible verification method

Manual check of the official URLs (no scraping tooling required):

1. Open https://www.50toppizza.it/50-top-pizza-europa-2026/ — confirm 60 entries; confirm exactly two "Madrid, Spain" entries: Baldoria rank 2, Fratelli Figurato rank 11 (verify city string and rank).
2. Open https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/ — confirm #19 Hola Coffee Lagasca, Spain, and that it is the only Madrid entry.
3. Open https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/ — confirm city Madrid and address `Calle Lagasca, 42, 28001, Madrid, Spain` (venue record required for the coffee candidate).
4. Record the access date; keep source snapshots responsibly (private, minimal, for verification only — not republication).

**Fixed expected output:** 2 pizza candidates + 1 coffee candidate; no ranks invented; city and rank verified from official pages. Independent address/coordinate corroboration happens only later and is kept clearly separate from the imported source facts.

## 9. Publication readiness and re-review triggers

Ready to publish when: all three candidate rows verified against official URLs, provenance fields complete, rights rules satisfied, and review status `verified`.

Re-review triggers:

- Publication of **50 Top Pizza World 2026** (ceremony 8 September 2026) — the governing pizza edition changes.
- Any new edition of The World's 100 Best Coffee Shops.
- Source corrections, venue closures/moves/renames, or removal requests.
- Introduction of dedupe against the Michelin/Repsol unified data (Section 7 then applies).

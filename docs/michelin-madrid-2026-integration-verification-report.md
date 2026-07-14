# Detour Madrid 2026 Michelin + Guía Repsol integration verification

**Verification status: PASS**

This report is the durable reconciliation record for Detour’s Madrid multi-source discovery release. It was independently checked on 2026-07-14 against the committed data artifacts, deterministic validation scripts, healthy live API, and the deployed browser experience.

## Release identity

- **Deployed experience:** <https://detour-app.supernaut.to>
- **Deployed application revision:** `65aafbdc5c64aee46812ba5b45783aeff5647ccc` — `feat(frontend): render one card per canonical venue with all guide awards`
- **Managed API checked:** <https://sn-pb-repo-1297566350-fd2610.fly.dev> (healthy during verification)
- **Guide year:** 2026
- **Geographic scope:** Madrid city, Spain

The application revision above is the exact committed frontend/data revision checked in production. This document is committed separately as the verification record, so its own Git revision is inspectable from repository history.

## Evidence index

### Michelin Guide dataset

- Machine-readable input: [`data/michelin-2026-madrid-city-starred.csv`](../data/michelin-2026-madrid-city-starred.csv)
- Deterministic QA result: [`docs/michelin-2026-madrid-starred-qa-report.md`](michelin-2026-madrid-starred-qa-report.md)
- Collection, provenance, rights, and refresh procedure: [`docs/michelin-2026-madrid-starred-source-rights-memo.md`](michelin-2026-madrid-starred-source-rights-memo.md)
- Validator: [`scripts/validate-michelin-2026-madrid-starred.mjs`](../scripts/validate-michelin-2026-madrid-starred.mjs)

The Michelin dataset contains **30 current 2026 Madrid-city starred restaurants**: 1 three-star, 6 two-star, and 23 one-star records, for 38 stars in total. Every record carries its official `guide.michelin.com` category-listing URL, guide year, distinction, normalized location fields, coordinate qualifiers, and validation status.

The collection method is rights-conscious and deliberately limited to factual award metadata. It does not copy Michelin editorial prose, descriptions, images, badges, cuisine text, ranking, or profile material. Official category listings are the award provenance; OpenStreetMap/Nominatim was used separately and conservatively for coordinate qualification.

The Michelin QA artifact records these coordinate results:

- 18 `osm_verified` named-venue coordinates.
- 9 `osm_address_verified` coordinates.
- 1 `osm_approximate` coordinate: RavioXO.
- 2 retained, unpinned `needs_review` records: OSA and Pabú.

It also records the two deliberate out-of-city exclusions from the official one-star Madrid-and-surroundings listing: Ancestral (Pozuelo de Alarcón) and Chirón (Valdemoro). Bib Gourmand and Selected categories are out of scope.

### Guía Repsol dataset

- Inputs: [`data/guia-repsol-2026-madrid-new-sol-cohort.csv`](../data/guia-repsol-2026-madrid-new-sol-cohort.csv) and [`data/guia-repsol-2026-madrid-continuing-sol-selection.csv`](../data/guia-repsol-2026-madrid-continuing-sol-selection.csv)
- Deterministic validation result: [`docs/guia-repsol-2026-madrid-seed-validation-report.md`](guia-repsol-2026-madrid-seed-validation-report.md)
- Scope and gap record: [`docs/guia-repsol-2026-madrid-seed-coverage-report.md`](guia-repsol-2026-madrid-seed-coverage-report.md)

The Repsol input is a verified selection of **20** Madrid-city 2026 Sol entries: 4 three-Sol, 5 two-Sol, and 11 one-Sol entries. It combines 10 new 2026 awardees and 10 continuing Sol holders verified in the official digital booklet.

This is intentionally **not** claimed to be the complete Madrid-city 2026 Sol catalogue. The governing coverage report records that no official Madrid-city total was established and that the 98-Sol public figure covers the broader Comunidad de Madrid.

## Unified venue and provenance reconciliation

- Deterministic builder: [`scripts/build-madrid-multi-source-venues.mjs`](../scripts/build-madrid-multi-source-venues.mjs)
- Deterministic validator: [`scripts/validate-madrid-multi-source-venues.mjs`](../scripts/validate-madrid-multi-source-venues.mjs)
- Canonical output: [`data/madrid-2026-unified-venues.json`](../data/madrid-2026-unified-venues.json)
- Deduplication report: [`docs/madrid-2026-multi-source-deduplication-report.md`](madrid-2026-multi-source-deduplication-report.md)
- Inspectable exceptions: [`data/madrid-2026-multi-source-match-exceptions.json`](../data/madrid-2026-multi-source-match-exceptions.json)

The deterministic pipeline produces the following reconciled result:

- **50 source distinction entries:** 20 Guía Repsol and 30 Michelin.
- **40 canonical Madrid venues.**
- **10 exact-normalized-full-name multi-source merges.**
- **10 Repsol-only venues.**
- **20 Michelin-only venues.**
- **0 silently resolved ambiguous matches.**

Each canonical venue preserves its source-specific distinctions, guide year, official source URL, source type, access date, validation status, validation evidence, and location provenance. The policy permits an automatic merge only when normalized full names are exactly equal and one-to-one across sources. No fuzzy, prefix, chef-name, or operator-name merge is allowed.

### Unresolved/rejected match record

There is one inspectable rejected near-candidate in the exceptions artifact:

- **Ramón Freixa Tradición** (Guía Repsol, 1 Sol) versus **Ramón Freixa Atelier** (Michelin Guide, two stars).

Both names share a chef-name prefix, but their identity-bearing suffixes differ. The record is deliberately rejected rather than merged. Ramón Freixa Tradición remains a Repsol-only canonical venue, while the exact-name Repsol and Michelin Ramón Freixa Atelier records form their own two-source venue. This is expected behavior, not an unreviewed ambiguity.

## Reproducible verification commands

The following commands were run from this repository on 2026-07-14 after `npm ci`. All exited with status 0.

```sh
npm run validate:madrid-seed
npm run validate:michelin-madrid
npm run validate:multi-source-madrid
npm run build
```

Results:

- `validate:madrid-seed`: PASS — 20 entries across two cohorts, with the required 4/5/11 three-/two-/one-Sol shape.
- `validate:michelin-madrid`: PASS — 30 records; star distribution 1/6/23; 38 stars; coordinate result 18 named-venue, 9 address-level, 1 approximate, 2 blank `needs_review`.
- `validate:multi-source-madrid`: PASS — all 27 checks passed; 50 source entries became 40 canonical venues with 10 exact-name merges. The rebuild was byte-identical and regenerated the canonical output, exception artifact, and deduplication report.
- `build`: PASS — `tsc --noEmit` passed and Vite produced the production frontend assets.

`package.json` does not define a separate automated unit/integration test script. The applicable deterministic validators plus the TypeScript production build are the automated checks for this release.

## Live data reconciliation

The managed API was healthy during this verification. Read-only live inspection returned:

- 2 `guide_sources`: Guía Repsol and Michelin Guide, both current year 2026.
- 7 `source_records`: four Repsol source surfaces and three Michelin star-category listings.
- 3 verified `import_provenance` records: two 10-entry Repsol inputs and the 30-entry Michelin input.
- 40 canonical `venues`.
- 50 current 2026 `venue_awards`.
- 50 current 2026 `venue_source_entries`.

These live counts agree with the generated source datasets and canonical deduplication output.

## Production browser verification

Browser smoke checks were performed against <https://detour-app.supernaut.to>, not a local preview.

### Desktop — 1440 × 1000

- The initial catalogue displayed 40 canonical venues and a working map.
- Selecting **Michelin Guide** reduced the result count to 30 venues. Shared venues remained visible under the Michelin filter without duplicating their canonical cards.
- Opening **Coque** showed both source-specific awards — **3 Soles · Guía Repsol 2026** and **2 Stars · Michelin Guide 2026** — with separate official source links in its detail panel.
- Text search for **DiverXO** reduced the list and map to one matching venue. Its card retained both source-specific awards.
- The Michelin-filtered map exposed venue pins and correctly warned that two venues were not pinned because their coordinates remain pending verification.
- Choosing **Use my location** in a browser session without an available location produced the expected Madrid-centered fallback message. The results and map remained usable.

### Mobile — 390 × 844

- The responsive layout displayed the header, filters, search, location control, list, and map without overflow or overlap.
- Selecting **Guía Repsol** reduced the result count to 20 venues, including shared venues with both award labels and Repsol-only venues such as Ramón Freixa Tradición.
- The mobile source-filtered map retained interactive venue pins.
- The unavailable-location flow again kept the map centered on Madrid and left the catalogue usable.

## Known limitations and maintenance notes

- Michelin coverage is a 2026-07-12 point-in-time capture of Madrid-city **starred** restaurants only. It can drift as guide pages change.
- No Michelin editorial content is reproduced. Expansion beyond this limited factual, attributed selection should obtain appropriate permissions and repeat the rights review.
- OSA and Pabú have no asserted map pin pending responsible coordinate evidence. RavioXO is explicitly marked as approximate.
- The 20-entry Guía Repsol set is a verified selection, not a complete Madrid-city Sol inventory. It must not be presented as the whole catalogue.
- The exact-name-only matching policy intentionally favors false negatives over unsafe merges. Any future possible match must remain inspectable until it has unambiguous identity evidence and an approved deterministic policy change.
- Source filters operate at the award level while the UI renders one card per canonical venue. Consequently, a shared venue can appear under either guide and retains every source-specific award in its card and detail view.

## Parent-goal criteria coverage

- **Verified Michelin dataset:** fulfilled by the CSV, official-source fields, guide-year/distinction fields, coordinate qualification, validator, QA report, and rights/ingestion memo linked above.
- **Reusable multi-source model:** fulfilled by canonical venue output, per-source distinction/provenance preservation, deterministic exact-name matching, and the machine-readable exception artifact.
- **Deployed discovery experience:** fulfilled by the production browser checks for both source filters, multi-source attribution, mapping, geolocation fallback, and search at the deployed URL.
- **Durable verification record:** fulfilled by this report together with the linked deterministic outputs and explicit deployed application revision.

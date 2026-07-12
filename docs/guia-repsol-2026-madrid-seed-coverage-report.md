# Coverage and gap report: Guía Repsol 2026 Madrid-city new-Sol cohort seed dataset

**Dataset:** `data/guia-repsol-2026-madrid-new-sol-cohort.csv`
**Dataset access/verification date:** 2026-07-12
**Governing policy:** `docs/guia-repsol-2026-madrid-source-rights-memo.md`

## Scope

This dataset covers **only the named cohort of new 2026 Guía Repsol Sol awardees whose locality is Madrid city**. It is **not** the complete 2026 Madrid-city Sol catalogue, and it must never be presented, cited, or reconciled as such. Continuing (carry-over) award holders are out of scope.

## Coverage summary

- **Total records:** 10
- **Per Sol level:** 3 Soles = 1; 2 Soles = 2; 1 Sol = 7
- **Verification status:** all 10 records are `verified` (name, 2026 edition, Sol level, and Madrid-city locality each supported by an official first-party surface)
- **Street addresses:** blank for all 10 records. Per the memo's provenance rules, a street address is a separate claim requiring record-specific corroboration (e.g. a cited first-party venue profile); no such corroboration was performed, so all address fields are intentionally empty rather than inferred.

## Sources used

All record evidence is first-party `guiarepsol.com`, accessed 2026-07-12:

| Source type | Surface |
| --- | --- |
| `award-level-page` (3 Soles) | https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevo-restaurante-3-soles-guia-repsol/ |
| `award-level-page` (2 Soles) | https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-2-soles-guia-repsol/ |
| `award-level-page` (1 Sol) | https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-un-sol-guia-repsol/ |
| `award-listing` (cross-check totals) | https://www.guiarepsol.com/es/soles-repsol/soles-2026/listado-de-nuevos-restaurantes-con-soles-guia-repsol/ |

Publisher date displayed on the award pages and listing: 2026-02-16. The digital booklet (https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf) is identified as an official complete-list surface but was **not** used as record evidence.

## Reconciliation against official totals

The official complete-new-awards listing reports **98 Soles in Comunidad de Madrid** (within a 2026 national universe of 808). This dataset's count of 10 **cannot be reconciled against that 98 figure as a citywide total**, for two reasons:

1. This dataset contains only the **new 2026 awardees located in Madrid city**, not the full award-holding population.
2. The official 98 figure spans the entire **autonomous community** (Comunidad de Madrid), not Madrid city, and may include **continuing award holders** from prior editions.

No official source reviewed provides a Madrid-city-only total, so no exact citywide reconciliation is currently possible.

## Concrete unresolved gaps

1. **No official Madrid-city full total:** no reviewed official surface states the total number of 2026 Sol-awarded venues in Madrid city, by level or in aggregate.
2. **Continuing award holders not enumerated:** the award-level pages cover new 2026 awards only; the carry-over population has not been enumerated.
3. **Booklet not transformed:** the official digital booklet has not been reviewed into a page-referenced Madrid-city enumeration.
4. **Addresses unverified:** all street-address fields are blank pending record-specific corroboration via cited first-party venue profiles.
5. **Licensing/terms unresolved:** no express reuse licence or legal-notice analysis has been established; use remains factual, minimal, attributed, and reversible per the memo.
6. **No Madrid-filtered official map/list:** no official 2026 Madrid-filtered map or list endpoint was used; no map-derived completeness is claimed.

## Content restrictions

No editorial prose, reviews, descriptions, images, or other presentation assets from the guide are included in this dataset or report. Any future expansion (additional venues, addresses, continuing award holders) requires per-record official evidence — a first-party canonical source URL, access date, source type, and verification status — as defined in the source-rights memo.

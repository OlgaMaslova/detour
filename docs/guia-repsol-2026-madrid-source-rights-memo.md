# Guía Repsol 2026 Madrid: official sources and rights-conscious seed-data policy

**Purpose.** This memo defines the evidence and handling rules for a small, normalized Detour seed dataset of **20 source-attributed facts** about Guía Repsol 2026 Sol-awarded venues in Madrid city — 10 newly awarded in 2026 (verified against the official award-level pages) and 10 continuing 2026 award holders selected from the official 2026 digital booklet. It is a conservative selection of attributed factual claims, **not a directory**, a licence analysis, a reproduction of the guide, or a substitute for the guide’s own site and app.

**Research access date:** 2026-07-12  
**Geographic terms:** “Madrid city” means venues whose locality is Madrid. “Comunidad de Madrid” means the autonomous community. The official regional total below must not be treated as a Madrid-city total.

## Official 2026 source surfaces consulted

All URLs in this section are first-party `guiarepsol.com` surfaces. The access date for each is 2026-07-12 unless stated otherwise.

1. **2026 Soles hub — [Soles Guía Repsol](https://www.guiarepsol.com/es/comer/soles-repsol/)**
   - The canonical entry point for the 2026 edition.
   - Links to the 2026 award material and the digital booklet.
   - States that the 2026 edition added 83 new Sol-awarded establishments: 3 at three Soles, 11 at two Soles, and 69 at one Sol.

2. **2026 complete-new-awards listing — [Listado completo de los nuevos Soles Guía Repsol 2026](https://www.guiarepsol.com/es/soles-repsol/soles-2026/listado-de-nuevos-restaurantes-con-soles-guia-repsol/)**
   - Dated by the publisher 2026-02-16.
   - The primary factual cross-check for the 2026 new-award cohort and the source of the national and regional totals cited below.
   - Reports a 2026 Soles universe of **808 restaurants**: 46 three-Sol, 173 two-Sol, and 589 one-Sol.
   - Reports **98 Soles in Comunidad de Madrid**. The page does not establish how many of those 98 are in Madrid city or enumerate every continuing 2026 award holder by municipality.

3. **Three-Sol 2026 award page — [Los nuevos restaurantes 3 Soles Guía Repsol 2026](https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevo-restaurante-3-soles-guia-repsol/)**
   - Dated by the publisher 2026-02-16.
   - Identifies Ramón Freixa Atelier as the Madrid member of the three new three-Sol establishments.
   - Use only for the venue name, locality, award level, edition, publication/update date, and its canonical citation. Do not copy the accompanying editorial profile or images.

4. **Two-Sol 2026 award page — [Los nuevos restaurantes 2 Soles Guía Repsol 2026](https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-2-soles-guia-repsol/)**
   - Dated by the publisher 2026-02-16.
   - Identifies Bascoat and Smoked Room as Madrid entries among the 11 new two-Sol establishments.
   - Use as an award-level and locality cross-check for those records; it is not a full Madrid catalogue.

5. **One-Sol 2026 award page — [Los nuevos restaurantes 1 Sol Guía Repsol 2026](https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-un-sol-guia-repsol/)**
   - Dated by the publisher 2026-02-16.
   - Contains a Comunidad de Madrid section naming seven new one-Sol establishments: Bancal, Desborre, EMi, Los 33, Otoro Jukusei, Ramón Freixa Tradición, and Trèsde, each shown with locality Madrid.
   - Use as an award-level and locality cross-check. Do not reproduce its descriptive text or presentation.

6. **Digital booklet — [Guía Repsol 2026 digital booklet (PDF)](https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf)**
   - Linked from the official 2026 hub as the booklet containing 2026 novelties and the complete Soles/Guía Repsol listing.
   - Used as the official source for the **10 continuing 2026 Madrid award holders** in `data/guia-repsol-2026-madrid-continuing-sol-selection.csv`: for each, the exact name, Sol level, and Madrid locality were checked in the booklet's printed listing pages 90–91 (access date 2026-07-12, `source_type` `digital-booklet`).
   - Retain only the URL and per-record factual checks derived during that documented review. Do not commit the PDF, extracted text, images, page scans, or a repackaged copy; none are retained in this repository.
   - The booklet was not exhaustively reconciled into a complete Madrid-city enumeration — only the 10 selected continuing records were checked. Any future broader extraction must be manual or otherwise authorized, must log page references, and must obey the rules below.

7. **Official venue profile surface — example: [Restaurante Bancal en Madrid](https://www.guiarepsol.com/es/fichas/restaurante/bancal-331533/)**
   - A first-party venue-page pattern that can provide a canonical venue URL and displayed locality/address where a future record needs a record-specific corroboration.
   - Each profile used must be recorded separately in the dataset; this example is not evidence for any venue other than Bancal.

### Map/listing surface status

No separate 2026 official Madrid map endpoint was identified and used in this research. Do not infer a map API, scrape app traffic, or treat general site search or third-party map pins as an official Guía Repsol award source. If an official, publicly accessible 2026 Madrid-filtered listing or map is later used, add its canonical URL, access date, filter state, and a rights review to this memo before relying on it.

## What Detour may retain in a first-pass factual seed

The intended use is a narrow factual index that sends people back to the official source. It is deliberately smaller than a reproduction of the guide.

Permitted first-pass fields, subject to the record-level provenance rule:

- normalized venue name;
- Sol level (`1`, `2`, or `3`) and guide year (`2026`);
- locality and, only where expressly displayed or independently corroborated, street address;
- official canonical source URL and source type;
- publisher date when displayed, Detour access date, and optional PDF page reference;
- verification status and a short factual verification note;
- Detour’s own normalized identifier and operational timestamps.

Coordinates, cuisine labels, opening information, contact details, or categories are **not** Guía Repsol-derived by default. A future record may include them only with an independently documented source and its own verification status. Do not silently turn an inferred location into an official address.

## Excluded material

Do not copy, store, train on, or republish from the guide:

- editorial descriptions, reviews, quotations, tasting notes, menus, prices, or evaluative prose;
- photographs, illustration, logos, page layouts, typography, icons, map tiles, or other presentation assets;
- bulk page text, the booklet PDF, screenshots, page scans, or a mirror/cache of the official catalogue;
- rankings or meanings beyond the displayed Sol level without a source-specific review;
- user-account, booking, app, or other non-public data.

Names, locality, award level, and year are treated here as factual claims for limited verification and attribution, **not** as a claim that the entire source database, compilation, or presentation is free of copyright, database, trademark, contract, or other restrictions. This memo does not grant a licence. Where terms, a takedown request, or a rights review conflicts with this policy, stop use of the affected data pending resolution.

## Record-level provenance and verification rules

Every seed row must carry enough evidence for an independent reviewer to re-check it without relying on memory:

1. `source_url` must be a first-party canonical Guía Repsol URL for that claim. Prefer the edition/award page plus a venue profile where needed; do not use a search-result URL as evidence.
2. Store `source_accessed_at` in ISO-8601 date form and preserve a `source_published_or_updated_at` value only when the source displays one.
3. Store `source_type` (for example `award-listing`, `award-level-page`, `digital-booklet`, or `venue-profile`) and a concise `verification_status`.
4. `verified` requires the name, 2026 year, Sol level, and Madrid/Madrid-city locality to be supported by an official surface. `partially_verified` identifies the missing field in `verification_note`. `unverified` records a lead only and must not be shown as a confirmed award.
5. Street address is a separate claim: leave it blank rather than guessing. If present, record which official profile or independent source corroborated it.
6. Preserve exact source spelling in an optional source-name field if normalization changes accents, punctuation, or spacing. Never overwrite the source form with an untraceable normalization.
7. Re-check records when the official edition changes, a source URL changes materially, a venue asks for a correction, or at least before a public data refresh. Retain the prior provenance event rather than changing a record without a trail.

## Correction, removal, and update policy

- Display the award with a visible link back to the official source and identify Guía Repsol as the source.
- Do not imply endorsement, affiliation, or ownership of Guía Repsol content.
- On a credible venue, rightsholder, or source-owner correction request, mark the affected record `needs_review` immediately and hide any disputed nonessential field while it is checked.
- Remove copied or disputed content promptly. For a disputed factual award claim, remove public presentation if it cannot be re-verified from an official source; retain only the minimum internal audit note necessary to avoid repeating the error.
- Do not retain snapshots or scraped source bodies as a workaround for a removal request.
- If official terms or a direct rights-holder instruction restrict this intended use, stop further ingestion and seek permission or a different, authorized data source before resuming.

## Coverage findings and unresolved gaps

### Evidence established

The seed now comprises **20 source-attributed 2026 Madrid-city records**, in two cohorts:

1. **New 2026 award cohort (10 venues)**, established by the official award-level pages: 1 new three-Sol, 2 new two-Sol, and 7 new one-Sol entries.
2. **Continuing 2026 selection (10 venues)**, verified against the official 2026 digital booklet (printed listing pages 90–91, accessed 2026-07-12): 3 three-Sol (Coque, DiverXO, DSTAgE), 3 two-Sol (Deessa, Saddle, Ugo Chan), and 4 one-Sol (A'Barra, Alabaster, Fismuler, La Catapa).

Combined breakdown: 4 three-Sol, 5 two-Sol, 11 one-Sol. This is a narrow, named, conservative selection of attributed facts — **not** the complete 2026 Madrid-city Sol catalogue and not a directory. No coordinates, addresses, categories, or venue URLs were independently verified for the continuing selection; those fields remain blank (with a neutral 0/0 coordinate sentinel where the schema requires a number, explicitly noted as unverified).

The official complete-new-awards listing reports **98 Soles for Comunidad de Madrid** — the autonomous community, not necessarily Madrid city — while the national 2026 total is 808. The 98 figure cannot reconcile a Madrid-city dataset because it includes the wider autonomous community and includes continuing award holders.

### Concrete unresolved gaps

1. **Madrid city total:** no official source reviewed here gives a Madrid-city total for all 2026 Sol-awarded venues, by level or in aggregate.
2. **Continuing award holders:** the award-level news pages enumerate new 2026 awards only. Ten continuing holders have now been individually verified against the booklet (pages 90–91), but the full carry-over population has not been reviewed into a complete, page-referenced Madrid-city enumeration; the remaining continuing holders are not represented in the seed.
3. **Municipality boundary:** a future dataset must declare whether it targets Madrid city or Comunidad de Madrid before comparing its count with the official regional total of 98.
4. **Addresses and venue profiles:** award announcements principally establish name, level, and locality. Missing or uncertain street addresses must remain blank or separately verified through a cited first-party profile.
5. **Terms/licensing:** no express reuse licence or current legal-notice analysis was established in this research. Until one is reviewed or permission is obtained, keep use factual, minimal, attributed, non-editorial, and reversible as described above.
6. **Official map/list endpoint:** no separately documented, 2026 Madrid-filtered official map/list endpoint was used. Do not claim map-derived completeness.

## Handoff to dataset work

The dataset deliverables are versioned separately from this memo (`data/guia-repsol-2026-madrid-new-sol-cohort.csv` and `data/guia-repsol-2026-madrid-continuing-sol-selection.csv`) and include each record's official source URL, access date, status, and verification note, with a joint validation report. Their combined scope must be described as **“20 source-attributed 2026 Madrid-city Sol facts (10 new-award cohort + 10 continuing selection)”** unless and until the full booklet/list has been manually and reproducibly reconciled. A count of 20 must never be labeled as the total number of Madrid-city Sol-awarded restaurants in the 2026 edition, and must never be compared directly against the Comunidad de Madrid total of 98.

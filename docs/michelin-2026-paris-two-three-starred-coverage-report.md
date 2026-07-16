# Coverage report — 2026 MICHELIN Guide Paris two- and three-star seed

**Status: PASS** — generated deterministically by `npm run validate:michelin-paris` from `data/michelin-2026-paris-two-three-starred.csv`.

## Verified coverage

**29 verified MICHELIN 2026 two- and three-star source entries in the City of Paris, each with independently reviewed location evidence.**

This is a bounded, attributed selection, not the complete Paris MICHELIN selection or a claim about other star categories.

- Source entries: 29
- Canonical venues before dedupe: 29
- Awards: 29
- 3-star entries: 9
- 2-star entries: 20
- Official source records: 3 (two category pages plus the France 2026 edition announcement)
- Locations with verified coordinates: 29
- Unresolved locations: 0

## Provenance and location limits

- Each award/source entry links to its exact official MICHELIN Paris category page and records the 2026-07-14 access date.
- The official France 2026 announcement, published 2026-03-17, corroborates the guide year for the cohort.
- Award provenance remains separate from location corroboration: official venue or MICHELIN individual-record pages support addresses, while coordinates come independently from OpenStreetMap/Nominatim.
- `osm_verified` identifies a named restaurant element (including the documented Pavillon Ledoyen venue identity for Alléno Paris).
- `osm_address_verified` identifies exact-address or documented host-premises geometry where no suitable named restaurant element exists; it is not an entrance or dining-room centroid claim.
- Side-street context, host-building relationships, and rejected duplicate or same-name candidates are documented per row in the verification note.
- Le Corot is excluded because its category-page locality is Ville-d'Avray, not Paris.

## Coordinate qualification

- osm_verified: 20
- osm_address_verified: 9

## Validation errors

None.

## Approved roster

### 3 Stars (9)

- Le Gabriel - La Réserve Paris
- Épicure
- Kei
- Plénitude - Cheval Blanc Paris
- Le Cinq
- Pierre Gagnaire
- Arpège
- Alléno Paris au Pavillon Ledoyen
- Le Pré Catelan

### 2 Stars (20)

- La Scène
- L'Oiseau Blanc
- Le Grand Restaurant - Jean-François Piège
- Restaurant Le Meurice Alain Ducasse
- Maison Rostang
- Le Taillevent
- Alliance
- Marsan par Hélène Darroze
- Le Clarence
- David Toutain
- Blanc
- Hakuba
- L'Abysse Paris
- L'Orangerie
- Guy Savoy
- Table - Bruno Verjus
- L'Ambroisie
- Le Jules Verne
- Virtus
- Sushi Yoshinaga

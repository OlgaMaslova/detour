# Production verification — Pizza and Coffee expansion (Madrid, 2026)

**Status: PASS**

- **Public app:** https://detour-app.supernaut.to
- **Frontend deployment:** `client-detour-app`, deployed from `supernaut/managed-app` at `24cfc2cd0a7c2cce15ae3817e13877541345b2b0`.
- **Backend deployment:** `https://sn-pb-repo-1297566350-fd2610.fly.dev`, healthy after managed redeploy of `24cfc2cd0a7c2cce15ae3817e13877541345b2b0`.
- **Backend image:** `registry.fly.io/sn-pb-repo-1297566350-fd2610:pb-5195a7f4-101f-4d9a-a068-55c49f6e322a-rev-24cfc2cd0a7c-5f16ad`.
- **Verification date:** 2026-07-14.

## Live database verification

The deployed migration `pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js` was verified on the live persistent data volume.

| Collection | Live count | Change from prior Michelin/Repsol baseline |
| --- | ---: | ---: |
| `guide_sources` | 4 | +2 (50 Top Pizza; The World's 100 Best Coffee Shops) |
| `source_records` | 10 | +3 (pizza ranking, coffee ranking, coffee venue record) |
| `import_provenance` | 5 | +2 (pizza and coffee imports) |
| `venues` | 43 | +3 canonical Madrid venues |
| `venue_awards` | 53 | +3 current 2026 ranking awards |
| `venue_source_entries` | 53 | +3 lossless guide assertions |

The three Pizza/Coffee canonical venue records are all public-read, city `Madrid`, country `Spain`, and have non-empty OSM-qualified coordinates:

- **Baldoria** — `Pizza`, `40.4294985, -3.6707425`; 50 Top Pizza Europa 2026, **No. 2**.
- **Fratelli Figurato** — `Pizza`, `40.4389910, -3.6978429`; 50 Top Pizza Europa 2026, **No. 11**.
- **Hola Coffee Lagasca** — `Coffee`, `40.4248823, -3.6853284`; The World's 100 Best Coffee Shops 2026, **No. 19**.

Each live award is `year=2026`, `current=true`, and `verification_status=verified`. Its live `source_url`, rank, source record, and import relation match the verified datasets. The raw source-entry records preserve `source_edition` and numeric `source_rank`; the coffee source assertion points to the official Hola Coffee Lagasca venue record while its award points to the official global ranking.

A public, unauthenticated live API read for `Pizza` or `Coffee` returned exactly these three rows with their coordinates. This confirms the real client read path, not only privileged data inspection.

## Deduplication

The existing multi-source baseline contained 40 canonical venues, 50 awards, and 50 source assertions. The Pizza/Coffee import creates exactly three new canonical venue IDs:

- `venuepizza00001` — Baldoria
- `venuepizza00002` — Fratelli Figurato
- `venuecoffee0001` — Hola Coffee Lagasca

The authoritative dataset-level exact normalized full-name comparison found no match for any of the three against the original 40 canonical venues. No fuzzy, prefix, or location-based auto-merge was performed. Therefore there are no Pizza/Coffee merge exceptions and no duplicate map markers introduced by this release. Existing Michelin/Repsol shared venues remain represented by a single canonical marker with multiple awards.

## Production browser checks

Checks were completed on https://detour-app.supernaut.to after both deployments.

### Desktop (1440 × 960)

- Initial render completed with **43 venues**, all four guide-source controls, Pizza/Coffee category controls, map pins, and list results.
- `Pizza` category returned exactly **2** entries and pins: Baldoria (No. 2) and Fratelli Figurato (No. 11).
- Composing `Pizza` with `50 Top Pizza` retained the same two entries and two pins.
- Opening Baldoria displayed its selected-venue detail view, category, address, rank/edition, evidence, and official-listing link.
- `Coffee` category returned exactly **1** entry and pin: Hola Coffee Lagasca (No. 19).
- Composing `Coffee` with `The World's 100 Best Coffee Shops` retained that one entry and pin.
- Name search for `Baldoria` reduced both list and map to the one matching venue.
- The established `Michelin Guide` source filter still returned **30 venues** with map/list results and multi-award labels.
- Browser geolocation failure was handled safely: the app displayed the fallback notice and kept the map centered on Madrid without fabricating a user position.

### Mobile (390 × 844)

- The full filter set, result list, and interactive map rendered without a blank/error page.
- The `Pizza` category returned the two expected cards and two interactive pins with rank, edition, source, and official-listing links.
- Map zoom controls and list/map interaction controls remained available at the mobile viewport.

## Source-policy and rights compliance

This release follows `docs/2026-07-14-madrid-pizza-coffee-source-policy.md`.

- Governing editions are **50 Top Pizza Europa 2026** and **The World's 100 Best Coffee Shops 2026**.
- Only factual, minimum-necessary metadata is stored: identity, locality, category, ranking/edition, official URLs, factual verification notes, and independently verified coordinates.
- No source editorial prose, images, scores beyond rank, or copied directory/list content was imported.
- Pizza rank claims use the official 50 Top Pizza ranking page. Coffee rank claims use the official global ranking and venue locality uses the official Hola Coffee Lagasca record.
- Coordinates and branch/address corroboration are independently sourced from OSM/Nominatim evidence. Fratelli Figurato is explicitly represented as the independently corroborated primary pizzeria location; the official ranking does not claim a particular branch.

## Reproducible evidence

- Backend deployment completed healthy with the revision shown above.
- Frontend deployment mapped `detour-app.supernaut.to` to `client-detour-app` at the same revision.
- Live collection counts and filtered records were inspected after deployment.
- Public API query for Pizza/Coffee returned 3 rows.
- Interactive desktop and mobile browser checks above were executed against production.
- Deterministic validation re-run in this deployment check: `npm run validate:pizza-coffee-integration` — 84/84 checks.

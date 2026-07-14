# Integration validation report — 50 Top Pizza Europa 2026 + The World's 100 Best Coffee Shops 2026, Madrid

**Status: PASS** — generated deterministically by `npm run validate:pizza-coffee-integration`; output is byte-identical on every run (no generated-at timestamps).

Migration under validation: `pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js`. Inputs: `data/50-top-pizza-europa-2026-madrid.csv`, `data/worlds-100-best-coffee-shops-2026-madrid.csv`, `data/madrid-2026-unified-venues.json`.

## Errors

None.

## Planned integration rows

| Canonical venue | Category | Edition | Rank | Canonical id | Award level |
|---|---|---|---|---|---|
| Baldoria | Pizza | 50 Top Pizza Europa 2026 | 2 | `venuepizza00001` | 50 Top Pizza Europa 2026 — No. 2 |
| Fratelli Figurato | Pizza | 50 Top Pizza Europa 2026 | 11 | `venuepizza00002` | 50 Top Pizza Europa 2026 — No. 11 |
| Hola Coffee Lagasca | Coffee | The World's 100 Best Coffee Shops 2026 | 19 | `venuecoffee0001` | The World's 100 Best Coffee Shops 2026 — No. 19 |

- All three awards carry year 2026 and current=true; award source_url is the official ranking page; the raw source entry retains the source-side URL (coffee: the official venue-record page).
- Raw `venue_source_entries` rows carry source-side name, raw locality/country (Madrid/Spain), `source_edition`, and numeric `source_rank` (new fields added losslessly by the migration).
- Coordinates are OSM-sourced (independent of the guides), match the CSVs exactly, and lie inside Madrid-city bounds.

## No-merge decisions (vs 40 unified canonical venues)

- **Baldoria** (key `baldoria`): no_match — No existing canonical venue matches; a NEW canonical venue row is created (no merge, no duplicate). New canonical id: `venuepizza00001`.
- **Fratelli Figurato** (key `fratelli figurato`): no_match — No existing canonical venue matches; a NEW canonical venue row is created (no merge, no duplicate). New canonical id: `venuepizza00002`.
- **Hola Coffee Lagasca** (key `hola coffee lagasca`): no_match — No existing canonical venue matches; a NEW canonical venue row is created (no merge, no duplicate). New canonical id: `venuecoffee0001`.

## Checks

- 84/84 checks passed.
- Machine-readable artifact: `data/pizza-coffee-2026-madrid-integration.json`.

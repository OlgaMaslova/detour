# Detour backend — operator runbook

This repository is the Supernaut-managed PocketBase backend for Detour. It is
deployed from `supernaut/managed-app` (the Supernaut platform builds this repo
with `Dockerfile.supernaut-pocketbase` and runs it on Fly.io per `fly.toml`).
This README is an operator runbook, not user-facing copy.

## Durable managed API URL

The backend's durable API base URL is fixed by the managed Fly app name
(`fly.toml`: `app = "sn-pb-repo-1297566350-6aebd3"`) and is recorded in
`.env.example`:

```
https://sn-pb-repo-1297566350-6aebd3.fly.dev
```

Frontend/browser code must read it from `VITE_POCKETBASE_URL` (see
`.env.example`) rather than assuming same-origin. The frontend source lives in
`src/` (Vite + TypeScript) and is deployed separately as a Cloudflare static
Worker (built into `public/`, configured by `wrangler.toml`) — see
"Frontend: build, run, deploy" below.

No credentials live in this repository; superuser/admin access is managed by
the platform.

## Health and readiness endpoints

- `GET /api/health` — PocketBase's built-in health endpoint; also the Fly
  HTTP health check (`fly.toml`, 300s grace period so boot migrations are not
  interrupted).
- `GET /api/supernaut/ready` — custom readiness route in
  `pb_hooks/main.pb.js`; returns `{ "ok": true }` with HTTP 200.

```
curl -fsS https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/health
curl -fsS https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/supernaut/ready
```

## Repository layout

- `pb_migrations/` — schema migrations and the idempotent seed:
  `1767970000_create_food_discovery.js` (initial collections + new-Sol cohort
  seed), `1767971000_normalize_guia_repsol_2026_madrid_seed.js` (normalized
  source and import provenance, enrichment cleanup),
  `1767972000_add_guia_repsol_2026_madrid_continuing_cohort.js` (continuing
  Sol holders verified in the official 2026 booklet),
  `1767973000_verify_madrid_venue_coordinates.js` (verified coordinates), and
  `1767974000_add_michelin_2026_madrid_multi_source.js` (Michelin 2026 cohort
  and the multi-source `venue_source_entries` model).
- `pb_hooks/` — request-time hooks (readiness route).
- `pb_public/` — optional static fallback assets served by PocketBase.
- `src/`, `index.html`, `vite.config.ts`, `wrangler.toml` — the Vite frontend
  and its Cloudflare static Worker config (see "Frontend: build, run, deploy").
- `data/` — the three seed CSVs and the generated multi-source outputs (see
  selection scope below).
- `docs/` — validation report, coverage report, source-rights memo.
- `scripts/` — deterministic seed validator.
- Runtime data (`pb_data/`) lives on the persistent Fly volume and is never
  committed or replaced on redeploy.

## Seed dataset: Guía Repsol 2026 Madrid verified Sol selection

**Inputs (two CSVs):**

- `data/guia-repsol-2026-madrid-new-sol-cohort.csv` — the 10 named **new**
  2026 Sol awardees (Madrid city), sourced from first-party `guiarepsol.com`
  award-level pages.
- `data/guia-repsol-2026-madrid-continuing-sol-selection.csv` — 10
  **continuing** (carry-over) Madrid-city Sol holders, each verified against
  the official Guía Repsol 2026 digital booklet (`digital-booklet` source
  type; printed listing pages 90–91), which is their governing provenance.

**Exact scope — 20 verified venues:** the combined reference selection is

- 4 × 3 Soles
- 5 × 2 Soles
- 11 × 1 Sol

**Limitation:** this 20-venue set is a **verified selection**, not the
complete 2026 Madrid-city Sol catalogue, and must never be presented or
reconciled as such. The official figure of 98 Soles applies to the whole
Comunidad de Madrid, not Madrid city. See
`docs/guia-repsol-2026-madrid-seed-coverage-report.md` for the full gap list
and `docs/guia-repsol-2026-madrid-source-rights-memo.md` for the governing
evidence and rights policy (factual fields only; no editorial prose, images,
or bulk source copies).

Every CSV row (in both files) carries provenance columns: `source_url` (first-party
`guiarepsol.com` HTTPS), `source_type`, `source_published_or_updated_at`,
`source_accessed_at`, `verification_status`, and `verification_note`.
`street_address` is intentionally blank pending record-specific corroboration.

## Normalized collections and import provenance

The migrations in `pb_migrations/` (see "Repository layout") together create
**six** public-read (write-locked) collections and seed them. Current counts
after the multi-source migration
(`1767974000_add_michelin_2026_madrid_multi_source.js`):

- **`guide_sources`** — the guide registry: name, unique `slug`,
  `official_url`, `current_year`. **2 rows**: Guía Repsol
  (`slug = guia-repsol`, deterministic id `gsrepsol0000001`) and the Michelin
  Guide (`slug = michelin-guide`).
- **`source_records`** — record-level official source surfaces: relation to
  `source`, `title`, unique `url`, `source_type`, `published_or_updated_at`,
  `accessed_at`. **7 rows**: the 3 official 2026 Repsol award-level pages
  (3 Soles, 2 Soles, 1 Sol; `source_type = award-level-page`, deterministic
  ids `srcrec20260sol3` / `srcrec20260sol2` / `srcrec20260sol1`), the
  official 2026 Repsol digital booklet (`source_type = digital-booklet`,
  deterministic id `srcrec2026book1`, the governing source for the continuing
  cohort), and the 3 official 2026 `guide.michelin.com` per-star category
  listings.
- **`import_provenance`** — one row per seed import: unique `import_key`,
  `dataset`, `description`, `source` relation, `record_count`,
  `verification_status`, `imported_at`. **3 rows**, one per verified CSV
  import (`import_key = guia-repsol-2026-madrid-new-sol-cohort` and
  `import_key = guia-repsol-2026-madrid-continuing-sol-selection`, each
  `record_count = 10`, plus `import_key = michelin-2026-madrid-city-starred`,
  `record_count = 30`; all `verification_status = verified`).
- **`venues`** — normalized venue records: name, city, country, address,
  lat/lng, category, `official_url`, `coord_verification_note`. Unique on
  (name, city). **40 canonical venues**: the 20 Repsol selection venues
  (deterministic ids `venueseed000001`–`venueseed000020`) plus 20
  Michelin-only venues; 10 of the 30 Michelin entries merged into existing
  Repsol venues by **exact name only** (no fuzzy/prefix matching). Breakdown:
  10 exact-name shared venues, 10 Repsol-only, 20 Michelin-only.
- **`venue_awards`** — the award join: relations to `source` and `venue`,
  `year`, `level` (e.g. `1 Sol`, `2 Soles`, `3 Soles`), `source_url`,
  `current`, `verification_note`, plus provenance links added by the
  normalization migration: `source_record` (relation to the exact official
  award-level page in `source_records`), `import` (relation to the
  `import_provenance` row), and `verification_status`
  (`verified`/`unverified`). Unique on (source, venue, year, level).
  **50 rows**: 20 Repsol Sol awards (deterministic ids
  `awardseed000001`–`awardseed000020`) plus 30 Michelin star awards.
- **`venue_source_entries`** — the sixth collection: **raw, per-guide source
  assertions**, one row per guide entry exactly as the guide states it
  (source venue name, `distinction`/`distinction_level`, `guide_year`,
  source URL/type/dates, validation and coordinate qualifiers, match
  method/evidence), each linked to its canonical `venue`, `source`,
  `source_record`, and `import`. Unique on (source, source_venue_name,
  guide_year, distinction). **50 rows** (20 Repsol + 30 Michelin).

**All 50 awards link to these provenance records:** each `venue_awards` row
points at its exact official source (award-level page or booklet) via
`source_record` (and matching `source_url`) and at its verified CSV import
via `import`, with
`verification_status = verified` and `current = true`; any other 2026 Guía
Repsol award rows are demoted to `current = false`.

**Intentionally cleared unsupported enrichment:** the normalization migration
blanks fields the verified CSVs do not support on the seed venues —
`address`, `category`, and venue `official_url` are set to empty strings.
Coordinates are no longer left as an unverified sentinel: the 2026-07-12
migration `pb_migrations/1767973000_verify_madrid_venue_coordinates.js`
re-populates verified addresses and `lat`/`lng` for all 20 seed venues — see
"Coordinates and browser location policy" below.

All migrations use bulk `INSERT OR IGNORE` with fixed ids plus idempotent
UPDATEs, so re-running is a converging no-op — safe after partial failures,
no duplicates possible. The normalization migration is forward-only (no down
path).

All collections are list/view public and create/update/delete locked
(superuser only); imports happen exclusively via migrations.

## Dataset: 2026 Michelin Guide — Madrid-city starred restaurants

- `data/michelin-2026-madrid-city-starred.csv` — 30 Michelin-starred Madrid-city
  restaurants for guide year 2026 (1 × 3-star, 6 × 2-star, 23 × 1-star; 38 stars),
  sourced from the official `guide.michelin.com` per-star category listings
  (accessed 2026-07-12) with OSM/Nominatim-qualified coordinates where
  responsibly established: `osm_verified` (named OSM restaurant match),
  `osm_address_verified` (exact OSM address/building geometry, venue identity
  not necessarily tagged), `osm_approximate` (explicit approximation), and
  blank coordinates with `needs_review` where no responsible pin exists.
- `docs/michelin-2026-madrid-starred-source-rights-memo.md` — official source
  surfaces, collection procedure, no-copy/rights policy, scope/coverage counts,
  and known limitations.
- `docs/michelin-2026-madrid-starred-qa-report.md` — deterministic QA report,
  regenerated by `npm run validate:michelin-madrid`
  (`scripts/validate-michelin-2026-madrid-starred.mjs`, dependency-free;
  exits nonzero on FAIL).

## Dataset: 2026 MICHELIN Guide — Paris two- and three-star source entries

- `data/michelin-2026-paris-two-three-starred.csv` — a deliberately narrow 29-entry City-of-Paris import: 9 three-star and 20 two-star MICHELIN Guide 2026 source entries. Every row preserves its source spelling, links to one of the two official Paris category pages, records the 2026-07-14 access date, and is corroborated by the official France 2026 edition announcement.
- `docs/michelin-2026-paris-two-three-starred-coverage-report.md` — deterministic coverage report generated by `npm run validate:michelin-paris`.
- `pb_migrations/1767976000_add_michelin_2026_paris_two_three_starred.js` — later-timestamp, bulk, idempotent migration. It adds 29 Paris canonical venues, awards, and raw source entries; it creates or reuses the two category source records, France edition-announcement record, and one import-provenance record.

The CSV intentionally leaves venue-owned URLs, street addresses, and coordinates blank. The migration preserves that distinction: canonical and raw records use the existing `0/0` non-location sentinel with `not_provided` status, never as a map pin. This is **29 verified MICHELIN 2026 two- and three-star source entries in the City of Paris**, not the complete Paris MICHELIN selection. `Le Corot` remains excluded because its listed locality is Ville-d'Avray, not Paris.

## Dataset: 2026 Madrid unified multi-source venues

Deterministic, dependency-free deduplication of the 50 source entries
(20 Guía Repsol + 30 Michelin, from the three CSVs above) into 40 canonical
venues (10 exact-name auto-merges; no fuzzy/prefix matching):

```
npm run build:multi-source-madrid      # scripts/build-madrid-multi-source-venues.mjs
npm run validate:multi-source-madrid   # scripts/validate-madrid-multi-source-venues.mjs (rebuilds + asserts; exits nonzero on FAIL)
```

Outputs (regenerated; no run timestamps):

- `data/madrid-2026-unified-venues.json` — canonical venues with per-source
  distinctions, provenance, and Michelin-qualified canonical coordinates.
- `data/madrid-2026-multi-source-match-exceptions.json` — rejected
  near-candidates (e.g. Ramón Freixa Tradición vs Ramón Freixa Atelier).
- `docs/madrid-2026-multi-source-deduplication-report.md` — human-readable
  deduplication report.

## Repeatable procedures

### 1. Validate the seed CSV

Deterministic, dependency-free Node.js; output contains no timestamps:

```
npm run validate:madrid-seed
# or: node scripts/validate-guia-repsol-2026-madrid-seed.mjs
```

- Output: `docs/guia-repsol-2026-madrid-seed-validation-report.md`
  (overwritten each run).
- Checks: required fields, award values (`sol_level` ∈ {1,2,3},
  `guide_year` = 2026, `locality` = Madrid), source verification (HTTPS
  first-party URL, valid dates, `verification_status = verified`), and
  duplicate candidates.
- Exits nonzero on FAIL; run this before any change to the CSV or a redeploy
  that touches the seed.

### 2. Import / schema changes

Imports and schema changes ship as PocketBase migrations in `pb_migrations/`,
applied at boot. Rules (see `AGENTS.md` for detail):

- Never edit an already-applied migration — add a NEW migration file with a
  later timestamp.
- Guard collection/index creation with existence checks; keep seeds bulk,
  fast, and idempotent (`INSERT OR IGNORE`, deterministic ids).
- Test locally against the real PocketBase binary with this repo's
  `pb_migrations/` and `pb_hooks/` before redeploying; a fresh local run does
  not prove the change reached the live volume.

### 3. Deployment

Deployment is platform-managed from `supernaut/managed-app`: commit changes to
this repository and trigger a managed redeploy through the Supernaut platform
(there is no manual `fly deploy` credential flow for operators here). The
redeploy rebuilds the image and updates the existing machine while preserving
the `pb_data` volume. Redeploys take minutes — batch related changes into one
redeploy.

### 4. Post-deploy live inspection

After a deploy, verify against the **live** instance using the platform's
read-only PocketBase query capability (`query-pocketbase`) — no diagnostic
deploys, no shell access needed:

- `list_collections` — confirm `guide_sources`, `source_records`,
  `import_provenance`, `venues`, `venue_awards`, `venue_source_entries`
  exist with the expected fields/rules (i.e. the migrations actually
  applied), including the `venue_awards` fields `source_record`, `import`,
  `verification_status`.
- `count_records` — expect `guide_sources` 2, `source_records` 7,
  `import_provenance` 3, `venues` 40, `venue_awards` 50,
  `venue_source_entries` 50.
- `list_records` with filters (PocketBase filter syntax, e.g.
  `year=2026 && current=true` on `venue_awards`) to spot-check data; expand
  the award link fields (`expand=source_record,import`) and confirm every
  award has a non-empty `source_record`, `import`, and
  `verification_status = 'verified'`.
- `list_logs` (e.g. filter `data.status>=400`) to inspect request errors.

Note the query capability reads with platform superuser access and bypasses
API rules, so additionally smoke-test the public read path once with a real
client call:

```
curl -fsS "https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/venues/records?perPage=1"
```

If a write path is ever added, smoke-test it by creating and then deleting one
record with a fixed fake value (e.g. `smoketest@pocketbase-check.invalid`) and
confirm the delete by re-fetching.

## Frontend: build, run, deploy

The frontend is a Vite + TypeScript static app (`src/`, `index.html`,
`vite.config.ts`) that reads live data from PocketBase. Visual-design
conventions (layout surfaces, the sticker button system, map pin colors) are
documented in `docs/frontend-design-conventions.md`.

## Cities are data-driven

Since migration `1767986000_add_city_editorial_config.js`, the public
`cities` collection is the authority on which cities exist and how they
present. The frontend holds no hard-coded city list (`src/cities.ts` only
defines the config shape, fallback copy, and slug helpers), so **adding a
city is a content operation — no frontend deploy**:

1. Create a `cities` record: `name`, unique `slug`, `country`. That is the
   minimum; the city appears in the chooser as soon as at least one published
   venue's `city` field matches its `name`.
2. Optional editorial fields on the record: `title`, `tagline` (may contain
   the literal `{count}` placeholder, replaced with the current venue count),
   `footer`, `meta_title`, `meta_description`. Blank fields fall back to
   neutral copy generated from the city name.
3. A city starts as a **list-first preview**. To make it map-led, set
   `presentation = map` **and** supply the map fields: `center_lat`,
   `center_lng`, `zoom`, plus the conservative metro box `bounds_lat_min`,
   `bounds_lat_max`, `bounds_lng_min`, `bounds_lng_max` (used only to gate
   visitor-position framing). If any map field is missing — or the centre is
   the `0/0` sentinel — the frontend keeps the city list-first rather than
   render a broken map, consistent with the coordinates policy below.

Cities derived only from venue `city` strings (without a `cities` record)
still route venues correctly but are never offered in the chooser, so a typo
in one venue row cannot publish a city.

- Configure the API URL explicitly via `VITE_POCKETBASE_URL` (see
  `.env.example`); the client never assumes same-origin.
- Local dev: `npm install`, then `npm run dev` (Vite dev server).
- Build: `npm run build` (type-checks and outputs static assets into
  `public/`, the directory `wrangler.toml` serves).
- Public frontend URL: https://detour.supernaut.to
- Deploy: the Cloudflare static Worker deploy happens **after** the frontend
  changes are committed and pushed to `supernaut/managed-app` — trigger the
  managed Cloudflare static Worker deploy with `managedFE=true` using the root
  `wrangler.toml`, then open the public URL and confirm the live API data renders.

## Coordinates and browser location policy

The 2026-07-12 migration
(`pb_migrations/1767973000_verify_madrid_venue_coordinates.js`) supplies
OpenStreetMap/Nominatim-derived street addresses and `lat`/`lng` for all 20
verified Madrid seed records (`venueseed000001`–`venueseed000020`); each
row's `coord_verification_note` records the verification date and the OSM
node/way/relation id used. Map tiles visibly attribute OpenStreetMap
(© OpenStreetMap contributors, ODbL 1.0).

Per-record caveats:

- **Otoro Jukusei**: street-level only (no OSM house-number node for
  Fernández de la Hoz 35), so the pin is approximate.
- **Deessa**: the pin is the Mandarin Oriental Ritz building centroid — the
  restaurant is inside the hotel.

The user may be offered the option to share their **browser location**
(geolocation permission prompt). If the user denies the prompt, or
geolocation is unavailable, the frontend must fall back to a
Madrid-oriented view **without fabricating a location** — no fake pin, no
assumed user position.

## Community publication operator route

Curators must use the protected publication route after completing the checks in
`docs/community-curation-policy.md`. Do not set a submission to `published` in
the admin interface and do not create a public venue or award by hand.

- `POST /api/detour/curation/submissions/{submissionId}/publish` requires a
  PocketBase superuser token. The submission must already be `approved`.
- The JSON body must include the independently verified `country` and these
  boolean confirmations set to `true`: `identity_checked`,
  `official_url_checked`, `rights_checked`, `consent_checked`, and
  `editorial_selected`.
- Optional public fields are `official_url`, `address`, and `category`. An
  address requires `address_checked: true`. The route never copies the private
  submission note, research link, curator note, or member information.
- Coordinates are optional. When present, send both numeric `lat` and `lng`,
  `location_verified: true`, and boolean `location_approximate`. Never submit
  an unsupported pin or a `0,0` placeholder.
- The response contains only safe IDs, status, and the `Detour community
  selection` attribution. Repeating a completed publication returns the linked
  public IDs without duplicating a venue or selection event.
- `POST /api/detour/curation/submissions/{submissionId}/unpublish` requires the
  same superuser token. It disables the linked public community-selection event
  and returns the private submission to `approved` for correction or rejection;
  it does not delete the venue or submission.

Before treating a publication as complete, make one unauthenticated catalogue
request and confirm the public venue carries `Detour community selection` with
no submission, member, note, evidence, curator note, audit reference, or source
lead exposed.

# Detour backend — operator runbook

This repository is the Supernaut-managed PocketBase backend for Detour. It is
deployed from `supernaut/managed-app` (the Supernaut platform builds this repo
with `Dockerfile.supernaut-pocketbase` and runs it on Fly.io per `fly.toml`).
This README is an operator runbook, not user-facing copy.

## Durable managed API URL

The backend's durable API base URL is fixed by the managed Fly app name
(`fly.toml`: `app = "sn-pb-repo-1297566350-fd2610"`) and is recorded in
`.env.example`:

```
https://sn-pb-repo-1297566350-fd2610.fly.dev
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
curl -fsS https://sn-pb-repo-1297566350-fd2610.fly.dev/api/health
curl -fsS https://sn-pb-repo-1297566350-fd2610.fly.dev/api/supernaut/ready
```

## Repository layout

- `pb_migrations/` — schema migrations and the idempotent seed:
  `1767970000_create_food_discovery.js` (initial collections + new-Sol cohort
  seed), `1767971000_normalize_guia_repsol_2026_madrid_seed.js` (normalized
  source and import provenance, enrichment cleanup), and
  `1767972000_add_guia_repsol_2026_madrid_continuing_cohort.js` (continuing
  Sol holders verified in the official 2026 booklet).
- `pb_hooks/` — request-time hooks (readiness route).
- `pb_public/` — optional static fallback assets served by PocketBase.
- `src/`, `index.html`, `vite.config.ts`, `wrangler.toml` — the Vite frontend
  and its Cloudflare static Worker config (see "Frontend: build, run, deploy").
- `data/` — the two seed CSVs (see selection scope below).
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

Three migrations define the schema and seed:
`pb_migrations/1767970000_create_food_discovery.js` (initial collections and
new-cohort seed), `pb_migrations/1767971000_normalize_guia_repsol_2026_madrid_seed.js`
(normalized source and import provenance), and
`pb_migrations/1767972000_add_guia_repsol_2026_madrid_continuing_cohort.js`
(continuing booklet-verified cohort). Together they create five public-read
(write-locked) collections and seed them:

- **`guide_sources`** — the guide registry: name, unique `slug`,
  `official_url`, `current_year`. Seeded with one row, Guía Repsol
  (`slug = guia-repsol`, deterministic id `gsrepsol0000001`).
- **`source_records`** — record-level official source surfaces: relation to
  `source`, `title`, unique `url`, `source_type`, `published_or_updated_at`,
  `accessed_at`. Seeded with **4** rows: the 3 official 2026 award-level
  pages (3 Soles, 2 Soles, 1 Sol; `source_type = award-level-page`,
  deterministic ids `srcrec20260sol3` / `srcrec20260sol2` /
  `srcrec20260sol1`) plus the official 2026 digital booklet
  (`source_type = digital-booklet`, deterministic id `srcrec2026book1`),
  the governing source for the continuing cohort.
- **`import_provenance`** — one row per seed import: unique `import_key`,
  `dataset`, `description`, `source` relation, `record_count`,
  `verification_status`, `imported_at`. Seeded with **2** rows, one per
  verified CSV import (`import_key = guia-repsol-2026-madrid-new-sol-cohort`
  and `import_key = guia-repsol-2026-madrid-continuing-sol-selection`, each
  `record_count = 10`, `verification_status = verified`).
- **`venues`** — normalized venue records: name, city, country, address,
  lat/lng, category, `official_url`, `coord_verification_note`. Unique on
  (name, city). Seeded with the 20 selection venues under deterministic ids
  `venueseed000001`–`venueseed000020`.
- **`venue_awards`** — the award join: relations to `source` and `venue`,
  `year`, `level` (e.g. `1 Sol`, `2 Soles`, `3 Soles`), `source_url`,
  `current`, `verification_note`, plus provenance links added by the
  normalization migration: `source_record` (relation to the exact official
  award-level page in `source_records`), `import` (relation to the
  `import_provenance` row), and `verification_status`
  (`verified`/`unverified`). Unique on (source, venue, year, level).
  Deterministic ids `awardseed000001`–`awardseed000020`.

**All 20 awards link to these provenance records:** each `venue_awards` row
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
  `import_provenance`, `venues`, `venue_awards` exist with the expected
  fields/rules (i.e. the migrations actually applied), including the
  `venue_awards` fields `source_record`, `import`, `verification_status`.
- `count_records` on `venues` and `venue_awards` — expect 20 each;
  `guide_sources` — expect 1; `source_records` — expect 4;
  `import_provenance` — expect 2.
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
curl -fsS "https://sn-pb-repo-1297566350-fd2610.fly.dev/api/collections/venues/records?perPage=1"
```

If a write path is ever added, smoke-test it by creating and then deleting one
record with a fixed fake value (e.g. `smoketest@pocketbase-check.invalid`) and
confirm the delete by re-fetching.

## Frontend: build, run, deploy

The frontend is a Vite + TypeScript static app (`src/`, `index.html`,
`vite.config.ts`) that reads live data from PocketBase.

- Configure the API URL explicitly via `VITE_POCKETBASE_URL` (see
  `.env.example`); the client never assumes same-origin.
- Local dev: `npm install`, then `npm run dev` (Vite dev server).
- Build: `npm run build` (type-checks and outputs static assets into
  `public/`, the directory `wrangler.toml` serves).
- Public frontend URL: https://detour-app.supernaut.to
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

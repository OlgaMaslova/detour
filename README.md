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
`.env.example`) rather than assuming same-origin. **No user-facing frontend URL
is deployed yet** — only this API exists publicly. The eventual frontend will
be deployed separately as a Cloudflare static Worker (built into `public/`,
configured by `wrangler.toml`).

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
  `1767970000_create_food_discovery.js` (initial collections + seed) and
  `1767971000_normalize_guia_repsol_2026_madrid_seed.js` (normalized source
  and import provenance, enrichment cleanup).
- `pb_hooks/` — request-time hooks (readiness route).
- `pb_public/` — optional static fallback assets served by PocketBase.
- `data/` — the seed CSV (see cohort scope below).
- `docs/` — validation report, coverage report, source-rights memo.
- `scripts/` — deterministic seed validator.
- Runtime data (`pb_data/`) lives on the persistent Fly volume and is never
  committed or replaced on redeploy.

## Seed dataset: Guía Repsol 2026 Madrid new-Sol cohort

**Input:** `data/guia-repsol-2026-madrid-new-sol-cohort.csv`

**Exact scope — 10 records only.** The CSV covers **only the named cohort of
new 2026 Guía Repsol Sol awardees whose locality is Madrid city**:

- 1 × 3 Soles (Ramón Freixa Atelier)
- 2 × 2 Soles (Bascoat, Smoked Room)
- 7 × 1 Sol (Bancal, Desborre, EMi, Los 33, Otoro Jukusei,
  Ramón Freixa Tradición, Trèsde)

**Limitation:** this 10-record set is **not** the complete 2026 Madrid-city
Sol catalogue and must never be presented or reconciled as such. Continuing
(carry-over) award holders are out of scope, and the official figure of 98
Soles applies to the whole Comunidad de Madrid, not Madrid city. See
`docs/guia-repsol-2026-madrid-seed-coverage-report.md` for the full gap list
and `docs/guia-repsol-2026-madrid-source-rights-memo.md` for the governing
evidence and rights policy (factual fields only; no editorial prose, images,
or bulk source copies).

Every CSV row carries provenance columns: `source_url` (first-party
`guiarepsol.com` HTTPS), `source_type`, `source_published_or_updated_at`,
`source_accessed_at`, `verification_status`, and `verification_note`.
`street_address` is intentionally blank pending record-specific corroboration.

## Normalized collections and import provenance

Two migrations define the schema and seed:
`pb_migrations/1767970000_create_food_discovery.js` (initial collections and
seed) and `pb_migrations/1767971000_normalize_guia_repsol_2026_madrid_seed.js`
(normalized source and import provenance). Together they create five
public-read (write-locked) collections and seed them:

- **`guide_sources`** — the guide registry: name, unique `slug`,
  `official_url`, `current_year`. Seeded with one row, Guía Repsol
  (`slug = guia-repsol`, deterministic id `gsrepsol0000001`).
- **`source_records`** — record-level official source surfaces: relation to
  `source`, `title`, unique `url`, `source_type`, `published_or_updated_at`,
  `accessed_at`. Seeded with the **3** official 2026 award-level pages
  (3 Soles, 2 Soles, 1 Sol) as `source_type = award-level-page`, with the
  CSV's published and accessed dates, under deterministic ids
  `srcrec20260sol3` / `srcrec20260sol2` / `srcrec20260sol1`.
- **`import_provenance`** — one row per seed import: unique `import_key`,
  `dataset`, `description`, `source` relation, `record_count`,
  `verification_status`, `imported_at`. Seeded with **1** row describing the
  verified CSV import (`import_key = guia-repsol-2026-madrid-new-sol-cohort`,
  `record_count = 10`, `verification_status = verified`, deterministic id
  `impguia20260001`).
- **`venues`** — normalized venue records: name, city, country, address,
  lat/lng, category, `official_url`, `coord_verification_note`. Unique on
  (name, city). Seeded with the 10 cohort venues under deterministic ids
  `venueseed000001`–`venueseed000010`.
- **`venue_awards`** — the award join: relations to `source` and `venue`,
  `year`, `level` (e.g. `1 Sol`, `2 Soles`, `3 Soles`), `source_url`,
  `current`, `verification_note`, plus provenance links added by the
  normalization migration: `source_record` (relation to the exact official
  award-level page in `source_records`), `import` (relation to the
  `import_provenance` row), and `verification_status`
  (`verified`/`unverified`). Unique on (source, venue, year, level).
  Deterministic ids `awardseed000001`–`awardseed000010`.

**All 10 awards link to these provenance records:** each `venue_awards` row
points at its exact award-level page via `source_record` (and matching
`source_url`) and at the single verified CSV import via `import`, with
`verification_status = verified` and `current = true`; any other 2026 Guía
Repsol award rows are demoted to `current = false`.

**Intentionally cleared unsupported enrichment:** the normalization migration
blanks fields the verified CSV does not support on the 10 seed venues —
`address`, `category`, and venue `official_url` are set to empty strings.
Because `lat`/`lng` are NOT NULL numeric columns, they are reset to the
schema's neutral **zero sentinel**: `lat = 0, lng = 0` means "no verified
coordinates", **not** a map pin at 0/0, and `coord_verification_note` says so
explicitly (`No coordinates verified in this seed.`). Consumers must not
render the zero sentinel as a geographic point.

Both migrations use bulk `INSERT OR IGNORE` with fixed ids plus idempotent
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
- `count_records` on `venues` and `venue_awards` — expect 10 each;
  `guide_sources` — expect 1; `source_records` — expect 3;
  `import_provenance` — expect 1.
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

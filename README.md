# PocketBase app

This repository contains a Supernaut-managed PocketBase app.

- `pb_migrations/` stores PocketBase schema migrations.
- `pb_hooks/` stores PocketBase JavaScript hooks.
- `pb_public/` stores optional static fallback files served by PocketBase.
- `public/` stores the built frontend assets deployed as a Cloudflare static Worker.

PocketBase runtime data lives on the managed Fly.io volume and should not be committed.
The browser frontend is hosted separately on Cloudflare and calls the Fly.io PocketBase API URL explicitly.

## Guía Repsol 2026 Madrid seed validation

Validate the seed dataset deterministically (dependency-free Node.js, no timestamps in output):

```
npm run validate:madrid-seed
```

- **Input:** `data/guia-repsol-2026-madrid-new-sol-cohort.csv`
- **Output:** `docs/guia-repsol-2026-madrid-seed-validation-report.md` (overwritten each run)
- **What it validates:**
  - Required fields present: `venue_name`, `sol_level`, `guide_year`, `locality`, `source_url`, `source_type`, `source_accessed_at`, `verification_status` (`street_address` is intentionally optional)
  - Award values: `sol_level` in {1, 2, 3}, `guide_year` = 2026, `locality` = Madrid
  - Source verification: `source_url` is HTTPS on official `guiarepsol.com` (including `www.guiarepsol.com`), `source_type` nonempty, `source_accessed_at` a valid `YYYY-MM-DD` date, `verification_status` = `verified` (missing or invalid values count as source-verification failures)
  - Duplicate candidates by normalized venue name + `guide_year`

The report records the total, per-Sol-level counts, tables of any failures, and an overall PASS/FAIL result. The command exits nonzero on FAIL. It can also be run directly with `node scripts/validate-guia-repsol-2026-madrid-seed.mjs`.

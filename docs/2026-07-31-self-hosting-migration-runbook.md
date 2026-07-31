# Detour self-hosting migration runbook

**Created:** 2026-07-31
**Goal:** move Detour production out of the Supernaut-owned Fly and Cloudflare accounts and into accounts Olga owns, with no data loss and a reversible cutover.

Status legend: `[DONE]` · `[TODO]` · `[BLOCKED]`

---

## Why this exists

Detour production currently runs entirely inside accounts belonging to a third party that is shutting down:

| Piece | Where it runs today | Account | Target |
|---|---|---|---|
| PocketBase API + SQLite DB | Fly app `sn-pb-repo-1297566350-a88d3c`, region `fra`, 3GB volume `pb_data` | Fly org **supernaut-ai** | Fly org **personal**, app `detour-api` |
| Uploaded images | `pb_data/storage` on the same volume | same | same volume on new app |
| Secrets (8) | Fly secrets | same | Fly secrets on new app |
| Frontend | Worker `supernaut-managed-frontend` | Cloudflare **Supernaut AI** | Cloudflare **personal**, Worker `detour-web` |
| `takedetour.app` | Cloudflare Registrar + DNS | Cloudflare **personal** ✅ already owned | unchanged |

The domain is already in the personal account, so the registration is not at risk. Everything else must move.

### The one irreplaceable thing

`PB_ENCRYPTION_KEY`. PocketBase runs with `--encryptionEnv=PB_ENCRYPTION_KEY`, so the settings blob inside `data.db` is encrypted with it. Fly secrets are write-only — `fly secrets list` shows digests, never values. The key existed nowhere except the running machine's environment.

It has been rescued. Do not lose it again.

---

## Phase 0 — Rescue `[DONE]`

Completed 2026-07-31. Detour could be rebuilt from these artifacts alone.

- `[DONE]` Pulled the live environment off the running machine:
  ```sh
  flyctl ssh console -a sn-pb-repo-1297566350-a88d3c -C "printenv"
  ```
  Saved to `detour-prod-secrets.env` (repo root). Contains all 8 secrets including `PB_ENCRYPTION_KEY`.
- `[DONE]` Fixed `.gitignore` — the existing rule was `.detour-prod-secrets.env` with a leading dot and did not match the actual filename. The file was one `git add -A` from being committed.
- `[DONE]` Created a real PocketBase backup via the API (`POST /api/backups`) rather than copying `data.db`. PocketBase snapshots SQLite with `VACUUM INTO` and includes `storage/`, so the result is consistent even with the app live and WAL files open. An `sftp get` gives neither.
- `[DONE]` Downloaded to `~/detour-backups/detour_prod_20260731.zip` — 5.8M.
- `[DONE]` Verified the backup **and** the key together:

| Check | Result |
|---|---|
| `PRAGMA integrity_check` | `ok` |
| Superusers in backup | 1 |
| Venues / cities / recommendations | 9 / 5 / 9 |
| `storage/` | 4.8M, `pbc_2310495149` present |
| Boots with rescued key | health 200, **no superuser-creation prompt** |

The absence of the superuser prompt is the pass condition — it proves PocketBase decrypted the settings with the rescued key. A backup you have not restored is not a backup.

### `[TODO]` Phase 0 loose ends

- Move `detour-prod-secrets.env` out of the working tree. Gitignored is not the same as safe. `PB_ENCRYPTION_KEY` belongs in a password manager.
- Put a copy of the backup zip somewhere that is neither Fly nor Cloudflare.

---

## Phase 1 — Own the accounts `[TODO]`

- `[TODO]` **Fly:** re-authenticate as the personal account and add a payment method to the `personal` org.
  ```sh
  flyctl auth logout && flyctl auth login
  flyctl orgs list
  ```
  The **$29/month Standard support plan is optional** and opt-in. The 30-day trial expires on its own; you are only charged if you click "Upgrade Now" in the Support portal. Compute is the real cost: shared-cpu-1x 512MB ≈ $3.19/mo plus a 3GB volume ≈ $0.45/mo. Verify any minimum-spend floor on the billing page.
  When Fly offers **"Launch from GitHub"** vs **"Launch from your machine"**, choose *from your machine*. Build-on-push would deploy before secrets are set, booting PocketBase against an empty volume with no encryption key and initialising a blank database.
- `[TODO]` **Cloudflare:** re-authenticate wrangler to the personal account.
  ```sh
  npx wrangler logout && npx wrangler login && npx wrangler whoami
  ```
  Record the personal account ID — it gets pinned in `wrangler.toml` in Phase 4.

---

## Phase 2 — New backend on Fly `[TODO]`

Order matters. Nothing may deploy before the secrets exist.

- `[TODO]` **Commit first.** `fly deploy` ships the *working directory*, not git HEAD — `Dockerfile.supernaut-pocketbase` copies `pb_hooks`, `pb_migrations`, `pb_public` from disk. There are currently 15 uncommitted files and an untracked `pb_hooks/circle_scope.js`. Whatever is on disk goes to production.

- `[TODO]` Create the app and volume, without deploying:
  ```sh
  flyctl apps create detour-api --org personal
  flyctl volumes create pb_data --size 3 --region fra -a detour-api
  ```

- `[TODO]` Import the secrets from the rescued file, without echoing them:
  ```sh
  grep -E '^(PB_ENCRYPTION_KEY|PB_SUPERUSER_EMAIL|PB_SUPERUSER_PASSWORD|OPENAI_API_KEY|AGENTMAIL_API_KEY|AGENTMAIL_INBOX_ID|DETOUR_FOUNDER_PASSWORD|SUPERNAUT_EVENTS_URL)=' \
    detour-prod-secrets.env | flyctl secrets import -a detour-api
  flyctl secrets list -a detour-api
  ```
  `PB_ENCRYPTION_KEY` must be **byte-identical** to the rescued value or the restored settings will not decrypt. Consider setting fresh `PB_SUPERUSER_PASSWORD` and `DETOUR_FOUNDER_PASSWORD` — they have been in a plaintext file on disk.

- `[TODO]` Point `fly.toml` at the new app (`app = "detour-api"`), keep everything else — `[mounts]`, the 300s health-check `grace_period` (it exists so a slow migration boot is not restarted mid-flight), `auto_stop_machines = "off"`. Then:
  ```sh
  flyctl deploy -a detour-api
  flyctl status -a detour-api
  ```
  First boot creates an empty database and a superuser from the env. Expected — the restore replaces it.

- `[TODO]` Restore: open `https://detour-api.fly.dev/_/`, log in as the superuser, Settings → Backups → **Upload backup** → select `detour_prod_20260731.zip` → **Restore**. PocketBase replaces `data.db`, `auxiliary.db` and `storage/`, then restarts.

- `[TODO]` Verify against the numbers in Phase 0: 9 venues, 5 cities, 9 recommendations, 1 superuser, images resolving.

---

## Phase 3 — `api.takedetour.app` `[TODO]`

This is the step that stops this from ever happening again: once the API answers on a name you own, changing hosts is a DNS edit rather than a frontend rebuild.

- `[TODO]` In the personal Cloudflare account, on the `takedetour.app` zone, add:
  `CNAME  api  →  detour-api.fly.dev` — **DNS-only (grey cloud)**.
  The grey cloud matters: Fly completes an ACME challenge to issue the certificate, and a proxied record interferes. You can enable the orange cloud afterwards.
- `[TODO]` `flyctl certs add api.takedetour.app -a detour-api`, then `flyctl certs show api.takedetour.app -a detour-api` until it is issued.
- `[TODO]` Confirm `curl -sS https://api.takedetour.app/api/health` returns 200.

Nothing user-facing has moved yet — the live frontend still points at the old fly.dev host.

---

## Phase 4 — New frontend on Cloudflare `[TODO]`

Detour's Worker has **no `main`** — only `[assets]`, serving `public/` (Vite's `outDir`) with SPA fallback. No server code executes, so static-asset requests are free and unlimited on both Free and Paid plans. **This costs $0.** The $5/mo plan buys CPU time for Workers that run code; yours doesn't. Custom domains work on Free.

- `[TODO]` Pin the account and rename in `wrangler.toml`:
  ```toml
  name = "detour-web"
  account_id = "<personal-account-id>"
  ```
  Pinning means a stale login errors out instead of silently deploying into the wrong account.
- `[TODO]` Claim the account's workers.dev subdomain (one-time, dashboard: Workers & Pages). Each Worker then gets `detour-web.<subdomain>.workers.dev` — a real HTTPS URL with no DNS setup, for clicking through before the apex moves.
- `[TODO]` Deploy while `src/pocketbase.ts` still points at the **old** backend:
  ```sh
  npm run build && npx wrangler deploy
  ```
  This isolates one variable — it proves the Worker deploy works before the backend moves. PocketBase's `--origins` defaults to `*`, so cross-origin calls succeed. Note `[build]` runs `npm ci`, which reinstalls `node_modules`.
- `[TODO]` Repoint the API host — `src/pocketbase.ts:3`:
  ```ts
  const defaultPocketBaseUrl = "https://api.takedetour.app";
  ```
  Only after Phase 3 resolves. Doing it earlier means any rebuild ships a broken API URL.
- `[TODO]` Rebuild, redeploy, and exercise the workers.dev URL against the new backend: load the map, open a city, check images, submit a survey, sign in.

---

## Phase 5 — Cutover `[TODO]`

- `[TODO]` **Take a second backup** immediately beforehand and restore it onto `detour-api`. The Phase 0 zip is a snapshot from 11:05 on 2026-07-31; anything written to the old prod after that is not in it. Repeat the Phase 0 commands, then re-verify.
- `[TODO]` Consider a brief write freeze so the gap between final backup and DNS flip contains no writes.
- `[TODO]` Remove the apex record pointing at supernaut's custom hostname — it will otherwise conflict — then add:
  ```toml
  routes = [
    { pattern = "takedetour.app", custom_domain = true }
  ]
  ```
  Cloudflare creates the DNS record itself.
- `[TODO]` Verify `https://takedetour.app` end to end.

Rollback: put the old apex record back. The old Fly app and old Worker stay untouched and running until Phase 6.

---

## Phase 6 — Decommission `[TODO]`

Only after the new stack has served real traffic for a day or two.

- `[TODO]` Disconnect takedetour.app from the Supernaut managed setup.
- `[TODO]` Delete the old Fly app and volume; delete `supernaut-managed-frontend`.
- `[TODO]` Take one final backup of the old app before deleting anything.
- `[TODO]` `SUPERNAUT_EVENTS_URL` points at a service that is going away. It is used in `onRecordAfterCreateSuccess` hooks (e.g. `pb_hooks/main.pb.js:163`) to post dashboard notifications, wrapped in `try/catch` — so failures are logged, not fatal, and records still save. Decide whether to remove the calls or repoint them.
- `[TODO]` The `docs/` verification reports reference `detour-app.supernaut.to` in 13 places. Documentation only — nothing in `src/` or `index.html` depends on it.

---

## Phase 7 — Durability `[TODO]`

Single node, single disk — true on Fly, a VPS, or Railway alike. A Fly volume lives on **one physical host**, is not replicated, and Fly's own snapshots are short-retention and not a backup strategy.

- `[TODO]` Create an R2 bucket in the personal Cloudflare account.
- `[TODO]` PocketBase dashboard → Settings → Backups: enable automatic backups on a cron and configure S3 storage against R2.
- `[TODO]` Restore one automated backup to prove the pipeline, exactly as in Phase 0.

Once backups land in an account you own, the host becomes a cheap, swappable detail — and moving to a VPS later is an afternoon's calm work rather than a deadline.

---

## Is Fly still the right host?

For this migration, yes — the Dockerfile and `fly.toml` already run production, and changing host *and* account at once means a failure has two possible causes. Longer term it is a mediocre fit: Fly's strengths (multi-region, scale-to-zero, edge) go unused here, while its constraints bite — volumes bound to one host, no two machines on one volume, so every deploy is a restart with downtime. A plain VPS with Docker and Caddy is arguably a better home for single-node SQLite. Revisit after Phase 7, not during.

---

## Gotchas found the hard way

- **Restoring a snapshot locally:** always pin `--hooksDir` and `--migrationsDir` to an empty directory. `pb_hooks/main.pb.js` registers **5 cron jobs**, two of which run hourly and every 15 minutes, make outbound calls (OpenAI, geocoding, cover fetches) and write to the database. Unpinned, a restored copy starts mutating itself and spending credits within 15 minutes.
  ```sh
  mkdir -p ~/detour-backups/empty
  PB_ENCRYPTION_KEY=$(grep '^PB_ENCRYPTION_KEY=' detour-prod-secrets.env | cut -d= -f2-) \
    ./pocketbase serve --dir=$HOME/detour-backups/restore-test \
    --hooksDir=$HOME/detour-backups/empty --migrationsDir=$HOME/detour-backups/empty \
    --encryptionEnv=PB_ENCRYPTION_KEY --http=127.0.0.1:8091
  ```
- **Unzip before serving.** Pointing `--dir` at an empty directory makes PocketBase create a blank database and print the "create your first superuser" prompt. That prompt is the tell that you restored nothing.
- **`rm -rf` the restore directory between attempts** — a stale empty `data.db` plus its `-wal`/`-shm` mixes a fresh WAL with a restored database.
- **Never `source detour-prod-secrets.env`.** It contains the container's `PATH` and `HOME` and will break your shell. Extract individual values with `grep`/`cut`.
- **Interactive zsh does not treat `#` as a comment.** Trailing explanations become arguments, and a `#` note containing a glob (e.g. `pbc_*`) aborts the whole command via `nomatch`.
- **The public API surfaces less than the database holds** — 9 `community_recommendations` rows, 3 returned by `/api/detour/public-recommendations`, because of curation filtering. A backup that looks "bigger" than production is correct.

## Verified reference values (2026-07-31)

```
backup:       ~/detour-backups/detour_prod_20260731.zip   5.8M
data.db       468K        auxiliary.db  4.7M        storage/  4.8M
superusers 1 · members 1 · venues 9 · cities 5 · recommendations 9
venues by city: Paris 3 · Madrid 2 · San Francisco 2 · Annecy 1 · Bilbao 1
old app:      sn-pb-repo-1297566350-a88d3c   (fly org supernaut-ai, fra)
old volume:   vol_4y8ek35d3j2oq29r           (3GB, encrypted)
old worker:   supernaut-managed-frontend     (cf account Supernaut AI)
domain:       takedetour.app  ·  Cloudflare Registrar  ·  registered 2026-07-21
```

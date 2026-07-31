# Detour self-hosting migration runbook

**Created:** 2026-07-31
**Goal:** move Detour production out of the Supernaut-owned Fly and Cloudflare accounts and into accounts Olga owns, with no data loss and a reversible cutover.

Status legend: `[DONE]` · `[IN PROGRESS]` · `[TODO]` · `[BLOCKED]`

**Where things stand (2026-07-31):** **the migration is done.** `https://takedetour.app` is served by the `detour-web` Worker in Olga's own Cloudflare account, talking to PocketBase on `takedetour-api` in her own Fly account. Nothing in the serving path touches Supernaut any more.

Remaining: a manual signed-in check on the live domain, then Phase 6 (decommission) and Phase 7 (scheduled backups to R2). **The old stack is still running and is the rollback** — recreate `CNAME · takedetour.app · clients.supernaut.to · Proxied` to return to it instantly. Do not delete anything in the old accounts until Phase 7 is in place.

**Apex rollback record** — the single line to restore if Phase 5 needs undoing:
`CNAME · takedetour.app · clients.supernaut.to · Proxied · TTL Auto`

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

## Phase 1 — Own the accounts `[IN PROGRESS]`

- `[TODO]` **Fly:** re-authenticate as the personal account and add a payment method to the `personal` org.
  ```sh
  flyctl auth logout && flyctl auth login
  flyctl orgs list
  ```
  The **$29/month Standard support plan is optional** and opt-in. The 30-day trial expires on its own; you are only charged if you click "Upgrade Now" in the Support portal. Compute is the real cost: shared-cpu-1x 512MB ≈ $3.19/mo plus a 3GB volume ≈ $0.45/mo. Verify any minimum-spend floor on the billing page.
  When Fly offers **"Launch from GitHub"** vs **"Launch from your machine"**, choose *from your machine*. Build-on-push would deploy before secrets are set, booting PocketBase against an empty volume with no encryption key and initialising a blank database.
- `[DONE]` **Cloudflare:** re-authenticated wrangler to the personal account.
  ```sh
  npx wrangler logout && npx wrangler login && npx wrangler whoami
  ```
  Personal account ID: `a92a6db0c65c8a9fc0bd0b2ce3da4276` — confirmed distinct from Supernaut AI (`9fbbb5bb3e99b38d7821047385434fd9`).

---

## Phase 2 — New backend on Fly `[DONE]`

Completed 2026-07-31. Order mattered: nothing deployed before the secrets existed.

- `[DONE]` New Fly account `omaslova87@gmail.com`, org `personal` — deliberately **not** tied to the supernaut.dev mailbox, which will stop being able to receive password resets.
- `[DONE]` App created as **`takedetour-api`**. `detour-api` was already taken — Fly app names are globally unique across all customers, not per-account.
  ```sh
  flyctl apps create takedetour-api --org personal
  flyctl volumes create pb_data --size 3 --region fra -a takedetour-api
  ```
  Volume `vol_42knwlyxdjq6ly94`, 3GB, `fra`, encrypted, scheduled snapshots on.
- `[DONE]` Secrets imported from the rescued file without echoing them:
  ```sh
  grep -E '^(PB_ENCRYPTION_KEY|PB_SUPERUSER_EMAIL|PB_SUPERUSER_PASSWORD|OPENAI_API_KEY|AGENTMAIL_API_KEY|AGENTMAIL_INBOX_ID|DETOUR_FOUNDER_PASSWORD|SUPERNAUT_EVENTS_URL)=' \
    ~/detour-backups/detour-prod-secrets.env | flyctl secrets import -a takedetour-api
  ```
  All 8 digests match the old app exactly — `PB_ENCRYPTION_KEY` at `145675aba8eef28e` — which is proof the key transferred byte-for-byte.
- `[DONE]` `fly.personal.toml` created (mirroring `wrangler.personal.toml`) so `fly.toml` keeps pointing at the old app and both stay deployable.
  ```sh
  flyctl deploy -c fly.personal.toml -a takedetour-api --ha=false --yes
  ```
  **`--ha=false` is required.** Fly provisions two machines by default; PocketBase is single-node SQLite on one volume and two machines cannot share it.
- `[DONE]` Restore performed over the API rather than the dashboard:
  ```sh
  curl -X POST "$API/api/backups/upload" -H "Authorization: $TOKEN" -F "file=@detour_prod_20260731.zip"
  curl -X POST "$API/api/backups/detour_prod_20260731.zip/restore" -H "Authorization: $TOKEN"
  ```
  The app restarts and existing tokens are invalidated — re-authenticating successfully afterwards is itself the proof that the restored settings decrypted with the rescued key.

### `[DONE]` Verification — and why the obvious numbers prove nothing

**The seed migrations reproduce most of production.** A freshly deployed, never-restored database already contained 9 venues, 5 cities, 1 member, 9 recommendations and 9 waitlist entries, because `1768100100_seed_founding_member.js` and `1768100200_seed_launch_selection.js` run on first boot. Checking those numbers would have passed on an empty database.

The collections that actually discriminate are the user-generated ones:

| Collection | Fresh (seeded) | Prod snapshot | After restore |
|---|---|---|---|
| `survey_responses` | 0 | 5 | **5** ✅ |
| `community_place_images` | 0 | 10 | **10** ✅ |
| `invites` | 0 | 2 | **2** ✅ |
| venues / cities / members / recommendations / waitlist | *same as prod* | | matched, but prove nothing |

Plus two checks that rows cannot give you:

- **A storage file, byte-compared against the old host** — `/api/files/pbc_2310495149/9w2z14qsxlu6wcv/highball_vr88ld9ofs.jpg` returned 105295 bytes on both, identical checksums. Row counts say nothing about whether `storage/` survived.
- **The public endpoint, old vs new** — `/api/detour/public-recommendations` returned `["Annecy","Paris","San Francisco"]` from both.

Live at **https://takedetour-api.fly.dev** — health 200, one machine in `fra`, checks passing, volume attached.

---

## Phase 3 — `api.takedetour.app` `[DONE]`

Completed 2026-07-31. This is the step that stops this from ever happening again: the API now answers on a name you own, so changing hosts later is a DNS edit rather than a frontend rebuild.

- `[DONE]` `flyctl certs add api.takedetour.app -a takedetour-api` **first** — Fly then prints the exact records it wants, rather than you guessing.
- `[DONE]` Added on the `takedetour.app` zone, both **DNS-only (grey cloud)**:

  | Type | Name | Content |
  |---|---|---|
  | `A` | `api` | `66.241.124.163` (shared IPv4, routed by SNI) |
  | `AAAA` | `api` | `2a09:8280:1::15a:b33c:0` (dedicated to the app) |

  A single `CNAME api → pqr2dm6.takedetour-api.fly.dev` also works — note the per-app prefix; plain `takedetour-api.fly.dev` is *not* a valid target.
- `[DONE]` Certificate issued by Let's Encrypt (rsa + ecdsa), verified and active.
- `[DONE]` `https://api.takedetour.app/api/health` → 200, serving the restored data and `storage/` images.

### The grey cloud is not cosmetic

The records were first saved **Proxied** (Cloudflare's default for A/AAAA), and resolved to `188.114.97.12` — Cloudflare's anycast IPs — instead of Fly's. Proxied, Cloudflare terminates TLS at its own edge and Fly never sees the ACME challenge, so the certificate sits at "Not verified" forever while `https://` fails the TLS handshake. Browsers report that as "cannot find the server", which points you at DNS when the problem is TLS.

Diagnosing, in order:

```sh
dig @magnolia.ns.cloudflare.com +short api.takedetour.app A     # must be Fly's IP, not 188.114.x
dig @magnolia.ns.cloudflare.com +short takedetour.app CAA       # blank = no CA restriction
curl -o /dev/null -w "%{http_code}" http://api.takedetour.app/  # 301 = Fly's edge sees the hostname
flyctl certs check api.takedetour.app -a takedetour-api
```

Query Cloudflare's nameservers directly — a local resolver caches the negative answer from before the record existed and will keep reporting "not found" after it's fixed.

Nothing user-facing moved in this phase: the live frontend still pointed at the old fly.dev host throughout.

---

## Phase 4 — New frontend on Cloudflare `[IN PROGRESS]`

Detour's Worker has **no `main`** — only `[assets]`, serving `public/` (Vite's `outDir`) with SPA fallback. No server code executes, so static-asset requests are free and unlimited on both Free and Paid plans. **This costs $0.** The $5/mo plan buys CPU time for Workers that run code; yours doesn't. Custom domains work on Free.

- `[DONE]` Created `wrangler.personal.toml` rather than editing `wrangler.toml`, so **both stacks stay deployable** during the migration:
  ```toml
  name = "detour-web"
  account_id = "a92a6db0c65c8a9fc0bd0b2ce3da4276"
  compatibility_date = "2026-06-22"

  [assets]
  directory = "./public"
  not_found_handling = "single-page-application"
  ```
  Pinning `account_id` means a stale login errors out instead of silently deploying into the wrong account. There is deliberately **no `routes` block** — the Worker is reachable only at workers.dev and cannot affect `takedetour.app`.
  The `[build]` block from `wrangler.toml` was deliberately **not** carried over — see gotchas.
- `[DONE]` workers.dev subdomain: `omaslova87.workers.dev` (was already claimed on the account).
- `[DONE]` Deployed while the frontend still points at the **old** backend:
  ```sh
  npm run build
  CI=1 npx wrangler deploy -c wrangler.personal.toml
  ```
  Live at **https://detour-web.omaslova87.workers.dev** — 200, bundle targeting `sn-pb-repo-1297566350-a88d3c.fly.dev`, backend healthy. This isolates one variable: the Worker deploy is proven correct before the backend moves. PocketBase's `--origins` defaults to `*`, so cross-origin calls succeed.
  Note the workers.dev build reflects the **working tree**, not what is on takedetour.app. Commit or stash for a like-for-like comparison.
- `[DONE]` Added `.env.production` pinning the API host. Vite loads `.env.local` during production builds, so the first deploy baked `127.0.0.1:8090` into the bundle. Verified empirically that `.env.production` takes precedence over `.env.local`.
- `[DONE]` Repointed the API host — **two places, not one:**
  ```sh
  # .env.production
  VITE_POCKETBASE_URL=https://api.takedetour.app
  ```
  ```ts
  // src/pocketbase.ts:3 — the fallback when no env file is present (e.g. Cloudflare-side builds)
  const defaultPocketBaseUrl = "https://api.takedetour.app";
  ```
  Changing only `pocketbase.ts` is not enough: `.env.production` overrides it. Always confirm what the build actually baked in:
  ```sh
  grep -ohE "sn-pb-repo-[a-z0-9-]+\.fly\.dev|api\.takedetour\.app|127\.0\.0\.1:8090" public/assets/*.js | sort -u
  ```
- `[DONE]` Redeployed `detour-web`. Was **briefly blocked 2026-07-31 by a Cloudflare API outage**, not by anything in this repo. `wrangler deploy` failed with 520/521/522/525 on `GET /accounts/…/workers/services/detour-web`; cloudflarestatus.com showed "Cloudflare API Availability — Reduced Availability". Serving was entirely unaffected: `takedetour.app`, `detour-web.omaslova87.workers.dev`, `api.takedetour.app` and the old backend all returned 200 throughout. Cloudflare's edge serves already-deployed Workers independently of its control plane. Retry until it succeeds.
  Note: probing `https://api.cloudflare.com/client/v4/` is **not** a valid readiness check — it returned 400 (answering) while authenticated Workers endpoints still returned 520. The only reliable signal is the deploy itself.
- `[DONE]` Automated verification of the new stack end to end:

  | Check | Result |
  |---|---|
  | `detour-web.omaslova87.workers.dev` root / SPA route / css | 200 / 200 / 200 |
  | Host baked into the bundle | `api.takedetour.app` only |
  | `api.takedetour.app/api/health` | 200 |
  | Public recommendations | `["Annecy","Paris","San Francisco"]` |
  | Storage image | 200, 105295 bytes |
  | CORS from the Worker origin | 200 |

- `[TODO]` **Manual click-through** — the last gate before the apex swap, and the part automation cannot cover: load the map, open a city, check images render, submit a survey, sign in. At this point the frontend and backend are both yours and fully independent of supernaut.

---

## Phase 5 — Cutover `[DONE]`

- `[DONE]` **Second backup taken and restored.** `detour_prod_cutover_20260731.zip` — 6,892,078 bytes against the morning's 6,065,794. Row counts were identical; the ~800KB delta was generated cover/thumbnail files from the cron sweeps plus `auxiliary.db` log growth. Integrity `ok`, restored onto `takedetour-api`, all eight collections verified against the snapshot, storage image and public endpoint matching old prod exactly.
- `[DONE]` **Custom-domain mechanism rehearsed on `new.takedetour.app`** rather than tested for the first time on the apex. Cloudflare created the DNS record and provisioned the certificate automatically — 200 on the first request after deploy, no propagation wait. Worth keeping the throwaway subdomain until Phase 6.
- `[DONE]` **Caught by the rehearsal:** adding a `routes` block makes wrangler default `workers_dev` to **false**, which disables the workers.dev hostname (Cloudflare `error code: 1042`, served as a 404). Done directly on the apex, this would have removed the DNS record *and* the fallback URL for checking Worker health in the same deploy. `workers_dev = true` is now explicit in `wrangler.personal.toml`. Re-enabling takes a minute or two to propagate.
- `[DONE]` **Deleted the apex record** — Cloudflare will not let a Workers custom domain claim a hostname that already has a conflicting record:
  `CNAME · takedetour.app · clients.supernaut.to · Proxied · TTL Auto`
- `[DONE]` **Immediately** deployed with the apex added to `routes`:
  ```toml
  workers_dev = true
  routes = [
    { pattern = "takedetour.app", custom_domain = true },
    { pattern = "new.takedetour.app", custom_domain = true }
  ]
  ```
  These two steps must happen back to back — between them `takedetour.app` does not resolve. In practice the gap was seconds: the apex returned 200 with a valid certificate on the **first** request after deploy.
- `[DONE]` Automated verification of the live apex:

  | Check | Result |
  |---|---|
  | `https://takedetour.app` | 200, certificate valid |
  | Host baked into the bundle | `api.takedetour.app` only |
  | Byte-identical to the rehearsed build | yes |
  | SPA route, CSS | 200 / 200 |
  | API health / recommendations / image / CORS from apex | all 200, data matching old prod |

- `[TODO]` **Manual check on the live domain** — a signed-in session and a write (survey submission), which automation cannot cover. Note the deployed bundle changed after the workers.dev click-through, so this is not the same build that was manually tested.

Rollback: recreate that one CNAME exactly as recorded above. The old Fly app and old Worker stay untouched and running until Phase 6.

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

### Fly

- **Seeded data masks a failed restore.** Verify with user-generated collections (`survey_responses`, `community_place_images`, `invites`) and a byte-compared storage file — never with venues/cities/members, which the seed migrations recreate. See Phase 2.
- **App names are globally unique across all of Fly**, not per-account. `detour-api` was taken by a stranger.
- **`--ha=false` on any volume-backed deploy.** The default two machines cannot share one volume.
- **Logging out of `olga@supernaut.dev` removes access to the `supernaut-ai` org.** The old app keeps running and its PocketBase admin UI stays reachable over HTTPS, so backups are still possible — but `flyctl ssh`, `flyctl secrets` and deleting the old app in Phase 6 all require logging back in. Do not let that mailbox die before Phase 6 is finished. The old app's config was saved to `~/detour-backups/old-app-fly-config.json` as insurance.
- **`flyctl auth login` needs an interactive terminal**; it cannot be driven from a script. `FLY_API_TOKEN` with `fly tokens create` is the headless path.
- **Rotating `PB_SUPERUSER_PASSWORD` as a Fly secret has no effect after a restore.** The container's `superuser create` runs with `|| true` and no-ops once the email exists, so the effective password is whatever is in the restored snapshot. Rotate in the PocketBase admin UI instead.

### Building and deploying the frontend locally

Every step of this migration builds on a laptop. Production has always built on Cloudflare's machines, so these only appear now.

- **`.env.local` poisons production builds.** Vite loads `.env.local` in *all* modes, including `vite build`. It sets `VITE_POCKETBASE_URL=http://127.0.0.1:8090`, which silently overrides the default in `src/pocketbase.ts` — the first workers.dev deploy shipped a bundle pointing at localhost. Cloudflare-side builds never saw this because the file is gitignored and absent there. `.env.production` (committed) now wins over it. **Always verify what the build actually baked in:**
  ```sh
  grep -ohE "sn-pb-repo-[a-z0-9-]+\.fly\.dev|api\.takedetour\.app|127\.0\.0\.1:8090" public/assets/*.js | sort -u
  ```
- **Do not put `npm ci` in a `[build]` block for local deploys.** `npm ci` deletes `node_modules` while wrangler is running *from* `node_modules`. The first attempt hung silently for eight minutes. Build separately, then deploy.
- **`npm ci` replaces a pnpm-installed `node_modules`.** The repo carries both `package-lock.json` and `pnpm-lock.yaml`. If you work in pnpm, run `pnpm install` afterwards.
- **`wrangler deploy` blocks on a first-run telemetry prompt** in a non-interactive shell, producing no output at all. Use `CI=1` (and `WRANGLER_SEND_METRICS=false`) for scripted runs.
- **Cloudflare caches 404s at the edge.** Requesting an asset before propagation completes caches the miss for minutes. Append `?cb=1` to distinguish a stale 404 from a real one.

## Verified reference values (2026-07-31)

```
backup:       ~/detour-backups/detour_prod_20260731.zip   5.8M
data.db       468K        auxiliary.db  4.7M        storage/  4.8M
superusers 1 · members 1 · venues 9 · cities 5 · recommendations 9
venues by city: Paris 3 · Madrid 2 · San Francisco 2 · Annecy 1 · Bilbao 1
old app:      sn-pb-repo-1297566350-a88d3c   (fly org supernaut-ai, fra)
old volume:   vol_4y8ek35d3j2oq29r           (3GB, encrypted)
old worker:   supernaut-managed-frontend     (cf account Supernaut AI, 9fbbb5bb3e99b38d7821047385434fd9)
domain:       takedetour.app  ·  Cloudflare Registrar  ·  registered 2026-07-21

new cf acct:  a92a6db0c65c8a9fc0bd0b2ce3da4276   subdomain omaslova87.workers.dev
new worker:   detour-web  ·  https://detour-web.omaslova87.workers.dev  (no routes — workers.dev only)
new fly acct: omaslova87@gmail.com  ·  org personal
new fly app:  takedetour-api  ·  https://takedetour-api.fly.dev  ·  machine 2871701b469728 (fra)
new volume:   vol_42knwlyxdjq6ly94  (3GB, encrypted, snapshots on)

restore discriminators (NOT venues/cities/members — those are seeded by migrations):
  survey_responses 5 · community_place_images 10 · invites 2
  storage probe: /api/files/pbc_2310495149/9w2z14qsxlu6wcv/highball_vr88ld9ofs.jpg = 105295 bytes
```

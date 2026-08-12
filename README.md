# Detour — operator runbook

Detour is a network of member circles who recommend places to each other. Anyone
can sign up and start a circle; an invitation is what puts somebody inside yours.
A place is public on Detour **only** because a verified member recommended it;
there is no guide catalogue, no awards, and no editorial lane.

Signed-out visitors browse the whole app — Explore, cities, the map, the feed, the
place pages — scoped to the places the founding circle recommends.

This repository holds both halves of production:

- **API + database** — PocketBase (`pb_migrations/`, `pb_hooks/`), deployed to
  Fly.io as `takedetour-api` (`fly.toml`, `Dockerfile`).
- **Frontend** — a Vite + TypeScript static app (`src/`, `index.html`), built
  into `public/` and deployed as the Cloudflare Worker `detour-web`
  (`wrangler.toml`).

Both run in Olga's own Fly and Cloudflare accounts as of 2026-07-31, moved off
a third-party managed platform that was shutting down. See
`docs/2026-07-31-self-hosting-migration-runbook.md` for how the cutover was
done and what remains (decommissioning the old stack, backups to R2).

This README is an operator runbook, not user-facing copy. Engineering rules
live in `AGENTS.md`; read that before touching a migration or a hook.

## URLs

| What | URL |
|---|---|
| Public frontend | https://takedetour.app (also `new.takedetour.app`) |
| API base | https://api.takedetour.app |
| Local API | http://127.0.0.1:8090 |

Browser code must read the API base from `VITE_POCKETBASE_URL` — it never
assumes same-origin. `.env.production` carries the production value,
`.env.local` the local one.

No credentials live in this repository. Backend secrets are Fly secrets;
`PB_ENCRYPTION_KEY` is the irreplaceable one (it decrypts the settings blob
inside `data.db`) and is described in the migration runbook.

## Health and readiness

- `GET /api/health` — PocketBase's built-in health endpoint; also the Fly HTTP
  health check (`fly.toml`, 300s grace period so boot migrations are not
  interrupted mid-run).
- `GET /api/detour/ready` — custom readiness route in `pb_hooks/main.pb.js`;
  returns `{ "ok": true }` with HTTP 200.

```sh
curl -fsS https://api.takedetour.app/api/health
curl -fsS https://api.takedetour.app/api/detour/ready
```

## Repository layout

- `pb_migrations/` — schema and seeds, in timestamp order (a migration runs once,
  so a shipped change means a new file, never an edit to an old one):
  - `1768100000_baseline_schema.js` — every collection the app owns, in one
    file. This replaced the entire previous migration history (~90 files of
    guide catalogue, itinerary model, and provenance tables that were
    seeded, amended, then swept away); its header explains why.
  - `1768100100_seed_founding_member.js` — the one founding account, so the
    founding circle has a first member. Password comes from
    `DETOUR_FOUNDER_PASSWORD`, or is generated and printed once to the deploy
    log.
  - `1768100200_seed_launch_selection.js` — the launch selection: five cities
    and the nine places Olga recommends, seeded as a complete recommendation
    chain (city → venue → place entry → recommendation) because visibility
    is derived from member signal, not set on the venue.
  - `1785315600_add_image_curation.js` — `community_place_images`, the screened
    member-photo lane.
  - `1785369600_survey_responses.js` — `survey_responses`, replacing
    `founding_feedback_responses` (whose columns were the questions); it
    migrates existing rows and drops the old table.
  - `1785801600_recommendation_photos.js` — moves a screened photo from the
    place to the recommendation that authored it.
  - `1785974400_first_place_notice.js` — `members.inviter_introduced_at`, the
    once-only marker behind the email a member's inviter gets when their first
    place lands. Backfills every member who already has recommendations, so no
    existing member's next place reads as their first.
  - `1786406400_place_endorsements.js` — `community_place_endorsements`, the
    been-and-loved mark: one row per member per place, readable only by its own
    member, projected to everybody else by the server.
  - `1786838400_guides.js` — `community_guides` and
    `community_imported_places`, a compilation a member pasted a link to, kept
    privately. One row per place per member across every guide, so two
    overlapping guides share a place rather than duplicating it; `guides` is a
    non-cascading multi-relation, and an empty one is a real state — a place kept
    after the guide it arrived on was removed.
- `pb_hooks/` — backend behavior: custom routes and record hooks (see below).
- `pb_public/` — optional static fallback assets served by PocketBase.
- `src/`, `index.html`, `vite.config.ts`, `wrangler.toml` — the frontend and
  its Cloudflare Worker config.
- `docs/` — design conventions, policies, verification reports, and the
  migration runbook.
- `scripts/` — `run-local-pocketbase.sh` (the local API), plus legacy
  validators (see "Legacy artifacts").
- `data/` — legacy guide CSVs (see "Legacy artifacts").
- `LOCAL_DEV.md`, `LOCAL_CIRCLES.md` — local-only logins and the local
  invitation graph. Nothing in them exists in production.
- Runtime data (`pb_data/`) lives on the Fly volume and is never committed or
  replaced on redeploy.

## Collections

Fifteen collections, all created or updated idempotently by the migrations
above, and nothing else — verified against production. There are no
platform-provisioned or otherwise unmanaged collections in the database.

| Collection | What it holds |
|---|---|
| `members` | every account (auth collection); readable only by the member it belongs to. A public signup carries pseudo, email, password and home city, plus an invitation code when there is one — `submitSignup` in `src/community/auth.ts` sends them together. No code means the member starts their own circle: `invited_by` stays empty |
| `invites` | issued invitation codes and who claimed them |
| `invite_requests` | requests to join, from the public form |
| `cities` | the destinations places route under, and how each presents |
| `venues` | place facts, occasion tags, and the publication marker (`published`, `published_at`, `suppressed`) — no awards, no guide sources |
| `community_place_entries` | the shared, normalized place identity a recommendation attaches to |
| `community_recommendations` | the recommendation itself — the only reason anything is public on Detour |
| `community_place_images` | member-supplied photos, screened, hanging off the recommendation that authored them |
| `community_place_endorsements` | been & loved: one member went somewhere on another's note and would send you too. Corroboration, never authorship — it publishes nothing and gates nothing |
| `community_guides` / `community_imported_places` | a compilation a member pasted a link to, kept privately. Not the catalogue: nobody has stood behind these, so they never touch `venues` and nothing about them is computed for another member |
| `community_shares` / `community_share_replies` | private member-to-member sends |
| `member_place_contributions` | the legacy curator-reviewed contribution lane |
| `detour_submissions` | the curator publication lane |
| `visit_evidence` | private proof a member actually went |
| `survey_responses` | survey answers, keyed by form id and form version |

Member data is not browsable: `members` is `id = @request.auth.id`, so any
surface showing one member something about another goes through an explicit
server projection. `GET /api/detour/circle` is that projection — see "The
invitation graph" in `AGENTS.md` before extending it.

## Backend routes and sweeps

Custom routes in `pb_hooks/` (the rest of the API is PocketBase's own
collection API, read-gated by collection rules):

```
GET  /api/detour/ready
GET  /api/detour/public-recommendations
GET  /api/detour/community/me
GET  /api/detour/community/place-locks
GET  /api/detour/circle
GET  /api/detour/circle/places?who=<ref>
GET  /api/detour/member-directory
GET  /api/detour/network-discovery
GET  /api/detour/place-detourists
GET  /api/detour/member-place-contributions
POST /api/detour/places/{place}/endorsement
POST /api/detour/invite-request/{form}
POST /api/detour/survey/{form}
GET  /api/detour/curation/images
POST /api/detour/curation/images/{id}/approve
POST /api/detour/curation/images/{id}/reject
POST /api/detour/curation/members/{id}/founding-verification
POST /api/detour/curation/submissions/{id}/publish
POST /api/detour/curation/submissions/{id}/unpublish
```

Hooks live in `pb_hooks/`, but only files named `*.pb.js` are loaded and can
register anything — `main.pb.js`, `invite_requests.pb.js`,
`first_place_notice.pb.js` (one email to a new member's inviter when their first
place lands, claimed once via `members.inviter_introduced_at`),
`password_reset.pb.js` (rewrites the reset email so its link opens the membership
card at `?reset=<token>` instead of the admin console), and
`place_endorsements.pb.js` (the been-and-loved toggle, and the sweep that tells
the recommender whose note was acted on). Every other `.js` file there is a
module the loaded hooks `require()`.

**Scheduled jobs.** Five are registered in `pb_hooks/main.pb.js` — daily launch
numbers, nightly geocode, nightly cover, hourly LLM web discovery, and the
fifteen-minute image-screening retry — each with its reasoning recorded where it
is registered. A sixth, `detour_endorsement_notices`, lives in
`pb_hooks/place_endorsements.pb.js`: every quarter hour it mails the members
whose notes were acted on, one email per recipient however many places it
covers, claiming each row before sending so a notice can never go twice.

Place enrichment still happens **at publication**: the publish path calls the
geocode, OSM-facts, and cover-image helpers directly, so a newly published place
gets its coordinates, discovered links, and cover image then. What is gone is
every retry and backfill — a lookup that fails at publication is not tried
again, places OSM cannot resolve never gain a website/Instagram/address/pin
(the LLM web-discovery helper is no longer called at all), a photo whose
screening failed on a transport error stays `screening_failed`, and launch
numbers are no longer emitted. Reinstating a sweep means re-adding a `cronAdd`
in `pb_hooks/main.pb.js`; the helpers are all still exported. Never call them
from a boot migration — they do outbound HTTP.

Backend environment variables read by hooks: `OPENAI_API_KEY`,
`DETOUR_IMAGE_CURATION_MODEL`, `DETOUR_OPENAI_MODEL`, `DETOUR_OPENAI_BASE_URL`,
`DETOUR_NOMINATIM_BASE_URL`, `DETOUR_COVER_ALLOW_PRIVATE_HOSTS`,
`DETOUR_FOUNDER_EMAIL`, `DETOUR_FOUNDER_PASSWORD`, `AGENTMAIL_API_KEY`,
`AGENTMAIL_INBOX_ID`, plus one legacy dashboard-notification endpoint pending
removal (see "Legacy artifacts").

## Local development

Browser and backend environments are separate:

- `.env.local` — `VITE_POCKETBASE_URL=http://127.0.0.1:8090`.
- `.env.backend.local` — backend-only secrets such as `OPENAI_API_KEY`.
  Gitignored, and must never use a `VITE_` prefix.

Copy `.env.backend.local.example` to `.env.backend.local`, add the key, then
run the two halves in separate terminals:

```sh
npm run dev:api   # PocketBase on :8090 with this repo's migrations + hooks
npm run dev       # Vite on :5173
```

`npm run build` type-checks (`tsc --noEmit`) and writes static assets into
`public/`. Logins for the local database are in `LOCAL_DEV.md`.

Image screening decides most photos outright. Safety moderation runs first and
a flagged image is `auto_rejected` and never seen again. What passes goes to the
relevance classifier in `pb_hooks/image_curation.js`, and `relevant` is
`approved` on the spot — published with the member's own recommendation,
superseding whatever photo that recommendation had before. Only `uncertain` and
`irrelevant` land in the founding circle's review queue, along with anything
that could not be screened at all: when OpenAI is unavailable the photo is
marked `screening_failed` and the 15-minute retry sweep picks it up, and a
founder can approve it by hand in the meantime. Both paths apply the approval
through `applyApproval`, so the one-photo-per-recommendation rule lives in one
place.

## Deployment

Deploys are CI, not manual. Work happens on `dev`; **merging `dev` into `main`
is the release**, and `.github/workflows/deploy.yml` runs on every push to
`main` (or on `workflow_dispatch`). Deploys are queued, never cancelled, so the
Worker and the API cannot end up on mismatched versions.

The workflow has two jobs:

- **Worker (`detour-web`)** — `npm ci`, `npm run build`, then a bundle guard
  before deploying: the build must reference `api.takedetour.app` and must not
  contain a localhost URL or the decommissioned old backend host. (Vite loads
  `.env.local` during production builds, so a stray local env file would
  otherwise silently bake localhost into the shipped bundle.) Then
  `wrangler deploy`, then a smoke test of `takedetour.app` and
  `api.takedetour.app/api/health`.
- **PocketBase (`takedetour-api`)** — only runs when something the backend
  image actually contains has changed. A Fly deploy restarts the machine, and
  PocketBase is a single node on a single volume, so the API is briefly down;
  the guard avoids paying that for a frontend-only change.

Migrations apply at boot, before PocketBase serves. The rules that matter
(never edit an applied migration, guard every create, keep seeds bulk and
idempotent) are in `AGENTS.md` — a migration that throws is never recorded as
applied, so it re-runs on the next boot and can boot-loop the app.

## Verifying a change

A change is not done until the real data path works on the deployed backend.

1. Reproduce and fix locally against the real PocketBase binary first. A clean
   local run applies every migration from scratch and will pass even when the
   live volume is broken — it does not prove a schema change reached
   production.
2. After deploy, confirm the migration applied to the **live** database, not
   just that it was committed: check the live schema and run filtered record
   counts.
3. Smoke-test the public read path with a real unauthenticated client call —
   superuser-level inspection bypasses collection API rules and cannot prove
   it:

   ```sh
   curl -fsS "https://api.takedetour.app/api/collections/venues/records?perPage=1"
   ```

4. For a write path, create and then delete one record using the fixed fake
   value `smoketest@pocketbase-check.invalid`, and re-fetch to confirm the
   delete took effect. Never leave a test record in production.

Note that seed migrations reproduce most of a production-looking database on a
clean volume (9 venues, 5 cities, 1 member, 9 recommendations), so those counts
prove nothing about a restore. The collections that discriminate are the
user-generated ones.

## Frontend conventions

Visual-design conventions — layout surfaces, the sticker button system, map pin
colors — are documented in `docs/frontend-design-conventions.md`. Recommendation
cards must render through `groupedRecommendationCardMarkup` in `src/network.ts`
on every surface; see `AGENTS.md`.

Do not mention PocketBase in user-facing copy, and do not link to the admin UI.

## Cities are data-driven

The public `cities` collection is the authority on which cities exist and how
they present. The frontend holds no hard-coded city list (`src/cities.ts` only
defines the config shape, fallback copy, and slug helpers), so **adding a city
is a content operation — no frontend deploy**:

1. Create a `cities` record: `name`, unique `slug`, `country`. That is the
   minimum; the city appears in the chooser as soon as at least one published
   venue's `city` field matches its `name`.
2. Optional editorial fields: `title`, `tagline` (may contain the literal
   `{count}` placeholder, replaced with the current venue count), `footer`,
   `meta_title`, `meta_description`. Blank fields fall back to neutral copy
   generated from the city name.
3. A city starts as a **list-first preview**. To make it map-led, set
   `presentation = map` **and** supply `center_lat`, `center_lng`, `zoom`, plus
   the conservative metro box `bounds_lat_min`, `bounds_lat_max`,
   `bounds_lng_min`, `bounds_lng_max` (used only to gate visitor-position
   framing). If any map field is missing — or the centre is the `0/0` sentinel
   — the frontend keeps the city list-first rather than render a broken map.

Cities derived only from venue `city` strings (without a `cities` record) still
route venues correctly but are never offered in the chooser, so a typo in one
venue row cannot publish a city.

## Coordinates and location policy

Coordinates are filled by the geocode sweep from OpenStreetMap/Nominatim, never
invented. `0/0` is a non-location sentinel and must never be rendered as a map
pin. Map tiles visibly attribute OpenStreetMap (© OpenStreetMap contributors,
ODbL 1.0).

The user may be offered the browser geolocation prompt. If they deny it, or
geolocation is unavailable, the frontend falls back to a city-oriented view
**without fabricating a location** — no fake pin, no assumed user position.

## Community publication operator route

Curators must use the protected publication route after completing the checks
in `docs/community-curation-policy.md`. Do not set a submission to `published`
in the admin interface, and do not create a public venue by hand.

- `POST /api/detour/curation/submissions/{id}/publish` requires a PocketBase
  superuser token. The submission must already be `approved`.
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
- `POST /api/detour/curation/submissions/{id}/unpublish` takes the same token.
  It disables the linked public community-selection event and returns the
  private submission to `approved` for correction or rejection; it does not
  delete the venue or the submission.

Before treating a publication as complete, make one unauthenticated catalogue
request and confirm the public venue carries `Detour community selection` with
no submission, member, note, evidence, curator note, audit reference, or source
lead exposed.

## Legacy artifacts

Detour used to be a catalogue of external guide awards — Guía Repsol, Michelin,
50 Top Pizza, the World's 100 Best Coffee Shops — with per-source provenance
tables, an award collection, an editorial lane, and a `detours`/`places`
itinerary model. All of it was removed: the baseline migration replaced that
history, and no collection, hook, or frontend surface reads any of it now.

Left in the tree for provenance only, and safe to ignore when working on the
app:

- `data/` — the guide CSVs and generated dedupe/unified JSON.
- `scripts/validate-*.mjs`, `scripts/build-madrid-multi-source-venues.mjs`, and
  their `npm run validate:*` / `build:multi-source-madrid` entries — they read
  `data/` only, and nothing at runtime reads them.
- The guide-era reports and rights memos in `docs/` (Repsol, Michelin Madrid /
  Paris / San Francisco, pizza and coffee, multi-source deduplication, location
  backfill).

These describe a data model that no longer exists. Do not reconcile the running
app against them, and do not treat their counts as expected production numbers.

Three leftovers from the old managed platform are still live in the code and
each needs a decision rather than a docs edit: a dashboard-notification endpoint
the record hooks still POST to, the Nominatim contact address on a mailbox being
shut down, and a hard-coded agent-account email filter in the
public-recommendation queries. All three are itemised with their call sites
under Phase 6 of `docs/2026-07-31-self-hosting-migration-runbook.md`.

The dated verification reports and QA audits in `docs/` are point-in-time
records of work done before that migration. They are left verbatim on purpose:
editing them would falsify the record.

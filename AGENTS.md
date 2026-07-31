# Agent instructions

Detour is a PocketBase backend and a Vite/TypeScript frontend, both deployed
from this repository. `README.md` is the operator runbook — what the app is,
which collections exist, how it deploys. This file is the rules for changing it:
the failure modes this stack actually has, and the product decisions that must
not be refactored away.

Add future project-specific rules here.

## Stack and boundaries

- PocketBase owns the backend and persistence. Do not add another backend
  runtime or database (Express, Workers, D1, Postgres, Rails, Django, Go,
  Python) unless the user explicitly asks to leave this stack.
- Schema changes belong in `pb_migrations/`. Backend behavior belongs in
  `pb_hooks/`. Optional static fallback assets belong in `pb_public/`.
- Frontend source is TypeScript and must build into `public/`, which the
  Cloudflare Worker serves. Do not rely on PocketBase serving the production
  frontend.
- Browser code must read the API base from `VITE_POCKETBASE_URL`. Never assume
  the frontend and API share an origin — they do not.
- Do not commit `pb_data/`; it lives on the Fly volume. Never replace or remove
  that volume during a deploy. Keep `fly.toml`, `Dockerfile`, and
  `wrangler.toml` in the repo.
- Do not mention PocketBase in user-facing copy; it is an internal
  implementation tool. Do not add user-facing links or navigation to the admin
  UI.
- Detour charges nobody. Do not add a paywall, pricing surface, subscription
  gate, or checkout flow unless the user explicitly asks for one.

## Migration safety

Migrations run against persistent data, at boot, before PocketBase serves.
Never assume the database is empty.

- A migration file runs **once**. PocketBase records each applied migration by
  file name in the internal `_migrations` table and never re-runs it, so editing
  a migration that already ran on the live volume is a silent no-op — the change
  never reaches the running database. To change shipped schema, add a NEW file
  with a later timestamp.
- A migration that fails partway is NOT recorded as applied, so it runs again on
  the next boot. One that already created a collection, field, or index before
  failing will then abort startup with "already exists" and the app never comes
  up. Every operation must be safe to re-run: guard collection AND index
  creation with existence checks, and never blindly create an index a prior
  partial run may have created.
- Before creating a collection, check whether it exists; if it does, update it.
- The baseline calls `importCollections(…, false)` deliberately, so a collection
  no migration lists is never dropped. Keep it that way — it is what makes the
  baseline safe to re-run against a live volume.
- The migrations are the complete inventory: as of 2026-07-31 production holds
  exactly the collections they declare, plus PocketBase's own `_`-prefixed
  system tables. If you find another one, it was created by hand in the admin UI
  and is not part of the app.
- Do not reset or delete existing collections or data unless the user explicitly
  asks for destructive behavior.

Fields use typed constructors. Assigning plain `{ name, type }` object literals
to `.fields` is pre-0.23 syntax and will crash `app.save` on this version:

```js
migrate((app) => {
  let collection;
  try {
    collection = app.findCollectionByNameOrId("cards");
  } catch {
    collection = new Collection({
      name: "cards",
      type: "base",
    });
  }

  collection.fields = [
    new TextField({ name: "title", required: true, max: 160 }),
    new NumberField({ name: "amount", required: true, min: 0 }),
  ];

  // Add or update indexes/rules here.
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("cards");
  return app.delete(collection);
});
```

## Seeding

A slow seed blocks startup and fails the health check, which marks the deploy
failed and boot-loops — the migration never records as applied, so it re-runs on
every restart and never converges.

- Seed with bulk multi-row inserts, never one row at a time. Build a single
  batched `INSERT ... VALUES (...),(...),...` with `app.db()`. A per-row loop
  over hundreds of rows will time out on the shared VM.
- Make the seed a no-op on redeploy: guard on existing data rather than
  re-inserting.
- Never do outbound HTTP in a boot migration. Enrichment (geocoding, cover
  images, web discovery) happens at publication, from the request path, once the
  app is serving.
- Do not seed large or derived datasets at boot at all. Load them lazily at
  runtime instead.

## Backend hooks

PocketBase runs each hook handler in its own isolated JavaScript VM at request
time. A handler callback — passed to `routerAdd`, `onRecordCreateRequest`,
`onRecordAfterCreateSuccess`, and similar — **cannot see anything declared at
the top level of the hook file**.

- Do not call a module-scope helper from inside a handler. At request time the
  helper is not defined and the request fails with an opaque generic 400.
- Define helpers inside the handler, or `require()` them INSIDE the handler
  body:

```js
routerAdd("POST", "/api/detour/example", (e) => {
  const { helper } = require(__hooks + "/utils.js");
  // use helper(...) here
});
```

- Keep shared helpers in a file under `pb_hooks/` and `require()` them inside
  every handler that needs them. Never rely on closure over the hook file's
  top-level scope.

**Only `*.pb.js` files register anything.** PocketBase loads hook files by
filename pattern, so `routerAdd`/`onRecord*`/`cronAdd` calls in a plain `.js`
file under `pb_hooks/` are never seen — the file simply never runs, the route
404s or the event never fires, and nothing is logged. That is exactly why the
plain `.js` files here (`community_waitlist.js`, `mailer.js`, `member_profile.js`
and the rest) contain no registrations at all: they are modules other hooks
`require()`. A file that registers a hook must be named `<name>.pb.js`.

## Debug locally, verify on live

A Fly deploy restarts the machine and briefly takes the API down. Do not use
live redeploys as a debug loop.

- Reproduce and fix against the real PocketBase binary locally (`npm run
  dev:api`), then exercise the actual request against `127.0.0.1:8090`.
  Migration failures and hook errors surface only when a request hits a running
  server — a passing build or type-check will not catch either.
- A fresh local data dir applies every migration from scratch and will pass even
  when the live volume is broken, because live already recorded the old
  migrations and skips them. **A clean local run does not prove a schema change
  reached production.**
- After deploying, confirm the migration actually applied to the live database
  rather than merely being committed: check the live schema and run filtered
  record counts (admin UI, or an authenticated superuser API call).
- Superuser-level inspection bypasses collection API rules, so it cannot prove
  the public path works. Smoke-test that once with a real unauthenticated
  client call.
- For a write path, create and then delete one record through the live API,
  using the fixed fake value `smoketest@pocketbase-check.invalid` (the
  `.invalid` TLD is reserved by RFC 2606 and can never belong to a real user).
  Reusing one value means a record a previous run failed to clean up is obvious,
  and a create failing with "already exists" tells you a stale smoke-test record
  is still there — delete it first. Re-fetch after deleting: a 200/204 is not
  proof the delete took effect. Never leave a test record in production.
- Never deploy temporary diagnostic routes, hooks, or log statements just to
  look at data — that costs two deploys per look.

## Recommendation card consistency

- Render recommendation cards on home, destination, and Explore surfaces through
  `groupedRecommendationCardMarkup` in `src/network.ts`.
- One published place renders as one card, with one representative
  recommendation note and a combined member/date byline. The place page owns the
  complete list of notes.
- Do not add another recommendation-card renderer, and do not expand multiple
  notes inside a card. Extend the shared renderer when the treatment changes.

## The invitation graph

- The `members` collection is readable only by the member it belongs to
  (`id = @request.auth.id`). Any surface that shows one member something about
  another must go through an explicit server projection — never a client-side
  list, filter, or `expand`.
- `GET /api/detour/circle` is that projection: the caller's inviter, the members
  they invited, the members one hop out with the connecting member named, the
  founding circle, and the caller's invitation allowance. Per person it returns
  one name (the pseudo, falling back to display name — members have one name on
  Detour and it is the pseudo), self-declared home city, published-place count,
  the cities of those places, and the latest published place. Nothing else: no
  email, status, membership marker, or record id.
- `GET /api/detour/circle/places?who=<ref>` opens one circle member's published
  recommendations for the My Circle panel. The person is addressed by positional
  reference only (`inviter`, `invited:<n>`, `second:<n>`, `founding:<n>`),
  re-derived server-side from the caller's own graph with the same ordered
  queries — ids never cross the wire in either direction, and a caller cannot
  address anyone outside their circle. Notes follow the discovery-feed policy:
  the member's own always; others' only while verified and discovery-visible,
  otherwise the response is `private: true` with no items. One-hop rows carry a
  positional `connector_ref` (`inviter` or `invited:<n>`, an index into the
  caller's own invited list) so the client can draw the graph without a member
  id entering the payload.
- Keep it to one hop. Extending the walk, or adding a field to the projection,
  widens what every member can see about every other member — treat it as a
  product decision, not a refactor.

## The new-member flow

Redeeming an invitation does not land on the account page. `?view=welcome`
(`src/onboarding.ts`) owns the first visit and asks one thing per screen:
invitation card (email, password, code) → pseudo and city → the place you keep
going back to → "got another?" up to three → the feed.

- **The account is created on the second screen, not the first.** A public signup
  must carry a pseudo and a home city, so the card's email and password are held
  in module state until the pseudo-and-city screen can send all four together.
  This is also why an invalid or already-claimed code surfaces on that second
  screen: the invitation is only spent there.
- **The place step is the ordinary recommendation path.** Same
  `community_recommendations` create, same `place_intent` collision question, same
  publication rule — which is what puts the member's own card in the feed they
  land on. Everything optional (category, occasions, links, photo) is deliberately
  absent and stays available on the recommendation's own line. Do not fork a
  private submission path for onboarding.
- **Autocomplete is the catalogue and nothing else.** Suggestions come from the
  places Detour already has, client-side; a place nobody has added is typed and
  enriched after publication like any other. This screen makes no external lookup.
- **Three places, and stopping after one is the expected outcome.** The offer to
  add another is an invitation, not a quota; do not gate the feed on a count.
- **The inviter is told once.** `pb_hooks/first_place_notice.pb.js` emails the
  member's inviter when their first place lands, claiming
  `members.inviter_introduced_at` before sending so it can never send twice.
  Fixture and smoke-test accounts (`.invalid`) and internal members are excluded
  on both sides of the edge.

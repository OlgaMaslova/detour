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
going back to → "got another?" up to three → My detours.

- **The account is created on the second screen, not the first.** A public signup
  must carry a pseudo and a home city, so the card's email and password are held
  in module state until the pseudo-and-city screen can send all four together.
  This is also why an invalid or already-claimed code surfaces on that second
  screen: the invitation is only spent there.
- **The place step is the ordinary recommendation path.** Same
  `community_recommendations` create, same `place_intent` collision question, same
  publication rule — which is what puts the member's own place on the list they
  land on. Everything optional (category, occasions, links, photo) is deliberately
  absent and stays available on the recommendation's own line. Do not fork a
  private submission path for onboarding.
- **Autocomplete is the catalogue and nothing else.** Suggestions come from the
  places Detour already has, client-side; a place nobody has added is typed and
  enriched after publication like any other. Nothing on this screen queries an
  external place database for suggestions.
- **A pasted map link is read, not looked up.** The optional link field posts to
  `/api/detour/place-link`, which parses the name and coordinates out of the URL
  itself (`pb_hooks/map_links.js`) and reverse-geocodes the city from those
  coordinates. The only outbound request in the common path is following a short
  link — `maps.app.goo.gl/…` is what the mobile share sheet produces and it
  carries nothing to parse. No Places API is called, so no result arrives with
  storage or attribution terms attached; keep it that way. The field fills the
  form in and nothing more: every value stays editable, an unreadable link
  returns `resolved: false` and changes nothing, and no part of writing a
  recommendation may ever be made to depend on a link having been read.
- **Three places, and stopping after one is the expected outcome.** The offer to
  add another is an invitation, not a quota; do not gate anything on a count.
- **The inviter is told once.** `pb_hooks/first_place_notice.pb.js` emails the
  member's inviter when their first place lands, claiming
  `members.inviter_introduced_at` before sending so it can never send twice.
  Fixture and smoke-test accounts (`.invalid`) and internal members are excluded
  on both sides of the edge.

## The signed-in landing

**My detours is what a member opens on.** Not the feed. `?` with a session
renders `renderLanding` in `src/main.ts`; the feed lives at `?view=feed`, and the
nav reads **My detours · Feed · Explore · My Circle**. Specified in
`docs/landing-spec.md`.

- **Why not the feed.** A feed promises something new every time it loads, and at
  a few places a week that promise fails on most visits — each failure teaching
  the member not to come back. The surface most likely to be empty is the worst
  possible thing to open on. Two surfaces never fail that way and both are here:
  the member's own record, which is never empty once they have done one thing,
  and a question, which does not depend on supply at all.
- **One thing to answer, or nothing.** The slot above the tabs takes the first
  that applies — an ask, else a triage card, else a "been yet?" follow-up, else
  the week's prompt, else nothing. **Never a stack.** The two that exist are
  resolved server-side in `/api/detour/community/me`, in that order, and the
  order is load-bearing: `resolvePlacePrompt` advances the ladder as a side
  effect of returning a rung, so it must only be reached when the slot is still
  free. Nothing is a legitimate outcome — an invented prompt is the same broken
  promise as an empty feed, one layer up.
- **The feed does not ask for anything any more.** The first-place card and the
  eligibility request behind it are gone. A second ask one click from the first
  is the stack the spec rules out.
- **Nothing else goes on this screen.** No stats, no streaks, no comparison to
  other members, and never an invented figure. "3 new places this week" when
  there were none is the thing this landing exists in opposition to.
- **Four tabs, grouped by state**, in ladder order with the inbox last:
  Recommendations · Been & loved · Wanna go · Private shares. A member with
  nothing still sees all four; their empty states say what would put something
  there rather than describing the absence, and Recommendations' empty state is
  the by-heart question with the form already open under it. Grouping by city
  instead was considered and set aside — see the spec; it comes back when
  Send-this is built, because "My Annecy" is the sendable artifact and a
  state-grouped list has nowhere to put it.

### The triage card

A member who has added nothing opens a blank record, and "add a place" is exactly
the demand the research says does not exist — people recommend when they are
asked, about something. So the slot asks about something: a real place from their
own city, somebody else's note in full, and *Know this place?*
(`pb_hooks/landing_triage.js`, `src/triage.ts`).

- **The question is about the place, never about the member who wrote it.** That
  is what keeps it from reading as social pressure, and it matters most while the
  other name on the card is nearly always the founder's.
- **Selection and the endorsement route share a visibility clause.** The card is
  the newest published place in their home city that they have no state on — no
  recommendation, no mark, no save — **and whose fronting note they can see**.
  That last clause is not optional: `/endorsement` refuses a mark where the
  caller cannot see a note, so a card picked on city and recency alone would
  sometimes offer a **Been & loved it** button that 400s on tap.
- **No card from a city they have no connection to.** That is noise with a name
  on it. An empty city falls through to the plain prompt instead.
- **Three cards per session, then it stops.** This is the real risk in the
  mechanic: Been & loved is public and it emails somebody, so a member triaging
  twenty places in ninety seconds produces noise indistinguishable from signal on
  the one surface where trust is the whole product.
- **Don't know it is not a failure.** It advances the card and records nothing
  about the member. The two one-tap answers sit together and *I'd recommend it
  myself* is a link beneath them — three matching buttons where one ambushes the
  member with a text field is a small betrayal they only fall for once.
- **Every answer goes through the route that owns it.** The card is a surface
  onto `/endorsement` and `/save`, never a shortcut around their rules.

## Wanna go

The private rung, below Been & loved: somewhere a member means to get to, seen by
nobody else, ever. `community_place_saves`, `pb_hooks/place_saves.js`,
`POST /api/detour/places/{place}/save`. Specified in `docs/wanna-go-spec.md`.

- **Fully private means fully private, and it is the whole design.** No count on
  a card or a place page, no aggregate anywhere, no projection into any response
  computed for another member, and **no notification** — the recommender is never
  told somebody saved their place. That last one is a real cost, accepted,
  because the alternative turns a private bookmark into a public signal by the
  back door. The test to apply to any change: *could a member learn anything at
  all about another member's saves, including that they exist?*
- **There is one read path and it returns the caller's own rows.** No server
  projection exists for this collection and none should be added — that is the
  difference between it and `community_place_endorsements`, which is
  scoped-public and needs one. There is deliberately **no index on `waitlist`
  alone**, so counting saves per place is not even cheap.
- **One state per place is a display rule, not a storage rule.** Marking Been &
  loved or writing a recommendation takes a place off the Wanna go tab and leaves
  the row alone — `ownSaves` filters superseded rows out, it does not delete
  them. Withdraw the mark or delete the note and the save comes back where the
  member left it. Only an explicit Remove deletes, because only that is the
  member saying so; deleting on the way up would make a mis-tap destructive. A
  *new* save on a place they have already answered for is still refused.
- **Quiet wherever it appears, and gone once pressed.** It competes with Been &
  loved, which is the one worth encouraging, so it is a secondary control — and
  once a place is on the list the control disappears rather than becoming a
  pressed state, the same treatment the mark above it gets. Removal lives on My
  detours → Wanna go, and takes no confirmation: a confirmation dialogue on a
  bookmark is an insult.
- **A private share is not a save.** A share lands in the inbox and does not join
  the recipient's list — it is somebody else's intention for them, and filing it
  automatically would put words in their mouth and inflate a list they did not
  build. The inbox's one-tap Wanna go is the member choosing, and `source:
  "share"` records that it was.

## Been & loved

The one-tap rung below writing a note: a member who went somewhere on another
member's recommendation and would send you there too. Specified in
`docs/been-and-loved-spec.md`; the collection and route are called
**endorsement** so a copy revision never has to move the schema.

- **Both words are load bearing.** *Been* alone states a fact and takes no
  position, and silence is Detour's only disagreement mechanism — a marker that
  meant merely "I was here" would leave a member who went and disliked the place
  with no honest move, and would make the absence of a mark unreadable. *Loved*
  alone does not assert presence. Do not shorten the phrase to either half.
- **One state per place, moving forward.** Saved → Been & loved → Recommended.
  Writing a note supersedes the mark and removes it in the same pass as the
  recommendation is created (see the create hook for `community_recommendations`
  in `pb_hooks/main.pb.js`). That is also what enforces "never on your own
  place" — the two states cannot be held at once — and it is what stops one
  member appearing twice on the same place, once under `BEEN & LOVED` and once
  under `RECOMMEND`. A place that inflates like that is a place this catalogue
  cannot afford.
- **Corroboration, never authorship.** It does not publish a place, does not
  contribute to `signal_count` or `detouristCount`, and never decides who can
  see anything. It is not a rating: there is no counterpart, no score, and
  nothing may be ordered by it.
- **Global count, scoped names, and the clause that matched.** The count is
  every mark from every circle; the names are only the members the caller may
  see, each carrying `in_graph` so the copy says "in your circle" when the graph
  matched and never when the founding tier did. A caller who can see the place
  but none of its endorsers gets the count and no names — that is correct, not
  degraded. `community_place_endorsements` is readable only by the member each
  row belongs to; everybody else's view comes from the server projection in
  `pb_hooks/place_endorsements.js`, folded into `/api/detour/place-detourists`.
  A client-side list over that collection would let a member enumerate who has
  been where, which is the invitation graph by another route.
- **Removal is on the member's own list, and only there.** My detours → Been &
  loved gives each place a card with a Remove; the place page still offers no
  undo, because a control offering to reverse a settled fact on a public page
  invites a second thought nobody asked for. The route always toggled, so this
  is a surface rather than a mechanism.
- **The notification is the point.** One tap turns a contributor's silence into
  a named member saying *I went, and you were right*, and it goes to the
  recommender whose note was acted on — not to the place's other participants.
  Batched per recipient by `detour_endorsement_notices`, with `notified_at`
  claimed before the send.
- **Not in the feed.** "Anna has been somewhere" is not news, and a feed at this
  supply cannot afford filler that looks like activity.

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

## The signed-out visitor

**The founding circle is a visitor's circle.** They have no invitation graph, so
there is no relational clause to apply — what they get is the one tier that
already reaches every member at any distance, and nothing else. Everything a
member can browse is open to them: Explore, the country and city pages, the map,
the feed, and the place pages with the notes and photographs on them.

- **Scope, not a gate.** There is no client-side membership check on any browsing
  surface, and adding one would be the bug. `visibleToCaller` is the single filter
  (`allVenues` in main.ts), and it is derived from the server's answer for whoever
  is asking. A surface that asks "is there a session?" before deciding what to
  show has taken a second opinion about visibility.
- **Three public routes, one rule.** `/api/detour/place-detourists` (which places
  are on the list), `/api/detour/public-recommendations` (the notes), and the
  anonymous branch of `/api/detour/network-discovery` all restrict a signed-out
  caller with `founding_cap.js`'s `foundingMemberSql`. They must agree: a note
  offered by one route about a place another route withheld opens onto a page
  saying the place does not exist.
- **The empty caller id must never reach `circle_scope.js`.** `graphMemberSql`
  compares `m.invited_by = {:caller}`, and against `""` that matches every
  unparented account — an anonymous caller would silently acquire a circle. The
  visitor branches swap in `foundingMemberSql` and bind no caller at all.
- **`scope` on the payload is load-bearing.** `place-detourists` answers a member
  with `"circle"` and a visitor with `"founding"`, and each loader in data.ts
  refuses the other. Neither may fall back to the `published` marker when the
  route fails: that would answer a caller entitled to a fraction of the catalogue
  with all of it. The load fails whole and the reader retries.
- **Published is not a visitor's list.** It is the precondition for anyone outside
  the recommenders' circles reading about a place at all, and it is still what
  resolves a shared link to a place nobody in the reader's scope recommended (see
  `outsidePlaceRoute`). That page states the facts and shows no note, for a
  visitor and a member alike.
- **What an account is still for.** Writing anything — recommending, Been & loved,
  Wanna go, sharing — plus My detours and My Circle. Those two are not gated
  previews, they are surfaces about the reader themselves, and a visitor is not in
  them. `chrome.isMember` in place.ts is the one flag for this — it replaced a
  `canExplore` that conflated browsing with acting, and nothing should conflate
  them again.
- **A visitor is one signup away from an account, not one invitation away.** See
  "Two doors" below; every visitor surface carries `visitorChoiceMarkup`.
- **A visitor is never told they are in a circle.** Their `circle` counts are
  always zero and their `in_graph` is never set, so the copy says "founding
  member" and never "in your circle". `endorsementSignals` names them founding
  members only, on the same terms a member is named the people they can see.

## Two doors, and what separates them

Detour no longer grows only by invitation. **An account can be created with no
code at all** — the "Start your circle" path — and the difference between the two
doors is exactly one field: `invited_by`, which is the graph edge.

- **An open signup joins nobody's circle; it starts one.** `invited_by` and
  `redeemed_invite` stay empty, `community_status` is `verified` like any other
  account, and the member holds the ordinary ten invitations. What they read is
  the founding circle plus their own people. What they write reaches their own
  people and nobody else. There is no third membership tier and no reduced
  account — resist adding one, because the reach is already bounded by the graph
  and a second status would have to be honoured by every read path separately.
- **One submit path serves both cards** (`submitSignup` in src/community.ts) and
  one create hook serves both payloads (the `members` create hook in
  `pb_hooks/main.pb.js`). They differ only where the code is read. Two copies is
  how the two would quietly stop agreeing about what a pseudo is.
- **An empty `invited_by` is a represented state and the graph already handles
  it** — the Founder has one. `graphMemberSql`'s COALESCE guard on the sibling
  branch is what stops two parentless members reading as each other's siblings,
  and it is now load-bearing for every open signup rather than for one seeded
  account. Do not "simplify" it away.
- **Founding seats stay unreachable this way.** `foundingSeatIdsSql` joins through
  `redeemed_invite` and requires the Founder as issuer, so an open account can
  never take one however early it arrives. Founding membership is still asked for,
  read, and answered by hand.
- **The two offers are presented side by side, never as a ladder.**
  `visitorChoiceMarkup` in src/network.ts is the one component: Start your circle
  (immediate, no approval) and Ask to become a founder (fifty seats, a wait, a
  real chance of a no), each with a sentence. A lone "request an invitation" told
  everybody who was never going to be one of fifty that there was no way in.
- **The founding-seat request is a page of its own** (`?view=founding`,
  `renderFoundingRequest`), not a panel on the landing. It is four questions and a
  list of what a seat gives you, and standing that permanently under the
  invitation page made it argue for one of fifty seats before anybody had said
  they wanted one. Every "Ask to become a founder" control is a link to that
  route; there is exactly one invite form in the app and it lives there. It is
  ungated on purpose — an ordinary member putting their hand up has the same thing
  to say as a visitor. It binds through `bindInviteRequestForm` rather than
  `bindNetworkDiscovery`, so a page with no feed on it fetches no feed.
- **"Invite-only" is no longer true and must not be written.** The copy says a
  circle grows by personal invitation, which is still exactly right about circles.
- **This removes the only gate on public account creation.** Rate limiting is a
  PocketBase setting rather than something in this repo; if abuse appears, that is
  the first place to look, not a new field on `members`.

## The way back in

A forgotten password is answered on the membership card, not on a page of its
own: `mode` in src/community.ts gains `forgot` (asks for the address, sends the
link) and `reset` (what the emailed link opens). Both are the same card as
sign-in, because somebody who cannot get in is already looking at it.

- **The reset email is rewritten in a hook, not in the collection template.**
  `pb_hooks/password_reset.pb.js` replaces the message on
  `onMailerRecordPasswordResetSend` so the link goes to `?reset=<token>` on
  takedetour.app. PocketBase's stock template links into the admin console, which
  the "no user-facing links to the admin UI" rule forbids and no member should be
  asked to trust with a new password. The hook is best-effort: it logs and falls
  through to `e.next()` rather than failing the send.
- **The token is a credential, so it never enters a link this app builds.**
  `routeHref` deletes `reset` from every href unconditionally, and
  `clearPasswordResetRoute` takes it off the address bar the moment it is spent or
  abandoned. The card holds it in module state for exactly as long as it needs it.
- **A routed token outranks a live session.** `communityPanel` shows the
  signed-out panel while one is present: clicking a reset link is a statement that
  the password needs changing, and a member with a stale session in that browser
  would otherwise be shown the member area and never reach the card. The confirm
  kills that session anyway — PocketBase rotates the token key with the password.
- **The reset signs the member in.** The confirm call returns no session, so the
  address is read from the token's own `email` claim (`emailFromResetToken`) and
  used with the password they just chose. A token that does not say costs the
  automatic sign-in and nothing else: the fallback is the sign-in card with the
  address filled in, exactly like the signup path's.
- **The Forgot card must never answer whether an address has an account.**
  PocketBase writes 204 either way and sends in the background, so the notice says
  "if … has a Detour account" and the only failures reachable there are about the
  request. Do not add a "no such member" message to it.

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
  the week's prompt, else nothing. **Never a stack.** The three that exist are
  resolved server-side in `/api/detour/community/me`, in that order, and the
  order is load-bearing: both `nextFollowUp` and `resolvePlacePrompt` stamp a
  record as a side effect of returning something, so each must only be reached
  while the slot is still free — calling one and discarding its answer burns a
  question nobody was shown. Nothing is a legitimate outcome — an invented prompt
  is the same broken promise as an empty feed, one layer up.
- **The feed does not ask for anything any more.** The first-place card and the
  eligibility request behind it are gone. A second ask one click from the first
  is the stack the spec rules out.
- **Nothing else goes on this screen.** No stats, no streaks, no comparison to
  other members, and never an invented figure. "3 new places this week" when
  there were none is the thing this landing exists in opposition to.
- **The feed route has two mutually exclusive treatments.** A member whose
  Recommendations tab has cards sees the compact **See what’s new in the
  community · See Feed →** row between the answer slot and tabs. A member with
  no recommendation cards does not see that row; they get the full **From the
  community** band below the tabs instead. While the private entry list is
  loading or failed, show neither rather than flashing the wrong treatment.
- **From the community**, under the tabs **only while the member's
  Recommendations tab has no cards**: three places from the circle, newest first,
  and a **See all** link to the feed (`communityStripMarkup` in
  `src/network.ts`). Day one is the one visit where "their own record is never
  empty" is false, and a first landing with nothing to read teaches the same
  lesson the empty feed did. The band disappears once that tab has a place.
  Never their own places, never a badge or a count, no "show more", and
  **absent entirely** — not a spinner, not an error, not an empty heading —
  while either the member's recommendations or the feed load, when either
  request fails, and when the feed holds nothing but the member's own. It
  honours the Founders'-places filter so *See all* never leads to a feed with
  fewer places than the strip.
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

### The been-yet follow-up

The rung below the triage card, and the reason Wanna go earns a place in the
ladder at all: saving does nothing for anybody else on its own, and what it buys
is the right to ask one question later — *You saved {place} a while back. Been
yet?* — at the point where the member finally has something to say
(`pb_hooks/landing_followup.js`, `src/follow-up.ts`).

- **It asks about a place the member chose**, which is the whole difference from
  the triage card next door. It needs no justification, cannot read as social
  pressure, and has no *Don't know it*: three answers, not four. **Been & loved
  it** and **Not yet** cost a tap; *Write your own* is the heavier link beneath.
- **Four gates, and each one is a decision.** No earlier than **three weeks**
  after saving — sooner tells a member their bookmarks are being watched. Only in
  a city they are plausibly in: their home city, or somewhere they have since put
  a place. Only where they can see a fronting note, the same clause the triage
  card carries and for the same reason. And it goes quiet when ignored — a week
  after being shown, **a month** after a *Not yet*, and **never again after two**.
- **`prompted_at` is stamped when the card is shown**, not when it is answered:
  that stamp is what stops the same question arriving on every page load, and it
  is also what hands the same card back for the rest of the visit. `declineFollowUp`
  moves it and raises `prompt_declines`, which is the only thing the *Not yet*
  route does.
- **One question per visit, and the slot empties behind it.** It is not a queue
  and it does not advance the way a triage card does — the triage card is filling
  a blank record, and this is asking a member to account for their own list.
  Twice in a sitting is an audit.
- **Nothing tells the server that Been & loved was the answer.** The mark takes
  the place out of the follow-up's own query, because a member who has been is no
  longer somebody to ask. The save row survives it, as ever — one state per place
  is a display rule, not a storage rule.

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
  nothing may be ordered by it. **Presentation merges it with recommendations:**
  the place-page signal shows one distinct-member total — recommendations plus
  Been & loved marks — with one recommendation mark. This is derived client-side
  and never changes the stored recommendation count or publication rules. The
  sum is safe because one member cannot occupy both states on one place.
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

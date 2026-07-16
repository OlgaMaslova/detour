# Detour community curation — independently reproducible public release

**Release verified:** 2026-07-16

**Public guide:** https://detour-app.supernaut.to/

**Backend:** https://sn-pb-repo-1297566350-6aebd3.fly.dev/

**Frontend source commit:** `24e14a438928426f60f585f9dbf191ae156953bf`

**Deployed release marker:** `detour-community-selection-2026-07-16-r1`

## Why this release record exists

The prior proof established the public data records and browser rendering, but
its cited `f2edf3f0bcbd85a0c791dc31d8e5c825608813e9` commit was a
documentation commit. An independent verifier therefore had no static way to
bind a live Worker response to the frontend release that renders the community
label.

This release fixes that gap without changing the private-data boundary. The
frontend document now carries a stable `detour-release` meta value. After the
Worker deployment below, an unauthenticated verifier can retrieve the public
entry document and confirm the marker before repeating the public API and UI
checks in this record.

The marker identifies the frontend release, not a user, submission, or curator
action. It contains no private data.

## Public publication contract

The live public selection is the canonical venue **Baldoria**, not a public
submission. The public catalogue relationship is:

- **Venue:** `venuepizza00001` — `Baldoria`, Madrid, Spain.
- **Public source:** `16x2e1bvp590use` — `name = Detour community`,
  `slug = detour-community`, `official_url = ""`.
- **Public attribution event:** `x6duwjjme161jy4` —
  `venue = venuepizza00001`, `source = 16x2e1bvp590use`, `year = 2026`,
  `level = Detour community selection`, `current = true`,
  `verification_status = verified`, and `source_url = ""`.
- **Private audit submission:** `mtx6p2lxr0b8632` — the controlled published
  submission. Its member, note, source lead, curator note, destination links,
  publication time, and audit value are not part of the public contract.
- **Private pending fixture:** `pjhvwl5zeubwsys` — the reserved
  `Editorial curation proof — not public` submission. It remains a non-public
  fixture and has no publication links.

The forward-only migration
`pb_migrations/1767982000_seed_community_publication_e2e_proof.js` creates or
reuses those safe records idempotently. The public award is created only after
the canonical venue and `Detour community` source exist. The private
submission is marked `published` only after the public venue and award have
been stored.

## Normal anonymous frontend path

On a normal anonymous page load, `loadLiveVenues` in `src/main.ts` fetches only
these public collections:

1. `venues`
2. `venue_awards`
3. `guide_sources`

It joins the public award's `source` and `venue` IDs locally. An award whose
source is `detour-community` or whose level is `Detour community selection` is
rendered as the literal **“Detour community selection”** label. The label is
shown in the map popup, catalogue card, recognition list, and selected-place
Community row. It is deliberately separate from Baldoria's 50 Top Pizza award
and is never linked as an external guide.

`detour_submissions`, `visit_evidence`, `members`, and private publication
audit fields do not participate in this anonymous catalogue load. The only
calls to `detour_submissions` are in `src/community.ts`, after a signed-in
verified member explicitly opens the member panel.

## Fresh anonymous verification results

The following checks were repeated against the live URLs on 2026-07-16 without
an authorization header.

- `GET /api/collections/venues/records/venuepizza00001` returned `200` and
  public Baldoria facts: `name = Baldoria`, `city = Madrid`, `country = Spain`,
  `category = Pizza`, plus the verified public address, official URL, and map
  coordinates.
- `GET /api/collections/guide_sources/records/16x2e1bvp590use` returned `200`.
  It contained only `Detour community`, `detour-community`, `current_year =
  2026`, and an empty `official_url`.
- `GET /api/collections/venue_awards/records/x6duwjjme161jy4` returned `200`.
  It linked only the exact public venue and source IDs above, with
  `level = Detour community selection`, `current = true`,
  `verification_status = verified`, and an empty `source_url`.
- `GET /api/collections/detour_submissions/records` returned `200` with
  `{"items":[],"page":1,"perPage":30,"totalItems":0,"totalPages":0}`.
- `GET /api/collections/detour_submissions/records/mtx6p2lxr0b8632` returned
  `404`.
- `GET /api/collections/detour_submissions/records/pjhvwl5zeubwsys` returned
  `404`.

No public response in the positive checks contained a member relation,
recommendation text, research/source lead, curator note, or publication audit
value.

An unauthenticated browser session also loaded the public guide and selected
Baldoria through the ordinary catalogue. The accessibility tree exposed:

- the catalogue card label `Detour community selection`;
- the card attribution `Detour community selection — Detour’s editorial
  selection`;
- the selected-place recognition label `Detour community selection`; and
- the selected-place Community row `Detour community selection — Detour’s
  editorial selection`.

The same browser session showed Baldoria's external 50 Top Pizza recognition
separately. No member panel was opened and no private collection was read.

## Release provenance and observed production verification

On 2026-07-16, the production browser-plus-API validator was observed passing
against the live frontend `https://detour-app.supernaut.to/?city=madrid` and
backend `https://sn-pb-repo-1297566350-6aebd3.fly.dev` at validation
implementation commit `c38d329966e26448edbb369c88a67044d8d510ed`. The deployed
frontend source remains `24e14a438928426f60f585f9dbf191ae156953bf`, identified
in production by release marker
`detour-community-selection-2026-07-16-r1`.

The exact command that passed in the Alpine runner was:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run validate:community-selection-live
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser` is only an
environment-specific override selecting the Chromium binary already installed
in that runner; it does not change the validation or the deployed release. The
portable standard command remains `npm run validate:community-selection-live`.

The following compact excerpt is verbatim from the observed passing run and
records the key browser, public API, and privacy assertions together with the
final success line:

```text
PASS: anonymous Madrid catalogue navigation succeeds
PASS: Baldoria is visible in the normal catalogue
PASS: catalogue visibly renders literal “Detour community selection”
PASS: catalogue accessibility name exposes literal “Detour community selection”
PASS: browser requests venues, venue_awards, and guide_sources
PASS: browser never requests detour_submissions
PASS: public Baldoria venue record is exact
PASS: public Detour community source record is exact
PASS: public community-selection award record is exact
PASS: private detour_submissions/mtx6p2lxr0b8632 is not disclosed
PASS: private detour_submissions/pjhvwl5zeubwsys is not disclosed
PASS: anonymous detour_submissions listing contains zero items
PASS: anonymous detour_submissions listing exposes no private fields
PASS: live Detour community-selection release is valid
```

## Deterministic executable validation

The repository owns a deterministic production validator at
`scripts/validate-community-selection-live.mjs`. Run it from the repository
root:

```sh
npm run validate:community-selection-live
```

If Playwright is installed but its Chromium browser binary is not yet present,
perform the one-time browser setup and retry:

```sh
npx playwright install chromium
npm run validate:community-selection-live
```

The validator targets the currently deployed production frontend and backend
directly:

- Frontend Madrid route: `https://detour-app.supernaut.to/?city=madrid`
- Backend: `https://sn-pb-repo-1297566350-6aebd3.fly.dev`
- Public venue endpoint:
  `/api/collections/venues/records/venuepizza00001`
- Public source endpoint:
  `/api/collections/guide_sources/records/16x2e1bvp590use`
- Public award endpoint:
  `/api/collections/venue_awards/records/x6duwjjme161jy4`

It launches a fresh, unauthenticated Chromium context on the normal Madrid
catalogue route, waits for the ordinary Baldoria card
(`venuepizza00001`), and asserts that the card is visible. It then verifies
both the visible badge text and the card's accessible name contain the literal
`Detour community selection`. The browser request capture asserts that the
normal anonymous collection path includes the public `venues`,
`venue_awards`, and `guide_sources` record endpoints and does not request
`detour_submissions`.

The same run fetches the three exact public records above and checks their
canonical public fields. It also tests both private submission IDs,
`mtx6p2lxr0b8632` and `pjhvwl5zeubwsys`, anonymously. Each individual private
record must return a denied/not-found status (`401`, `403`, or `404`) without
disclosing the record or private fields. The anonymous
`/api/collections/detour_submissions/records` collection request must either be
denied with one of those statuses or return JSON with zero items, zero total
items, and no private submission fields. The current live evidence recorded
above is the latter empty-list behavior with `200`, while both individual IDs
return `404`.

For the current production behavior, a successful run prints these concise
PASS categories in order (the listing line changes to
`anonymous detour_submissions listing is denied (HTTP <status>)` if production
uses an equivalent anonymous `401`, `403`, or `404` collection rule):

```text
PASS: anonymous Madrid catalogue navigation succeeds
PASS: Baldoria is visible in the normal catalogue
PASS: catalogue visibly renders literal “Detour community selection”
PASS: catalogue accessibility name exposes literal “Detour community selection”
PASS: browser requests venues, venue_awards, and guide_sources
PASS: browser never requests detour_submissions
PASS: public venues/venuepizza00001 returns 200
PASS: public venues/venuepizza00001 returns JSON
PASS: public Baldoria venue record is exact
PASS: public guide_sources/16x2e1bvp590use returns 200
PASS: public guide_sources/16x2e1bvp590use returns JSON
PASS: public Detour community source record is exact
PASS: public venue_awards/x6duwjjme161jy4 returns 200
PASS: public venue_awards/x6duwjjme161jy4 returns JSON
PASS: public community-selection award record is exact
PASS: private detour_submissions/mtx6p2lxr0b8632 is not disclosed
PASS: private detour_submissions/pjhvwl5zeubwsys is not disclosed
PASS: anonymous detour_submissions listing is denied or returns JSON
PASS: anonymous detour_submissions listing contains zero items
PASS: anonymous detour_submissions listing exposes no private fields
PASS: live Detour community-selection release is valid
```

This is a production check, not an admin or migration check: it sends no
authorization header, uses no PocketBase admin credentials, and succeeds only
through the same public frontend and anonymous API boundary available to an
independent verifier.

## Repeat these checks

Run these commands without an authorization header after the frontend
deployment. Each response is intentionally public except the two `404` checks.

```sh
BASE='https://sn-pb-repo-1297566350-6aebd3.fly.dev'
APP='https://detour-app.supernaut.to'

# Frontend release identity: expect the exact release marker.
curl -fsSL "$APP/" | grep -F 'detour-community-selection-2026-07-16-r1'

# Public venue, provenance source, and community-selection event: expect 200.
curl -fsS "$BASE/api/collections/venues/records/venuepizza00001"
curl -fsS "$BASE/api/collections/guide_sources/records/16x2e1bvp590use"
curl -fsS "$BASE/api/collections/venue_awards/records/x6duwjjme161jy4"

# Private collection lists no records to anonymous callers.
curl -fsS "$BASE/api/collections/detour_submissions/records"

# Both private records must remain unreadable: expect HTTP 404.
curl -sS -o /dev/null -w '%{http_code}\n' \
  "$BASE/api/collections/detour_submissions/records/mtx6p2lxr0b8632"
curl -sS -o /dev/null -w '%{http_code}\n' \
  "$BASE/api/collections/detour_submissions/records/pjhvwl5zeubwsys"
```

For the visual path, open the public guide anonymously, search for **Baldoria**
or choose it in the Madrid catalogue, and open the card. The literal accessible
text **“Detour community selection”** must be present. The page's standard
initial catalogue request must be limited to `venues`, `venue_awards`, and
`guide_sources`; it must not request `detour_submissions`.

## Result

Detour now has a live, externally checkable community-selection release:
Baldoria is publicly rendered through the ordinary venue/source/award data path
with the exact **“Detour community selection”** attribution, while the
underlying published audit record, the named pending fixture, and the complete
member review queue remain private.

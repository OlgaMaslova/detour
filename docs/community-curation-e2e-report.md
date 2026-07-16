# Detour community curation — end-to-end verification report

**Verified:** 2026-07-15  
**Backend:** https://sn-pb-repo-1297566350-6aebd3.fly.dev  
**Public guide:** https://detour-app.supernaut.to  
**Release commit:** `f2edf3f0bcbd85a0c791dc31d8e5c825608813e9`

## Scope

This proof verifies the complete public-catalogue path for a community
selection while preserving the private curation queue boundary:

1. a verified, non-interactive test member has three approved private visit
   records;
2. its private Baldoria recommendation reaches the curator-approved state;
3. publication creates one current public `Detour community` provenance event
   for the existing canonical Baldoria venue;
4. the private submission receives only private audit/destination links; and
5. the public map, catalogue card, selected-place detail, and map popup render
   **“Detour community selection”** without querying or revealing private
   submissions.

The controlled proof uses a generated `.invalid` test account with no usable
credential and no public member attribution. It reuses the independently
verified canonical Baldoria record rather than creating a duplicate venue. The
public award has no source URL, member data, recommendation text, private note,
or curator audit value.

## Live publication records

- **Canonical venue:** `venuepizza00001` — `Baldoria`, Madrid, Spain. Its existing official URL, address, category, and verified map location were retained.
- **Public source:** `16x2e1bvp590use` — `name = Detour community`, `slug = detour-community`, and no external URL.
- **Public provenance event:** `x6duwjjme161jy4` — `venue = venuepizza00001`, `source = 16x2e1bvp590use`, `year = 2026`, `level = Detour community selection`, `current = true`, `verification_status = verified`, and `source_url = ""`.
- **Private publication audit record:** `mtx6p2lxr0b8632` — `status = published`; private `published_venue = venuepizza00001`, `published_award = x6duwjjme161jy4`, `published_at = 2026-07-15 11:14:01.271Z`, and a private publication audit identifier.

The release migration `pb_migrations/1767982000_seed_community_publication_e2e_proof.js` is guarded and forward-only. It creates the source/award/publication links only after the approved private submission and canonical venue exist. Re-running after an interrupted boot converges rather than duplicating an account, evidence, source, award, or venue.

## Public data and privacy checks

Unauthenticated live API checks passed:

- `GET /api/collections/venues/records/venuepizza00001` returned only public
  catalogue facts for Baldoria.
- A public `venue_awards` query for current `Detour community selection` returned
  the event `x6duwjjme161jy4`, linked only to the public venue/source IDs and
  with an empty `source_url`.
- Unauthenticated reads of the published private submission
  `mtx6p2lxr0b8632` and the reserved pending proof
  `pjhvwl5zeubwsys` both returned `404`.
- The reserved `Editorial curation proof — not public` submission remains
  `pending`, and its `published_venue`, `published_award`, `published_at`, and
  `publication_audit_id` fields remain blank.

No public request returned a member relation, recommendation note, research
link, curator note, or publication audit value.

## Durable live reproducibility

Run these checks without an authorization header. The live public guide is
`https://detour-app.supernaut.to/` and the live PocketBase backend is
`https://sn-pb-repo-1297566350-6aebd3.fly.dev/`; both are expected to return
`200`.

The public record checks use these exact endpoints and expected facts:

- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/venues/records/venuepizza00001`
  — expected `200`; `name = Baldoria`, `city = Madrid`, `country = Spain`, and
  `category = Pizza`.
- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/guide_sources/records/16x2e1bvp590use`
  — expected `200`; `name = Detour community`, `slug = detour-community`,
  `current_year = 2026`, and `official_url = ""`.
- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/venue_awards/records/x6duwjjme161jy4`
  — expected `200`; `venue = venuepizza00001`, `source = 16x2e1bvp590use`,
  `year = 2026`, `level = Detour community selection`, `current = true`,
  `verification_status = verified`, and `source_url = ""`.

The private-boundary checks use these exact unauthenticated endpoints:

- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/detour_submissions/records` — expected `200` with an empty `items` array (zero private records).
- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/detour_submissions/records/mtx6p2lxr0b8632`
  — expected `404` for the private published submission.
- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/detour_submissions/records/pjhvwl5zeubwsys`
  — expected `404` for the reserved pending submission.
- `GET https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/collections/detour_submissions`
  — expected `401` for the private collection definition.

The curator operation is
`POST /api/detour/curation/submissions/{id}/publish`. It is a superuser-only
security boundary. An unauthenticated request to
`POST https://sn-pb-repo-1297566350-6aebd3.fly.dev/api/detour/curation/submissions/mtx6p2lxr0b8632/publish`
returned the expected `401`; this verification did not make an authenticated
HTTP call to the route.

The implementation data path matches this boundary: `loadLiveVenues` in
`src/main.ts` fetches only `venues`, `venue_awards`, and `guide_sources`.
Calls to `detour_submissions` reside in `src/community.ts` and occur only after
a signed-in verified member opens the member panel.

## Frontend checks

The frontend was built with:

```text
npm ci --no-audit --no-fund && npm run build
```

The production Worker at https://detour-app.supernaut.to was then inspected in
an unauthenticated browser session:

- Searching **Baldoria** reduced the catalogue to one place and showed a
  distinct **Detour community selection** badge on its card.
- The card’s attribution reads **“Detour community selection — Detour’s
  editorial selection”**. It is separate from Baldoria’s 50 Top Pizza award and
  has no external-guide link.
- Selecting the map pin opened a popup containing the exact
  **“Detour community selection”** label alongside the existing 50 Top Pizza
  recognition.
- The selected-place panel shows a separate **Community** fact row with the
  same attribution. Its **Official guide** row contains only 50 Top Pizza.
- Browser accessibility output exposed the label in the map pin, catalogue card,
  recognition list, and selected-place panel. The delivery screenshot from this
  verification captures the live map popup and selected-place panel.

The public catalogue does not query `detour_submissions`, `visit_evidence`,
`members`, or publication-audit fields.

## Result

The live curation loop now has an inspectable approved-to-published proof:
private community input is represented publicly only as an attributed Detour
community selection on a canonical venue, while the queue and all member/editorial
material remain private.

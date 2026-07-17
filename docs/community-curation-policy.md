# Detour community curation policy and curator playbook

**Status:** governing policy for the community-selection workflow.  
**Applies to:** member verification, private endorsements, recommendations, visit evidence, and the public Detour catalogue.
**Policy owner:** Detour editorial curation.

## 1. Purpose and editorial boundary

Detour accepts recommendations from verified members as private editorial leads. A
recommendation is not public merely because it was submitted, reviewed, or
approved. Detour publishes only the venues it independently selects for the
public catalogue.

A published community pick is **Detour's own editorial selection**, labelled
**“Detour community selection.”** It is not an external guide listing, a
republication of a member's words, or an endorsement by a venue, member, or
third-party publisher.

This policy is deliberately conservative. It supplements the source-rights
memos in `docs/`, including the Guía Repsol and MICHELIN policies. Those memos
govern any separate source-derived award claim. A community recommendation does
not turn an external source into a Detour source, and does not permit copying
from one.

## 2. Current deployed workflow and privacy boundary

The live community foundation has these intentionally private collections:

- `endorsements` contains the member relations `endorser` and `endorsee`, plus
  server-managed active state. Only the two participating members can list or
  view a record, only its endorser can revoke it, and members cannot update it.
- `visit_evidence` contains a member relation, an existing `venue` relation,
  optional `evidence_url`, member `note`, `status`, and hidden `curator_note`.
  Its current status values are `pending`, `approved`, and `rejected`. It is
  retained as private historical/editorial context and does not confer member
  verification.
- `detour_submissions` contains `member`, optional existing `venue`,
  `venue_name`, `city`, `address`, `detour_note`, optional `source_url`,
  `status`, hidden `curator_note`, and private publication audit fields. Its
  current status values are `pending`, `approved`, `rejected`, and `published`.
- For visit evidence and submissions, members can read only records where
  `member = @request.auth.id`. A verified member may create a recommendation,
  but the server assigns the member and forces its status to `pending`. Members
  cannot change review fields.
- The public guide reads catalogue collections such as `venues`,
  `venue_awards`, and `guide_sources`; it does **not** query `endorsements`,
  `visit_evidence`, or `detour_submissions`.

The controlled curator publication action is the only path from an approved
private submission to the public catalogue. An editorial approval alone remains
a private curator finding, not a publication. Curators must not manually expose
a submission by loosening collection rules, copying its note into a public
field, or treating an approval as permission to publish. Endorsement records,
member identities, and endorsement or submission note/prose must never appear in
public catalogue responses.

The reserved account `community-proof@detour.invalid` and its submission
**“Editorial curation proof — not public”** are non-interactive verification
fixtures. They are never candidates for publication, attribution, or display.

## 3. Review lifecycle

### 3.1 Member verification and endorsements

Email verification secures a member account only; it does not grant community
trust or recommendation privileges. Olga or another authorized curator verifies
founding members through the curator-only founding-verification path:
`POST /api/detour/curation/members/{id}/founding-verification`. Founding
verification remains valid independently of endorsements until an authorized
curator revokes it.

After the founding cohort, a non-founding member becomes verified exactly when
they hold at least two independent active endorsements from distinct members
who are currently verified. Each verified member can hold at most three active
outgoing endorsements. Self-endorsement and duplicate endorser/endorsee pairs
are prohibited. An endorser may revoke their own endorsement; revocation can
remove the endorsee's verified status and the backend propagates that loss
through downstream endorsements so an unverified member is not left as a trust
source.

Endorsements are private trust records, not public recommendations or public
attribution. Only the participating endorser and endorsee may read their record.
No endorsement identity, relation, note, prose, or private trust-graph data may
appear in public catalogue responses.

### 3.2 Visit evidence

Visit evidence follows this private editorial lifecycle:

1. **Pending** — submitted by a signed-in member and awaiting review.
2. **Approved** — a curator has determined that the evidence is sufficiently
   credible and relevant to the stated catalogue venue.
3. **Rejected** — the evidence is insufficient, clearly unrelated, duplicate,
   unsafe to retain, or otherwise fails review.

Visit evidence is retained as historical/editorial context only. Creating,
approving, rejecting, reversing, or deleting it does not change
`community_status` and must not be presented as a route to verification. A
curator may reverse an approval when credible new information shows it was
wrong. Record a factual, non-sensitive reason in the private curator note. Do
not put personal information, evidence contents, or allegations in a public
field.

### 3.3 Member recommendations

The lifecycle for `detour_submissions` is:

1. **Pending** — private intake and triage.
2. **Approved** — a curator has finished the required checks and the lead is
   eligible for editorial publication. This is still private and creates no
   venue or map pin.
3. **Rejected** — not selected, insufficiently supported, duplicate without a
   useful correction, outside scope, or unsuitable for publication. It remains
   private to the submitter and curators.
4. **Published** — the controlled publication action has completed every
   required public-record write and linked the resulting venue back to the
   submission for audit.

`published` must never be set before the destination catalogue record and its
community provenance exist. A failed or incomplete publication leaves the
submission `approved`; it does not create a partial public listing.

A member may ask to withdraw a pending or approved lead. Curators should record
the request in the private audit note and set the record to `rejected` where the
current schema has no separate withdrawal value. A publication that is later
challenged, corrected, closed, moved, or subject to a credible privacy or
rights request must be removed from public presentation immediately. The
curator then returns the submission to `approved` for repair or to `rejected`
when it must not be republished, retaining only the minimal private audit note
needed to prevent repeat publication. The next workflow implementation must
make this unpublish/review path deliberate and auditable; it must not delete a
record blindly or leave a stale public award.

## 4. Rights, provenance, and attribution

### 4.1 What Detour may retain and display

For a community selection, retain and publicly present only the minimum
editorially verified facts needed for a useful listing:

- normalized venue name;
- confirmed city and country;
- a venue-owned official URL only after independent verification;
- a confirmed street address and location only when separately supported;
- Detour's community-selection label and selection date/year; and
- concise Detour-authored operational copy where it does not reproduce member
  text or third-party editorial material.

The public attribution is **“Detour community selection.”** It identifies
Detour's editorial decision, not a source guide. When a venue also has a
separately verified award, that award retains its own source-specific
provenance and visible attribution under the applicable source-rights policy.
The community label must not imply that the outside guide selected,
recommended, sponsored, or partnered with Detour.

### 4.2 What must not be copied or exposed

Do not copy, store for public display, train on, or republish through this
workflow:

- a member's `detour_note`, private review discussion, `evidence_url`, or
  curator note;
- external-guide descriptions, reviews, quotations, tasting notes, rankings,
  menus, prices, images, logos, badges, layouts, map tiles, page text, or
  screenshots;
- source HTML, undocumented APIs, bulk scraped results, cached guide pages, or
  non-public data;
- a member's email, account identifier, private visit history, or submitted
  address/source link without verification; or
- guessed coordinates, contact details, opening information, category, or a
  venue URL presented as verified fact.

A member-provided `source_url` is a private research lead only. It is **not**
public provenance and is not presumed to be an official venue site, an
authorized source, or permission to reuse its contents.

### 4.3 Member attribution and consent

The default public attribution is collective and anonymous: **“Detour
community selection.”** Do not display the submitting member's name, handle,
email, profile, evidence, note, or visit count.

A named credit may be shown only when all of the following are true:

1. the member has given explicit, informed permission for the precise public
   credit;
2. the permission is recorded in a dedicated consent/audit field or an
   equivalent durable curator record, not inferred from submission or product
   terms;
3. the wording and displayed identity are limited to what the member approved;
   and
4. a curator confirms that the credit does not reveal sensitive information or
   imply a personal endorsement beyond the submitted recommendation.

Consent may be revoked prospectively. On revocation, remove the named credit
promptly and retain the anonymous Detour community attribution only if the
listing otherwise remains eligible. The publication implementation must keep
any member identity and consent record private; no public API response should
contain it by default.

## 5. Required checks before approval

A curator approves a recommendation only after documenting that each applicable
check has passed:

1. **Queue and identity check.** Confirm the record is a real member
   recommendation, not the reserved `.invalid` proof fixture, spam, or an
   obvious duplicate.
2. **Duplicate and canonical-venue check.** Search `venues` by normalized name
   and city. Do not create a second venue when the recommendation is for an
   existing catalogue record. Do not fuzzy-merge ambiguous names, hotel
   variants, branches, or similarly named venues without independent evidence.
3. **Venue identity and geography check.** Confirm the venue exists and that
   the submitted city is accurate. Obtain country, locality, and address from
   a venue-controlled source or another independently documented source. Leave
   uncertain details blank rather than guessing.
4. **Official URL check.** Verify that any public `official_url` is controlled
   by the venue or operator. A member's link, search result, social profile,
   booking service, directory, or external guide is not enough by itself.
5. **Location check.** Verify an address separately. Add coordinates only with
   documented provenance, required licence/attribution treatment, and an
   appropriate confidence level. Never create a precise map pin from an
   unsupported address or a `0,0` sentinel.
6. **Rights and no-copy check.** Ensure no public field carries copied member
   prose or external editorial/source material. If the lead depends on a
   restrictive source, a terms question, or a rightsholder objection, pause
   publication pending review.
7. **Consent and privacy check.** Apply anonymous community attribution unless
   the explicit named-credit standard in section 4.3 is met.
8. **Editorial selection check.** Confirm that the place fits Detour's current
   scope and is a selection Detour is prepared to stand behind. Community
   enthusiasm alone is not sufficient.

A failed check normally means `rejected`. A lead that may become publishable
when more independent evidence is available can remain `pending` with a clear,
private curator note about the missing verification.

## 6. Exact approved-submission-to-publication path

The deployed controlled path separates private intake from a public, attributed
catalogue record and gives the frontend a single safe way to discover community
picks.

### 6.1 Inputs retained privately

The source submission remains the private audit record. These fields do not
move to public output:

- `member` remains private and is used only for consent/audit and member
  visibility;
- `detour_note` remains private and is never copied verbatim;
- `source_url` remains a private lead unless a curator independently establishes
  a distinct venue-owned URL;
- `curator_note` remains hidden; and
- `status`, review timestamps, and any internal publication audit data remain
  non-public.

The optional existing `venue` relation identifies a possible canonical record,
but it is not itself proof of publication or a substitute for the checks in
section 5.

### 6.2 Public field mapping

After approval, the controlled publication action must perform this mapping:

- `venue_name` → `venues.name`, only after duplicate/canonical-name review.
- `city` → `venues.city`, only after locality review.
- `address` → `venues.address`, only after independent address verification;
  otherwise leave blank.
- separately verified country → `venues.country`; country is not supplied by
  the current submission schema and must not be inferred.
- separately verified venue-owned URL → `venues.official_url`; never copy the
  submission's `source_url` by default.
- separately documented coordinates and location qualification → the existing
  location fields only when supported; otherwise no map pin.
- curator-selected category or Detour-authored descriptive material → public
  fields only when independently supportable and not copied from the member or
  an outside guide.

For a record that already exists in `venues`, publication reuses that canonical
venue rather than creating a duplicate. It must still create a distinct
community-selection provenance event so the frontend can truthfully label the
selection.

### 6.3 Required public provenance event

The existing catalogue model should carry the public selection through a
reusable `guide_sources` / `venue_awards` entry, rather than exposing the
private submission:

1. Create or reuse one public source record with the exact identity
   `name = "Detour community"` and `slug = "detour-community"`. It represents
   Detour editorial provenance, not an external guide.
2. Create one `venue_awards` record for the published venue with that source,
   the publication year, `level = "Detour community selection"`, and
   `current = true`.
3. Do not put the member link, member note, member `source_url`, or a
   third-party guide URL in the public award's `source_url`.
4. Add an internal-only relation or equivalent audit link from the publication
   event to the originating submission. Add a private publication timestamp and
   a safe curator audit identifier. These must not reveal the member through
   public list/view responses.
5. Add a private `published_venue` relation (or an equivalent immutable
   destination reference) and `published_at` timestamp to the submission, then
   set its status to `published` only after the venue and community-selection
   event have been saved successfully.

The publication/unpublication operation is idempotent and controlled by
curator-level backend logic, not by a member-side API call or a sequence of
unguarded manual edits. Its private destination, timestamp, and audit fields
must remain hidden from public responses.

## 7. Curator playbook

Use the PocketBase Admin interface only with an authorized curator account. The
current user-facing app is not an editorial administration surface.

### A. Start-of-session checks

1. Confirm that you are working in the production Detour backend and that your
   account has curator/superuser authority.
2. Do not export member email, evidence URLs, notes, or source links into
   working documents unless genuinely necessary for review. Keep any necessary
   notes minimal and access-controlled.
3. Open the `visit_evidence` and `detour_submissions` collections. Filter for
   `status = pending` and sort oldest first.
4. Exclude the reserved `community-proof@detour.invalid` account and the
   “Editorial curation proof — not public” submission from editorial selection.

### B. Manage founding verification and visit evidence

1. Use the curator-only founding-verification path when Olga or another
   authorized curator admits or removes a founding-cohort member. Do not edit
   `community_status` directly.
2. When reviewing historical visit evidence, open the record and inspect its
   related member and existing venue only for the private editorial purpose at
   hand.
3. Check that the note/link is relevant and does not contain unsafe, unrelated,
   or clearly fabricated material. Select `approved` or `rejected` only as a
   private evidence-review state.
4. Add a short, factual private `curator_note`. Do not paste evidence contents
   or personal details.
5. Do not use visit-evidence status or counts to grant, retain, or revoke member
   verification. Endorsement and founding-verification logic exclusively
   controls community trust.

### C. Triage a recommendation

1. Open a pending `detour_submissions` record and read the submitted name,
   location, address, note, and source link as private leads.
2. Search the existing `venues` collection for exact normalized name and city.
   Treat a possible match as unresolved until identity is confirmed.
3. Perform the checks in section 5. Capture only a concise factual result in
   `curator_note`; do not copy source text.
4. Set `rejected` when the lead is duplicate without an editorial update,
   unverifiable, out of scope, unsafe, rights-constrained, or not selected.
5. Set `approved` only when the lead has passed every required verification
   gate. Explain any material limitation privately.
6. Do not make an approved recommendation public by editing it directly.
   Approval means ready for the controlled publication action, not published.

### D. Publish through the controlled mechanism

1. Re-open the approved submission and re-run the name, official URL, address,
   location, no-copy, consent, and duplicate checks immediately before
   publication.
2. Invoke the approved curator-only publication action. Do not set `published`
   by hand and do not create a public venue/award manually outside that action.
3. Confirm the action returned one canonical venue and one `Detour community`
   / `Detour community selection` provenance event, with no member data or
   source lead exposed.
4. Confirm the submission carries the private destination and publication audit
   references, then confirm status changed from `approved` to `published`.
5. Check the public catalogue as an unauthenticated visitor: it may show the
   venue and the **“Detour community selection”** label, but it must not expose
   a member, notes, evidence, curator notes, or pending/rejected submissions.

### E. Corrections, removals, and rights requests

1. On a credible venue, member, source-owner, or rightsholder concern, remove
   the disputed community-selection event from public presentation first.
2. Keep the smallest private audit note needed to record the action; remove
   copied/disputed public material promptly.
3. Re-check independent venue facts, public attribution, consent, and location
   before restoring the selection.
4. Re-publish only through the controlled action. If the concern cannot be
   resolved, leave the submission rejected/private and keep no stale community
   label on the venue.

## 8. Security and release acceptance

The backend implementation and frontend release that follow this policy must
meet all of these conditions:

- pending, approved, rejected, private withdrawal annotations, audit data, and
  curator notes are not listable or viewable by the public or other members;
- members can see only private records in which they participate and cannot
  promote a status or create a public catalogue record;
- email verification alone never grants community trust; founding verification
  requires the curator-only path, while non-founding verification requires two
  active endorsements from distinct currently verified members;
- no verified member can hold more than three active outgoing endorsements, and
  self or duplicate endorsements are rejected;
- endorsement revocation recalculates the affected member and propagates any
  status change so stale downstream trust is removed;
- only authorized curators can toggle founding verification, approve, reject,
  publish, unpublish, or inspect other members' queue data;
- public catalogue queries return only public `venues`, public provenance, and
  safe community-selection attribution;
- the frontend never queries `endorsements`, `detour_submissions`, visit
  evidence, member identity, notes/prose, or a private publication-audit
  relation for public map/catalogue display;
- a public community-selection label remains separate from external-guide
  awards and never attributes the pick to an outside guide; and
- publication is verified end-to-end with a non-fixture, consent-safe test path
  while the `.invalid` proof fixture remains private.

This policy is an operational rights and editorial control, not legal advice or
a licence. Pause publication and escalate any material rights, privacy,
permission, or source-terms question before proceeding.

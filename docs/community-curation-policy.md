# Detour community waiting-list and membership policy

**Status:** governing policy for the active community place workflow.
**Applies to:** invitation-only membership, private legacy endorsements, community waiting-list entries, recommendations, shares, review-gated member place contributions, historical visit evidence/submissions, and public community selections.

## 1. Active community place workflow

Detour's active community workflow is a shared private waiting list, not an editorial approval queue.

1. A member proposes a place with a display venue name, city, country, and a meaningful personal recommendation note.
2. The backend normalizes the venue name and city and creates or reuses one `community_waitlist_entries` record for that normalized pair. Differences in case, spacing, punctuation, or common diacritics must not create parallel queues.
3. Each member may add at most one `community_recommendations` record to an entry. A qualifying record is one independent signal; repeated attempts by the same member are rejected and do not increase the count.
4. At the third independent member signal, the backend automatically publishes the place. No curator or editorial approval is required for this community-loop publication.
5. Publication creates or reuses one canonical `venues` record, the `guide_sources` record named **“Detour community”** with slug `detour-community`, and one current `venue_awards` event labelled **“Detour community selection.”** The waiting-list entry is marked `published` only after those public records exist.

The signal count is computed from distinct recommendation rows, not from a client-supplied counter. Deleting a recommendation updates the count while an entry is pending. Deleting a recommendation after publication does not automatically remove the public selection; corrections and rights requests are handled deliberately rather than by silently reversing an already completed publication.

A published entry does not accept new community recommendations. The automatic threshold is a publication rule, not permission to copy member text or unsupported place facts.

## 2. Distinct review-gated contribution lane

`member_place_contributions` is a separate curator-review lane. It is not a replacement for, extension of, or input to either legacy `detour_submissions`/visit-evidence records or the automatic three-signal waiting-list.

- Intake is limited to verified, invitation-based members. The backend attributes each record to the authenticated member, sets `source` to `member_recommended`, and starts it `in_review`.
- Contributor linkage, the recommendation note, normalization keys, and curator notes remain private. Only contribution records with `status = 'approved'` may be listed or viewed publicly.
- Each member may create at most five contributions in any rolling seven-day period. An exact normalized name-and-city match is blocked while either record is `in_review` or `approved`, including by a partial unique index for concurrent requests.
- Members cannot update or delete contributions through the records API. Curators review with superuser operations; contribution intake does not create, alter, or grant members edit rights over guide-backed `venues`, `guide_sources`, or `venue_awards` records.

For San Francisco, discovery acceptance is inspectable: high-recognition guide-backed tables must remain present, while the approved local `member_recommended` lane must build queryable coverage across `celebration`, `casual_local_favorite`, `coffee`, `bakery`, `drinks_nightcap`, `neighborhood_meal`, `date_night`, `group_gathering`, and `quick_bite` occasions.

## 3. Private shares

`community_shares` are private, queue-linked messages between members.

- A member may share an existing waiting-list entry only when the sender already participates in that entry.
- A sender may instead supply safe place fields. The backend creates or matches the normalized waiting-list entry and links the share to it; if those fields match an existing entry, the sender must already participate.
- The sender and recipient become private participants so each can view the shared entry under the collection rules.
- A share is **not** a recommendation signal and never increments `signal_count`.
- If the recipient is a member, or later activates membership, and submits their own meaningful recommendation against that entry, that recommendation is their independent signal.
- Self-targeted shares, nonexistent recipients, non-member senders, published-entry shares, and invalid or missing place/note data are rejected.

Share notes remain private. They are not catalogue descriptions, public attribution, evidence of a recommendation, or permission to publish third-party material.

## 4. Privacy and collection boundary

The active loop uses intentionally private collections:

- `community_waitlist_entries` stores the safe display name, city, country, normalized deduplication keys, pending/published state, server-maintained signal count, hidden participant relations, and hidden canonical/publication audit relations.
- `community_recommendations` stores the waiting-list relation, hidden member relation, meaningful personal note, and private place-input mirrors used by the standard record-creation path.
- `community_shares` stores sender and recipient relations visible only within the private sender/recipient-scoped record, the linked waiting-list entry, a private personal note, and private place-input mirrors when needed to create or resolve an entry.
- `member_place_contributions` keeps member attribution, recommendation prose, normalized keys, and curator notes hidden while exposing only approved records' public discovery fields.
- Legacy `endorsements` records, `visit_evidence`, and `detour_submissions` remain private under their existing rules.

Anonymous users cannot list or view the private waiting-list, recommendation, share, or legacy collections. Members may read only their own recommendations, shares they sent or received, waiting-list entries in which they are participants, and their own contribution records at any status; anonymous and other public readers can see only approved contributions. Hidden participant, member, canonical venue, publication relation, normalization, recommendation-note, and audit fields are server-maintained and are not part of member-controlled writes.

The automatic three-signal workflow publishes only through these catalogue collections:

- `venues`;
- `guide_sources`; and
- `venue_awards`.

No public client should query a community waiting-list, recommendation, share, endorsement, visit-evidence, or legacy submission collection to render catalogue content. Public clients may query `member_place_contributions` only through its approved-only read rules and must never treat its hidden contributor or review fields as public catalogue data.

## 5. Place identity and publication facts

The normalized venue-name and city pair is the queue identity. Normalization is used for deduplication and canonical matching; it does not authorize a fuzzy merge between different branches, hotels, similarly named venues, or ambiguous places.

When the third signal arrives, the backend first tries to reuse an existing `venues` record whose name and city match after normalization. If it reuses a venue, the waiting-list country must agree with the canonical venue country. If no canonical venue exists, the entry must already contain a member-supplied country before a new venue can be created. `venues.country` remains required.

The automatic workflow publishes only these minimum facts:

- venue name;
- city;
- country; and
- the Detour community selection source/event.

It does not infer or guess address, coordinates, category, official URL, opening information, contact details, or other public facts. Those fields remain blank unless a separate, rights-safe catalogue process verifies them.

Publication must be idempotent. A retry reuses the same normalized waiting-list entry, canonical venue, `detour-community` source, and current community-selection award where they already exist. The waiting-list status changes to `published` only after the public records have been saved successfully.

## 6. Rights, provenance, and no-copy rule

A community recommendation is a private member signal, not public prose or third-party provenance. The public attribution is collective and anonymous: **“Detour community selection.”** It identifies the threshold outcome, not a named member, external guide, venue endorsement, sponsorship, or partnership.

Never copy to `venues`, `guide_sources`, `venue_awards`, frontend catalogue data, or other public fields:

- a member identity, account id, email, profile, endorsement relation, or participation list;
- a recommendation note, share note, visit note, curator note, private discussion, or source lead;
- a submitted address, URL, coordinate, category, or contact fact that has not been separately verified under the applicable catalogue policy;
- external-guide reviews, descriptions, quotations, tasting notes, rankings beyond separately licensed/verified award facts, menus, prices, photos, logos, badges, screenshots, layouts, map tiles, or page text;
- source HTML, undocumented API output, scraped or cached guide content, or non-public data; or
- any fact guessed from a name, city, search result, member prose, or third-party listing.

A member-supplied URL or source mention is a private lead only. It is not automatically an official venue URL, public provenance, evidence of permission, or reusable source material. Country must be supplied for a genuinely new venue and must never be inferred from city alone.

Named member credit is outside this automatic workflow. It would require a separate explicit-consent design and private audit record; recommendation or share creation never implies consent to public attribution.

## 7. Invitation-only membership and legacy endorsements

A valid, one-time personal invitation issued by an existing member is the sole requirement for Detour community membership. Redeeming the invitation activates membership immediately.

- Members may issue personal invitations to prospective members.
- Each member may have at most three unclaimed personal invitations at a time. Redeeming an invitation frees one slot for that member.
- Each invitation is personal, valid for one redemption, and cannot activate more than one membership.
- No endorsement threshold, founding-verification status, or trust graph is used to activate or maintain membership.
- Email verification may protect account control, but it is not an additional community membership requirement.

Existing `endorsements` records are retained only as private legacy records. They have no current role in membership activation, continued membership, recommendations, place publication, attribution, or any public workflow. They must not be exposed or used to reconstruct or publish a trust graph.

## 8. Historical private workflows

`detour_submissions` and `visit_evidence` are retained for historical and private audit continuity. Their existing records, statuses, curator notes, publication audit links, and legacy curator endpoints must not be deleted, rewritten, or exposed.

They are no longer the governing intake/publication path for new community-loop places:

- no new community waiting-list publication waits for a `detour_submissions` approval;
- visit-evidence counts do not activate membership or add place signals;
- legacy `detour_submissions` publication/unpublication endpoints remain available only for their historical records and must not be repurposed for the new waiting list; and
- the reserved `.invalid` proof fixtures remain private historical verification data, never community-loop signals or named public attribution.

Historic approval language applies only to the legacy records it describes. It must not be presented as a requirement for the active three-signal automatic workflow.

## 9. Corrections, privacy requests, and release acceptance

Automatic publication does not remove Detour's obligation to respond to credible corrections, closures, moves, privacy concerns, source-owner objections, or rights requests. Remove or deactivate disputed public material deliberately, retain only the minimum private audit information needed, and do not expose member participation while investigating. Recommendation deletion alone is not an unpublication mechanism.

A backend release satisfies this policy only when all of the following are true:

- normalized name and city deduplicate proposals into one waiting-list entry;
- the separate `member_place_contributions` lane accepts only verified invitation-based members, permits no member updates/deletes, enforces five creates per rolling seven days, and blocks normalized open duplicates;
- contribution source is always `member_recommended`, contributor linkage and recommendation notes remain private, and only approved contribution records are publicly readable;
- member contribution requests never edit or create guide-backed catalogue records; and
- San Francisco discovery retains high-recognition guide-backed tables while approved local contribution coverage is inspectable across celebration, casual local favorite, coffee, bakery, drinks/nightcap, neighborhood meal, date night, group gathering, and quick bite;
- community membership activates immediately only when a person redeems a valid, one-time personal invitation from an existing member;
- members may have at most three unclaimed personal invitations at a time, a redeemed invitation frees one slot, and no endorsement threshold, founding-verification status, or trust graph controls membership;
- existing endorsement records remain private legacy records with no current role in membership or publication;
- only members can create recommendations or send shares;
- one member can contribute only one signal per entry;
- a meaningful recommendation note is required;
- three distinct recommendation rows publish without curator approval;
- a share links or creates a queue entry but never increases its signal count;
- a shared recipient's own recommendation after membership activation counts independently;
- existing normalized catalogue venues are reused and new venues require country;
- publication creates/reuses the exact `Detour community` / `detour-community` source and one current `Detour community selection` award with a blank source URL;
- no member identity, recommendation/share prose, source lead, or guessed fact reaches a public record;
- anonymous access to all private community collections is denied;
- members can read only their own/participating private records and cannot control status, participants, counts, canonical links, or publication audit fields;
- deleting a pending recommendation updates the count, while deleting a post-publication recommendation does not automatically remove the public selection; and
- invitation-only membership activation, the public catalogue, and historical `detour_submissions`/visit-evidence behavior work as described without endorsement propagation.

This policy is an operational privacy and rights boundary, not legal advice or a licence. Pause and escalate any material privacy, permission, source-terms, or rightsholder question rather than guessing or copying.

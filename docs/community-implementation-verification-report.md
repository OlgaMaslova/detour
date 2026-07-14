# Detour community implementation verification report

## Scope

Detour now has an invitation-only member community alongside its public, editorial guide.

- Backend foundation: commit `95c8870`.
- Member entry and visit-verification interface: commit `624b283`.
- Production API: https://sn-pb-repo-1297566350-6aebd3.fly.dev
- Production guide: https://detour-app.supernaut.to

## Shipped member flows

1. An existing member issues a server-generated, single-use invitation.
2. A new member joins with that invitation and signs in to a private member area.
3. Members record visits to catalogued places for editorial review.
4. Three approved, distinct visit records grant verified member status.
5. Verified members can send a new detour recommendation to the editorial queue.
6. The member sees only their own visit records and their own recommendation statuses.

## Enforced rules

### Invitation and membership

- `members` creation requires a valid, unused invitation code.
- The membership hook clears the submitted code, records the issuer and redemption, and starts every new member as `unverified`.
- A unique redeemed-invitation relation prevents a single invitation from creating more than one account.
- Members cannot change their own verification or invitation provenance.

### Visit verification

- Visit evidence is attributed to the signed-in member and forced to `pending`.
- A member may read only their own evidence.
- The backend recalculates verification after evidence creation, update, or deletion.
- Only three or more approved evidences produce verified status.

### Detour recommendations and curation

- `detour_submissions` creation requires an authenticated verified member.
- The backend assigns the member and forces every submitted recommendation to `pending`.
- Members cannot alter submission status and can read only their own recommendations.
- The member interface shows a recommendation form only after verification.
- Unverified members see a locked explanation instead of the form.

## Public catalogue isolation

The public map loads only `venues`, `venue_awards`, and `guide_sources`. It does not query `detour_submissions`.

A member recommendation is therefore a private editorial record, not a public venue. Pending records cannot appear on the map or in catalogue cards. Editorial approval remains a curator action and does not automatically publish a member submission.

## Production verification

Verified against the deployed backend after the curation-proof migration:

- [x] Backend health returned `200` from `/api/health`.
- [x] The public guide rendered at https://detour-app.supernaut.to with the member entry panel and the editorial map.
- [x] The reserved non-interactive proof account `community-proof@detour.invalid` exists with `community_status = verified`.
- [x] That member has exactly three distinct approved visit-evidence records, linked to `venueseed000001`, `venueseed000002`, and `venueseed000003`.
- [x] Its private curation record `pjhvwl5zeubwsys` exists as `Editorial curation proof — not public`, city `Madrid`, with `status = pending`.
- [x] A public-catalogue query for that exact recommendation name returned zero `venues` records.
- [x] The production map is sourced only from the catalogue collections, so the pending recommendation has no route to a map pin or catalogue card.

The proof account’s password is generated only at migration runtime and is never stored in source. It cannot be used to create public recommendations. The authenticated verified-member create path was also exercised against a fresh local backend: a recommendation create response returned a member-owned record with `status = pending`.

# Community frontend live verification

## Scope

This audit records the controlled live-browser verification of the community endorsement, recommendation, publication, and private-sharing frontend. The run used four isolated temporary accounts under the reserved `.invalid` domain, with credentials generated at runtime and held only in a private operational collection.

## Verified browser flow

- Members A and B used the names-only member typeahead to select and endorse member D through the actual UI.
- D became verified, and the UI showed endorsement progress of **2/2**.
- D submitted **Detour Frontend Verification Atelier** and privately shared the resulting entry with C.
- B submitted a spelling-and-whitespace variant of the same place; normalization deduplicated it to the existing entry rather than creating another.
- C opened the private share in a mobile browser session and submitted a third independent recommendation.
- The UI then showed the entry as **Published** with **3/3** recommendation progress.

Platform-side evidence confirmed exactly one waiting-list entry, three distinct private recommendations, one private share, one public minimal venue, and one current **Detour community selection** award.

## Privacy and implementation note

The verification also covered the member-directory API response-shape fix that made real UI selection work. The endpoint and typeahead continue to expose names only; member email addresses and other private profile data are not included in directory results.

## Cleanup

`1767990100_cleanup_community_frontend_verification_fixtures.js` removes the four fixture members, their endorsements, recommendations, share, waiting-list entry, published operational award and matching test venue, all temporary credential records, and the temporary credential collection. It does not delete or alter `guide_sources`, because production community selections already use that source.

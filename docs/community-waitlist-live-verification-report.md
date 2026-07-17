# Community wait-list live verification

## Purpose

This report records the controlled authenticated production verification run for detour's community wait-list workflow. It used three short-lived, private operational fixture accounts with runtime-generated credentials. The fixtures and every artifact they created are removed by the forward-only cleanup migration that follows the fixture migration.

## Live result

The live backend at https://sn-pb-repo-1297566350-a88d3c.fly.dev passed the authenticated workflow on 2026-07-17.

- All three verified fixture members authenticated through the normal member password endpoint.
- The first member submitted a meaningful recommendation, creating one pending waiting-list entry with one signal.
- That member shared the entry with the third member. The recipient could view the private share, while the entry remained pending with one signal.
- The second member submitted a spelling-and-whitespace variant of the same venue and city. It resolved to the original waiting-list entry and raised its signal count to two.
- The recipient then submitted their own meaningful recommendation for the linked entry. It became the third independent signal and changed the entry to `published` without curator action.
- Publication created exactly one public venue and exactly one current `Detour community selection` award linked to the `Detour community` source.
- A different member received a `404` when reading the first member's recommendation. An anonymous queue listing returned an empty result set, disclosing no queue records.
- The public venue, source, and award responses contained neither fixture member identities nor the private recommendation note.

The run’s private working identifiers were `community-live-qVwa4LeJ`, wait-list entry `cbauok6wgx3qb8f`, venue `sawu5lzmramr8hb`, and award `2sawm7jlp9vrbdw`. They are intentionally retained here only as an operational audit trail; the cleanup migration removes the associated live records.

## Cleanup

`1767989100_cleanup_community_live_verification_fixtures.js` deletes the fixture members, credential collection, recommendations, share, waiting-list entry, selection award, operational venue, and otherwise-unused community source. It uses the fixed fixture emails and private participant links to avoid affecting customer accounts or catalogue data.

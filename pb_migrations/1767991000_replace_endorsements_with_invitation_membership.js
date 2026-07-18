/// <reference path="../pb_data/types.d.ts" />
//
// Makes successful invitation redemption the sole Detour membership gate.
// This migration is forward-only and retry-safe: the member normalization is
// idempotent, legacy endorsement records are retained, and their API rules are
// converged to superuser-only access on every retry.
migrate((app) => {
  app
    .db()
    .newQuery(
      "UPDATE members SET community_status = 'verified' " +
        "WHERE COALESCE(community_status, '') != 'verified'"
    )
    .execute();

  let endorsements;
  try {
    endorsements = app.findCollectionByNameOrId("endorsements");
  } catch {
    // A database that never had the legacy collection has no endorsement data
    // to preserve or external rules to disable.
    return;
  }

  endorsements.listRule = null;
  endorsements.viewRule = null;
  endorsements.createRule = null;
  endorsements.updateRule = null;
  endorsements.deleteRule = null;
  app.save(endorsements);
}, () => {
  // Forward-only: membership normalization and historical endorsement records
  // must not be rolled back or deleted.
  return null;
});

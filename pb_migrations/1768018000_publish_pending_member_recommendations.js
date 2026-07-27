/// <reference path="../pb_data/types.d.ts" />
//
// One-off sweep after making the first verified-member recommendation publish:
// pending waiting-list entries are otherwise only re-evaluated when a
// recommendation is created or deleted. Re-run the shared idempotent
// publication logic for every pending entry; entries with no recommendation or
// with invalid/unpublishable data remain pending. A per-entry failure is logged
// and skipped so a single bad row cannot block boot.
migrate((app) => {
  const community = require(__hooks + "/community_waitlist.js");
  const pending = app.findRecordsByFilter(
    "community_waitlist_entries",
    "status = 'pending'",
    "created",
    10000,
    0
  );
  for (const entry of pending) {
    try {
      community.recalculateAndPublish(app, entry.id);
    } catch (error) {
      console.log(
        "member recommendation publication sweep: entry " +
          entry.id +
          " not published: " +
          error
      );
    }
  }
}, () => {
  // Forward-only: publication is public, externally visible state and must not
  // be reverted by a migration-history rollback.
  return null;
});

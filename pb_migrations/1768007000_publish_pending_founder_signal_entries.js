/// <reference path="../pb_data/types.d.ts" />
//
// One-off sweep after widening the fast track to the Founder issuer: pending
// waiting-list entries are only re-evaluated when a recommendation is created
// or deleted, so places that already qualify under the new policy would
// otherwise wait for the next signal. Re-run the shared publication logic for
// every pending entry; entries that still do not qualify are left untouched.
// A per-entry failure is logged and skipped so a single bad row cannot block
// boot — publication self-heals on the entry's next recommendation event.
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
        "founder fast-track sweep: entry " + entry.id + " not published: " + error
      );
    }
  }
}, () => {
  // Forward-only: publication is public, externally visible state and must not
  // be reverted by a migration-history rollback.
  return null;
});

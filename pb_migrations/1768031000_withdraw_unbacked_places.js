/// <reference path="../pb_data/types.d.ts" />
//
// Withdraws places whose last member recommendation was already deleted.
//
// Until now the recommendation after-delete hook only recalculated the signal
// count: a place that had auto-published stayed listed even after its final
// recommendation was removed, leaving a city list showing a place nobody stands
// behind. The hook now withdraws such a place at delete time. This migration
// reconciles the entries that were left behind before that fix.
//
// Note this does NOT duplicate the 1768019000 sweep. That one removed venues
// whose only recognition was editorial, and deliberately *kept* any venue a
// waiting-list entry still pointed at. The gap this closes is the opposite
// case: the entry exists and points at the venue, but has no recommendations
// left behind it.
//
// Convergent and forward-only: it re-derives unbacked entries on every pass,
// uses the same helper the hook uses (so the deletion rules cannot drift), and
// logs and skips a per-entry failure rather than blocking boot.
migrate((app) => {
  let community;
  try {
    community = require(__hooks + "/community_waitlist.js");
  } catch (error) {
    console.log(
      "unbacked-place withdrawal: community helper unavailable (" +
        error +
        "); nothing to do"
    );
    return;
  }
  if (typeof community.withdrawUnbackedEntry !== "function") {
    console.log(
      "unbacked-place withdrawal: helper predates withdrawUnbackedEntry; nothing to do"
    );
    return;
  }

  // Entries with no surviving recommendation. Pending entries are included:
  // one with nothing behind it is equally an orphan, and the helper is a no-op
  // for anything still backed.
  const unbacked = arrayOf(
    new DynamicModel({ id: "", venue_name: "", city: "", status: "" })
  );
  try {
    app
      .db()
      .newQuery(
        "SELECT w.id, w.venue_name, w.city, w.status " +
          "FROM community_waitlist_entries w " +
          "WHERE NOT EXISTS (" +
          "SELECT 1 FROM community_recommendations r WHERE r.waitlist = w.id" +
          ") ORDER BY w.id"
      )
      .all(unbacked);
  } catch (error) {
    console.log("unbacked-place withdrawal: unable to inspect entries: " + error);
    return;
  }

  let withdrawn = 0;
  let venuesRemoved = 0;
  let sharesDetached = 0;
  for (const row of unbacked) {
    try {
      const result = community.withdrawUnbackedEntry(app, row.id);
      if (!result || !result.withdrawn) continue;
      withdrawn++;
      if (result.deletedVenue) venuesRemoved++;
      sharesDetached += Number(result.detachedShares || 0);
      console.log(
        "unbacked-place withdrawal: removed " +
          row.venue_name +
          " (" +
          row.city +
          ", was " +
          row.status +
          ")"
      );
    } catch (error) {
      console.log(
        "unbacked-place withdrawal: entry " + row.id + " not withdrawn: " + error
      );
    }
  }

  console.log(
    "unbacked-place withdrawal: withdrew " +
      withdrawn +
      " unbacked " +
      (withdrawn === 1 ? "entry" : "entries") +
      ", removed " +
      venuesRemoved +
      " catalogue " +
      (venuesRemoved === 1 ? "venue" : "venues") +
      ", detached " +
      sharesDetached +
      " private " +
      (sharesDetached === 1 ? "share" : "shares")
  );
}, () => {
  // Forward-only: the withdrawn places were public catalogue state with nobody
  // standing behind them and must not be recreated by a history rollback.
  return null;
});

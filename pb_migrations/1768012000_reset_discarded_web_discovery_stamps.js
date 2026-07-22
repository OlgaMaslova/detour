/// <reference path="../pb_data/types.d.ts" />
//
// One-off after removing the coarse "high" confidence gate from
// enrichVenueFromWebSearch (pb_hooks/community_waitlist.js): venues the old
// gate rejected were stamped web_discovery_at and would otherwise not be
// re-attempted until the weekly retry window (WEB_DISCOVERY_RETRY_MS) elapsed.
// Clearing the stamp on exactly those venues — the ones whose note records the
// old "discarded" outcome — lets the next hourly web-discovery sweep re-run
// them under per-field verification. The stamp is only a retry throttle, so
// clearing it costs nothing beyond one more model call per still-incomplete
// venue; the sweep still no-ops for any venue with nothing missing. The note
// is left in place as an audit trail until the next sweep overwrites it.
migrate((app) => {
  const discarded = app.findRecordsByFilter(
    "venues",
    "web_discovery_note ~ 'discarded'",
    "created",
    10000,
    0
  );
  for (const venue of discarded) {
    try {
      venue.set("web_discovery_at", "");
      app.save(venue);
    } catch (error) {
      console.log(
        "reset web-discovery stamp: venue " + venue.id + " skipped: " + error
      );
    }
  }
}, () => {
  // Forward-only: the cleared stamps are a transient retry throttle, not state
  // worth reconstructing, and the original timestamps are not recoverable.
  return null;
});

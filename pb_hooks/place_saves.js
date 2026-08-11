/// <reference path="../pb_data/types.d.ts" />
//
// Wanna go — the private rung, and the hook the follow-up hangs off.
//
// A member marks somewhere they mean to get to. Nobody is told, nothing is
// counted, and no other member can learn that the row exists. See
// docs/wanna-go-spec.md; the constraint is the whole design and everything in
// this file follows from it.
//
// This is a module, not a hook file: nothing here registers anything (the routes
// live in place_saves.pb.js). PocketBase runs every hook callback in its own VM,
// so every function here must be reached through a `require()` made INSIDE the
// callback that uses it.
//
// WHAT IS DELIBERATELY ABSENT, and must stay absent:
//
//   a per-place count       a visible tally is a popularity ranking
//   a projection            nothing here is ever computed for another member
//   a notification          the recommender is never told somebody saved theirs
//
// The last one is a real cost — saving produces no feedback for the giver, unlike
// Been & loved — and it is accepted, because the alternative turns a private
// bookmark into a public signal by the back door.

// The venue a waiting-list entry resolves to, published first and falling back to
// the canonical catalogue row — the same expression place_endorsements.js uses,
// so the two features cannot disagree about which venue a place is.
const ENTRY_VENUE_SQL =
  "COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue)";

/** This member's save for this place, or null. */
function findSave(app, memberId, entryId) {
  try {
    return app.findFirstRecordByFilter(
      "community_place_saves",
      "member = {:member} && entry = {:entry}",
      { member: memberId, entry: entryId }
    );
  } catch {
    return null;
  }
}

/**
 * The caller's own list, newest first — the only read path this feature has.
 *
 * Safe to serve in full precisely because it is never anybody else's: these are
 * the member's own rows, which they may already read directly off the collection.
 * The route exists so the list arrives with the place's name and city attached
 * rather than a column of entry ids the client would have to resolve against a
 * catalogue it may not hold.
 *
 * ONE STATE PER PLACE IS A DISPLAY RULE, NOT A STORAGE RULE. A member who saved
 * a place and has since been to it, or written about it, keeps the save row —
 * this query just stops returning it, because the tab shows the highest state
 * they have reached and that is no longer Wanna go. Withdraw the mark or delete
 * the note and the place comes back here, exactly where they left it.
 *
 * The alternative — deleting the row on the way up the ladder — looks tidier and
 * quietly destroys something. A mis-tapped Been & loved would take a member's own
 * bookmark with it and there would be nothing to restore, because the intention
 * was never anybody's to discharge but theirs. Only an explicit Remove deletes,
 * because only that is the member saying so.
 */
function ownSaves(app, memberId) {
  const rows = arrayOf(
    new DynamicModel({
      id: "",
      venue_id: "",
      venue_name: "",
      city: "",
      country: "",
      source: "",
      created: "",
    })
  );
  try {
    app
      .db()
      .newQuery(
        "SELECT s.id, " + ENTRY_VENUE_SQL + " AS venue_id, " +
          "w.venue_name, w.city, w.country, s.source, s.created " +
          "FROM community_place_saves s " +
          "JOIN community_place_entries w ON w.id = s.entry " +
          "WHERE s.member = {:member} " +
          // Superseded by a higher rung: hidden, never deleted. See the header.
          "AND NOT EXISTS (SELECT 1 FROM community_place_endorsements e " +
          "WHERE e.entry = s.entry AND e.member = s.member) " +
          "AND NOT EXISTS (SELECT 1 FROM community_recommendations r " +
          "WHERE r.entry = s.entry AND r.member = s.member) " +
          "ORDER BY s.created DESC, s.id DESC LIMIT 500"
      )
      .bind({ member: memberId })
      .all(rows);
  } catch {
    return [];
  }
  const items = [];
  for (const row of rows) {
    items.push({
      id: row.id,
      venue_id: String(row.venue_id || ""),
      venue_name: row.venue_name,
      city: row.city,
      country: row.country,
      source: row.source,
      created: row.created,
    });
  }
  return items;
}

module.exports = {
  findSave,
  ownSaves,
};

/// <reference path="../pb_data/types.d.ts" />
//
// Drops the v1 schema the current product replaced, plus two collections that
// were provisioned and never wired up. None of them is read or written by
// anything live: zero references in `src/` and `pb_hooks/` (the `'detours'`
// matches in `src/community.ts` are a UI tab name, and the `'places'` matches in
// `src/main.ts` and `pb_hooks/launch_metrics.js` are `place`/`places`
// pluralisation copy).
//
//   detours          v1 saved itineraries — title/description/city/places/
//                    share_slug. Empty. Dropped FIRST: `detours.places` is the
//                    only relation pointing into this set, so `places` cannot go
//                    while it exists.
//   places           the v1 place catalogue, entirely separate from `venues` and
//                    still PUBLICLY READABLE with 12 guide-badged rows
//                    (Michelin/MOF/other: Arpège, Septime, DiverXO, Benu,
//                    Tartine Bakery, …). The largest remaining guide-oriented
//                    leftover and the reason this migration exists.
//   recommendations  the v1 public contribution form. Superseded by
//                    `community_recommendations`. NOTE: its create rule allowed
//                    public writes, so a production row here would be a real
//                    submission from a real person — every row is logged in full
//                    before the drop so nothing disappears without a trace in
//                    the deploy log.
//   endorsements     member-vouching scaffold from
//                    1767987000_add_endorsement_verification.js. Never wired to
//                    a hook, route, or screen. Empty.
//   users            PocketBase's default auth collection, superseded by
//                    `members`. Empty.
//
// Verified before writing: no surviving collection has a relation field into any
// of these, and no API rule on any surviving collection names them.
//
// Forward-only, idempotent, and fail-safe: a missing collection is a no-op, and a
// per-collection failure is logged and skipped so one bad drop cannot block boot.
migrate((app) => {
  // Order matters: `detours` holds the relation into `places`.
  const DROP_ORDER = [
    "detours",
    "places",
    "recommendations",
    "endorsements",
    "users",
  ];
  // Collections whose rows could be real user input — logged individually, not
  // just counted, before they go.
  const LOG_ROWS = { recommendations: true };

  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
    }
  }

  function countRowsOrNull(collection) {
    try {
      return app.countRecords(collection.id);
    } catch {
      return null;
    }
  }

  let dropped = 0;
  for (const name of DROP_ORDER) {
    const collection = findCollectionOrNull(name);
    if (!collection) {
      console.log("v1 legacy removal: " + name + " already gone");
      continue;
    }

    const count = countRowsOrNull(collection);
    console.log(
      "v1 legacy removal: dropping " +
        name +
        " (" +
        (count === null ? "row count unavailable" : count + " rows") +
        ")"
    );

    // Public-write collections get their contents preserved in the log first.
    if (LOG_ROWS[name] && count) {
      try {
        for (const record of app.findRecordsByFilter(
          collection.id,
          "id != ''",
          "created",
          500,
          0,
          {}
        )) {
          console.log(
            "v1 legacy removal: " +
              name +
              " row " +
              record.id +
              " | place=" +
              record.getString("place_name") +
              " | status=" +
              record.getString("status") +
              " | contributor=" +
              record.getString("contributor_name") +
              " <" +
              record.getString("contributor_email") +
              "> | " +
              record.getString("description")
          );
        }
      } catch (error) {
        console.log(
          "v1 legacy removal: could not log " + name + " rows before drop: " + error
        );
      }
    }

    try {
      app.delete(collection);
      dropped++;
    } catch (error) {
      console.log("v1 legacy removal: could not drop " + name + ": " + error);
    }
  }

  console.log("v1 legacy removal: dropped " + dropped + " collections");
}, () => {
  // Forward-only: these collections held public, externally visible state and
  // must not be recreated empty by a migration-history rollback.
  return null;
});

/// <reference path="../pb_data/types.d.ts" />
//
// `community_waitlist_entries` becomes `community_place_entries`, and the
// `waitlist` relation on the four collections that point at it becomes `entry`.
//
// There has been no waitlist since publication became "a verified member's
// first meaningful note publishes the place immediately" — the old name
// described the launch-era queue, and it kept teaching readers a wait that
// does not exist. The collection is the shared record of a member-submitted
// place: what was typed, its pending/published state, and the `published_venue`
// link to the public catalogue row. `community_place_entries` says that.
//
// Renames only. Field and collection identity in PocketBase is the id, so the
// relations keep pointing where they pointed and every row keeps its data; the
// index definitions are rewritten because they are stored as SQL strings and
// name the old table and column. No API rule anywhere references the old names
// (checked at migration time across every collection), so rules are untouched.

// Every collection holding a `waitlist` relation into the entries collection.
const REFERRERS = [
  "community_recommendations",
  "community_shares",
  "community_place_images",
  "community_place_saves",
  "community_place_endorsements",
];

migrate(
  (app) => {
    const entries = app.findCollectionByNameOrId("community_waitlist_entries");
    entries.name = "community_place_entries";
    entries.indexes = entries.indexes.map((sql) =>
      sql
        .replace(/community_waitlist_entries/g, "community_place_entries")
        .replace(/idx_community_waitlist_/g, "idx_community_place_entries_")
    );
    app.save(entries);

    for (const name of REFERRERS) {
      const col = app.findCollectionByNameOrId(name);
      const field = col.fields.getByName("waitlist");
      if (!field) continue;
      field.name = "entry";
      // Index SQL names the column, and several index names carry the word too
      // (`idx_community_recommendations_member_waitlist`, `idx_community_shares_waitlist`,
      // `idx_community_place_endorsements_waitlist`, …).
      col.indexes = col.indexes.map((sql) => sql.replace(/waitlist/g, "entry"));
      app.save(col);
    }
  },
  (app) => {
    for (const name of REFERRERS) {
      const col = app.findCollectionByNameOrId(name);
      const field = col.fields.getByName("entry");
      if (!field) continue;
      field.name = "waitlist";
      col.indexes = col.indexes.map((sql) => sql.replace(/\bentry\b/g, "waitlist").replace(/_entry/g, "_waitlist"));
      app.save(col);
    }

    const entries = app.findCollectionByNameOrId("community_place_entries");
    entries.name = "community_waitlist_entries";
    entries.indexes = entries.indexes.map((sql) =>
      sql
        .replace(/idx_community_place_entries_/g, "idx_community_waitlist_")
        .replace(/community_place_entries/g, "community_waitlist_entries")
    );
    app.save(entries);
  }
);

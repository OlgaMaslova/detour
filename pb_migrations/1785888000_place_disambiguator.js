/// <reference path="../pb_data/types.d.ts" />
//
// Two places can share a name in one city, and a member no longer types a country.
//
// Place identity was (normalized_name, normalized_city) — a unique index on
// `community_waitlist_entries`, mirrored by `idx_venues_name_city` on `venues`
// and by the open-submission index on `member_place_contributions`. Address was
// never part of it. So two genuinely different places sharing a name in one city
// (two branches of a café; a wine bar and a bakery both called Central) could not
// both exist: the second submission silently converged onto the first entry and
// the second member's note landed on the first place's page.
//
// Identity becomes (name, city, disambiguator), where the disambiguator is the
// street or neighbourhood that tells two same-named places apart. It is empty for
// every place that needs no qualifier — which is nearly all of them — so existing
// rows keep working unchanged and the common case still de-duplicates exactly as
// before. The submission flow only ever asks for it after a collision.
//
// The same form drops its country field, so `country` stops being required on the
// rows a member creates. It is not abandoned: the OSM enrichment pass fills it
// from Nominatim's address details, and the client already falls back to the
// city's country for display. And `community_place_images.source_url` stops being
// required, because a photo is now uploaded rather than linked.
//
// Idempotent by construction: every field, index and backfill below is guarded or
// written as a no-op-on-repeat statement, so a partial run retried on the next
// boot reaches the same state.

// Nothing here needs to normalize a value: every existing row is a place that
// needed no qualifier, so the backfills below write '' rather than deriving
// anything. Only the runtime, which has the member's typed street in hand,
// computes a normalized disambiguator.

// A unique index over a nullable column is the trap here: SQLite treats NULLs as
// distinct, so adding the column and indexing it naively would let two rows with
// the same name and city both pass with a NULL qualifier — silently undoing the
// de-duplication this index exists for. Every index below wraps the new column in
// COALESCE, and every backfill writes '' rather than leaving NULL, so the
// invariant holds no matter which of the two lands first.
const WAITLIST_INDEX =
  "CREATE UNIQUE INDEX `idx_community_waitlist_normalized_place` " +
  "ON `community_waitlist_entries` " +
  "(normalized_name, normalized_city, COALESCE(normalized_disambiguator, ''))";
const WAITLIST_INDEX_OLD =
  "CREATE UNIQUE INDEX `idx_community_waitlist_normalized_place` " +
  "ON `community_waitlist_entries` (normalized_name, normalized_city)";

const VENUES_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name_city " +
  "ON venues (name, city, COALESCE(disambiguator, ''))";
const VENUES_INDEX_OLD =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name_city ON venues (name, city)";

const CONTRIBUTIONS_INDEX =
  "CREATE UNIQUE INDEX `idx_member_place_contributions_open_place` " +
  "ON `member_place_contributions` " +
  "(normalized_name, normalized_city, COALESCE(normalized_disambiguator, '')) " +
  "WHERE status = 'in_review' OR status = 'approved'";
const CONTRIBUTIONS_INDEX_OLD =
  "CREATE UNIQUE INDEX `idx_member_place_contributions_open_place` " +
  "ON `member_place_contributions` (normalized_name, normalized_city) " +
  "WHERE status = 'in_review' OR status = 'approved'";

// Swaps one index definition for another on a collection, tolerating a repeat run
// in either direction.
function replaceIndex(app, collection, from, to) {
  let changed = false;
  const fromAt = collection.indexes.indexOf(from);
  if (fromAt !== -1) {
    collection.indexes.splice(fromAt, 1);
    changed = true;
  }
  if (collection.indexes.indexOf(to) === -1) {
    collection.indexes.push(to);
    changed = true;
  }
  if (changed) app.save(collection);
  return changed;
}

// Relaxes a required field to optional, leaving its every other property alone.
function makeOptional(app, collection, fieldName) {
  const field = collection.fields.getByName(fieldName);
  if (!field || field.required !== true) return false;
  field.required = false;
  app.save(collection);
  return true;
}

migrate(
  (app) => {
    // --- community_waitlist_entries -----------------------------------------
    const waitlist = app.findCollectionByNameOrId("community_waitlist_entries");

    // What the member sees and types: "Calle de la Palma", "Mission District".
    if (!waitlist.fields.getByName("disambiguator")) {
      waitlist.fields.add(
        new TextField({
          name: "disambiguator",
          max: 120,
          required: false,
        })
      );
      app.save(waitlist);
    }
    // What the index compares. Held separately for the same reason
    // normalized_name is: the displayed value keeps the member's capitalisation
    // and punctuation, while identity ignores both.
    if (!waitlist.fields.getByName("normalized_disambiguator")) {
      waitlist.fields.add(
        new TextField({
          name: "normalized_disambiguator",
          max: 120,
          required: false,
          hidden: true,
        })
      );
      app.save(waitlist);
    }
    makeOptional(app, waitlist, "country");

    app
      .db()
      .newQuery(
        "UPDATE community_waitlist_entries " +
          "SET disambiguator = COALESCE(disambiguator, ''), " +
          "normalized_disambiguator = COALESCE(normalized_disambiguator, '') " +
          "WHERE disambiguator IS NULL OR normalized_disambiguator IS NULL"
      )
      .execute();

    replaceIndex(app, waitlist, WAITLIST_INDEX_OLD, WAITLIST_INDEX);

    // --- venues --------------------------------------------------------------
    // The qualifier has to reach the venue too, or two distinct entries would
    // collide on idx_venues_name_city the moment both published.
    const venues = app.findCollectionByNameOrId("venues");
    if (!venues.fields.getByName("disambiguator")) {
      venues.fields.add(
        new TextField({
          name: "disambiguator",
          max: 120,
          required: false,
        })
      );
      app.save(venues);
    }
    makeOptional(app, venues, "country");

    app
      .db()
      .newQuery(
        "UPDATE venues SET disambiguator = COALESCE(disambiguator, '') " +
          "WHERE disambiguator IS NULL"
      )
      .execute();

    replaceIndex(app, venues, VENUES_INDEX_OLD, VENUES_INDEX);

    // --- member_place_contributions -----------------------------------------
    // The curator submission lane keeps its required country — that form still
    // asks for one — but its open-submission index has to widen in step, or a
    // second branch could be created on the waiting list and then rejected here.
    const contributions = app.findCollectionByNameOrId("member_place_contributions");
    if (!contributions.fields.getByName("disambiguator")) {
      contributions.fields.add(
        new TextField({
          name: "disambiguator",
          max: 120,
          required: false,
        })
      );
      app.save(contributions);
    }
    if (!contributions.fields.getByName("normalized_disambiguator")) {
      contributions.fields.add(
        new TextField({
          name: "normalized_disambiguator",
          max: 120,
          required: false,
          hidden: true,
        })
      );
      app.save(contributions);
    }

    app
      .db()
      .newQuery(
        "UPDATE member_place_contributions " +
          "SET disambiguator = COALESCE(disambiguator, ''), " +
          "normalized_disambiguator = COALESCE(normalized_disambiguator, '') " +
          "WHERE disambiguator IS NULL OR normalized_disambiguator IS NULL"
      )
      .execute();

    replaceIndex(app, contributions, CONTRIBUTIONS_INDEX_OLD, CONTRIBUTIONS_INDEX);

    // --- community_place_images ---------------------------------------------
    // An uploaded photo has no public source URL to record. The column stays for
    // the rows that were submitted as links, and for the LLM-discovered covers
    // that still arrive as URLs.
    const images = app.findCollectionByNameOrId("community_place_images");
    makeOptional(app, images, "source_url");
  },
  (app) => {
    // Reverting narrows identity again, so any second branch created under the
    // wide index would violate the old one. Retire those rows first — newest
    // wins, which is the same rule the pre-migration flow applied implicitly by
    // converging every later submission onto the first entry.
    app
      .db()
      .newQuery(
        "UPDATE community_waitlist_entries SET status = 'withdrawn' " +
          "WHERE TRIM(COALESCE(normalized_disambiguator, '')) != '' " +
          "AND EXISTS (" +
          "SELECT 1 FROM community_waitlist_entries other " +
          "WHERE other.normalized_name = community_waitlist_entries.normalized_name " +
          "AND other.normalized_city = community_waitlist_entries.normalized_city " +
          "AND other.id != community_waitlist_entries.id " +
          "AND TRIM(COALESCE(other.normalized_disambiguator, '')) = ''" +
          ")"
      )
      .execute();

    const waitlist = app.findCollectionByNameOrId("community_waitlist_entries");
    replaceIndex(app, waitlist, WAITLIST_INDEX, WAITLIST_INDEX_OLD);
    for (const name of ["disambiguator", "normalized_disambiguator"]) {
      const field = waitlist.fields.getByName(name);
      if (field) {
        waitlist.fields.removeById(field.id);
        app.save(waitlist);
      }
    }

    const venues = app.findCollectionByNameOrId("venues");
    replaceIndex(app, venues, VENUES_INDEX, VENUES_INDEX_OLD);
    const venueField = venues.fields.getByName("disambiguator");
    if (venueField) {
      venues.fields.removeById(venueField.id);
      app.save(venues);
    }

    const contributions = app.findCollectionByNameOrId("member_place_contributions");
    replaceIndex(app, contributions, CONTRIBUTIONS_INDEX, CONTRIBUTIONS_INDEX_OLD);
    for (const name of ["disambiguator", "normalized_disambiguator"]) {
      const field = contributions.fields.getByName(name);
      if (field) {
        contributions.fields.removeById(field.id);
        app.save(contributions);
      }
    }

    // `country` and `source_url` are deliberately left optional. Rows created
    // while they were optional would fail validation the moment anything saved
    // them again, and the enrichment pass backfills country on its own schedule.
  }
);

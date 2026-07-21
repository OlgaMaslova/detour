/// <reference path="../pb_data/types.d.ts" />
//
// Retires the editorial_local_pick lane: Detour keeps a single
// member-recommended lane (the public "Detourist List", stored as
// community_selection). The rows seeded by
// pb_migrations/1767996000_seed_sf_editorial_local_favorites.js and
// pb_migrations/1767998000_expand_san_francisco_bay_area_editorial.js are
// folded into that lane, keeping their source attribution, verification
// notes, and occasion tags untouched for auditability. The retired value is
// then removed from the provenance select so it cannot be reused.
//
// Forward-only and retry-safe: the row update matches nothing on retry and
// the field update is idempotent.
migrate((app) => {
  // Fold the retired lane's rows into community_selection, aligning their
  // level label with the established community rows.
  app
    .db()
    .newQuery(
      "UPDATE venue_awards SET " +
        "provenance = 'community_selection', level = 'Detour community selection' " +
        "WHERE provenance = 'editorial_local_pick'"
    )
    .execute();

  // Narrow the select so editorial_local_pick cannot be written again.
  const awards = app.findCollectionByNameOrId("venue_awards");
  const provenance = awards.fields.getByName("provenance");
  if (provenance && provenance.type() === "select") {
    provenance.values = ["guide_backed", "community_selection"];
    app.save(awards);
  }
}, () => {
  // Forward-only: the editorial_local_pick lane is retired.
  return null;
});

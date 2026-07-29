/// <reference path="../pb_data/types.d.ts" />
//
// Removes the guide-provenance stack. Detour publishes one lane — places a real
// member recommended — so the machinery that existed to carry external guide
// awards (Guía Repsol, Michelin, 50 Top Pizza, the World's 100 Best Coffee
// Shops, and the retired editorial sources) is dead weight, and dead weight in
// the catalogue is what let `Hola Coffee Lagasca` stay on the public list with
// nobody behind it.
//
// Three things go, in this order (each step clears the references the next one
// would otherwise trip over):
//   1. The guide-only fields on `venue_awards` — `source_record`, `import`,
//      `rank`, `source_url`, `verification_status`, `verification_note`. None is
//      read by the frontend or written by a hook after this change; none is
//      named in an index (the three `venue_awards` indexes cover
//      source/venue/year/level, year, and provenance/current).
//   2. The collections `venue_source_entries` (raw per-source assertions),
//      `source_records` (cited URLs), and `import_provenance` (bulk-import audit
//      rows). Zero references in `src/` and `pb_hooks/`; step 1 removes the two
//      relation fields that pointed at the latter two.
//   3. Every `guide_sources` row except `detour-community`.
//
// What deliberately STAYS:
//   - The `guide_sources` collection and its `detour-community` row. It is the
//     required `source` of all 11 community selections, both hooks look it up
//     by slug on every publication, and `src/data.ts` joins awards to it. The
//     row cannot be deleted while awards reference it, and must not be.
//   - `venue_awards` itself, plus `provenance`. The collection is now purely the
//     member-recommendation lane. `provenance` is the discriminator
//     `isDetourOriginated` reads in `src/data.ts` and is covered by
//     `idx_venue_awards_provenance_current`; only its unused `guide_backed`
//     option is a leftover, and narrowing the select would mean dropping and
//     re-adding the column, wiping the value on all 11 live awards to remove an
//     option nothing writes. Not worth it.
//
// Forward-only, idempotent, and fail-safe: every field, collection, and row is
// checked before it is touched, so an interrupted boot converges on re-run; a
// guide source still referenced by an award is skipped rather than deleted, and
// a per-row failure is logged and skipped so one bad row cannot block startup.
migrate((app) => {
  const COMMUNITY_SOURCE_SLUG = "detour-community";
  // Guide-era columns on the member lane. Order is irrelevant — each is removed
  // by name and none participates in an index.
  const GUIDE_AWARD_FIELDS = [
    "source_record",
    "import",
    "rank",
    "source_url",
    "verification_status",
    "verification_note",
  ];
  // Dropped after step 1, so the `venue_awards` relations into `source_records`
  // and `import_provenance` are already gone.
  const GUIDE_COLLECTIONS = [
    "venue_source_entries",
    "source_records",
    "import_provenance",
  ];

  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
    }
  }

  // 1. Strip the guide-only columns from the member lane.
  const awards = findCollectionOrNull("venue_awards");
  if (awards) {
    const removed = [];
    for (const name of GUIDE_AWARD_FIELDS) {
      if (!awards.fields.getByName(name)) continue;
      awards.fields.removeByName(name);
      removed.push(name);
    }
    if (removed.length) {
      app.save(awards);
      console.log(
        "guide-stack removal: dropped venue_awards fields " + removed.join(", ")
      );
    } else {
      console.log("guide-stack removal: venue_awards already has no guide fields");
    }
  } else {
    console.log("guide-stack removal: venue_awards missing; skipping field sweep");
  }

  // 2. Drop the guide-provenance collections.
  for (const name of GUIDE_COLLECTIONS) {
    const collection = findCollectionOrNull(name);
    if (!collection) {
      console.log("guide-stack removal: " + name + " already gone");
      continue;
    }
    try {
      app.delete(collection);
      console.log("guide-stack removal: dropped collection " + name);
    } catch (error) {
      console.log(
        "guide-stack removal: could not drop " + name + ": " + error
      );
    }
  }

  // 3. Delete every guide source except the community lane's own.
  const sources = findCollectionOrNull("guide_sources");
  if (!sources) {
    console.log("guide-stack removal: guide_sources missing; nothing more to do");
    return;
  }

  let deleted = 0;
  let kept = 0;
  let sourceRecords;
  try {
    sourceRecords = app.findRecordsByFilter(sources.id, "id != ''", "slug", 1000, 0, {});
  } catch (error) {
    console.log(
      "guide-stack removal: unable to list guide_sources; leaving rows alone: " + error
    );
    return;
  }

  for (const source of sourceRecords) {
    const slug = source.getString("slug").trim().toLowerCase();
    if (slug === COMMUNITY_SOURCE_SLUG) {
      kept++;
      continue;
    }

    // An award still pointing here means a place is published through this
    // source; deleting it would break a required relation. Leave it and say so.
    if (awards) {
      let referencing = [];
      try {
        referencing = app.findRecordsByFilter(
          awards.id,
          "source = {:source}",
          "id",
          1,
          0,
          { source: source.id }
        );
      } catch (error) {
        console.log(
          "guide-stack removal: keeping " +
            source.getString("name") +
            " (cannot check awards: " +
            error +
            ")"
        );
        kept++;
        continue;
      }
      if (referencing.length > 0) {
        console.log(
          "guide-stack removal: keeping " +
            source.getString("name") +
            ": a venue_awards row still references it"
        );
        kept++;
        continue;
      }
    }

    try {
      app.delete(source);
      deleted++;
      console.log("guide-stack removal: deleted guide source " + source.getString("name"));
    } catch (error) {
      console.log(
        "guide-stack removal: guide source " +
          source.id +
          " (" +
          source.getString("name") +
          ") not deleted: " +
          error
      );
    }
  }

  console.log(
    "guide-stack removal: deleted " +
      deleted +
      " guide sources; kept " +
      kept +
      " (the community lane and anything still referenced)"
  );
}, () => {
  // Forward-only: the guide catalogue and its provenance trail are removed
  // public state and must not be recreated by a migration-history rollback.
  return null;
});

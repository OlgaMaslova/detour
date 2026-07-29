/// <reference path="../pb_data/types.d.ts" />
//
// Drops the five editorial copy fields from `cities`: title, tagline, footer,
// meta_title, meta_description.
//
// Migration 1767986000 added them to make city copy data-driven, and seeded
// them with guide-era language ("exceptional tables, selected", "published
// recognition from named guides"). Nothing reads them. The frontend takes only
// `venues` from loadLiveCatalogue(); the city hero is built in
// renderDestination, meta in syncDocumentMeta, the footer from FOOTER_TAGLINE,
// and cityConfigFromLive() — the function these fields existed to feed — is
// imported nowhere. No pb_hooks route touches `cities` either.
//
// So the fields were a second, stale source of truth for copy that lives in
// code, still served publicly at /api/collections/cities/records. Dropping
// them removes the stale guide-era text and leaves one place where city copy
// is defined.
//
// The per-city tagline in particular has no future consumer by design: the
// rendered tagline is deliberately one sentence for every city (an instruction
// to contribute, identical everywhere), with the city name carried by the h1
// and the place count by the discovery bar, where it live-updates under
// filters.
//
// Map fields (presentation, center_*, zoom, bounds_*) are deliberately kept.
// They are also unread today, but they are per-city facts rather than copy and
// a fallback map view for a city without plottable pins remains plausible.
migrate(
  (app) => {
    let cities;
    try {
      cities = app.findCollectionByNameOrId("cities");
    } catch {
      // The catalogue migration that creates `cities` has not run yet; it is
      // ordered before this file, so this only happens on databases that never
      // ran it — nothing to drop there.
      return;
    }

    const dropped = [
      "title",
      "tagline",
      "footer",
      "meta_title",
      "meta_description",
    ];

    let changed = false;
    for (const name of dropped) {
      if (cities.fields.getByName(name)) {
        cities.fields.removeByName(name);
        changed = true;
      }
    }

    // Idempotent: a re-run after a partial failure finds nothing to remove.
    if (changed) app.save(cities);
  },
  (app) => {
    // Recreates the columns so the schema round-trips, but not their contents.
    // The values are not restored: they asserted guide recognition as the
    // reason a place is listed, which the catalogue no longer permits
    // (1768019000, 1768019200). The original text remains in git in
    // 1767986000 and 1767998000 if it is ever needed.
    let cities;
    try {
      cities = app.findCollectionByNameOrId("cities");
    } catch {
      return;
    }

    const restored = [
      ["title", 200],
      ["tagline", 400],
      ["footer", 600],
      ["meta_title", 200],
      ["meta_description", 500],
    ];

    let changed = false;
    for (const [name, max] of restored) {
      if (!cities.fields.getByName(name)) {
        cities.fields.add(new TextField({ name, required: false, max }));
        changed = true;
      }
    }

    if (changed) return app.save(cities);
  }
);

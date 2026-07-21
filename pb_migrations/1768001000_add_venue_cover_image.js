/// <reference path="../pb_data/types.d.ts" />
//
// Adds an optional cover image URL to the canonical `venues` collection.
// The value is populated out-of-band by scripts/fetch-venue-cover-images.mjs,
// which resolves each venue's og:image from its official website (or, as a
// fallback, its Instagram profile). No data is seeded here — a boot migration
// cannot verify remote images.
migrate(
  (app) => {
    const venues = app.findCollectionByNameOrId("venues");
    const existing = venues.fields.getByName("image_url");
    if (existing) {
      if (existing.type() !== "url") {
        throw new Error(
          "Cannot safely configure venues.image_url: expected url field, found " + existing.type()
        );
      }
      existing.required = false;
      existing.hidden = false;
    } else {
      venues.fields.add(new URLField({ name: "image_url", required: false }));
    }
    app.save(venues);
  },
  (app) => {
    const venues = app.findCollectionByNameOrId("venues");
    if (venues.fields.getByName("image_url")) {
      venues.fields.removeByName("image_url");
      app.save(venues);
    }
  }
);

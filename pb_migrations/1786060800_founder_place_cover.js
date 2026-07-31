/// <reference path="../pb_data/types.d.ts" />
//
// A founding member can give a place a cover directly.
//
// Every automatic source has a ceiling. A venue's own site increasingly renders
// its og tags in JavaScript, Instagram serves bots an empty shell, and the OSM
// `image` tag is set on roughly one food venue in six hundred. What is left is a
// worklist of live places showing no photograph, and until now the only way to
// put one on a place was to recommend it and attach a photo to that
// recommendation — which asks a curator to author a recommendation they may not
// have to fix a picture.
//
// This is NOT the `curated_image` relation that 1785801600_recommendation_photos
// removed, and it does not reopen what that migration closed. That field pointed
// at a *member's submission* and made one member's photo the shared cover for
// everyone, so a card could pair one member's picture with another member's
// words. This is a place-level cover with no member attribution attached to it at
// all — the same kind of thing `image_url` already is, sourced by a person
// instead of by a scraper. A member's photo still belongs to their
// recommendation, still travels with their note, and still wins over this one
// wherever both exist.
//
// The provenance columns exist so a cover is answerable: a picture on a public
// page with nobody accountable for choosing it is how the wrong picture stays up.
//
// Idempotent by construction: every field is guarded, so a partial run retried on
// the next boot reaches the same state.
migrate(
  (app) => {
    const venues = app.findCollectionByNameOrId("venues");
    const members = app.findCollectionByNameOrId("members");

    // Thumb sizes match community_place_images so every surface can ask for the
    // size it renders rather than downscaling a full-resolution file in the page.
    if (!venues.fields.getByName("curated_cover")) {
      venues.fields.add(
        new FileField({
          name: "curated_cover",
          maxSelect: 1,
          maxSize: 8 * 1024 * 1024,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
          thumbs: ["480x360", "1200x900"],
          required: false,
        })
      );
      app.save(venues);
    }

    if (!venues.fields.getByName("curated_cover_by")) {
      venues.fields.add(
        new RelationField({
          name: "curated_cover_by",
          collectionId: members.id,
          maxSelect: 1,
          required: false,
          // Who chose a cover is curation bookkeeping, not a public fact about the
          // place, and naming a founding member on every card would leak the
          // shape of the founding circle to anyone reading the catalogue.
          hidden: true,
        })
      );
      app.save(venues);
    }

    if (!venues.fields.getByName("curated_cover_at")) {
      venues.fields.add(
        new DateField({
          name: "curated_cover_at",
          hidden: true,
        })
      );
      app.save(venues);
    }
  },
  (app) => {
    const venues = app.findCollectionByNameOrId("venues");
    for (const name of ["curated_cover", "curated_cover_by", "curated_cover_at"]) {
      const field = venues.fields.getByName(name);
      if (field) {
        venues.fields.removeById(field.id);
        app.save(venues);
      }
    }
  }
);

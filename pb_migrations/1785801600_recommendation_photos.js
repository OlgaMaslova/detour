/// <reference path="../pb_data/types.d.ts" />
//
// Photos belong to a recommendation, not to a place.
//
// A place image used to end up on the venue: the member-supplied link on a
// waiting-list entry was merged into `venues.image_url` at publication, and the
// screened curation lane attached its approved snapshot to `venues.curated_image`.
// Both made one member's photo the shared cover for everyone, and both let a
// card pair one member's picture with another member's words.
//
// After this migration a screened photo hangs off the recommendation that
// authored it. `venues.image_url` goes back to being what its name says: a cover
// resolved by the enrichment sweeps from the place's own web presence, never
// written from a member upload, and used only as the fallback when the fronting
// recommendation has no photo of its own.
//
// Idempotent by construction: every field, index, and data fix below is guarded
// or written as a no-op-on-repeat statement, so a partial run that is retried on
// the next boot reaches the same state.
migrate((app) => {
  const images = app.findCollectionByNameOrId("community_place_images");
  const recommendations = app.findCollectionByNameOrId("community_recommendations");

  // The owning recommendation. cascadeDelete carries the spec's deletion rule
  // in the schema itself: withdrawing a recommendation takes its photo with it,
  // with no hook to forget and no window where an orphaned snapshot could be
  // re-attached to somebody else's note.
  if (!images.fields.getByName("recommendation")) {
    images.fields.add(
      new RelationField({
        name: "recommendation",
        collectionId: recommendations.id,
        maxSelect: 1,
        // Not required: rows submitted before this migration are backfilled
        // below, and a required field would reject the very save that fixes
        // them. The submission route requires it for everything new.
        required: false,
        cascadeDelete: true,
      })
    );
    app.save(images);
  }

  // Existing snapshots predate the relation. A submission has always been one
  // member's image for one waiting-list entry, and a recommendation is that
  // same (member, entry) pair, so the owner is recoverable exactly.
  app
    .db()
    .newQuery(
      "UPDATE community_place_images " +
        "SET recommendation = COALESCE((" +
        "SELECT r.id FROM community_recommendations r " +
        "WHERE r.member = community_place_images.submitted_by " +
        "AND r.waitlist = community_place_images.waitlist " +
        "LIMIT 1" +
        "), '') " +
        "WHERE COALESCE(recommendation, '') = ''"
    )
    .execute();

  // Retire any duplicate approved photos before the unique index below can
  // reject them.
  //
  // This has to run against data this migration cannot see. The old approval
  // route superseded the previous photo *of the venue*, not of the
  // recommendation, so one member could end up holding two approved photos for
  // the same recommendation — for instance when an entry was re-published to a
  // different venue, leaving the new venue with no `curated_image` to supersede.
  // Creating a unique index over rows that already violate it fails the whole
  // migration, and a migration that fails is not recorded as applied: the next
  // boot retries it, hits the field that already exists, and the app never comes
  // up. Newest wins; the rest become 'superseded', which is the same state the
  // approval route would have left them in.
  app
    .db()
    .newQuery(
      "UPDATE community_place_images SET status = 'superseded' " +
        "WHERE status = 'approved' AND COALESCE(recommendation, '') != '' " +
        "AND id NOT IN (" +
        "SELECT id FROM (" +
        "SELECT id, ROW_NUMBER() OVER (" +
        "PARTITION BY recommendation ORDER BY created DESC, id DESC" +
        ") AS keep_rank " +
        "FROM community_place_images " +
        "WHERE status = 'approved' AND COALESCE(recommendation, '') != ''" +
        ") WHERE keep_rank = 1" +
        ")"
    )
    .execute();

  // At most one approved photo per recommendation. The approval route also
  // supersedes the previous one, but the invariant that a note can never front
  // two competing covers belongs in the schema.
  const approvedIndex =
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_place_images_recommendation_approved` " +
    "ON `community_place_images` (recommendation) " +
    "WHERE status = 'approved' AND recommendation != ''";
  if (images.indexes.indexOf(approvedIndex) === -1) {
    images.indexes.push(approvedIndex);
    app.save(images);
  }

  // The shared member-uploaded venue cover is gone. The snapshots themselves
  // survive on `community_place_images` and are now reached through the
  // recommendation that submitted them, so dropping this relation removes a
  // pointer, not a photo.
  const venues = app.findCollectionByNameOrId("venues");
  const curatedImage = venues.fields.getByName("curated_image");
  if (curatedImage) {
    venues.fields.removeById(curatedImage.id);
    app.save(venues);
  }

  // Covers that reached `venues.image_url` through the member link merge rather
  // than through enrichment. They are identifiable exactly — the merge copied
  // the entry's value verbatim — and only those are cleared. The nightly
  // `community_cover_sweep` re-resolves a genuine cover for the affected venues
  // from the place's own site or Instagram profile.
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = '' " +
        "WHERE TRIM(COALESCE(image_url, '')) != '' " +
        "AND EXISTS (" +
        "SELECT 1 FROM community_waitlist_entries w " +
        "WHERE w.published_venue = venues.id " +
        "AND TRIM(COALESCE(w.image_url, '')) = TRIM(venues.image_url)" +
        ")"
    )
    .execute();
}, (app) => {
  const images = app.findCollectionByNameOrId("community_place_images");
  const approvedIndex =
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_place_images_recommendation_approved` " +
    "ON `community_place_images` (recommendation) " +
    "WHERE status = 'approved' AND recommendation != ''";
  const indexAt = images.indexes.indexOf(approvedIndex);
  if (indexAt !== -1) {
    images.indexes.splice(indexAt, 1);
    app.save(images);
  }
  const recommendation = images.fields.getByName("recommendation");
  if (recommendation) {
    images.fields.removeById(recommendation.id);
    app.save(images);
  }

  const venues = app.findCollectionByNameOrId("venues");
  if (!venues.fields.getByName("curated_image")) {
    venues.fields.add(
      new RelationField({
        name: "curated_image",
        collectionId: images.id,
        maxSelect: 1,
        required: false,
      })
    );
    app.save(venues);
  }
  // Cleared member-sourced covers are not restored: the sweeps refill
  // `image_url` from the place's own web presence, which is where the field is
  // meant to get its value either way.
});

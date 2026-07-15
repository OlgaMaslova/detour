/// <reference path="../pb_data/types.d.ts" />
//
// Adds the private audit state needed for Detour's controlled community
// publication workflow. This is forward-only and safe to retry after an
// interrupted boot: it only changes missing fields and normalizes the existing
// submission status field in place.
migrate((app) => {
  const submissions = app.findCollectionByNameOrId("detour_submissions");
  const venues = app.findCollectionByNameOrId("venues");
  const awards = app.findCollectionByNameOrId("venue_awards");

  function addFieldIfMissing(collection, field) {
    if (!collection.fields.getByName(field.name)) {
      collection.fields.add(field);
    }
  }

  const status = submissions.fields.getByName("status");
  if (status) {
    status.required = true;
    status.maxSelect = 1;
    status.values = ["pending", "approved", "rejected", "published"];
  }

  addFieldIfMissing(
    submissions,
    new RelationField({
      name: "published_venue",
      hidden: true,
      collectionId: venues.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(
    submissions,
    new RelationField({
      name: "published_award",
      hidden: true,
      collectionId: awards.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(submissions, new DateField({ name: "published_at", hidden: true }));
  addFieldIfMissing(
    submissions,
    new TextField({ name: "publication_audit_id", hidden: true, max: 80 })
  );

  // Preserve the queue boundary even if this migration is retried on a database
  // whose prior migration completed only partially.
  submissions.listRule = "@request.auth.id != '' && member = @request.auth.id";
  submissions.viewRule = "@request.auth.id != '' && member = @request.auth.id";
  submissions.createRule = "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  submissions.updateRule = null;
  submissions.deleteRule = null;
  app.save(submissions);
}, () => {
  // Forward-only: publication audit data must not be deleted on rollback.
  return null;
});

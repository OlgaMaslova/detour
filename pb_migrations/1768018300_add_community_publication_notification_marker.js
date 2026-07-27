/// <reference path="../pb_data/types.d.ts" />
//
// Adds the durable server-owned marker used to reserve a community place's one
// publication-notification attempt. Forward-only and convergent: a retry after
// a partial boot reuses the existing field and changes no other schema state.
migrate((app) => {
  const entries = app.findCollectionByNameOrId("community_waitlist_entries");
  let field = entries.fields.getByName("publication_notification_sent_at");

  if (!field) {
    field = new DateField({
      name: "publication_notification_sent_at",
      required: false,
      hidden: true,
    });
    entries.fields.add(field);
  }
  if (field.type() !== "date") {
    throw new Error(
      "Cannot safely configure community_waitlist_entries.publication_notification_sent_at: expected date field, found " +
        field.type()
    );
  }

  field.required = false;
  field.hidden = true;
  return app.save(entries);
}, () => {
  // Forward-only: removing the marker could allow an already-attempted external
  // notification to be sent again after migration-history rollback.
  return null;
});

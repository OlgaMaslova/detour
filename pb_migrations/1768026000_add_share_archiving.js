/// <reference path="../pb_data/types.d.ts" />
//
// Recipients can archive a share to clear it from their inbox without deleting
// the exchange: the share row (and any replies) stays intact for the sender's
// "Sent" view and for provenance. The field is recipient-writable through the
// existing community_shares update hook, which already restricts updates to
// the recipient and freezes every place/attribution field.
// Forward-only and retry-safe after a partially completed boot.
migrate((app) => {
  const shares = app.findCollectionByNameOrId("community_shares");
  let field = shares.fields.getByName("archived");

  if (!field) {
    field = new BoolField({ name: "archived" });
    shares.fields.add(field);
  }
  if (field.type() !== "bool") {
    throw new Error(
      "Cannot safely configure community_shares.archived: expected bool field, found " +
        field.type()
    );
  }

  field.required = false;
  field.hidden = false;
  app.save(shares);

  // Defensive convergence for databases restored from an intermediate schema.
  app
    .db()
    .newQuery(
      "UPDATE community_shares SET archived = FALSE WHERE archived IS NULL"
    )
    .execute();
}, () => {
  // Forward-only: archive state is member-owned data and is retained.
  return null;
});

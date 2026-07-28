/// <reference path="../pb_data/types.d.ts" />
//
// Senders can archive a share they sent to clear it from their own "Sent"
// view. Archive state is per-side: `archived` (recipient's inbox) and
// `sender_archived` (sender's sent list) are independent, so one member
// tidying their view never hides the exchange from the other. The update hook
// in pb_hooks/main.pb.js scopes each field to its side.
// Forward-only and retry-safe after a partially completed boot.
migrate((app) => {
  const shares = app.findCollectionByNameOrId("community_shares");
  let field = shares.fields.getByName("sender_archived");

  if (!field) {
    field = new BoolField({ name: "sender_archived" });
    shares.fields.add(field);
  }
  if (field.type() !== "bool") {
    throw new Error(
      "Cannot safely configure community_shares.sender_archived: expected bool field, found " +
        field.type()
    );
  }

  field.required = false;
  field.hidden = false;

  // Senders could not update shares at all before this. The update-request
  // hook scopes what each side may change (recipient: seen/archived; sender:
  // sender_archived); every other field stays frozen there.
  shares.updateRule =
    "@request.auth.id != '' && (sender = @request.auth.id || recipient = @request.auth.id)";
  app.save(shares);

  // Defensive convergence for databases restored from an intermediate schema.
  app
    .db()
    .newQuery(
      "UPDATE community_shares SET sender_archived = FALSE WHERE sender_archived IS NULL"
    )
    .execute();
}, () => {
  // Forward-only: archive state is member-owned data and is retained.
  return null;
});

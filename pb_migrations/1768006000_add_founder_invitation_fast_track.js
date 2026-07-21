/// <reference path="../pb_data/types.d.ts" />
//
// Adds private, server-owned Founder invitation provenance. Only Olga's current
// account is bootstrapped as an issuer; direct invitees inherit the separate
// fast-track marker, while their descendants do not. Forward-only and safe to
// retry after a partial boot.
migrate((app) => {
  function ensureHiddenBool(collection, name) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = new BoolField({ name, required: false, hidden: true });
      collection.fields.add(field);
    }
    if (field.type() !== "bool") {
      throw new Error(
        "Cannot safely configure " + collection.name + "." + name +
          ": expected bool field, found " + field.type()
      );
    }
    // These policy markers default false and must never be serialized to
    // member clients.
    field.required = false;
    field.hidden = true;
  }

  const members = app.findCollectionByNameOrId("members");
  ensureHiddenBool(members, "founder_invitation_issuer");
  ensureHiddenBool(members, "direct_founder_invited");
  app.save(members);

  // Bind the immutable member id rather than an email that can change or be
  // confused with a different dashboard/operator identity.
  app
    .db()
    .newQuery(
      "UPDATE members SET founder_invitation_issuer = TRUE " +
        "WHERE id = {:olga} AND COALESCE(founder_invitation_issuer, FALSE) = FALSE"
    )
    .bind({ olga: "sh86mgpuicyisau" })
    .execute();

  // Backfill only direct children of an authorized issuer. A direct invitee's
  // own descendants remain standard members unless that invitee is separately
  // and explicitly authorized as an issuer.
  app
    .db()
    .newQuery(
      "UPDATE members SET direct_founder_invited = TRUE " +
        "WHERE COALESCE(direct_founder_invited, FALSE) = FALSE " +
        "AND EXISTS (" +
        "SELECT 1 FROM members issuer " +
        "WHERE issuer.id = members.invited_by " +
        "AND COALESCE(issuer.founder_invitation_issuer, FALSE) = TRUE" +
        ")"
    )
    .execute();
}, () => {
  // Forward-only: Founder invitation provenance affects persistent publication
  // policy and must not be erased on migration-history rollback.
  return null;
});

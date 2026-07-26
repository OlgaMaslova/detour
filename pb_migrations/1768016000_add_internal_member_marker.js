/// <reference path="../pb_data/types.d.ts" />
//
// Marks only reserved, non-human member fixtures so they never surface in
// member discovery. Forward-only and safe to retry after a partial boot.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");
  let field = members.fields.getByName("internal_member");

  if (!field) {
    field = new BoolField({
      name: "internal_member",
      required: false,
      hidden: true,
    });
    members.fields.add(field);
  }
  if (field.type() !== "bool") {
    throw new Error(
      "Cannot safely configure members.internal_member: expected bool field, found " +
        field.type()
    );
  }

  field.required = false;
  field.hidden = true;
  app.save(members);

  // Converge databases restored from an intermediate schema without touching
  // any established marker value.
  app
    .db()
    .newQuery(
      "UPDATE members SET internal_member = FALSE WHERE internal_member IS NULL"
    )
    .execute();

  // These immutable ids belong to reserved curation/verification fixtures.
  // No email, name, or other mutable identity can cause a real member to be
  // marked, and the predicate makes retries a no-op after convergence.
  app
    .db()
    .newQuery(
      "UPDATE members SET internal_member = TRUE " +
        "WHERE id IN ({:curationProof}, {:liveVerification}, {:frontendVerification}) " +
        "AND COALESCE(internal_member, FALSE) = FALSE"
    )
    .bind({
      curationProof: "s5cd3wrhi7cum2w",
      liveVerification: "bkm1wb849g6mcfe",
      frontendVerification: "tsx4fttj93c3pgm",
    })
    .execute();
}, () => {
  // Forward-only: fixture classification must not be removed from persistent
  // member data on migration-history rollback.
  return null;
});

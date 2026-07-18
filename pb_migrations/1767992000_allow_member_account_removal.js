/// <reference path="../pb_data/types.d.ts" />
//
// Lets a member delete their own account. Invites now cascade with their
// issuer (and with the member who claimed them), so account removal cannot
// leave an invite pointing at a missing member or a redeemed code that looks
// unclaimed again. Recommendations and shares already cascade; waitlist
// participant lists simply drop the removed member.
migrate((app) => {
  const invites = app.findCollectionByNameOrId("invites");
  for (const name of ["issued_by", "claimed_by"]) {
    const field = invites.fields.getByName(name);
    if (field) field.cascadeDelete = true;
  }
  app.save(invites);

  const members = app.findCollectionByNameOrId("members");
  members.deleteRule = "@request.auth.id != '' && id = @request.auth.id";
  app.save(members);
}, (app) => {
  const members = app.findCollectionByNameOrId("members");
  members.deleteRule = null;
  app.save(members);

  const invites = app.findCollectionByNameOrId("invites");
  for (const name of ["issued_by", "claimed_by"]) {
    const field = invites.fields.getByName(name);
    if (field) field.cascadeDelete = false;
  }
  app.save(invites);
});

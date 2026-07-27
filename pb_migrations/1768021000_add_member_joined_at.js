/// <reference path="../pb_data/types.d.ts" />
//
// The members auth collection intentionally has no created autodate field.
// Track join time explicitly for accounts created after this migration without
// fabricating dates for existing members, whose joined_at value remains blank.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");
  if (members.type !== "auth") {
    throw new Error("members must remain an auth collection");
  }

  let joinedAt = members.fields.getByName("joined_at");
  if (!joinedAt) {
    joinedAt = new DateField({
      name: "joined_at",
      required: false,
      hidden: true,
    });
    members.fields.add(joinedAt);
  }
  if (joinedAt.type() !== "date") {
    throw new Error(
      "Cannot safely configure members.joined_at: expected date field, found " +
        joinedAt.type()
    );
  }

  joinedAt.required = false;
  joinedAt.hidden = true;
  return app.save(members);
}, () => {
  // Forward-only: removing this field would discard future join history.
  return null;
});

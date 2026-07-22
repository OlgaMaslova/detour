/// <reference path="../pb_data/types.d.ts" />
//
// Moves Detour's verified invitation membership into one shared discovery
// circle. Existing members become discoverable once when this migration is
// first applied; afterwards each member still owns the existing preference and
// may opt out. Legacy denormalized display names remain stored for internal
// share/reply writes, but are hidden from generic client record projections.
// Forward-only and safe to retry after any partially completed boot.
migrate((app) => {
  function ensureFieldType(collection, name, expectedType) {
    const field = collection.fields.getByName(name);
    if (!field) return null;
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " +
          collection.name +
          "." +
          name +
          ": expected " +
          expectedType +
          " field, found " +
          field.type()
      );
    }
    return field;
  }

  const members = app.findCollectionByNameOrId("members");
  let discoveryVisible = ensureFieldType(members, "discovery_visible", "bool");
  if (!discoveryVisible) {
    discoveryVisible = new BoolField({ name: "discovery_visible" });
    members.fields.add(discoveryVisible);
  }
  discoveryVisible.required = false;
  discoveryVisible.hidden = false;
  app.save(members);

  const shares = app.findCollectionByNameOrId("community_shares");
  for (const name of ["sender_name", "recipient_name"]) {
    const field = ensureFieldType(shares, name, "text");
    if (field) field.hidden = true;
  }
  app.save(shares);

  // Replies were introduced before this migration, but keep this guard so a
  // restored intermediate database can still converge without losing data.
  let replies = null;
  try {
    replies = app.findCollectionByNameOrId("community_share_replies");
  } catch {
    // A restored database from before replies existed has nothing to hide.
  }
  if (replies) {
    const authorName = ensureFieldType(replies, "author_name", "text");
    if (authorName) authorName.hidden = true;
    app.save(replies);
  }

  // This one-time forward migration intentionally replaces the old false
  // default for every current member. A member opt-out made after this
  // migration is recorded will not be touched by later boots.
  app
    .db()
    .newQuery("UPDATE members SET discovery_visible = TRUE")
    .execute();
}, () => {
  // Forward-only: member preferences and all legacy attribution data remain.
  return null;
});

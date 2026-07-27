/// <reference path="../pb_data/types.d.ts" />
//
// This temporary migration exists only because the member-directory
// intentionally excludes internal fixtures. A later cleanup migration will
// delete this verification member.
migrate((app) => {
  const email = "member-status-copy-check-b@detour.invalid";
  const displayName = "Detour member status copy verification B";
  const matches = app.findRecordsByFilter(
    "members",
    "email = {:email}",
    "id",
    2,
    0,
    { email }
  );

  if (!matches.length) return;
  if (matches.length > 1) {
    throw new Error(
      "Refusing to alter the status-copy verification member: multiple records use its reserved email."
    );
  }

  const member = matches[0];
  if (
    member.getString("email") !== email ||
    member.getString("display_name") !== displayName
  ) {
    throw new Error(
      "Refusing to alter the status-copy verification member: its exact fixture identity does not match."
    );
  }

  // Keep the fixture verified and preserve every other field. It remains out
  // of discovery/feed visibility while becoming selectable by pseudo.
  app
    .db()
    .newQuery(
      "UPDATE members SET internal_member = FALSE, discovery_visible = FALSE " +
        "WHERE id = {:id} AND email = {:email} AND display_name = {:displayName} " +
        "AND (COALESCE(internal_member, FALSE) != FALSE " +
        "OR COALESCE(discovery_visible, FALSE) != FALSE)"
    )
    .bind({ id: member.id, email, displayName })
    .execute();
}, () => {
  // Forward-only: cleanup will remove the temporary fixture entirely.
  return null;
});

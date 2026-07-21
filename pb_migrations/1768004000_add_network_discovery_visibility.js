/// <reference path="../pb_data/types.d.ts" />
//
// Network discovery is privacy-first: every member starts hidden and may opt in
// only through their own member profile. The field is added without changing
// the members collection rules or any existing membership data/provenance.
// Forward-only and retry-safe after a partially completed boot.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");
  let field = members.fields.getByName("discovery_visible");

  if (!field) {
    field = new BoolField({ name: "discovery_visible" });
    members.fields.add(field);
  }
  if (field.type() !== "bool") {
    throw new Error(
      "Cannot safely configure members.discovery_visible: expected bool field, found " +
        field.type()
    );
  }

  // Keep the preference member-readable/writable under the existing self-only
  // member rules. Boolean fields default to false for both existing and new
  // records; the request hook also resets any opt-in supplied during signup.
  field.required = false;
  field.hidden = false;
  app.save(members);

  // Defensive convergence for databases restored from an intermediate schema.
  // Never reset a member who has already opted in.
  app
    .db()
    .newQuery(
      "UPDATE members SET discovery_visible = FALSE WHERE discovery_visible IS NULL"
    )
    .execute();
}, () => {
  // Forward-only: visibility is member-owned production data and is retained.
  return null;
});

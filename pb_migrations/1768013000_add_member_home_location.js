/// <reference path="../pb_data/types.d.ts" />
//
// Capture where a member lives at signup, for later membership stats. Two
// member-owned fields: a free-text home_city (people live anywhere, including
// cities Detour does not yet cover) and home_country, whose input is
// constrained to a controlled list on the frontend so the value aggregates
// cleanly. Both are optional — the join form asks but never blocks on them, so
// existing members and members who skip the fields simply store the empty
// string. No membership rules or provenance change; the members update hook
// already freezes only the protected provenance fields, leaving these two
// freely editable through the member's own profile later.
// Forward-only and retry-safe after a partially completed boot.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");

  const specs = [
    { name: "home_city", max: 120 },
    { name: "home_country", max: 80 },
  ];

  for (const spec of specs) {
    const existing = members.fields.getByName(spec.name);
    if (existing) {
      if (existing.type() !== "text") {
        throw new Error(
          "Cannot safely configure members." +
            spec.name +
            ": expected text field, found " +
            existing.type()
        );
      }
      existing.required = false;
      existing.hidden = false;
    } else {
      members.fields.add(
        new TextField({ name: spec.name, required: false, max: spec.max })
      );
    }
  }

  app.save(members);
}, () => {
  // Forward-only: member-supplied home location is retained.
  return null;
});

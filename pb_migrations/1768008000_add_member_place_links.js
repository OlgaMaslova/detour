/// <reference path="../pb_data/types.d.ts" />
//
// Members can supply a place's official website, Instagram profile, and a
// cover image link on their waiting-list entries — automatic discovery from
// OSM tags and page metadata misses or mangles these too often. The fields are
// member-visible; the update request hook owns validation and freezes every
// other entry field, so the participant update rule below never exposes
// server-owned state to writes.
migrate((app) => {
  const entries = app.findCollectionByNameOrId("community_waitlist_entries");

  for (const name of ["official_url", "instagram_url", "image_url"]) {
    const existing = entries.fields.getByName(name);
    if (existing) {
      if (existing.type() !== "url") {
        throw new Error(
          "Cannot safely configure community_waitlist_entries." +
            name +
            ": expected url field, found " +
            existing.type()
        );
      }
      existing.required = false;
      existing.hidden = false;
    } else {
      entries.fields.add(new URLField({ name, required: false }));
    }
  }

  entries.updateRule =
    "@request.auth.id != '' && participants.id ?= @request.auth.id";
  return app.save(entries);
}, () => {
  // Forward-only: member-supplied place links are retained.
  return null;
});

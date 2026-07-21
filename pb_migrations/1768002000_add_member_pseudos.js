/// <reference path="../pb_data/types.d.ts" />
//
// Members get a unique public pseudo (a lowercase handle such as
// "detour-anna") so other members can find them unambiguously when sharing a
// place. Display names stay free-form and non-unique; the pseudo is the
// stable, searchable identity. Existing members are backfilled with a pseudo
// derived from their display name, and shares denormalize both participants'
// pseudos the same way they already denormalize display names.
migrate((app) => {
  // Guarded by index name rather than the exact SQL string: this migration
  // re-runs after a partial failure, and PocketBase may store a normalized
  // form of the statement it was given.
  function addIndexIfMissing(collection, indexName, index) {
    for (const existing of collection.indexes) {
      if (existing.indexOf(indexName) !== -1) return;
    }
    collection.indexes.push(index);
  }

  function slugifyPseudo(value) {
    let slug = String(value || "");
    if (typeof slug.normalize === "function") {
      slug = slug.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
    slug = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "");
    return slug.length >= 3 ? slug : "member";
  }

  // ---------- members: pseudo field + uniqueness ----------
  const members = app.findCollectionByNameOrId("members");
  if (!members.fields.getByName("pseudo")) {
    members.fields.add(new TextField({ name: "pseudo", max: 30 }));
  }
  addIndexIfMissing(
    members,
    "idx_members_pseudo",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_members_pseudo ON members (pseudo) WHERE pseudo != ''"
  );
  app.save(members);

  // ---------- shares: denormalized participant pseudos ----------
  const shares = app.findCollectionByNameOrId("community_shares");
  if (!shares.fields.getByName("sender_pseudo")) {
    shares.fields.add(new TextField({ name: "sender_pseudo", max: 30 }));
  }
  if (!shares.fields.getByName("recipient_pseudo")) {
    shares.fields.add(new TextField({ name: "recipient_pseudo", max: 30 }));
  }
  app.save(shares);

  // Backfill: every existing member becomes findable immediately. Collisions
  // get a numeric suffix; members can pick a different pseudo in Settings.
  // Sorted by id: the members collection has no autodate created field, and a
  // deterministic order keeps collision suffixes stable across re-runs.
  const taken = {};
  const existingMembers = app.findRecordsByFilter("members", "id != ''", "id", 0, 0);
  for (const memberRecord of existingMembers) {
    const current = memberRecord.getString("pseudo");
    if (current) taken[current] = true;
  }
  for (const memberRecord of existingMembers) {
    if (memberRecord.getString("pseudo")) continue;
    const base = slugifyPseudo(memberRecord.getString("display_name"));
    let candidate = base;
    let suffix = 2;
    while (taken[candidate]) {
      candidate = base + "-" + suffix;
      suffix++;
    }
    taken[candidate] = true;
    memberRecord.set("pseudo", candidate);
    app.save(memberRecord);
  }

  // Backfill share pseudos for shares created before this migration.
  const existingShares = app.findRecordsByFilter("community_shares", "id != ''", "-created", 0, 0);
  for (const share of existingShares) {
    let changed = false;
    for (const pair of [["sender", "sender_pseudo"], ["recipient", "recipient_pseudo"]]) {
      if (share.getString(pair[1])) continue;
      try {
        const memberRecord = app.findRecordById("members", share.getString(pair[0]));
        const pseudo = memberRecord.getString("pseudo");
        if (pseudo) {
          share.set(pair[1], pseudo);
          changed = true;
        }
      } catch {
        // The related member no longer exists; leave the pseudo empty.
      }
    }
    if (changed) app.save(share);
  }
}, (app) => {
  // Pseudos are member-chosen production data. Deliberately no down migration
  // deletes them; only the uniqueness index is removed.
  const members = app.findCollectionByNameOrId("members");
  const index = "CREATE UNIQUE INDEX IF NOT EXISTS idx_members_pseudo ON members (pseudo) WHERE pseudo != ''";
  const position = members.indexes.indexOf(index);
  if (position !== -1) {
    members.indexes.splice(position, 1);
    app.save(members);
  }
});

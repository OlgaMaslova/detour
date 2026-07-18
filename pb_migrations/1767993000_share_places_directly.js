/// <reference path="../pb_data/types.d.ts" />
//
// Reshapes community shares from waiting-list nudges into direct place
// sharing: a share now sends any place — an existing catalogue venue or the
// sender's own place — to another member with a personal note. Shares of a
// catalogue venue reference it directly, so `waitlist` becomes optional.
// Sender and recipient display names are denormalized onto the share because
// member profiles are visible only to their owner, and `seen` lets the
// recipient's inbox track which shares are new.
migrate((app) => {
  const shares = app.findCollectionByNameOrId("community_shares");
  const venues = app.findCollectionByNameOrId("venues");

  const waitlist = shares.fields.getByName("waitlist");
  if (waitlist) waitlist.required = false;

  if (!shares.fields.getByName("venue")) {
    shares.fields.add(
      new RelationField({
        name: "venue",
        collectionId: venues.id,
        maxSelect: 1,
        cascadeDelete: true,
      })
    );
  }
  if (!shares.fields.getByName("sender_name")) {
    shares.fields.add(new TextField({ name: "sender_name", max: 100 }));
  }
  if (!shares.fields.getByName("recipient_name")) {
    shares.fields.add(new TextField({ name: "recipient_name", max: 100 }));
  }
  if (!shares.fields.getByName("seen")) {
    shares.fields.add(new BoolField({ name: "seen" }));
  }

  // The update hook restricts recipients to flipping `seen` only.
  shares.updateRule = "@request.auth.id != '' && recipient = @request.auth.id";
  app.save(shares);

  // Backfill display names for shares created before this migration.
  const existing = app.findRecordsByFilter("community_shares", "id != ''", "-created", 0, 0);
  for (const share of existing) {
    let changed = false;
    for (const pair of [["sender", "sender_name"], ["recipient", "recipient_name"]]) {
      if (share.getString(pair[1])) continue;
      try {
        const memberRecord = app.findRecordById("members", share.getString(pair[0]));
        share.set(pair[1], memberRecord.getString("display_name") || "A Detour member");
        changed = true;
      } catch {
        // The related member no longer exists; leave the name empty.
      }
    }
    if (changed) app.save(share);
  }
}, (app) => {
  const shares = app.findCollectionByNameOrId("community_shares");
  shares.updateRule = null;
  const waitlist = shares.fields.getByName("waitlist");
  if (waitlist) waitlist.required = true;
  // The added fields and backfilled names are retained; only rules and the
  // relaxed requirement roll back.
  app.save(shares);
});

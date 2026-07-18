/// <reference path="../pb_data/types.d.ts" />
//
// Detour is places-driven: every member-added place carries a street address.
// Waiting-list entries store the address, recommendations and shares carry a
// denormalized copy for display, and publication copies it onto the venue.
// The create hooks enforce the address for NEW places; existing rows stay
// valid, so the fields are schema-optional.
migrate((app) => {
  for (const name of [
    "community_waitlist_entries",
    "community_recommendations",
    "community_shares",
  ]) {
    const collection = app.findCollectionByNameOrId(name);
    if (!collection.fields.getByName("address")) {
      collection.fields.add(new TextField({ name: "address", max: 300 }));
      app.save(collection);
    }
  }
}, () => {
  // Forward-only: address data is retained.
  return null;
});

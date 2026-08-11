/// <reference path="../pb_data/types.d.ts" />
//
// Skipping one place off an imported list.
//
// A member pastes a list of thirty-eight and means eleven of them. Until now the
// only answer to the other twenty-seven was Remove, which deletes the row — so
// the list on screen stopped matching the list they had read, and the next
// re-import of the same link brought every one of them back. A skip is the
// member saying "not this one", kept.
//
// A FLAG, NOT A DELETE, and the difference is the whole of it:
//
//   the guide page   still shows the place, dimmed, under Skipped, with an undo.
//                    The piece named it; the page is a record of the piece
//   everywhere else  it is gone. It is not on the wishlist, not on the city
//                    page, not in a count, not a pin
//
// Nothing here is anybody else's business. It sits on the member's own row in
// their own collection, exactly like the rest of this feature, and no read path
// computed for another member touches it.
migrate(
  (app) => {
    const places = app.findCollectionByNameOrId("community_imported_places");
    if (!places.fields.getByName("skipped")) {
      places.fields.add(
        new BoolField({
          name: "skipped",
          required: false,
        })
      );
      app.save(places);
    }
  },
  (app) => {
    try {
      const places = app.findCollectionByNameOrId("community_imported_places");
      const field = places.fields.getByName("skipped");
      if (field) {
        places.fields.removeById(field.id);
        app.save(places);
      }
    } catch {
      // A partial or repeated rollback is already at the desired state.
    }
  }
);

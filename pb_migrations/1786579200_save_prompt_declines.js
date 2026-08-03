/// <reference path="../pb_data/types.d.ts" />
//
// The one field the *been yet?* follow-up needs and the saves migration
// deliberately did not ship: how many times a member has declined to answer
// about one place.
//
// WHY A DATE IS NOT ENOUGH. `community_place_saves.prompted_at` already exists
// and says *when* the question was last put, which gates it against being asked
// twice in a week. It cannot say *how often* — and "twice declined and it stops
// being asked about at all" is a count, not a date. The saves migration says as
// much in the comment on that field and leaves this one for whoever builds the
// prompt. This is that file.
//
// WHY NOT DERIVE IT FROM prompted_at. Stamping is what stops the same card
// coming back on the next page load, so it happens every time the card is shown,
// answered or not. A decline is a member saying "not yet", which is a different
// and rarer event, and the difference between the two is the whole gate: a card
// ignored comes back in a week, a card declined in a month, a card declined twice
// never. One timestamp cannot hold three outcomes.
//
// Hidden and never sent. The follow-up hands the client a place and a question;
// how many times that member has put it off is not something to show them.

migrate(
  (app) => {
    const saves = app.findCollectionByNameOrId("community_place_saves");

    // Zero, or absent on a row written before this field existed, both mean the
    // member has never declined — which is the state every existing save is
    // genuinely in, since nothing has ever asked them.
    if (!saves.fields.getByName("prompt_declines")) {
      saves.fields.add(
        new NumberField({
          name: "prompt_declines",
          required: false,
          onlyInt: true,
          min: 0,
          hidden: true,
        })
      );
      app.save(saves);
    }
  },
  (app) => {
    try {
      const saves = app.findCollectionByNameOrId("community_place_saves");
      const field = saves.fields.getByName("prompt_declines");
      if (field) {
        saves.fields.removeById(field.id);
        app.save(saves);
      }
    } catch {
      // A partial or repeated rollback is already at the desired state.
    }
  }
);

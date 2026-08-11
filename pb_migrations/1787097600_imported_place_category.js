/// <reference path="../pb_data/types.d.ts" />
//
// What kind of place an imported one is, as the publication itself declared it.
//
// An imported row had a name, a quarter and a sentence, and no answer at all to
// "what is this?" — the fact a member scans a city list for. The catalogue's own
// places carry a category because a member chose one; these carry one only when
// the page said so, in its own structured data:
//
//   @type            Bakery, CafeOrCoffeeShop, BarOrPub, Winery, Brewery,
//                    IceCreamShop, Restaurant — the schema.org types the
//                    importer already tests against to decide a node is a place
//   servesCuisine    "Georgian", "Sichuan" — which is `ethnic_cuisine`, and the
//                    word itself is worth keeping: a row says "Georgian", not
//                    "Ethnic cuisine"
//
// READ, NEVER GUESSED. A page with no structured data goes through the heading
// scraper, which has only prose, and those places keep an empty category rather
// than one inferred from the word "croissant". A wrong kind is worse than none
// on a page whose whole claim is that nobody here has vouched for it.
//
// AND NEVER PROMOTED. Like `image_url` before it, this is the publisher's
// assertion about a place nobody on Detour has recommended. It is a fallback for
// display on the member's own private row; a matched catalogue place keeps the
// category a member gave it, because that one somebody stood behind.
//
// The option list is the same closed set the three catalogue collections use —
// see 1787011200_ethnic_cuisine_category.js, which this must run after. A value
// outside it would be a category the app cannot render or filter by.
const CATEGORY_VALUES = [
  "restaurant",
  "ethnic_cuisine",
  "cafe",
  "bakery",
  "bar",
  "cocktail_bar",
  "wine_bar",
  "brewery",
  "food_market",
  "deli",
  "dessert_shop",
  "ice_cream",
  "takeaway",
  "other",
];

migrate(
  (app) => {
    const places = app.findCollectionByNameOrId("community_imported_places");
    let changed = false;
    if (!places.fields.getByName("category")) {
      places.fields.add(
        new SelectField({
          name: "category",
          required: false,
          maxSelect: 1,
          values: CATEGORY_VALUES,
        })
      );
      changed = true;
    }
    if (!places.fields.getByName("cuisine")) {
      places.fields.add(
        // The publication's own word for it, printed as given. Free text rather
        // than a second closed set: cuisines are not enumerable, and this is
        // never filtered on — `category` is what the chips and menus read.
        new TextField({ name: "cuisine", required: false, max: 60 })
      );
      changed = true;
    }
    if (changed) app.save(places);
  },
  (app) => {
    try {
      const places = app.findCollectionByNameOrId("community_imported_places");
      let changed = false;
      for (const name of ["category", "cuisine"]) {
        const field = places.fields.getByName(name);
        if (field) {
          places.fields.removeById(field.id);
          changed = true;
        }
      }
      if (changed) app.save(places);
    } catch {
      // A partial or repeated rollback is already at the desired state.
    }
  }
);

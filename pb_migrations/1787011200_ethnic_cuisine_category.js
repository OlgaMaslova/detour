/// <reference path="../pb_data/types.d.ts" />
//
// "Ethnic cuisine" joins the place categories.
//
// The category list is a closed set in three places at once — the member's
// recommendation, the waitlist entry the recommendation lands on, and the place
// facts a member contributes — and the server refuses anything outside it. So a
// new option is not a frontend change: the select on all three collections has
// to learn the value or every submission carrying it comes back as "Choose a
// category from the provided list."
//
// It sits next to `restaurant` in the option order because that is where a
// member looking for it will look — one row down from the general case it
// narrows.
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

// Every collection whose `category` select has to agree. Missing one of them is
// the failure this list exists to prevent: the option appears in the picker, the
// recommendation saves, and the write that mirrors it onto the entry is the one
// that throws.
const COLLECTIONS = [
  "community_recommendations",
  "community_waitlist_entries",
  "member_place_contributions",
];

/**
 * Replace the `category` select's option list, keeping everything else about
 * the field as it was.
 *
 * Reusing the existing field id matters: `fields.add` matches on it and
 * replaces the field in place, so the column, its data and its position in the
 * collection all survive. A field without the id would be appended as a second,
 * empty `category`.
 */
function setCategoryValues(app, collectionName, values) {
  const collection = app.findCollectionByNameOrId(collectionName);
  const field = collection.fields.getByName("category");
  if (!field) return;
  collection.fields.add(
    new SelectField({
      id: field.id,
      name: field.name,
      maxSelect: field.maxSelect,
      required: field.required,
      hidden: field.hidden,
      presentable: field.presentable,
      system: field.system,
      values: values,
    })
  );
  app.save(collection);
}

migrate(
  (app) => {
    for (const name of COLLECTIONS) {
      setCategoryValues(app, name, CATEGORY_VALUES);
    }
  },
  (app) => {
    // Rolling back has to deal with rows that already chose it. A select refuses
    // a value it no longer lists, so leaving them alone would leave records that
    // cannot be saved again — the next unrelated edit to one of them would fail
    // validation on a field the member never touched. They fall back to `other`,
    // which is what the category means once the option is gone.
    for (const name of COLLECTIONS) {
      try {
        app
          .db()
          .newQuery(
            "UPDATE " + name + " SET category = 'other' WHERE category = 'ethnic_cuisine'"
          )
          .execute();
        setCategoryValues(
          app,
          name,
          CATEGORY_VALUES.filter((value) => value !== "ethnic_cuisine")
        );
      } catch {
        // A partial or repeated rollback is already at the desired state.
      }
    }
  }
);

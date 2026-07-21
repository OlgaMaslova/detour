/// <reference path="../pb_data/types.d.ts" />
//
// Detour has a single member lane: the 3-recommendation waiting-list loop.
// This migration carries the place facts that previously lived on the
// curator-reviewed contribution lane (category, occasion tags) onto the
// waiting-list loop, and closes the contribution lane to new submissions.
// Existing approved contributions remain readable so already-published
// Detourist List places keep their provenance. Forward-only and convergent.
migrate((app) => {
  const CATEGORY_VALUES = [
    "restaurant",
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
  const OCCASION_VALUES = [
    "celebration",
    "casual_local_favorite",
    "coffee",
    "bakery",
    "drinks_nightcap",
    "neighborhood_meal",
    "date_night",
    "group_gathering",
    "quick_bite",
    "breakfast_brunch",
    "solo_friendly",
    "family_friendly",
    "late_night",
    "outdoor_seating",
  ];

  function ensureSelect(collection, name, values, maxSelect) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = new SelectField({ name, required: false, values, maxSelect, hidden: false });
      collection.fields.add(field);
    }
    if (field.type() !== "select") {
      throw new Error(
        "Cannot safely configure " + collection.name + "." + name +
          ": expected select field, found " + field.type()
      );
    }
    field.required = false;
    field.values = values;
    field.maxSelect = maxSelect;
    field.hidden = false;
  }

  // Place-level facts live on the shared waiting-list entry; the first
  // recommender seeds them and later recommenders can only add occasions.
  const entries = app.findCollectionByNameOrId("community_waitlist_entries");
  ensureSelect(entries, "category", CATEGORY_VALUES, 1);
  ensureSelect(entries, "occasions", OCCASION_VALUES, OCCASION_VALUES.length);
  app.save(entries);

  // Input mirrors on the recommendation signal, like venue_name/city/country.
  const recommendations = app.findCollectionByNameOrId("community_recommendations");
  ensureSelect(recommendations, "category", CATEGORY_VALUES, 1);
  ensureSelect(recommendations, "occasions", OCCASION_VALUES, OCCASION_VALUES.length);
  app.save(recommendations);

  // The reviewed contribution lane is closed: no new submissions. Existing
  // records stay listable so approved places remain on the Detourist List.
  const contributions = app.findCollectionByNameOrId("member_place_contributions");
  contributions.createRule = null;
  app.save(contributions);
}, () => {
  // Forward-only: recommendation and contribution history are retained.
  return null;
});

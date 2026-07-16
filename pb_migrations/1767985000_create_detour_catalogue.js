/// <reference path="../pb_data/types.d.ts" />
//
// Creates Detour's compact public catalogue, recommendation inbox, and shared
// detours. The schema operations and seed inserts converge safely if a prior
// attempt stopped after only part of the migration had been applied.
migrate((app) => {
  const CATEGORY_VALUES = ["restaurant", "coffee", "boulangerie", "other"];
  const SOURCE_BADGE_VALUES = ["Michelin", "50 Best Pizza", "Repsol", "MOF", "other"];

  function getOrCreateBaseCollection(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return new Collection({ name, type: "base" });
    }
  }

  function ensureField(collection, name, expectedType, createField, configureField) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = createField();
      collection.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " + collection.name + "." + name +
          ": expected " + expectedType + " field, found " + field.type()
      );
    }
    configureField(field);
  }

  function ensureText(collection, name, required, max) {
    ensureField(
      collection,
      name,
      "text",
      () => new TextField({ name, required, max }),
      (field) => {
        field.required = required;
        field.max = max;
      }
    );
  }

  function ensureSelect(collection, name, required, values, maxSelect) {
    ensureField(
      collection,
      name,
      "select",
      () => new SelectField({ name, required, values, maxSelect }),
      (field) => {
        field.required = required;
        field.values = values;
        field.maxSelect = maxSelect;
      }
    );
  }

  function ensureRelation(collection, name, required, targetId, maxSelect) {
    ensureField(
      collection,
      name,
      "relation",
      () =>
        new RelationField({
          name,
          required,
          collectionId: targetId,
          maxSelect,
          cascadeDelete: false,
        }),
      (field) => {
        field.required = required;
        field.collectionId = targetId;
        field.maxSelect = maxSelect;
        field.cascadeDelete = false;
      }
    );
  }

  function normalizedIndex(index) {
    return String(index)
      .toLowerCase()
      .replace(/[`"\[\]]/g, "")
      .replace(/\bif\s+not\s+exists\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .trim();
  }

  function isMatchingUniqueIndex(index, collectionName, columns) {
    const normalized = normalizedIndex(index);
    return (
      normalized.indexOf("create unique index ") === 0 &&
      normalized.indexOf(" on " + collectionName.toLowerCase() + "(" + columns.toLowerCase() + ")") !== -1
    );
  }

  function ensureUniqueIndex(collection, name, columns) {
    // PocketBase 0.39's Collection index API addresses indexes by name and
    // addIndex replaces a same-name index. Also recognize an equivalent
    // pre-existing unique index under another name rather than duplicating it.
    const namedIndex = collection.getIndex(name);
    if (namedIndex) {
      if (!isMatchingUniqueIndex(namedIndex, collection.name, columns)) {
        collection.addIndex(name, true, columns, "");
      }
      return;
    }
    if (!collection.indexes.some((index) => isMatchingUniqueIndex(index, collection.name, columns))) {
      collection.addIndex(name, true, columns, "");
    }
  }

  // ---------- cities ----------
  const cities = getOrCreateBaseCollection("cities");
  ensureText(cities, "name", true, 120);
  ensureText(cities, "slug", true, 120);
  ensureText(cities, "country", true, 120);
  ensureUniqueIndex(cities, "idx_cities_slug", "slug");
  cities.listRule = "";
  cities.viewRule = "";
  cities.createRule = null;
  cities.updateRule = null;
  cities.deleteRule = null;
  app.save(cities);

  // ---------- places ----------
  const places = getOrCreateBaseCollection("places");
  ensureText(places, "name", true, 200);
  ensureText(places, "slug", true, 160);
  ensureSelect(places, "category", true, CATEGORY_VALUES, 1);
  ensureRelation(places, "city", true, cities.id, 1);
  ensureText(places, "description", false, 2000);
  ensureText(places, "address", false, 300);
  ensureSelect(places, "source_badges", false, SOURCE_BADGE_VALUES, SOURCE_BADGE_VALUES.length);
  ensureField(
    places,
    "image_url",
    "url",
    () => new URLField({ name: "image_url" }),
    (field) => {
      field.required = false;
    }
  );
  ensureUniqueIndex(places, "idx_places_slug", "slug");
  places.listRule = "";
  places.viewRule = "";
  places.createRule = null;
  places.updateRule = null;
  places.deleteRule = null;
  app.save(places);

  // ---------- recommendations ----------
  const recommendations = getOrCreateBaseCollection("recommendations");
  ensureText(recommendations, "place_name", true, 200);
  ensureRelation(recommendations, "city", false, cities.id, 1);
  ensureSelect(recommendations, "category", false, CATEGORY_VALUES, 1);
  ensureText(recommendations, "address", false, 300);
  ensureText(recommendations, "description", false, 2000);
  ensureSelect(
    recommendations,
    "source_badges",
    false,
    SOURCE_BADGE_VALUES,
    SOURCE_BADGE_VALUES.length
  );
  ensureText(recommendations, "contributor_name", false, 120);
  ensureField(
    recommendations,
    "contributor_email",
    "email",
    () => new EmailField({ name: "contributor_email" }),
    (field) => {
      field.required = false;
    }
  );
  // PocketBase select fields have no schema-level default option. The focused
  // create hook supplies pending before record validation and prevents public
  // callers from selecting a moderation state.
  ensureSelect(
    recommendations,
    "status",
    true,
    ["pending", "approved", "rejected"],
    1
  );
  recommendations.listRule = null;
  recommendations.viewRule = null;
  recommendations.createRule = "";
  recommendations.updateRule = null;
  recommendations.deleteRule = null;
  app.save(recommendations);

  // ---------- detours ----------
  const detours = getOrCreateBaseCollection("detours");
  ensureText(detours, "title", true, 200);
  ensureText(detours, "description", false, 2400);
  ensureRelation(detours, "city", false, cities.id, 1);
  ensureRelation(detours, "places", false, places.id, 50);
  ensureText(detours, "share_slug", true, 160);
  ensureUniqueIndex(detours, "idx_detours_share_slug", "share_slug");
  detours.listRule = "";
  detours.viewRule = "";
  detours.createRule = null;
  detours.updateRule = null;
  detours.deleteRule = null;
  app.save(detours);

  // ---------- compact illustrative seed ----------
  // Fixed ids and unique slugs make both bulk statements idempotent. Places
  // resolve the city id by logical slug, so they also link correctly when a
  // city already existed under a different record id.
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO cities (id, name, slug, country) VALUES " +
        "('detcityparis001', 'Paris', 'paris', 'France'), " +
        "('detcitymadrid01', 'Madrid', 'madrid', 'Spain'), " +
        "('detcitysf000001', 'San Francisco', 'san-francisco', 'United States')"
    )
    .execute();

  const seedPlaces = [
    [
      "detplace0000001",
      "Arpège",
      "arpege",
      "restaurant",
      "paris",
      "84 Rue de Varenne, 75007 Paris, France",
      "Alain Passard's vegetable-focused fine-dining restaurant, long recognized by the Michelin Guide.",
      ["Michelin"],
    ],
    [
      "detplace0000002",
      "Septime",
      "septime",
      "restaurant",
      "paris",
      "80 Rue de Charonne, 75011 Paris, France",
      "A contemporary Paris restaurant known for seasonal tasting menus and Michelin recognition.",
      ["Michelin"],
    ],
    [
      "detplace0000003",
      "Du Pain et des Idées",
      "du-pain-et-des-idees",
      "boulangerie",
      "paris",
      "34 Rue Yves Toudic, 75010 Paris, France",
      "An artisan bakery celebrated for traditional breads and its escargot-shaped pastries.",
      ["MOF"],
    ],
    [
      "detplace0000004",
      "Télescope Café",
      "telescope-cafe",
      "coffee",
      "paris",
      "5 Rue Villedo, 75001 Paris, France",
      "A compact specialty coffee shop near the Palais Royal serving carefully sourced coffee.",
      ["other"],
    ],
    [
      "detplace0000005",
      "DiverXO",
      "diverxo",
      "restaurant",
      "madrid",
      "Calle del Padre Damián 23, 28036 Madrid, Spain",
      "David Muñoz's theatrical fine-dining restaurant, awarded three Michelin stars.",
      ["Michelin"],
    ],
    [
      "detplace0000006",
      "Corral de la Morería",
      "corral-de-la-moreria",
      "restaurant",
      "madrid",
      "Calle de la Morería 17, 28005 Madrid, Spain",
      "A historic flamenco venue whose intimate restaurant has Michelin recognition.",
      ["Michelin"],
    ],
    [
      "detplace0000007",
      "Panem",
      "panem-madrid",
      "boulangerie",
      "madrid",
      "Calle de Fernán González 46, 28009 Madrid, Spain",
      "A neighborhood artisan bakery producing naturally leavened breads and seasonal pastries.",
      ["other"],
    ],
    [
      "detplace0000008",
      "HanSo Café",
      "hanso-cafe",
      "coffee",
      "madrid",
      "Calle del Pez 20, 28004 Madrid, Spain",
      "A Malasaña specialty coffee shop known for espresso, filter coffee, and brunch dishes.",
      ["other"],
    ],
    [
      "detplace0000009",
      "Benu",
      "benu",
      "restaurant",
      "san-francisco",
      "22 Hawthorne Street, San Francisco, CA 94105, United States",
      "Corey Lee's tasting-menu restaurant, awarded three Michelin stars.",
      ["Michelin"],
    ],
    [
      "detplace0000010",
      "Californios",
      "californios",
      "restaurant",
      "san-francisco",
      "355 11th Street, San Francisco, CA 94103, United States",
      "A Michelin-starred tasting-menu restaurant exploring Mexican and Californian ingredients.",
      ["Michelin"],
    ],
    [
      "detplace0000011",
      "Tartine Bakery",
      "tartine-bakery",
      "boulangerie",
      "san-francisco",
      "600 Guerrero Street, San Francisco, CA 94110, United States",
      "The original Mission District bakery known for country bread, morning buns, and pastries.",
      ["other"],
    ],
    [
      "detplace0000012",
      "Four Barrel Coffee",
      "four-barrel-coffee",
      "coffee",
      "san-francisco",
      "375 Valencia Street, San Francisco, CA 94103, United States",
      "An independent Mission District roastery and café focused on small-lot coffee.",
      ["other"],
    ],
  ];

  {
    const params = {};
    const rows = seedPlaces.map((place, index) => {
      params["id" + index] = place[0];
      params["name" + index] = place[1];
      params["slug" + index] = place[2];
      params["category" + index] = place[3];
      params["citySlug" + index] = place[4];
      params["address" + index] = place[5];
      params["description" + index] = place[6];
      params["badges" + index] = JSON.stringify(place[7]);
      return (
        "({:id" + index + "}, {:name" + index + "}, {:slug" + index +
        "}, {:category" + index + "}, (SELECT id FROM cities WHERE slug = {:citySlug" + index +
        "}), {:description" + index + "}, {:address" + index + "}, {:badges" + index + "}, '')"
      );
    });

    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO places " +
          "(id, name, slug, category, city, description, address, source_badges, image_url) VALUES " +
          rows.join(", ")
      )
      .bind(params)
      .execute();
  }
}, () => {
  // Forward-only: existing catalogue, recommendation, and detour data is never
  // deleted by a rollback.
  return null;
});

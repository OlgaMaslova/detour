/// <reference path="../pb_data/types.d.ts" />
//
// Makes cities fully data-driven: the editorial copy and map presentation
// that previously lived hard-coded in the frontend (src/cities.ts CITIES
// array) move onto the public `cities` collection. Adding a city becomes a
// content operation (create a record, seed venues) instead of a frontend
// deploy. Every field is optional — the frontend supplies neutral fallback
// copy from the city name, and treats a city without verified map settings
// as a list-first preview.
migrate(
  (app) => {
    let cities;
    try {
      cities = app.findCollectionByNameOrId("cities");
    } catch {
      // The catalogue migration that creates `cities` has not run yet; it is
      // ordered before this file, so this only happens on databases that
      // never ran it — nothing to extend there.
      return;
    }

    function ensureField(name, expectedType, createField, configureField) {
      let field = cities.fields.getByName(name);
      if (!field) {
        field = createField();
        cities.fields.add(field);
      }
      if (field.type() !== expectedType) {
        throw new Error(
          "Cannot safely configure cities." + name +
            ": expected " + expectedType + " field, found " + field.type()
        );
      }
      if (configureField) configureField(field);
    }

    function ensureText(name, max) {
      ensureField(
        name,
        "text",
        () => new TextField({ name, required: false, max }),
        (field) => {
          field.required = false;
          field.max = max;
        }
      );
    }

    function ensureNumber(name) {
      ensureField(name, "number", () => new NumberField({ name, required: false }));
    }

    // Editorial copy. `tagline` may contain the literal `{count}` placeholder,
    // replaced by the frontend with the current published venue count.
    ensureText("title", 200);
    ensureText("tagline", 400);
    ensureText("footer", 600);
    ensureText("meta_title", 200);
    ensureText("meta_description", 500);

    // Presentation mode. Blank means list-first preview: a city is only
    // map-led after someone deliberately sets `map` AND provides the map
    // fields below (the frontend enforces both).
    ensureField(
      "presentation",
      "select",
      () => new SelectField({ name: "presentation", required: false, values: ["map", "list"], maxSelect: 1 }),
      (field) => {
        field.required = false;
        field.values = ["map", "list"];
        field.maxSelect = 1;
      }
    );

    // Map fallback view (used when no plottable pins exist) and the
    // conservative metropolitan box that gates visitor-position framing.
    ensureNumber("center_lat");
    ensureNumber("center_lng");
    ensureNumber("zoom");
    ensureNumber("bounds_lat_min");
    ensureNumber("bounds_lat_max");
    ensureNumber("bounds_lng_min");
    ensureNumber("bounds_lng_max");

    app.save(cities);

    // Seed the three launch cities with the exact copy previously hard-coded
    // in src/cities.ts. Guarded on blank title so a re-run after a partial
    // failure (or a later editorial change in the admin UI) is never
    // overwritten.
    const seeds = [
      {
        slug: "madrid",
        title: "Madrid’s exceptional tables, selected.",
        tagline:
          "{count} current places, from awarded dining to destination pizza and standout coffee.",
        footer:
          "Detour is a current, deliberately edited selection of Madrid’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.",
        metaTitle: "Detour — Madrid’s exceptional tables",
        metaDescription:
          "Explore Detour’s current Madrid selection: exceptional restaurants, pizzerias and coffee shops with published recognition from named guides or the Detour community.",
        presentation: "map",
        centerLat: 40.4168,
        centerLng: -3.7038,
        zoom: 13,
        latMin: 40.2,
        latMax: 40.65,
        lngMin: -3.95,
        lngMax: -3.45,
      },
      {
        slug: "paris",
        title: "Paris’s exceptional tables, selected.",
        tagline: "{count} current places holding published recognition from named guides.",
        footer:
          "Detour is a current, deliberately edited selection of Paris’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.",
        metaTitle: "Detour — Paris’s exceptional tables",
        metaDescription:
          "Explore Detour’s current Paris selection: exceptional tables with published recognition from named guides or the Detour community.",
        presentation: "map",
        centerLat: 48.8566,
        centerLng: 2.3522,
        zoom: 12,
        latMin: 48.75,
        latMax: 48.95,
        lngMin: 2.2,
        lngMax: 2.5,
      },
      {
        slug: "san-francisco",
        title: "San Francisco’s exceptional tables, selected.",
        tagline: "{count} current places holding published recognition from named guides.",
        footer:
          "Detour is a current, deliberately edited selection of San Francisco’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.",
        metaTitle: "Detour — San Francisco’s exceptional tables",
        metaDescription:
          "Explore Detour’s current San Francisco selection: exceptional tables with published recognition from named guides or the Detour community.",
        presentation: "map",
        centerLat: 37.7749,
        centerLng: -122.4194,
        zoom: 13,
        latMin: 37.6,
        latMax: 37.85,
        lngMin: -122.55,
        lngMax: -122.33,
      },
    ];

    for (const seed of seeds) {
      app
        .db()
        .newQuery(
          "UPDATE cities SET " +
            "title = {:title}, tagline = {:tagline}, footer = {:footer}, " +
            "meta_title = {:metaTitle}, meta_description = {:metaDescription}, " +
            "presentation = {:presentation}, " +
            "center_lat = {:centerLat}, center_lng = {:centerLng}, zoom = {:zoom}, " +
            "bounds_lat_min = {:latMin}, bounds_lat_max = {:latMax}, " +
            "bounds_lng_min = {:lngMin}, bounds_lng_max = {:lngMax} " +
            "WHERE slug = {:slug} AND (title IS NULL OR title = '')"
        )
        .bind(seed)
        .execute();
    }
  },
  (app) => {
    let cities;
    try {
      cities = app.findCollectionByNameOrId("cities");
    } catch {
      return;
    }
    const added = [
      "title",
      "tagline",
      "footer",
      "meta_title",
      "meta_description",
      "presentation",
      "center_lat",
      "center_lng",
      "zoom",
      "bounds_lat_min",
      "bounds_lat_max",
      "bounds_lng_min",
      "bounds_lng_max",
    ];
    for (const name of added) {
      if (cities.fields.getByName(name)) cities.fields.removeByName(name);
    }
    return app.save(cities);
  }
);

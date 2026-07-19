/// <reference path="../pb_data/types.d.ts" />
//
// Adds inspectable award-lane provenance and occasion tags, backfills the
// current catalogue without changing its source relationships, and seeds a
// narrow source-attributed San Francisco editorial-local-pick layer.
// Addresses and coordinates are independently verified with
// OpenStreetMap/Nominatim; they are not sourced from the editorial pages.
//
// Forward-only and retry-safe: schema additions are guarded, all seed writes
// use deterministic 15-character ids and batched INSERT OR IGNORE statements,
// and logical records are re-resolved by their existing unique keys.
migrate((app) => {
  const NOW = "2026-07-19 00:00:00.000Z";
  const ACCESSED = "2026-07-19 00:00:00.000Z";
  const SOURCE_SEED_ID = "gseatersf000001";
  const IMPORT_SEED_ID = "impeatersf00001";
  const IMPORT_KEY = "san-francisco-editorial-local-favorites-2026";
  const PROVENANCE_VALUES = [
    "guide_backed",
    "editorial_local_pick",
    "community_selection",
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

  const sourcePages = [
    {
      id: "srceatersf00001",
      url: "https://sf.eater.com/maps/best-croissants-pastries-san-francisco",
      title:
        "Eater SF — Where to Find Flawlessly Flaky and Buttery Croissants in the San Francisco Bay Area",
    },
    {
      id: "srceatersf00002",
      url: "https://sf.eater.com/maps/best-irish-bars-restaurants-san-francisco",
      title: "Eater SF — The 16 Best Irish Pubs for Pints in San Francisco",
    },
    {
      id: "srceatersf00003",
      url: "https://sf.eater.com/maps/best-tacos-san-francisco",
      title: "Eater SF — Where to Find the Best Tacos in San Francisco",
    },
    {
      id: "srceatersf00004",
      url: "https://sf.eater.com/maps/best-ice-cream-san-francisco",
      title: "Eater SF — The 18 Best Ice Cream Shops in San Francisco",
    },
    {
      id: "srceatersf00005",
      url: "https://sf.eater.com/maps/best-coffee-shops-san-francisco",
      title: "Eater SF — The Absolute Best San Francisco Coffee Shops",
    },
    {
      id: "srceatersf00006",
      url: "https://sf.eater.com/maps/best-weekday-breakfast-coffee-san-francisco",
      title: "Eater SF — San Francisco’s Best Restaurants for Solid Weekday Breakfasts",
    },
  ];

  const rows = [
    {
      venueId: "venuesflocal001",
      awardId: "awardsflocal001",
      name: "Arsicault Bakery",
      address: "397 Arguello Blvd, San Francisco, CA 94118",
      lat: 37.7834067,
      lng: -122.459227,
      category: "Bakery",
      occasions: [
        "casual_local_favorite",
        "bakery",
        "breakfast_brunch",
        "quick_bite",
        "solo_friendly",
      ],
      sourceUrl: sourcePages[0].url,
    },
    {
      venueId: "venuesflocal002",
      awardId: "awardsflocal002",
      name: "The Dubliner",
      address: "3838 24th St, San Francisco, CA 94114",
      lat: 37.7517359,
      lng: -122.4283147,
      category: "Pub",
      occasions: [
        "casual_local_favorite",
        "drinks_nightcap",
        "neighborhood_meal",
        "group_gathering",
      ],
      sourceUrl: sourcePages[1].url,
    },
    {
      venueId: "venuesflocal003",
      awardId: "awardsflocal003",
      name: "Al Carajo",
      address: "1298 Valencia St, San Francisco, CA 94110",
      lat: 37.7523275,
      lng: -122.4210368,
      category: "Taqueria",
      occasions: [
        "casual_local_favorite",
        "neighborhood_meal",
        "quick_bite",
        "date_night",
      ],
      sourceUrl: sourcePages[2].url,
    },
    {
      venueId: "venuesflocal004",
      awardId: "awardsflocal004",
      name: "Hook Fish Co.",
      address: "1791 45th Ave, San Francisco, CA 94122",
      lat: 37.7532632,
      lng: -122.5044542,
      category: "Seafood",
      occasions: [
        "casual_local_favorite",
        "neighborhood_meal",
        "quick_bite",
        "outdoor_seating",
      ],
      sourceUrl: sourcePages[2].url,
    },
    {
      venueId: "venuesflocal005",
      awardId: "awardsflocal005",
      name: "Hila",
      address: "951 Valencia St, San Francisco, CA 94110",
      lat: 37.7577086,
      lng: -122.4210711,
      category: "Ice cream",
      occasions: [
        "casual_local_favorite",
        "date_night",
        "solo_friendly",
        "quick_bite",
      ],
      sourceUrl: sourcePages[3].url,
    },
    {
      venueId: "venuesflocal006",
      awardId: "awardsflocal006",
      name: "Better Half Coffee",
      address: "1448 Pacific Ave, San Francisco, CA 94109",
      lat: 37.7955225,
      lng: -122.4190639,
      category: "Coffee",
      occasions: [
        "casual_local_favorite",
        "coffee",
        "solo_friendly",
        "date_night",
      ],
      sourceUrl: sourcePages[4].url,
    },
    {
      venueId: "venuesflocal007",
      awardId: "awardsflocal007",
      name: "Pork Store Cafe",
      address: "1451 Haight St, San Francisco, CA 94117",
      lat: 37.770022,
      lng: -122.4462408,
      category: "Breakfast",
      occasions: [
        "casual_local_favorite",
        "breakfast_brunch",
        "neighborhood_meal",
        "group_gathering",
        "family_friendly",
      ],
      sourceUrl: sourcePages[5].url,
    },
  ];

  function ensureField(collection, name, expectedType, createField, configureField) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = createField();
      collection.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " +
          collection.name +
          "." +
          name +
          ": expected " +
          expectedType +
          " field, found " +
          field.type()
      );
    }
    configureField(field);
  }

  function ensureSelect(collection, name, values, maxSelect) {
    ensureField(
      collection,
      name,
      "select",
      () => new SelectField({ name, values, maxSelect }),
      (field) => {
        field.required = false;
        field.hidden = false;
        field.values = values;
        field.maxSelect = maxSelect;
      }
    );
  }

  function normalizedIndex(index) {
    return String(index)
      .toLowerCase()
      .replace(/[`"\[\]]/g, "")
      .replace(/\bif\s+not\s+exists\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .trim();
  }

  function isMatchingIndex(index, collectionName, columns) {
    const normalized = normalizedIndex(index);
    return (
      normalized.indexOf("create index ") === 0 &&
      normalized.indexOf(
        " on " + collectionName.toLowerCase() + "(" + normalizedIndex(columns) + ")"
      ) !== -1
    );
  }

  function ensureIndex(collection, name, columns) {
    const namedIndex = collection.getIndex(name);
    if (namedIndex) {
      if (!isMatchingIndex(namedIndex, collection.name, columns)) {
        collection.addIndex(name, false, columns, "");
      }
      return;
    }
    if (
      !collection.indexes.some((index) =>
        isMatchingIndex(index, collection.name, columns)
      )
    ) {
      collection.addIndex(name, false, columns, "");
    }
  }

  const awards = app.findCollectionByNameOrId("venue_awards");
  ensureSelect(awards, "provenance", PROVENANCE_VALUES, 1);
  ensureSelect(awards, "occasions", OCCASION_VALUES, OCCASION_VALUES.length);
  ensureIndex(
    awards,
    "idx_venue_awards_provenance_current",
    "provenance, current"
  );
  app.save(awards);

  // Existing current catalogue rows retain every existing fact and relation;
  // only their newly added lane marker is populated. Blank-only handling for
  // non-community rows keeps a retry from relabelling seeded editorial picks.
  app
    .db()
    .newQuery(
      "UPDATE venue_awards SET provenance = 'community_selection' " +
        "WHERE current = TRUE AND source IN " +
        "(SELECT id FROM guide_sources WHERE slug = 'detour-community')"
    )
    .execute();
  app
    .db()
    .newQuery(
      "UPDATE venue_awards SET provenance = 'guide_backed' " +
        "WHERE current = TRUE AND COALESCE(provenance, '') = '' AND source NOT IN " +
        "(SELECT id FROM guide_sources WHERE slug = 'detour-community')"
    )
    .execute();

  // ---------- one Eater SF source registry row ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources " +
        "(id, name, slug, official_url, current_year, created, updated) VALUES " +
        "({:id}, 'Eater SF', 'eater-sf-editorial', 'https://sf.eater.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: SOURCE_SEED_ID, now: NOW })
    .execute();
  const sourceId = app.findFirstRecordByFilter(
    "guide_sources",
    "slug = 'eater-sf-editorial'"
  ).id;

  // ---------- six exact public editorial source pages ----------
  {
    const params = { source: sourceId, accessed: ACCESSED, now: NOW };
    const values = sourcePages.map((page, index) => {
      params["id" + index] = page.id;
      params["title" + index] = page.title;
      params["url" + index] = page.url;
      return (
        "({:id" +
        index +
        "}, {:source}, {:title" +
        index +
        "}, {:url" +
        index +
        "}, 'editorial-map-page', '', {:accessed}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO source_records " +
          "(id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }

  // ---------- one inspectable seed import ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance " +
        "(id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) VALUES " +
        "({:id}, {:key}, 'pb_migrations/1767996000_seed_sf_editorial_local_favorites.js', " +
        "'Seven factual, source-attributed San Francisco editorial local picks. Public attribution is limited to page titles and URLs; addresses and coordinates were independently verified with OpenStreetMap/Nominatim.', " +
        "{:source}, 7, 'verified', {:accessed}, {:now}, {:now})"
    )
    .bind({
      id: IMPORT_SEED_ID,
      key: IMPORT_KEY,
      source: sourceId,
      accessed: ACCESSED,
      now: NOW,
    })
    .execute();
  const importId = app.findFirstRecordByFilter(
    "import_provenance",
    "import_key = {:key}",
    { key: IMPORT_KEY }
  ).id;

  // ---------- seven canonical venues ----------
  {
    const params = { now: NOW };
    const values = rows.map((row, index) => {
      params["id" + index] = row.venueId;
      params["name" + index] = row.name;
      params["address" + index] = row.address;
      params["lat" + index] = row.lat;
      params["lng" + index] = row.lng;
      params["category" + index] = row.category;
      params["coordNote" + index] =
        "Address and coordinates independently verified with OpenStreetMap/Nominatim on 2026-07-19; not sourced from Eater SF.";
      return (
        "({:id" +
        index +
        "}, {:name" +
        index +
        "}, 'San Francisco', 'United States', {:address" +
        index +
        "}, {:lat" +
        index +
        "}, {:lng" +
        index +
        "}, {:category" +
        index +
        "}, '', {:coordNote" +
        index +
        "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venues " +
          "(id, name, city, country, address, lat, lng, category, official_url, coord_verification_note, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }

  // ---------- seven source-attributed editorial local picks ----------
  {
    const params = {
      source: sourceId,
      import: importId,
      now: NOW,
    };
    const values = rows.map((row, index) => {
      params["id" + index] = row.awardId;
      params["name" + index] = row.name;
      params["url" + index] = row.sourceUrl;
      params["occasions" + index] = JSON.stringify(row.occasions);
      params["note" + index] =
        "The linked Eater SF page provides public source attribution for this editorial local pick; accessed 2026-07-19. Address and coordinates were independently verified with OpenStreetMap/Nominatim.";
      return (
        "({:id" +
        index +
        "}, {:source}, " +
        "(SELECT id FROM venues WHERE name = {:name" +
        index +
        "} AND city = 'San Francisco'), 2026, 'Editorial local pick', 0, {:url" +
        index +
        "}, TRUE, {:note" +
        index +
        "}, (SELECT id FROM source_records WHERE url = {:url" +
        index +
        "}), {:import}, 'verified', 'editorial_local_pick', {:occasions" +
        index +
        "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_awards " +
          "(id, source, venue, year, level, rank, source_url, current, verification_note, source_record, import, verification_status, provenance, occasions, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }
}, () => {
  // Forward-only: catalogue provenance and seeded records are retained.
  return null;
});

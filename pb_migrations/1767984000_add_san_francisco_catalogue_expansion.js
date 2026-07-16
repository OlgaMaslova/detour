/// <reference path="../pb_data/types.d.ts" />
//
// San Francisco catalogue expansion: MICHELIN California 2026 Bib Gourmands
// and one-star additions, plus 50 Top Pizza USA 2025 rank 3.
//
// The 15 verified rows are statically inlined from
// data/san-francisco-catalogue-expansion.csv. Individual MICHELIN restaurant
// records are the row-level authority; the official 2026 Bib Gourmand roundup
// and California edition announcement are retained as shared source records.
// Coordinates are independently qualified from OpenStreetMap/Nominatim and are
// never attributed to MICHELIN or 50 Top Pizza.
//
// Forward-only and retry-safe: inserts are bulk INSERT OR IGNORE statements,
// ids are deterministic 15-character PocketBase ids, unique source slugs/URLs
// and import keys are re-looked-up after insertion, and rollback is a no-op.
migrate((app) => {
  const NOW = "2026-07-16 00:00:00.000Z";
  const ACCESSED = "2026-07-16 00:00:00.000Z";
  const EDITION_PUBLISHED = "2026-06-24 00:00:00.000Z";

  const BIB_ROUNDUP_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/california-s-most-affordable-restaurants-in-2026";
  const EDITION_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california";
  const PIZZA_RANKING_URL = "https://www.50toppizza.it/50-top-usa-2025/";
  const MICHELIN_EDITION = "MICHELIN Guide California 2026";
  const PIZZA_EDITION = "50 Top Pizza USA 2025";

  const MICHELIN_SOURCE_SEED_ID = "gsmichelin00001";
  const PIZZA_SOURCE_SEED_ID = "gstoppizza00001";
  const BIB_RECORD_SEED_ID = "srcsf2026bib001";
  const EDITION_RECORD_SEED_ID = "srcsf2026ann001";
  const MICHELIN_IMPORT_SEED_ID = "impsf2026cat001";
  const PIZZA_IMPORT_SEED_ID = "impsf2025piz001";

  const rows = [
    {
      name: "A16", category: "Casual", address: "2355 Chestnut St., San Francisco, CA 94123",
      lat: 37.7999597, lng: -122.4421040,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/a16",
      officialUrl: "https://www.a16pizza.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec011",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for A16 at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Anchor Oyster Bar", category: "Casual", address: "579 Castro St., San Francisco, CA 94114",
      lat: 37.7596972, lng: -122.4347474,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/anchor-oyster-bar",
      officialUrl: "http://anchoroysterbar.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec012",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Anchor Oyster Bar at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Bansang", category: "Casual", address: "1560 Fillmore St., San Francisco, CA 94115",
      lat: 37.7841288, lng: -122.4327413,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/bansang",
      officialUrl: "https://www.bansangsf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec013",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_address_verified",
      coordNote: "OSM/Nominatim address-level geometry for 1560 Fillmore St.; this is not claimed as a named venue match and is not supplied by MICHELIN."
    },
    {
      name: "Dumpling Home", category: "Casual", address: "298 Gough St., San Francisco, CA 94102",
      lat: 37.7758690, lng: -122.4226658,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/dumpling-home",
      officialUrl: "https://www.dumplinghomesf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec014",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Dumpling Home at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Good Good Culture Club", category: "Casual", address: "3560 18th St., San Francisco, CA 94110",
      lat: 37.7617297, lng: -122.4229480,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/good-good-culture-club",
      officialUrl: "https://goodgoodcultureclub.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec015",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Good Good Culture Club at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Izakaya Rintaro", category: "Casual", address: "82 14th St., San Francisco, CA 94103",
      lat: 37.7688879, lng: -122.4151313,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/izakaya-rintaro",
      officialUrl: "https://izakayarintaro.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec016",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result uses the exact short name Rintaro at 82 14th St.; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Okane", category: "Casual", address: "669 Townsend St., San Francisco, CA 94107",
      lat: 37.7706064, lng: -122.4029610,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/okane",
      officialUrl: "https://www.okanesf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec017",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Okane at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Outerlands", category: "Casual", address: "4001 Judah St., San Francisco, CA 94122",
      lat: 37.7603503, lng: -122.5050056,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/outerlands",
      officialUrl: "https://outerlandssf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec018",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Outerlands at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Trestle", category: "Casual", address: "531 Jackson St., San Francisco, CA 94133",
      lat: 37.7962001, lng: -122.4045177,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/trestle",
      officialUrl: "https://www.trestlesf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec019",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Trestle at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Yank Sing", category: "Casual", address: "101 Spear St., San Francisco, CA 94105",
      lat: 37.7925915, lng: -122.3930383,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/yank-sing",
      officialUrl: "https://yanksing.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec020",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Yank Sing at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Z & Y", category: "Casual", address: "655 Jackson St., San Francisco, CA 94133",
      lat: 37.7959411, lng: -122.4060364,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/z-y",
      officialUrl: "https://www.zandyrestaurant.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec021",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_address_verified",
      coordNote: "OSM/Nominatim address-level geometry for 655 Jackson St.; this is not claimed as a named venue match and is not supplied by MICHELIN."
    },
    {
      name: "Kitchen Istanbul", category: "Casual", address: "349 Clement St., San Francisco, CA 94118",
      lat: 37.7828910, lng: -122.4632006,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/kitchen-istanbul",
      officialUrl: "https://www.kitchenistanbulsf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec022",
      year: 2026, distinction: "bib-gourmand", distinctionLevel: 0, awardLevel: "Bib Gourmand",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Kitchen Istanbul at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Hilda and Jesse", category: "Fine dining", address: "701 Union St., San Francisco, CA 94133",
      lat: 37.8001073, lng: -122.4109558,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/hilda-and-jesse",
      officialUrl: "https://www.hildaandjessesf.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec023",
      year: 2026, distinction: "one-star", distinctionLevel: 1, awardLevel: "1 Star",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Hilda and Jesse at the exact address; coordinates are independently OSM-sourced, not supplied by MICHELIN."
    },
    {
      name: "Nisei", category: "Fine dining", address: "2316 Polk St., San Francisco, CA 94109",
      lat: 37.7981608, lng: -122.4220036,
      sourceUrl: "https://guide.michelin.com/us/en/california/san-francisco/restaurant/nisei",
      officialUrl: "https://www.restaurantnisei.com/", sourceKind: "michelin", recordSeedId: "srcsf2026rec024",
      year: 2026, distinction: "one-star", distinctionLevel: 1, awardLevel: "1 Star",
      sourceType: "official-restaurant-record", edition: MICHELIN_EDITION, rank: 0,
      coordStatus: "osm_address_verified",
      coordNote: "OSM/Nominatim address-level geometry for 2316 Polk St.; this is not claimed as a named venue match and is not supplied by MICHELIN."
    },
    {
      name: "Tony’s Pizza Napoletana", category: "Pizza", address: "1570 Stockton St., San Francisco, CA 94133",
      lat: 37.8003332, lng: -122.4090513,
      sourceUrl: PIZZA_RANKING_URL, officialUrl: "https://tonyspizzanapoletana.com/",
      sourceKind: "pizza", recordSeedId: "srcsf2025piz001", year: 2025,
      distinction: "50 Top Pizza USA 2025 — No. 3", distinctionLevel: 3,
      awardLevel: "50 Top Pizza USA 2025 — No. 3", sourceType: "official-ranking-page",
      edition: PIZZA_EDITION, rank: 3, coordStatus: "osm_verified",
      coordNote: "Named OSM/Nominatim result for Tony’s Pizza Napoletana at the exact address; coordinates are independently OSM-sourced, not supplied by 50 Top Pizza."
    }
  ];

  const venueId = (index) => "venuesf2026" + String(index + 11).padStart(4, "0");
  const awardId = (index) => "awardsf2026" + String(index + 11).padStart(4, "0");
  const entryId = (index) => "vsesf2026" + String(index + 11).padStart(6, "0");

  // ---------- guide sources: insert or reuse by unique slug ----------
  app.db().newQuery(
    "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) VALUES " +
      "({:michelinId}, 'Michelin Guide', 'michelin-guide', 'https://guide.michelin.com/', 2026, {:now}, {:now}), " +
      "({:pizzaId}, '50 Top Pizza', '50-top-pizza', 'https://www.50toppizza.it/', 2026, {:now}, {:now})"
  ).bind({ michelinId: MICHELIN_SOURCE_SEED_ID, pizzaId: PIZZA_SOURCE_SEED_ID, now: NOW }).execute();
  const michelinSourceId = app.findFirstRecordByFilter("guide_sources", "slug = 'michelin-guide'").id;
  const pizzaSourceId = app.findFirstRecordByFilter("guide_sources", "slug = '50-top-pizza'").id;

  // ---------- shared sources + 15 row-authority source records ----------
  {
    const params = {
      bibId: BIB_RECORD_SEED_ID, editionId: EDITION_RECORD_SEED_ID,
      michelin: michelinSourceId,
      bibUrl: BIB_ROUNDUP_URL, editionUrl: EDITION_URL,
      published: EDITION_PUBLISHED, accessed: ACCESSED, now: NOW
    };
    const values = [
      "({:bibId}, {:michelin}, 'MICHELIN Guide California 2026 — official Bib Gourmand roundup', {:bibUrl}, 'official-roundup', '', {:accessed}, {:now}, {:now})",
      "({:editionId}, {:michelin}, 'MICHELIN Guide California 2026 starred restaurants announcement', {:editionUrl}, 'official-edition-announcement', {:published}, {:accessed}, {:now}, {:now})",
      ...rows.map((row, index) => {
        params[`id${index}`] = row.recordSeedId;
        params[`source${index}`] = row.sourceKind === "pizza" ? pizzaSourceId : michelinSourceId;
        params[`title${index}`] = row.sourceKind === "pizza"
          ? "50 Top Pizza USA 2025 — official ranking page"
          : `MICHELIN Guide California 2026 — official restaurant record: ${row.name}`;
        params[`url${index}`] = row.sourceUrl;
        params[`type${index}`] = row.sourceType;
        return `({:id${index}}, {:source${index}}, {:title${index}}, {:url${index}}, {:type${index}}, '', {:accessed}, {:now}, {:now})`;
      })
    ];
    app.db().newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
        values.join(", ")
    ).bind(params).execute();
  }
  const sourceRecordIds = rows.map((row) =>
    app.findFirstRecordByFilter("source_records", "url = {:url}", { url: row.sourceUrl }).id
  );
  const bibRecordId = app.findFirstRecordByFilter("source_records", "url = {:url}", { url: BIB_ROUNDUP_URL }).id;
  const editionRecordId = app.findFirstRecordByFilter("source_records", "url = {:url}", { url: EDITION_URL }).id;

  // ---------- two source-specific import provenance rows ----------
  app.db().newQuery(
    "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) VALUES " +
      "({:michelinId}, 'san-francisco-catalogue-expansion-michelin-2026', 'data/san-francisco-catalogue-expansion.csv', " +
      "'Verified import of 12 San Francisco MICHELIN 2026 Bib Gourmands and two 2026 one-star additions; individual record authority, shared official sources, and independent OSM coordinate qualifiers retained.', " +
      "{:michelin}, 14, 'verified', {:accessed}, {:now}, {:now}), " +
      "({:pizzaId}, 'san-francisco-catalogue-expansion-50-top-pizza-2025', 'data/san-francisco-catalogue-expansion.csv', " +
      "'Verified import of Tony’s Pizza Napoletana at rank 3 in the official 50 Top Pizza USA 2025 ranking; independent OSM coordinate qualifier retained.', " +
      "{:pizza}, 1, 'verified', {:accessed}, {:now}, {:now})"
  ).bind({
    michelinId: MICHELIN_IMPORT_SEED_ID, pizzaId: PIZZA_IMPORT_SEED_ID,
    michelin: michelinSourceId, pizza: pizzaSourceId, accessed: ACCESSED, now: NOW
  }).execute();
  const michelinImportId = app.findFirstRecordByFilter(
    "import_provenance", "import_key = 'san-francisco-catalogue-expansion-michelin-2026'"
  ).id;
  const pizzaImportId = app.findFirstRecordByFilter(
    "import_provenance", "import_key = 'san-francisco-catalogue-expansion-50-top-pizza-2025'"
  ).id;

  // ---------- 15 new canonical venues: one bulk idempotent insert ----------
  {
    const params = { now: NOW };
    const values = rows.map((row, index) => {
      params[`id${index}`] = venueId(index);
      params[`name${index}`] = row.name;
      params[`address${index}`] = row.address;
      params[`lat${index}`] = row.lat;
      params[`lng${index}`] = row.lng;
      params[`category${index}`] = row.category;
      params[`official${index}`] = row.officialUrl;
      params[`note${index}`] = row.coordNote.slice(0, 300);
      return `({:id${index}}, {:name${index}}, 'San Francisco', 'United States', {:address${index}}, {:lat${index}}, {:lng${index}}, {:category${index}}, {:official${index}}, {:note${index}}, {:now}, {:now})`;
    });
    app.db().newQuery(
      "INSERT OR IGNORE INTO venues (id, name, city, country, address, lat, lng, category, official_url, coord_verification_note, created, updated) VALUES " +
        values.join(", ")
    ).bind(params).execute();
  }

  // ---------- 15 awards, linked to exact row-level source records ----------
  {
    const params = { now: NOW };
    const values = rows.map((row, index) => {
      const sourceId = row.sourceKind === "pizza" ? pizzaSourceId : michelinSourceId;
      const importId = row.sourceKind === "pizza" ? pizzaImportId : michelinImportId;
      params[`id${index}`] = awardId(index);
      params[`source${index}`] = sourceId;
      params[`venue${index}`] = venueId(index);
      params[`year${index}`] = row.year;
      params[`level${index}`] = row.awardLevel;
      params[`rank${index}`] = row.rank;
      params[`url${index}`] = row.sourceUrl;
      params[`record${index}`] = sourceRecordIds[index];
      params[`import${index}`] = importId;
      params[`note${index}`] = row.sourceKind === "pizza"
        ? "50 Top Pizza USA 2025 official ranking page verifies Tony’s Pizza Napoletana at No. 3; accessed 2026-07-16."
        : `Individual MICHELIN restaurant record verifies ${row.awardLevel} in the California 2026 edition; accessed 2026-07-16.`;
      return `({:id${index}}, {:source${index}}, {:venue${index}}, {:year${index}}, {:level${index}}, {:rank${index}}, {:url${index}}, TRUE, {:note${index}}, {:record${index}}, {:import${index}}, 'verified', {:now}, {:now})`;
    });
    app.db().newQuery(
      "INSERT OR IGNORE INTO venue_awards (id, source, venue, year, level, rank, source_url, current, verification_note, source_record, import, verification_status, created, updated) VALUES " +
        values.join(", ")
    ).bind(params).execute();
  }

  // ---------- 15 full raw source assertions, one bulk idempotent insert ----------
  {
    const params = { accessed: ACCESSED, now: NOW };
    const values = rows.map((row, index) => {
      const isPizza = row.sourceKind === "pizza";
      const isBib = row.distinction === "bib-gourmand";
      params[`id${index}`] = entryId(index);
      params[`source${index}`] = isPizza ? pizzaSourceId : michelinSourceId;
      params[`record${index}`] = sourceRecordIds[index];
      params[`import${index}`] = isPizza ? pizzaImportId : michelinImportId;
      params[`venue${index}`] = venueId(index);
      params[`name${index}`] = row.name;
      params[`year${index}`] = row.year;
      params[`distinction${index}`] = row.distinction;
      params[`level${index}`] = row.distinctionLevel;
      params[`url${index}`] = row.sourceUrl;
      params[`type${index}`] = row.sourceType;
      params[`evidence${index}`] = isPizza
        ? "Official 50 Top Pizza USA 2025 ranking page supports the source name, USA edition, and rank 3. Coordinates are separately OSM-qualified."
        : isBib
          ? `Individual MICHELIN restaurant record supports the source name, San Francisco address, and Bib Gourmand assertion; the official 2026 roundup is retained as source record ${bibRecordId}. Coordinates are separately OSM-qualified.`
          : `Individual MICHELIN restaurant record supports the source name, San Francisco address, and one-star assertion; the governing California 2026 announcement is retained as source record ${editionRecordId}. Coordinates are separately OSM-qualified.`;
      params[`address${index}`] = row.address;
      params[`lat${index}`] = row.lat;
      params[`lng${index}`] = row.lng;
      params[`coordStatus${index}`] = row.coordStatus;
      params[`match${index}`] = "New San Francisco canonical row keyed by exact source spelling, city, and country; no fuzzy merge attempted.";
      params[`edition${index}`] = row.edition;
      params[`rank${index}`] = row.rank;
      return `({:id${index}}, {:source${index}}, {:record${index}}, {:import${index}}, {:venue${index}}, {:name${index}}, 'San Francisco', 'United States', ` +
        `{:year${index}}, {:distinction${index}}, {:level${index}}, {:url${index}}, {:type${index}}, '', {:accessed}, ` +
        `'verified', {:evidence${index}}, {:address${index}}, {:lat${index}}, {:lng${index}}, 'openstreetmap-nominatim', {:coordStatus${index}}, ` +
        `'single-source', {:match${index}}, {:edition${index}}, {:rank${index}}, {:now}, {:now})`;
    });
    app.db().newQuery(
      "INSERT OR IGNORE INTO venue_source_entries (id, source, source_record, import, venue, source_venue_name, locality, country, " +
        "guide_year, distinction, distinction_level, source_url, source_type, source_published_or_updated_at, source_accessed_at, " +
        "award_validation_status, validation_evidence, street_address, latitude, longitude, coordinate_source, coordinate_validation_status, " +
        "match_method, match_evidence, source_edition, source_rank, created, updated) VALUES " + values.join(", ")
    ).bind(params).execute();
  }
}, () => {
  // Forward-only: shipped catalogue data is corrected by later migrations.
  return null;
});

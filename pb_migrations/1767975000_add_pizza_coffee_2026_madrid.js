/// <reference path="../pb_data/types.d.ts" />
//
// 50 Top Pizza Europa 2026 + The World's 100 Best Coffee Shops 2026 — Madrid.
//
// Imports the verified rows from
//   data/50-top-pizza-europa-2026-madrid.csv (2 rows, dataset validation passed)
//   data/worlds-100-best-coffee-shops-2026-madrid.csv (1 row, dataset validation passed)
// into the existing canonical model. Values are statically inlined —
// migrations cannot read files at runtime.
//
// Merge decision: exact normalized full-name checks against all 40 existing
// canonical venues (data/madrid-2026-unified-venues.json) returned no_match
// for all three candidates (see the two *-dedupe.json artifacts), so three
// NEW canonical venue rows are created; nothing is merged or duplicated.
// Stable categories: exactly 'Pizza' and 'Coffee'.
//
// Schema: venue_source_entries is extended with `source_edition` (the exact
// source list/edition name) and `source_rank` (numeric source-side rank),
// preserving every existing field, index, rule and row.
//
// Forward-only and retry-safe: every insert is a bulk parameterized
// INSERT OR IGNORE with deterministic 15-char ids, unique-key rows are
// re-looked-up by slug/url/import_key after insert, and the down migration
// is a no-op (no destructive rollback).
migrate((app) => {
  const NOW = "2026-07-14 00:00:00.000Z";
  const ACCESSED = "2026-07-14 00:00:00.000Z"; // CSV source_accessed_at

  const PIZZA_RANKING_URL = "https://www.50toppizza.it/50-top-pizza-europa-2026/";
  const COFFEE_RANKING_URL = "https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/";
  const COFFEE_RECORD_URL = "https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/";

  const PIZZA_EDITION = "50 Top Pizza Europa 2026";
  const COFFEE_EDITION = "The World's 100 Best Coffee Shops 2026";

  // Deterministic 15-char ids.
  const PIZZA_SOURCE_SEED_ID = "gstoppizza00001";
  const COFFEE_SOURCE_SEED_ID = "gsw100coffee001";
  const SRCREC_PIZZA_SEED = "srcrec2026pizza";
  const SRCREC_COF_RANK_SEED = "srcrec2026cofr1";
  const SRCREC_COF_REC_SEED = "srcrec2026cofv1";
  const IMP_PIZZA_SEED = "imppizza2026001";
  const IMP_COFFEE_SEED = "impcoffee202601";

  // ---------- schema: extend venue_source_entries (guarded, lossless) ----------
  const sources = app.findCollectionByNameOrId("guide_sources");
  const venues = app.findCollectionByNameOrId("venues");
  const srcRecs = app.findCollectionByNameOrId("source_records");
  const imports = app.findCollectionByNameOrId("import_provenance");
  const entries = app.findCollectionByNameOrId("venue_source_entries");

  // Add source_edition / source_rank only when missing; never remove or
  // redefine existing fields, so existing rows and data are untouched.
  const haveField = (name) => {
    try {
      return !!entries.fields.getByName(name);
    } catch {
      return false;
    }
  };
  let schemaChanged = false;
  if (!haveField("source_edition")) {
    entries.fields.add(new TextField({ name: "source_edition", max: 160 }));
    schemaChanged = true;
  }
  if (!haveField("source_rank")) {
    entries.fields.add(new NumberField({ name: "source_rank", onlyInt: true, min: 0 }));
    schemaChanged = true;
  }
  if (schemaChanged) app.save(entries);

  // ---------- guide sources (insert-or-reuse by unique slug) ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) VALUES " +
        "({:idP}, '50 Top Pizza', '50-top-pizza', 'https://www.50toppizza.it/', 2026, {:now}, {:now}), " +
        "({:idC}, {:nameC}, 'w100-best-coffee-shops', 'https://theworlds100bestcoffeeshops.com/', 2026, {:now}, {:now})"
    )
    .bind({
      idP: PIZZA_SOURCE_SEED_ID,
      idC: COFFEE_SOURCE_SEED_ID,
      nameC: "The World's 100 Best Coffee Shops",
      now: NOW,
    })
    .execute();
  // Reuse whatever rows own the unique slugs (covers pre-existing rows with
  // different ids: the inserts above are then ignored by the slug index).
  const PIZZA_SOURCE_ID = app.findFirstRecordByFilter("guide_sources", "slug = '50-top-pizza'").id;
  const COFFEE_SOURCE_ID = app.findFirstRecordByFilter("guide_sources", "slug = 'w100-best-coffee-shops'").id;

  // ---------- source_records: ranking pages + coffee official venue record ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
        "({:idP}, {:srcP}, '50 Top Pizza Europa 2026 — official ranking page (60 entries)', {:urlP}, 'official-ranking-page', '', {:acc}, {:now}, {:now}), " +
        "({:idCR}, {:srcC}, {:titleCR}, {:urlCR}, 'official-ranking-page', '', {:acc}, {:now}, {:now}), " +
        "({:idCV}, {:srcC}, {:titleCV}, {:urlCV}, 'official-venue-record', '', {:acc}, {:now}, {:now})"
    )
    .bind({
      idP: SRCREC_PIZZA_SEED, srcP: PIZZA_SOURCE_ID, urlP: PIZZA_RANKING_URL,
      idCR: SRCREC_COF_RANK_SEED, idCV: SRCREC_COF_REC_SEED, srcC: COFFEE_SOURCE_ID,
      titleCR: "The World's 100 Best Coffee Shops 2026 — official global top-100 ranking page",
      urlCR: COFFEE_RANKING_URL,
      titleCV: "The World's 100 Best Coffee Shops 2026 — official venue record: Hola Coffee Lagasca",
      urlCV: COFFEE_RECORD_URL,
      acc: ACCESSED, now: NOW,
    })
    .execute();
  const SRCREC_PIZZA = app.findFirstRecordByFilter("source_records", "url = {:u}", { u: PIZZA_RANKING_URL }).id;
  const SRCREC_COF_RANK = app.findFirstRecordByFilter("source_records", "url = {:u}", { u: COFFEE_RANKING_URL }).id;
  const SRCREC_COF_REC = app.findFirstRecordByFilter("source_records", "url = {:u}", { u: COFFEE_RECORD_URL }).id;

  // ---------- import_provenance (insert-or-reuse by unique import_key) ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) VALUES " +
        "({:idP}, '50-top-pizza-europa-2026-madrid', 'data/50-top-pizza-europa-2026-madrid.csv', " +
        "'Verified import of the 2 Madrid entries on the official 50 Top Pizza Europa 2026 ranking (60 entries); dataset validation passed; coordinates independently OSM-verified.', " +
        "{:srcP}, 2, 'verified', {:acc}, {:now}, {:now}), " +
        "({:idC}, 'worlds-100-best-coffee-shops-2026-madrid', 'data/worlds-100-best-coffee-shops-2026-madrid.csv', " +
        "{:descC}, {:srcC}, 1, 'verified', {:acc}, {:now}, {:now})"
    )
    .bind({
      idP: IMP_PIZZA_SEED, srcP: PIZZA_SOURCE_ID,
      idC: IMP_COFFEE_SEED, srcC: COFFEE_SOURCE_ID,
      descC:
        "Verified import of the single Madrid entry in The World's 100 Best Coffee Shops 2026 global top-100; dataset validation passed; coordinates independently OSM/Nominatim-verified.",
      acc: ACCESSED, now: NOW,
    })
    .execute();
  const IMP_PIZZA = app.findFirstRecordByFilter("import_provenance", "import_key = '50-top-pizza-europa-2026-madrid'").id;
  const IMP_COFFEE = app.findFirstRecordByFilter("import_provenance", "import_key = 'worlds-100-best-coffee-shops-2026-madrid'").id;

  // ---------- static verified rows (inlined from the two CSVs) ----------
  // All three are no-match against the 40 existing canonical venues
  // (exact normalized full-name checks) — new canonical rows only.
  const ROWS = [
    {
      venueId: "venuepizza00001", awardId: "awardpizza00001", vseId: "vsepizza0000001",
      src: PIZZA_SOURCE_ID, srcrec: SRCREC_PIZZA, imp: IMP_PIZZA,
      name: "Baldoria", category: "Pizza",
      edition: PIZZA_EDITION, rank: 2,
      level: "50 Top Pizza Europa 2026 — No. 2",
      awardUrl: PIZZA_RANKING_URL, vseUrl: PIZZA_RANKING_URL, vseType: "official-ranking-page",
      officialUrl: "https://baldoriamadrid.com/en/",
      address: "C. de José Ortega y Gasset, 100, 28006 Madrid",
      lat: 40.4294985, lng: -3.6707425,
      coordSource: "openstreetmap", coordStatus: "osm_verified",
      coordNote:
        "Address from the official venue site independently corroborated by OSM named node 11916159225; coordinates are OSM-sourced, not taken from the guide.",
      evidence:
        "Rank 2 on the official 50 Top Pizza Europa 2026 ranking page (60 entries); city Madrid, country Spain as listed by the ranking. Official venue site is the operator's own page.",
      matchEvidence:
        "50 Top Pizza-only within the Madrid/Spain/2026 block: exact normalized full-name check against all 40 existing canonical venues returned no match (no fuzzy merge attempted).",
    },
    {
      venueId: "venuepizza00002", awardId: "awardpizza00002", vseId: "vsepizza0000002",
      src: PIZZA_SOURCE_ID, srcrec: SRCREC_PIZZA, imp: IMP_PIZZA,
      name: "Fratelli Figurato", category: "Pizza",
      edition: PIZZA_EDITION, rank: 11,
      level: "50 Top Pizza Europa 2026 — No. 11",
      awardUrl: PIZZA_RANKING_URL, vseUrl: PIZZA_RANKING_URL, vseType: "official-ranking-page",
      officialUrl: "https://www.fratellifigurato.es/pizzeria-madrid",
      address: "Calle Alonso Cano, 37, 28003 Madrid",
      lat: 40.4389910, lng: -3.6978429,
      coordSource: "openstreetmap", coordStatus: "osm_verified",
      coordNote:
        "Primary Pizzeria Fratelli Figurato at Calle Alonso Cano 37 identified via the operator's official page https://www.fratellifigurato.es/pizzeria-madrid and corroborated by OSM named node 6131891485; coordinates are OSM-sourced. Branch attribution is a separate corroborated fact, not part of the ranking's claim.",
      evidence:
        "Rank 11 on the official 50 Top Pizza Europa 2026 ranking page (60 entries); the ranking names only 'Fratelli Figurato' with city Madrid and does NOT identify a specific branch. Operator runs multiple Madrid locations (see official booking page https://www.fratellifigurato.es/reserva-mesa). Location below is the operator's primary 'Pizzeria Fratelli Figurato' venue, separately corroborated — not a guide claim that a particular branch was awarded.",
      matchEvidence:
        "50 Top Pizza-only within the Madrid/Spain/2026 block: exact normalized full-name check against all 40 existing canonical venues returned no match (no fuzzy merge attempted).",
    },
    {
      venueId: "venuecoffee0001", awardId: "awardcoffee0001", vseId: "vsecoffee000001",
      src: COFFEE_SOURCE_ID, srcrec: SRCREC_COF_REC, imp: IMP_COFFEE,
      name: "Hola Coffee Lagasca", category: "Coffee",
      edition: COFFEE_EDITION, rank: 19,
      level: "The World's 100 Best Coffee Shops 2026 — No. 19",
      awardUrl: COFFEE_RANKING_URL, vseUrl: COFFEE_RECORD_URL, vseType: "official-venue-record",
      officialUrl: COFFEE_RECORD_URL,
      address: "Calle Lagasca, 42, 28001, Madrid, Spain",
      lat: 40.4248823, lng: -3.6853284,
      coordSource: "openstreetmap-nominatim", coordStatus: "osm_verified",
      coordNote:
        "Independent OSM Nominatim lookup returned named cafe node 12147737601 with an address matching the official venue record; coordinates are OSM-sourced, not taken from the guide.",
      evidence:
        "Only Madrid entry in the current 2026 global top-100; rank and Spain listing verified on the official ranking page, city Madrid verified on the official venue record. Related Europe-subset display name 'Hola Coffee Roastery' (#8) is non-governing and deliberately not imported.",
      matchEvidence:
        "Coffee-list-only within the Madrid/Spain/2026 block: exact normalized full-name check against all 40 existing canonical venues returned no match (no fuzzy merge attempted).",
    },
  ];

  // ---------- 3 canonical venues (single bulk, idempotent) ----------
  {
    const params = { now: NOW };
    const values = ROWS.map((r, i) => {
      params["id" + i] = r.venueId;
      params["name" + i] = r.name;
      params["addr" + i] = r.address;
      params["lat" + i] = r.lat;
      params["lng" + i] = r.lng;
      params["cat" + i] = r.category;
      params["url" + i] = r.officialUrl;
      params["note" + i] = r.coordNote.slice(0, 300);
      return (
        "({:id" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', {:addr" + i + "}, {:lat" + i +
        "}, {:lng" + i + "}, {:cat" + i + "}, {:url" + i + "}, {:note" + i + "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venues (id, name, city, country, address, lat, lng, category, official_url, coord_verification_note, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }

  // ---------- 3 venue_awards (single bulk, idempotent) ----------
  {
    const params = { now: NOW };
    const values = ROWS.map((r, i) => {
      params["id" + i] = r.awardId;
      params["src" + i] = r.src;
      params["venue" + i] = r.venueId;
      params["level" + i] = r.level;
      params["rank" + i] = r.rank;
      params["url" + i] = r.awardUrl;
      params["note" + i] = r.evidence.slice(0, 300);
      params["srcrec" + i] = r.srcrec;
      params["imp" + i] = r.imp;
      return (
        "({:id" + i + "}, {:src" + i + "}, {:venue" + i + "}, 2026, {:level" + i + "}, {:rank" + i +
        "}, {:url" + i + "}, TRUE, {:note" + i + "}, {:srcrec" + i + "}, {:imp" + i + "}, 'verified', {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_awards (id, source, venue, year, level, rank, source_url, current, verification_note, source_record, import, verification_status, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }

  // ---------- 3 venue_source_entries (single bulk, idempotent) ----------
  {
    const params = { now: NOW, acc: ACCESSED };
    const values = ROWS.map((r, i) => {
      params["id" + i] = r.vseId;
      params["src" + i] = r.src;
      params["srcrec" + i] = r.srcrec;
      params["imp" + i] = r.imp;
      params["venue" + i] = r.venueId;
      params["name" + i] = r.name;
      params["dist" + i] = r.level;
      params["lvl" + i] = r.rank;
      params["url" + i] = r.vseUrl;
      params["stype" + i] = r.vseType;
      params["vev" + i] = r.evidence.slice(0, 500);
      params["addr" + i] = r.address;
      params["lat" + i] = r.lat;
      params["lng" + i] = r.lng;
      params["csrc" + i] = r.coordSource;
      params["cval" + i] = r.coordStatus;
      params["mev" + i] = r.matchEvidence;
      params["ed" + i] = r.edition;
      params["srank" + i] = r.rank;
      return (
        "({:id" + i + "}, {:src" + i + "}, {:srcrec" + i + "}, {:imp" + i + "}, {:venue" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', " +
        "2026, {:dist" + i + "}, {:lvl" + i + "}, {:url" + i + "}, {:stype" + i + "}, '', {:acc}, " +
        "'verified', {:vev" + i + "}, {:addr" + i + "}, {:lat" + i + "}, {:lng" + i + "}, {:csrc" + i + "}, {:cval" + i + "}, " +
        "'single-source', {:mev" + i + "}, {:ed" + i + "}, {:srank" + i + "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_source_entries (id, source, source_record, import, venue, source_venue_name, locality, country, " +
          "guide_year, distinction, distinction_level, source_url, source_type, source_published_or_updated_at, source_accessed_at, " +
          "award_validation_status, validation_evidence, street_address, latitude, longitude, coordinate_source, coordinate_validation_status, " +
          "match_method, match_evidence, source_edition, source_rank, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }
}, () => {
  // Forward-only: shipped data is corrected in later migrations.
  return null;
});

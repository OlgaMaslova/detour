/// <reference path="../pb_data/types.d.ts" />
//
// Michelin Guide 2026 Madrid multi-source expansion.
//
// Model split enforced here:
// - `venue_source_entries` holds RAW per-guide source assertions (what one
//   guide said, verbatim: source-specific name, distinction, URL, address and
//   coordinates as that import carried them). One row per (source, venue-name,
//   year, distinction).
// - `venues` holds the CANONICAL venue: one row per real-world restaurant,
//   linked from every source entry. Existing Repsol canonical rows (and their
//   verified address/coordinate data) are reused untouched for exact matches.
// - Matching policy: only EXACT normalized full-name equality (unique
//   one-to-one within the Madrid/Spain/2026 block) merges two source entries
//   into one canonical venue (match_method='exact-normalized-full-name', with
//   inspectable evidence). NO fuzzy merge: similar names, shared prefixes or
//   shared chef names never merge (e.g. 'Ramón Freixa Tradición' vs 'Ramón
//   Freixa Atelier' stay separate; see
//   data/madrid-2026-multi-source-match-exceptions.json). Single-guide
//   entries carry match_method='single-source'.
//
// Data (statically inlined — migrations cannot read files at runtime):
// - data/michelin-2026-madrid-city-starred.csv (30 rows, dataset validation
//   passed): 30 Michelin awards, 20 new Michelin-only canonical venues,
//   30 Michelin source entries.
// - 20 Repsol source entries derived from the two already-imported Repsol
//   CSVs (their source-specific metadata has no address/coordinates).
//
// Resulting counts: guide_sources 2, source_records 7, import_provenance 3,
// venues 40, venue_awards 50, venue_source_entries 50.
//
// Forward-only. Every statement is INSERT OR IGNORE or a guarded idempotent
// update with deterministic 15-char ids, so a rerun after a partial failure
// converges without throwing.
migrate((app) => {
  const NOW = "2026-07-12 00:00:00.000Z";
  const ACCESSED = "2026-07-12 00:00:00.000Z"; // CSV source_accessed_at
  const REPSOL_PUBLISHED = "2026-02-16 00:00:00.000Z"; // new-Sol pages publication date

  // Existing deterministic Guía Repsol ids (from 1767971000 / 1767972000).
  const REPSOL_SOURCE_ID = "gsrepsol0000001";
  const SRCREC_3SOL = "srcrec20260sol3";
  const SRCREC_2SOL = "srcrec20260sol2";
  const SRCREC_1SOL = "srcrec20260sol1";
  const SRCREC_BOOKLET = "srcrec2026book1";
  const IMP_REPSOL_NEW = "impguia20260001";
  const IMP_REPSOL_CONT = "impguia20260002";
  const PAGE_3SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevo-restaurante-3-soles-guia-repsol/";
  const PAGE_2SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-2-soles-guia-repsol/";
  const PAGE_1SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-un-sol-guia-repsol/";
  const BOOKLET_URL = "https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf";

  // New deterministic Michelin ids (15 chars each).
  const MICH_SOURCE_SEED_ID = "gsmichelin00001";
  const SRCREC_MICH3_SEED = "srcrec2026mich3";
  const SRCREC_MICH2_SEED = "srcrec2026mich2";
  const SRCREC_MICH1_SEED = "srcrec2026mich1";
  const IMP_MICH_ID = "impmich20260001";
  const MICH_URL_3 = "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/3-estrellas-michelin";
  const MICH_URL_2 = "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/2-estrellas-michelin";
  const MICH_URL_1 = "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/1-estrella-michelin";

  // ---------- schema: venue_source_entries (guarded create-or-update) ----------
  const sources = app.findCollectionByNameOrId("guide_sources");
  const venues = app.findCollectionByNameOrId("venues");
  const srcRecs = app.findCollectionByNameOrId("source_records");
  const imports = app.findCollectionByNameOrId("import_provenance");

  let entries;
  try {
    entries = app.findCollectionByNameOrId("venue_source_entries");
  } catch {
    entries = new Collection({ name: "venue_source_entries", type: "base" });
  }
  entries.fields = [
    // Raw per-guide assertion, linked to its provenance and canonical venue.
    new RelationField({ name: "source", required: true, collectionId: sources.id, maxSelect: 1, cascadeDelete: false }),
    new RelationField({ name: "source_record", collectionId: srcRecs.id, maxSelect: 1, cascadeDelete: false }),
    new RelationField({ name: "import", collectionId: imports.id, maxSelect: 1, cascadeDelete: false }),
    new RelationField({ name: "venue", required: true, collectionId: venues.id, maxSelect: 1, cascadeDelete: false }),
    new TextField({ name: "source_venue_name", required: true, max: 200 }),
    new TextField({ name: "locality", max: 120 }),
    new TextField({ name: "country", max: 120 }),
    new NumberField({ name: "guide_year", onlyInt: true, min: 2000, max: 2100 }),
    new TextField({ name: "distinction", max: 120 }),
    new NumberField({ name: "distinction_level", onlyInt: true, min: 0 }),
    new URLField({ name: "source_url" }),
    new TextField({ name: "source_type", max: 60 }),
    new DateField({ name: "source_published_or_updated_at" }), // optional
    new DateField({ name: "source_accessed_at" }),
    new TextField({ name: "award_validation_status", max: 60 }),
    new TextField({ name: "validation_evidence", max: 500 }),
    new TextField({ name: "street_address", max: 300 }),
    // Raw coordinates as asserted by this source's import. lat/lng are
    // non-null NumberFields in PocketBase, so entries with no coordinates use
    // the repo's neutral 0/0 sentinel with coordinate_validation_status
    // marking them absent/unreviewed (0,0 is never a verified Madrid pin).
    new NumberField({ name: "latitude", min: -90, max: 90 }),
    new NumberField({ name: "longitude", min: -180, max: 180 }),
    new TextField({ name: "coordinate_source", max: 120 }),
    new TextField({ name: "coordinate_validation_status", max: 60 }),
    new TextField({ name: "match_method", max: 60 }),
    new TextField({ name: "match_evidence", max: 500 }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];
  entries.indexes = [
    // One raw assertion per (guide, source-side name, year, distinction):
    // duplicates from re-imports are rejected at the index level.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_vse_unique ON venue_source_entries (source, source_venue_name, guide_year, distinction)",
    "CREATE INDEX IF NOT EXISTS idx_vse_venue ON venue_source_entries (venue)",
  ];
  // Public read only; all writes denied.
  entries.listRule = "";
  entries.viewRule = "";
  entries.createRule = null;
  entries.updateRule = null;
  entries.deleteRule = null;
  app.save(entries);

  // ---------- Michelin guide source (add or reuse by slug) ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, 'Michelin Guide', 'michelin-guide', 'https://guide.michelin.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: MICH_SOURCE_SEED_ID, now: NOW })
    .execute();
  // Reuse whatever row owns the unique slug (covers a pre-existing row with a
  // different id: the insert above is then ignored by the slug index).
  const MICH_SOURCE_ID = app.findFirstRecordByFilter("guide_sources", "slug = 'michelin-guide'").id;

  // ---------- 3 exact official 2026 category source_records ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
        "({:id3}, {:src}, 'Michelin Guide 2026 — Madrid 3-star restaurants (official category page)', {:url3}, 'official-category-listing', '', {:acc}, {:now}, {:now}), " +
        "({:id2}, {:src}, 'Michelin Guide 2026 — Madrid 2-star restaurants (official category page)', {:url2}, 'official-category-listing', '', {:acc}, {:now}, {:now}), " +
        "({:id1}, {:src}, 'Michelin Guide 2026 — Madrid 1-star restaurants (official category page)', {:url1}, 'official-category-listing', '', {:acc}, {:now}, {:now})"
    )
    .bind({
      id3: SRCREC_MICH3_SEED, id2: SRCREC_MICH2_SEED, id1: SRCREC_MICH1_SEED,
      url3: MICH_URL_3, url2: MICH_URL_2, url1: MICH_URL_1,
      src: MICH_SOURCE_ID, acc: ACCESSED, now: NOW,
    })
    .execute();
  // Reuse rows owning the unique urls (Guía Repsol records are untouched).
  const SRCREC_MICH = {
    3: app.findFirstRecordByFilter("source_records", "url = {:u}", { u: MICH_URL_3 }).id,
    2: app.findFirstRecordByFilter("source_records", "url = {:u}", { u: MICH_URL_2 }).id,
    1: app.findFirstRecordByFilter("source_records", "url = {:u}", { u: MICH_URL_1 }).id,
  };

  // ---------- import_provenance for the Michelin CSV ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) " +
        "VALUES ({:id}, 'michelin-2026-madrid-city-starred', 'data/michelin-2026-madrid-city-starred.csv', " +
        "'Verified import of the 30 Madrid-city starred restaurants in the Michelin Guide 2026, checked against the three official star-category pages; dataset validation passed.', " +
        "{:src}, 30, 'verified', {:acc}, {:now}, {:now})"
    )
    .bind({ id: IMP_MICH_ID, src: MICH_SOURCE_ID, acc: ACCESSED, now: NOW })
    .execute();
  const MICH_IMPORT_ID = app.findFirstRecordByFilter("import_provenance", "import_key = 'michelin-2026-madrid-city-starred'").id;

  // ---------- static seed data ----------
  // Michelin 2026 Madrid starred rows, exactly as in
  // data/michelin-2026-madrid-city-starred.csv:
  // [name, stars, street_address, lat, lng, coord_source, coord_validation_status, note, canonical_venue_id, shared_with_repsol]
  // canonical_venue_id reuses the existing Repsol venue id on exact
  // normalized full-name matches, else a new deterministic venuemich0000NN id.
  const MICH = [
    ["DiverXO", 3, "Calle del Padre Damián 23, 28036 Madrid", 40.4577954, -3.6859491, "openstreetmap-nominatim", "osm_verified", "Sole 3-star entry on the official 2026 Madrid category page; OSM restaurant node 3415801021 matches name and Madrid-city address.", "venueseed000012", true],
    ["Deessa", 2, "Plaza de la Lealtad 5, 28014 Madrid", 40.4155502, -3.6927255, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM relation 3888654 is the Mandarin Oriental Ritz building that houses Deessa; the restaurant itself is not tagged as a named OSM object.", "venueseed000014", true],
    ["Ramón Freixa Atelier", 2, "Calle de Claudio Coello 67, 28001 Madrid", 40.4285126, -3.6862596, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5085913649 carries the predecessor spelling “Ramón Freixa” at the same operator address (Claudio Coello 67).", "venueseed000001", true],
    ["Coque", 2, "Calle del Marqués de Riscal 11, 28010 Madrid", 40.4306865, -3.6905135, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 7006949434 matches name and Madrid-city address.", "venueseed000011", true],
    ["DSTAgE", 2, "Calle de Regueros 8, 28004 Madrid", 40.4245942, -3.6963316, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5085913644 (“Dstage”, casing variant) matches the Madrid-city address.", "venueseed000013", true],
    ["Paco Roncero", 2, "Calle de Alcalá 15, 28014 Madrid", 40.4180586, -3.7004159, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM relation 19697711 is the Casino de Madrid building that houses the restaurant; no named OSM restaurant object exists for Paco Roncero.", "venuemich000001", false],
    ["Smoked Room", 2, "Paseo de la Castellana 57, 28046 Madrid", 40.4388252, -3.6917467, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM way 1433222601 is the Hyatt Regency Hesperia building that houses Smoked Room; the restaurant itself is not tagged as a named OSM object.", "venueseed000003", true],
    ["Èter", 1, "Calle Granito 20, 28045 Madrid", 40.3932129, -3.6916876, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5362227921 (“Restaurante Èter”) matches name and Madrid-city address.", "venuemich000002", false],
    ["La Tasquería", 1, "Calle del Duque de Sesto 48, 28009 Madrid", 40.4222271, -3.6735107, "openstreetmap-nominatim", "osm_verified", "Two OSM nodes share this name; the house-numbered node 6137473887 at Duque de Sesto 48 was selected and the un-numbered node treated as a data-quality duplicate.", "venuemich000003", false],
    ["Saddle", 1, "Calle de Amador de los Ríos, 28004 Madrid", 40.427537, -3.6911125, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5209961484 matches name; OSM address lacks a house number so the street-level address is recorded as-is.", "venueseed000015", true],
    ["Yugo The Bunker", 1, "Calle de San Blas 2, 28014 Madrid", 40.4106458, -3.6946511, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 12167755757 matches name and Madrid-city address.", "venuemich000004", false],
    ["A'Barra", 1, "Calle del Pinar 15, 28006 Madrid", 40.4386539, -3.6878292, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5235732371 matches name and Madrid-city address.", "venueseed000017", true],
    ["Quimbaya", 1, "Calle de Zurbano 63, 28010 Madrid", 40.4361015, -3.6931943, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 9760919947 matches name and Madrid-city address.", "venuemich000005", false],
    ["OSA", 1, "", null, null, "", "needs_review", "Listed on the official 2026 one-star category page; Nominatim returns only unrelated street/burger matches for this short name so no pin is asserted.", "venuemich000006", false],
    ["El Invernadero", 1, "Calle de Ponzano 85, 28003 Madrid", 40.4445956, -3.6989602, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 10670260205 (“El Invernadero Rodrigo de la Calle”) matches name and Madrid-city address.", "venuemich000007", false],
    ["Pabú", 1, "", null, null, "", "needs_review", "Listed on the official 2026 one-star category page; no matching OSM/Nominatim restaurant object found so coordinates are deliberately left blank.", "venuemich000008", false],
    ["CEBO", 1, "Carrera de San Jerónimo 34, 28014 Madrid", 40.4164051, -3.6985954, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5287401621 (“Cebo”, casing variant) matches the Madrid-city address.", "venuemich000009", false],
    ["EMi", 1, "Calle de Gaztambide 64, 28015 Madrid", 40.4388461, -3.7151504, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM node 4109999608 is the house/address geometry at Gaztambide 64; no named OSM restaurant object exists for EMi (only an unrelated hairdresser matches the short name).", "venueseed000006", true],
    ["Gofio", 1, "Calle del Caballero de Gracia 20, 28013 Madrid", 40.4193287, -3.7001659, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 12853998829 (“Gofio”) at Caballero de Gracia 20 identifies the current premises; an older duplicate node on another street was treated as stale.", "venuemich000010", false],
    ["Ricardo Sanz Wellington", 1, "Calle de Velázquez 6, 28001 Madrid", 40.4217715, -3.6841825, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM node 3507803788 sits at Velázquez 6 (Hotel Wellington address); no OSM object carries the restaurant’s current name.", "venuemich000011", false],
    ["Clos Madrid", 1, "Calle de Raimundo Fernández Villaverde 28, 28003 Madrid", 40.4461649, -3.6995359, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 5903073286 (“Clos”) matches the Madrid-city address.", "venuemich000012", false],
    ["Gaytán", 1, "Calle del Príncipe de Vergara 205, 28002 Madrid", 40.4498245, -3.6783597, "openstreetmap-nominatim", "osm_verified", "Two nearby OSM nodes share this name on the same street; the house-numbered node 4697273417 at Príncipe de Vergara 205 was selected.", "venuemich000013", false],
    ["Corral de la Morería Gastronómico", 1, "Calle de la Morería 17, Madrid", 40.4127418, -3.7141548, "openstreetmap-nominatim", "osm_verified", "OSM music_venue node 2697521933 (“Corral de la Morería”) locates the venue that houses the gastronomic dining room.", "venuemich000014", false],
    ["Toki", 1, "Calle de Sagasta 28, 28004 Madrid", 40.4278666, -3.6974121, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM address node 12921810066 at Sagasta 28; no named OSM restaurant object exists for Toki.", "venuemich000015", false],
    ["Chispa Bistró", 1, "Calle del Barquillo 8, 28004 Madrid", 40.4201745, -3.6955599, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 4157495190 (“Chispa”) at Barquillo 8 matches the venue at its published address.", "venuemich000016", false],
    ["VelascoAbellà", 1, "Calle de Víctor Andrés Belaúnde 25, 28016 Madrid", 40.4562704, -3.6799191, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM address node 9997833548 at Víctor Andrés Belaúnde 25; no named OSM restaurant object exists for VelascoAbellà.", "venuemich000017", false],
    ["RavioXO", 1, "Plaza de Manuel Gómez-Moreno 5A, 28020 Madrid", 40.448202, -3.6945471, "openstreetmap-nominatim", "osm_approximate", "Approximate pin: OSM way 891287353 is the plaza footway at Manuel Gómez-Moreno, not the exact venue entrance; treated as a location approximation, not an OSM venue or address match.", "venuemich000018", false],
    ["Desde 1911", 1, "Calle del Vivero, 28003 Madrid", 40.4484519, -3.7099045, "openstreetmap-nominatim", "osm_verified", "OSM restaurant node 12444507960 matches name; OSM address lacks a house number so the street-level address is recorded as-is.", "venuemich000019", false],
    ["Ugo Chan", 1, "Calle de Félix Boix 6, 28036 Madrid", 40.4632356, -3.6883724, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM node 4229665290 is an unnamed generic restaurant at Félix Boix 6 (same address); venue identity is not tagged in OSM so this is not asserted as a named match.", "venueseed000016", true],
    ["Sen Omakase", 1, "Calle de Santa María Magdalena 14, 28016 Madrid", 40.462182, -3.6701079, "openstreetmap-nominatim", "osm_address_verified", "Address-level pin: OSM node 597380752 sits at Santa María Magdalena 14 but is currently tagged as “Popa”, so only the address is verified, not the venue identity.", "venuemich000020", false],
  ];

  // Guía Repsol 2026 raw source assertions (from the two already-imported
  // CSVs; both carry no address/coordinate columns):
  // [name, sol_level, cohort(1=new-Sol pages, 2=continuing booklet), canonical_venue_id, shared_with_michelin]
  const REPSOL = [
    ["Ramón Freixa Atelier", 3, 1, "venueseed000001", true],
    ["Bascoat", 2, 1, "venueseed000002", false],
    ["Smoked Room", 2, 1, "venueseed000003", true],
    ["Bancal", 1, 1, "venueseed000004", false],
    ["Desborre", 1, 1, "venueseed000005", false],
    ["EMi", 1, 1, "venueseed000006", true],
    ["Los 33", 1, 1, "venueseed000007", false],
    ["Otoro Jukusei", 1, 1, "venueseed000008", false],
    ["Ramón Freixa Tradición", 1, 1, "venueseed000009", false],
    ["Trèsde", 1, 1, "venueseed000010", false],
    ["Coque", 3, 2, "venueseed000011", true],
    ["DiverXO", 3, 2, "venueseed000012", true],
    ["DSTAgE", 3, 2, "venueseed000013", true],
    ["Deessa", 2, 2, "venueseed000014", true],
    ["Saddle", 2, 2, "venueseed000015", true],
    ["Ugo Chan", 2, 2, "venueseed000016", true],
    ["A'Barra", 1, 2, "venueseed000017", true],
    ["Alabaster", 1, 2, "venueseed000018", false],
    ["Fismuler", 1, 2, "venueseed000019", false],
    ["La Catapa", 1, 2, "venueseed000020", false],
  ];

  // Exact-match evidence, verbatim from data/madrid-2026-unified-venues.json,
  // for every venue shared by both guides (inspectable on each shared entry).
  const MATCH_EVIDENCE = {
    "A'Barra": "Normalized full names are identical ('a'barra') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Coque": "Normalized full names are identical ('coque') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Deessa": "Normalized full names are identical ('deessa') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "DiverXO": "Normalized full names are identical ('diverxo') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "DSTAgE": "Normalized full names are identical ('dstage') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "EMi": "Normalized full names are identical ('emi') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Ramón Freixa Atelier": "Normalized full names are identical ('ramón freixa atelier') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Saddle": "Normalized full names are identical ('saddle') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Smoked Room": "Normalized full names are identical ('smoked room') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
    "Ugo Chan": "Normalized full names are identical ('ugo chan') and unique one-to-one across both sources within the Madrid/Spain/2026 block.",
  };
  const SINGLE_MICH = "Michelin-only within the Madrid/Spain/2026 block: no exact normalized full-name match among Guía Repsol 2026 entries (no fuzzy merge attempted).";
  const SINGLE_REPSOL = "Guía Repsol-only within the Madrid/Spain/2026 block: no exact normalized full-name match among Michelin Guide 2026 entries (no fuzzy merge attempted).";

  const starLevel = (n) => (n === 1 ? "1 Star" : n + " Stars");
  const starDistinction = (n) => (n === 3 ? "three-stars" : n === 2 ? "two-stars" : "one-star");
  const solLevel = (n) => (n === 1 ? "1 Sol" : n + " Soles");
  const michUrl = (n) => (n === 3 ? MICH_URL_3 : n === 2 ? MICH_URL_2 : MICH_URL_1);
  const michAwardId = (i) => "awardmich0000" + String(i + 1).padStart(2, "0");
  const vseMichId = (i) => "vsemichelin00" + String(i + 1).padStart(2, "0");
  const vseRepsolId = (i) => "vserepsol0000" + String(i + 1).padStart(2, "0");

  // ---------- 20 Michelin-only canonical venues (bulk, idempotent) ----------
  // Existing Repsol canonical rows are NOT updated: their verified
  // address/coordinate data is preserved; Michelin's raw address/coordinates
  // live in the source entries below.
  {
    const rows = MICH.filter((r) => !r[9]);
    const params = { now: NOW };
    const values = rows.map((r, i) => {
      params["id" + i] = r[8];
      params["name" + i] = r[0];
      params["addr" + i] = r[2];
      params["lat" + i] = r[3] === null ? 0 : r[3];
      params["lng" + i] = r[4] === null ? 0 : r[4];
      params["note" + i] =
        r[3] === null
          ? "No verified coordinates in the Michelin 2026 import (0/0 is a sentinel, not a pin). " + r[6] + "."
          : "Michelin 2026 import coordinates (" + r[5] + ", " + r[6] + ").";
      return (
        "({:id" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', {:addr" + i + "}, {:lat" + i +
        "}, {:lng" + i + "}, '', '', {:note" + i + "}, {:now}, {:now})"
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

  // ---------- 30 Michelin venue_awards (bulk, idempotent) ----------
  {
    const params = { src: MICH_SOURCE_ID, imp: MICH_IMPORT_ID, now: NOW };
    const values = MICH.map((r, i) => {
      params["id" + i] = michAwardId(i);
      params["venue" + i] = r[8];
      params["level" + i] = starLevel(r[1]);
      params["url" + i] = michUrl(r[1]);
      params["srcrec" + i] = SRCREC_MICH[r[1]];
      // Award note stays within the 300-char field limit.
      params["note" + i] = String(r[7]).slice(0, 300);
      return (
        "({:id" + i + "}, {:src}, {:venue" + i + "}, 2026, {:level" + i + "}, {:url" + i +
        "}, TRUE, {:note" + i + "}, {:srcrec" + i + "}, {:imp}, 'verified', {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_awards (id, source, venue, year, level, source_url, current, verification_note, source_record, import, verification_status, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }

  // ---------- 50 venue_source_entries (bulk, idempotent, chunked) ----------
  const VSE_COLS =
    "INSERT OR IGNORE INTO venue_source_entries (id, source, source_record, import, venue, source_venue_name, locality, country, " +
    "guide_year, distinction, distinction_level, source_url, source_type, source_published_or_updated_at, source_accessed_at, " +
    "award_validation_status, validation_evidence, street_address, latitude, longitude, coordinate_source, coordinate_validation_status, " +
    "match_method, match_evidence, created, updated) VALUES ";
  const insertEntries = (entryRows) => {
    // Chunked bulk inserts keep bind-parameter counts small while avoiding
    // per-row writes.
    for (let off = 0; off < entryRows.length; off += 10) {
      const chunk = entryRows.slice(off, off + 10);
      const params = { now: NOW };
      const values = chunk.map((e, i) => {
        for (const k of Object.keys(e)) params[k + i] = e[k];
        return (
          "({:id" + i + "}, {:src" + i + "}, {:srcrec" + i + "}, {:imp" + i + "}, {:venue" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', " +
          "2026, {:dist" + i + "}, {:lvl" + i + "}, {:url" + i + "}, {:stype" + i + "}, {:pub" + i + "}, {:acc" + i + "}, " +
          "{:aval" + i + "}, {:vev" + i + "}, {:addr" + i + "}, {:lat" + i + "}, {:lng" + i + "}, {:csrc" + i + "}, {:cval" + i + "}, " +
          "{:mm" + i + "}, {:mev" + i + "}, {:now}, {:now})"
        );
      });
      app.db().newQuery(VSE_COLS + values.join(", ")).bind(params).execute();
    }
  };

  // 20 Repsol raw assertions (no address/coordinates in either Repsol CSV:
  // street_address '', 0/0 sentinel, coordinate_validation_status 'not_provided').
  insertEntries(
    REPSOL.map((r, i) => {
      const [name, lvl, cohort, venueId, sharedFlag] = r;
      const isNew = cohort === 1;
      return {
        id: vseRepsolId(i),
        src: REPSOL_SOURCE_ID,
        srcrec: isNew ? (lvl === 3 ? SRCREC_3SOL : lvl === 2 ? SRCREC_2SOL : SRCREC_1SOL) : SRCREC_BOOKLET,
        imp: isNew ? IMP_REPSOL_NEW : IMP_REPSOL_CONT,
        venue: venueId,
        name: name,
        dist: solLevel(lvl),
        lvl: lvl,
        url: isNew ? (lvl === 3 ? PAGE_3SOL : lvl === 2 ? PAGE_2SOL : PAGE_1SOL) : BOOKLET_URL,
        stype: isNew ? "award-level-page" : "digital-booklet",
        pub: isNew ? REPSOL_PUBLISHED : "",
        acc: ACCESSED,
        aval: "verified",
        vev: isNew
          ? "Name; Sol level; 2026 year and Madrid locality supported by the official 2026 " + (lvl === 3 ? "three" : lvl === 2 ? "two" : "one") + "-Sol award page."
          : "Exact name; Sol level; Madrid locality checked in the official 2026 booklet (printed listing pages 90-91).",
        addr: "",
        lat: 0,
        lng: 0,
        csrc: "",
        cval: "not_provided",
        mm: sharedFlag ? "exact-normalized-full-name" : "single-source",
        mev: sharedFlag ? MATCH_EVIDENCE[name] : SINGLE_REPSOL,
      };
    })
  );

  // 30 Michelin raw assertions (address/coordinates exactly as in the CSV).
  insertEntries(
    MICH.map((r, i) => {
      const [name, stars, addr, lat, lng, csrc, cval, note, venueId, sharedFlag] = r;
      return {
        id: vseMichId(i),
        src: MICH_SOURCE_ID,
        srcrec: SRCREC_MICH[stars],
        imp: MICH_IMPORT_ID,
        venue: venueId,
        name: name,
        dist: starDistinction(stars),
        lvl: stars,
        url: michUrl(stars),
        stype: "official-category-listing",
        pub: "",
        acc: ACCESSED,
        aval: "verified",
        vev: note,
        addr: addr,
        lat: lat === null ? 0 : lat,
        lng: lng === null ? 0 : lng,
        csrc: csrc,
        cval: cval,
        mm: sharedFlag ? "exact-normalized-full-name" : "single-source",
        mev: sharedFlag ? MATCH_EVIDENCE[name] : SINGLE_MICH,
      };
    })
  );
}, () => {
  // Forward-only: shipped multi-source data is corrected in later migrations.
  return null;
});

/// <reference path="../pb_data/types.d.ts" />
//
// Normalizes provenance for the Madrid Guía Repsol 2026 "new Sols" seed.
//
// - Adds `source_records`: record-level official source surfaces (the three
//   2026 award-level pages: 3 Soles, 2 Soles, 1 Sol).
// - Adds `import_provenance`: one row describing this verified CSV import
//   (data/guia-repsol-2026-madrid-new-sol-cohort.csv — values inlined here,
//   the file itself is not read at runtime).
// - Extends `venue_awards` with `source_record` and `import` relations and a
//   `verification_status` field, linking every 2026 award to its exact
//   official page and to this import.
// - Seeds/repairs the 10 verified venues + awards whether or not the legacy
//   migration (1767970000) already inserted them, reusing the same
//   deterministic 15-char ids so both paths converge.
// - Clears enrichment the verified CSV does not support (address, category,
//   venue official_url) from the legacy seed rows. The lat/lng columns are
//   NOT NULL NumberFields, so they are reset to the schema's neutral zero
//   sentinel (0 is not a verified map pin) and coord_verification_note
//   records that no coordinates were verified in this seed.
// - Marks exactly these 10 awards as the current 2026 cohort.
//
// Forward-only. Every statement is INSERT OR IGNORE or an idempotent UPDATE,
// and all collection/index work is guarded, so a rerun after a partial
// failure is safe and converges.
migrate((app) => {
  const NOW = "2026-01-09 00:00:00.000Z";
  const SOURCE_ID = "gsrepsol0000001"; // legacy deterministic guide_sources id
  const IMPORT_ID = "impguia20260001"; // deterministic 15-char id
  const PUBLISHED = "2026-02-16 00:00:00.000Z"; // CSV source_published_or_updated_at
  const ACCESSED = "2026-07-12 00:00:00.000Z"; // CSV source_accessed_at

  // The three official award-level pages from the verified CSV.
  const PAGE_3SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevo-restaurante-3-soles-guia-repsol/";
  const PAGE_2SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-2-soles-guia-repsol/";
  const PAGE_1SOL = "https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-un-sol-guia-repsol/";
  const SRCREC_3SOL = "srcrec20260sol3"; // deterministic 15-char ids
  const SRCREC_2SOL = "srcrec20260sol2";
  const SRCREC_1SOL = "srcrec20260sol1";

  // ---------- ensure guide_sources exists (legacy may not have run) ----------
  let sources;
  try {
    sources = app.findCollectionByNameOrId("guide_sources");
  } catch {
    sources = new Collection({ name: "guide_sources", type: "base" });
    sources.fields = [
      new TextField({ name: "name", required: true, max: 160 }),
      new TextField({ name: "slug", required: true, max: 120 }),
      new URLField({ name: "official_url" }),
      new NumberField({ name: "current_year", onlyInt: true, min: 2000, max: 2100 }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ];
    sources.indexes = [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_guide_sources_slug ON guide_sources (slug)",
    ];
    sources.listRule = "";
    sources.viewRule = "";
    sources.createRule = null;
    sources.updateRule = null;
    sources.deleteRule = null;
    app.save(sources);
  }

  // ---------- ensure venues exists (legacy may not have run) ----------
  let venues;
  try {
    venues = app.findCollectionByNameOrId("venues");
  } catch {
    venues = new Collection({ name: "venues", type: "base" });
    venues.fields = [
      new TextField({ name: "name", required: true, max: 200 }),
      new TextField({ name: "city", required: true, max: 120 }),
      new TextField({ name: "country", required: true, max: 120 }),
      new TextField({ name: "address", max: 300 }),
      new NumberField({ name: "lat", min: -90, max: 90 }),
      new NumberField({ name: "lng", min: -180, max: 180 }),
      new TextField({ name: "category", max: 120 }),
      new URLField({ name: "official_url" }),
      new TextField({ name: "coord_verification_note", max: 300 }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ];
    venues.indexes = [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name_city ON venues (name, city)",
      "CREATE INDEX IF NOT EXISTS idx_venues_city ON venues (city)",
    ];
    venues.listRule = "";
    venues.viewRule = "";
    venues.createRule = null;
    venues.updateRule = null;
    venues.deleteRule = null;
    app.save(venues);
  }

  // ---------- source_records: record-level official source surfaces ----------
  let srcRecs;
  try {
    srcRecs = app.findCollectionByNameOrId("source_records");
  } catch {
    srcRecs = new Collection({ name: "source_records", type: "base" });
  }
  srcRecs.fields = [
    new RelationField({
      name: "source",
      required: true,
      collectionId: sources.id,
      maxSelect: 1,
      cascadeDelete: false,
    }),
    new TextField({ name: "title", max: 200 }),
    new URLField({ name: "url", required: true }),
    new TextField({ name: "source_type", required: true, max: 60 }),
    new DateField({ name: "published_or_updated_at" }),
    new DateField({ name: "accessed_at" }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];
  srcRecs.indexes = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_source_records_url ON source_records (url)",
  ];
  // Public read only; all writes denied.
  srcRecs.listRule = "";
  srcRecs.viewRule = "";
  srcRecs.createRule = null;
  srcRecs.updateRule = null;
  srcRecs.deleteRule = null;
  app.save(srcRecs);

  // ---------- import_provenance: one row per seed import ----------
  let imports;
  try {
    imports = app.findCollectionByNameOrId("import_provenance");
  } catch {
    imports = new Collection({ name: "import_provenance", type: "base" });
  }
  imports.fields = [
    new TextField({ name: "import_key", required: true, max: 160 }),
    new TextField({ name: "dataset", required: true, max: 300 }),
    new TextField({ name: "description", max: 500 }),
    new RelationField({
      name: "source",
      collectionId: sources.id,
      maxSelect: 1,
      cascadeDelete: false,
    }),
    new NumberField({ name: "record_count", onlyInt: true, min: 0 }),
    new SelectField({
      name: "verification_status",
      maxSelect: 1,
      values: ["verified", "unverified"],
    }),
    new DateField({ name: "imported_at" }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];
  imports.indexes = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_import_provenance_key ON import_provenance (import_key)",
  ];
  // Public read only; all writes denied.
  imports.listRule = "";
  imports.viewRule = "";
  imports.createRule = null;
  imports.updateRule = null;
  imports.deleteRule = null;
  app.save(imports);

  // ---------- extend venue_awards with provenance links ----------
  let awards;
  try {
    awards = app.findCollectionByNameOrId("venue_awards");
  } catch {
    awards = new Collection({ name: "venue_awards", type: "base" });
  }
  // Rebuild the full field list (idempotent) preserving the legacy fields and
  // adding source_record / import / verification_status.
  awards.fields = [
    new RelationField({
      name: "source",
      required: true,
      collectionId: sources.id,
      maxSelect: 1,
      cascadeDelete: false,
    }),
    new RelationField({
      name: "venue",
      required: true,
      collectionId: venues.id,
      maxSelect: 1,
      cascadeDelete: true,
    }),
    new NumberField({ name: "year", required: true, onlyInt: true, min: 2000, max: 2100 }),
    new TextField({ name: "level", required: true, max: 120 }),
    new NumberField({ name: "rank", onlyInt: true, min: 0 }),
    new URLField({ name: "source_url" }),
    new BoolField({ name: "current" }),
    new TextField({ name: "verification_note", max: 300 }),
    // New: link to the exact official page the award was verified against.
    new RelationField({
      name: "source_record",
      collectionId: srcRecs.id,
      maxSelect: 1,
      cascadeDelete: false,
    }),
    // New: link to the import that produced/verified this row.
    new RelationField({
      name: "import",
      collectionId: imports.id,
      maxSelect: 1,
      cascadeDelete: false,
    }),
    new SelectField({
      name: "verification_status",
      maxSelect: 1,
      values: ["verified", "unverified"],
    }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ];
  awards.indexes = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_awards_unique ON venue_awards (source, venue, year, level)",
    "CREATE INDEX IF NOT EXISTS idx_venue_awards_year ON venue_awards (year)",
  ];
  awards.listRule = "";
  awards.viewRule = "";
  awards.createRule = null;
  awards.updateRule = null;
  awards.deleteRule = null;
  app.save(awards);

  // ---------- seed data (bulk, idempotent) ----------

  // Verified CSV rows (data/guia-repsol-2026-madrid-new-sol-cohort.csv):
  // [venue_name, sol_level, source_record_id, verification_note]
  const NOTE = (lvl) =>
    "Name; Sol level; 2026 year and Madrid locality supported by the official 2026 " + lvl + " award page.";
  const seed = [
    ["Ramón Freixa Atelier", 3, SRCREC_3SOL, NOTE("three-Sol")],
    ["Bascoat", 2, SRCREC_2SOL, NOTE("two-Sol")],
    ["Smoked Room", 2, SRCREC_2SOL, NOTE("two-Sol")],
    ["Bancal", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["Desborre", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["EMi", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["Los 33", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["Otoro Jukusei", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["Ramón Freixa Tradición", 1, SRCREC_1SOL, NOTE("one-Sol")],
    ["Trèsde", 1, SRCREC_1SOL, NOTE("one-Sol")],
  ];
  // Level labels consistent with the legacy migration so the unique index
  // (source, venue, year, level) matches whether or not legacy already ran.
  const levelLabel = (n) => (n === 1 ? "1 Sol" : n + " Soles");
  // Same deterministic 15-char ids as the legacy migration.
  const venueId = (i) => "venueseed0000" + String(i + 1).padStart(2, "0");
  const awardId = (i) => "awardseed0000" + String(i + 1).padStart(2, "0");

  // 1) Guide source row (no-op when the legacy seed already inserted it).
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, 'Guía Repsol', 'guia-repsol', 'https://www.guiarepsol.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: SOURCE_ID, now: NOW })
    .execute();

  // 2) The three official award-level source surfaces (one bulk insert).
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
        "({:id3}, {:src}, 'Guía Repsol 2026 — new 3 Soles restaurants', {:url3}, 'award-level-page', {:pub}, {:acc}, {:now}, {:now}), " +
        "({:id2}, {:src}, 'Guía Repsol 2026 — new 2 Soles restaurants', {:url2}, 'award-level-page', {:pub}, {:acc}, {:now}, {:now}), " +
        "({:id1}, {:src}, 'Guía Repsol 2026 — new 1 Sol restaurants', {:url1}, 'award-level-page', {:pub}, {:acc}, {:now}, {:now})"
    )
    .bind({
      id3: SRCREC_3SOL,
      id2: SRCREC_2SOL,
      id1: SRCREC_1SOL,
      url3: PAGE_3SOL,
      url2: PAGE_2SOL,
      url1: PAGE_1SOL,
      src: SOURCE_ID,
      pub: PUBLISHED,
      acc: ACCESSED,
      now: NOW,
    })
    .execute();

  // 3) Provenance row for this CSV import.
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) " +
        "VALUES ({:id}, 'guia-repsol-2026-madrid-new-sol-cohort', 'data/guia-repsol-2026-madrid-new-sol-cohort.csv', " +
        "'Verified seed of the 10 Madrid venues newly awarded Soles in Guía Repsol 2026, checked against the official award-level pages.', " +
        "{:src}, 10, 'verified', {:acc}, {:now}, {:now})"
    )
    .bind({ id: IMPORT_ID, src: SOURCE_ID, acc: ACCESSED, now: NOW })
    .execute();

  // 4) Venues: insert missing rows with CSV-supported fields only
  //    (name, Madrid, Spain). No-op where the legacy seed already inserted.
  {
    const params = { now: NOW };
    const rows = seed.map((r, i) => {
      params["id" + i] = venueId(i);
      params["name" + i] = r[0];
      return "({:id" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', {:now}, {:now})";
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venues (id, name, city, country, created, updated) VALUES " +
          rows.join(", ")
      )
      .bind(params)
      .execute();
  }

  // 5) Clear enrichment the verified CSV does not support from the seed
  //    venues (legacy inserted address, coordinates, category, venue URL,
  //    coord note; the verified dataset intentionally leaves them blank).
  //    lat/lng are NOT NULL numeric columns, so instead of NULL they are set
  //    to the schema's neutral zero sentinel — 0/0 here means "no verified
  //    coordinates", not a geographic point — and coord_verification_note
  //    states that explicitly for future consumers.
  {
    const params = { now: NOW };
    const ids = seed.map((_, i) => {
      params["v" + i] = venueId(i);
      return "{:v" + i + "}";
    });
    app
      .db()
      .newQuery(
        "UPDATE venues SET address = '', lat = 0, lng = 0, category = '', official_url = '', " +
          "coord_verification_note = 'No coordinates verified in this seed.', updated = {:now} " +
          "WHERE id IN (" + ids.join(", ") + ")"
      )
      .bind(params)
      .execute();
  }

  // 6) Awards: insert missing rows (same deterministic ids/levels as legacy).
  {
    const params = { now: NOW, src: SOURCE_ID, imp: IMPORT_ID };
    const rows = seed.map((r, i) => {
      params["id" + i] = awardId(i);
      params["venue" + i] = venueId(i);
      params["level" + i] = levelLabel(r[1]);
      params["srcrec" + i] = r[2];
      params["url" + i] = r[2] === SRCREC_3SOL ? PAGE_3SOL : r[2] === SRCREC_2SOL ? PAGE_2SOL : PAGE_1SOL;
      params["note" + i] = r[3];
      return (
        "({:id" + i + "}, {:src}, {:venue" + i + "}, 2026, {:level" + i + "}, {:url" + i +
        "}, TRUE, {:note" + i + "}, {:srcrec" + i + "}, {:imp}, 'verified', {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_awards (id, source, venue, year, level, source_url, current, verification_note, source_record, import, verification_status, created, updated) VALUES " +
          rows.join(", ")
      )
      .bind(params)
      .execute();
  }

  // 7) Repair pre-existing legacy award rows: point source_url at the exact
  //    award-level page, link source_record/import, set verified + note.
  //    Batched as one UPDATE per source surface (3 statements total).
  const groups = [
    [SRCREC_3SOL, PAGE_3SOL],
    [SRCREC_2SOL, PAGE_2SOL],
    [SRCREC_1SOL, PAGE_1SOL],
  ];
  for (const [srcRecId, pageUrl] of groups) {
    const params = { srcrec: srcRecId, url: pageUrl, imp: IMPORT_ID, now: NOW };
    const idRefs = [];
    seed.forEach((r, i) => {
      if (r[2] !== srcRecId) return;
      params["a" + i] = awardId(i);
      params["n" + i] = r[3];
      idRefs.push("{:a" + i + "}");
    });
    // Per-award verification_note via CASE keeps this to one statement.
    const noteCase =
      "CASE id " +
      seed
        .map((r, i) => (r[2] === srcRecId ? "WHEN {:a" + i + "} THEN {:n" + i + "} " : ""))
        .join("") +
      "ELSE verification_note END";
    app
      .db()
      .newQuery(
        "UPDATE venue_awards SET source_url = {:url}, source_record = {:srcrec}, import = {:imp}, " +
          "verification_status = 'verified', current = TRUE, verification_note = " + noteCase + ", updated = {:now} " +
          "WHERE id IN (" + idRefs.join(", ") + ")"
      )
      .bind(params)
      .execute();
  }

  // 8) Exactly these 10 rows form the current 2026 cohort: demote any other
  //    2026 Guía Repsol award rows that may exist (non-destructive).
  {
    const params = { src: SOURCE_ID, now: NOW };
    const ids = seed.map((_, i) => {
      params["a" + i] = awardId(i);
      return "{:a" + i + "}";
    });
    app
      .db()
      .newQuery(
        "UPDATE venue_awards SET current = FALSE, updated = {:now} " +
          "WHERE source = {:src} AND year = 2026 AND current = TRUE AND id NOT IN (" + ids.join(", ") + ")"
      )
      .bind(params)
      .execute();
  }
}, (app) => {
  // Forward-only migration: no down path. Corrections to shipped data must be
  // made in a new migration with a later timestamp.
});

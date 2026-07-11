/// <reference path="../pb_data/types.d.ts" />
//
// Creates public-read collections for source-driven food discovery:
// venues, guide_sources, venue_awards — and seeds the 10 verified
// Madrid Guía Repsol 2026 venues. Fully idempotent: safe to re-run
// after a partial failure and a no-op when data already exists.
migrate((app) => {
  // ---------- guide_sources ----------
  let sources;
  try {
    sources = app.findCollectionByNameOrId("guide_sources");
  } catch {
    sources = new Collection({ name: "guide_sources", type: "base" });
  }
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

  // ---------- venues ----------
  let venues;
  try {
    venues = app.findCollectionByNameOrId("venues");
  } catch {
    venues = new Collection({ name: "venues", type: "base" });
  }
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

  // ---------- venue_awards ----------
  let awards;
  try {
    awards = app.findCollectionByNameOrId("venue_awards");
  } catch {
    awards = new Collection({ name: "venue_awards", type: "base" });
  }
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

  // ---------- seed (fast, idempotent, bulk) ----------
  // Bulk multi-row INSERT OR IGNORE with deterministic 15-char ids.
  // Unique indexes (guide_sources.slug, venues (name,city),
  // venue_awards (source,venue,year,level)) plus the fixed ids make every
  // statement converge on rerun after a partial failure: existing rows are
  // ignored, missing rows are filled in, and no duplicates are possible.
  const SOURCE_URL =
    "https://www.guiarepsol.com/es/soles-repsol/soles-2026/listado-de-nuevos-restaurantes-con-soles-guia-repsol-2026/";
  const NOW = "2026-01-09 00:00:00.000Z";
  const SOURCE_ID = "gsrepsol0000001"; // deterministic 15-char id

  // [name, address, lat, lng, level, url, note, category]
  const seed = [
    ["Ramón Freixa Atelier", "Calle de Velázquez 24, 28001 Madrid", 40.4242034, -3.6840318, "3 Soles", "https://ramonfreixaatelier.com/en/contact", "Coordinates exact.", "Fine dining"],
    ["Bascoat", "Paseo de la Habana 33, 28036 Madrid", 40.4530399, -3.6851204, "2 Soles", "https://www.bascoatmadrid.com/", "Coordinates exact.", "Fine dining"],
    ["Smoked Room", "Paseo de la Castellana 57, 28046 Madrid", 40.4388252, -3.6917467, "2 Soles", "https://smokedroomrestaurants.com/en/madrid/faqs/", "Coordinates are building centroid.", "Fine dining"],
    ["Bancal", "Calle de Serrano 95, 28006 Madrid", 40.4381489, -3.6866899, "1 Sol", "https://www.guiarepsol.com/es/fichas/restaurante/bancal-331533/", "Coordinates at building address.", "Fine dining"],
    ["Desborre", "Calle de la Unión 8, 28013 Madrid", 40.4175734, -3.7104434, "1 Sol", "https://desborre.es", "Coordinates exact address.", "Fine dining"],
    ["EMi", "Calle de Gaztambide 64, 28015 Madrid", 40.4388461, -3.7151504, "1 Sol", "", "Coordinates exact address; address corroborated by press.", "Fine dining"],
    ["Los 33", "Plaza de las Salesas 9, 28004 Madrid", 40.4238621, -3.6948322, "1 Sol", "https://los33.net/", "Coordinates exact.", "Fine dining"],
    ["Otoro Jukusei", "Calle de Fernández de la Hoz 35, 28010 Madrid", 40.4339, -3.6949, "1 Sol", "https://otoromadrid.es", "Coordinates approximate street-level; require manual pin verification.", "Fine dining"],
    ["Ramón Freixa Tradición", "Calle de Velázquez 24, 28001 Madrid", 40.4242034, -3.6840318, "1 Sol", "https://ramonfreixatradicion.com/en/contact", "Coordinates exact; shared location.", "Fine dining"],
    ["Trèsde", "Calle de la Cava Alta 17, 28005 Madrid", 40.4121178, -3.7092308, "1 Sol", "https://www.tresderestaurante.com/", "Coordinates exact.", "Fine dining"],
  ];

  // Deterministic venue ids: venueseed000001 .. venueseed000010 (15 chars).
  const venueId = (i) => "venueseed0000" + String(i + 1).padStart(2, "0");
  const awardId = (i) => "awardseed0000" + String(i + 1).padStart(2, "0");

  // 1) guide source (single-row bulk insert, ignored when already present)
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, {:name}, {:slug}, {:url}, {:year}, {:now}, {:now})"
    )
    .bind({
      id: SOURCE_ID,
      name: "Guía Repsol",
      slug: "guia-repsol",
      url: "https://www.guiarepsol.com/",
      year: 2026,
      now: NOW,
    })
    .execute();

  // 2) venues: one batched multi-row insert
  {
    const params = { now: NOW };
    const rows = seed.map((r, i) => {
      params["id" + i] = venueId(i);
      params["name" + i] = r[0];
      params["addr" + i] = r[1];
      params["lat" + i] = r[2];
      params["lng" + i] = r[3];
      params["url" + i] = r[5];
      params["note" + i] = r[6];
      params["cat" + i] = r[7];
      return (
        "({:id" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', {:addr" + i +
        "}, {:lat" + i + "}, {:lng" + i + "}, {:cat" + i + "}, {:url" + i +
        "}, {:note" + i + "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venues (id, name, city, country, address, lat, lng, category, official_url, coord_verification_note, created, updated) VALUES " +
          rows.join(", ")
      )
      .bind(params)
      .execute();
  }

  // 3) venue awards: one batched multi-row insert
  {
    const params = { now: NOW, src: SOURCE_ID, srcUrl: SOURCE_URL };
    const rows = seed.map((r, i) => {
      params["id" + i] = awardId(i);
      params["venue" + i] = venueId(i);
      params["level" + i] = r[4];
      params["note" + i] = r[6];
      return (
        "({:id" + i + "}, {:src}, {:venue" + i + "}, 2026, {:level" + i +
        "}, 0, {:srcUrl}, TRUE, {:note" + i + "}, {:now}, {:now})"
      );
    });
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO venue_awards (id, source, venue, year, level, rank, source_url, current, verification_note, created, updated) VALUES " +
          rows.join(", ")
      )
      .bind(params)
      .execute();
  }
}, (app) => {
  for (const name of ["venue_awards", "venues", "guide_sources"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      app.delete(c);
    } catch {
      // already gone
    }
  }
});

/// <reference path="../pb_data/types.d.ts" />
//
// Michelin Guide California 2026 — verified San Francisco two- and three-star seed.
//
// This is a forward-only, retry-safe import of the ten record-level source
// assertions approved in docs/san-francisco-source-rights-and-curation-plan.md.
// The MICHELIN record establishes the award assertion and venue address; the
// coordinate qualifier separately records the OpenStreetMap/Nominatim basis.
// Every mutation uses deterministic ids and INSERT OR IGNORE, so a partial
// migration converges on its next attempt without duplicate rows.
migrate((app) => {
  const NOW = "2026-07-14 00:00:00.000Z";
  const ACCESSED = "2026-07-14 00:00:00.000Z";
  const EDITION_PUBLISHED = "2026-06-24 00:00:00.000Z";
  const EDITION_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california";
  const SOURCE_SEED_ID = "gsmichelin00001";
  const EDITION_RECORD_SEED_ID = "srcsf2026ann001";
  const IMPORT_SEED_ID = "impsf2026mich01";

  // [source spelling, stars, address, lat, lng, individual MICHELIN record,
  //  operator URL, coordinate status, location note]
  const rows = [
    ["Quince", 3, "470 Pacific Ave., San Francisco, CA, 94133, USA", 37.7974316, -122.4032686, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/quince", "https://www.quincerestaurant.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM way 224384020 provides exact-address geometry, not a named venue match."],
    ["Californios", 3, "355 11th St., San Francisco, CA, 94103, USA", 37.7712823, -122.4130526, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/californios", "https://www.californiossf.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM node 1806978712 is at the exact address but is currently tagged Bar Agricole, so this is address-level only."],
    ["Benu", 3, "22 Hawthorne St., San Francisco, CA, 94105, USA", 37.7854624, -122.3990798, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/benu", "https://www.benusf.com/", "osm_verified", "MICHELIN record confirms the venue and address; named OSM restaurant node 4436674292 matches Benu at the address."],
    ["Atelier Crenn", 3, "3127 Fillmore St., San Francisco, CA, 94123, USA", 37.7983224, -122.4358440, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/atelier-crenn", "https://www.ateliercrenn.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM way 85562546 provides exact-address geometry, not a named venue match."],
    ["Acquerello", 2, "1722 Sacramento St., San Francisco, CA, 94109, USA", 37.7916954, -122.4215252, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/acquerello", "https://www.acquerellosf.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM way 259115270 provides address/building geometry, not a named venue match."],
    ["Kiln", 2, "149 Fell St., San Francisco, CA, 94102, USA", 37.7760076, -122.4203817, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/kiln-1210355", "https://www.kilnsf.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM way 172111618 provides address/building geometry, not a named venue match."],
    ["Lazy Bear", 2, "3416 19th St., San Francisco, CA, 94110, USA", 37.7603171, -122.4197672, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/lazy-bear", "https://www.lazybearsf.com/contact-info/", "osm_verified", "Operator contact page and MICHELIN record confirm the address; named OSM restaurant node 4534868891 matches Lazy Bear."],
    ["Sons & Daughters", 2, "2875 18th St., San Francisco, CA, 94110, USA", 37.7616681, -122.4107535, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/sons-daughters", "https://www.sonsanddaughterssf.com/", "osm_address_verified", "MICHELIN record confirms the venue and address; OSM node 10636048961 is at the exact address but currently named Osito, so this is address-level only."],
    ["Saison", 2, "178 Townsend St., San Francisco, CA, 94107, USA", 37.7732540, -122.3998717, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/saison", "https://saisonsf.com/contact/", "osm_address_verified", "Operator contact page and MICHELIN record confirm the address; OSM way 442572411 supplies street geometry covering the address, not a named venue match."],
    ["Birdsong", 2, "1085 Mission St., San Francisco, CA, 94103, USA", 37.7794363, -122.4104209, "https://guide.michelin.com/us/en/california/san-francisco/restaurant/birdsong", "https://www.birdsongsf.com/info", "osm_verified", "Operator information page and MICHELIN record confirm the address; named OSM restaurant node 9583974523 matches Birdsong."],
  ];

  const venueId = (index) => "venuesf2026" + String(index + 1).padStart(4, "0");
  const awardId = (index) => "awardsf2026" + String(index + 1).padStart(4, "0");
  const entryId = (index) => "vsesf2026" + String(index + 1).padStart(6, "0");
  const recordSeedId = (index) => "srcsf2026rec" + String(index + 1).padStart(3, "0");
  const level = (stars) => `${stars} Stars`;
  const distinction = (stars) => (stars === 3 ? "three-stars" : "two-stars");

  // ---------- one shared guide source, re-looked-up by unique slug ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, 'Michelin Guide', 'michelin-guide', 'https://guide.michelin.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: SOURCE_SEED_ID, now: NOW })
    .execute();
  const sourceId = app.findFirstRecordByFilter("guide_sources", "slug = 'michelin-guide'").id;

  // ---------- governing edition record + ten individual restaurant records ----------
  {
    const params = { editionId: EDITION_RECORD_SEED_ID, source: sourceId, editionUrl: EDITION_URL, published: EDITION_PUBLISHED, accessed: ACCESSED, now: NOW };
    const values = [
      "({:editionId}, {:source}, 'MICHELIN Guide California 2026 starred restaurants announcement', {:editionUrl}, 'official-edition-announcement', {:published}, {:accessed}, {:now}, {:now})",
      ...rows.map((row, index) => {
        params[`id${index}`] = recordSeedId(index);
        params[`title${index}`] = `MICHELIN Guide California 2026 — official restaurant record: ${row[0]}`;
        params[`url${index}`] = row[5];
        return `({:id${index}}, {:source}, {:title${index}}, {:url${index}}, 'official-restaurant-record', '', {:accessed}, {:now}, {:now})`;
      }),
    ];
    app
      .db()
      .newQuery(
        "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
          values.join(", ")
      )
      .bind(params)
      .execute();
  }
  const recordIds = rows.map((row) => app.findFirstRecordByFilter("source_records", "url = {:url}", { url: row[5] }).id);
  const editionRecordId = app.findFirstRecordByFilter("source_records", "url = {:url}", { url: EDITION_URL }).id;

  // ---------- one point-in-time import provenance record ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) " +
        "VALUES ({:id}, 'michelin-2026-san-francisco-two-three-starred', 'data/michelin-2026-san-francisco-two-three-starred.csv', " +
        "'Verified import of 10 City and County of San Francisco MICHELIN Guide California 2026 two- and three-star source entries; record-level provenance and independent map-location qualifiers retained.', " +
        "{:source}, 10, 'verified', {:accessed}, {:now}, {:now})"
    )
    .bind({ id: IMPORT_SEED_ID, source: sourceId, accessed: ACCESSED, now: NOW })
    .execute();
  const importId = app.findFirstRecordByFilter(
    "import_provenance",
    "import_key = 'michelin-2026-san-francisco-two-three-starred'"
  ).id;

  // ---------- ten canonical venues: bulk and city-scoped ----------
  {
    const params = { now: NOW };
    const values = rows.map((row, index) => {
      params[`id${index}`] = venueId(index);
      params[`name${index}`] = row[0];
      params[`address${index}`] = row[2];
      params[`lat${index}`] = row[3];
      params[`lng${index}`] = row[4];
      params[`official${index}`] = row[6];
      params[`note${index}`] = `Independent ${row[7]} coordinate qualifier. ${row[8]}`.slice(0, 300);
      return `({:id${index}}, {:name${index}}, 'San Francisco', 'United States', {:address${index}}, {:lat${index}}, {:lng${index}}, 'Fine dining', {:official${index}}, {:note${index}}, {:now}, {:now})`;
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

  // ---------- awards: each points at its exact individual official record ----------
  {
    const params = { source: sourceId, import: importId, now: NOW };
    const values = rows.map((row, index) => {
      params[`id${index}`] = awardId(index);
      params[`venue${index}`] = venueId(index);
      params[`level${index}`] = level(row[1]);
      params[`url${index}`] = row[5];
      params[`record${index}`] = recordIds[index];
      params[`note${index}`] = `MICHELIN Guide California 2026 ${level(row[1])}; individual restaurant record verified on 2026-07-14.`;
      return `({:id${index}}, {:source}, {:venue${index}}, 2026, {:level${index}}, {:url${index}}, TRUE, {:note${index}}, {:record${index}}, {:import}, 'verified', {:now}, {:now})`;
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

  // ---------- raw source assertions: one per source record, not a fuzzy merge ----------
  {
    const columns =
      "INSERT OR IGNORE INTO venue_source_entries (id, source, source_record, import, venue, source_venue_name, locality, country, " +
      "guide_year, distinction, distinction_level, source_url, source_type, source_published_or_updated_at, source_accessed_at, " +
      "award_validation_status, validation_evidence, street_address, latitude, longitude, coordinate_source, coordinate_validation_status, " +
      "match_method, match_evidence, created, updated) VALUES ";
    const params = { source: sourceId, import: importId, accessed: ACCESSED, now: NOW, editionRecord: editionRecordId };
    const values = rows.map((row, index) => {
      params[`id${index}`] = entryId(index);
      params[`record${index}`] = recordIds[index];
      params[`venue${index}`] = venueId(index);
      params[`name${index}`] = row[0];
      params[`distinction${index}`] = distinction(row[1]);
      params[`stars${index}`] = row[1];
      params[`url${index}`] = row[5];
      params[`evidence${index}`] = `Individual MICHELIN restaurant record supports ${row[0]}, San Francisco locality, and ${level(row[1])}; the governing California 2026 announcement is retained as source record ${editionRecordId}.`;
      params[`address${index}`] = row[2];
      params[`lat${index}`] = row[3];
      params[`lng${index}`] = row[4];
      params[`coordStatus${index}`] = row[7];
      params[`match${index}`] = "Single MICHELIN source assertion; canonical identity is keyed by exact source spelling plus San Francisco and United States. No fuzzy merge is attempted.";
      return `({:id${index}}, {:source}, {:record${index}}, {:import}, {:venue${index}}, {:name${index}}, 'San Francisco', 'United States', ` +
        `2026, {:distinction${index}}, {:stars${index}}, {:url${index}}, 'official-restaurant-record', '', {:accessed}, ` +
        `'verified', {:evidence${index}}, {:address${index}}, {:lat${index}}, {:lng${index}}, 'openstreetmap-nominatim', {:coordStatus${index}}, ` +
        `'single-source', {:match${index}}, {:now}, {:now})`;
    });
    app.db().newQuery(columns + values.join(", ")).bind(params).execute();
  }
}, () => {
  // Forward-only: corrections use a later migration so existing provenance is retained.
  return null;
});

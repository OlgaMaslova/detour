/// <reference path="../pb_data/types.d.ts" />
//
// Michelin Guide 2026 — conservative City-of-Paris two- and three-star seed.
//
// This migration uses only the 29 source assertions approved in
// docs/paris-source-rights-and-curation-plan.md. The category pages establish
// name, Paris locality, and distinction. The France edition announcement
// corroborates guide year 2026. No official venue URLs, street addresses, or
// coordinates are asserted by this award import.
//
// Forward-only and retry-safe: every insert is a parameterized bulk INSERT OR
// IGNORE with fixed 15-character ids; source/import relations are recovered by
// their unique natural keys after insertion. A partial migration converges on
// its next run without duplicate venues, awards, source records, or entries.
migrate((app) => {
  const NOW = "2026-07-14 00:00:00.000Z";
  const ACCESSED = "2026-07-14 00:00:00.000Z";
  const EDITION_PUBLISHED = "2026-03-17 00:00:00.000Z";
  const URL_3 = "https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/3-stars-michelin";
  const URL_2 = "https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/2-stars-michelin";
  const EDITION_URL = "https://guide.michelin.com/kr/en/article/news-and-views/michelin-star-restaurants-france-full-list";

  // Deterministic 15-character ids. The MICHELIN source itself is reused by
  // slug, rather than assuming the id assigned by the earlier Madrid import.
  const SOURCE_SEED_ID = "gsmichelin00001";
  const SRCREC_3_SEED = "srcrec26paris03";
  const SRCREC_2_SEED = "srcrec26paris02";
  const SRCREC_EDITION_SEED = "srcrec26france1";
  const IMPORT_SEED_ID = "impmichparis026";

  const rows = [
    ["Le Gabriel - La Réserve Paris", 3],
    ["Épicure", 3],
    ["Kei", 3],
    ["Plénitude - Cheval Blanc Paris", 3],
    ["Le Cinq", 3],
    ["Pierre Gagnaire", 3],
    ["Arpège", 3],
    ["Alléno Paris au Pavillon Ledoyen", 3],
    ["Le Pré Catelan", 3],
    ["La Scène", 2],
    ["L'Oiseau Blanc", 2],
    ["Le Grand Restaurant - Jean-François Piège", 2],
    ["Restaurant Le Meurice Alain Ducasse", 2],
    ["Maison Rostang", 2],
    ["Le Taillevent", 2],
    ["Alliance", 2],
    ["Marsan par Hélène Darroze", 2],
    ["Le Clarence", 2],
    ["David Toutain", 2],
    ["Blanc", 2],
    ["Hakuba", 2],
    ["L'Abysse Paris", 2],
    ["L'Orangerie", 2],
    ["Guy Savoy", 2],
    ["Table - Bruno Verjus", 2],
    ["L'Ambroisie", 2],
    ["Le Jules Verne", 2],
    ["Virtus", 2],
    ["Sushi Yoshinaga", 2],
  ];

  const venueId = (index) => "venueparis" + String(index + 1).padStart(5, "0");
  const awardId = (index) => "awardparis" + String(index + 1).padStart(5, "0");
  const entryId = (index) => "vseparis" + String(index + 1).padStart(7, "0");
  const level = (stars) => `${stars} Stars`;
  const categoryUrl = (stars) => (stars === 3 ? URL_3 : URL_2);
  const sourceRecordId = (stars, records) => (stars === 3 ? records.three : records.two);
  const evidence = (stars) =>
    `Name, Paris locality, and ${level(stars)} verified on the official MICHELIN category page; the official France 2026 announcement corroborates guide year.`;
  const noLocation = "No independently verified address or coordinates in this Paris MICHELIN award import; 0/0 is a sentinel, not a pin.";

  // ---------- guide source: insert-or-reuse the unique Michelin slug ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, 'Michelin Guide', 'michelin-guide', 'https://guide.michelin.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: SOURCE_SEED_ID, now: NOW })
    .execute();
  const sourceId = app.findFirstRecordByFilter("guide_sources", "slug = 'michelin-guide'").id;

  // ---------- three record-level official source surfaces ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
        "({:id3}, {:source}, 'MICHELIN Guide 2026 — Paris 3-star restaurants (official category page)', {:url3}, 'official-category-listing', '', {:accessed}, {:now}, {:now}), " +
        "({:id2}, {:source}, 'MICHELIN Guide 2026 — Paris 2-star restaurants (official category page)', {:url2}, 'official-category-listing', '', {:accessed}, {:now}, {:now}), " +
        "({:idEdition}, {:source}, 'MICHELIN Guide — France 2026 starred restaurants announcement', {:editionUrl}, 'official-edition-announcement', {:published}, {:accessed}, {:now}, {:now})"
    )
    .bind({
      id3: SRCREC_3_SEED,
      id2: SRCREC_2_SEED,
      idEdition: SRCREC_EDITION_SEED,
      source: sourceId,
      url3: URL_3,
      url2: URL_2,
      editionUrl: EDITION_URL,
      published: EDITION_PUBLISHED,
      accessed: ACCESSED,
      now: NOW,
    })
    .execute();
  const sourceRecords = {
    three: app.findFirstRecordByFilter("source_records", "url = {:url}", { url: URL_3 }).id,
    two: app.findFirstRecordByFilter("source_records", "url = {:url}", { url: URL_2 }).id,
    edition: app.findFirstRecordByFilter("source_records", "url = {:url}", { url: EDITION_URL }).id,
  };

  // ---------- one point-in-time import provenance record ----------
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) " +
        "VALUES ({:id}, 'michelin-2026-paris-two-and-three-starred', 'data/michelin-2026-paris-two-three-starred.csv', " +
        "'Verified import of 29 City-of-Paris MICHELIN Guide 2026 two- and three-star source entries; no address or coordinate enrichment asserted.', " +
        "{:source}, 29, 'verified', {:accessed}, {:now}, {:now})"
    )
    .bind({ id: IMPORT_SEED_ID, source: sourceId, accessed: ACCESSED, now: NOW })
    .execute();
  const importId = app.findFirstRecordByFilter(
    "import_provenance",
    "import_key = 'michelin-2026-paris-two-and-three-starred'"
  ).id;

  // ---------- canonical venues: bulk, city-scoped, and idempotent ----------
  for (let offset = 0; offset < rows.length; offset += 10) {
    const chunk = rows.slice(offset, offset + 10);
    const params = { now: NOW, locationNote: noLocation };
    const values = chunk.map(([name], index) => {
      const absolute = offset + index;
      params[`id${index}`] = venueId(absolute);
      params[`name${index}`] = name;
      return `({:id${index}}, {:name${index}}, 'Paris', 'France', '', 0, 0, '', '', {:locationNote}, {:now}, {:now})`;
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

  // ---------- awards: bulk, one exact source record per category assertion ----------
  for (let offset = 0; offset < rows.length; offset += 10) {
    const chunk = rows.slice(offset, offset + 10);
    const params = { source: sourceId, import: importId, now: NOW };
    const values = chunk.map(([name, stars], index) => {
      const absolute = offset + index;
      params[`id${index}`] = awardId(absolute);
      params[`venue${index}`] = venueId(absolute);
      params[`level${index}`] = level(stars);
      params[`url${index}`] = categoryUrl(stars);
      params[`sourceRecord${index}`] = sourceRecordId(stars, sourceRecords);
      params[`note${index}`] = evidence(stars);
      return `({:id${index}}, {:source}, {:venue${index}}, 2026, {:level${index}}, {:url${index}}, TRUE, {:note${index}}, {:sourceRecord${index}}, {:import}, 'verified', {:now}, {:now})`;
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

  // ---------- raw provenance entries: bulk; 0/0 is an explicitly non-location sentinel ----------
  const entryColumns =
    "INSERT OR IGNORE INTO venue_source_entries (id, source, source_record, import, venue, source_venue_name, locality, country, " +
    "guide_year, distinction, distinction_level, source_url, source_type, source_published_or_updated_at, source_accessed_at, " +
    "award_validation_status, validation_evidence, street_address, latitude, longitude, coordinate_source, coordinate_validation_status, " +
    "match_method, match_evidence, created, updated) VALUES ";
  for (let offset = 0; offset < rows.length; offset += 10) {
    const chunk = rows.slice(offset, offset + 10);
    const params = { source: sourceId, import: importId, accessed: ACCESSED, now: NOW };
    const values = chunk.map(([name, stars], index) => {
      const absolute = offset + index;
      params[`id${index}`] = entryId(absolute);
      params[`sourceRecord${index}`] = sourceRecordId(stars, sourceRecords);
      params[`venue${index}`] = venueId(absolute);
      params[`name${index}`] = name;
      params[`distinction${index}`] = level(stars);
      params[`stars${index}`] = stars;
      params[`url${index}`] = categoryUrl(stars);
      params[`evidence${index}`] = evidence(stars);
      params[`match${index}`] = "Michelin-only within the Paris/France/2026 seed: no other Paris source cohort exists, so no cross-source or fuzzy merge was attempted.";
      return `({:id${index}}, {:source}, {:sourceRecord${index}}, {:import}, {:venue${index}}, {:name${index}}, 'Paris', 'France', ` +
        `2026, {:distinction${index}}, {:stars${index}}, {:url${index}}, 'official-category-listing', '', {:accessed}, ` +
        `'verified', {:evidence${index}}, '', 0, 0, '', 'not_provided', 'single-source', {:match${index}}, {:now}, {:now})`;
    });
    app.db().newQuery(entryColumns + values.join(", ")).bind(params).execute();
  }
}, () => {
  // Forward-only: corrections ship as later migrations so persisted imports
  // retain their point-in-time provenance.
  return null;
});

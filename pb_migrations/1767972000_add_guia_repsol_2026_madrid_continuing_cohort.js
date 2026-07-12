/// <reference path="../pb_data/types.d.ts" />
//
// Expands the current Guía Repsol 2026 Madrid selection from 10 to exactly 20
// venues by adding 10 CONTINUING 2026 Sol holders verified against the
// official 2026 digital booklet:
//   https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf
// (source_type digital-booklet, accessed 2026-07-12; exact name, Sol level,
// and Madrid locality checked in the booklet's printed listing pages 90–91).
// The booklet PDF and its extracted text are NOT retained — only the URL and
// per-record factual checks, per docs/guia-repsol-2026-madrid-source-rights-memo.md.
//
// - Adds one source_records row for the booklet and one import_provenance row
//   for the continuing cohort (data/guia-repsol-2026-madrid-continuing-sol-selection.csv,
//   values inlined here; the file is not read at runtime).
// - Inserts the 10 continuing venues + awards with deterministic 15-char ids
//   continuing the legacy numbering (venueseed000011–20 / awardseed000011–20).
// - No independently verified coordinates exist for this selection: lat/lng
//   are NOT NULL NumberFields, so new venues get the neutral 0/0 sentinel and
//   coord_verification_note states explicitly that no coordinates were
//   verified. No addresses, categories, or venue URLs are invented.
// - Re-asserts current = TRUE for exactly these 20 award rows (the 10 legacy
//   new-Sol awards + the 10 continuing awards). No other awards are touched;
//   all legacy data is preserved.
//
// Forward-only. Every statement is INSERT OR IGNORE or an idempotent UPDATE
// scoped to deterministic ids, so a rerun after a partial failure converges.
// Does NOT edit any applied migration.
migrate((app) => {
  const NOW = "2026-07-12 00:00:00.000Z";
  const SOURCE_ID = "gsrepsol0000001"; // deterministic guide_sources id (legacy)
  const IMPORT_ID = "impguia20260002"; // deterministic 15-char id (continuing cohort)
  const SRCREC_BOOKLET = "srcrec2026book1"; // deterministic 15-char id
  const ACCESSED = "2026-07-12 00:00:00.000Z";
  const BOOKLET_URL =
    "https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf";
  const NOTE =
    "Exact name; Sol level; Madrid locality checked in the official 2026 booklet (printed listing pages 90-91).";

  // Collections were created by 1767971000 (which itself guards creation), so
  // they exist by the time this migration runs; no schema changes here.

  // Continuing 2026 Madrid Sol holders: [venue_name, sol_level].
  const seed = [
    ["Coque", 3],
    ["DiverXO", 3],
    ["DSTAgE", 3],
    ["Deessa", 2],
    ["Saddle", 2],
    ["Ugo Chan", 2],
    ["A'Barra", 1],
    ["Alabaster", 1],
    ["Fismuler", 1],
    ["La Catapa", 1],
  ];
  const levelLabel = (n) => (n === 1 ? "1 Sol" : n + " Soles");
  // Deterministic 15-char ids continuing the legacy numbering (11..20).
  const venueId = (i) => "venueseed0000" + String(i + 11).padStart(2, "0");
  const awardId = (i) => "awardseed0000" + String(i + 11).padStart(2, "0");
  // Legacy new-Sol award ids (1..10) — needed to re-assert the 20-row cohort.
  const legacyAwardId = (i) => "awardseed0000" + String(i + 1).padStart(2, "0");

  // 1) Guide source row (no-op when already inserted by earlier migrations).
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO guide_sources (id, name, slug, official_url, current_year, created, updated) " +
        "VALUES ({:id}, 'Guía Repsol', 'guia-repsol', 'https://www.guiarepsol.com/', 2026, {:now}, {:now})"
    )
    .bind({ id: SOURCE_ID, now: NOW })
    .execute();

  // 2) One source_records row for the official 2026 digital booklet.
  //    No publisher-displayed publication date on the PDF itself, so
  //    published_or_updated_at is left empty.
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO source_records (id, source, title, url, source_type, accessed_at, created, updated) " +
        "VALUES ({:id}, {:src}, 'Guía Repsol 2026 official digital booklet (complete Soles listing)', {:url}, 'digital-booklet', {:acc}, {:now}, {:now})"
    )
    .bind({ id: SRCREC_BOOKLET, src: SOURCE_ID, url: BOOKLET_URL, acc: ACCESSED, now: NOW })
    .execute();

  // 3) One import_provenance row for the continuing cohort.
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO import_provenance (id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) " +
        "VALUES ({:id}, 'guia-repsol-2026-madrid-continuing-sol-selection', 'data/guia-repsol-2026-madrid-continuing-sol-selection.csv', " +
        "'Verified seed of 10 continuing 2026 Madrid Sol holders, checked against the official 2026 digital booklet (printed listing pages 90-91). No booklet text or PDF retained.', " +
        "{:src}, 10, 'verified', {:acc}, {:now}, {:now})"
    )
    .bind({ id: IMPORT_ID, src: SOURCE_ID, acc: ACCESSED, now: NOW })
    .execute();

  // 4) Venues: bulk insert with CSV-supported facts only (name, Madrid,
  //    Spain). lat/lng are NOT NULL, so the neutral 0/0 sentinel is written
  //    and the note records that no coordinates were verified. No addresses,
  //    categories, or URLs are invented.
  {
    const params = { now: NOW };
    const rows = seed.map((r, i) => {
      params["id" + i] = venueId(i);
      params["name" + i] = r[0];
      return (
        "({:id" + i + "}, {:name" + i + "}, 'Madrid', 'Spain', '', 0, 0, '', '', " +
        "'No coordinates verified in this seed; 0/0 is a neutral sentinel, not a location.', {:now}, {:now})"
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

  // 5) Awards: bulk insert the 10 continuing awards, verified against the
  //    booklet, current = TRUE.
  {
    const params = { now: NOW, src: SOURCE_ID, imp: IMPORT_ID, srcrec: SRCREC_BOOKLET, url: BOOKLET_URL, note: NOTE };
    const rows = seed.map((r, i) => {
      params["id" + i] = awardId(i);
      params["venue" + i] = venueId(i);
      params["level" + i] = levelLabel(r[1]);
      return (
        "({:id" + i + "}, {:src}, {:venue" + i + "}, 2026, {:level" + i +
        "}, {:url}, TRUE, {:note}, {:srcrec}, {:imp}, 'verified', {:now}, {:now})"
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

  // 6) Repair path for the continuing rows if they pre-existed (idempotent):
  //    ensure booklet source_url/source_record/import/verified/current on
  //    exactly these 10 award ids.
  {
    const params = { url: BOOKLET_URL, srcrec: SRCREC_BOOKLET, imp: IMPORT_ID, note: NOTE, now: NOW };
    const ids = seed.map((_, i) => {
      params["a" + i] = awardId(i);
      return "{:a" + i + "}";
    });
    app
      .db()
      .newQuery(
        "UPDATE venue_awards SET source_url = {:url}, source_record = {:srcrec}, import = {:imp}, " +
          "verification_status = 'verified', current = TRUE, verification_note = {:note}, updated = {:now} " +
          "WHERE id IN (" + ids.join(", ") + ")"
      )
      .bind(params)
      .execute();
  }

  // 7) Re-assert current = TRUE for the full 20-row 2026 Madrid selection
  //    (legacy 1..10 + continuing 11..20). Scoped to these exact ids only;
  //    unrelated awards are not overwritten or demoted.
  {
    const params = { now: NOW };
    const ids = [];
    for (let i = 0; i < 10; i++) {
      params["l" + i] = legacyAwardId(i);
      params["c" + i] = awardId(i);
      ids.push("{:l" + i + "}", "{:c" + i + "}");
    }
    app
      .db()
      .newQuery(
        "UPDATE venue_awards SET current = TRUE, updated = {:now} " +
          "WHERE current != TRUE AND id IN (" + ids.join(", ") + ")"
      )
      .bind(params)
      .execute();
  }
}, (app) => {
  // Forward-only migration: no down path. Corrections to shipped data must be
  // made in a new migration with a later timestamp.
});

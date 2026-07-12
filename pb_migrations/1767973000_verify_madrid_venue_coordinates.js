/// <reference path="../pb_data/types.d.ts" />
//
// Coordinate/address verification pass for all 20 existing Guía Repsol 2026
// Madrid venue seed rows (venueseed000001–venueseed000020).
//
// Every latitude/longitude and street address below was checked on
// 2026-07-12 against OpenStreetMap via the public Nominatim geocoder
// (https://nominatim.openstreetmap.org/, data © OpenStreetMap contributors,
// ODbL 1.0) using name+Madrid and address queries. Each row's
// coord_verification_note records the matched OSM element (node/way/relation
// id) so the provenance is auditable per record. No values are invented:
//   - venueseed000011–20 previously carried the 0/0 sentinel and no address;
//     they now receive OSM-verified coordinates and addresses.
//   - venueseed000001–10 already had coordinates; they are re-asserted (and
//     in one case refined to the exact OSM address node) with OSM provenance
//     added to the note. Otoro Jukusei remains street-level (no OSM
//     house-number node exists for Fernández de la Hoz 35); its note says so.
//
// Forward-only and idempotent: one parameterized bulk UPDATE (CASE keyed by
// deterministic seed ids), scoped so a row is only touched when its id, name
// AND city='Madrid' all match — a foreign row can never be touched. Re-running
// converges to the same values. No schema changes, no edits to applied
// migrations, no per-row writes or app.save() calls.
migrate((app) => {
  const NOW = "2026-07-12 00:00:00.000Z";
  const SRC =
    "Verified 2026-07-12 via OpenStreetMap/Nominatim (© OpenStreetMap contributors, ODbL). ";

  // [id, name, address, lat, lng, note]
  const rows = [
    // --- legacy new-Sol cohort (1–10): re-asserted with OSM provenance ---
    ["venueseed000001", "Ramón Freixa Atelier", "Calle de Velázquez 24, 28001 Madrid", 40.4242034, -3.6840318, SRC + "Address node OSM N2810362195 (Velázquez 24)."],
    ["venueseed000002", "Bascoat", "Paseo de la Habana 33, 28036 Madrid", 40.4530399, -3.6851204, SRC + "Address node OSM N6384569289 (Paseo de la Habana 33)."],
    ["venueseed000003", "Smoked Room", "Paseo de la Castellana 57, 28046 Madrid", 40.4388252, -3.6917467, SRC + "Building centroid OSM W1433222601 (Hyatt Regency Hesperia Madrid, Castellana 57; restaurant inside hotel)."],
    ["venueseed000004", "Bancal", "Calle de Serrano 95, 28006 Madrid", 40.4381489, -3.6866899, SRC + "Building OSM R10843798 (Serrano 95)."],
    ["venueseed000005", "Desborre", "Calle de la Unión 8, 28013 Madrid", 40.4173998, -3.7104301, SRC + "Refined to address node OSM N12364474470 (Calle de la Unión 8)."],
    ["venueseed000006", "EMi", "Calle de Gaztambide 64, 28015 Madrid", 40.4388461, -3.7151504, SRC + "Address node OSM N4109999608 (Gaztambide 64)."],
    ["venueseed000007", "Los 33", "Plaza de las Salesas 9, 28004 Madrid", 40.4238621, -3.6948322, SRC + "Restaurant node OSM N3361315182 (Los 33, Plaza de las Salesas 9)."],
    ["venueseed000008", "Otoro Jukusei", "Calle de Fernández de la Hoz 35, 28010 Madrid", 40.4339, -3.6949, SRC + "Street-level only: no OSM house-number node for Fernández de la Hoz 35; matches street centroid OSM W8029920 (28010 segment). Pin is approximate."],
    ["venueseed000009", "Ramón Freixa Tradición", "Calle de Velázquez 24, 28001 Madrid", 40.4242034, -3.6840318, SRC + "Address node OSM N2810362195 (Velázquez 24; shared location with Atelier)."],
    ["venueseed000010", "Trèsde", "Calle de la Cava Alta 17, 28005 Madrid", 40.4121178, -3.7092308, SRC + "Address node OSM N3907159230 (Cava Alta 17)."],
    // --- continuing cohort (11–20): first verified coordinates/addresses ---
    ["venueseed000011", "Coque", "Calle del Marqués de Riscal 11, 28010 Madrid", 40.4306865, -3.6905135, SRC + "Restaurant node OSM N7006949434 (Coque, Marqués de Riscal 11)."],
    ["venueseed000012", "DiverXO", "Calle del Padre Damián 23, 28036 Madrid", 40.4577954, -3.6859491, SRC + "Restaurant node OSM N3415801021 (DiverXO, Padre Damián 23)."],
    ["venueseed000013", "DSTAgE", "Calle de Regueros 8, 28004 Madrid", 40.4245942, -3.6963316, SRC + "Restaurant node OSM N5085913644 (Dstage, Regueros 8)."],
    ["venueseed000014", "Deessa", "Plaza de la Lealtad 5 (Mandarin Oriental Ritz), 28014 Madrid", 40.4155502, -3.6927255, SRC + "Hotel building OSM R3888654 (Mandarin Oriental Ritz, Plaza de la Lealtad 5); Deessa is inside the hotel, pin is building centroid."],
    ["venueseed000015", "Saddle", "Calle de Amador de los Ríos 6, 28010 Madrid", 40.427537, -3.6911125, SRC + "Restaurant node OSM N5209961484 (Saddle, Amador de los Ríos)."],
    ["venueseed000016", "Ugo Chan", "Calle de Félix Boix 6, 28036 Madrid", 40.4632356, -3.6883724, SRC + "Address-level: restaurant node OSM N4229665290 at Félix Boix 6 (Ugo Chan's published address; node unnamed in OSM)."],
    ["venueseed000017", "A'Barra", "Calle del Pinar 15, 28006 Madrid", 40.4386539, -3.6878292, SRC + "Restaurant node OSM N5235732371 (A'Barra, Pinar 15)."],
    ["venueseed000018", "Alabaster", "Calle de Montalbán 9, 28014 Madrid", 40.4181895, -3.6899478, SRC + "Restaurant node OSM N4609539340 (Alabaster, Calle de Montalbán)."],
    ["venueseed000019", "Fismuler", "Calle de Sagasta 29, 28004 Madrid", 40.4281715, -3.6975246, SRC + "Restaurant node OSM N4634798148 (Fismuler, Sagasta 29)."],
    ["venueseed000020", "La Catapa", "Calle de Menorca 14, 28009 Madrid", 40.4193576, -3.6772879, SRC + "Restaurant node OSM N6651753087 (Taberna La Catapa, Menorca 14)."],
  ];

  // Build one parameterized bulk UPDATE: every column is a CASE keyed by the
  // deterministic seed id, and the WHERE clause restricts the statement to
  // exactly the (id, name, city='Madrid') triples above.
  const params = { now: NOW };
  const addrCase = [];
  const latCase = [];
  const lngCase = [];
  const noteCase = [];
  const guards = [];

  rows.forEach(([id, name, addr, lat, lng, note], i) => {
    params[`id${i}`] = id;
    params[`name${i}`] = name;
    params[`addr${i}`] = addr;
    params[`lat${i}`] = lat;
    params[`lng${i}`] = lng;
    params[`note${i}`] = note;
    addrCase.push(`WHEN id = {:id${i}} THEN {:addr${i}}`);
    latCase.push(`WHEN id = {:id${i}} THEN {:lat${i}}`);
    lngCase.push(`WHEN id = {:id${i}} THEN {:lng${i}}`);
    noteCase.push(`WHEN id = {:id${i}} THEN {:note${i}}`);
    guards.push(`(id = {:id${i}} AND name = {:name${i}})`);
  });

  const sql =
    "UPDATE venues SET " +
    `address = CASE ${addrCase.join(" ")} ELSE address END, ` +
    `lat = CASE ${latCase.join(" ")} ELSE lat END, ` +
    `lng = CASE ${lngCase.join(" ")} ELSE lng END, ` +
    `coord_verification_note = CASE ${noteCase.join(" ")} ELSE coord_verification_note END, ` +
    "updated = {:now} " +
    `WHERE city = 'Madrid' AND (${guards.join(" OR ")})`;

  app.db().newQuery(sql).bind(params).execute();
}, () => {
  // Forward-only data verification pass; nothing to revert.
  return null;
});

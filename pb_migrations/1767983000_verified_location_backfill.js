/// <reference path="../pb_data/types.d.ts" />
//
// Verified location backfill for the 29 Paris MICHELIN 2026 venues and the
// two previously unresolved Madrid MICHELIN venues reviewed on 2026-07-16.
//
// Forward-only, retry-safe, and fast: this performs one parameterized CASE
// UPDATE per affected table, never per-row saves. Every venue update is guarded
// by exact deterministic id, canonical name, city, and country. Every raw
// source-entry update is additionally guarded by its actual deterministic
// source-entry id and canonical venue relation. Award rows and award provenance
// are deliberately untouched.
migrate((app) => {
  const NOW = "2026-07-16 00:00:00.000Z";

  // [venue id, source-entry id, canonical name, city, country, address, lat,
  //  lng, official URL, coordinate status, precise OSM/address relationship]
  const rows = [
    ["venueparis00001", "vseparis0000001", "Le Gabriel - La Réserve Paris", "Paris", "France", "42 Avenue Gabriel, 75008 Paris", 48.8697092, 2.313439, "https://www.lareserve-paris.com/en/restaurants-bars/restaurant-le-gabriel/", "osm_verified", "Named OSM restaurant node 5030309021 is Le Gabriel on the La Réserve premises; Nominatim resolves its side to Rue du Cirque while the venue publishes the Avenue Gabriel entrance."],
    ["venueparis00002", "vseparis0000002", "Épicure", "Paris", "France", "112 rue du Faubourg Saint-Honoré, 75008 Paris", 48.8717179, 2.3148011, "https://www.oetkercollection.com/hotels/le-bristol-paris/restaurants-bar/epicure/", "osm_verified", "Named OSM restaurant node 4699968994 is Epicure on rue du Faubourg Saint-Honoré at Le Bristol; a second Épicure node 9997195643 on rue de Ponthieu was rejected as not matching the official address."],
    ["venueparis00003", "vseparis0000003", "Kei", "Paris", "France", "5 rue Coq-Héron, 75001 Paris", 48.864328, 2.3421687, "https://restaurant-kei.fr/", "osm_address_verified", "No named Kei element was returned; OSM address node 681369512 is exactly 5 Rue Coq Héron, the official Michelin individual-record address."],
    ["venueparis00004", "vseparis0000004", "Plénitude - Cheval Blanc Paris", "Paris", "France", "Cheval Blanc Paris, 8 Quai du Louvre, 75001 Paris", 48.8588572, 2.3421794, "https://www.chevalblanc.com/en/maison/paris/restaurants-and-bars/plenitude/", "osm_address_verified", "No named Plénitude element was returned; named OSM hotel node 8859828184 is Cheval Blanc at number 8 and is the documented host premises, not a restaurant-specific pin."],
    ["venueparis00005", "vseparis0000005", "Le Cinq", "Paris", "France", "31 avenue George V, 75008 Paris", 48.8686738, 2.3007762, "https://www.fourseasons.com/paris/dining/restaurants/le_cinq/", "osm_verified", "Named OSM restaurant node 5030422821 is Le Cinq and carries the exact 31 Avenue George V address."],
    ["venueparis00006", "vseparis0000006", "Pierre Gagnaire", "Paris", "France", "6 rue Balzac, 75008 Paris", 48.8733364, 2.3004153, "https://www.pierre-gagnaire.com/", "osm_verified", "Named OSM restaurant node 4699902490 is Pierre Gagnaire on Rue Balzac and lies at OSM address node 839872225 for number 6."],
    ["venueparis00007", "vseparis0000007", "Arpège", "Paris", "France", "84 rue de Varenne, 75007 Paris", 48.855754, 2.3170135, "https://www.alain-passard.com/en/", "osm_verified", "Named OSM restaurant node 11817329876 is L'Arpège and carries the exact 84 Rue de Varenne address."],
    ["venueparis00008", "vseparis0000008", "Alléno Paris au Pavillon Ledoyen", "Paris", "France", "Pavillon Ledoyen, 8 avenue Dutuit, 75008 Paris", 48.8661024, 2.3164852, "https://www.yannick-alleno.com/en/les-etablissements-du-groupe/alleno-paris", "osm_verified", "Named OSM restaurant way 108191689 is Pavillon Ledoyen, the venue named in Alléno Paris's official address; OSM reverse context uses Avenue Edward Tuck for this corner building rather than the Avenue Dutuit entrance."],
    ["venueparis00009", "vseparis0000009", "Le Pré Catelan", "Paris", "France", "Route de Suresnes, Bois de Boulogne, 75016 Paris", 48.8639746, 2.2507666, "https://leprecatelan.paris/en/le-restaurant-du-precatelan", "osm_verified", "Named OSM restaurant way 83115461 is Le Pré Catelan; OSM places the building on Route de la Grande Cascade while the official Michelin record uses the estate's Route de Suresnes postal entrance."],
    ["venueparis00010", "vseparis0000010", "La Scène", "Paris", "France", "32 avenue Matignon, 75008 Paris", 48.8720547, 2.3145504, "https://www.la-scene.paris/", "osm_verified", "Named OSM restaurant node 11463183203 is La Scène on Avenue Matignon and is adjacent to exact address node 813929540 for number 32."],
    ["venueparis00011", "vseparis0000011", "L'Oiseau Blanc", "Paris", "France", "The Peninsula Paris, 19 avenue Kléber, 75116 Paris", 48.8707617, 2.2931271, "https://www.peninsula.com/en/paris/hotel-fine-dining/french-rooftop-loiseau-blanc", "osm_address_verified", "No matching named venue element exists at The Peninsula; OSM address node 10174250077 is exactly 19 Avenue Kléber. Same-name restaurant node 817830194 on Rue de Rome was rejected as unrelated."],
    ["venueparis00012", "vseparis0000012", "Le Grand Restaurant - Jean-François Piège", "Paris", "France", "7 rue d'Aguesseau, 75008 Paris", 48.8701365, 2.3192081, "https://xn--jeanfranoispiege-jpb.com/le-grand-restaurant", "osm_verified", "Named OSM restaurant node 3748908950 is Le Grand Restaurant on Rue d'Aguesseau and is adjacent to exact address node 842128221 for number 7."],
    ["venueparis00013", "vseparis0000013", "Restaurant Le Meurice Alain Ducasse", "Paris", "France", "Le Meurice, 228 rue de Rivoli, 75001 Paris", 48.8651359, 2.3282657, "https://www.dorchestercollection.com/paris/le-meurice/dining/restaurant-le-meurice-alain-ducasse", "osm_verified", "Named OSM restaurant node 5029945222 is Le Meurice Alain Ducasse and carries the exact 228 Rue de Rivoli address."],
    ["venueparis00014", "vseparis0000014", "Maison Rostang", "Paris", "France", "20 rue Rennequin, 75017 Paris", 48.8814422, 2.2985522, "https://www.maisonrostang.com/en/home-2/", "osm_verified", "Named OSM restaurant node 4699000491 is Maison Rostang on Rue Rennequin at the published premises; Nominatim omits the house number from the venue node."],
    ["venueparis00015", "vseparis0000015", "Le Taillevent", "Paris", "France", "15 rue Lamennais, 75008 Paris", 48.874149, 2.3024714, "https://taillevent.com/en/", "osm_verified", "Named OSM restaurant node 4527150298 is Le Taillevent on Rue Lamennais at the published premises; Nominatim omits the house number from the venue node."],
    ["venueparis00016", "vseparis0000016", "Alliance", "Paris", "France", "5 rue de Poissy, 75005 Paris", 48.8499232, 2.3533019, "https://www.restaurant-alliance.fr/en/", "osm_verified", "Named OSM restaurant node 4399470176 is Alliance and carries the exact 5 Rue de Poissy address; an unnumbered duplicate node 9691431276 was not selected."],
    ["venueparis00017", "vseparis0000017", "Marsan par Hélène Darroze", "Paris", "France", "4 rue d'Assas, 75006 Paris", 48.8500436, 2.3278425, "https://www.helenedarroze.com/", "osm_verified", "Named OSM restaurant node 5221114447 is Marsan and carries the exact 4 Rue d'Assas address."],
    ["venueparis00018", "vseparis0000018", "Le Clarence", "Paris", "France", "31 avenue Franklin D. Roosevelt, 75008 Paris", 48.8674023, 2.3097941, "https://www.le-clarence.paris/en/", "osm_verified", "Named OSM restaurant node 5030306022 is Le Clarence within the published corner mansion; Nominatim resolves the point to its Impasse d'Antin side rather than the Avenue Franklin D. Roosevelt entrance."],
    ["venueparis00019", "vseparis0000019", "David Toutain", "Paris", "France", "29 rue Surcouf, 75007 Paris", 48.8602539, 2.3097147, "https://www.davidtoutain.com/", "osm_verified", "Named OSM restaurant node 5030309125 is Restaurant David Toutain and carries the exact 29 Rue Surcouf address."],
    ["venueparis00020", "vseparis0000020", "Blanc", "Paris", "France", "52 rue de Longchamp, 75116 Paris", 48.8650727, 2.2875105, "https://www.blanc-paris.com/en/", "osm_address_verified", "No named Blanc element was returned; OSM address node 938872728 is exactly 52 Rue de Longchamp."],
    ["venueparis00021", "vseparis0000021", "Hakuba", "Paris", "France", "Cheval Blanc Paris, 8 quai du Louvre, 75001 Paris", 48.8588572, 2.3421794, "https://www.chevalblanc.com/en/maison/paris/restaurants-and-bars/hakuba/", "osm_address_verified", "No named Hakuba element was returned; named OSM hotel node 8859828184 is Cheval Blanc at number 8 and is the documented host premises, not a restaurant-specific pin."],
    ["venueparis00022", "vseparis0000022", "L'Abysse Paris", "Paris", "France", "Pavillon Ledoyen, 8 avenue Dutuit, 75008 Paris", 48.8661024, 2.3164852, "https://www.yannick-alleno.com/en/les-etablissements-du-groupe/abysse-paris", "osm_address_verified", "No separate L'Abysse element was returned; OSM restaurant way 108191689 is its documented host Pavillon Ledoyen. This is host-building geometry, not a restaurant-specific pin, and OSM uses the Avenue Edward Tuck side."],
    ["venueparis00023", "vseparis0000023", "L'Orangerie", "Paris", "France", "Four Seasons Hotel George V, 31 avenue George V, 75008 Paris", 48.868784, 2.3006774, "https://www.fourseasons.com/paris/dining/restaurants/l-orangerie/", "osm_address_verified", "No named L'Orangerie element was returned; named OSM hotel node 251758255 is Four Seasons Hôtel George V and carries the exact 31 Avenue George V host address."],
    ["venueparis00024", "vseparis0000024", "Guy Savoy", "Paris", "France", "Monnaie de Paris, 11 quai de Conti, 75006 Paris", 48.8565393, 2.3395348, "https://guysavoy.com/en", "osm_verified", "Named OSM restaurant node 4449907191 is Restaurant Guy Savoy on Quai de Conti within Monnaie de Paris; the venue node omits the house number."],
    ["venueparis00025", "vseparis0000025", "Table - Bruno Verjus", "Paris", "France", "3 rue de Prague, 75012 Paris", 48.8487639, 2.3758751, "https://table.paris/", "osm_address_verified", "No named Table element was returned; OSM address node 1353062885 is exactly 3 Rue de Prague."],
    ["venueparis00026", "vseparis0000026", "L'Ambroisie", "Paris", "France", "9 place des Vosges, 75004 Paris", 48.8554103, 2.3643002, "https://www.ambroisie-paris.com/", "osm_verified", "Named OSM restaurant node 2387678738 is L'Ambroisie on Place des Vosges at the published premises; same-name node 2281176835 in Paris 8e was rejected as unrelated."],
    ["venueparis00027", "vseparis0000027", "Le Jules Verne", "Paris", "France", "2nd floor, Eiffel Tower, 6 avenue Gustave Eiffel, 75007 Paris", 48.8581328, 2.2944968, "https://www.restaurants-toureiffel.com/en/jules-verne-restaurant.html", "osm_verified", "Named OSM restaurant node 3135278479 is Le Jules Verne in the Eiffel Tower and includes Tour Eiffel as its address housename."],
    ["venueparis00028", "vseparis0000028", "Virtus", "Paris", "France", "29 rue de Cotte, 75012 Paris", 48.8502429, 2.378162, "https://www.virtus-paris.com/en/", "osm_address_verified", "No named Virtus element was returned; OSM address node 1370190349 is exactly 29 Rue de Cotte."],
    ["venueparis00029", "vseparis0000029", "Sushi Yoshinaga", "Paris", "France", "27 rue du 4 Septembre, 75002 Paris", 48.8697847, 2.3349041, "https://sushiyoshinaga.com/", "osm_verified", "Named OSM restaurant node 14017261201 is Sushi Yoshinaga and carries the exact 27 Rue du Quatre Septembre address; the official site abbreviates Quatre as 4."],
    ["venuemich000006", "vsemichelin0014", "OSA", "Madrid", "Spain", "Calle de la Ribera del Manzanares 123, 28008 Madrid", 40.4287064, -3.7330588, "https://osarestaurante.com/en/osa-restaurant/", "osm_address_verified", "No named or address-tagged OSA element exists. OSM house way 637561061 is the exact footprint containing the first-party page's embedded OSA map point at 40.428843,-3.7328183; coordinates here are the independent OSM footprint center, not the first-party point."],
    ["venuemich000008", "vsemichelin0016", "Pabú", "Madrid", "Spain", "Calle Panamá 4, 28036 Madrid", 40.4563432, -3.6891995, "https://www.restaurantepabu.com/en", "osm_address_verified", "No named or address-tagged Pabú element exists. OSM apartment way 401611181 is the exact host footprint containing the first-party site's business-location point at 40.4564837,-3.6892562; coordinates here are the independent OSM footprint center, not the first-party point."],
  ];

  // Canonical venues: one bulk statement, CASE-keyed by deterministic id.
  {
    const params = { now: NOW };
    const addressCase = [];
    const latCase = [];
    const lngCase = [];
    const urlCase = [];
    const noteCase = [];
    const guards = [];

    rows.forEach(([id, , name, city, country, address, lat, lng, url, , note], index) => {
      params[`id${index}`] = id;
      params[`name${index}`] = name;
      params[`city${index}`] = city;
      params[`country${index}`] = country;
      params[`address${index}`] = address;
      params[`lat${index}`] = lat;
      params[`lng${index}`] = lng;
      params[`url${index}`] = url;
      params[`note${index}`] = note;
      addressCase.push(`WHEN id = {:id${index}} THEN {:address${index}}`);
      latCase.push(`WHEN id = {:id${index}} THEN {:lat${index}}`);
      lngCase.push(`WHEN id = {:id${index}} THEN {:lng${index}}`);
      urlCase.push(`WHEN id = {:id${index}} THEN {:url${index}}`);
      noteCase.push(`WHEN id = {:id${index}} THEN {:note${index}}`);
      guards.push(
        `(id = {:id${index}} AND name = {:name${index}} AND city = {:city${index}} AND country = {:country${index}})`
      );
    });

    app.db().newQuery(
      "UPDATE venues SET " +
        `address = CASE ${addressCase.join(" ")} ELSE address END, ` +
        `lat = CASE ${latCase.join(" ")} ELSE lat END, ` +
        `lng = CASE ${lngCase.join(" ")} ELSE lng END, ` +
        `official_url = CASE ${urlCase.join(" ")} ELSE official_url END, ` +
        `coord_verification_note = CASE ${noteCase.join(" ")} ELSE coord_verification_note END, ` +
        "updated = {:now} " +
        `WHERE ${guards.join(" OR ")}`
    ).bind(params).execute();
  }

  // Matching raw MICHELIN source assertions: one bulk statement. Location
  // evidence is enriched without changing distinction, award evidence, source
  // record, import provenance, match policy, or any award row.
  {
    const params = { now: NOW, coordinateSource: "openstreetmap-nominatim" };
    const addressCase = [];
    const latCase = [];
    const lngCase = [];
    const statusCase = [];
    const guards = [];

    rows.forEach(([venueId, entryId, name, city, country, address, lat, lng, , status], index) => {
      params[`venue${index}`] = venueId;
      params[`entry${index}`] = entryId;
      params[`name${index}`] = name;
      params[`city${index}`] = city;
      params[`country${index}`] = country;
      params[`address${index}`] = address;
      params[`lat${index}`] = lat;
      params[`lng${index}`] = lng;
      params[`status${index}`] = status;
      addressCase.push(`WHEN id = {:entry${index}} THEN {:address${index}}`);
      latCase.push(`WHEN id = {:entry${index}} THEN {:lat${index}}`);
      lngCase.push(`WHEN id = {:entry${index}} THEN {:lng${index}}`);
      statusCase.push(`WHEN id = {:entry${index}} THEN {:status${index}}`);
      guards.push(
        `(id = {:entry${index}} AND venue = {:venue${index}} AND source_venue_name = {:name${index}} AND locality = {:city${index}} AND country = {:country${index}})`
      );
    });

    app.db().newQuery(
      "UPDATE venue_source_entries SET " +
        `street_address = CASE ${addressCase.join(" ")} ELSE street_address END, ` +
        `latitude = CASE ${latCase.join(" ")} ELSE latitude END, ` +
        `longitude = CASE ${lngCase.join(" ")} ELSE longitude END, ` +
        "coordinate_source = {:coordinateSource}, " +
        `coordinate_validation_status = CASE ${statusCase.join(" ")} ELSE coordinate_validation_status END, ` +
        "updated = {:now} " +
        `WHERE ${guards.join(" OR ")}`
    ).bind(params).execute();
  }
}, () => {
  // Forward-only reviewed data correction; nothing to revert.
  return null;
});

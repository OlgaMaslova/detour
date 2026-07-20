/// <reference path="../pb_data/types.d.ts" />
//
// Expands the existing San Francisco route into a Bay Area market while
// retaining each venue's physical locality. The seven additions are
// user-directed Detour editorial local picks, not guide awards.
//
// Forward-only and retry-safe: schema additions are type-checked and guarded,
// existing records are updated by deterministic identity, and all new records
// use fixed 15-character ids with batched INSERT OR IGNORE statements.
migrate((app) => {
  const NOW = "2026-07-21 00:00:00.000Z";
  const ACCESSED = NOW;
  const MARKET = "San Francisco";
  const SOURCE_SEED_ID = "gsdetourbay0001";
  const SOURCE_RECORD_SEED_ID = "srcdetourbay001";
  const IMPORT_SEED_ID = "impdetourbay001";
  const SOURCE_SLUG = "detour-bay-area-editorial";
  const SOURCE_URL = "https://detour.supernaut.to/?city=san-francisco";
  const IMPORT_KEY = "detour-bay-area-editorial-expansion-2026";

  const rows = [
    {
      venueId: "venuebay0000001",
      awardId: "awardbay0000001",
      name: "Timeless Coffee",
      city: "Oakland",
      address: "4252 Piedmont Ave, Oakland, CA 94611",
      lat: 37.8282342,
      lng: -122.2498048,
      category: "Coffee",
      officialUrl: "https://timelesscoffee.com/pages/locations",
      instagramUrl: "https://www.instagram.com/timelesscoffee/",
      coordNote: "Named OpenStreetMap cafe node 5679738021 matches Timeless Coffee at 4252 Piedmont Avenue; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000002",
      awardId: "awardbay0000002",
      name: "Trabocco Kitchen and Cocktails",
      city: "Alameda",
      address: "2213 South Shore Center, Alameda, CA 94501",
      lat: 37.7573259,
      lng: -122.2516783,
      category: "Casual dining",
      officialUrl: "https://trabocco.com/",
      instagramUrl: "https://www.instagram.com/trabocco_alameda/",
      coordNote: "Named OpenStreetMap restaurant node 12332008494 matches Trabocco at 2213 South Shore Center; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000003",
      awardId: "awardbay0000003",
      name: "Terún",
      city: "Palo Alto",
      address: "448 California Ave, Palo Alto, CA 94306",
      lat: 37.4259864,
      lng: -122.1454894,
      category: "Pizza",
      officialUrl: "https://www.terunpizza.com/",
      instagramUrl: "https://www.instagram.com/terunpizza/",
      coordNote: "Named OpenStreetMap restaurant way 161113040 matches Terún Pizzeria at 448 South California Avenue; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000004",
      awardId: "awardbay0000004",
      name: "Coffeebar",
      city: "Menlo Park",
      address: "1149 Chestnut St, Menlo Park, CA 94025",
      lat: 37.4521118,
      lng: -122.1854639,
      category: "Coffee",
      officialUrl: "https://coffeebar.com/locations/",
      instagramUrl: "https://www.instagram.com/coffeebar/",
      coordNote: "Named OpenStreetMap cafe node 6219785185 matches Coffeebar at 1149 Chestnut Street; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000005",
      awardId: "awardbay0000005",
      name: "Doppio Zero",
      city: "Mountain View",
      address: "160 Castro St, Mountain View, CA 94041",
      lat: 37.3943827,
      lng: -122.078829,
      category: "Pizza",
      officialUrl: "https://doppiozerogroup.com/doppiozeromountainview",
      instagramUrl: "https://www.instagram.com/doppiozerousa/",
      coordNote: "Named OpenStreetMap restaurant node 1722142269 matches Doppio Zero at 160 Castro Street; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000006",
      awardId: "awardbay0000006",
      name: "Vesta",
      city: "Redwood City",
      address: "2022 Broadway, Redwood City, CA 94063",
      lat: 37.4867332,
      lng: -122.226785,
      category: "Pizza",
      officialUrl: "https://www.vestarwc.com/",
      instagramUrl: "https://www.instagram.com/vestarwc/",
      coordNote: "Named OpenStreetMap restaurant node 5546964971 matches Vesta at 2022 Broadway; checked 2026-07-21.",
    },
    {
      venueId: "venuebay0000007",
      awardId: "awardbay0000007",
      name: "Sushi Yoshizumi",
      city: "San Mateo",
      address: "325 E 4th Ave, San Mateo, CA 94401",
      lat: 37.5649598,
      lng: -122.3214071,
      category: "Sushi",
      officialUrl: "http://sushiyoshizumi.com/",
      instagramUrl: "https://www.instagram.com/sushiyoshizumi/",
      coordNote: "OpenStreetMap address way 449672616 verifies 325 East 4th Avenue; venue identity and address were separately checked on official surfaces 2026-07-21.",
    },
  ];

  const existingSanFrancisco = [
    ["venuesf20260011", "A16", "https://www.a16pizza.com/", "https://www.instagram.com/a16sf/"],
    ["venuesf20260005", "Acquerello", "https://www.acquerellosf.com/", "https://www.instagram.com/acquerellosf/"],
    ["venuesflocal003", "Al Carajo", "https://alcarajosf.com/", "https://www.instagram.com/alcarajosf/"],
    ["venuesf20260012", "Anchor Oyster Bar", "http://anchoroysterbar.com/", "https://www.instagram.com/anchoroysterbar/"],
    ["venuesflocal001", "Arsicault Bakery", "https://arsicault-bakery.com/", "https://www.instagram.com/arsicaultbakery/"],
    ["venuesf20260004", "Atelier Crenn", "https://www.ateliercrenn.com/", "https://www.instagram.com/atelier.crenn/"],
    ["venuesf20260013", "Bansang", "https://www.bansangsf.com/", "https://www.instagram.com/bansang_sf/"],
    ["venuesf20260003", "Benu", "https://www.benusf.com/", "https://www.instagram.com/benu_sf/"],
    ["venuesflocal006", "Better Half Coffee", "https://www.betterhalf.coffee/", "https://www.instagram.com/betterhalfcoffee/"],
    ["venuesf20260010", "Birdsong", "https://www.birdsongsf.com/info", "https://www.instagram.com/birdsong_sf/"],
    ["venuesf20260002", "Californios", "https://www.californiossf.com/", "https://www.instagram.com/californiossf/"],
    ["venuesf20260014", "Dumpling Home", "https://www.dumplinghomesf.com/", "https://www.instagram.com/dumplinghome/"],
    ["venuesf20260015", "Good Good Culture Club", "https://goodgoodcultureclub.com/", "https://www.instagram.com/goodgoodcultureclub/"],
    ["venuesflocal005", "Hila", "https://www.hilagelato.com/", "https://www.instagram.com/hilagelato/"],
    ["venuesf20260023", "Hilda and Jesse", "https://www.hildaandjessesf.com/", "https://www.instagram.com/hildaandjessesf/"],
    ["venuesflocal004", "Hook Fish Co.", "https://www.hookfishco.com/", "https://www.instagram.com/hookfishco/"],
    ["venuesf20260016", "Izakaya Rintaro", "https://izakayarintaro.com/", "https://www.instagram.com/mr_rintaro/"],
    ["venuesf20260006", "Kiln", "https://www.kilnsf.com/", "https://www.instagram.com/kilnsf/"],
    ["venuesf20260022", "Kitchen Istanbul", "https://www.kitchenistanbulsf.com/", "https://www.instagram.com/kitchenistanbulsf/"],
    ["venuesf20260007", "Lazy Bear", "https://www.lazybearsf.com/contact-info/", "https://www.instagram.com/lazybearsf/"],
    ["venuesf20260024", "Nisei", "https://www.restaurantnisei.com/", "https://www.instagram.com/nisei_sf/"],
    ["venuesf20260017", "Okane", "https://www.okanesf.com/", "https://www.instagram.com/okane_sf/"],
    ["venuesf20260018", "Outerlands", "https://outerlandssf.com/", "https://www.instagram.com/outerlands/"],
    ["venuesflocal007", "Pork Store Cafe", "https://www.porkstorecafe.com/", "https://www.instagram.com/porkstorecafehaight/"],
    ["venuesf20260001", "Quince", "https://www.quincerestaurant.com/", "https://www.instagram.com/quince_sf/"],
    ["venuesf20260009", "Saison", "https://saisonsf.com/contact/", "https://www.instagram.com/saisonsf/"],
    ["venuesf20260008", "Sons & Daughters", "https://www.sonsanddaughterssf.com/", "https://www.instagram.com/sonsanddaughterssf/"],
    ["venuesflocal002", "The Dubliner", "https://www.dublinerbarsf.com/", "https://www.instagram.com/thedublinerbar/"],
    ["venuesf20260025", "Tony’s Pizza Napoletana", "https://tonyspizzanapoletana.com/", "https://www.instagram.com/tonyspizza415/"],
    ["venuesf20260019", "Trestle", "https://www.trestlesf.com/", "https://www.instagram.com/trestle_sf/"],
    ["venuesf20260020", "Yank Sing", "https://yanksing.com/", "https://www.instagram.com/yanksing/"],
    ["venuesf20260021", "Z & Y", "https://www.zandyrestaurant.com/", "https://www.instagram.com/zandyrestaurant/"],
  ];

  function ensureField(collection, name, expectedType, createField, configureField) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = createField();
      collection.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " + collection.name + "." + name +
          ": expected " + expectedType + " field, found " + field.type()
      );
    }
    configureField(field);
  }

  // ---------- optional route market and social profile fields ----------
  const venues = app.findCollectionByNameOrId("venues");
  ensureField(
    venues,
    "market",
    "text",
    () => new TextField({ name: "market", required: false, max: 120 }),
    (field) => {
      field.required = false;
      field.hidden = false;
      field.max = 120;
    }
  );
  ensureField(
    venues,
    "instagram_url",
    "url",
    () => new URLField({ name: "instagram_url", required: false }),
    (field) => {
      field.required = false;
      field.hidden = false;
    }
  );
  app.save(venues);

  // Every existing physical San Francisco row keeps its locality and joins the
  // unchanged san-francisco route through the explicit market.
  app.db().newQuery(
    "UPDATE venues SET market = {:market} " +
      "WHERE city = 'San Francisco' AND country = 'United States' " +
      "AND COALESCE(address, '') != '' AND NOT (lat = 0 AND lng = 0) " +
      "AND COALESCE(market, '') = ''"
  ).bind({ market: MARKET }).execute();

  // One set-based, identity-guarded enrichment for the 32 currently published
  // San Francisco records. Existing operator URLs are preserved; only blanks
  // are filled. Instagram values converge to the researched official profile.
  {
    const params = {};
    const values = existingSanFrancisco.map((row, index) => {
      params["id" + index] = row[0];
      params["name" + index] = row[1];
      params["official" + index] = row[2];
      params["instagram" + index] = row[3];
      return (
        "({:id" + index + "}, {:name" + index + "}, {:official" + index +
        "}, {:instagram" + index + "})"
      );
    });
    app.db().newQuery(
      "WITH researched(id, name, official_url, instagram_url) AS (VALUES " + values.join(", ") + ") " +
        "UPDATE venues SET " +
        "official_url = CASE WHEN COALESCE(official_url, '') = '' THEN " +
        "(SELECT official_url FROM researched WHERE researched.id = venues.id AND researched.name = venues.name) " +
        "ELSE official_url END, " +
        "instagram_url = (SELECT instagram_url FROM researched WHERE researched.id = venues.id AND researched.name = venues.name) " +
        "WHERE city = 'San Francisco' AND country = 'United States' " +
        "AND EXISTS (SELECT 1 FROM researched WHERE researched.id = venues.id AND researched.name = venues.name) " +
        "AND EXISTS (SELECT 1 FROM venue_awards WHERE venue_awards.venue = venues.id AND venue_awards.current = TRUE)"
    ).bind(params).execute();
  }

  // ---------- explicit Detour editorial source and provenance ----------
  app.db().newQuery(
    "INSERT OR IGNORE INTO guide_sources " +
      "(id, name, slug, official_url, current_year, created, updated) VALUES " +
      "({:id}, 'Detour Bay Area editorial', {:slug}, 'https://detour.supernaut.to/', 2026, {:now}, {:now})"
  ).bind({ id: SOURCE_SEED_ID, slug: SOURCE_SLUG, now: NOW }).execute();
  const sourceId = app.findFirstRecordByFilter(
    "guide_sources",
    "slug = {:slug}",
    { slug: SOURCE_SLUG }
  ).id;

  app.db().newQuery(
    "INSERT OR IGNORE INTO source_records " +
      "(id, source, title, url, source_type, published_or_updated_at, accessed_at, created, updated) VALUES " +
      "({:id}, {:source}, 'Detour — San Francisco and Bay Area editorial selection', {:url}, " +
      "'editorial-local-selection', '', {:accessed}, {:now}, {:now})"
  ).bind({
    id: SOURCE_RECORD_SEED_ID,
    source: sourceId,
    url: SOURCE_URL,
    accessed: ACCESSED,
    now: NOW,
  }).execute();
  const sourceRecordId = app.findFirstRecordByFilter(
    "source_records",
    "url = {:url}",
    { url: SOURCE_URL }
  ).id;

  app.db().newQuery(
    "INSERT OR IGNORE INTO import_provenance " +
      "(id, import_key, dataset, description, source, record_count, verification_status, imported_at, created, updated) VALUES " +
      "({:id}, {:key}, 'pb_migrations/1767998000_expand_san_francisco_bay_area_editorial.js', " +
      "'User-directed seven-venue Bay Area editorial expansion. Operator links, physical addresses, localities, classifications, and map coordinates were independently checked; these rows are editorial local picks rather than guide awards.', " +
      "{:source}, 7, 'verified', {:accessed}, {:now}, {:now})"
  ).bind({
    id: IMPORT_SEED_ID,
    key: IMPORT_KEY,
    source: sourceId,
    accessed: ACCESSED,
    now: NOW,
  }).execute();
  const importId = app.findFirstRecordByFilter(
    "import_provenance",
    "import_key = {:key}",
    { key: IMPORT_KEY }
  ).id;

  // ---------- seven physical venues, one in each requested locality ----------
  {
    const params = { market: MARKET, now: NOW };
    const values = rows.map((row, index) => {
      params["id" + index] = row.venueId;
      params["name" + index] = row.name;
      params["city" + index] = row.city;
      params["address" + index] = row.address;
      params["lat" + index] = row.lat;
      params["lng" + index] = row.lng;
      params["category" + index] = row.category;
      params["official" + index] = row.officialUrl;
      params["instagram" + index] = row.instagramUrl;
      params["note" + index] = row.coordNote;
      return (
        "({:id" + index + "}, {:name" + index + "}, {:city" + index +
        "}, 'United States', {:address" + index + "}, {:lat" + index +
        "}, {:lng" + index + "}, {:category" + index + "}, {:official" +
        index + "}, {:note" + index + "}, FALSE, {:market}, {:instagram" +
        index + "}, {:now}, {:now})"
      );
    });
    app.db().newQuery(
      "INSERT OR IGNORE INTO venues " +
        "(id, name, city, country, address, lat, lng, category, official_url, coord_verification_note, approx_location, market, instagram_url, created, updated) VALUES " +
        values.join(", ")
    ).bind(params).execute();
  }

  // ---------- seven Detour editorial-local-pick records; no guide assertion ----------
  {
    const params = {
      source: sourceId,
      sourceRecord: sourceRecordId,
      import: importId,
      sourceUrl: SOURCE_URL,
      now: NOW,
    };
    const values = rows.map((row, index) => {
      params["id" + index] = row.awardId;
      params["name" + index] = row.name;
      params["city" + index] = row.city;
      params["note" + index] =
        "User-directed Detour Bay Area editorial local pick; venue identity, operator links, address, and map location were independently checked on 2026-07-21.";
      return (
        "({:id" + index + "}, {:source}, " +
        "(SELECT id FROM venues WHERE name = {:name" + index +
        "} AND city = {:city" + index + "}), 2026, 'Editorial local pick', 0, " +
        "{:sourceUrl}, TRUE, {:note" + index + "}, {:sourceRecord}, {:import}, " +
        "'verified', 'editorial_local_pick', '[]', {:now}, {:now})"
      );
    });
    app.db().newQuery(
      "INSERT OR IGNORE INTO venue_awards " +
        "(id, source, venue, year, level, rank, source_url, current, verification_note, source_record, import, verification_status, provenance, occasions, created, updated) VALUES " +
        values.join(", ")
    ).bind(params).execute();
  }

  // ---------- retain route slug; expand editorial framing and map policy ----------
  app.db().newQuery(
    "UPDATE cities SET " +
      "title = 'San Francisco and the Bay Area, selected.', " +
      "tagline = '{count} current places across San Francisco, Oakland, Alameda and the Peninsula.', " +
      "footer = 'Detour is a deliberately edited San Francisco and Bay Area selection. Recognition belongs only to the named source shown; the regional additions are Detour editorial local picks rather than guide awards.', " +
      "meta_title = 'Detour — San Francisco and the Bay Area', " +
      "meta_description = 'Explore Detour’s San Francisco and Bay Area selection across the city, Oakland, Alameda and Peninsula communities, with guide recognition and Detour editorial picks clearly attributed.', " +
      "presentation = 'map', center_lat = 37.615, center_lng = -122.255, zoom = 10, " +
      "bounds_lat_min = 37.34, bounds_lat_max = 37.90, " +
      "bounds_lng_min = -122.58, bounds_lng_max = -122.00 " +
      "WHERE id = 'detcitysf000001' AND slug = 'san-francisco' AND name = 'San Francisco'"
  ).execute();
}, () => {
  // Forward-only: preserve catalogue records, provenance, and route metadata.
  return null;
});

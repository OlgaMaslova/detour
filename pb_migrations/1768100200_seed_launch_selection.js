/// <reference path="../pb_data/types.d.ts" />
//
// Seeds Detour's launch selection: five destinations and the nine places Olga
// recommends, as a complete recommendation chain.
//
// Why the whole chain and not just the places. A place is public on Detour ONLY
// because a real member recommended it — `src/data.ts` derives visibility from
// the aggregate member signal, which the server computes by joining
// `community_recommendations` to `community_waitlist_entries`. Seeding `venues`
// rows alone would produce nine places with a zero recommender count, and the
// derived rule would correctly refuse to show any of them. (Publishing a place
// with nobody behind it is exactly the bug this whole clean-up removed.) So each
// place is seeded as it would be created by the real flow:
//
//   cities                      -> the destination the place routes under
//   venues                      -> place facts, occasion tags, publication marker
//   community_waitlist_entries  -> the shared, normalized place identity
//   community_recommendations   -> Olga's own note, the reason it is public
//
// WRITE METHOD. Cities and venues go through `app.save` — neither has model
// hooks. Entries and recommendations are inserted with a single batched
// statement each, deliberately bypassing the record hooks: creating a
// `community_recommendations` record fires an after-create hook that performs
// OpenStreetMap and website enrichment over HTTP. Migrations run at boot, before
// PocketBase serves and before the health check, so any outbound HTTP here risks
// a failed deploy and — because a migration that throws is never recorded — a
// boot loop. The nightly and hourly sweeps fill website, Instagram, and cover
// image afterwards, exactly as they do for any real member recommendation; the
// values captured below already include what discovery had found.
//
// ATTRIBUTION. Every recommendation belongs to the founding member seeded by
// 1768100100, resolved by email rather than a hardcoded id. Note that one place
// (MORRIÑA D'GOZO) carried two recommenders in development — the second was a
// local test account that does not exist in a clean database — so it seeds with
// one recommender and a signal count of 1, like the rest.
//
// Idempotent and fast: 5 + 9 + 9 + 9 = 32 rows, all with pinned ids, and the
// whole seed is skipped when `venues` already holds anything.
migrate((app) => {
  const FOUNDER_EMAIL = "maslova_olga@hotmail.com";

  const CITIES = [
      {
        "id": "detcityannecy01",
        "name": "Annecy",
        "slug": "annecy",
        "country": "France",
        "presentation": "",
        "center_lat": 0,
        "center_lng": 0,
        "zoom": 0,
        "bounds_lat_min": 0,
        "bounds_lat_max": 0,
        "bounds_lng_min": 0,
        "bounds_lng_max": 0
      },
      {
        "id": "detcitybilbao01",
        "name": "Bilbao",
        "slug": "bilbao",
        "country": "Spain",
        "presentation": "",
        "center_lat": 0,
        "center_lng": 0,
        "zoom": 0,
        "bounds_lat_min": 0,
        "bounds_lat_max": 0,
        "bounds_lng_min": 0,
        "bounds_lng_max": 0
      },
      {
        "id": "detcitymadrid01",
        "name": "Madrid",
        "slug": "madrid",
        "country": "Spain",
        "presentation": "map",
        "center_lat": 40.4168,
        "center_lng": -3.7038,
        "zoom": 13,
        "bounds_lat_min": 40.2,
        "bounds_lat_max": 40.65,
        "bounds_lng_min": -3.95,
        "bounds_lng_max": -3.45
      },
      {
        "id": "detcityparis001",
        "name": "Paris",
        "slug": "paris",
        "country": "France",
        "presentation": "map",
        "center_lat": 48.8566,
        "center_lng": 2.3522,
        "zoom": 12,
        "bounds_lat_min": 48.75,
        "bounds_lat_max": 48.95,
        "bounds_lng_min": 2.2,
        "bounds_lng_max": 2.5
      },
      {
        "id": "detcitysf000001",
        "name": "San Francisco",
        "slug": "san-francisco",
        "country": "United States",
        "presentation": "map",
        "center_lat": 37.615,
        "center_lng": -122.255,
        "zoom": 10,
        "bounds_lat_min": 37.34,
        "bounds_lat_max": 37.9,
        "bounds_lng_min": -122.58,
        "bounds_lng_max": -122
      }
    ];

  const PLACES = [
      {
        "venue_id": "detvenue0000001",
        "entry_id": "detentry0000001",
        "rec_id": "detrec000000001",
        "name": "MORRIÑA D'GOZO",
        "city": "Bilbao",
        "country": "Spain",
        "address": "Calle Juan Ajuriaguerra Kalea, 29, bajo 4, Abando, 48009 Bilbao, Biscay",
        "lat": 43.2663521,
        "lng": -2.9364811,
        "category": "Dessert shop",
        "official_url": "",
        "instagram_url": "https://www.instagram.com/morrinadgozo",
        "image_url": "https://scontent-zrh1-1.cdninstagram.com/v/t51.82787-15/649558850_18096572977956942_3178308351215342352_n.jpg?stp=dst-jpg_e15_tt6&_nc_cat=107&ig_cache_key=MzgwMzI5ODkxMzkyMzM3MjM5OTE4MDk2NTcyOTc0OTU2OTQy.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkNMSVBTLnhwaWRzLjg1Mi5zZHIudmlkZW9fZGVmYXVsdF9jb3Zlcl9mcmFtZS5DMyJ9&_nc_ohc=s4rDl9IsUPEQ7kNvwHFhCOv&_nc_oc=Adq7h1wvUU-AYP1Uxc6aUdRYYXFlBYaTsEFobUHjRGXC5kssSqi10A3faxknMW7QzRI&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=scontent-zrh1-1.cdninstagram.com&_nc_gid=jLBqIZL31Wks6FUt4PPVCA&_nc_ss=7a22e&oh=00_AQAivndP7KdWZDx20_GnV7ZctUKASdTgY26S7ZPqBwlT1Q&oe=6A6FAA94�Wx",
        "coord_verification_note": "Located via OpenStreetMap Nominatim place search: Morriña D'gozo, Juan Ajuriaguerra kalea, Abando, Bilbao, Biscay, Autonomous Community of the Basque Country, 48009, Spain",
        "occasions": [
          "coffee",
          "solo_friendly",
          "family_friendly"
        ],
        "published_at": "2026-07-29 11:27:57.425Z",
        "normalized_name": "morrina dgozo",
        "normalized_city": "bilbao",
        "entry_category": "dessert_shop",
        "entry_occasions": [
          "coffee",
          "solo_friendly",
          "family_friendly"
        ],
        "note": "Loved it as well. I tried a Tiramisu-inspired one. Creamy mascarpone and a very light touch of coffee."
      },
      {
        "venue_id": "detvenue0000002",
        "entry_id": "detentry0000002",
        "rec_id": "detrec000000002",
        "name": "Chocolatería San Ginés",
        "city": "Madrid",
        "country": "Spain",
        "address": "Pasadizo de San Ginés 5, 28013 Madrid",
        "lat": 40.4167707,
        "lng": -3.706803,
        "category": "Café",
        "official_url": "",
        "instagram_url": "",
        "image_url": "https://ultimatehotchocolate.com/wp-content/uploads/2022/11/IMG_7773.jpg",
        "coord_verification_note": "",
        "occasions": [
          "coffee",
          "breakfast_brunch",
          "late_night",
          "family_friendly"
        ],
        "published_at": "2026-07-28 11:36:17.890Z",
        "normalized_name": "chocolateria san gines",
        "normalized_city": "madrid",
        "entry_category": "cafe",
        "entry_occasions": [
          "coffee",
          "breakfast_brunch",
          "family_friendly",
          "late_night"
        ],
        "note": "Churros con chocolate at any hour since 1894; there is no better way to end a long Madrid night than at this tiled counter."
      },
      {
        "venue_id": "detvenue0000003",
        "entry_id": "detentry0000003",
        "rec_id": "detrec000000003",
        "name": "Toma Café",
        "city": "Madrid",
        "country": "Spain",
        "address": "Calle de la Palma 49, 28004 Madrid",
        "lat": 40.4264905,
        "lng": -3.7058577,
        "category": "Café",
        "official_url": "https://toma.cafe/en",
        "instagram_url": "",
        "image_url": "https://cdn.shopify.com/s/files/1/0561/2172/1001/articles/Diseno_sin_titulo_2000x.jpg?v=1647438039",
        "coord_verification_note": "",
        "occasions": [
          "coffee",
          "breakfast_brunch",
          "casual_local_favorite",
          "solo_friendly"
        ],
        "published_at": "2026-07-28 11:36:17.891Z",
        "normalized_name": "toma cafe",
        "normalized_city": "madrid",
        "entry_category": "cafe",
        "entry_occasions": [
          "casual_local_favorite",
          "coffee",
          "breakfast_brunch",
          "solo_friendly"
        ],
        "note": "The little Malasaña coffee bar that kick-started Madrid's specialty scene — pull up at the window with a flat white and a pastry. Always ask about the origin of beans, you will hear a nice story!"
      },
      {
        "venue_id": "detvenue0000004",
        "entry_id": "detentry0000004",
        "rec_id": "detrec000000004",
        "name": "Candelaria",
        "city": "Paris",
        "country": "France",
        "address": "52 Rue de Saintonge, 75003 Paris",
        "lat": 48.8629856,
        "lng": 2.3640177,
        "category": "Cocktail bar",
        "official_url": "",
        "instagram_url": "",
        "image_url": "https://candelaria-paris.com/photos/bar/highball.jpg",
        "coord_verification_note": "",
        "occasions": [
          "drinks_nightcap",
          "date_night",
          "group_gathering",
          "late_night"
        ],
        "published_at": "2026-07-28 11:36:17.892Z",
        "normalized_name": "candelaria",
        "normalized_city": "paris",
        "entry_category": "cocktail_bar",
        "entry_occasions": [
          "drinks_nightcap",
          "date_night",
          "group_gathering",
          "late_night"
        ],
        "note": "A hidden Marais cocktail bar behind a taqueria — knock, squeeze in, and order the Guêpe Verte; the mezcal list is superb."
      },
      {
        "venue_id": "detvenue0000005",
        "entry_id": "detentry0000005",
        "rec_id": "detrec000000005",
        "name": "Du Pain et des Idées",
        "city": "Paris",
        "country": "France",
        "address": "34 Rue Yves Toudic, 75010 Paris",
        "lat": 48.871197,
        "lng": 2.3628861,
        "category": "Bakery",
        "official_url": "https://www.dupainetdesidees.com",
        "instagram_url": "https://www.instagram.com/dupainetdesidees/",
        "image_url": "https://cdn.prod.website-files.com/68d3ac079a10da70917c11f6/68e5135e8c8a443985d7c7d4_dpdi_image_10.webp",
        "coord_verification_note": "",
        "occasions": [
          "bakery",
          "breakfast_brunch",
          "quick_bite",
          "casual_local_favorite"
        ],
        "published_at": "2026-07-28 11:36:17.891Z",
        "normalized_name": "du pain et des idees",
        "normalized_city": "paris",
        "entry_category": "bakery",
        "entry_occasions": [
          "casual_local_favorite",
          "bakery",
          "quick_bite",
          "breakfast_brunch"
        ],
        "note": "Stéphane's escargot pistache-chocolat and pain des amis make this the Paris bakery I plan whole mornings around."
      },
      {
        "venue_id": "detvenue0000006",
        "entry_id": "detentry0000006",
        "rec_id": "detrec000000006",
        "name": "Le Comptoir du Relais",
        "city": "Paris",
        "country": "France",
        "address": "9 Carrefour de l'Odéon, 75006 Paris",
        "lat": 48.8518946,
        "lng": 2.3388464,
        "category": "Restaurant",
        "official_url": "https://www.hotel-paris-relais-saint-germain.com/restaurant-le-comptoir",
        "instagram_url": "",
        "image_url": "https://prismic-io.s3.amazonaws.com/hotelrsg/d3d4ad28-bf15-4c98-ba19-5cc5a05c3c5a_brasserie-le-comptoir.jpg",
        "coord_verification_note": "",
        "occasions": [
          "neighborhood_meal",
          "date_night",
          "casual_local_favorite",
          "outdoor_seating"
        ],
        "published_at": "2026-07-28 11:36:17.891Z",
        "normalized_name": "le comptoir du relais",
        "normalized_city": "paris",
        "entry_category": "restaurant",
        "entry_occasions": [
          "casual_local_favorite",
          "neighborhood_meal",
          "date_night",
          "outdoor_seating"
        ],
        "note": "Camdeborde's Odéon bistro does the platonic steak and terrine; grab a pavement table for lunch and watch the sixth go by."
      },
      {
        "venue_id": "detvenue0000007",
        "entry_id": "detentry0000007",
        "rec_id": "detrec000000007",
        "name": "Swan Oyster Depot",
        "city": "San Francisco",
        "country": "United States",
        "address": "1517 Polk St, San Francisco, CA 94109",
        "lat": 37.7909693,
        "lng": -122.4209185,
        "category": "Restaurant",
        "official_url": "",
        "instagram_url": "",
        "image_url": "",
        "coord_verification_note": "",
        "occasions": [
          "casual_local_favorite",
          "neighborhood_meal",
          "solo_friendly",
          "quick_bite"
        ],
        "published_at": "2026-07-28 11:36:17.889Z",
        "normalized_name": "swan oyster depot",
        "normalized_city": "san francisco",
        "entry_category": "restaurant",
        "entry_occasions": [
          "casual_local_favorite",
          "neighborhood_meal",
          "solo_friendly",
          "quick_bite"
        ],
        "note": "A tiny marble counter with the freshest oysters and crab in the city; go solo, sit down, and let the countermen feed you."
      },
      {
        "venue_id": "detvenue0000008",
        "entry_id": "detentry0000008",
        "rec_id": "detrec000000008",
        "name": "Tartine Bakery",
        "city": "San Francisco",
        "country": "United States",
        "address": "600 Guerrero St, San Francisco, CA 94110",
        "lat": 37.7614552,
        "lng": -122.4239452,
        "category": "Bakery",
        "official_url": "https://tartinebakery.com",
        "instagram_url": "https://www.instagram.com/tartinebakery",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRfMX3ZSVkH8X_UaRQIcCh94jAmlH1mjQ6-8AInwPZMpfwRWYBYmhX5jAg&s=10",
        "coord_verification_note": "",
        "occasions": [
          "bakery",
          "breakfast_brunch",
          "coffee",
          "casual_local_favorite"
        ],
        "published_at": "2026-07-28 11:36:17.889Z",
        "normalized_name": "tartine bakery",
        "normalized_city": "san francisco",
        "entry_category": "bakery",
        "entry_occasions": [
          "casual_local_favorite",
          "coffee",
          "bakery",
          "breakfast_brunch"
        ],
        "note": "Tartine's morning bun and country bread are worth the Guerrero Street queue — my favourite unhurried San Francisco breakfast. And, please, please, try the bread!"
      },
      {
        "venue_id": "detvenue0000009",
        "entry_id": "detentry0000009",
        "rec_id": "detrec000000009",
        "name": "Trick Dog",
        "city": "San Francisco",
        "country": "United States",
        "address": "3010 20th St, San Francisco, CA 94110",
        "lat": 37.7592203,
        "lng": -122.4111877,
        "category": "Cocktail bar",
        "official_url": "https://www.trickdogbar.com",
        "instagram_url": "",
        "image_url": "https://www.theworlds50best.com/discovery/filestore/jpg/TrickDog-SanFransico-USA-03.jpg",
        "coord_verification_note": "",
        "occasions": [
          "drinks_nightcap",
          "date_night",
          "group_gathering",
          "late_night"
        ],
        "published_at": "2026-07-28 11:36:17.889Z",
        "normalized_name": "trick dog",
        "normalized_city": "san francisco",
        "entry_category": "cocktail_bar",
        "entry_occasions": [
          "drinks_nightcap",
          "date_night",
          "group_gathering",
          "late_night"
        ],
        "note": "The cleverest cocktail menu in the Mission — the theme changes every few months and the upstairs tables are perfect at dusk."
      }
    ];

  let founder;
  try {
    founder = app.findFirstRecordByFilter("members", "email = {:email}", {
      email: FOUNDER_EMAIL,
    });
  } catch (error) {
    throw new Error(
      "Cannot seed the launch selection: the founding member " +
        FOUNDER_EMAIL +
        " was not found. Migration 1768100100 must run first. (" + error + ")"
    );
  }

  // Cities are seeded independently of the places: a destination is worth
  // publishing even before it has its first recommendation.
  const cityCollection = app.findCollectionByNameOrId("cities");
  let citiesCreated = 0;
  for (const city of CITIES) {
    try {
      app.findFirstRecordByFilter(cityCollection.id, "slug = {:slug}", { slug: city.slug });
      continue;
    } catch {
      // Not present — create it.
    }
    const record = new Record(cityCollection);
    record.set("id", city.id);
    record.set("name", city.name);
    record.set("slug", city.slug);
    record.set("country", city.country);
    // Map-led only when a centre, a zoom AND the metro bounding box are all
    // present; anything less stays list-first rather than render a broken map.
    if (city.presentation) {
      record.set("presentation", city.presentation);
      record.set("center_lat", city.center_lat);
      record.set("center_lng", city.center_lng);
      record.set("zoom", city.zoom);
      record.set("bounds_lat_min", city.bounds_lat_min);
      record.set("bounds_lat_max", city.bounds_lat_max);
      record.set("bounds_lng_min", city.bounds_lng_min);
      record.set("bounds_lng_max", city.bounds_lng_max);
    }
    app.save(record);
    citiesCreated++;
  }
  console.log("launch seed: created " + citiesCreated + " of " + CITIES.length + " cities");

  if (app.countRecords("venues") > 0) {
    console.log("launch seed: venues already present; places left untouched");
    return;
  }

  const venueCollection = app.findCollectionByNameOrId("venues");
  for (const place of PLACES) {
    const venue = new Record(venueCollection);
    venue.set("id", place.venue_id);
    venue.set("name", place.name);
    venue.set("city", place.city);
    venue.set("country", place.country);
    venue.set("address", place.address);
    venue.set("lat", place.lat);
    venue.set("lng", place.lng);
    venue.set("category", place.category);
    venue.set("official_url", place.official_url);
    venue.set("instagram_url", place.instagram_url);
    venue.set("image_url", place.image_url);
    venue.set("coord_verification_note", place.coord_verification_note);
    venue.set("approx_location", false);
    venue.set("occasions", place.occasions);
    // Published, and never suppressed: a curator takedown is the only thing that
    // sets `suppressed`, and nothing has been taken down in a fresh database.
    venue.set("published", true);
    venue.set("published_at", place.published_at);
    venue.set("suppressed", false);
    app.save(venue);
  }
  console.log("launch seed: created " + PLACES.length + " venues");

  // PocketBase stores autodate columns as text with a space separator.
  const nowSql = new Date().toISOString().replace("T", " ");

  // One batched INSERT per table, hooks deliberately bypassed (see header).
  const entryCols =
    "id, venue_name, city, country, normalized_name, normalized_city, status, " +
    "signal_count, participants, canonical_venue, published_venue, published_at, " +
    "publication_audit_id, address, category, occasions, official_url, " +
    "instagram_url, image_url, publication_notification_sent_at, created, updated";
  const entryRows = [];
  const entryParams = {};
  PLACES.forEach((place, i) => {
    entryRows.push(
      "({:e" + i + "id}, {:e" + i + "vn}, {:e" + i + "ci}, {:e" + i + "co}, {:e" + i +
      "nn}, {:e" + i + "nc}, 'published', 1, {:e" + i + "pa}, {:e" + i + "cv}, {:e" + i +
      "pv}, {:e" + i + "pat}, {:e" + i + "aud}, {:e" + i + "ad}, {:e" + i + "cat}, {:e" +
      i + "occ}, {:e" + i + "ou}, {:e" + i + "iu}, {:e" + i + "img}, '', {:now}, {:now})"
    );
    entryParams["e" + i + "id"] = place.entry_id;
    entryParams["e" + i + "vn"] = place.name;
    entryParams["e" + i + "ci"] = place.city;
    entryParams["e" + i + "co"] = place.country;
    entryParams["e" + i + "nn"] = place.normalized_name;
    entryParams["e" + i + "nc"] = place.normalized_city;
    entryParams["e" + i + "pa"] = JSON.stringify([founder.id]);
    entryParams["e" + i + "cv"] = place.venue_id;
    entryParams["e" + i + "pv"] = place.venue_id;
    entryParams["e" + i + "pat"] = place.published_at;
    entryParams["e" + i + "aud"] = "community-seed-" + place.entry_id;
    entryParams["e" + i + "ad"] = place.address;
    entryParams["e" + i + "cat"] = place.entry_category;
    entryParams["e" + i + "occ"] = JSON.stringify(place.entry_occasions);
    entryParams["e" + i + "ou"] = place.official_url;
    entryParams["e" + i + "iu"] = place.instagram_url;
    entryParams["e" + i + "img"] = place.image_url;
  });
  entryParams["now"] = nowSql;
  app
    .db()
    .newQuery(
      "INSERT INTO community_waitlist_entries (" + entryCols + ") VALUES " +
        entryRows.join(", ")
    )
    .bind(entryParams)
    .execute();
  console.log("launch seed: inserted " + PLACES.length + " waiting-list entries");

  const recCols =
    "id, waitlist, member, note, venue_name, city, country, address, category, " +
    "occasions, created, updated";
  const recRows = [];
  const recParams = { member: founder.id, now: nowSql };
  PLACES.forEach((place, i) => {
    recRows.push(
      "({:r" + i + "id}, {:r" + i + "wl}, {:member}, {:r" + i + "note}, {:r" + i +
      "vn}, {:r" + i + "ci}, {:r" + i + "co}, {:r" + i + "ad}, {:r" + i + "cat}, {:r" +
      i + "occ}, {:now}, {:now})"
    );
    recParams["r" + i + "id"] = place.rec_id;
    recParams["r" + i + "wl"] = place.entry_id;
    recParams["r" + i + "note"] = place.note;
    recParams["r" + i + "vn"] = place.name;
    recParams["r" + i + "ci"] = place.city;
    recParams["r" + i + "co"] = place.country;
    recParams["r" + i + "ad"] = place.address;
    recParams["r" + i + "cat"] = place.entry_category;
    recParams["r" + i + "occ"] = JSON.stringify(place.entry_occasions);
  });
  app
    .db()
    .newQuery("INSERT INTO community_recommendations (" + recCols + ") VALUES " + recRows.join(", "))
    .bind(recParams)
    .execute();
  console.log(
    "launch seed: inserted " + PLACES.length + " recommendations by " + FOUNDER_EMAIL
  );
}, (app) => {
  // Reversible: remove exactly the rows this seed pins, children first.
  //
  // Deliberately matched on the exact pinned ids rather than a `id LIKE 'det%'`
  // prefix. PocketBase generates random 15-character lowercase-alphanumeric ids,
  // so a prefix match would eventually delete a real member-created row that
  // happened to start with those three letters.
  const PINNED = {
    community_recommendations: [
      "detrec000000001", "detrec000000002", "detrec000000003",
      "detrec000000004", "detrec000000005", "detrec000000006",
      "detrec000000007", "detrec000000008", "detrec000000009",
    ],
    community_waitlist_entries: [
      "detentry0000001", "detentry0000002", "detentry0000003",
      "detentry0000004", "detentry0000005", "detentry0000006",
      "detentry0000007", "detentry0000008", "detentry0000009",
    ],
    venues: [
      "detvenue0000001", "detvenue0000002", "detvenue0000003",
      "detvenue0000004", "detvenue0000005", "detvenue0000006",
      "detvenue0000007", "detvenue0000008", "detvenue0000009",
    ],
    cities: [
      "detcitymadrid01", "detcityparis001", "detcitysf000001",
      "detcitybilbao01", "detcityannecy01",
    ],
  };

  for (const table of [
    "community_recommendations",
    "community_waitlist_entries",
    "venues",
    "cities",
  ]) {
    const ids = PINNED[table];
    const params = {};
    const placeholders = ids.map((id, i) => {
      params["id" + i] = id;
      return "{:id" + i + "}";
    });
    try {
      app
        .db()
        .newQuery(
          "DELETE FROM " + table + " WHERE id IN (" + placeholders.join(", ") + ")"
        )
        .bind(params)
        .execute();
    } catch {
      // Table already gone.
    }
  }
});

/// <reference path="../pb_data/types.d.ts" />
//
// Seeds nine member-recommended places on the public Detourist List — three
// each in San Francisco, Madrid, and Paris — attributed to Olga (the Founder
// issuer account). Each place is published through the same data contract the
// live waiting-list loop produces: a canonical venue, a current
// "Detour community selection" award (the single member-recommended lane the
// public catalogue folds into `detouristList`), a published waiting-list entry
// with Olga as its sole participant, and Olga's own recommendation signal.
//
// Why the venue/award/entry go through app.save but the recommendation is a
// direct INSERT: creating a `community_recommendations` record fires the
// after-create hook (main.pb.js), which runs external OpenStreetMap/website
// enrichment. Migrations run at boot before the health check, so that HTTP must
// never happen here — the INSERT bypasses the hook. Coordinates are seeded so
// the map pins render immediately; the existing nightly/hourly sweeps
// (level = "Detour community selection" && current) fill each venue's website,
// Instagram, and cover image afterwards, exactly as they do for any real
// member recommendation.
//
// Forward-only and idempotent: every venue, award, entry, and recommendation is
// looked up before it is created, so an interrupted boot converges without
// duplicates and never touches an unrelated catalogue row.
migrate((app) => {
  const community = require(__hooks + "/community_waitlist.js");
  const OLGA_ID = "sh86mgpuicyisau";
  const OLGA_EMAIL = "olga@supernaut.dev";
  const YEAR = new Date().getUTCFullYear();
  const NOW_ISO = new Date().toISOString();
  // PocketBase stores autodate columns as text with a space separator.
  const NOW_SQL = NOW_ISO.replace("T", " ");

  // Human labels written to the public venue category, keyed by the raw select
  // value stored on the entry/recommendation. Mirrors PLACE_CATEGORY_LABELS in
  // pb_hooks/community_waitlist.js.
  const CATEGORY_LABELS = {
    restaurant: "Restaurant",
    cafe: "Café",
    bakery: "Bakery",
    bar: "Bar",
    cocktail_bar: "Cocktail bar",
  };

  // Resolve Olga's member account. The immutable id is the same one bound for
  // Founder invitation provenance in
  // pb_migrations/1768006000_add_founder_invitation_fast_track.js; the email is
  // a fallback so the seed still finds her if that id differs on an environment.
  let olga;
  try {
    olga = app.findRecordById("members", OLGA_ID);
  } catch {
    try {
      olga = app.findFirstRecordByFilter("members", "email = {:email}", {
        email: OLGA_EMAIL,
      });
    } catch {
      throw new Error(
        "Cannot seed Olga's Detourist recommendations: her member account was not found."
      );
    }
  }

  // The single Detour community lane source.
  let source;
  try {
    source = app.findFirstRecordByFilter(
      "guide_sources",
      "slug = 'detour-community'"
    );
  } catch {
    source = new Record(app.findCollectionByNameOrId("guide_sources"));
    source.set("name", "Detour community");
    source.set("slug", "detour-community");
    source.set("official_url", "");
    source.set("current_year", YEAR);
    app.save(source);
  }

  const venuesCollection = app.findCollectionByNameOrId("venues");
  const awardsCollection = app.findCollectionByNameOrId("venue_awards");
  const entriesCollection = app.findCollectionByNameOrId(
    "community_waitlist_entries"
  );

  // [recId, name, market, city, country, address, category, lat, lng, occasions, note]
  // recId is a fixed 15-char id so the recommendation INSERT is retry-safe.
  const PLACES = [
    // ---------- San Francisco ----------
    {
      recId: "olgadtr00000001",
      name: "Tartine Bakery",
      market: "San Francisco",
      city: "San Francisco",
      country: "United States",
      address: "600 Guerrero St, San Francisco, CA 94110",
      category: "bakery",
      lat: 37.7614552,
      lng: -122.4239452,
      occasions: ["bakery", "breakfast_brunch", "coffee", "casual_local_favorite"],
      note: "Tartine's morning bun and country bread are worth the Guerrero Street queue — my favourite unhurried San Francisco breakfast.",
    },
    {
      recId: "olgadtr00000002",
      name: "Swan Oyster Depot",
      market: "San Francisco",
      city: "San Francisco",
      country: "United States",
      address: "1517 Polk St, San Francisco, CA 94109",
      category: "restaurant",
      lat: 37.7909693,
      lng: -122.4209185,
      occasions: ["casual_local_favorite", "neighborhood_meal", "solo_friendly", "quick_bite"],
      note: "A tiny marble counter with the freshest oysters and crab in the city; go solo, sit down, and let the countermen feed you.",
    },
    {
      recId: "olgadtr00000003",
      name: "Trick Dog",
      market: "San Francisco",
      city: "San Francisco",
      country: "United States",
      address: "3010 20th St, San Francisco, CA 94110",
      category: "cocktail_bar",
      lat: 37.7592203,
      lng: -122.4111877,
      occasions: ["drinks_nightcap", "date_night", "group_gathering", "late_night"],
      note: "The cleverest cocktail menu in the Mission — the theme changes every few months and the upstairs tables are perfect at dusk.",
    },
    // ---------- Madrid ----------
    {
      recId: "olgadtr00000004",
      name: "Bodega de la Ardosa",
      market: "",
      city: "Madrid",
      country: "Spain",
      address: "Calle de Colón 13, 28004 Madrid",
      category: "bar",
      lat: 40.4237686,
      lng: -3.7017746,
      occasions: ["drinks_nightcap", "casual_local_favorite", "neighborhood_meal", "group_gathering"],
      note: "A century-old Malasaña taberna for vermut on tap and the best homemade salmorejo — my first stop whenever I land in Madrid.",
    },
    {
      recId: "olgadtr00000005",
      name: "Chocolatería San Ginés",
      market: "",
      city: "Madrid",
      country: "Spain",
      address: "Pasadizo de San Ginés 5, 28013 Madrid",
      category: "cafe",
      lat: 40.4167707,
      lng: -3.706803,
      occasions: ["coffee", "breakfast_brunch", "late_night", "family_friendly"],
      note: "Churros con chocolate at any hour since 1894; there is no better way to end a long Madrid night than at this tiled counter.",
    },
    {
      recId: "olgadtr00000006",
      name: "Toma Café",
      market: "",
      city: "Madrid",
      country: "Spain",
      address: "Calle de la Palma 49, 28004 Madrid",
      category: "cafe",
      lat: 40.4264905,
      lng: -3.7058577,
      occasions: ["coffee", "breakfast_brunch", "casual_local_favorite", "solo_friendly"],
      note: "The little Malasaña coffee bar that kick-started Madrid's specialty scene — pull up at the window with a flat white and a pastry.",
    },
    // ---------- Paris ----------
    {
      recId: "olgadtr00000007",
      name: "Du Pain et des Idées",
      market: "",
      city: "Paris",
      country: "France",
      address: "34 Rue Yves Toudic, 75010 Paris",
      category: "bakery",
      lat: 48.871197,
      lng: 2.3628861,
      occasions: ["bakery", "breakfast_brunch", "quick_bite", "casual_local_favorite"],
      note: "Stéphane's escargot pistache-chocolat and pain des amis make this the Paris bakery I plan whole mornings around.",
    },
    {
      recId: "olgadtr00000008",
      name: "Le Comptoir du Relais",
      market: "",
      city: "Paris",
      country: "France",
      address: "9 Carrefour de l'Odéon, 75006 Paris",
      category: "restaurant",
      lat: 48.8518946,
      lng: 2.3388464,
      occasions: ["neighborhood_meal", "date_night", "casual_local_favorite", "outdoor_seating"],
      note: "Camdeborde's Odéon bistro does the platonic steak and terrine; grab a pavement table for lunch and watch the sixth go by.",
    },
    {
      recId: "olgadtr00000009",
      name: "Candelaria",
      market: "",
      city: "Paris",
      country: "France",
      address: "52 Rue de Saintonge, 75003 Paris",
      category: "cocktail_bar",
      lat: 48.8629856,
      lng: 2.3640177,
      occasions: ["drinks_nightcap", "date_night", "group_gathering", "late_night"],
      note: "A hidden Marais cocktail bar behind a taqueria — knock, squeeze in, and order the Guêpe Verte; the mezcal list is superb.",
    },
  ];

  for (const place of PLACES) {
    const normalizedName = community.normalizePlacePart(place.name);
    const normalizedCity = community.normalizePlacePart(place.city);
    const categoryLabel = CATEGORY_LABELS[place.category] || "";

    // 1) Canonical venue (idempotent by name + city).
    let venue;
    try {
      venue = app.findFirstRecordByFilter(
        "venues",
        "name = {:name} && city = {:city}",
        { name: place.name, city: place.city }
      );
    } catch {
      venue = new Record(venuesCollection);
      venue.set("name", place.name);
      venue.set("city", place.city);
      if (place.market) venue.set("market", place.market);
      venue.set("country", place.country);
      venue.set("address", place.address);
      venue.set("category", categoryLabel);
      venue.set("lat", place.lat);
      venue.set("lng", place.lng);
      venue.set("approx_location", false);
      app.save(venue);
    }

    // 2) Current Detour community selection award (idempotent). The venue_awards
    // onRecordCreate hook also stamps provenance; it is set here as well so the
    // lane is correct even if that hook is not active.
    let award;
    try {
      award = app.findFirstRecordByFilter(
        "venue_awards",
        "source = {:source} && venue = {:venue} && year = {:year} && level = {:level}",
        {
          source: source.id,
          venue: venue.id,
          year: YEAR,
          level: "Detour community selection",
        }
      );
    } catch {
      award = new Record(awardsCollection);
      award.set("source", source.id);
      award.set("venue", venue.id);
      award.set("year", YEAR);
      award.set("level", "Detour community selection");
      award.set("rank", 0);
      award.set("source_url", "");
      award.set("current", true);
      award.set("verification_status", "verified");
      award.set("provenance", "community_selection");
      award.set("occasions", place.occasions);
      app.save(award);
    }
    if (!award.getBool("current")) {
      award.set("current", true);
      app.save(award);
    }

    // 3) Published waiting-list entry, with Olga as its sole participant
    // (idempotent by normalized place identity).
    let entry;
    try {
      entry = app.findFirstRecordByFilter(
        "community_waitlist_entries",
        "normalized_name = {:name} && normalized_city = {:city}",
        { name: normalizedName, city: normalizedCity }
      );
    } catch {
      entry = new Record(entriesCollection);
      entry.set("venue_name", place.name);
      entry.set("city", place.city);
      entry.set("country", place.country);
      entry.set("address", place.address);
      entry.set("normalized_name", normalizedName);
      entry.set("normalized_city", normalizedCity);
      entry.set("category", place.category);
      entry.set("occasions", place.occasions);
      entry.set("signal_count", 1);
      entry.set("participants", [olga.id]);
      entry.set("canonical_venue", venue.id);
      entry.set("published_venue", venue.id);
      entry.set("published_award", award.id);
      entry.set("status", "published");
      entry.set("published_at", NOW_ISO);
      entry.set("publication_audit_id", "community-seed-" + place.recId);
      app.save(entry);
    }

    // 4) Olga's recommendation signal. Inserted directly so the after-create
    // enrichment hook (external HTTP) never runs during boot. Idempotent via the
    // fixed id and the member/waitlist existence check.
    let existingRec = null;
    try {
      existingRec = app.findFirstRecordByFilter(
        "community_recommendations",
        "member = {:member} && waitlist = {:waitlist}",
        { member: olga.id, waitlist: entry.id }
      );
    } catch {
      existingRec = null;
    }
    if (!existingRec) {
      app
        .db()
        .newQuery(
          "INSERT INTO community_recommendations " +
            "(id, member, waitlist, note, venue_name, city, country, address, category, occasions, created, updated) VALUES " +
            "({:id}, {:member}, {:waitlist}, {:note}, {:venue_name}, {:city}, {:country}, {:address}, {:category}, {:occasions}, {:created}, {:updated})"
        )
        .bind({
          id: place.recId,
          member: olga.id,
          waitlist: entry.id,
          note: place.note,
          venue_name: place.name,
          city: place.city,
          country: place.country,
          address: place.address,
          category: place.category,
          occasions: JSON.stringify(place.occasions),
          created: NOW_SQL,
          updated: NOW_SQL,
        })
        .execute();
    }
  }
}, () => {
  // Forward-only: these are public catalogue selections and member attribution,
  // retained across migration-history rollback like every other published lane.
  return null;
});

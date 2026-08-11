/// <reference path="../pb_data/types.d.ts" />
//
// Imported lists: reading a pasted link, and the member's own lists.
//
// Everything these routes do lives in pb_hooks/guides.js — this file is
// the registration, because only `*.pb.js` files register anything and hook
// callbacks run in isolated VMs, so each one requires the module inside its own
// body.
//
// FOUR ROUTES AND NO FIFTH THAT READS ACROSS MEMBERS. Every one of these is
// scoped to `e.auth.id` in its own query, and there is no projection over either
// collection — the same rule Wanna go carries, because these places sit on the
// same tab. No route may report that a place was imported by anybody, or how
// often, or by how many.
//
// READING IS NOT SAVING. `POST /lists/read` writes nothing at all: it fetches
// the page, reports what it found, and leaves. The member sees the list, renames
// it, unchecks what they do not want, and only then does `POST /lists` write.
// That split is the feature — thirty-eight places arriving unasked is the
// failure this design exists to avoid.

/**
 * Read a pasted list page and report what is on it. Writes nothing.
 *
 * Answers 200 with `resolved: false` when the link cannot be read, rather than
 * an error: an unreadable link is an ordinary outcome of pasting a link, and the
 * member has lost nothing. Nothing in this feature may be made to depend on a
 * page having been readable.
 *
 * Each place comes back with two flags the review screen needs and the member
 * cannot work out for themselves: `matched`, meaning Detour already has this
 * place because somebody recommended it, and `already_have`, meaning it is
 * already on their own list.
 */
routerAdd(
  "POST",
  "/api/detour/guides/read",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const lists = require(__hooks + "/guides.js");
    community.requireVerifiedMember(e.auth, "importing a list of places");

    const body = e.requestInfo().body || {};
    const url = lists.listPageUrl(body.url);
    if (!url) {
      return e.json(200, { resolved: false, reason: "That does not look like a link." });
    }

    const read = lists.readListPage(url);
    if (!read || !read.places.length) {
      return e.json(200, {
        resolved: false,
        reason: "We could not find a list of places on that page.",
      });
    }

    // One city for the whole list. A published list is almost always about one
    // city and almost never says so per place, and the match against Detour's
    // catalogue needs one — so it is guessed here and stays editable on the
    // review screen, where the member knows the answer and the guess does not.
    const city = guessCity(e.app, read, lists);
    const normalizedListCity = lists.normalizePlacePart(city);
    const seenList = lists.findGuideBySource(e.app, e.auth.id, url);
    const places = [];
    for (const place of read.places) {
      const placeCity = place.city || city;
      const normalizedName = lists.normalizePlacePart(place.name);
      const normalizedCity = lists.normalizePlacePart(placeCity);
      const matchedVenue = lists.matchPublishedVenue(
        e.app,
        normalizedName,
        normalizedCity,
        normalizedListCity
      );
      const existing = lists.findImportedPlace(e.app, e.auth.id, normalizedName, normalizedCity);
      places.push({
        name: place.name,
        area: place.area,
        address: place.address,
        city: placeCity,
        country: place.country,
        excerpt: place.excerpt,
        image_url: place.image || "",
        category: place.category || "",
        cuisine: place.cuisine || "",
        matched_venue: matchedVenue,
        matched: Boolean(matchedVenue),
        already_have: Boolean(existing),
      });
    }

    return e.json(200, {
      resolved: true,
      url,
      title: read.title,
      source: read.source,
      city,
      read_by: read.readBy,
      // A second paste of a link already imported refreshes that list rather
      // than making another. The review screen says so.
      known_list: seenList ? seenList.id : "",
      known_list_title: seenList ? seenList.getString("title") : "",
      places,
    });

    /**
     * One city for the list: whatever the page said most often, else a city
     * Detour already routes places under whose name is in the headline.
     *
     * The catalogue is consulted rather than a geocoder because the answer only
     * has to be good enough to prefill a field the member can correct, and
     * because a city Detour does not route under is a city no imported place can
     * match a recommendation in anyway.
     */
    function guessCity(app, result, module) {
      const tally = {};
      let best = "";
      let bestCount = 0;
      for (const place of result.places) {
        const value = module.cleanText(place.city, 120);
        if (!value) continue;
        tally[value] = (tally[value] || 0) + 1;
        if (tally[value] > bestCount) {
          best = value;
          bestCount = tally[value];
        }
      }
      if (best) return best;

      const title = String(result.title || "").toLowerCase();
      if (!title) return "";
      let cities;
      try {
        cities = app.findRecordsByFilter("cities", "id != ''", "name", 500, 0);
      } catch {
        return "";
      }
      let match = "";
      for (const city of cities) {
        const name = city.getString("name");
        if (!name) continue;
        // Longest name wins, so "New York" is not beaten by a city called "York".
        if (title.indexOf(name.toLowerCase()) !== -1 && name.length > match.length) {
          match = name;
        }
      }
      return match;
    }
  },
  $apis.requireAuth("members")
);

/**
 * Keep a list. The only write path this feature has.
 *
 * Takes the places the member left checked, not the places the page had: the
 * review screen is the member choosing, and re-reading the page here would
 * quietly reinstate what they unchecked. The names are theirs to have edited by
 * then, so everything is re-normalized and re-matched on the way in rather than
 * trusted from the read.
 *
 * Idempotent by the same index the schema carries. A place the member already
 * holds gains this list and keeps everything else it had — importing a second
 * list that overlaps the first adds a heading, never a duplicate.
 */
routerAdd(
  "POST",
  "/api/detour/guides",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const lists = require(__hooks + "/guides.js");
    community.requireVerifiedMember(e.auth, "keeping a list of places");

    const body = e.requestInfo().body || {};
    const url = lists.listPageUrl(body.url);
    if (!url) throw new BadRequestError("That list has no readable source link.");

    const incoming = Array.isArray(body.places) ? body.places : [];
    if (!incoming.length) throw new BadRequestError("Choose at least one place to keep.");
    if (incoming.length > lists.MAX_LIST_PLACES) {
      throw new BadRequestError("That is more places than one list can hold.");
    }

    const title = lists.cleanText(body.title, 200);
    if (!title) throw new BadRequestError("Give the list a name.");
    const listCity = lists.cleanText(body.city, 120);

    // A second paste of the same link is the same list. Renaming through this
    // path is deliberate: the member has just been shown the name and had the
    // chance to change it.
    let list = lists.findGuideBySource(e.app, e.auth.id, url);
    if (!list) {
      list = new Record(e.app.findCollectionByNameOrId("community_guides"));
      list.set("member", e.auth.id);
      list.set("source_url", url);
      list.set("source_title", lists.cleanText(body.source_title || body.title, 200));
    }
    list.set("title", title);
    list.set("source_name", lists.cleanText(body.source, 120));
    list.set("city", listCity);
    list.set("normalized_city", lists.normalizePlacePart(listCity));
    const readBy = String(body.read_by || "");
    if (["json_ld", "structured", "model"].indexOf(readBy) !== -1) list.set("read_by", readBy);
    e.app.save(list);

    const collection = e.app.findCollectionByNameOrId("community_imported_places");
    let kept = 0;
    let joined = 0;
    for (const entry of incoming) {
      if (!entry || typeof entry !== "object") continue;
      const name = lists.cleanText(entry.name, 200);
      if (!name) continue;
      // ONE DESTINATION PER GUIDE-CITY, and the borough is a neighbourhood.
      //
      // Publications file by borough: Eater's New York guide gives Astoria, the
      // Bronx and Jackson Heights alongside New York, and taking each at face
      // value turned one guide into four destinations on the wishlist. A
      // destination is city-level, so the city the member confirmed wins and the
      // borough goes where a neighbourhood belongs — `area`, which is what the
      // card already prints beside the name.
      //
      // Geocoding is unaffected: it queries the address with both, and the
      // claimed-city guard accepts either.
      const ownCity = lists.cleanText(entry.city, 120);
      const city = listCity || ownCity;
      let area = lists.cleanText(entry.area, 120);
      if (!area && ownCity && listCity && ownCity !== listCity) area = ownCity;
      const normalizedName = lists.normalizePlacePart(name);
      const normalizedCity = lists.normalizePlacePart(city);
      if (!normalizedName) continue;

      let record = lists.findImportedPlace(e.app, e.auth.id, normalizedName, normalizedCity);
      const isNew = !record;
      if (!record) {
        record = new Record(collection);
        record.set("member", e.auth.id);
        record.set("name", name);
        record.set("area", area);
        record.set("city", city);
        record.set("country", lists.cleanText(entry.country, 120));
        record.set("address", lists.cleanText(entry.address, 300));
        record.set("excerpt", lists.cleanText(entry.excerpt, 400));
        // Pointed at, never fetched — see the field's note in the migration.
        record.set("image_url", lists.publicImageUrl(entry.image_url));
        // The publication's own answer to "what is this?", checked against the
        // closed set the catalogue uses. Anything else is dropped rather than
        // stored: a value the app cannot render or filter by is worse than none.
        record.set("category", lists.importedCategory(entry.category));
        record.set("cuisine", lists.cleanText(entry.cuisine, 60));
        record.set("source_url", url);
        record.set("normalized_name", normalizedName);
        record.set("normalized_city", normalizedCity);
        record.set(
          "matched_venue",
          lists.matchPublishedVenue(
            e.app,
            normalizedName,
            normalizedCity,
            list.getString("normalized_city")
          )
        );
      }

      // The place joins this list, keeping every list it already belonged to.
      const current = record.get("guides") || [];
      if (current.indexOf(list.id) === -1) {
        record.set("guides", current.concat([list.id]));
        if (!isNew) joined += 1;
      } else if (!isNew) {
        continue; // already on this list, nothing to write
      }

      try {
        e.app.save(record);
        if (isNew) kept += 1;
      } catch (error) {
        // The unique index is the concurrency guard: a double-submitted review
        // screen loses here rather than writing a second row. The member's
        // intent — the place is on the list — is satisfied either way.
        const raced = lists.findImportedPlace(e.app, e.auth.id, normalizedName, normalizedCity);
        if (!raced) throw error;
        const racedGuides = raced.get("guides") || [];
        if (racedGuides.indexOf(list.id) === -1) {
          raced.set("guides", racedGuides.concat([list.id]));
          e.app.save(raced);
        }
      }
    }

    return e.json(200, { guide: list.id, kept, joined });
  },
  $apis.requireAuth("members")
);

/**
 * The caller's own lists, newest first, each with its places.
 *
 * The only read this feature has, and the only one it may ever have. Re-matches
 * every unmatched place against the catalogue on the way out — see `ownGuides`.
 */
routerAdd(
  "GET",
  "/api/detour/guides",
  (e) => {
    const lists = require(__hooks + "/guides.js");
    // `{ items, ungrouped }` — the second is places the member kept when they
    // removed the list those places arrived on.
    return e.json(200, lists.ownGuides(e.app, e.auth.id));
  },
  $apis.requireAuth("members")
);

/**
 * One list, with its places, for the list's own page and its map.
 *
 * Locates a small batch on the way out. The map is the reason: one place at a
 * time, filled in when its own page is opened, plots four pins out of
 * thirty-eight and a map that incomplete is worse than none. A bounded batch per
 * open means a freshly imported list has most of its pins within a few visits,
 * and the hourly sweep finishes the rest — OpenStreetMap asks for one lookup a
 * second, and this is somebody else's service to be careful with.
 */
routerAdd(
  "GET",
  "/api/detour/guides/{list}",
  (e) => {
    const lists = require(__hooks + "/guides.js");
    let list;
    try {
      list = e.app.findRecordById("community_guides", e.request.pathValue("list"));
    } catch {
      throw new BadRequestError("That list is not yours.");
    }
    if (list.getString("member") !== e.auth.id) {
      throw new BadRequestError("That list is not yours.");
    }

    lists.locateGuidePlaces(e.app, e.auth.id, list.id, 8);

    // Read through ownGuides so the page gets exactly what the tab gets,
    // re-matched against the catalogue in the same pass.
    const own = lists.ownGuides(e.app, e.auth.id);
    const found = own.items.filter((item) => item.id === list.id)[0];
    if (!found) throw new BadRequestError("That list is not yours.");
    return e.json(200, { guide: found });
  },
  $apis.requireAuth("members")
);

/**
 * Fill in coordinates for imported places, a few at a time.
 *
 * Hourly rather than nightly: a member who imports a list wants its map, and
 * waiting until 4am for it is the difference between a feature and a promise.
 * Bounded per run because every one of these is a request to OpenStreetMap's
 * free service — `located_at` stops a failing address being retried more than
 * weekly, and ordering by that stamp keeps one large import from starving
 * everybody else's.
 */
cronAdd("guide_place_locate_sweep", "20 * * * *", () => {
  const lists = require(__hooks + "/guides.js");
  lists.locateSweepBatch($app, 40);
});

/**
 * One private place, with its coordinates filled in if they can be.
 *
 * The private page's own read. Locating happens here rather than at import
 * because thirty-eight geocoder lookups inside one request would exceed both the
 * request and OpenStreetMap's own rate policy, and most imported places are
 * never opened. Best effort: a page with no pin is a page with no pin.
 */
routerAdd(
  "GET",
  "/api/detour/guides/places/{place}",
  (e) => {
    const lists = require(__hooks + "/guides.js");
    let record;
    try {
      record = e.app.findRecordById("community_imported_places", e.request.pathValue("place"));
    } catch {
      throw new BadRequestError("That place is not on your list.");
    }
    // Ownership is checked here and not left to a collection rule: this route
    // reads with app privileges so it can write coordinates back.
    if (record.getString("member") !== e.auth.id) {
      throw new BadRequestError("That place is not on your list.");
    }

    // The city of a list this place sits on, which is what a place filed under a
    // borough falls back to for both locating and matching. The geocoder wants
    // it as written and the match wants it normalized, so both are read.
    let listCity = "";
    let normalizedListCity = "";
    for (const listId of record.get("guides") || []) {
      let list;
      try {
        list = e.app.findRecordById("community_guides", listId);
      } catch {
        continue;
      }
      listCity = list.getString("city");
      normalizedListCity = list.getString("normalized_city");
      if (listCity || normalizedListCity) break;
    }
    lists.locateImportedPlace(e.app, record, listCity);

    const payload = lists.placePayload(record);
    // A place that has since been recommended opens the real page instead, so
    // the client is told which one to go to.
    if (!payload.matched_venue) {
      const venueId = lists.matchPublishedVenue(
        e.app,
        record.getString("normalized_name"),
        record.getString("normalized_city"),
        normalizedListCity
      );
      if (venueId) {
        record.set("matched_venue", venueId);
        try {
          e.app.save(record);
        } catch {
          // Costs this read its match and nothing else.
        }
        payload.matched_venue = venueId;
      }
    }
    return e.json(200, { place: payload });
  },
  $apis.requireAuth("members")
);

/**
 * Remove a list, and answer for its places.
 *
 * `?places=keep` unlinks them and leaves them on the member's wishlist under no
 * heading; anything else removes the ones this list was the last to name. The
 * client asks which before calling — see the confirm on My detours.
 *
 * WHY IT ASKS AT ALL, when Wanna go's own Remove does not. That rule — "a
 * confirmation dialogue on a bookmark is an insult" — is about one bookmark.
 * This is up to a hundred places in one unconfirmed tap, it is not undoable, and
 * "Remove list" honestly reads both ways: drop the whole thing, or drop the
 * heading and keep what was under it. Both are things a member might mean.
 *
 * A place another list still names survives either way. Deleting it because a
 * different list went away would be the cascade this schema deliberately does
 * not have.
 */
routerAdd(
  "DELETE",
  "/api/detour/guides/{list}",
  (e) => {
    let list;
    try {
      list = e.app.findRecordById("community_guides", e.request.pathValue("list"));
    } catch {
      throw new BadRequestError("That list is not yours.");
    }
    if (list.getString("member") !== e.auth.id) {
      throw new BadRequestError("That list is not yours.");
    }

    // Read the member's own places and match on the relation in JavaScript
    // rather than filtering on it. A `lists ?= {:list}` filter over a
    // multi-relation quietly matches nothing here, which does not fail loudly:
    // the unlink loop runs over an empty set, and the delete below then fails
    // with "part of a required reference" — because `lists` is required, which
    // is exactly what stops a place being orphaned. The volume is one member's
    // own rows either way.
    let places;
    try {
      places = e.app.findRecordsByFilter(
        "community_imported_places",
        "member = {:member}",
        "created",
        2000,
        0,
        { member: e.auth.id }
      );
    } catch {
      places = [];
    }
    const keepPlaces = String(e.request.url.query().get("places") || "") === "keep";
    let kept = 0;
    let removed = 0;
    for (const place of places) {
      const held = [];
      for (const id of place.get("guides") || []) held.push(String(id));
      if (held.indexOf(list.id) === -1) continue;
      const remaining = held.filter((id) => id !== list.id);
      // Unlinked when another list still names it, or when the member said to
      // keep it — in which case it belongs to no list, which `lists` allows.
      if (remaining.length || keepPlaces) {
        place.set("guides", remaining);
        e.app.save(place);
        kept += 1;
      } else {
        e.app.delete(place);
        removed += 1;
      }
    }
    e.app.delete(list);
    return e.json(200, { removed: list.id, places_kept: kept, places_removed: removed });
  },
  $apis.requireAuth("members")
);

/**
 * Take a departing member's imported places with them, before their lists go.
 *
 * Both collections cascade on `member`, so both would go on their own — but
 * `community_imported_places.guides` is required and does NOT cascade, which is
 * what stops one list's removal orphaning a place another list still names. That
 * same guard blocks the account cascade: PocketBase deletes a list, the place
 * still requires it, and the whole delete fails with "part of a required
 * relation reference". A member holding one imported list could not remove their
 * account at all.
 *
 * So the places are removed here first and the lists then cascade freely. Not
 * best-effort: if this throws, the account deletion must fail rather than half
 * happen and leave the member's private rows behind.
 */
onRecordDelete((e) => {
  const places = e.app.findRecordsByFilter(
    "community_imported_places",
    "member = {:member}",
    "created",
    5000,
    0,
    { member: e.record.id }
  );
  for (const place of places) e.app.delete(place);
  e.next();
}, "members");

/**
 * Skip one place off a list, or take the skip back.
 *
 * A flag rather than a delete, and the reason is in the migration: the page is a
 * record of what the piece said, so the place stays on it, dimmed, and leaves
 * everything else. Idempotent — the body says what the member wants the state to
 * be, not what to toggle, so a double tap on a slow connection cannot land them
 * on the opposite answer from the one they pressed.
 */
routerAdd(
  "PATCH",
  "/api/detour/guides/places/{place}/skip",
  (e) => {
    let record;
    try {
      record = e.app.findRecordById("community_imported_places", e.request.pathValue("place"));
    } catch {
      throw new BadRequestError("That place is not on your list.");
    }
    if (record.getString("member") !== e.auth.id) {
      throw new BadRequestError("That place is not on your list.");
    }
    const body = e.requestInfo().body || {};
    const skipped = body.skipped === true;
    record.set("skipped", skipped);
    e.app.save(record);
    return e.json(200, { place: record.id, skipped: skipped });
  },
  $apis.requireAuth("members")
);

/** Remove one place from every list the member holds it under. */
routerAdd(
  "DELETE",
  "/api/detour/guides/places/{place}",
  (e) => {
    let record;
    try {
      record = e.app.findRecordById("community_imported_places", e.request.pathValue("place"));
    } catch {
      throw new BadRequestError("That place is not on your list.");
    }
    if (record.getString("member") !== e.auth.id) {
      throw new BadRequestError("That place is not on your list.");
    }
    e.app.delete(record);
    return e.json(200, { removed: record.id });
  },
  $apis.requireAuth("members")
);

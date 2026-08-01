// Shared logic for Detour's private community waiting-list loop. Require this
// module from inside every hook callback; PocketBase isolates handler callbacks
// from hook-file module scope.

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizePlacePart(value) {
  let normalized = cleanText(value, 300);
  if (typeof normalized.normalize === "function") {
    normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  return normalized
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Optional place facts carried by recommendations. Values mirror the select
// fields on community_waitlist_entries / community_recommendations; labels are
// what publication writes to the public venue category.
const PLACE_CATEGORY_LABELS = {
  restaurant: "Restaurant",
  cafe: "Café",
  bakery: "Bakery",
  bar: "Bar",
  cocktail_bar: "Cocktail bar",
  wine_bar: "Wine bar",
  brewery: "Brewery",
  food_market: "Food market",
  deli: "Deli",
  dessert_shop: "Dessert shop",
  ice_cream: "Ice cream",
  takeaway: "Takeaway",
  other: "Other",
};
const PLACE_OCCASIONS = [
  "celebration",
  "casual_local_favorite",
  "coffee",
  "bakery",
  "drinks_nightcap",
  "neighborhood_meal",
  "date_night",
  "group_gathering",
  "quick_bite",
  "breakfast_brunch",
  "solo_friendly",
  "family_friendly",
  "late_night",
  "outdoor_seating",
];

function validateCategory(value) {
  const category = cleanText(value, 40);
  if (!category) return "";
  if (!Object.prototype.hasOwnProperty.call(PLACE_CATEGORY_LABELS, category)) {
    throw new BadRequestError("Choose a category from the provided list.");
  }
  return category;
}

function validateOccasions(values) {
  const seen = {};
  const occasions = [];
  for (const value of Array.isArray(values) ? values : []) {
    const occasion = cleanText(value, 40);
    if (!occasion) continue;
    if (PLACE_OCCASIONS.indexOf(occasion) === -1) {
      throw new BadRequestError("Choose occasions from the provided list.");
    }
    if (!seen[occasion]) {
      seen[occasion] = true;
      occasions.push(occasion);
    }
  }
  return occasions;
}

// The first recommender seeds the entry's place facts; later recommenders can
// fill a missing category and add occasions, never overwrite or remove.
function mergePlaceFacts(app, entry, category, occasions) {
  let changed = false;
  if (category && !entry.getString("category")) {
    entry.set("category", category);
    changed = true;
  }
  if (occasions && occasions.length) {
    const existing = entry.getStringSlice("occasions");
    const seen = {};
    const merged = [];
    for (const occasion of existing.concat(occasions)) {
      if (occasion && !seen[occasion]) {
        seen[occasion] = true;
        merged.push(occasion);
      }
    }
    if (merged.length !== existing.length) {
      entry.set("occasions", merged);
      changed = true;
    }
  }
  if (changed) app.save(entry);
}

// A recommendation may include the same place links exposed by the edit form.
// Non-empty values correct or fill the shared entry; omitted values leave any
// links already supplied by another member intact.
function mergePlaceLinks(app, entry, links) {
  let changed = false;
  for (const field of ["official_url", "instagram_url"]) {
    const supplied = cleanText(links && links[field], 2048);
    if (supplied && supplied !== entry.getString(field)) {
      entry.set(field, supplied);
      changed = true;
    }
  }
  if (changed) app.save(entry);
}

function hasConfirmedCoordinates(venue) {
  if (!venue) return false;
  const lat = Number(venue.get("lat"));
  const lng = Number(venue.get("lng"));
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    Boolean(cleanText(venue.getString("coord_verification_note"), 300))
  );
}

// Occasion tags are place facts, so publication copies them onto the venue
// itself rather than onto the publication record — a place has outdoor seating
// whether or not a selection was published for it this calendar year. Union-only
// with the same rule as mergePlaceFacts: a later recommender adds tags and can
// never overwrite or remove another member's read of the place.
function mergeEntryOccasionsIntoVenue(app, entry, venue) {
  const incoming = entry.getStringSlice("occasions");
  if (!incoming.length) return;
  const existing = venue.getStringSlice("occasions");
  const seen = {};
  const merged = [];
  for (const occasion of existing.concat(incoming)) {
    if (!occasion || seen[occasion]) continue;
    seen[occasion] = true;
    merged.push(occasion);
  }
  if (merged.length === existing.length) return;
  venue.set("occasions", merged);
  app.save(venue);
}

// Host guard for member-supplied place links and for every URL the cover
// resolver fetches. Blocks non-http(s) schemes, credentials, and hosts that
// could point the server at itself or its private network (literal IPs,
// localhost, and internal-only suffixes). Local validators run against
// loopback servers and disable the host restrictions explicitly via
// DETOUR_COVER_ALLOW_PRIVATE_HOSTS=1.
function publicHttpUrl(value) {
  const raw = cleanText(value, 300);
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  const match = withScheme.match(/^(https?):\/\/([^/?#]+)([/?#].*)?$/i);
  if (!match) return "";
  const authority = match[2];
  if (authority.indexOf("@") !== -1 || authority.indexOf("[") !== -1) return "";
  const host = authority.split(":")[0].toLowerCase();
  if (!host) return "";
  if ($os.getenv("DETOUR_COVER_ALLOW_PRIVATE_HOSTS") !== "1") {
    if (
      host.indexOf(".") === -1 ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host === "localhost" ||
      /\.(localhost|local|internal|flycast)$/.test(host)
    ) {
      return "";
    }
  }
  return withScheme;
}

function requireVerifiedMember(auth, action) {
  if (!auth || auth.getString("community_status") !== "verified") {
    throw new BadRequestError(
      "Verified Detour membership is required before " + action + "."
    );
  }
}

function validateRecommendationNote(value) {
  const note = cleanText(value, 2400);
  const words = note
    .split(/\s+/)
    .map((word) =>
      word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, "")
    )
    .filter((word) => word.length >= 2);
  if (note.length < 24 || words.length < 5) {
    throw new BadRequestError(
      "Add a meaningful personal recommendation of at least 24 characters and five words."
    );
  }
  return note;
}

function validateShareNote(value) {
  const note = cleanText(value, 1200);
  const words = note.split(/\s+/).filter((word) => word.length >= 2);
  if (note.length < 8 || words.length < 2) {
    throw new BadRequestError("Add a short personal note for the recipient.");
  }
  return note;
}

function findCanonicalVenue(app, normalizedName, normalizedCity, normalizedDisambiguator) {
  const wanted = normalizedDisambiguator || "";
  const venues = app.findRecordsByFilter("venues", "id != ''", "created", 10000, 0);
  for (const venue of venues) {
    if (
      normalizePlacePart(venue.getString("name")) === normalizedName &&
      normalizePlacePart(venue.getString("city")) === normalizedCity &&
      normalizePlacePart(venue.getString("disambiguator")) === wanted
    ) {
      return venue;
    }
  }
  return null;
}

function sanitizePlaceInput(app, input) {
  let venueName = cleanText(input.venueName, 200);
  let city = cleanText(input.city, 120);
  let country = cleanText(input.country, 120);
  let address = cleanText(input.address, 300);
  let disambiguator = cleanText(input.disambiguator, 120);
  const normalizedName = normalizePlacePart(venueName);
  const normalizedCity = normalizePlacePart(city);
  const normalizedDisambiguator = normalizePlacePart(disambiguator);

  if (venueName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid venue name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }

  const canonicalVenue = findCanonicalVenue(
    app,
    normalizedName,
    normalizedCity,
    normalizedDisambiguator
  );
  if (canonicalVenue) {
    // A catalogue venue is the authority on its own facts. Its country may still
    // be blank on a place the enrichment pass has not reached yet, which is no
    // longer an error — it simply means there is nothing to adopt or contradict.
    const canonicalCountry = cleanText(canonicalVenue.getString("country"), 120);
    if (
      country &&
      canonicalCountry &&
      normalizePlacePart(country) !== normalizePlacePart(canonicalCountry)
    ) {
      throw new BadRequestError(
        "The supplied country does not match the existing catalogue venue."
      );
    }
    venueName = cleanText(canonicalVenue.getString("name"), 200);
    city = cleanText(canonicalVenue.getString("city"), 120);
    if (canonicalCountry) country = canonicalCountry;
    const canonicalAddress = cleanText(canonicalVenue.getString("address"), 300);
    if (canonicalAddress) address = canonicalAddress;
    const canonicalDisambiguator = cleanText(canonicalVenue.getString("disambiguator"), 120);
    if (canonicalDisambiguator) disambiguator = canonicalDisambiguator;
  }

  // Country is no longer asked of the member: the recommendation form takes a
  // name, a city and a note. enrichVenueFromOsm fills it from Nominatim's
  // address details after publication, and until then the client falls back to
  // the city's own country for display.

  return {
    venueName,
    city,
    country,
    address,
    disambiguator,
    normalizedName: normalizePlacePart(venueName),
    normalizedCity: normalizePlacePart(city),
    normalizedDisambiguator: normalizePlacePart(disambiguator),
    canonicalVenue,
  };
}

function validateEntryMatchesInput(entry, input) {
  const suppliedName = cleanText(input.venueName, 200);
  const suppliedCity = cleanText(input.city, 120);
  const suppliedCountry = cleanText(input.country, 120);
  const entryCountry = cleanText(entry.getString("country"), 120);

  if (
    suppliedName &&
    normalizePlacePart(suppliedName) !== entry.getString("normalized_name")
  ) {
    throw new BadRequestError("The supplied venue name does not match the waiting-list entry.");
  }
  if (
    suppliedCity &&
    normalizePlacePart(suppliedCity) !== entry.getString("normalized_city")
  ) {
    throw new BadRequestError("The supplied city does not match the waiting-list entry.");
  }
  // An entry whose country has not been enriched yet contradicts nothing.
  if (
    suppliedCountry &&
    entryCountry &&
    normalizePlacePart(suppliedCountry) !== normalizePlacePart(entryCountry)
  ) {
    throw new BadRequestError("The supplied country does not match the waiting-list entry.");
  }
}

// The unqualified-place half of a place-identity filter.
//
// Written as a literal rather than a bound parameter because a bound empty string
// does not survive PocketBase's filter resolver — the comparison is dropped and
// the filter silently widens to every place with the same name and city, which
// then reads as "no match" and lands on the unique index instead. The null arm
// covers a row written while the column still allowed one; the index COALESCEs
// for the same reason.
const UNQUALIFIED_PLACE =
  "(normalized_disambiguator = '' || normalized_disambiguator = null)";

// Finds the entry that owns a place identity, or null.
function findEntryByPlace(app, normalizedName, normalizedCity, normalizedDisambiguator) {
  const qualifier = normalizedDisambiguator || "";
  const params = { name: normalizedName, city: normalizedCity };
  if (qualifier) params.qualifier = qualifier;
  try {
    return app.findFirstRecordByFilter(
      "community_waitlist_entries",
      "normalized_name = {:name} && normalized_city = {:city} && " +
        (qualifier ? "normalized_disambiguator = {:qualifier}" : UNQUALIFIED_PLACE),
      params
    );
  } catch {
    return null;
  }
}

// What the member is told when their name and city already belong to a place.
//
// Deliberately place facts only. `signal_count` is global — it counts members in
// circles the caller cannot see — so reporting it here would disclose their
// existence and their number, which is the one thing scoped visibility exists to
// prevent. The client says "already on the list", never how many.
//
// Served by GET /api/detour/place-identity rather than attached to the 409 that
// refuses the create: PocketBase rewrites an ApiError's `data` into a
// validation-error map, turning every fact here into {code:"validation_invalid_value"}.
function placeCollisionData(entry) {
  return {
    entry: entry.id,
    venue_name: entry.getString("venue_name"),
    city: entry.getString("city"),
    address: entry.getString("address"),
    disambiguator: entry.getString("disambiguator"),
    published: entry.getString("status") === "published",
  };
}

// Adopts whatever the caller knows that the shared entry does not.
function fillEntryGaps(app, entry, place) {
  let changed = false;
  if (!entry.getString("canonical_venue") && place.canonicalVenue) {
    entry.set("canonical_venue", place.canonicalVenue.id);
    changed = true;
  }
  if (!cleanText(entry.getString("address"), 300) && place.address) {
    entry.set("address", place.address);
    changed = true;
  }
  if (!cleanText(entry.getString("country"), 120) && place.country) {
    entry.set("country", place.country);
    changed = true;
  }
  if (changed) app.save(entry);
  return entry;
}

/**
 * Resolves a place identity to its waiting-list entry, creating one if the
 * identity is new.
 *
 * `input.intent` decides what happens when the identity is already taken:
 *
 *   absent / "auto"  Converge on the existing entry. This is what a private
 *                    share and a curator submission want — and what every
 *                    caller did before the recommendation form began asking.
 *   "ask"            Refuse with a 409 and the existing place's facts, so the
 *                    member can say whether it is the place they mean. Only the
 *                    recommendation form sets this.
 *   "second"         Converge deliberately: the member looked at the existing
 *                    place and said yes, that one.
 *   "distinct"       A different place that happens to share the name. Requires
 *                    a disambiguator, which becomes part of its identity.
 *
 * The "ask" branch exists because converging silently is right most of the time
 * and wrong invisibly: two members recommending the same restaurant is the
 * common case and the whole point of seconding, but two different restaurants
 * sharing a name used to be indistinguishable from it — the second member's note
 * simply appeared on the first one's page.
 */
function createOrResolveEntry(app, input) {
  const intent = cleanText(input.intent, 20).toLowerCase() || "auto";
  const place = sanitizePlaceInput(app, input);

  if (intent === "distinct" && !place.normalizedDisambiguator) {
    throw new BadRequestError(
      "Add the street or neighbourhood that tells this place apart from the one already on the list."
    );
  }

  const existing = findEntryByPlace(
    app,
    place.normalizedName,
    place.normalizedCity,
    place.normalizedDisambiguator
  );

  if (existing) {
    if (intent === "ask") {
      // Message only. The facts come from GET /api/detour/place-identity,
      // because an ApiError's data is rewritten into a validation-error map.
      throw new ApiError(409, "That place is already on the list.");
    }
    if (intent === "distinct") {
      // The qualifier the member gave is taken too, so it does not distinguish
      // anything. Ask again rather than converging onto a place they just said
      // theirs was not.
      throw new ApiError(
        409,
        "A place with that name and street is already on the list."
      );
    }
    return { entry: fillEntryGaps(app, existing, place), created: false };
  }

  const collection = app.findCollectionByNameOrId("community_waitlist_entries");
  const entry = new Record(collection);
  entry.set("venue_name", place.venueName);
  entry.set("city", place.city);
  entry.set("country", place.country);
  entry.set("address", place.address);
  entry.set("disambiguator", place.disambiguator);
  entry.set("normalized_name", place.normalizedName);
  entry.set("normalized_city", place.normalizedCity);
  entry.set("normalized_disambiguator", place.normalizedDisambiguator);
  entry.set("status", "pending");
  entry.set("signal_count", 0);
  entry.set("participants", []);
  if (place.canonicalVenue) entry.set("canonical_venue", place.canonicalVenue.id);

  try {
    app.save(entry);
    return { entry, created: true };
  } catch (error) {
    // A concurrent request can win the place-identity unique index. If it did,
    // converge on that row; otherwise preserve the original validation or
    // storage error. An "ask" caller is told about the winner the same way it
    // would have been told about a row that was already there.
    const concurrent = findEntryByPlace(
      app,
      place.normalizedName,
      place.normalizedCity,
      place.normalizedDisambiguator
    );
    if (!concurrent) throw error;
    if (intent === "ask" || intent === "distinct") {
      throw new ApiError(
        409,
        "That place reached the list a moment before yours."
      );
    }
    return { entry: fillEntryGaps(app, concurrent, place), created: false };
  }
}

function resolveEntry(app, waitlistId, input) {
  if (waitlistId) {
    let entry;
    try {
      entry = app.findRecordById("community_waitlist_entries", waitlistId);
    } catch {
      throw new BadRequestError("The waiting-list entry does not exist.");
    }
    validateEntryMatchesInput(entry, input);
    return { entry, created: false };
  }
  return createOrResolveEntry(app, input);
}

function isParticipant(entry, memberId) {
  return entry.getStringSlice("participants").indexOf(memberId) !== -1;
}

function addParticipants(app, entry, memberIds) {
  const participants = entry.getStringSlice("participants");
  const seen = {};
  const merged = [];
  for (const id of participants.concat(memberIds)) {
    if (id && !seen[id]) {
      seen[id] = true;
      merged.push(id);
    }
  }
  if (merged.length !== participants.length) {
    entry.set("participants", merged);
    app.save(entry);
  }
  return entry;
}

function findMemberRecommendation(app, memberId, entryId) {
  try {
    return app.findFirstRecordByFilter(
      "community_recommendations",
      "member = {:member} && waitlist = {:waitlist}",
      { member: memberId, waitlist: entryId }
    );
  } catch {
    return null;
  }
}

function publishEntry(app, entry) {
  const normalizedName = entry.getString("normalized_name");
  const normalizedCity = entry.getString("normalized_city");
  const normalizedDisambiguator = entry.getString("normalized_disambiguator") || "";
  const country = cleanText(entry.getString("country"), 120);
  // A name and a city are what a place cannot publish without. Country is not
  // among them any more: the member is not asked for one, and enrichVenueFromOsm
  // supplies it after publication. Gating on it here would hold a place off the
  // list waiting for a fact no one had been asked to provide.
  if (!normalizedName || !normalizedCity) {
    throw new BadRequestError("The waiting-list entry is missing valid publication place data.");
  }

  let venue = null;
  const canonicalId = entry.getString("canonical_venue");
  if (canonicalId) {
    try {
      const linked = app.findRecordById("venues", canonicalId);
      if (
        normalizePlacePart(linked.getString("name")) === normalizedName &&
        normalizePlacePart(linked.getString("city")) === normalizedCity &&
        normalizePlacePart(linked.getString("disambiguator")) === normalizedDisambiguator
      ) {
        venue = linked;
      }
    } catch {
      venue = null;
    }
  }
  if (!venue) {
    venue = findCanonicalVenue(app, normalizedName, normalizedCity, normalizedDisambiguator);
  }

  const entryAddress = cleanText(entry.getString("address"), 300);
  const entryDisambiguator = cleanText(entry.getString("disambiguator"), 120);
  const entryCategoryLabel = PLACE_CATEGORY_LABELS[entry.getString("category")] || "";
  if (venue) {
    const venueCountry = cleanText(venue.getString("country"), 120);
    // Only a genuine contradiction is an error. Either side may still be waiting
    // on enrichment for its country, and a blank contradicts nothing.
    if (
      country &&
      venueCountry &&
      normalizePlacePart(venueCountry) !== normalizePlacePart(country)
    ) {
      throw new BadRequestError(
        "The waiting-list country does not match the canonical venue country."
      );
    }
    let venueChanged = false;
    if (!venueCountry && country) {
      venue.set("country", country);
      venueChanged = true;
    }
    if (!cleanText(venue.getString("address"), 300) && entryAddress) {
      venue.set("address", entryAddress);
      venueChanged = true;
    }
    if (!cleanText(venue.getString("disambiguator"), 120) && entryDisambiguator) {
      venue.set("disambiguator", entryDisambiguator);
      venueChanged = true;
    }
    if (!cleanText(venue.getString("category"), 120) && entryCategoryLabel) {
      venue.set("category", entryCategoryLabel);
      venueChanged = true;
    }
    if (venueChanged) app.save(venue);
  } else {
    const venues = app.findCollectionByNameOrId("venues");
    venue = new Record(venues);
    venue.set("name", cleanText(entry.getString("venue_name"), 200));
    venue.set("city", cleanText(entry.getString("city"), 120));
    venue.set("country", country);
    venue.set("address", entryAddress);
    venue.set("disambiguator", entryDisambiguator);
    venue.set("official_url", "");
    venue.set("category", entryCategoryLabel);
    venue.set("approx_location", false);
    app.save(venue);
  }

  // Member-supplied place links ride along with publication; the automatic
  // OSM/metadata discovery afterwards only fills whatever is still missing.
  mergeEntryLinksIntoVenue(app, entry, venue);
  // The venue owns its occasion tags.
  mergeEntryOccasionsIntoVenue(app, entry, venue);

  // The venue also owns its publication marker. Written before the award record
  // below, which is now a duplicate of this fact and on its way out: every
  // server path that needs a work-list of published places (the geocode, cover
  // and web-discovery sweeps) keys on this, not on an award row.
  //
  // `published_at` is stamped once, on first publication, so re-publishing after
  // a takedown does not rewrite the place's history. A curator takedown clears
  // `published` via the unpublish route; it is never cleared here.
  if (!venue.getBool("published")) {
    venue.set("published", true);
    if (!venue.getString("published_at")) {
      venue.set("published_at", new Date().toISOString());
    }
    app.save(venue);
  }

  // Publication state is the final write. No member identity, recommendation
  // prose, share prose, or source lead is copied to any public collection.
  //
  // There is no award record any more: a place is public because a real member
  // recommended it, and the venue carries that fact itself (above). The old
  // guide-shaped chain here — find-or-create a `detour-community` guide source,
  // find-or-create a `venue_awards` row keyed by source/venue/year/level, then
  // demote every other "current" row for the same venue — described an annual
  // guide edition, not a recommendation, and is gone with the collections.
  entry.set("canonical_venue", venue.id);
  entry.set("published_venue", venue.id);
  entry.set("published_at", new Date().toISOString());
  entry.set("publication_audit_id", "community-" + $security.randomString(32));
  entry.set("status", "published");
  app.save(entry);
}

function recalculateAndPublish(app, entryId) {
  const result = {
    entryId: entryId || "",
    publishedNow: false,
    publishedVenue: "",
  };
  if (!entryId) return result;

  app.runInTransaction((txApp) => {
    let entry;
    try {
      entry = txApp.findRecordById("community_waitlist_entries", entryId);
    } catch {
      return;
    }

    // COUNT DISTINCT remains the source of truth for the persisted social-proof
    // total. Founder and Founder-invited recommendations remain compatible by
    // counting exactly like every other verified member recommendation.
    const summary = new DynamicModel({ signal_count: 0 });
    txApp
      .db()
      .newQuery(
        "SELECT COUNT(DISTINCT member) AS signal_count " +
          "FROM community_recommendations WHERE waitlist = {:waitlist}"
      )
      .bind({ waitlist: entry.id })
      .one(summary);

    const signalCount = Number(summary.signal_count || 0);
    if (entry.getInt("signal_count") !== signalCount) {
      entry.set("signal_count", signalCount);
      txApp.save(entry);
    }

    // Recommendation creation already requires verified membership and a
    // meaningful note. The first distinct member recommendation publishes a
    // pending entry; additional persisted signals are social proof, not a gate.
    if (entry.getString("status") === "pending" && signalCount >= 1) {
      publishEntry(txApp, entry);
      result.publishedNow = true;
    }
    result.publishedVenue = entry.getString("published_venue");
  });

  return result;
}

/**
 * Removes a place once its last member recommendation is gone.
 *
 * Every place in the catalogue is there because a member put their name behind
 * it (enforced as a one-time sweep by migrations 1768019000 and 1768019200).
 * This is the delete-time half of that rule: when the final recommendation for
 * an entry is removed, nobody stands behind the place any more, so it does not
 * stay listed. The venue, its recognition rows (relation cascade), and the
 * shared entry itself are deleted outright.
 *
 * Private correspondence is deliberately preserved. A member's share note and
 * its replies are not catalogue data, and both the `venue` and `waitlist`
 * relations on community_shares cascade on delete — so shares are detached
 * first. They keep their denormalized venue_name/address and still read
 * correctly after the place is gone.
 *
 * Safe to call for any entry: it is a no-op while any recommendation remains,
 * and it never removes a venue another entry still publishes.
 */
function withdrawUnbackedEntry(app, entryId) {
  const result = {
    entryId: entryId || "",
    withdrawn: false,
    deletedVenue: "",
    detachedShares: 0,
  };
  if (!entryId) return result;

  app.runInTransaction((txApp) => {
    let entry;
    try {
      entry = txApp.findRecordById("community_waitlist_entries", entryId);
    } catch {
      // Already gone (a concurrent withdrawal, or a cascading member delete).
      return;
    }

    // Any surviving recommendation means a member still stands behind it.
    const remaining = new DynamicModel({ total: 0 });
    txApp
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM community_recommendations " +
          "WHERE waitlist = {:waitlist}"
      )
      .bind({ waitlist: entry.id })
      .one(remaining);
    if (Number(remaining.total || 0) > 0) return;

    const venueId =
      entry.getString("published_venue") || entry.getString("canonical_venue");

    // Detach private shares from both cascading relations before the deletes.
    const detached = new DynamicModel({ total: 0 });
    txApp
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM community_shares " +
          "WHERE waitlist = {:waitlist} OR (venue != '' AND venue = {:venue})"
      )
      .bind({ waitlist: entry.id, venue: venueId })
      .one(detached);
    result.detachedShares = Number(detached.total || 0);
    if (result.detachedShares > 0) {
      txApp
        .db()
        .newQuery(
          "UPDATE community_shares SET waitlist = '' WHERE waitlist = {:waitlist}"
        )
        .bind({ waitlist: entry.id })
        .execute();
      if (venueId) {
        txApp
          .db()
          .newQuery("UPDATE community_shares SET venue = '' WHERE venue = {:venue}")
          .bind({ venue: venueId })
          .execute();
      }
    }

    txApp.delete(entry);
    result.withdrawn = true;

    if (!venueId) return;

    // Another shared entry may legitimately still publish this venue; only the
    // last one takes the catalogue row with it.
    const otherEntries = new DynamicModel({ total: 0 });
    txApp
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM community_waitlist_entries " +
          "WHERE published_venue = {:venue} OR canonical_venue = {:venue}"
      )
      .bind({ venue: venueId })
      .one(otherEntries);
    if (Number(otherEntries.total || 0) > 0) return;

    let venue;
    try {
      venue = txApp.findRecordById("venues", venueId);
    } catch {
      return;
    }

    // Nothing else holds a blocking relation on a venue any more: the raw
    // per-source assertion table and the award lane that used to sit in front of
    // this delete are both gone, so the venue can be removed directly.
    txApp.delete(venue);
    result.deletedVenue = venueId;
  });

  return result;
}

// Atomically reserves the one publication-notification attempt for an entry.
// Only the member recommendation after-create hook calls this helper; migration
// and reconciliation callers use recalculateAndPublish alone and stay silent.
function claimPublicationNotification(app, entryId) {
  if (!entryId) return null;
  const claimedAt = new Date().toISOString();
  const claimed = arrayOf(
    new DynamicModel({
      id: "",
      venue_name: "",
      city: "",
      publication_notification_sent_at: "",
    })
  );
  app
    .db()
    .newQuery(
      "UPDATE community_waitlist_entries " +
        "SET publication_notification_sent_at = {:claimedAt} " +
        "WHERE id = {:entryId} AND status = 'published' " +
        "AND COALESCE(publication_notification_sent_at, '') = '' " +
        "RETURNING id, venue_name, city, publication_notification_sent_at"
    )
    .bind({ entryId, claimedAt })
    .all(claimed);

  if (claimed.length !== 1) return null;
  return {
    entryId: claimed[0].id,
    venueName: claimed[0].venue_name,
    city: claimed[0].city,
    claimedAt: claimed[0].publication_notification_sent_at,
  };
}

// Validates a published venue's address by geocoding it via OpenStreetMap
// Nominatim and stores verified coordinates. Never throws: publication must
// not depend on an external service. Outcomes:
//   - street-level match in the claimed city → lat/lng + provenance note
//   - city mismatch or no match → coordinates withheld, note explains why
//   - network failure → nothing written; the nightly sweep retries
function geocodeVenue(app, venueId) {
  let venue;
  try {
    venue = app.findRecordById("venues", venueId);
  } catch {
    return;
  }
  const existingLat = Number(venue.get("lat"));
  const existingLng = Number(venue.get("lng"));
  if ((existingLat !== 0 || existingLng !== 0) && Number.isFinite(existingLat) && Number.isFinite(existingLng)) {
    return; // already located
  }
  const address = cleanText(venue.getString("address"), 300);
  const city = cleanText(venue.getString("city"), 120);
  const country = cleanText(venue.getString("country"), 120);
  if (!address || !city) return;

  let response;
  try {
    response = $http.send({
      // accept-language=en keeps returned place names in English exonyms
      // (Lisbon, not Lisboa) so they compare cleanly against member input.
      url:
        nominatimBaseUrl() +
        "/search?format=jsonv2&limit=1&addressdetails=1&accept-language=en&q=" +
        encodeURIComponent(address + ", " + city + ", " + country),
      method: "GET",
      headers: { "User-Agent": "Detour community place verification (contact: olga@supernaut.dev)" },
      timeout: 10,
    });
  } catch {
    return;
  }
  if (!response || response.statusCode !== 200) return;

  let results;
  try {
    results = response.json;
  } catch {
    return;
  }
  if (!Array.isArray(results) || results.length === 0) {
    venue.set("coord_verification_note", "Geocoding found no match for the submitted address.");
    app.save(venue);
    return;
  }

  const hit = results[0];
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;

  const parts = hit.address || {};
  const hitCity = String(parts.city || parts.town || parts.village || parts.municipality || "");
  if (hitCity && normalizePlacePart(hitCity) !== normalizePlacePart(city)) {
    venue.set(
      "coord_verification_note",
      "Geocoded city (" + hitCity + ") does not match the submitted city; coordinates withheld."
    );
    app.save(venue);
    return;
  }

  venue.set("lat", lat);
  venue.set("lng", lng);
  venue.set(
    "coord_verification_note",
    cleanText("Geocoded via OpenStreetMap Nominatim: " + String(hit.display_name || ""), 300)
  );
  app.save(venue);
}

// Where OpenStreetMap lookups go. Overridable only so local validators can
// run against a loopback fixture server; production always uses the public
// Nominatim service.
function nominatimBaseUrl() {
  return $os.getenv("DETOUR_NOMINATIM_BASE_URL") || "https://nominatim.openstreetmap.org";
}

// Turns a claimed image link into one that verifiably serves an image, or "".
//
// Used for both the OSM `image` tag and a URL a founding member pastes, because
// the two need identical scepticism. Only a direct http(s) link is taken: a bare
// "File:Frontage.jpg" Commons reference names an asset rather than addressing one,
// and publicHttpUrl would otherwise prepend a scheme and turn it into a nonsense
// host. Whatever survives gets the guards a scraped candidate gets, including the
// range GET that confirms the bytes really are an image — an `image` tag pointing
// at an HTML gallery page is common enough to matter, and so is a founder pasting
// the address of the page a photo sits on rather than of the photo.
function directImageUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw || !/^https?:\/\//i.test(raw)) return "";
  // Some tags carry several URLs separated by ";". The first usable one wins.
  for (const candidate of raw.split(";")) {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > 2048) continue;
    const origin = (trimmed.match(/^(https?:\/\/[^/?#]+)/i) || [])[1] || "";
    if (!origin || !publicHttpUrl(origin)) continue;
    if (coverUrlServesImage(trimmed)) return trimmed;
  }
  return "";
}

// Normalizes an OSM contact:instagram tag — either a full profile URL or a
// bare handle like "@thebistro" — into a canonical profile link, or "".
function instagramProfileUrl(value) {
  const raw = cleanText(value, 300);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const url = publicHttpUrl(raw);
    if (!url) return "";
    const authority = (url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "";
    const host = authority.split(":")[0].toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com") ? url : "";
  }
  const handle = raw.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,64}$/.test(handle)
    ? "https://www.instagram.com/" + handle + "/"
    : "";
}

// Fills a published venue's public facts from OpenStreetMap by looking the
// place up by name and city: official website and Instagram profile (OSM
// contact tags) always when missing, plus street address, country, coordinates
// and a cover image when the recommending members supplied none. Fill-if-missing
// only — existing values are never overwritten — and the same claimed-city guard
// the address geocoder uses is applied before trusting a match. Best-effort and
// never throws: publication must not depend on an external service; the nightly
// sweep retries.
//
// The `image` tag is tried here rather than left to resolveCoverImage because it
// is both freer and better: no extra page fetch beyond the one that validates it,
// and an OSM `image` is usually a mapper's photograph of the actual frontage
// rather than a marketing still. resolveCoverImage runs after this in every call
// site and exits early once image_url is set, so the cheap source wins and the
// scrape stays the fallback.
function enrichVenueFromOsm(app, venueId) {
  let venue;
  try {
    venue = app.findRecordById("venues", venueId);
  } catch {
    return;
  }
  const name = cleanText(venue.getString("name"), 200);
  const city = cleanText(venue.getString("city"), 120);
  const country = cleanText(venue.getString("country"), 120);
  if (!name || !city) return;

  const existingLat = Number(venue.get("lat"));
  const existingLng = Number(venue.get("lng"));
  const hasCoords =
    (existingLat !== 0 || existingLng !== 0) &&
    Number.isFinite(existingLat) &&
    Number.isFinite(existingLng);
  const needsWebsite = !venue.getString("official_url");
  const needsInstagram = !venue.getString("instagram_url");
  const needsAddress = !cleanText(venue.getString("address"), 300);
  // The recommendation form no longer asks for a country, so this pass is where
  // most places get theirs. Nominatim returns it in the same addressdetails
  // payload the address and the claimed-city guard already read.
  const needsCountry = !country;
  const needsCover = !venue.getString("image_url");
  if (
    !needsWebsite &&
    !needsInstagram &&
    !needsAddress &&
    !needsCountry &&
    !needsCover &&
    hasCoords
  ) {
    return;
  }

  let response;
  try {
    response = $http.send({
      url:
        nominatimBaseUrl() +
        "/search?format=jsonv2&limit=3&addressdetails=1&extratags=1&accept-language=en&q=" +
        encodeURIComponent(name + ", " + city + (country ? ", " + country : "")),
      method: "GET",
      headers: { "User-Agent": "Detour community place verification (contact: olga@supernaut.dev)" },
      timeout: 10,
    });
  } catch {
    return;
  }
  if (!response || response.statusCode !== 200) return;

  let results;
  try {
    results = response.json;
  } catch {
    return;
  }
  if (!Array.isArray(results)) return;

  let hit = null;
  for (const candidate of results) {
    const parts = (candidate && candidate.address) || {};
    const hitCity = String(parts.city || parts.town || parts.village || parts.municipality || "");
    if (!hitCity || normalizePlacePart(hitCity) === normalizePlacePart(city)) {
      hit = candidate;
      break;
    }
  }
  if (!hit) return;

  const tags = hit.extratags || {};
  let changed = false;
  if (needsWebsite) {
    const website = publicHttpUrl(cleanText(tags.website || tags["contact:website"], 300));
    if (website) {
      venue.set("official_url", website);
      changed = true;
    }
  }
  if (needsInstagram) {
    const instagram = instagramProfileUrl(tags["contact:instagram"]);
    if (instagram) {
      venue.set("instagram_url", instagram);
      changed = true;
    }
  }
  if (needsAddress) {
    const parts = hit.address || {};
    const road = cleanText(String(parts.road || parts.pedestrian || parts.square || ""), 200);
    const houseNumber = cleanText(String(parts.house_number || ""), 20);
    const address = cleanText((houseNumber ? houseNumber + " " : "") + road, 300);
    if (address) {
      venue.set("address", address);
      changed = true;
    }
  }
  if (needsCountry) {
    // accept-language=en on the query above means this is the English short name,
    // which is the same vocabulary src/countries.ts uses.
    const resolvedCountry = cleanText(String((hit.address || {}).country || ""), 120);
    if (resolvedCountry.length >= 2) {
      venue.set("country", resolvedCountry);
      changed = true;
    }
  }
  if (needsCover) {
    const cover = directImageUrl(tags.image);
    if (cover) {
      venue.set("image_url", cover);
      changed = true;
    }
  }
  if (!hasCoords) {
    const hitLat = parseFloat(hit.lat);
    const hitLng = parseFloat(hit.lon);
    if (Number.isFinite(hitLat) && Number.isFinite(hitLng) && !(hitLat === 0 && hitLng === 0)) {
      venue.set("lat", hitLat);
      venue.set("lng", hitLng);
      venue.set(
        "coord_verification_note",
        cleanText(
          "Located via OpenStreetMap Nominatim place search: " + String(hit.display_name || ""),
          300
        )
      );
      changed = true;
    }
  }
  if (changed) app.save(venue);
}

// ---------------------------------------------------------------------------
// LLM web discovery.
//
// OpenStreetMap contact tags cover only a fraction of member-added places, so
// venues published with nothing but a name and city often stay without a
// website, Instagram profile, cover image, or map pin. This tier asks a small
// OpenAI model with the hosted web_search tool to *find* the missing public
// facts. Nothing it reports is trusted directly: a website must resolve and
// visibly mention the venue, an Instagram value must normalize to a canonical
// profile URL, and a discovered address is stored (and turned into
// coordinates) only after the same Nominatim claimed-city validation the
// address geocoder applies — coordinates never come from the model. Best
// effort and never throws; the sweep in main.pb.js bounds retries and cost
// through venues.web_discovery_at.

function openAiBaseUrl() {
  return $os.getenv("DETOUR_OPENAI_BASE_URL") || "https://api.openai.com";
}

function openAiModel() {
  return $os.getenv("DETOUR_OPENAI_MODEL") || "gpt-5.4-mini";
}

// A still-incomplete venue is retried at most weekly; some places genuinely
// have no website, and weekly keeps the standing cost of those near zero.
const WEB_DISCOVERY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

// Extracts the assistant's final text from an OpenAI Responses API payload.
function openAiOutputText(payload) {
  const items = (payload && payload.output) || [];
  let text = "";
  for (const item of items) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

// Parses the model's JSON answer, tolerating stray prose or code fences.
function parseDiscoveryAnswer(text) {
  const start = String(text).indexOf("{");
  const end = String(text).lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// True when the page at url loads and visibly mentions the venue name — the
// guard against the model returning a real but wrong-venue website.
function pageMentionsVenue(url, name) {
  let response;
  try {
    response = $http.send({
      url,
      method: "GET",
      headers: {
        "User-Agent": COVER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en",
      },
      timeout: 10,
    });
  } catch {
    return false;
  }
  if (!response || response.statusCode < 200 || response.statusCode >= 300) return false;
  const haystack = normalizePlacePart(String(response.raw || "").slice(0, 200000));
  const normalizedName = normalizePlacePart(name);
  if (normalizedName && haystack.indexOf(normalizedName) !== -1) return true;
  let longest = "";
  for (const word of normalizedName.split(" ")) {
    if (word.length > longest.length) longest = word;
  }
  return longest.length >= 4 && haystack.indexOf(longest) !== -1;
}

// Validates a model-discovered street address with the same Nominatim lookup
// and claimed-city guard the address geocoder uses. Returns
// { address, lat, lng, displayName } when confirmed, or null.
function confirmDiscoveredAddress(address, city, country) {
  let response;
  try {
    response = $http.send({
      url:
        nominatimBaseUrl() +
        "/search?format=jsonv2&limit=1&addressdetails=1&accept-language=en&q=" +
        encodeURIComponent(address + ", " + city + ", " + country),
      method: "GET",
      headers: { "User-Agent": "Detour community place verification (contact: olga@supernaut.dev)" },
      timeout: 10,
    });
  } catch {
    return null;
  }
  if (!response || response.statusCode !== 200) return null;
  let results;
  try {
    results = response.json;
  } catch {
    return null;
  }
  if (!Array.isArray(results) || results.length === 0) return null;
  const hit = results[0];
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const parts = hit.address || {};
  const hitCity = String(parts.city || parts.town || parts.village || parts.municipality || "");
  if (hitCity && normalizePlacePart(hitCity) !== normalizePlacePart(city)) return null;
  return { address, lat, lng, displayName: String(hit.display_name || "") };
}

// Asks the model (with hosted web search) for the venue's still-missing public
// facts and stores only what survives mechanical verification. Fill-if-missing
// only, like the OSM tier. Returns true when a paid model call was actually
// made so the sweep can cap per-run spend. No-ops without OPENAI_API_KEY —
// the deterministic pipeline keeps working unchanged.
function enrichVenueFromWebSearch(app, venueId) {
  const apiKey = $os.getenv("OPENAI_API_KEY");
  if (!apiKey) return false;

  let venue;
  try {
    venue = app.findRecordById("venues", venueId);
  } catch {
    return false;
  }

  const name = cleanText(venue.getString("name"), 200);
  const city = cleanText(venue.getString("city"), 120);
  const country = cleanText(venue.getString("country"), 120);
  if (!name || !city) return false;

  const knownWebsite = venue.getString("official_url");
  const knownInstagram = venue.getString("instagram_url");
  const knownAddress = cleanText(venue.getString("address"), 300);
  const needsWebsite = !knownWebsite;
  const needsInstagram = !knownInstagram;
  const needsAddress = !knownAddress;
  if (!needsWebsite && !needsInstagram && !needsAddress) return false;

  const stampRaw = venue.getString("web_discovery_at");
  const lastAttempt = stampRaw ? new Date(stampRaw.replace(" ", "T")).getTime() : 0;
  if (lastAttempt > 0 && Date.now() - lastAttempt < WEB_DISCOVERY_RETRY_MS) return false;

  const wanted = [];
  if (needsWebsite) wanted.push("official_url");
  if (needsInstagram) wanted.push("instagram_url");
  if (needsAddress) wanted.push("address");

  const instructions =
    "You verify public facts about food and drink venues. Use web search to " +
    "confirm the venue's official website, official Instagram profile, and " +
    "street address. Report only facts you confirmed on pages you actually " +
    "found; use the provided city, category, and known links to disambiguate " +
    "venues sharing a name, and when still unsure return null for that field " +
    "and set confidence to \"low\". Never guess. official_url must be the " +
    "venue's own site — never Google Maps, TripAdvisor, Yelp, delivery " +
    "platforms, booking portals, directories, or articles; the operating " +
    "group's page or a link-in-bio page is acceptable only when the venue " +
    "has no site of its own. instagram_url must be the venue's own profile, " +
    "as an instagram.com URL or @handle. address is street and number only, " +
    "without city or postcode. Respond with only this JSON object and " +
    "nothing else: {\"official_url\": string|null, \"instagram_url\": " +
    "string|null, \"address\": string|null, \"confidence\": \"high\"|\"low\"}";

  const inputLines = [
    "Find: " + wanted.join(", "),
    "Venue: " + name,
    "City: " + city,
  ];
  if (country) inputLines.push("Country: " + country);
  const categoryLabel = cleanText(venue.getString("category"), 120);
  if (categoryLabel) inputLines.push("Category: " + categoryLabel);
  if (knownAddress) inputLines.push("Known address: " + knownAddress);
  if (knownWebsite) inputLines.push("Known website: " + knownWebsite);
  if (knownInstagram) inputLines.push("Known Instagram: " + knownInstagram);

  let response;
  try {
    response = $http.send({
      url: openAiBaseUrl() + "/v1/responses",
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel(),
        // web_search is unsupported at minimal/none reasoning effort; low is
        // the cheapest level that still searches reliably.
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        instructions,
        input: inputLines.join("\n"),
      }),
      timeout: 120,
    });
  } catch {
    return false; // transport failure: leave unstamped so the next sweep retries
  }

  // From here on the attempt is stamped whatever the outcome, so a venue
  // whose facts genuinely cannot be found is retried weekly, not per sweep.
  venue.set("web_discovery_at", new Date().toISOString());

  function finish(noteParts) {
    venue.set("web_discovery_note", cleanText(openAiModel() + ": " + noteParts.join(", "), 300));
    app.save(venue);
    return true;
  }

  if (!response || response.statusCode < 200 || response.statusCode >= 300) {
    return finish(["HTTP " + (response ? response.statusCode : "?")]);
  }
  let payload;
  try {
    payload = response.json;
  } catch {
    payload = null;
  }
  const answer = payload ? parseDiscoveryAnswer(openAiOutputText(payload)) : null;
  if (!answer) return finish(["unparseable answer"]);

  // No global confidence gate. Each field below is independently verified —
  // the website must load and mention the venue, the address must geocode to
  // the claimed city, the Instagram must be a valid profile — so a fact the
  // model found and that survives its own check is kept even when the model
  // hedged about a different field. Previously a single "high" flag discarded
  // the whole answer, throwing away verified facts alongside the uncertain
  // one. The reported confidence is recorded in the note for audit only.
  const notes = ["confidence " + String(answer.confidence || "unknown").toLowerCase()];
  if (needsWebsite) {
    const website = publicHttpUrl(cleanText(answer.official_url, 300));
    if (!website) notes.push("website: none");
    else if (pageMentionsVenue(website, name)) {
      venue.set("official_url", website);
      notes.push("website: set");
    } else notes.push("website: rejected");
  }
  if (needsInstagram) {
    const instagram = instagramProfileUrl(answer.instagram_url);
    if (instagram) {
      venue.set("instagram_url", instagram);
      notes.push("instagram: set");
    } else notes.push("instagram: none");
  }
  if (needsAddress) {
    const candidate = cleanText(answer.address, 300);
    const confirmed = candidate ? confirmDiscoveredAddress(candidate, city, country) : null;
    if (confirmed) {
      venue.set("address", confirmed.address);
      notes.push("address: confirmed");
      const existingLat = Number(venue.get("lat"));
      const existingLng = Number(venue.get("lng"));
      const hasCoords =
        (existingLat !== 0 || existingLng !== 0) &&
        Number.isFinite(existingLat) &&
        Number.isFinite(existingLng);
      if (!hasCoords) {
        venue.set("lat", confirmed.lat);
        venue.set("lng", confirmed.lng);
        venue.set(
          "coord_verification_note",
          cleanText(
            "Geocoded via OpenStreetMap Nominatim from web-discovered address: " + confirmed.displayName,
            300
          )
        );
      }
    } else {
      notes.push(candidate ? "address: unconfirmed" : "address: none");
    }
  }
  return finish(notes);
}

// Member-supplied place links: official website, Instagram profile (handle or
// URL), and a direct cover image link. Normalizes each value into its stored
// canonical form and throws a BadRequestError naming the first problem.
// options.verifiedImageUrl carries the entry's already-stored image link so an
// unchanged value is not re-fetched on every edit; a new image link is checked
// to actually serve an image, so the public catalogue never renders a broken
// cover.
function validateMemberPlaceLinks(input, options) {
  const links = { official_url: "", instagram_url: "", image_url: "" };

  const website = cleanText(input.officialUrl, 300);
  if (website) {
    links.official_url = publicHttpUrl(website);
    if (!links.official_url) {
      throw new BadRequestError("The website link must be a public http(s) address.");
    }
  }

  const instagram = cleanText(input.instagram, 300);
  if (instagram) {
    links.instagram_url = instagramProfileUrl(instagram);
    if (!links.instagram_url) {
      throw new BadRequestError(
        "Add Instagram as a handle like @placename or an instagram.com profile link."
      );
    }
  }

  const image = cleanText(input.imageUrl, 2048);
  if (image) {
    const withScheme = /^https?:\/\//i.test(image) ? image : "https://" + image;
    const origin = (withScheme.match(/^(https?:\/\/[^/?#]+)/i) || [])[1] || "";
    if (!origin || !publicHttpUrl(origin)) {
      throw new BadRequestError("The image link must be a public http(s) address.");
    }
    const alreadyVerified =
      options && options.verifiedImageUrl && options.verifiedImageUrl === withScheme;
    if (!alreadyVerified && !coverUrlServesImage(withScheme)) {
      throw new BadRequestError(
        "That link does not serve an image. Use a direct link to a photo file."
      );
    }
    links.image_url = withScheme;
  }

  return links;
}

// True when member-supplied links must never overwrite an existing venue link.
//
// This used to mean "the venue carries recognition from a guide rather than the
// Detour community lane", read off `venue_awards`, and it failed CLOSED: any
// failed lookup counted as editorial. With the guide catalogue removed there is
// no editorial lane left — every published place is member-recommended — so the
// answer is now uniformly false and members can always correct poor automatic
// discovery on their own places.
//
// Kept as a named predicate rather than inlined, because the fail-closed version
// would have silently locked link editing on every place the moment
// `venue_awards` went away, and that failure mode should stay documented at the
// point where the decision is made.
function venueHasEditorialRecognition() {
  return false;
}

// Applies a waiting-list entry's member-supplied place links to a public
// venue. Missing venue links are always filled; a differing existing value is
// replaced only on venues whose recognition is community-only, so members can
// correct poor automatic discovery on their own published places while a
// catalogue venue's editorial links stay authoritative. Cleared entry links
// never clear venue links.
//
// `image_url` is deliberately absent from the merged fields. A cover is not a
// link: it is a photograph somebody took, and copying one member's picture onto
// the shared venue record made it everyone's — and let a card show that picture
// above a different member's words. Photos belong to the recommendation that
// submitted them (see the curation routes in main.pb.js); `venues.image_url` is
// written only by resolveCoverImage below, from the place's own web presence,
// and serves as the fallback for a place whose fronting recommendation has no
// photo of its own.
function mergeEntryLinksIntoVenue(app, entry, venue) {
  let editorial = null;
  let changed = false;
  for (const field of ["official_url", "instagram_url"]) {
    const supplied = cleanText(entry.getString(field), 2048);
    if (!supplied) continue;
    const current = cleanText(venue.getString(field), 2048);
    if (current === supplied) continue;
    if (current) {
      if (editorial === null) editorial = venueHasEditorialRecognition(app, venue.id);
      if (editorial) continue;
    }
    venue.set(field, supplied);
    changed = true;
  }
  if (changed) app.save(venue);
  return changed;
}

// Carries a member's corrected place details (name, city, country, address,
// category) from a waiting-list entry to its published venue. Mirrors
// mergeEntryLinksIntoVenue's guard: nothing is written to a venue that carries
// editorial (non-community) recognition, so members can fix their own
// community places while a catalogue venue's authoritative data is left alone.
// Empty entry values never clear venue values.
function mergeEntryPlaceIntoVenue(app, entry, venue) {
  if (venueHasEditorialRecognition(app, venue.id)) return false;
  let changed = false;
  const pairs = [
    ["venue_name", "name", 200],
    ["city", "city", 120],
    ["country", "country", 120],
    ["address", "address", 300],
    ["disambiguator", "disambiguator", 120],
  ];
  for (const [entryField, venueField, max] of pairs) {
    const supplied = cleanText(entry.getString(entryField), max);
    if (!supplied) continue;
    if (cleanText(venue.getString(venueField), max) === supplied) continue;
    venue.set(venueField, supplied);
    changed = true;
  }
  const categoryLabel = PLACE_CATEGORY_LABELS[entry.getString("category")] || "";
  if (categoryLabel && cleanText(venue.getString("category"), 120) !== categoryLabel) {
    venue.set("category", categoryLabel);
    changed = true;
  }
  if (changed) app.save(venue);
  return changed;
}

// A realistic browser UA: many restaurant sites (and all of Instagram) serve
// bot-detected requests an empty shell without og tags.
const COVER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function coverHeaderValue(response, name) {
  const headers = (response && response.headers) || {};
  const value = headers[name] !== undefined ? headers[name] : headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || "");
  return value === undefined || value === null ? "" : String(value);
}

// Pulls the social/cover image candidates out of an HTML document, resolving
// protocol-relative and root-relative URLs against the page. Purely relative
// paths are skipped — og:image is effectively always absolute in practice.
function extractCoverCandidates(html, pageUrl) {
  const origin = (String(pageUrl).match(/^(https?:\/\/[^/?#]+)/i) || [])[1] || "";
  const protocol = origin.slice(0, origin.indexOf(":") + 1);
  const candidates = [];
  for (const tag of String(html).match(/<meta\s[^>]*>/gi) || []) {
    const property = (tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!property || !content) continue;
    const key = property.toLowerCase();
    if (key === "og:image:secure_url") candidates.unshift(content);
    else if (key === "og:image" || key === "og:image:url") candidates.push(content);
    else if (key === "twitter:image" || key === "twitter:image:src") candidates.push(content);
  }

  const resolved = [];
  for (const raw of candidates) {
    const value = raw.replace(/&amp;/g, "&");
    let absolute = "";
    if (/^https?:\/\//i.test(value)) absolute = value;
    else if (value.indexOf("//") === 0 && protocol) absolute = protocol + value;
    else if (value.indexOf("/") === 0 && origin) absolute = origin + value;
    if (absolute && resolved.indexOf(absolute) === -1) resolved.push(absolute);
  }
  return resolved.slice(0, 6);
}

// True when the URL actually serves an image, checked with a 1-byte range GET
// so a cooperative server never sends the full file.
function coverUrlServesImage(url) {
  let response;
  try {
    response = $http.send({
      url,
      method: "GET",
      headers: { "User-Agent": COVER_USER_AGENT, Range: "bytes=0-0", Accept: "image/*" },
      timeout: 10,
    });
  } catch {
    return false;
  }
  if (!response || response.statusCode < 200 || response.statusCode >= 300) return false;
  return coverHeaderValue(response, "Content-Type").toLowerCase().indexOf("image/") === 0;
}

// Resolves a verified cover image URL from one venue web page, or "".
function coverFromPage(pageUrl) {
  const safeUrl = publicHttpUrl(pageUrl);
  if (!safeUrl) return "";
  let response;
  try {
    response = $http.send({
      url: safeUrl,
      method: "GET",
      headers: {
        "User-Agent": COVER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en",
      },
      timeout: 10,
    });
  } catch {
    return "";
  }
  if (!response || response.statusCode < 200 || response.statusCode >= 300) return "";
  for (const candidate of extractCoverCandidates(response.raw, safeUrl)) {
    // Candidate URLs (often long signed CDN links) get the same scheme/host
    // guard as member links, applied to their origin so length never trips it.
    const candidateOrigin = (candidate.match(/^(https?:\/\/[^/?#]+)/i) || [])[1] || "";
    if (candidate.length <= 2048 && publicHttpUrl(candidateOrigin) && coverUrlServesImage(candidate)) {
      return candidate;
    }
  }
  return "";
}

// Resolves a cover image for a published venue from its own web presence
// (og:image/twitter:image on the official site, then the Instagram profile)
// and stores the verified image URL. Never throws: publication must not
// depend on an external site. Venues that already have a cover are left
// untouched; the nightly sweep retries anything missed.
function resolveCoverImage(app, venueId) {
  let venue;
  try {
    venue = app.findRecordById("venues", venueId);
  } catch {
    return;
  }
  if (venue.getString("image_url")) return;
  const sources = [
    publicHttpUrl(venue.getString("official_url")),
    publicHttpUrl(venue.getString("instagram_url")),
  ].filter(Boolean);
  for (const source of sources) {
    const cover = coverFromPage(source);
    if (cover) {
      venue.set("image_url", cover);
      app.save(venue);
      return;
    }
  }
}

// The work-list every enrichment sweep runs over: published, un-suppressed
// places, newest first.
//
// This used to be derived from `venue_awards` rows and each sweep swallowed a
// failed lookup with `catch { return }` — so anything that broke the award query
// silently stopped all enrichment, with no error and no signal that newly
// published places were never getting coordinates, cover images, or discovered
// links. Keying on the venue's own marker removes both the indirection and the
// silent-failure mode; a genuine failure here still returns an empty list, but
// there is no longer a second collection that can independently disappear.
//
// This lives here rather than beside the cron definitions in main.pb.js because
// cronAdd callbacks run in an isolated VM: a module-scope helper in the same
// file is not in scope by the time the job fires, which threw
// "publishedVenuesForSweep is not defined" on every sweep. Reaching it through
// require -- as the callbacks already do for everything else -- is what makes it
// callable.
function publishedVenuesForSweep(app, limit) {
  try {
    return app.findRecordsByFilter(
      "venues",
      "published = true && suppressed != true",
      "-published_at",
      limit || 50,
      0
    );
  } catch {
    return [];
  }
}

module.exports = {
  addParticipants,
  claimPublicationNotification,
  cleanText,
  createOrResolveEntry,
  enrichVenueFromOsm,
  enrichVenueFromWebSearch,
  findEntryByPlace,
  findMemberRecommendation,
  geocodeVenue,
  placeCollisionData,
  publishedVenuesForSweep,
  hasConfirmedCoordinates,
  isParticipant,
  mergeEntryLinksIntoVenue,
  mergeEntryPlaceIntoVenue,
  mergePlaceFacts,
  mergePlaceLinks,
  normalizePlacePart,
  recalculateAndPublish,
  resolveCoverImage,
  validateMemberPlaceLinks,
  validateCategory,
  validateOccasions,
  requireVerifiedMember,
  resolveEntry,
  validateRecommendationNote,
  validateShareNote,
  withdrawUnbackedEntry,
};

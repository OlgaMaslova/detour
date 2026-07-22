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

function findCanonicalVenue(app, normalizedName, normalizedCity) {
  const venues = app.findRecordsByFilter("venues", "id != ''", "created", 10000, 0);
  for (const venue of venues) {
    if (
      normalizePlacePart(venue.getString("name")) === normalizedName &&
      normalizePlacePart(venue.getString("city")) === normalizedCity
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
  const normalizedName = normalizePlacePart(venueName);
  const normalizedCity = normalizePlacePart(city);

  if (venueName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid venue name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }

  const canonicalVenue = findCanonicalVenue(app, normalizedName, normalizedCity);
  if (canonicalVenue) {
    const canonicalCountry = cleanText(canonicalVenue.getString("country"), 120);
    if (!canonicalCountry) {
      throw new BadRequestError("The matching catalogue venue is missing its country.");
    }
    if (country && normalizePlacePart(country) !== normalizePlacePart(canonicalCountry)) {
      throw new BadRequestError(
        "The supplied country does not match the existing catalogue venue."
      );
    }
    venueName = cleanText(canonicalVenue.getString("name"), 200);
    city = cleanText(canonicalVenue.getString("city"), 120);
    country = canonicalCountry;
    const canonicalAddress = cleanText(canonicalVenue.getString("address"), 300);
    if (canonicalAddress) address = canonicalAddress;
  }

  if (country.length < 2) {
    throw new BadRequestError(
      "Country is required when the place is not already in the catalogue."
    );
  }

  return {
    venueName,
    city,
    country,
    address,
    normalizedName: normalizePlacePart(venueName),
    normalizedCity: normalizePlacePart(city),
    canonicalVenue,
  };
}

function validateEntryMatchesInput(entry, input) {
  const suppliedName = cleanText(input.venueName, 200);
  const suppliedCity = cleanText(input.city, 120);
  const suppliedCountry = cleanText(input.country, 120);

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
  if (
    suppliedCountry &&
    normalizePlacePart(suppliedCountry) !==
      normalizePlacePart(entry.getString("country"))
  ) {
    throw new BadRequestError("The supplied country does not match the waiting-list entry.");
  }
}

function createOrResolveEntry(app, input) {
  const place = sanitizePlaceInput(app, input);
  let existing = null;
  try {
    existing = app.findFirstRecordByFilter(
      "community_waitlist_entries",
      "normalized_name = {:name} && normalized_city = {:city}",
      { name: place.normalizedName, city: place.normalizedCity }
    );
  } catch {
    existing = null;
  }

  if (existing) {
    if (
      normalizePlacePart(existing.getString("country")) !==
      normalizePlacePart(place.country)
    ) {
      throw new BadRequestError(
        "A waiting-list entry already exists for this name and city with a different country."
      );
    }
    let changed = false;
    if (!existing.getString("canonical_venue") && place.canonicalVenue) {
      existing.set("canonical_venue", place.canonicalVenue.id);
      changed = true;
    }
    if (!existing.getString("address") && place.address) {
      existing.set("address", place.address);
      changed = true;
    }
    if (changed) app.save(existing);
    return { entry: existing, created: false };
  }

  const collection = app.findCollectionByNameOrId("community_waitlist_entries");
  const entry = new Record(collection);
  entry.set("venue_name", place.venueName);
  entry.set("city", place.city);
  entry.set("country", place.country);
  entry.set("address", place.address);
  entry.set("normalized_name", place.normalizedName);
  entry.set("normalized_city", place.normalizedCity);
  entry.set("status", "pending");
  entry.set("signal_count", 0);
  entry.set("participants", []);
  if (place.canonicalVenue) entry.set("canonical_venue", place.canonicalVenue.id);

  try {
    app.save(entry);
    return { entry, created: true };
  } catch (error) {
    // A concurrent request can win the normalized-name/city unique index. If it
    // did, converge on that row; otherwise preserve the original validation or
    // storage error.
    let concurrent = null;
    try {
      concurrent = app.findFirstRecordByFilter(
        "community_waitlist_entries",
        "normalized_name = {:name} && normalized_city = {:city}",
        { name: place.normalizedName, city: place.normalizedCity }
      );
    } catch {
      concurrent = null;
    }
    if (!concurrent) throw error;
    if (
      normalizePlacePart(concurrent.getString("country")) !==
      normalizePlacePart(place.country)
    ) {
      throw new BadRequestError(
        "A waiting-list entry already exists for this name and city with a different country."
      );
    }
    return { entry: concurrent, created: false };
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

function ensureEntryPending(entry, action) {
  if (entry.getString("status") === "published") {
    throw new BadRequestError("Published places cannot be " + action + ".");
  }
}

function publishEntry(app, entry) {
  const normalizedName = entry.getString("normalized_name");
  const normalizedCity = entry.getString("normalized_city");
  const country = cleanText(entry.getString("country"), 120);
  if (!normalizedName || !normalizedCity || country.length < 2) {
    throw new BadRequestError("The waiting-list entry is missing valid publication place data.");
  }

  let venue = null;
  const canonicalId = entry.getString("canonical_venue");
  if (canonicalId) {
    try {
      const linked = app.findRecordById("venues", canonicalId);
      if (
        normalizePlacePart(linked.getString("name")) === normalizedName &&
        normalizePlacePart(linked.getString("city")) === normalizedCity
      ) {
        venue = linked;
      }
    } catch {
      venue = null;
    }
  }
  if (!venue) venue = findCanonicalVenue(app, normalizedName, normalizedCity);

  const entryAddress = cleanText(entry.getString("address"), 300);
  const entryCategoryLabel = PLACE_CATEGORY_LABELS[entry.getString("category")] || "";
  if (venue) {
    if (!cleanText(venue.getString("country"), 120)) {
      throw new BadRequestError("The canonical venue is missing its required country.");
    }
    if (
      normalizePlacePart(venue.getString("country")) !== normalizePlacePart(country)
    ) {
      throw new BadRequestError(
        "The waiting-list country does not match the canonical venue country."
      );
    }
    let venueChanged = false;
    if (!cleanText(venue.getString("address"), 300) && entryAddress) {
      venue.set("address", entryAddress);
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
    venue.set("official_url", "");
    venue.set("category", entryCategoryLabel);
    venue.set("approx_location", false);
    app.save(venue);
  }

  // Member-supplied place links ride along with publication; the automatic
  // OSM/metadata discovery afterwards only fills whatever is still missing.
  mergeEntryLinksIntoVenue(app, entry, venue);

  let source;
  try {
    source = app.findFirstRecordByFilter(
      "guide_sources",
      "slug = 'detour-community'"
    );
  } catch {
    source = new Record(app.findCollectionByNameOrId("guide_sources"));
    source.set("slug", "detour-community");
  }
  const year = new Date().getUTCFullYear();
  source.set("name", "Detour community");
  source.set("official_url", "");
  source.set("current_year", year);
  app.save(source);

  let award;
  try {
    award = app.findFirstRecordByFilter(
      "venue_awards",
      "source = {:source} && venue = {:venue} && year = {:year} && level = {:level}",
      {
        source: source.id,
        venue: venue.id,
        year,
        level: "Detour community selection",
      }
    );
  } catch {
    award = new Record(app.findCollectionByNameOrId("venue_awards"));
    award.set("source", source.id);
    award.set("venue", venue.id);
    award.set("year", year);
    award.set("level", "Detour community selection");
  }
  award.set("rank", 0);
  award.set("source_url", "");
  award.set("current", true);
  award.set("verification_status", "verified");
  // Occasion tags are factual place facts; the public catalogue aggregates
  // them from recognition records.
  award.set("occasions", entry.getStringSlice("occasions"));
  app.save(award);

  // Keep exactly one current community-selection event for this venue while
  // retaining older events as public history.
  const otherCurrentAwards = app.findRecordsByFilter(
    "venue_awards",
    "source = {:source} && venue = {:venue} && level = {:level} && current = true && id != {:award}",
    "",
    1000,
    0,
    {
      source: source.id,
      venue: venue.id,
      level: "Detour community selection",
      award: award.id,
    }
  );
  for (const otherAward of otherCurrentAwards) {
    otherAward.set("current", false);
    app.save(otherAward);
  }

  // Publication state is the final write. No member identity, recommendation
  // prose, share prose, or source lead is copied to any public collection.
  entry.set("canonical_venue", venue.id);
  entry.set("published_venue", venue.id);
  entry.set("published_award", award.id);
  entry.set("published_at", new Date().toISOString());
  entry.set("publication_audit_id", "community-" + $security.randomString(32));
  entry.set("status", "published");
  app.save(entry);
}

function recalculateAndPublish(app, entryId) {
  if (!entryId) return;
  app.runInTransaction((txApp) => {
    let entry;
    try {
      entry = txApp.findRecordById("community_waitlist_entries", entryId);
    } catch {
      return;
    }

    // Count and Founder eligibility in one indexed aggregate instead of loading
    // every recommendation (and then every member) into the hook VM. COUNT
    // DISTINCT remains the source of truth for the persisted signal total.
    const summary = new DynamicModel({
      signal_count: 0,
      founder_signal_count: 0,
    });
    txApp
      .db()
      .newQuery(
        "SELECT COUNT(DISTINCT r.member) AS signal_count, " +
          "COUNT(DISTINCT CASE " +
          "WHEN COALESCE(m.direct_founder_invited, FALSE) = TRUE " +
          "OR COALESCE(m.founder_invitation_issuer, FALSE) = TRUE THEN r.member " +
          "END) AS founder_signal_count " +
          "FROM community_recommendations r " +
          "LEFT JOIN members m ON m.id = r.member " +
          "WHERE r.waitlist = {:waitlist}"
      )
      .bind({ waitlist: entry.id })
      .one(summary);

    const signalCount = Number(summary.signal_count || 0);
    const hasFounderSignal = Number(summary.founder_signal_count || 0) > 0;
    if (entry.getInt("signal_count") !== signalCount) {
      entry.set("signal_count", signalCount);
      txApp.save(entry);
    }

    // A recommendation by the Founder (issuer) or a directly Founder-invited
    // member bypasses the standard three-distinct-member threshold. Descendant
    // markers are intentionally not consulted here.
    if (
      entry.getString("status") === "pending" &&
      (hasFounderSignal || signalCount >= 3)
    ) {
      publishEntry(txApp, entry);
    }
  });
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
// contact tags) always when missing, plus street address and coordinates when
// the recommending members supplied none. Fill-if-missing only — existing
// values are never overwritten — and the same claimed-city guard the address
// geocoder uses is applied before trusting a match. Best-effort and never
// throws: publication must not depend on an external service; the nightly
// sweep retries.
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
  if (!needsWebsite && !needsInstagram && !needsAddress && hasCoords) return;

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

// True when the venue carries recognition from any source other than the
// Detour community lane — editorial catalogue data that member-supplied links
// must never overwrite. Fails closed: unknown provenance counts as editorial.
function venueHasEditorialRecognition(app, venueId) {
  let awards = [];
  try {
    awards = app.findRecordsByFilter("venue_awards", "venue = {:venue}", "", 200, 0, {
      venue: venueId,
    });
  } catch {
    return true;
  }
  for (const award of awards) {
    try {
      const source = app.findRecordById("guide_sources", award.getString("source"));
      if (source.getString("slug") !== "detour-community") return true;
    } catch {
      return true;
    }
  }
  return false;
}

// Applies a waiting-list entry's member-supplied place links to a public
// venue. Missing venue links are always filled; a differing existing value is
// replaced only on venues whose recognition is community-only, so members can
// correct poor automatic discovery on their own published places while a
// catalogue venue's editorial links stay authoritative. Cleared entry links
// never clear venue links.
function mergeEntryLinksIntoVenue(app, entry, venue) {
  let editorial = null;
  let changed = false;
  for (const field of ["official_url", "instagram_url", "image_url"]) {
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

module.exports = {
  addParticipants,
  cleanText,
  createOrResolveEntry,
  ensureEntryPending,
  enrichVenueFromOsm,
  findMemberRecommendation,
  geocodeVenue,
  isParticipant,
  mergeEntryLinksIntoVenue,
  mergePlaceFacts,
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
};

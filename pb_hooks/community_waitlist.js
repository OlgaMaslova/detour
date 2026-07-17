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
    if (changed) app.save(existing);
    return { entry: existing, created: false };
  }

  const collection = app.findCollectionByNameOrId("community_waitlist_entries");
  const entry = new Record(collection);
  entry.set("venue_name", place.venueName);
  entry.set("city", place.city);
  entry.set("country", place.country);
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
  } else {
    const venues = app.findCollectionByNameOrId("venues");
    venue = new Record(venues);
    venue.set("name", cleanText(entry.getString("venue_name"), 200));
    venue.set("city", cleanText(entry.getString("city"), 120));
    venue.set("country", country);
    venue.set("address", "");
    venue.set("official_url", "");
    venue.set("category", "");
    venue.set("approx_location", false);
    app.save(venue);
  }

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

    const recommendations = txApp.findRecordsByFilter(
      "community_recommendations",
      "waitlist = {:waitlist}",
      "",
      10000,
      0,
      { waitlist: entry.id }
    );
    const distinctMembers = {};
    for (const recommendation of recommendations) {
      const memberId = recommendation.getString("member");
      if (memberId) distinctMembers[memberId] = true;
    }
    const signalCount = Object.keys(distinctMembers).length;
    if (entry.getInt("signal_count") !== signalCount) {
      entry.set("signal_count", signalCount);
      txApp.save(entry);
    }

    if (entry.getString("status") === "pending" && signalCount >= 3) {
      publishEntry(txApp, entry);
    }
  });
}

module.exports = {
  addParticipants,
  cleanText,
  createOrResolveEntry,
  ensureEntryPending,
  findMemberRecommendation,
  isParticipant,
  normalizePlacePart,
  recalculateAndPublish,
  requireVerifiedMember,
  resolveEntry,
  validateRecommendationNote,
  validateShareNote,
};

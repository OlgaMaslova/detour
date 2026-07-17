/// <reference path="../pb_data/types.d.ts" />
//
// Removes the one-time authenticated live-verification fixtures created by
// 1767989000. It is intentionally forward-only and careful to delete only the
// operational members and the queue artifacts they created before dropping the
// private credential collection itself. On a fresh deployment both migrations
// run in sequence, so no fixture account or credential remains when serving.
migrate((app) => {
  const CREDENTIAL_COLLECTION = "community_live_verification_credentials";
  const fixtureEmails = [
    "community-live-verification-1@detour.invalid",
    "community-live-verification-2@detour.invalid",
    "community-live-verification-3@detour.invalid",
  ];

  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
    }
  }

  function findRecordOrNull(collection, id) {
    if (!id) return null;
    try {
      return app.findRecordById(collection, id);
    } catch {
      return null;
    }
  }

  function deleteIfPresent(record) {
    if (record) app.delete(record);
  }

  const credentials = findCollectionOrNull(CREDENTIAL_COLLECTION);
  if (!credentials) return null;

  const fixtureMemberIds = {};
  for (const credential of app.findRecordsByFilter(
    CREDENTIAL_COLLECTION,
    "id != ''",
    "",
    1000,
    0
  )) {
    const memberId = credential.getString("member");
    if (memberId) fixtureMemberIds[memberId] = true;
  }
  for (const email of fixtureEmails) {
    try {
      const member = app.findFirstRecordByFilter("members", "email = {:email}", {
        email,
      });
      fixtureMemberIds[member.id] = true;
    } catch {
      // A partial fixture creation can legitimately omit a member.
    }
  }

  const fixtureEntryIds = {};
  for (const entry of app.findRecordsByFilter(
    "community_waitlist_entries",
    "id != ''",
    "",
    10000,
    0
  )) {
    if (entry.getStringSlice("participants").some((id) => fixtureMemberIds[id])) {
      fixtureEntryIds[entry.id] = true;
    }
  }

  // Remove private child records explicitly before their waiting-list parents.
  for (const recommendation of app.findRecordsByFilter(
    "community_recommendations",
    "id != ''",
    "",
    10000,
    0
  )) {
    if (
      fixtureMemberIds[recommendation.getString("member")] ||
      fixtureEntryIds[recommendation.getString("waitlist")]
    ) {
      deleteIfPresent(recommendation);
    }
  }
  for (const share of app.findRecordsByFilter(
    "community_shares",
    "id != ''",
    "",
    10000,
    0
  )) {
    if (
      fixtureMemberIds[share.getString("sender")] ||
      fixtureMemberIds[share.getString("recipient")] ||
      fixtureEntryIds[share.getString("waitlist")]
    ) {
      deleteIfPresent(share);
    }
  }

  const fixtureAwardIds = {};
  const fixtureVenueIds = {};
  for (const entryId of Object.keys(fixtureEntryIds)) {
    const entry = findRecordOrNull("community_waitlist_entries", entryId);
    if (!entry) continue;
    const awardId = entry.getString("published_award");
    const venueId = entry.getString("published_venue");
    if (awardId) fixtureAwardIds[awardId] = true;
    if (venueId) fixtureVenueIds[venueId] = true;
    deleteIfPresent(entry);
  }

  const affectedSourceIds = {};
  for (const awardId of Object.keys(fixtureAwardIds)) {
    const award = findRecordOrNull("venue_awards", awardId);
    if (!award) continue;
    const sourceId = award.getString("source");
    if (sourceId) affectedSourceIds[sourceId] = true;
    deleteIfPresent(award);
  }

  // The only venue this procedure can create follows the fixed operational
  // fixture prefix. A pre-existing catalogue place is never deleted.
  for (const venueId of Object.keys(fixtureVenueIds)) {
    const venue = findRecordOrNull("venues", venueId);
    if (!venue) continue;
    const remainingAwards = app.findRecordsByFilter(
      "venue_awards",
      "venue = {:venue}",
      "",
      1,
      0,
      { venue: venue.id }
    );
    if (
      remainingAwards.length === 0 &&
      venue.getString("name").indexOf("Detour Operational Waitlist ") === 0 &&
      venue.getString("city") === "Verification City" &&
      venue.getString("country") === "Testland"
    ) {
      deleteIfPresent(venue);
    }
  }

  for (const sourceId of Object.keys(affectedSourceIds)) {
    const source = findRecordOrNull("guide_sources", sourceId);
    if (!source || source.getString("slug") !== "detour-community") continue;
    const remainingAwards = app.findRecordsByFilter(
      "venue_awards",
      "source = {:source}",
      "",
      1,
      0,
      { source: source.id }
    );
    if (remainingAwards.length === 0) deleteIfPresent(source);
  }

  for (const credential of app.findRecordsByFilter(
    CREDENTIAL_COLLECTION,
    "id != ''",
    "",
    1000,
    0
  )) {
    deleteIfPresent(credential);
  }
  for (const memberId of Object.keys(fixtureMemberIds)) {
    deleteIfPresent(findRecordOrNull("members", memberId));
  }

  // There are no credentials or client rules to retain once the controlled
  // smoke test has completed.
  app.delete(credentials);
}, () => {
  // Forward-only: production verification fixtures are never recreated by a
  // rollback operation.
  return null;
});

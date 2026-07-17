/// <reference path="../pb_data/types.d.ts" />
//
// Removes the isolated fixtures used by the controlled community frontend
// browser verification. This migration is forward-only and deliberately
// convergent: fixture members are always rediscovered from their four fixed
// .invalid emails, even when an interrupted prior run already removed the
// optional credential collection.
migrate((app) => {
  const CREDENTIAL_COLLECTION = "community_frontend_verification_credentials";
  const fixtureEmails = [
    "community-frontend-verification-a@detour.invalid",
    "community-frontend-verification-b@detour.invalid",
    "community-frontend-verification-c@detour.invalid",
    "community-frontend-verification-d@detour.invalid",
  ];
  const fixtureEmailSet = {};
  for (const email of fixtureEmails) fixtureEmailSet[email] = true;

  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
    }
  }

  function findRecordOrNull(collection, id) {
    if (!collection || !id) return null;
    try {
      const records = app.findRecordsByFilter(
        collection.id,
        "id = {:id}",
        "",
        1,
        0,
        { id }
      );
      return records.length ? records[0] : null;
    } catch (error) {
      throw new Error("Unable to inspect " + collection.name + " record: " + error);
    }
  }

  function findFirstOrNull(collection, filter, params) {
    if (!collection) return null;
    try {
      const records = app.findRecordsByFilter(collection.id, filter, "", 1, 0, params);
      return records.length ? records[0] : null;
    } catch (error) {
      throw new Error("Unable to inspect " + collection.name + " records: " + error);
    }
  }

  function findAllGuarded(collection) {
    if (!collection) return [];
    const records = [];
    let offset = 0;
    while (true) {
      let batch;
      try {
        batch = app.findRecordsByFilter(collection.id, "id != ''", "id", 1000, offset);
      } catch (error) {
        throw new Error("Unable to inspect " + collection.name + " records: " + error);
      }
      for (const record of batch) records.push(record);
      if (batch.length < 1000) return records;
      offset += batch.length;
    }
  }

  function recordString(record, field) {
    if (!record) return "";
    try {
      return record.getString(field);
    } catch {
      return "";
    }
  }

  function recordStringSlice(record, field) {
    if (!record) return [];
    try {
      return record.getStringSlice(field);
    } catch {
      return [];
    }
  }

  function deleteRecord(record) {
    if (record) app.delete(record);
  }

  const members = findCollectionOrNull("members");
  const credentials = findCollectionOrNull(CREDENTIAL_COLLECTION);
  const endorsements = findCollectionOrNull("endorsements");
  const recommendations = findCollectionOrNull("community_recommendations");
  const shares = findCollectionOrNull("community_shares");
  const entries = findCollectionOrNull("community_waitlist_entries");
  const awards = findCollectionOrNull("venue_awards");
  const venues = findCollectionOrNull("venues");

  // Exact fixture emails are the trust boundary. Credential relations are used
  // only when both the credential email and the related member's real email are
  // one of those four fixed values, so a stray credential row cannot target a
  // customer member or any artifacts linked to one.
  const fixtureMemberIds = {};
  for (const email of fixtureEmails) {
    const member = findFirstOrNull(members, "email = {:email}", { email });
    if (member && fixtureEmailSet[recordString(member, "email")]) {
      fixtureMemberIds[member.id] = true;
    }
  }
  for (const credential of findAllGuarded(credentials)) {
    const credentialEmail = recordString(credential, "email");
    if (!fixtureEmailSet[credentialEmail]) continue;
    const member = findRecordOrNull(members, recordString(credential, "member"));
    if (member && fixtureEmailSet[recordString(member, "email")]) {
      fixtureMemberIds[member.id] = true;
    }
  }

  // Capture every fixture-participant entry and its publication links before
  // deleting anything. Entries are intentionally deleted after their published
  // artifacts so an interrupted run can rediscover any work still outstanding.
  const fixtureEntryIds = {};
  const capturedAwardIds = {};
  const capturedVenueIds = {};
  for (const entry of findAllGuarded(entries)) {
    const hasFixtureParticipant = recordStringSlice(entry, "participants").some(
      (memberId) => fixtureMemberIds[memberId]
    );
    if (!hasFixtureParticipant) continue;
    fixtureEntryIds[entry.id] = true;
    const awardId = recordString(entry, "published_award");
    const venueId = recordString(entry, "published_venue");
    if (awardId) capturedAwardIds[awardId] = true;
    if (venueId) capturedVenueIds[venueId] = true;
  }

  for (const endorsement of findAllGuarded(endorsements)) {
    if (
      fixtureMemberIds[recordString(endorsement, "endorser")] ||
      fixtureMemberIds[recordString(endorsement, "endorsee")]
    ) {
      deleteRecord(endorsement);
    }
  }

  for (const recommendation of findAllGuarded(recommendations)) {
    if (
      fixtureMemberIds[recordString(recommendation, "member")] ||
      fixtureEntryIds[recordString(recommendation, "waitlist")]
    ) {
      deleteRecord(recommendation);
    }
  }

  for (const share of findAllGuarded(shares)) {
    if (
      fixtureMemberIds[recordString(share, "sender")] ||
      fixtureMemberIds[recordString(share, "recipient")] ||
      fixtureEntryIds[recordString(share, "waitlist")]
    ) {
      deleteRecord(share);
    }
  }

  // Delete only award records explicitly captured from fixture entries. The
  // production Detour community guide source is intentionally never changed.
  for (const awardId of Object.keys(capturedAwardIds)) {
    deleteRecord(findRecordOrNull(awards, awardId));
  }

  // A captured venue is removable only when it is now awardless and still has
  // the exact controlled-test identity. Existing catalogue/customer places are
  // never selected by name alone and are never modified.
  for (const venueId of Object.keys(capturedVenueIds)) {
    const venue = findRecordOrNull(venues, venueId);
    if (!venue) continue;

    let hasRemainingAward = false;
    if (awards) {
      try {
        hasRemainingAward =
          app.findRecordsByFilter(
            awards.id,
            "venue = {:venue}",
            "id",
            1,
            0,
            { venue: venue.id }
          ).length > 0;
      } catch {
        // A guarded lookup failure must preserve the venue, never risk deleting
        // a place whose remaining award state could not be established.
        hasRemainingAward = true;
      }
    }

    if (
      !hasRemainingAward &&
      recordString(venue, "name").indexOf("Detour Frontend Verification") === 0 &&
      recordString(venue, "city") === "Verification City" &&
      recordString(venue, "country") === "Testland"
    ) {
      deleteRecord(venue);
    }
  }

  for (const entryId of Object.keys(fixtureEntryIds)) {
    deleteRecord(findRecordOrNull(entries, entryId));
  }

  // Remove the private credential rows before their auth members, then remove
  // the temporary collection. If the collection vanished in a partial prior
  // run, the fixed-email member cleanup above and below still proceeds.
  for (const credential of findAllGuarded(credentials)) {
    deleteRecord(credential);
  }
  for (const memberId of Object.keys(fixtureMemberIds)) {
    const member = findRecordOrNull(members, memberId);
    if (member && fixtureEmailSet[recordString(member, "email")]) {
      deleteRecord(member);
    }
  }
  if (credentials) app.delete(credentials);
}, () => {
  // Forward-only: verification fixtures and runtime credentials must never be
  // recreated by a rollback operation.
  return null;
});

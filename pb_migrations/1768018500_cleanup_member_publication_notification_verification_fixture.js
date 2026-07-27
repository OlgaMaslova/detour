/// <reference path="../pb_data/types.d.ts" />
//
// Removes only the controlled publication-notification verification fixture and
// the exact place it published. The cleanup is forward-only and convergent:
// every unstable live id is rediscovered from the fixed member and place trust
// boundaries before deletion, while delivery receipts and mailbox history are
// deliberately left untouched.
migrate((app) => {
  const CREDENTIAL_COLLECTION =
    "member_publication_notification_verification_credentials";
  const FIXTURE_EMAIL = "agent@detour.supernaut.to";
  const FIXTURE_DISPLAY_NAME =
    "Detour publication notification verification";
  const FIXTURE_PLACE_NAME = "Detour Notification Delivery Check 20260727";
  const FIXTURE_CITY = "Verification City";
  const FIXTURE_COUNTRY = "Testland";
  const FIXTURE_NORMALIZED_NAME =
    "detour notification delivery check 20260727";
  const FIXTURE_NORMALIZED_CITY = "verification city";
  const COMMUNITY_AWARD_LEVEL = "Detour community selection";

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

  function findAllByFilterGuarded(collection, filter, params) {
    if (!collection) return [];
    const records = [];
    let offset = 0;
    while (true) {
      let batch;
      try {
        batch = app.findRecordsByFilter(
          collection.id,
          filter,
          "id",
          1000,
          offset,
          params || {}
        );
      } catch (error) {
        throw new Error("Unable to inspect " + collection.name + " records: " + error);
      }
      for (const record of batch) records.push(record);
      if (batch.length < 1000) return records;
      offset += batch.length;
    }
  }

  function findAllGuarded(collection) {
    return findAllByFilterGuarded(collection, "id != ''", {});
  }

  function hasAnyByFilterGuarded(collection, filter, params) {
    if (!collection) return false;
    try {
      return (
        app.findRecordsByFilter(collection.id, filter, "id", 1, 0, params || {})
          .length > 0
      );
    } catch (error) {
      throw new Error("Unable to inspect " + collection.name + " records: " + error);
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

  function addRecordById(target, record) {
    if (record) target[record.id] = record;
  }

  function isExactFixtureMember(record) {
    return (
      recordString(record, "email") === FIXTURE_EMAIL &&
      recordString(record, "display_name") === FIXTURE_DISPLAY_NAME
    );
  }

  function hasExactRawPlace(record, nameField) {
    return (
      recordString(record, nameField) === FIXTURE_PLACE_NAME &&
      recordString(record, "city") === FIXTURE_CITY &&
      recordString(record, "country") === FIXTURE_COUNTRY
    );
  }

  function isExactFixtureEntry(record) {
    return (
      hasExactRawPlace(record, "venue_name") &&
      recordString(record, "normalized_name") === FIXTURE_NORMALIZED_NAME &&
      recordString(record, "normalized_city") === FIXTURE_NORMALIZED_CITY
    );
  }

  function isExactFixtureRecommendation(record) {
    return hasExactRawPlace(record, "venue_name");
  }

  function isExactFixtureVenue(record) {
    return hasExactRawPlace(record, "name");
  }

  const members = findCollectionOrNull("members");
  let credentials = findCollectionOrNull(CREDENTIAL_COLLECTION);
  const recommendations = findCollectionOrNull("community_recommendations");
  const shares = findCollectionOrNull("community_shares");
  const entries = findCollectionOrNull("community_waitlist_entries");
  const awards = findCollectionOrNull("venue_awards");
  const venues = findCollectionOrNull("venues");
  const visitEvidence = findCollectionOrNull("visit_evidence");
  const submissions = findCollectionOrNull("detour_submissions");
  const sourceRecords = findCollectionOrNull("guide_source_records");
  const endorsements = findCollectionOrNull("endorsements");
  const contributions = findCollectionOrNull("member_place_contributions");
  const shareReplies = findCollectionOrNull("community_share_replies");
  const invites = findCollectionOrNull("invites");

  // Email alone is never enough to select an auth record. Only the exact email
  // and display-name pair establishes the temporary member trust boundary.
  const fixtureMembers = {};
  for (const member of findAllByFilterGuarded(members, "email = {:email}", {
    email: FIXTURE_EMAIL,
  })) {
    if (isExactFixtureMember(member)) addRecordById(fixtureMembers, member);
  }

  // The live ids can change across retries. Rediscover only entries with the
  // exact raw and normalized place identity that still explicitly include an
  // exact fixture member as a participant.
  const fixtureEntries = {};
  for (const entry of findAllByFilterGuarded(
    entries,
    "normalized_name = {:name} && normalized_city = {:city}",
    { name: FIXTURE_NORMALIZED_NAME, city: FIXTURE_NORMALIZED_CITY }
  )) {
    if (!isExactFixtureEntry(entry)) continue;
    const participants = recordStringSlice(entry, "participants");
    if (
      Object.keys(fixtureMembers).some(
        (memberId) => participants.indexOf(memberId) !== -1
      )
    ) {
      addRecordById(fixtureEntries, entry);
    }
  }

  // Remove only the exact fixture member's exact recommendation signal pointing
  // at the exact fixture entry. A malformed or unrelated recommendation is left
  // in place and therefore blocks entry/public-artifact cleanup below.
  for (const memberId of Object.keys(fixtureMembers)) {
    for (const recommendation of findAllByFilterGuarded(
      recommendations,
      "member = {:member}",
      { member: memberId }
    )) {
      if (
        recordString(recommendation, "member") === memberId &&
        fixtureEntries[recordString(recommendation, "waitlist")] &&
        isExactFixtureRecommendation(recommendation)
      ) {
        deleteRecord(recommendation);
      }
    }
  }

  // An entry becomes eligible only after the exact fixture recommendation is
  // gone and no other recommendation or share remains. Publication ids are
  // captured before any linked record or the entry itself is deleted.
  const removableEntries = {};
  const capturedAwardVenueIds = {};
  const capturedVenueIds = {};
  for (const entryId of Object.keys(fixtureEntries)) {
    const entry = findRecordOrNull(entries, entryId);
    if (!entry || !isExactFixtureEntry(entry)) continue;

    const participants = recordStringSlice(entry, "participants");
    if (
      !Object.keys(fixtureMembers).some(
        (memberId) => participants.indexOf(memberId) !== -1
      )
    ) {
      continue;
    }

    const remainingRecommendations = findAllByFilterGuarded(
      recommendations,
      "waitlist = {:waitlist}",
      { waitlist: entry.id }
    );
    const remainingShares = findAllByFilterGuarded(
      shares,
      "waitlist = {:waitlist}",
      { waitlist: entry.id }
    );
    if (remainingRecommendations.length || remainingShares.length) continue;

    removableEntries[entry.id] = entry;
    const venueIdsForEntry = {};
    const publishedVenueId = recordString(entry, "published_venue");
    const canonicalVenueId = recordString(entry, "canonical_venue");
    if (publishedVenueId) {
      venueIdsForEntry[publishedVenueId] = true;
      capturedVenueIds[publishedVenueId] = true;
    }
    if (canonicalVenueId) {
      venueIdsForEntry[canonicalVenueId] = true;
      capturedVenueIds[canonicalVenueId] = true;
    }

    const awardId = recordString(entry, "published_award");
    if (awardId) {
      if (!capturedAwardVenueIds[awardId]) capturedAwardVenueIds[awardId] = {};
      for (const venueId of Object.keys(venueIdsForEntry)) {
        capturedAwardVenueIds[awardId][venueId] = true;
      }
    }
  }

  function awardHasProtectedDependency(awardId) {
    for (const entry of findAllByFilterGuarded(
      entries,
      "published_award = {:award}",
      { award: awardId }
    )) {
      if (!removableEntries[entry.id]) return true;
    }
    return hasAnyByFilterGuarded(
      submissions,
      "published_award = {:award}",
      { award: awardId }
    );
  }

  // Delete only an award explicitly linked by an eligible entry, at one of that
  // entry's captured venues, with the exact community-selection level and exact
  // test venue identity. The shared guide source is never read for deletion or
  // modified, and another record's publication link preserves the award.
  for (const awardId of Object.keys(capturedAwardVenueIds)) {
    const award = findRecordOrNull(awards, awardId);
    if (!award || recordString(award, "level") !== COMMUNITY_AWARD_LEVEL) continue;

    const venueId = recordString(award, "venue");
    if (!venueId || !capturedAwardVenueIds[awardId][venueId]) continue;
    const venue = findRecordOrNull(venues, venueId);
    if (!isExactFixtureVenue(venue) || awardHasProtectedDependency(award.id)) continue;
    deleteRecord(award);
  }

  function venueHasProtectedDependency(venueId) {
    if (
      hasAnyByFilterGuarded(shares, "venue = {:venue}", { venue: venueId }) ||
      hasAnyByFilterGuarded(visitEvidence, "venue = {:venue}", { venue: venueId }) ||
      hasAnyByFilterGuarded(submissions, "venue = {:venue}", { venue: venueId }) ||
      hasAnyByFilterGuarded(submissions, "published_venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(sourceRecords, "venue = {:venue}", { venue: venueId })
    ) {
      return true;
    }

    for (const entry of findAllByFilterGuarded(
      entries,
      "canonical_venue = {:venue}",
      { venue: venueId }
    )) {
      if (!removableEntries[entry.id]) return true;
    }
    for (const entry of findAllByFilterGuarded(
      entries,
      "published_venue = {:venue}",
      { venue: venueId }
    )) {
      if (!removableEntries[entry.id]) return true;
    }
    return false;
  }

  // A captured exact test venue is removable only after every award is gone.
  // Additional direct references also preserve it so cleanup cannot cascade
  // into unrelated private or catalogue records.
  for (const venueId of Object.keys(capturedVenueIds)) {
    const venue = findRecordOrNull(venues, venueId);
    if (!isExactFixtureVenue(venue) || !awards) continue;
    if (
      findAllByFilterGuarded(awards, "venue = {:venue}", { venue: venue.id })
        .length !== 0
    ) {
      continue;
    }
    if (!venueHasProtectedDependency(venue.id)) deleteRecord(venue);
  }

  // Recheck the full entry guard immediately before deletion. Linked award and
  // venue deletions may clear relation fields, but the exact identity,
  // participant, and dependency conditions must still hold.
  for (const entryId of Object.keys(removableEntries)) {
    const entry = findRecordOrNull(entries, entryId);
    if (!entry || !isExactFixtureEntry(entry)) continue;
    const participants = recordStringSlice(entry, "participants");
    if (
      !Object.keys(fixtureMembers).some(
        (memberId) => participants.indexOf(memberId) !== -1
      )
    ) {
      continue;
    }
    if (
      hasAnyByFilterGuarded(recommendations, "waitlist = {:waitlist}", {
        waitlist: entry.id,
      }) ||
      hasAnyByFilterGuarded(shares, "waitlist = {:waitlist}", {
        waitlist: entry.id,
      })
    ) {
      continue;
    }
    deleteRecord(entry);
  }

  function fixtureTestRelationshipsGone(memberId) {
    for (const entry of findAllByFilterGuarded(
      entries,
      "normalized_name = {:name} && normalized_city = {:city}",
      { name: FIXTURE_NORMALIZED_NAME, city: FIXTURE_NORMALIZED_CITY }
    )) {
      if (
        isExactFixtureEntry(entry) &&
        recordStringSlice(entry, "participants").indexOf(memberId) !== -1
      ) {
        return false;
      }
    }
    for (const recommendation of findAllByFilterGuarded(
      recommendations,
      "member = {:member}",
      { member: memberId }
    )) {
      const entry = findRecordOrNull(
        entries,
        recordString(recommendation, "waitlist")
      );
      if (
        isExactFixtureRecommendation(recommendation) &&
        isExactFixtureEntry(entry) &&
        recordStringSlice(entry, "participants").indexOf(memberId) !== -1
      ) {
        return false;
      }
    }
    return true;
  }

  // Credential rows require both the exact fixture email and the exact fixture
  // member relation. They are removed only after that member's controlled test
  // relationships are gone; unrelated rows keep the collection intact.
  for (const memberId of Object.keys(fixtureMembers)) {
    if (!fixtureTestRelationshipsGone(memberId)) continue;
    for (const credential of findAllByFilterGuarded(
      credentials,
      "email = {:email} && member = {:member}",
      { email: FIXTURE_EMAIL, member: memberId }
    )) {
      if (
        recordString(credential, "email") === FIXTURE_EMAIL &&
        recordString(credential, "member") === memberId
      ) {
        deleteRecord(credential);
      }
    }
  }
  if (credentials && findAllGuarded(credentials).length === 0) {
    app.delete(credentials);
    credentials = null;
  }

  function memberHasRemainingRelationship(memberId) {
    if (
      hasAnyByFilterGuarded(recommendations, "member = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(shares, "sender = {:member}", { member: memberId }) ||
      hasAnyByFilterGuarded(shares, "recipient = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(entries, "participants ?= {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(visitEvidence, "member = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(submissions, "member = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(endorsements, "endorser = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(endorsements, "endorsee = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(contributions, "member = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(shareReplies, "author = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(invites, "issued_by = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(invites, "claimed_by = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(members, "invited_by = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(credentials, "member = {:member}", {
        member: memberId,
      })
    ) {
      return true;
    }
    return false;
  }

  // Delete the auth fixture last. Any remaining relation, including an
  // unexpected unrelated one, preserves the member instead of allowing a
  // cascade to delete or alter another record.
  for (const memberId of Object.keys(fixtureMembers)) {
    const member = findRecordOrNull(members, memberId);
    if (!isExactFixtureMember(member)) continue;
    if (!fixtureTestRelationshipsGone(member.id)) continue;
    if (recordString(member, "invited_by") || recordString(member, "redeemed_invite")) {
      continue;
    }
    if (!memberHasRemainingRelationship(member.id)) deleteRecord(member);
  }
}, () => {
  // Forward-only: removed smoke-test fixtures and public test artifacts must
  // never be recreated by rollback, while delivery evidence remains durable.
  return null;
});

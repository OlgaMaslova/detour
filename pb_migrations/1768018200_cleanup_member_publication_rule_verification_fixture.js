/// <reference path="../pb_data/types.d.ts" />
//
// Removes only the controlled member-publication verification fixture created
// by 1768018100 and the exact operational place published by its authenticated
// live check. The cleanup is forward-only and convergent after partial runs:
// every relation is rediscovered from fixed fixture identifiers before it is
// removed, and the shared Detour community guide source is never changed.
migrate((app) => {
  const CREDENTIAL_COLLECTION =
    "member_publication_rule_verification_credentials";
  const FIXTURE_EMAIL =
    "member-publication-rule-verification@detour.invalid";
  const FIXTURE_INVITE_ID = "mempubverify001";
  const FIXTURE_ISSUER_ID = "8zekkzyjrgmg9fx";
  const OPERATIONAL_NAME = "Detour Publication Rule Check 20260727";
  const OPERATIONAL_CITY = "Verification City";
  const OPERATIONAL_COUNTRY = "Testland";
  const NORMALIZED_NAME = "detour publication rule check 20260727";
  const NORMALIZED_CITY = "verification city";
  const NORMALIZED_COUNTRY = "testland";
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

  function normalizePlacePart(value) {
    let normalized = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
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

  function deleteRecord(record) {
    if (record) app.delete(record);
  }

  function addRecordById(target, record) {
    if (record) target[record.id] = record;
  }

  function hasExactOperationalFields(record) {
    return (
      recordString(record, "venue_name") === OPERATIONAL_NAME &&
      recordString(record, "city") === OPERATIONAL_CITY &&
      recordString(record, "country") === OPERATIONAL_COUNTRY
    );
  }

  function hasExactOperationalNormalization(record) {
    return (
      recordString(record, "normalized_name") === NORMALIZED_NAME &&
      recordString(record, "normalized_city") === NORMALIZED_CITY &&
      normalizePlacePart(recordString(record, "country")) === NORMALIZED_COUNTRY
    );
  }

  function isExactOperationalVenue(record) {
    return (
      recordString(record, "name") === OPERATIONAL_NAME &&
      recordString(record, "city") === OPERATIONAL_CITY &&
      recordString(record, "country") === OPERATIONAL_COUNTRY
    );
  }

  const members = findCollectionOrNull("members");
  const invites = findCollectionOrNull("invites");
  const credentials = findCollectionOrNull(CREDENTIAL_COLLECTION);
  const recommendations = findCollectionOrNull("community_recommendations");
  const shares = findCollectionOrNull("community_shares");
  const entries = findCollectionOrNull("community_waitlist_entries");
  const awards = findCollectionOrNull("venue_awards");
  const venues = findCollectionOrNull("venues");

  // The member trust boundary is the exact reserved email. A credential relation
  // is never sufficient on its own to select or delete an auth record.
  const fixtureMembers = {};
  for (const member of findAllByFilterGuarded(members, "email = {:email}", {
    email: FIXTURE_EMAIL,
  })) {
    if (recordString(member, "email") === FIXTURE_EMAIL) {
      fixtureMembers[member.id] = member;
    }
  }

  // Capture exact entry and publication links before deleting any relation. The
  // normalized identity lets a retry finish after the member relation has
  // already been cleared; the raw-field path is accepted only for an entry that
  // still explicitly includes the verified fixture member.
  const fixtureEntries = {};
  for (const entry of findAllByFilterGuarded(
    entries,
    "normalized_name = {:name} && normalized_city = {:city}",
    { name: NORMALIZED_NAME, city: NORMALIZED_CITY }
  )) {
    if (hasExactOperationalNormalization(entry)) addRecordById(fixtureEntries, entry);
  }
  for (const memberId of Object.keys(fixtureMembers)) {
    for (const entry of findAllByFilterGuarded(entries, "participants ?= {:member}", {
      member: memberId,
    })) {
      if (
        hasExactOperationalFields(entry) &&
        recordStringSlice(entry, "participants").indexOf(memberId) !== -1
      ) {
        addRecordById(fixtureEntries, entry);
      }
    }
  }

  // Remove only recommendation signals owned by the exact fixture member. This
  // deliberately does not select recommendations merely because they point at
  // the operational entry.
  for (const memberId of Object.keys(fixtureMembers)) {
    for (const recommendation of findAllByFilterGuarded(
      recommendations,
      "member = {:member}",
      { member: memberId }
    )) {
      if (recordString(recommendation, "member") === memberId) {
        deleteRecord(recommendation);
      }
    }
  }

  // An exact fixture entry is removable only when no other recommendation or
  // share content remains attached. Capture its publication ids, then remove
  // only the linked community-selection award and exact operational venue.
  const removableEntries = {};
  const capturedAwardIds = {};
  const capturedVenueIds = {};
  for (const entryId of Object.keys(fixtureEntries)) {
    const entry = findRecordOrNull(entries, entryId);
    if (!entry) continue;

    const remainingRecommendations = findAllByFilterGuarded(
      recommendations,
      "waitlist = {:waitlist}",
      { waitlist: entry.id }
    );
    const remainingShares = findAllByFilterGuarded(shares, "waitlist = {:waitlist}", {
      waitlist: entry.id,
    });
    if (remainingRecommendations.length || remainingShares.length) continue;

    removableEntries[entry.id] = entry;
    const awardId = recordString(entry, "published_award");
    const publishedVenueId = recordString(entry, "published_venue");
    const canonicalVenueId = recordString(entry, "canonical_venue");
    if (awardId) capturedAwardIds[awardId] = true;
    if (publishedVenueId) capturedVenueIds[publishedVenueId] = true;
    if (canonicalVenueId) capturedVenueIds[canonicalVenueId] = true;
  }

  // Exact venue lookup is also necessary for convergence when a prior attempt
  // already deleted the entry but stopped before deleting its public artifacts.
  // If an entry still exists but has unrelated dependent content, preserve all
  // of its publication artifacts rather than bypassing the dependency guard.
  const recoverOrphanedArtifacts = Object.keys(fixtureEntries).length === 0;
  if (recoverOrphanedArtifacts) {
    for (const venue of findAllByFilterGuarded(
      venues,
      "name = {:name} && city = {:city} && country = {:country}",
      { name: OPERATIONAL_NAME, city: OPERATIONAL_CITY, country: OPERATIONAL_COUNTRY }
    )) {
      if (isExactOperationalVenue(venue)) capturedVenueIds[venue.id] = true;
    }
  }

  for (const awardId of Object.keys(capturedAwardIds)) {
    const award = findRecordOrNull(awards, awardId);
    if (!award || recordString(award, "level") !== COMMUNITY_AWARD_LEVEL) continue;
    const venue = findRecordOrNull(venues, recordString(award, "venue"));
    if (!isExactOperationalVenue(venue)) continue;
    capturedVenueIds[venue.id] = true;
    deleteRecord(award);
  }

  // If the entry link disappeared in a partial cleanup, the exact operational
  // venue identity still safely scopes its community-selection award(s).
  if (recoverOrphanedArtifacts) {
    for (const venueId of Object.keys(capturedVenueIds)) {
      const venue = findRecordOrNull(venues, venueId);
      if (!isExactOperationalVenue(venue)) continue;
      for (const award of findAllByFilterGuarded(
        awards,
        "venue = {:venue} && level = {:level}",
        { venue: venue.id, level: COMMUNITY_AWARD_LEVEL }
      )) {
        if (
          recordString(award, "venue") === venue.id &&
          recordString(award, "level") === COMMUNITY_AWARD_LEVEL
        ) {
          deleteRecord(award);
        }
      }
    }
  }

  for (const venueId of Object.keys(capturedVenueIds)) {
    const venue = findRecordOrNull(venues, venueId);
    if (!isExactOperationalVenue(venue)) continue;
    const remainingAwards = findAllByFilterGuarded(awards, "venue = {:venue}", {
      venue: venue.id,
    });
    if (remainingAwards.length === 0) deleteRecord(venue);
  }

  for (const entryId of Object.keys(removableEntries)) {
    const entry = findRecordOrNull(entries, entryId);
    if (
      entry &&
      (hasExactOperationalNormalization(entry) ||
        Object.keys(fixtureMembers).some(
          (memberId) =>
            hasExactOperationalFields(entry) &&
            recordStringSlice(entry, "participants").indexOf(memberId) !== -1
        ))
    ) {
      deleteRecord(entry);
    }
  }

  // Delete only exact-email credential rows. Drop the dedicated collection only
  // when it is empty, so an unexpected unrelated row is never destroyed by the
  // cleanup itself.
  for (const credential of findAllByFilterGuarded(
    credentials,
    "email = {:email}",
    { email: FIXTURE_EMAIL }
  )) {
    if (recordString(credential, "email") === FIXTURE_EMAIL) {
      deleteRecord(credential);
    }
  }
  if (credentials && findAllGuarded(credentials).length === 0) {
    app.delete(credentials);
  }

  for (const memberId of Object.keys(fixtureMembers)) {
    const member = findRecordOrNull(members, memberId);
    if (member && recordString(member, "email") === FIXTURE_EMAIL) {
      deleteRecord(member);
    }
  }

  // The reserved invite is considered only after every member dependency is
  // gone. The exact id and original issuer are both checked; an invite claimed
  // by any still-existing member is preserved.
  const dependentMembers = findAllByFilterGuarded(
    members,
    "redeemed_invite = {:invite}",
    { invite: FIXTURE_INVITE_ID }
  );
  if (dependentMembers.length === 0) {
    const invite = findRecordOrNull(invites, FIXTURE_INVITE_ID);
    if (
      invite &&
      invite.id === FIXTURE_INVITE_ID &&
      recordString(invite, "issued_by") === FIXTURE_ISSUER_ID
    ) {
      const claimedMember = findRecordOrNull(
        members,
        recordString(invite, "claimed_by")
      );
      if (!claimedMember) deleteRecord(invite);
    }
  }
}, () => {
  // Forward-only: deleted verification fixtures and public test artifacts must
  // never be recreated by a rollback operation.
  return null;
});

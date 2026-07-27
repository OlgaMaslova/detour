/// <reference path="../pb_data/types.d.ts" />
//
// Removes only the controlled member-status copy live-verification fixture.
// Every private/public record is bounded by its fixed id plus its exact member or
// place identity. The migration is forward-only and retry-safe: missing records
// are no-ops, while any unexpected relation preserves the referenced fixture.
migrate((app) => {
  const CREDENTIAL_COLLECTION =
    "member_status_copy_verification_credentials";
  const FIXTURE_MEMBERS = [
    {
      id: "kqgv6zesgddszrp",
      email: "member-status-copy-check-a@detour.invalid",
      displayName: "Detour member status copy verification A",
      role: "member_status_copy_check_a",
    },
    {
      id: "9rvya8qxwdb09nc",
      email: "member-status-copy-check-b@detour.invalid",
      displayName: "Detour member status copy verification B",
      role: "member_status_copy_check_b",
    },
  ];
  const MEMBER_A_ID = FIXTURE_MEMBERS[0].id;
  const MEMBER_B_ID = FIXTURE_MEMBERS[1].id;

  const FIXTURE_PLACE_NAME = "Detour Status Copy Live Check 20260727";
  const FIXTURE_CITY = "Status Copy Verification City";
  const FIXTURE_COUNTRY = "Testland";
  const FIXTURE_NORMALIZED_NAME =
    "detour status copy live check 20260727";
  const FIXTURE_NORMALIZED_CITY = "status copy verification city";

  const RECOMMENDATION_ID = "dhosv1scca1t7eg";
  const ENTRY_ID = "y6fuy7wbpmjyqri";
  const VENUE_ID = "9rgqmj10ztt11oy";
  const AWARD_ID = "eo4rouhzvay8075";
  const SHARE_ID = "fczijyhw5om26gl";
  const INVITE_ID = "x6u20sxv0l3yiy2";
  const COMMUNITY_AWARD_LEVEL = "Detour community selection";
  const COMMUNITY_SOURCE_SLUG = "detour-community";

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
      throw new Error(
        "Unable to inspect " + collection.name + " record: " + error
      );
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
        throw new Error(
          "Unable to inspect " + collection.name + " records: " + error
        );
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
        app.findRecordsByFilter(
          collection.id,
          filter,
          "id",
          1,
          0,
          params || {}
        ).length > 0
      );
    } catch (error) {
      throw new Error(
        "Unable to inspect " + collection.name + " records: " + error
      );
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

  function isExactFixtureMember(record, fixture) {
    return (
      !!record &&
      recordString(record, "email") === fixture.email &&
      recordString(record, "display_name") === fixture.displayName
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
    if (!record || record.id !== ENTRY_ID) return false;
    if (
      !hasExactRawPlace(record, "venue_name") ||
      recordString(record, "normalized_name") !== FIXTURE_NORMALIZED_NAME ||
      recordString(record, "normalized_city") !== FIXTURE_NORMALIZED_CITY
    ) {
      return false;
    }

    const canonicalVenue = recordString(record, "canonical_venue");
    const publishedVenue = recordString(record, "published_venue");
    const publishedAward = recordString(record, "published_award");
    return (
      (!canonicalVenue || canonicalVenue === VENUE_ID) &&
      (!publishedVenue || publishedVenue === VENUE_ID) &&
      (!publishedAward || publishedAward === AWARD_ID)
    );
  }

  function isExactFixtureVenue(record) {
    return (
      !!record &&
      record.id === VENUE_ID &&
      hasExactRawPlace(record, "name")
    );
  }

  const members = findCollectionOrNull("members");
  let credentials = findCollectionOrNull(CREDENTIAL_COLLECTION);
  const shares = findCollectionOrNull("community_shares");
  const shareReplies = findCollectionOrNull("community_share_replies");
  const invites = findCollectionOrNull("invites");
  const recommendations = findCollectionOrNull("community_recommendations");
  const entries = findCollectionOrNull("community_waitlist_entries");
  const awards = findCollectionOrNull("venue_awards");
  const venues = findCollectionOrNull("venues");
  const sources = findCollectionOrNull("guide_sources");
  const visitEvidence = findCollectionOrNull("visit_evidence");
  const submissions = findCollectionOrNull("detour_submissions");
  const sourceRecords = findCollectionOrNull("guide_source_records");
  const sourceEntries = findCollectionOrNull("venue_source_entries");
  const endorsements = findCollectionOrNull("endorsements");
  const contributions = findCollectionOrNull("member_place_contributions");

  if (credentials && credentials.type !== "base") {
    throw new Error(
      "Refusing to clean " +
        CREDENTIAL_COLLECTION +
        ": the collection is not a base collection."
    );
  }

  // The supplied ids identify the live browser run. On a fresh database the
  // fixture-creation migration allocates different ids, so exact email plus
  // exact display name also discovers the same controlled members for immediate
  // cleanup. A conflicting record at either boundary disables that fixture.
  const exactMembers = {};
  const trustedFixtureMemberIds = {};
  const conflictedFixtures = {};
  for (const fixture of FIXTURE_MEMBERS) {
    const knownIdRecord = findRecordOrNull(members, fixture.id);
    const emailMatches = findAllByFilterGuarded(
      members,
      "email = {:email}",
      { email: fixture.email }
    );
    if (emailMatches.length > 1) {
      throw new Error(
        "Refusing to clean the member-status fixture: multiple members use " +
          fixture.email +
          "."
      );
    }

    const emailMember = emailMatches.length ? emailMatches[0] : null;
    const knownIdConflicts =
      knownIdRecord && !isExactFixtureMember(knownIdRecord, fixture);
    const emailConflicts =
      emailMember && !isExactFixtureMember(emailMember, fixture);
    const boundariesDisagree =
      knownIdRecord && emailMember && knownIdRecord.id !== emailMember.id;
    if (knownIdConflicts || emailConflicts || boundariesDisagree) {
      conflictedFixtures[fixture.email] = true;
      continue;
    }

    if (emailMember) {
      exactMembers[fixture.email] = emailMember;
      trustedFixtureMemberIds[emailMember.id] = true;
    }
    // A missing supplied id is trusted for retry recovery of the known live
    // records. If it exists, it was proven to be the exact email/name member.
    trustedFixtureMemberIds[fixture.id] = true;
  }

  // Delete only the one known direct share from exact A to exact B for the exact
  // test venue. If an unrelated member replied to it, preserve the share rather
  // than allowing PocketBase's share-reply cascade to remove that reply.
  const share = findRecordOrNull(shares, SHARE_ID);
  if (
    share &&
    trustedFixtureMemberIds[MEMBER_A_ID] &&
    trustedFixtureMemberIds[MEMBER_B_ID] &&
    recordString(share, "sender") === MEMBER_A_ID &&
    recordString(share, "recipient") === MEMBER_B_ID &&
    recordString(share, "venue") === VENUE_ID &&
    (!recordString(share, "waitlist") ||
      recordString(share, "waitlist") === ENTRY_ID) &&
    hasExactRawPlace(share, "venue_name")
  ) {
    const replies = findAllByFilterGuarded(
      shareReplies,
      "share = {:share}",
      { share: SHARE_ID }
    );
    const hasUnrelatedReply = replies.some(
      (reply) => !trustedFixtureMemberIds[recordString(reply, "author")]
    );
    if (!hasUnrelatedReply) deleteRecord(share);
  }

  // The verification invite is safe only by fixed id, exact fixture issuer, and
  // an empty/exact-B claimant. A redeemed-invite relation on any member keeps it.
  const invite = findRecordOrNull(invites, INVITE_ID);
  if (
    invite &&
    trustedFixtureMemberIds[MEMBER_A_ID] &&
    recordString(invite, "issued_by") === MEMBER_A_ID &&
    (!recordString(invite, "claimed_by") ||
      (trustedFixtureMemberIds[MEMBER_B_ID] &&
        recordString(invite, "claimed_by") === MEMBER_B_ID)) &&
    !hasAnyByFilterGuarded(
      members,
      "redeemed_invite = {:invite}",
      { invite: INVITE_ID }
    )
  ) {
    deleteRecord(invite);
  }

  // Remove recommendation signals only when all independent boundaries agree:
  // exact fixture member id, exact entry id, and exact raw test-place identity.
  // The known live id is accepted, as are retry-created duplicates from A or B
  // that meet the same complete controlled identity.
  for (const recommendation of findAllByFilterGuarded(
    recommendations,
    "waitlist = {:waitlist}",
    { waitlist: ENTRY_ID }
  )) {
    const memberId = recordString(recommendation, "member");
    if (
      trustedFixtureMemberIds[memberId] &&
      recordString(recommendation, "waitlist") === ENTRY_ID &&
      hasExactRawPlace(recommendation, "venue_name") &&
      (recommendation.id === RECOMMENDATION_ID ||
        memberId === MEMBER_A_ID ||
        memberId === MEMBER_B_ID)
    ) {
      deleteRecord(recommendation);
    }
  }

  // Delete the exact entry only after all recommendation/share references are
  // gone. An unexpected participant also preserves the entry and all public
  // artifacts linked from it.
  let fixtureEntry = findRecordOrNull(entries, ENTRY_ID);
  let entryRemovedOrAbsent = !fixtureEntry;
  if (fixtureEntry && isExactFixtureEntry(fixtureEntry)) {
    const participants = recordStringSlice(fixtureEntry, "participants");
    const hasUnrelatedParticipant = participants.some(
      (memberId) => !trustedFixtureMemberIds[memberId]
    );
    const hasRemainingRecommendation = hasAnyByFilterGuarded(
      recommendations,
      "waitlist = {:waitlist}",
      { waitlist: ENTRY_ID }
    );
    const hasRemainingShare = hasAnyByFilterGuarded(
      shares,
      "waitlist = {:waitlist}",
      { waitlist: ENTRY_ID }
    );

    if (
      !hasUnrelatedParticipant &&
      !hasRemainingRecommendation &&
      !hasRemainingShare
    ) {
      deleteRecord(fixtureEntry);
      fixtureEntry = null;
      entryRemovedOrAbsent = true;
    }
  }

  function awardHasUnrelatedReference(awardId) {
    return (
      hasAnyByFilterGuarded(entries, "published_award = {:award}", {
        award: awardId,
      }) ||
      hasAnyByFilterGuarded(submissions, "published_award = {:award}", {
        award: awardId,
      })
    );
  }

  // Public artifacts are considered only after the exact entry is gone. The
  // award additionally requires the exact venue and shared community source;
  // any other publication reference preserves it.
  if (entryRemovedOrAbsent) {
    const award = findRecordOrNull(awards, AWARD_ID);
    const venue = findRecordOrNull(venues, VENUE_ID);
    const source = award
      ? findRecordOrNull(sources, recordString(award, "source"))
      : null;
    if (
      award &&
      isExactFixtureVenue(venue) &&
      recordString(award, "venue") === VENUE_ID &&
      recordString(award, "level") === COMMUNITY_AWARD_LEVEL &&
      source &&
      recordString(source, "slug") === COMMUNITY_SOURCE_SLUG &&
      !awardHasUnrelatedReference(AWARD_ID)
    ) {
      deleteRecord(award);
    }
  }

  function venueHasUnrelatedReference(venueId) {
    return (
      hasAnyByFilterGuarded(awards, "venue = {:venue}", { venue: venueId }) ||
      hasAnyByFilterGuarded(shares, "venue = {:venue}", { venue: venueId }) ||
      hasAnyByFilterGuarded(visitEvidence, "venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(submissions, "venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(submissions, "published_venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(sourceRecords, "venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(sourceEntries, "venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(entries, "canonical_venue = {:venue}", {
        venue: venueId,
      }) ||
      hasAnyByFilterGuarded(entries, "published_venue = {:venue}", {
        venue: venueId,
      })
    );
  }

  if (entryRemovedOrAbsent) {
    const venue = findRecordOrNull(venues, VENUE_ID);
    if (
      isExactFixtureVenue(venue) &&
      !venueHasUnrelatedReference(VENUE_ID)
    ) {
      deleteRecord(venue);
    }
  }

  function memberHasRemainingRelationship(memberId) {
    return (
      hasAnyByFilterGuarded(recommendations, "member = {:member}", {
        member: memberId,
      }) ||
      hasAnyByFilterGuarded(shares, "sender = {:member}", {
        member: memberId,
      }) ||
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
      })
    );
  }

  function exactCredentialRowsOrNull(fixture, memberIds) {
    const rows = {};
    for (const memberId of memberIds) {
      for (const credential of findAllByFilterGuarded(
        credentials,
        "member = {:member}",
        { member: memberId }
      )) {
        rows[credential.id] = credential;
      }
    }
    for (const credential of findAllByFilterGuarded(
      credentials,
      "email = {:email}",
      { email: fixture.email }
    )) {
      rows[credential.id] = credential;
    }

    for (const credentialId of Object.keys(rows)) {
      const credential = rows[credentialId];
      if (
        memberIds.indexOf(recordString(credential, "member")) === -1 ||
        recordString(credential, "email") !== fixture.email ||
        recordString(credential, "role") !== fixture.role
      ) {
        return null;
      }
    }
    return Object.keys(rows).map((id) => rows[id]);
  }

  // Credential rows must be removed immediately before their exact auth member
  // because their required non-cascading relation otherwise blocks member
  // deletion. Unexpected credential rows or any unrelated member relation keep
  // the fixture member intact.
  for (const fixture of FIXTURE_MEMBERS) {
    if (conflictedFixtures[fixture.email]) continue;
    const member = exactMembers[fixture.email] || null;
    if (!isExactFixtureMember(member, fixture)) continue;
    if (
      recordString(member, "invited_by") ||
      recordString(member, "redeemed_invite") ||
      recordString(member, "invite_code") ||
      memberHasRemainingRelationship(member.id)
    ) {
      continue;
    }

    const credentialMemberIds =
      member.id === fixture.id ? [member.id] : [member.id, fixture.id];
    const credentialRows = exactCredentialRowsOrNull(
      fixture,
      credentialMemberIds
    );
    if (!credentialRows) continue;
    for (const credential of credentialRows) deleteRecord(credential);

    if (
      !hasAnyByFilterGuarded(credentials, "member = {:member}", {
        member: member.id,
      }) &&
      !memberHasRemainingRelationship(member.id)
    ) {
      deleteRecord(member);
    }
  }

  // A retry may find that an exact member was deleted after its credential rows
  // were selected but before they were removed. Clean only rows that still match
  // the complete reserved member/email/role tuple, then drop the dedicated
  // collection only when no unexpected row remains.
  for (const fixture of FIXTURE_MEMBERS) {
    if (conflictedFixtures[fixture.email]) continue;
    const member = exactMembers[fixture.email] || null;
    const credentialMemberIds = member && member.id !== fixture.id
      ? [member.id, fixture.id]
      : [fixture.id];
    const credentialRows = exactCredentialRowsOrNull(
      fixture,
      credentialMemberIds
    );
    if (!credentialRows) continue;
    for (const credential of credentialRows) deleteRecord(credential);
  }
  if (credentials && findAllGuarded(credentials).length === 0) {
    app.delete(credentials);
    credentials = null;
  }
}, () => {
  // Forward-only: removed verification fixtures and public test artifacts must
  // never be recreated by a rollback operation.
  return null;
});

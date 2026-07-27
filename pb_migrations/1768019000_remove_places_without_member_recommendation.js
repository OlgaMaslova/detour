/// <reference path="../pb_data/types.d.ts" />
//
// Restricts the public Madrid, Paris, and San Francisco catalogues to places
// members directly recommended. Venues whose only recognition comes from
// external guides — Michelin, Guía Repsol, 50 Top Pizza, the World's 100 Best
// Coffee Shops, and the retired editorial-local-pick rows that were folded
// into the Detourist List with their editorial sources intact — are removed
// together with their awards (relation cascade) and their raw per-source
// assertion rows. A venue stays when:
//   - it carries any award from the `detour-community` guide source (the
//     Detourist List lane every member publication writes to), or
//   - member activity still points at it (a direct share, visit evidence, a
//     detour submission, or a waiting-list entry's canonical/published link),
//     so member records are never cascade-deleted or orphaned by this sweep.
//
// Forward-only and convergent: venues are rediscovered by market/city and
// recognition on every pass, deletions are idempotent, and a per-venue
// failure is logged and skipped so a single bad row cannot block boot. When
// the community source does not exist the sweep deletes nothing (fail safe):
// on such a backend member recommendations cannot be told apart from
// editorial rows.
migrate((app) => {
  const MARKET_KEYS = ["madrid", "paris", "san francisco"];
  const COMMUNITY_SOURCE_SLUG = "detour-community";

  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
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

  // True when `collection` has `field` and at least one record references the
  // venue through it. A missing collection or field means no reference can
  // exist; a failing lookup counts as a reference so the venue is preserved
  // rather than risk deleting member data.
  function venueReferencedThrough(collection, field, venueId) {
    if (!collection || !collection.fields.getByName(field)) return false;
    try {
      return (
        app.findRecordsByFilter(
          collection.id,
          field + " = {:venue}",
          "id",
          1,
          0,
          { venue: venueId }
        ).length > 0
      );
    } catch {
      return true;
    }
  }

  const venues = findCollectionOrNull("venues");
  const awards = findCollectionOrNull("venue_awards");
  const sources = findCollectionOrNull("guide_sources");
  if (!venues || !awards || !sources) {
    console.log(
      "member-recommendation catalogue sweep: catalogue collections missing; nothing to do"
    );
    return;
  }

  const sourceEntries = findCollectionOrNull("venue_source_entries");
  const shares = findCollectionOrNull("community_shares");
  const visitEvidence = findCollectionOrNull("visit_evidence");
  const submissions = findCollectionOrNull("detour_submissions");
  const waitlistEntries = findCollectionOrNull("community_waitlist_entries");

  const communitySourceIds = {};
  for (const source of findAllByFilterGuarded(sources, "slug = {:slug}", {
    slug: COMMUNITY_SOURCE_SLUG,
  })) {
    communitySourceIds[source.id] = true;
  }
  if (Object.keys(communitySourceIds).length === 0) {
    console.log(
      "member-recommendation catalogue sweep: no '" +
        COMMUNITY_SOURCE_SLUG +
        "' source; aborting without deleting anything"
    );
    return;
  }

  function isMemberRecommended(venueId) {
    for (const award of findAllByFilterGuarded(awards, "venue = {:venue}", {
      venue: venueId,
    })) {
      if (communitySourceIds[award.getString("source")]) return true;
    }
    return false;
  }

  function hasMemberActivity(venueId) {
    return (
      venueReferencedThrough(shares, "venue", venueId) ||
      venueReferencedThrough(visitEvidence, "venue", venueId) ||
      venueReferencedThrough(submissions, "venue", venueId) ||
      venueReferencedThrough(submissions, "published_venue", venueId) ||
      venueReferencedThrough(waitlistEntries, "canonical_venue", venueId) ||
      venueReferencedThrough(waitlistEntries, "published_venue", venueId)
    );
  }

  let removed = 0;
  let keptRecommended = 0;
  let keptMemberActivity = 0;
  for (const venue of findAllByFilterGuarded(venues, "id != ''", {})) {
    // A venue's explicit market owns its route; older records route by their
    // physical city — mirror the frontend's routing rule for scope.
    const scopeKey = (venue.getString("market") || venue.getString("city"))
      .trim()
      .toLowerCase();
    if (MARKET_KEYS.indexOf(scopeKey) === -1) continue;

    try {
      if (isMemberRecommended(venue.id)) {
        keptRecommended++;
        continue;
      }
      if (hasMemberActivity(venue.id)) {
        // Not on the Detourist List, but a member personally pointed at this
        // place; deleting it would cascade into or orphan their records.
        keptMemberActivity++;
        console.log(
          "member-recommendation catalogue sweep: keeping " +
            venue.getString("name") +
            " (" +
            venue.getString("city") +
            "): member activity references it"
        );
        continue;
      }

      // Raw per-source assertions hold a required, non-cascading venue
      // relation; remove them first so the venue delete cannot be blocked.
      for (const entry of findAllByFilterGuarded(
        sourceEntries,
        "venue = {:venue}",
        { venue: venue.id }
      )) {
        app.delete(entry);
      }

      // Deleting the venue cascades its venue_awards rows.
      app.delete(venue);
      removed++;
    } catch (error) {
      console.log(
        "member-recommendation catalogue sweep: venue " +
          venue.id +
          " (" +
          venue.getString("name") +
          ") not removed: " +
          error
      );
    }
  }

  console.log(
    "member-recommendation catalogue sweep: removed " +
      removed +
      " editorial-only venues; kept " +
      keptRecommended +
      " member-recommended and " +
      keptMemberActivity +
      " with member activity"
  );
}, () => {
  // Forward-only: the removed editorial catalogue is public, externally
  // visible state and must not be recreated by a migration-history rollback.
  return null;
});

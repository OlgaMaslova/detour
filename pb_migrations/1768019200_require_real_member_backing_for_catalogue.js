/// <reference path="../pb_data/types.d.ts" />
//
// Completes the member-recommendation restriction: only records from real
// members count. Synthetic fixture accounts (reserved `.invalid` emails) left
// two kinds of ghosts in the public catalogue:
//   - venues kept by the 1768019000 sweep because fixture visit evidence or
//     submissions referenced them (e.g. Ramón Freixa Atelier, Bascoat,
//     Smoked Room), and
//   - a `detour-community` award published through the synthetic E2E
//     workflow proof (Baldoria), which made the venue read as
//     member-recommended.
// This sweep re-applies the 1768019000 rules while ignoring all records from
// `.invalid` members: a venue stays only with a community award backed by a
// real member or with real-member activity; a community award without a real
// member behind it is deleted; and the synthetic records propping up a
// removed venue are deleted with it.
//
// Forward-only, idempotent, and fail-safe like the previous sweep: missing
// collections mean nothing to do, the sweep aborts without deleting when the
// community source is absent, and a per-venue failure is logged and skipped.
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

  const members = findCollectionOrNull("members");
  const venues = findCollectionOrNull("venues");
  const awards = findCollectionOrNull("venue_awards");
  const sources = findCollectionOrNull("guide_sources");
  if (!members || !venues || !awards || !sources) {
    console.log("real-member backing sweep: collections missing; nothing to do");
    return;
  }

  const sourceEntries = findCollectionOrNull("venue_source_entries");
  const shares = findCollectionOrNull("community_shares");
  const visitEvidence = findCollectionOrNull("visit_evidence");
  const submissions = findCollectionOrNull("detour_submissions");
  const waitlistEntries = findCollectionOrNull("community_waitlist_entries");
  const recommendations = findCollectionOrNull("community_recommendations");

  const communitySourceIds = {};
  for (const source of findAllByFilterGuarded(sources, "slug = {:slug}", {
    slug: COMMUNITY_SOURCE_SLUG,
  })) {
    communitySourceIds[source.id] = true;
  }
  if (Object.keys(communitySourceIds).length === 0) {
    console.log(
      "real-member backing sweep: no '" +
        COMMUNITY_SOURCE_SLUG +
        "' source; aborting without deleting anything"
    );
    return;
  }

  // Members behind synthetic fixture records. When this lookup fails nothing
  // can be told apart, so the sweep deletes nothing (fail safe).
  const synthetic = {};
  try {
    for (const member of findAllByFilterGuarded(members, "email ~ '%.invalid'", {})) {
      synthetic[member.id] = true;
    }
  } catch (error) {
    console.log("real-member backing sweep: unable to inspect members; aborting: " + error);
    return;
  }

  function isRealMember(id) {
    return id !== "" && !synthetic[id];
  }

  // Records referencing a venue, split by whether a real member stands behind
  // them. Real visit evidence keeps a venue alive but is private proof, not a
  // recommendation — it cannot justify a public community award on its own.
  // The waitlist chain counts an entry as real when any participant, or any
  // recommendation or share attached to it, comes from a real member.
  function collectVenueRecords(venueId) {
    const real = [];
    const syntheticRecords = [];
    let realRecommendation = false;
    function classify(record, memberId, isRecommendationGrade) {
      if (isRealMember(memberId)) {
        real.push(record);
        if (isRecommendationGrade) realRecommendation = true;
      } else {
        syntheticRecords.push(record);
      }
    }

    for (const record of findAllByFilterGuarded(visitEvidence, "venue = {:venue}", {
      venue: venueId,
    })) {
      classify(record, record.getString("member"), false);
    }
    for (const record of findAllByFilterGuarded(shares, "venue = {:venue}", {
      venue: venueId,
    })) {
      classify(record, record.getString("sender"), true);
    }
    const submissionSeen = {};
    for (const filter of ["venue = {:venue}", "published_venue = {:venue}"]) {
      for (const record of findAllByFilterGuarded(submissions, filter, {
        venue: venueId,
      })) {
        if (submissionSeen[record.id]) continue;
        submissionSeen[record.id] = true;
        classify(record, record.getString("member"), true);
      }
    }

    const entrySeen = {};
    for (const filter of [
      "canonical_venue = {:venue}",
      "published_venue = {:venue}",
    ]) {
      for (const entry of findAllByFilterGuarded(waitlistEntries, filter, {
        venue: venueId,
      })) {
        if (entrySeen[entry.id]) continue;
        entrySeen[entry.id] = true;
        let entryIsReal = false;
        for (const participant of entry.getStringSlice("participants")) {
          if (isRealMember(participant)) entryIsReal = true;
        }
        const attached = [];
        for (const rec of findAllByFilterGuarded(recommendations, "waitlist = {:entry}", {
          entry: entry.id,
        })) {
          attached.push(rec);
          if (isRealMember(rec.getString("member"))) entryIsReal = true;
        }
        for (const share of findAllByFilterGuarded(shares, "waitlist = {:entry}", {
          entry: entry.id,
        })) {
          attached.push(share);
          if (isRealMember(share.getString("sender"))) entryIsReal = true;
        }
        if (entryIsReal) {
          real.push(entry);
          realRecommendation = true;
        } else {
          // The whole synthetic chain goes together: signals first, then the
          // entry they point at.
          for (const record of attached) syntheticRecords.push(record);
          syntheticRecords.push(entry);
        }
      }
    }
    return {
      real: real,
      syntheticRecords: syntheticRecords,
      realRecommendation: realRecommendation,
    };
  }

  function communityAwardsOf(venueId) {
    const result = [];
    for (const award of findAllByFilterGuarded(awards, "venue = {:venue}", {
      venue: venueId,
    })) {
      if (communitySourceIds[award.getString("source")]) result.push(award);
    }
    return result;
  }

  let removedVenues = 0;
  let removedAwards = 0;
  let kept = 0;
  for (const venue of findAllByFilterGuarded(venues, "id != ''", {})) {
    const scopeKey = (venue.getString("market") || venue.getString("city"))
      .trim()
      .toLowerCase();
    if (MARKET_KEYS.indexOf(scopeKey) === -1) continue;

    try {
      const references = collectVenueRecords(venue.id);
      const hasRealBacking = references.real.length > 0;
      const communityAwards = communityAwardsOf(venue.id);

      if (hasRealBacking) {
        // The venue stays, but a community award still needs a real
        // recommendation behind it — private visit evidence alone cannot
        // justify a public selection.
        if (communityAwards.length > 0 && !references.realRecommendation) {
          for (const award of communityAwards) {
            app.delete(award);
            removedAwards++;
          }
          console.log(
            "real-member backing sweep: kept " +
              venue.getString("name") +
              " (" +
              venue.getString("city") +
              ") but removed its community selection: no real recommendation behind it"
          );
        }
        kept++;
        continue;
      }

      if (communityAwards.length > 0) {
        console.log(
          "real-member backing sweep: removing " +
            venue.getString("name") +
            " (" +
            venue.getString("city") +
            "): its community selection has no real member behind it"
        );
      } else {
        console.log(
          "real-member backing sweep: removing " +
            venue.getString("name") +
            " (" +
            venue.getString("city") +
            "): only synthetic records reference it"
        );
      }

      // Synthetic references and raw per-source assertions hold required,
      // non-cascading venue relations; remove them first so the venue delete
      // cannot be blocked. Awards cascade with the venue.
      for (const record of references.syntheticRecords) {
        app.delete(record);
      }
      for (const entry of findAllByFilterGuarded(sourceEntries, "venue = {:venue}", {
        venue: venue.id,
      })) {
        app.delete(entry);
      }
      removedAwards += communityAwards.length;
      app.delete(venue);
      removedVenues++;
    } catch (error) {
      console.log(
        "real-member backing sweep: venue " +
          venue.id +
          " (" +
          venue.getString("name") +
          ") not removed: " +
          error
      );
    }
  }

  console.log(
    "real-member backing sweep: removed " +
      removedVenues +
      " venues (" +
      removedAwards +
      " synthetic community awards) and kept " +
      kept +
      " with real member backing"
  );
}, () => {
  // Forward-only: removed synthetic-backed catalogue entries are public,
  // externally visible state and must not be recreated by a rollback.
  return null;
});

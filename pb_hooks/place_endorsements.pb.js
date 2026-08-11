/// <reference path="../pb_data/types.d.ts" />
//
// Been & loved: the write path and the notice.
//
// One route, one sweep. Everything either of them does lives in
// pb_hooks/place_endorsements.js — this file is the registration, because only
// `*.pb.js` files register anything and hook callbacks run in isolated VMs, so
// each one requires the module inside its own body.

/**
 * Mark a place, or withdraw the mark. One button, pressed twice.
 *
 * `{place}` is a venue id — what a card, the map preview and the place page all
 * carry — or the waiting-list entry id, which is what the row actually hangs
 * off. Both resolve; see resolvePlaceEntry.
 *
 * Refusals, all of them 400 with a sentence the client can show as-is:
 *
 *   not a verified member    the same gate as recommending
 *   no such place            an id that resolves to nothing
 *   not published            corroborating something nobody can see
 *   not on the caller's list nobody they can see stands behind it
 *   their own place          their note already is the endorsement
 *
 * Returns the caller's new state and the place's global count, so the surface
 * that pressed can settle without another round trip.
 */
routerAdd(
  "POST",
  "/api/detour/places/{place}/endorsement",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const endorsements = require(__hooks + "/place_endorsements.js");
    community.requireVerifiedMember(e.auth, "marking a place you have been to");

    const reference = e.request.pathValue("place");
    const entry = endorsements.resolvePlaceEntry(e.app, reference);
    if (!entry) {
      throw new BadRequestError("That place is not on Detour.");
    }
    if (
      entry.getString("status") !== "published" ||
      !entry.getString("published_venue")
    ) {
      throw new BadRequestError("That place is not live yet.");
    }

    const venueId = entry.getString("published_venue");
    const existing = endorsements.findEndorsement(e.app, e.auth.id, entry.id);

    // Withdrawal first, and deliberately before the eligibility checks below: a
    // member who has already marked a place must always be able to take it back,
    // even if the place has since drifted out of what they can see.
    if (existing) {
      e.app.delete(existing);
      return e.json(200, {
        place: venueId,
        endorsed: false,
        total: endorsements.endorsementTotal(e.app, entry.id),
      });
    }

    // Never on your own place: a member who has written about it has already
    // said more, in their own words, and one person must never appear twice on
    // the same place — once under BEEN & LOVED and once under RECOMMEND.
    if (community.findMemberRecommendation(e.app, e.auth.id, entry.id)) {
      throw new BadRequestError(
        "Your own recommendation already stands for this place."
      );
    }

    // The note they went on. Its absence is also the visibility check: this is
    // the newest note on the place from a member the caller may see, and a place
    // with none of those is not on the caller's list at all.
    const recommendation = endorsements.frontingRecommendationId(
      e.app,
      entry.id,
      e.auth.id
    );
    if (!recommendation) {
      throw new BadRequestError("That place is not on your list.");
    }

    const collection = e.app.findCollectionByNameOrId(
      "community_place_endorsements"
    );
    const record = new Record(collection);
    record.set("member", e.auth.id);
    record.set("entry", entry.id);
    record.set("recommendation", recommendation);
    try {
      e.app.save(record);
    } catch (error) {
      // The unique index is the concurrency guard: a racing double-tap loses
      // here rather than writing a second row. The lookup above already turned
      // an ordinary double-tap into the withdrawal branch, so reaching this is a
      // genuine race, and the member's intent — the mark stands — is satisfied.
      if (!endorsements.findEndorsement(e.app, e.auth.id, entry.id)) throw error;
    }

    // A Wanna go save on this place is deliberately NOT deleted here. One state
    // per place is a display rule, not a storage rule: the save stops showing on
    // the Wanna go tab because the member has reached a higher rung, and comes
    // back if they withdraw this mark. Deleting it would make a mis-tap
    // destructive — the intention was never anybody's to discharge but theirs.
    // See ownSaves in pb_hooks/place_saves.js.

    return e.json(200, {
      place: venueId,
      endorsed: true,
      total: endorsements.endorsementTotal(e.app, entry.id),
    });
  },
  $apis.requireAuth("members")
);

// The point of the whole feature: the member whose note was acted on hears about
// it. Every quarter hour, one email per recipient covering everything claimed in
// that pass — a place that collects four marks in an hour must not produce four
// emails. Rows are claimed before the send, so a delivery failure is a lost
// email rather than a repeated one.
cronAdd("detour_endorsement_notices", "*/15 * * * *", () => {
  const endorsements = require(__hooks + "/place_endorsements.js");
  try {
    endorsements.deliverEndorsementNotices($app);
  } catch (error) {
    try {
      $app.logger().error(
        "Detour been-and-loved notice sweep failed.",
        "error",
        String(error)
      );
    } catch {
      // A failed sweep is retried on the next tick; logging must not throw.
    }
  }
});

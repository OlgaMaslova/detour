/// <reference path="../pb_data/types.d.ts" />
//
// Wanna go: the write path and the member's own list.
//
// Two routes and no third. Everything they do lives in
// pb_hooks/place_saves.js — this file is the registration, because only `*.pb.js`
// files register anything and hook callbacks run in isolated VMs, so each one
// requires the module inside its own body.
//
// THERE IS NO READ PATH FOR ANYBODY ELSE'S SAVES, and none should be added. Not a
// count, not a projection, not an admin surface a member could see. The test to
// apply to any route proposed for this collection: could a member learn anything
// at all about another member's saves, including that they exist?

/**
 * Save a place, or drop it. One quiet action, pressed twice.
 *
 * `{place}` is a venue id — what a card, the map preview and the place page all
 * carry — or the waiting-list entry id the row actually hangs off. Both resolve,
 * the same way the endorsement route does: a save offered on a card must be
 * callable with what that card has.
 *
 * Refusals, all of them 400 with a sentence the client can show as-is:
 *
 *   not a verified member    the same gate as the rest
 *   no such place            an id that resolves to nothing
 *   not published            a member cannot save what they cannot see
 *   their own place          you do not intend to visit a place you wrote about
 *   already been             the ladder only runs forward
 *
 * No confirmation, at either end. It is private and reversible, and a
 * confirmation dialogue on a bookmark is an insult. And no count in the answer:
 * there is nothing to count.
 */
routerAdd(
  "POST",
  "/api/detour/places/{place}/save",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const endorsements = require(__hooks + "/place_endorsements.js");
    const saves = require(__hooks + "/place_saves.js");
    community.requireVerifiedMember(e.auth, "saving a place you want to go to");

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
    const existing = saves.findSave(e.app, e.auth.id, entry.id);

    // Removal first, and before the eligibility checks below: a member must
    // always be able to take a place off their own list, whatever has happened
    // to it since. Removal is removal, not a transition backwards.
    if (existing) {
      e.app.delete(existing);
      return e.json(200, { place: venueId, saved: false });
    }

    // The ladder only runs forward. Saving somewhere you have already been, or
    // already written about, is meaningless — and would put a member in two
    // states on one place, which is the thing one-state-per-place exists to stop.
    if (community.findMemberRecommendation(e.app, e.auth.id, entry.id)) {
      throw new BadRequestError(
        "Your own recommendation already stands for this place."
      );
    }
    if (endorsements.findEndorsement(e.app, e.auth.id, entry.id)) {
      throw new BadRequestError("You have already been to this one.");
    }

    // Where the intention came from. Operationally useful — it tells us which
    // surface actually produces intent, and it is what the follow-up will word
    // itself from when that is built — and it is also data about a member's
    // behaviour, so it stays private with everything else here and must not grow
    // into a profile.
    const body = e.requestInfo().body || {};
    const sources = ["place_page", "triage", "share", "feed"];
    const source = sources.indexOf(String(body.source || "")) === -1
      ? "place_page"
      : String(body.source);

    const collection = e.app.findCollectionByNameOrId("community_place_saves");
    const record = new Record(collection);
    record.set("member", e.auth.id);
    record.set("entry", entry.id);
    record.set("source", source);
    try {
      e.app.save(record);
    } catch (error) {
      // The unique index is the concurrency guard: a racing double tap loses here
      // rather than writing a second row. The lookup above already turned an
      // ordinary double tap into the removal branch, so reaching this is a
      // genuine race, and the member's intent — the place is on the list — is
      // satisfied either way.
      if (!saves.findSave(e.app, e.auth.id, entry.id)) throw error;
    }

    return e.json(200, { place: venueId, saved: true });
  },
  $apis.requireAuth("members")
);

/**
 * The caller's own list, newest first. Their own rows and nobody else's — this is
 * the only read this feature has, and the only one it may ever have.
 */
routerAdd(
  "GET",
  "/api/detour/places/saved",
  (e) => {
    const saves = require(__hooks + "/place_saves.js");
    return e.json(200, { items: saves.ownSaves(e.app, e.auth.id) });
  },
  $apis.requireAuth("members")
);

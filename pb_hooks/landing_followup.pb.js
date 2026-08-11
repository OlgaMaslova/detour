/// <reference path="../pb_data/types.d.ts" />
//
// The follow-up's own route: "not yet".
//
// One route, and only one, because the other two answers already have theirs.
// *Been & loved it* is the endorsement route — with its own rules and its own
// email to the member whose note was acted on — and *I'd recommend it myself* is
// the ordinary recommendation form. The card is a surface onto those, never a
// shortcut around them. Nothing needs recording when a member takes one of them
// either: reaching a higher rung takes the place out of the follow-up's own query.
//
// The card itself rides along on /api/detour/community/me, like the triage card
// and for the same reason: the landing already makes that call, and a second round
// trip to decide what sits at the top of the page would show the member an empty
// slot and then fill it.
//
// Everything this route does lives in pb_hooks/landing_followup.js — this file is
// the registration, because only `*.pb.js` files register anything and hook
// callbacks run in isolated VMs, so each one requires the module inside its body.

/**
 * Not yet. The place is still ahead of them, so it rests a month, and a second
 * "not yet" retires the question about it for good.
 *
 * `{place}` is a venue id — what the card carries — or the waiting-list entry id
 * the save row hangs off. Both resolve, the same way the save and endorsement
 * routes do.
 *
 * IT REFUSES ALMOST NOTHING, and that is deliberate. A member declining a
 * question we chose to ask them has done nothing wrong, so an unresolvable place
 * or a save that is no longer there answers `{ recorded: false }` rather than
 * throwing a sentence at somebody for tapping the button we put in front of them.
 * The only refusal is the membership gate every other route here carries.
 */
routerAdd(
  "POST",
  "/api/detour/landing/follow-up/{place}/not-yet",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const endorsements = require(__hooks + "/place_endorsements.js");
    const followUp = require(__hooks + "/landing_followup.js");
    community.requireVerifiedMember(e.auth, "answering a question about your list");

    const entry = endorsements.resolvePlaceEntry(
      e.app,
      e.request.pathValue("place")
    );
    if (!entry) return e.json(200, { recorded: false });

    return e.json(200, {
      recorded: followUp.declineFollowUp(e.app, e.auth.id, entry.id),
    });
  },
  $apis.requireAuth("members")
);

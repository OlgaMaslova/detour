/// <reference path="../pb_data/types.d.ts" />
//
// The triage card's own route: the next card, once the member has answered the
// one they were handed.
//
// The first card of a visit rides along on /api/detour/community/me, because the
// landing already makes that call and a second round trip to decide what sits at
// the top of the page would show the member an empty slot and then fill it. This
// route is for every card after that.
//
// THE CAP IS THREE PER SESSION, and it is not enforced here. It is a property of
// one member sitting in front of one screen, which is the client's fact to hold;
// the route answers "what next" and the landing stops asking. The cap is the real
// risk in the mechanic — Been & loved is public and it emails somebody, so a
// member triaging twenty places in ninety seconds produces noise indistinguishable
// from signal on the one surface where trust is the whole product — and the
// reason it is safe to leave client-side is that the expensive answers are not:
// each one goes through its own route, with its own rules, one place at a time.

/**
 * The next place to ask about, or `{ card: null }` when there is nothing left.
 *
 * `?skip=` is a comma-separated list of venue ids the member has passed on during
 * this visit. "Don't know it" records nothing about them — that is the point of
 * it being the honest answer rather than a failure — so the client naming what it
 * has already shown is the only thing that stops a card coming straight back.
 */
routerAdd(
  "GET",
  "/api/detour/landing/triage",
  (e) => {
    const triage = require(__hooks + "/landing_triage.js");
    const raw = e.request.url.query().get("skip") || "";
    // Bounded on the way in: the list is a client's assertion, and the cap means
    // an honest one is never longer than a handful.
    const skip = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value)
      .slice(0, 20);
    return e.json(200, { card: triage.nextTriageCard(e.app, e.auth.id, skip) });
  },
  $apis.requireAuth("members")
);

/// <reference path="../pb_data/types.d.ts" />
//
// *Been yet?* — the follow-up on a place a member said they wanted to go to.
//
// The third entry in the landing's answer slot (docs/landing-spec.md), and the
// reason Wanna go earns a place in the ladder at all (docs/wanna-go-spec.md).
// Saving does nothing for anybody else on its own; what it buys is the right to
// ask one question later, at the point where the member finally has something to
// say. That is the only moment worth asking them.
//
// THE QUESTION IS ABOUT A PLACE THEY CHOSE. Unlike the triage card next door,
// which asks about somebody else's place, this asks about one the member put on
// their own list — so it can never read as social pressure, and it never has to
// justify why this place and not another. They said they wanted to go. That is the
// whole warrant.
//
// WHAT THE GATES ARE FOR, all four:
//
//   three weeks   sooner reads as surveillance. A place saved on Tuesday and
//                 asked about on Thursday tells the member their bookmarks are
//                 being watched.
//   a city they
//   are in        asking a Berliner whether they made it to Barcelona yet is a
//                 question about their holiday plans, which is not Detour's
//                 business.
//   a visible
//   note          NOT OPTIONAL, for the same reason the triage card carries it:
//                 the endorsement route refuses a mark where the caller cannot
//                 see a note, so a card chosen without this clause would offer a
//                 Been & loved it button that 400s on tap.
//   silence       shown and ignored, it rests a week; declined, a month; declined
//                 twice, never again. A question a member has put off twice is not
//                 a question they are going to answer.
//
// This is a module, not a hook file: nothing here registers anything (the route
// lives in landing_followup.pb.js). PocketBase runs every hook callback in its own
// VM, so every function here must be reached through a `require()` made INSIDE
// the callback that uses it.

const DAY_MS = 86400000;

// No earlier than three weeks after saving. See the header.
const MIN_AGE_DAYS = 21;
// Shown and left alone: the card is stamped when it is put in front of somebody,
// answered or not, which is what stops it reappearing on the next page load. A
// week later it is worth one more ask.
const REST_DAYS = 7;
// "Not yet" is an answer, and it buys a month. The member has told us the place is
// still ahead of them; asking again next week says we were not listening.
const DECLINED_DAYS = 30;
// Twice declined and it stops being asked about at all.
const MAX_DECLINES = 2;
// One member's own saves, newest first. Deep enough that a member with a long
// list still reaches something askable past their recently-stamped rows, and
// bounded because this runs on the request that decides the landing.
const CANDIDATE_LIMIT = 200;

const ENTRY_VENUE_SQL =
  "COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue)";

// A fixture or smoke-test account. Excluded from the card the same way it is
// excluded from every other surface that shows a member's words.
function realMemberSql(alias) {
  const a = alias || "m";
  return (
    "COALESCE(" + a + ".internal_member, FALSE) = FALSE " +
    "AND LOWER(TRIM(" + a + ".email)) NOT LIKE '%.invalid'"
  );
}

function parseStamp(raw) {
  // PocketBase stores "2026-08-01 15:01:49.903Z"; the space is not a format
  // JavaScript is required to parse, so it is made into one.
  return raw ? new Date(String(raw).replace(" ", "T")).getTime() : 0;
}

/**
 * The cities this member is plausibly in: their home city, and anywhere they have
 * since put a place. Lower-cased and trimmed, to be compared the same way.
 *
 * Both lanes count, matching hasContributed elsewhere — the waiting-list loop
 * every member uses now, and the older review-gated contributions — because
 * either one is a member saying they were somewhere.
 *
 * This set is the difference between a follow-up and a question about somebody's
 * holiday. It is deliberately not "everywhere they have saved something": a
 * saved place in Lisbon is evidence of wanting to go, which is exactly the thing
 * the question doubts.
 */
function plausibleCities(app, memberId, homeCity) {
  const cities = [];
  const add = (value) => {
    const city = String(value || "").trim().toLowerCase();
    if (city && cities.indexOf(city) === -1) cities.push(city);
  };
  add(homeCity);
  const rows = arrayOf(new DynamicModel({ city: "" }));
  try {
    app
      .db()
      .newQuery(
        "SELECT w.city AS city FROM community_recommendations r " +
          "JOIN community_place_entries w ON w.id = r.entry " +
          "WHERE r.member = {:member} " +
          "UNION " +
          "SELECT c.city AS city FROM member_place_contributions c " +
          "WHERE c.member = {:member}"
      )
      .bind({ member: memberId })
      .all(rows);
  } catch {
    // Their home city alone is a narrower question, never a wider one.
    return cities;
  }
  for (const row of rows) add(row.city);
  return cities;
}

/**
 * Every save this member could conceivably be asked about, newest first, with the
 * two follow-up fields attached. The time and decline arithmetic is done by the
 * caller in JavaScript rather than in SQL on purpose: PocketBase stores dates as
 * `2026-08-01 15:01:49.903Z` and an ISO string does not compare correctly against
 * that space, so a date range in SQL here would be a silent off-by-a-format.
 *
 * The structural clauses are all here, though, because they are the ones that
 * would otherwise drag hundreds of rows into the request:
 *
 *   published            a member cannot mark what nobody can see
 *   not superseded       they have already been, or already written about it —
 *                        one state per place, and the question is answered
 *   a plausible city     see plausibleCities
 *   a visible note       see the header; this is the endorsement route's own
 *                        visibility clause, and it has to be the same clause
 *   under the cap        twice declined and it is never raised again
 */
function candidateSaves(app, memberId, cities) {
  const scope = require(__hooks + "/circle_scope.js");
  const binds = { caller: memberId };
  const placeholders = [];
  cities.forEach((city, index) => {
    const key = "city" + index;
    placeholders.push("{:" + key + "}");
    binds[key] = city;
  });

  const rows = arrayOf(
    new DynamicModel({
      save_id: "",
      entry_id: "",
      venue_id: "",
      venue_name: "",
      city: "",
      country: "",
      source: "",
      created: "",
      prompted_at: "",
      prompt_declines: 0,
    })
  );
  app
    .db()
    .newQuery(
      "SELECT s.id AS save_id, w.id AS entry_id, " + ENTRY_VENUE_SQL + " AS venue_id, " +
        "w.venue_name, w.city, w.country, s.source, s.created, " +
        "COALESCE(s.prompted_at, '') AS prompted_at, " +
        "COALESCE(s.prompt_declines, 0) AS prompt_declines " +
        "FROM community_place_saves s " +
        "JOIN community_place_entries w ON w.id = s.entry " +
        "WHERE s.member = {:caller} " +
        "AND w.status = 'published' AND COALESCE(w.published_venue, '') != '' " +
        "AND LOWER(TRIM(w.city)) IN (" + placeholders.join(", ") + ") " +
        "AND COALESCE(s.prompt_declines, 0) < " + MAX_DECLINES + " " +
        // Superseded: the member has reached a higher rung and the question is
        // already answered. The save row survives — one state per place is a
        // display rule, not a storage rule — it just stops being askable.
        "AND NOT EXISTS (SELECT 1 FROM community_place_endorsements e " +
        "WHERE e.entry = s.entry AND e.member = s.member) " +
        "AND NOT EXISTS (SELECT 1 FROM community_recommendations mine " +
        "WHERE mine.entry = s.entry AND mine.member = s.member) " +
        // Somebody the member may hear from stands behind it. Without this the
        // card offers a button the endorsement route refuses.
        "AND EXISTS (SELECT 1 FROM community_recommendations r " +
        "JOIN members m ON m.id = r.member " +
        "WHERE r.entry = s.entry AND r.member != {:caller} " +
        "AND TRIM(COALESCE(r.note, '')) != '' " +
        "AND " + realMemberSql("m") + " " +
        "AND m.community_status = 'verified' " +
        "AND " + scope.visibleRecommenderSql("m", "caller") + ") " +
        // Newest first, so the question lands as close to three weeks after
        // saving as the member's visits allow — which is the moment it is worth
        // asking. It also lets a long-dead save sink rather than being dredged up
        // first: a list that only grows is a graveyard, and the fix is to let the
        // bottom of it stay quiet.
        "ORDER BY s.created DESC, s.id DESC LIMIT " + CANDIDATE_LIMIT
    )
    .bind(binds)
    .all(rows);
  return rows;
}

/** The card, with the note the member is being asked to act on. */
function describeCard(app, memberId, row) {
  const endorsements = require(__hooks + "/place_endorsements.js");
  // The exact note the endorsement route would record as provenance, found by
  // that route's own function. Same call, same answer: the card cannot end up
  // quoting one note and marking another.
  const recommendationId = endorsements.frontingRecommendationId(
    app,
    row.entry_id,
    memberId
  );
  // Nothing visible stands behind it after all — a note withdrawn between the
  // query above and this line. No card rather than a button that refuses the tap.
  if (!recommendationId) return null;

  let note = "";
  let recommender = "";
  try {
    const recommendation = app.findRecordById(
      "community_recommendations",
      recommendationId
    );
    note = recommendation.getString("note").trim();
    recommender = app
      .findRecordById("members", recommendation.getString("member"))
      .getString("pseudo");
  } catch {
    // The note is context, not the question: a member is being asked about a
    // place they chose themselves and the name is enough to know which one.
  }

  return {
    save: row.save_id,
    place: String(row.venue_id || ""),
    entry: row.entry_id,
    place_name: row.venue_name,
    city: row.city,
    country: row.country,
    note: note,
    recommender: recommender,
    // How long ago they said they wanted to go, in whole days — the client says
    // "a while back" and does not print this, but the copy layer owning the
    // wording means it needs the fact to word it differently later.
    saved_days_ago: Math.max(
      0,
      Math.floor((Date.now() - parseStamp(row.created)) / DAY_MS)
    ),
  };
}

/**
 * Stamp a save as asked about. Called when the card is handed out, not when it is
 * answered: the stamp is what stops the same question arriving on every page load
 * of the visit, and a member who ignores it has still been asked.
 */
function markPrompted(app, saveId) {
  try {
    const record = app.findRecordById("community_place_saves", saveId);
    record.set("prompted_at", new Date().toISOString());
    app.save(record);
    return true;
  } catch (error) {
    // A card shown without a stamp comes back next load, which is a repeated
    // question rather than a broken landing. Not worth failing /me over.
    try {
      app
        .logger()
        .warn("Been-yet prompt could not be stamped.", "save", saveId, "error", String(error));
    } catch {
      // Logging must not be the reason a landing fails to load.
    }
    return false;
  }
}

/**
 * Record a "not yet": the place is still ahead of them, so it rests a month, and
 * a second one retires the question for good.
 *
 * Returns whether a row was updated. The route reports that plainly rather than
 * inventing a refusal — a decline that lands nowhere costs the member nothing.
 */
function declineFollowUp(app, memberId, entryId) {
  const saves = require(__hooks + "/place_saves.js");
  const existing = saves.findSave(app, memberId, entryId);
  if (!existing) return false;
  existing.set("prompted_at", new Date().toISOString());
  existing.set("prompt_declines", existing.getInt("prompt_declines") + 1);
  app.save(existing);
  return true;
}

/**
 * The follow-up due this member, or null.
 *
 * Takes the session facts from member_sessions.touchMemberSession, and must be
 * called after it: the previous-visit stamp it reads is the one that ping just
 * moved.
 *
 * STABLE WITHIN A VISIT, like the place prompt. A card is stamped when it is first
 * handed out, and every later page load in the same session is handed the same
 * card back — a question that changed as a member clicked around would read as a
 * different question each time, and every gate above would be spent in one sitting.
 *
 * STAMPS AS A SIDE EFFECT, also like the place prompt, so it must only be called
 * when the answer slot is still free. Calling it and discarding the answer burns a
 * question nobody was shown.
 */
function nextFollowUp(app, auth, session) {
  try {
    const record = app.findRecordById("members", auth.id);
    const cities = plausibleCities(app, auth.id, record.getString("home_city"));
    // Nowhere they are plausibly in: no question. Signup asks for a home city,
    // but accounts predating the required field can still be without one, and a
    // member with no places of their own then has nothing to widen it with.
    if (!cities.length) return null;

    const rows = candidateSaves(app, auth.id, cities);
    if (!rows.length) return null;

    const now = Date.now();
    const previous = parseStamp(record.getString("previous_seen_at"));

    // Already asked during the visit in progress: the previous visit ended before
    // that stamp, so the stamp belongs to this one and the same card comes back.
    for (const row of rows) {
      const prompted = parseStamp(row.prompted_at);
      if (prompted && (!previous || prompted > previous)) {
        return describeCard(app, auth.id, row);
      }
    }

    for (const row of rows) {
      // Three weeks. The gate the whole feature hangs off.
      if (now - parseStamp(row.created) < MIN_AGE_DAYS * DAY_MS) continue;
      const prompted = parseStamp(row.prompted_at);
      if (prompted) {
        const rest = Number(row.prompt_declines) > 0 ? DECLINED_DAYS : REST_DAYS;
        if (now - prompted < rest * DAY_MS) continue;
      }
      const card = describeCard(app, auth.id, row);
      if (!card) continue;
      markPrompted(app, row.save_id);
      return card;
    }
    return null;
  } catch (error) {
    // The landing must render. A follow-up that cannot be worked out costs the
    // member a question, and the answer slot falls through to the prompt below it.
    try {
      app
        .logger()
        .warn(
          "Been-yet follow-up could not be resolved.",
          "member",
          auth.id,
          "error",
          String(error)
        );
    } catch {
      // Logging must not be the reason a landing fails to load.
    }
    return null;
  }
}

module.exports = {
  DECLINED_DAYS,
  MAX_DECLINES,
  MIN_AGE_DAYS,
  REST_DAYS,
  declineFollowUp,
  nextFollowUp,
};

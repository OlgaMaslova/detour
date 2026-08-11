/// <reference path="../pb_data/types.d.ts" />
//
// Asking a member for their first place. Require from inside request callbacks;
// PocketBase executes handlers in isolated VMs without hook-file globals.
//
// WHO IS ASKED. Somebody who came back and has never put a place on Detour. Both
// halves matter: a first-ever visit is not the moment to ask anything, and a
// member who has already contributed has answered the question — the prompt
// disappears the moment they do, without needing to be dismissed.
//
// WHAT IS ASKED. Two tracks and three rungs. The track depends on whether their
// city has anything in it yet — an empty city is a different ask ("you'd be
// first") from a full one ("none of them yours") — and the rung escalates the
// longer they go without answering. Paced by wall clock, not by visits: the next
// visit, then a week, then a fortnight, so a member who opens Detour daily is
// asked no more often than one who opens it monthly.
//
// WHAT THIS MODULE DOES NOT DO. It never writes copy. It returns a rung number
// and the facts that rung might need — the city, how many places are in it, whose
// place is most recent, what that place is for — and the client words it (see
// PLACE_PROMPT_LADDER in src/network.ts). Wording changes should not be server
// deploys, and the same rung is worded two ways depending on the track.
//
// EVERYTHING HERE IS CIRCLE-SCOPED. The count and the named member come from one
// query gated by circle_scope.visibleRecommenderSql, so a prompt can never
// mention a member the reader is not allowed to hear from, and "{n} places in
// Madrid" means the number on *their* list. A global count would both overstate
// what they can see and leak the catalogue's real size.

// Occasions in the order the first rung prefers to ask about them, as keys from
// src/occasions.ts. The client holds the prose word for each — keep the two in
// step; a key with no word there is skipped rather than printed raw.
const OCCASION_LADDER = [
  "breakfast_brunch",
  "neighborhood_meal",
  "coffee",
  "late_night",
  "drinks_nightcap",
];

// Rung n is due this many days after rung n - 1 was shown. The first needs no
// wait beyond having come back at all.
const RUNG_GAP_DAYS = [0, 7, 14];
// The last rung repeats rather than running out: a member who never answers keeps
// getting the fortnightly version.
const MAX_RUNG = 3;
const DAY_MS = 86400000;

function parseStamp(raw) {
  return raw ? new Date(String(raw).replace(" ", "T")).getTime() : 0;
}

function parseOccasions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Has this member put anything on Detour? Either lane counts — the waiting-list
 * loop every member uses now, and the older review-gated contributions — because
 * either one means the question has been answered.
 */
function hasContributed(app, memberId) {
  const recommendations = app.countRecords(
    "community_recommendations",
    $dbx.exp("member = {:member}", { member: memberId })
  );
  if (recommendations > 0) return true;
  const contributions = app.countRecords(
    "member_place_contributions",
    $dbx.exp("member = {:member}", { member: memberId })
  );
  return contributions > 0;
}

/**
 * The places in this member's city that this member is allowed to see, most
 * recently recommended first. One query serves both the count and the named
 * place, so they can never disagree about what is on the list.
 */
function visibleCityPlaces(app, memberId, city) {
  const scope = require(__hooks + "/circle_scope.js");
  const rows = arrayOf(
    new DynamicModel({
      venue_id: "",
      venue_name: "",
      occasions: "",
      recommender: "",
      created: "",
    })
  );
  app
    .db()
    .newQuery(
      "SELECT v.id AS venue_id, v.name AS venue_name, v.occasions AS occasions, " +
        "m.pseudo AS recommender, r.created AS created " +
        "FROM community_recommendations r " +
        "JOIN community_place_entries w ON w.id = r.entry " +
        "JOIN members m ON m.id = r.member " +
        "JOIN venues v ON v.id = COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue) " +
        "WHERE v.published = TRUE AND v.suppressed != TRUE " +
        "AND LOWER(TRIM(v.city)) = LOWER(TRIM({:city})) " +
        // Fixture accounts are filtered from every surface that shows a
        // recommendation, and a prompt naming one would be a fixture speaking.
        "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
        "AND " + scope.visibleRecommenderSql("m", "caller") + " " +
        "ORDER BY r.created DESC"
    )
    .bind({ caller: memberId, city: city })
    .all(rows);
  return rows;
}

/**
 * The occasions this member's own places already speak for. Empty for anyone the
 * prompt is offered to — having a place is what ends the prompting — so this is
 * what keeps the first rung's occasion correct if that gate is ever loosened to
 * include members who have contributed.
 */
function coveredOccasions(app, memberId) {
  const rows = arrayOf(new DynamicModel({ occasions: "" }));
  try {
    app
      .db()
      .newQuery(
        "SELECT v.occasions AS occasions FROM community_recommendations r " +
          "JOIN community_place_entries w ON w.id = r.entry " +
          "JOIN venues v ON v.id = COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue) " +
          "WHERE r.member = {:member} " +
          "UNION ALL " +
          "SELECT c.occasions AS occasions FROM member_place_contributions c " +
          "WHERE c.member = {:member}"
      )
      .bind({ member: memberId })
      .all(rows);
  } catch {
    return [];
  }
  const covered = [];
  for (const row of rows) {
    for (const key of parseOccasions(row.occasions)) {
      if (covered.indexOf(key) === -1) covered.push(key);
    }
  }
  return covered;
}

/**
 * The first occasion on the ladder nobody has spoken for yet, skipping any the
 * caller needs it to differ from. Degenerates to the head of the ladder only if a
 * member's places somehow cover all of it.
 */
function pickOccasion(covered, excludes) {
  const skip = covered.concat(excludes || []);
  for (const key of OCCASION_LADDER) {
    if (skip.indexOf(key) === -1) return key;
  }
  return OCCASION_LADDER[0];
}

/** The facts a rung might need, gathered once the rung is settled. */
function describePrompt(app, memberId, city, rung) {
  const places = visibleCityPlaces(app, memberId, city);
  const venueIds = [];
  for (const row of places) {
    if (venueIds.indexOf(row.venue_id) === -1) venueIds.push(row.venue_id);
  }
  const covered = coveredOccasions(app, memberId);
  const newest = places.length ? places[0] : null;
  const placeOccasions = newest ? parseOccasions(newest.occasions) : [];
  // What the newest place is for, preferred in ladder order so the word the copy
  // gets is one the client can actually say.
  let placeOccasion = "";
  for (const key of OCCASION_LADDER) {
    if (placeOccasions.indexOf(key) !== -1) {
      placeOccasion = key;
      break;
    }
  }
  if (!placeOccasion && placeOccasions.length) placeOccasion = placeOccasions[0];

  // What this member is asked about, and something to contrast it with. The
  // contrast is measured against the place being quoted when there is one, and
  // against the asked occasion when there is not — otherwise the empty-city track,
  // which quotes no place, would offer the same word twice.
  const asked = pickOccasion(covered, []);
  return {
    rung: rung,
    // The track: an empty city is asked a different question from a full one.
    city: city,
    city_place_count: venueIds.length,
    // Whose place is most recent, and what it is for. Empty on the empty track.
    recommender: newest ? newest.recommender : "",
    place_name: newest ? newest.venue_name : "",
    place_occasion: placeOccasion,
    occasion: asked,
    other_occasion: pickOccasion(covered, [placeOccasion || asked]),
  };
}

/**
 * Decide what to ask this member, if anything.
 *
 * Takes the session facts from member_sessions.touchMemberSession, and must be
 * called after it: the previous-visit stamp it reads is the one that ping just
 * moved. Returns null when there is nothing to ask.
 *
 * Stable within a visit. A prompt is stamped when it is first shown, and every
 * later page load in the same session is handed the same rung back without
 * advancing — a question that changed as a member clicked around would read as a
 * different question each time, and the fortnight gate would be spent instantly.
 */
function resolvePlacePrompt(app, auth, session) {
  try {
    const record = app.findRecordById("members", auth.id);
    const city = record.getString("home_city").trim();
    // Nothing to ask about: signup asks for a home city, but accounts that
    // predate the required field can still be without one.
    if (!city) return null;
    if (hasContributed(app, auth.id)) return null;

    const step = record.getInt("place_prompt_step");
    const shownRaw = record.getString("place_prompt_shown_at");
    const shownAt = parseStamp(shownRaw);
    const previous = parseStamp(record.getString("previous_seen_at"));
    const now = Date.now();

    // Shown already during the visit in progress: the previous visit ended before
    // this stamp, so the stamp belongs to this one.
    if (shownAt && (!previous || shownAt > previous)) {
      return describePrompt(app, auth.id, city, Math.min(step, MAX_RUNG) || 1);
    }

    // A prompt is for somebody who came back. Their first visit is not it.
    if (session.visit_count < 2) return null;

    const waitDays = RUNG_GAP_DAYS[Math.min(step, RUNG_GAP_DAYS.length - 1)];
    if (shownAt && now - shownAt < waitDays * DAY_MS) return null;

    const rung = Math.min(step + 1, MAX_RUNG);
    record.set("place_prompt_step", rung);
    record.set("place_prompt_shown_at", new Date(now).toISOString());
    app.save(record);
    return describePrompt(app, auth.id, city, rung);
  } catch (error) {
    // /me decides the masthead menu. A prompt that cannot be worked out costs
    // the member a nudge, never their session.
    app.logger().warn("Place prompt could not be resolved.", "member", auth.id, "error", String(error));
    return null;
  }
}

module.exports = {
  MAX_RUNG,
  OCCASION_LADDER,
  RUNG_GAP_DAYS,
  resolvePlacePrompt,
};

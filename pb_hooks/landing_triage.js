/// <reference path="../pb_data/types.d.ts" />
//
// The triage card: what a member with no places of their own is asked instead of
// being asked to produce something from nothing.
//
// See docs/landing-spec.md. The problem it solves is the blank record — a member
// opens My detours on day one and finds it empty, and "add a place" is precisely
// the demand the research says does not exist. People recommend when they are
// asked, about something. So the landing asks about something: a real place from
// their own city, somebody else's note, shown in full.
//
// THE QUESTION IS ABOUT THE PLACE, NOT THE MEMBER WHO WROTE IT. *Know this
// place?* rather than anything naming what another member achieved. That
// distinction is what keeps the card from reading as social pressure, and it
// matters most now, while the other name on it is nearly always the founder's.
//
// This is a module, not a hook file: nothing here registers anything (the route
// lives in landing_triage.pb.js). PocketBase runs every hook callback in its own
// VM, so every function here must be reached through a `require()` made INSIDE
// the callback that uses it.

// A fixture or smoke-test account. Excluded from the card the same way it is
// excluded from every other surface that shows a member's words.
function realMemberSql(alias) {
  const a = alias || "m";
  return (
    "COALESCE(" + a + ".internal_member, FALSE) = FALSE " +
    "AND LOWER(TRIM(" + a + ".email)) NOT LIKE '%.invalid'"
  );
}

const ENTRY_VENUE_SQL =
  "COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue)";

/**
 * Has this member put anything on Detour? The gate on the whole mechanic: the
 * card is for somebody with a blank record, and the moment they have one of their
 * own the landing has something to show them instead.
 *
 * Both lanes count, matching place_prompts.hasContributed — the waiting-list loop
 * every member uses now, and the older review-gated contributions.
 */
function hasContributed(app, memberId) {
  try {
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
  } catch {
    // Unable to tell: assume they have contributed, so a member who has is never
    // shown a card meant for somebody who has not. Silence is the safe failure.
    return true;
  }
}

/**
 * The next place to ask this member about, or null.
 *
 * The most recently published place in their home city that they have no state on
 * and whose fronting note they can see. Each clause earns its place:
 *
 *   their home city   a card from a city they have no connection to is noise with
 *                     a name on it, so there is no fallback to "somewhere else"
 *   no state on it    the same card is never shown twice, and a member is never
 *                     asked about somewhere they have already answered for
 *   a visible note    NOT OPTIONAL. The endorsement route refuses a mark where
 *                     the caller cannot see a note — "That place is not on your
 *                     list." — so a card chosen on city and recency alone would
 *                     sometimes offer a Been & loved it button that 400s on tap.
 *                     The selection and the route use the same visibility clause,
 *                     and they have to.
 *
 * `skip` is the places this member has passed on during the current visit. "Don't
 * know it" records nothing about the member, so the only thing that stops the
 * card coming straight back is the client naming what it has already shown.
 */
function nextTriageCard(app, memberId, skip) {
  try {
    if (hasContributed(app, memberId)) return null;

    let city = "";
    try {
      city = app.findRecordById("members", memberId).getString("home_city").trim();
    } catch {
      return null;
    }
    // Signup asks for a home city, but accounts predating the required field can
    // still be without one. No city, no card — see the header.
    if (!city) return null;

    const scope = require(__hooks + "/circle_scope.js");
    const binds = { caller: memberId, city: city };
    const skipped = [];
    (Array.isArray(skip) ? skip : []).forEach((value, index) => {
      const id = String(value || "").trim();
      if (!id) return;
      const key = "skip" + index;
      skipped.push("{:" + key + "}");
      binds[key] = id;
    });

    const rows = arrayOf(
      new DynamicModel({
        entry_id: "",
        venue_id: "",
        venue_name: "",
        city: "",
        country: "",
        note: "",
        recommender: "",
        founding_member: false,
        created: "",
      })
    );
    app
      .db()
      .newQuery(
        "SELECT w.id AS entry_id, " + ENTRY_VENUE_SQL + " AS venue_id, " +
          "w.venue_name, w.city, w.country, r.note, m.pseudo AS recommender, " +
          "CASE WHEN " +
          require(__hooks + "/founding_cap.js").foundingMemberSql("m") +
          " THEN TRUE ELSE FALSE END AS founding_member, " +
          "r.created " +
          "FROM community_recommendations r " +
          "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
          "JOIN members m ON m.id = r.member " +
          "WHERE w.status = 'published' AND COALESCE(w.published_venue, '') != '' " +
          "AND LOWER(TRIM(w.city)) = LOWER(TRIM({:city})) " +
          "AND TRIM(COALESCE(r.note, '')) != '' " +
          "AND r.member != {:caller} " +
          "AND " + realMemberSql("m") + " " +
          "AND m.community_status = 'verified' " +
          // The same clause the endorsement route applies. See the header: this
          // is what stops the card offering a button that refuses the tap.
          "AND " + scope.visibleRecommenderSql("m", "caller") + " " +
          // No state on it, in any of the three senses. A member who has already
          // answered for this place — by writing about it, by marking it, or by
          // meaning to go — is not asked about it again.
          "AND NOT EXISTS (SELECT 1 FROM community_recommendations mine " +
          "WHERE mine.waitlist = w.id AND mine.member = {:caller}) " +
          "AND NOT EXISTS (SELECT 1 FROM community_place_endorsements e " +
          "WHERE e.waitlist = w.id AND e.member = {:caller}) " +
          "AND NOT EXISTS (SELECT 1 FROM community_place_saves s " +
          "WHERE s.waitlist = w.id AND s.member = {:caller}) " +
          (skipped.length
            ? "AND " + ENTRY_VENUE_SQL + " NOT IN (" + skipped.join(", ") + ") "
            : "") +
          // Recency is the wedge: the newest thing in their city is the one most
          // worth asking about, and it is also the one least likely to have been
          // seen already. Ties break on id so a reload cannot reshuffle the card.
          "ORDER BY r.created DESC, r.id DESC LIMIT 1"
      )
      .bind(binds)
      .all(rows);
    if (!rows.length) return null;

    const row = rows[0];
    return {
      place: String(row.venue_id || ""),
      entry: row.entry_id,
      place_name: row.venue_name,
      city: row.city,
      country: row.country,
      note: row.note,
      recommender: row.recommender,
      founding_member: Boolean(row.founding_member),
      created: row.created,
    };
  } catch (error) {
    // The landing must render. A card that cannot be worked out costs the member
    // a question, and the answer slot falls through to the prompt below it.
    try {
      app
        .logger()
        .warn(
          "Triage card could not be resolved.",
          "member",
          memberId,
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
  hasContributed,
  nextTriageCard,
};

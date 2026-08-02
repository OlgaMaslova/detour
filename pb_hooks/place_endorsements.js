/// <reference path="../pb_data/types.d.ts" />
//
// Been & loved — the bottom rung of the ladder, and the only feedback loop in
// Detour that costs the giver nothing.
//
// A member who went somewhere on somebody's recommendation presses one button.
// The person who wrote that note is emailed: their own sentence coming back to
// them with a named member's agreement attached. Contribution otherwise produces
// silence — you write a place and nothing ever happens — and that silence is the
// problem this exists to solve. See docs/been-and-loved-spec.md.
//
// This is a module, not a hook file: nothing here registers anything (the route
// and the sweep live in place_endorsements.pb.js). PocketBase runs every hook
// callback in its own VM, so every function here must be reached through a
// `require()` made INSIDE the callback that uses it.
//
// The whole file obeys one rule the rest of the product already obeys: global
// count, scoped names. The count on a place is every mark from every circle; the
// names are only the members this caller may see, and every read reports WHICH
// visibility clause matched, so the copy can say "in your circle" when the graph
// matched and never when the founding tier did.

// A fixture or smoke-test account. The .invalid TLD is reserved by RFC 2606, so
// these can never be real members; they are excluded from counts, from names,
// and from both sides of a notification.
const RESERVED_EMAIL = /@(?:[^@\s]+\.)*invalid$/i;

// SQL fragment: this member is a real, mailable, countable member. Fixtures and
// internal accounts are excluded everywhere a member is counted or named, which
// is the same exclusion the discovery feed and the first-place notice apply.
function realMemberSql(alias) {
  const a = alias || "m";
  return (
    "COALESCE(" + a + ".internal_member, FALSE) = FALSE " +
    "AND LOWER(TRIM(" + a + ".email)) NOT LIKE '%.invalid'"
  );
}

// The venue a waiting-list entry resolves to, published first and falling back
// to the canonical catalogue row it was matched to before publication — exactly
// how /api/detour/place-detourists keys its own counts, so the two payloads
// cannot disagree about which venue a mark belongs to.
const ENTRY_VENUE_SQL =
  "COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue)";

/**
 * The place a member is addressing, resolved to its waiting-list entry.
 *
 * Callers hold a venue id — that is what a card, the map preview and the place
 * page all carry — while an endorsement hangs off the entry, because that is
 * what a recommendation hangs off. Both are accepted: an entry id is used as
 * given, and anything else is looked up as a published venue. Returns null when
 * the reference names nothing, which the route turns into a 400 rather than
 * leaking the difference between "no such place" and "a place you cannot see".
 */
function resolvePlaceEntry(app, reference) {
  const id = String(reference || "").trim();
  if (!id) return null;
  try {
    return app.findRecordById("community_waitlist_entries", id);
  } catch {
    // Not an entry id. Fall through to the venue lookup.
  }
  try {
    return app.findFirstRecordByFilter(
      "community_waitlist_entries",
      "published_venue = {:venue}",
      { venue: id }
    );
  } catch {
    return null;
  }
}

/**
 * The note a member is going on when they mark a place: the fronting note at the
 * time they press, chosen the same way every client fronts one — newest first,
 * ties broken on id.
 *
 * Scoped to the notes this caller can actually read. A member cannot have gone
 * on the word of somebody they were never shown, and recording an invisible
 * recommendation as the provenance would mail a member whose note the endorser
 * never saw. Returns "" when nothing visible stands behind the place, which is
 * allowed: the mark is on the place, and the provenance is optional.
 */
function frontingRecommendationId(app, entryId, callerId) {
  const scope = require(__hooks + "/circle_scope.js");
  const rows = arrayOf(new DynamicModel({ id: "" }));
  try {
    app
      .db()
      .newQuery(
        "SELECT r.id FROM community_recommendations r " +
          "JOIN members m ON m.id = r.member " +
          "WHERE r.waitlist = {:entry} " +
          "AND r.member != {:caller} " +
          "AND " + realMemberSql("m") + " " +
          "AND m.community_status = 'verified' " +
          "AND " + scope.visibleRecommenderSql("m", "caller") + " " +
          "ORDER BY r.created DESC, r.id DESC LIMIT 1"
      )
      .bind({ entry: entryId, caller: callerId })
      .all(rows);
  } catch {
    // Provenance is a convenience. Failing to find it must never be the reason
    // a mark cannot be recorded.
    return "";
  }
  return rows.length ? rows[0].id : "";
}

/** This member's mark on this place, or null. */
function findEndorsement(app, memberId, entryId) {
  try {
    return app.findFirstRecordByFilter(
      "community_place_endorsements",
      "member = {:member} && waitlist = {:waitlist}",
      { member: memberId, waitlist: entryId }
    );
  } catch {
    return null;
  }
}

/**
 * Every mark on one place, from every circle. The figure the count states.
 *
 * A global fact about the place, like its address — and safe for exactly that
 * reason. It is only ever served for a place the caller can already see.
 */
function endorsementTotal(app, entryId) {
  const summary = new DynamicModel({ total: 0 });
  try {
    app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM community_place_endorsements e " +
          "JOIN members m ON m.id = e.member " +
          "WHERE e.waitlist = {:entry} AND " + realMemberSql("m")
      )
      .bind({ entry: entryId })
      .one(summary);
  } catch {
    return 0;
  }
  return Number(summary.total || 0);
}

/**
 * Remove this member's mark on this place, if they have one.
 *
 * Called by the toggle, and by the recommendation write path: a member who had
 * marked a place and then writes about it must not appear twice on it — once
 * under BEEN & LOVED and once under RECOMMEND. The note supersedes the mark and
 * says more, in their own words. Returns whether a row was removed.
 */
function clearEndorsement(app, memberId, entryId) {
  const existing = findEndorsement(app, memberId, entryId);
  if (!existing) return false;
  app.delete(existing);
  return true;
}

/**
 * The caller-scoped endorsement projection for the whole catalogue, keyed by
 * venue id — the read side of the feature, folded into the payload
 * /api/detour/place-detourists already sends.
 *
 * Three values per venue, and the split between them is the whole point:
 *
 *   totals  every mark on the place, from every circle
 *   names   only the members this caller may see, each carrying the clause that
 *           matched (`in_graph`) so the copy says "in your circle" only when the
 *           graph put them in reach and never when the founding tier did
 *   own     whether the caller is one of them
 *
 * A caller who can see the place but none of its endorsers gets the total and no
 * names. That leaks nothing — the count is a fact about the place — and it must
 * stay that way round: naming a member the caller cannot see would let them
 * learn that member exists, which is the invitation graph by another route.
 *
 * The caller is responsible for pruning venues they cannot see (see the
 * containment step in the place-detourists route). A total for a place the
 * caller has no access to would state the size and shape of a catalogue they are
 * not entitled to.
 */
function endorsementSignals(app, callerId) {
  const scope = require(__hooks + "/circle_scope.js");
  const totals = {};
  const names = {};
  const own = {};

  const rows = arrayOf(
    new DynamicModel({
      venue_id: "",
      member_id: "",
      pseudo: "",
      display_name: "",
      visible_to_caller: false,
      in_graph: false,
      created: "",
    })
  );
  try {
    app
      .db()
      .newQuery(
        "SELECT " + ENTRY_VENUE_SQL + " AS venue_id, " +
          "e.member AS member_id, m.pseudo, m.display_name, " +
          // Visibility is selected as a column rather than applied as a filter,
          // because one pass has to produce two different numbers: the global
          // total, and the names this caller is allowed to read.
          "CASE WHEN " + scope.visibleRecommenderSql("m", "caller") + " THEN TRUE ELSE FALSE END AS visible_to_caller, " +
          "CASE WHEN " + scope.graphMemberSql("m", "caller") + " THEN TRUE ELSE FALSE END AS in_graph, " +
          "e.created " +
          "FROM community_place_endorsements e " +
          "JOIN community_waitlist_entries w ON w.id = e.waitlist " +
          "JOIN members m ON m.id = e.member " +
          "WHERE " + realMemberSql("m") + " " +
          "ORDER BY e.created ASC, e.id ASC"
      )
      .bind({ caller: callerId })
      .all(rows);
  } catch (error) {
    // A read failure here must degrade to "no marks recorded", never to an
    // unscoped answer. The places themselves are unaffected.
    try {
      app.logger().warn("Detour endorsement projection failed.", "error", String(error));
    } catch {
      // Logging must not be the reason a catalogue load fails.
    }
    return { totals: {}, names: {}, own: {} };
  }

  for (const row of rows) {
    const venueId = String(row.venue_id || "");
    if (!venueId || !row.member_id) continue;
    totals[venueId] = (totals[venueId] || 0) + 1;
    if (row.member_id === callerId) own[venueId] = true;
    if (!row.visible_to_caller) continue;
    // Members have one name on Detour and it is the pseudo; display_name is
    // only a fallback for accounts that predate the consolidation. A member with
    // neither is counted in the total and left unnamed rather than shown blank.
    const name = String(row.pseudo || "").trim() || String(row.display_name || "").trim();
    if (!name) continue;
    if (!names[venueId]) names[venueId] = [];
    names[venueId].push({
      name: name,
      // Which clause matched. A founding member who is also in the caller's
      // graph counts as circle: the graph clause is the stronger claim, and it
      // is the one the reader can act on.
      in_graph: Boolean(row.in_graph),
      is_own: row.member_id === callerId,
    });
  }

  return { totals: totals, names: names, own: own };
}

/**
 * One place a member has been and loved, as My detours lists it. Used only for
 * the caller's own rows, which they may read directly — no scoping question
 * arises.
 */
function ownEndorsements(app, memberId) {
  const rows = arrayOf(
    new DynamicModel({
      id: "",
      venue_id: "",
      venue_name: "",
      city: "",
      country: "",
      created: "",
    })
  );
  try {
    app
      .db()
      .newQuery(
        "SELECT e.id, " + ENTRY_VENUE_SQL + " AS venue_id, " +
          "w.venue_name, w.city, w.country, e.created " +
          "FROM community_place_endorsements e " +
          "JOIN community_waitlist_entries w ON w.id = e.waitlist " +
          "WHERE e.member = {:member} " +
          "ORDER BY e.created DESC, e.id DESC LIMIT 500"
      )
      .bind({ member: memberId })
      .all(rows);
  } catch {
    return [];
  }
  const items = [];
  for (const row of rows) {
    items.push({
      id: row.id,
      venue_id: String(row.venue_id || ""),
      venue_name: row.venue_name,
      city: row.city,
      country: row.country,
      created: row.created,
    });
  }
  return items;
}

/**
 * The notice: the recommender whose note was acted on hears about it.
 *
 * Not the place's other participants — the one person whose sentence this member
 * went on. Everything else about the delivery is a constraint carried over from
 * first_place_notice.pb.js: the row is claimed before the send, so a delivery
 * failure is a lost email rather than a repeated one; fixtures and internal
 * members are excluded on both sides; and a member never mails themselves.
 *
 * WHY A SWEEP AND NOT AN AFTER-CREATE HOOK. Batching. A place that collects four
 * marks in an hour must not produce four emails, and the only way to know that a
 * second one is coming is to wait a little. The sweep runs every quarter hour and
 * sends one email per recipient covering everything claimed in that pass; a
 * single mark still reaches its author within fifteen minutes, which is well
 * inside the time it takes for feedback to still feel like feedback.
 *
 * Best-effort throughout: this must never fail a member's tap, and the tap has
 * long since been committed by the time it runs.
 */
function deliverEndorsementNotices(app) {
  const mailer = require(__hooks + "/mailer.js");
  const stamped = new Date().toISOString();

  // Claim first. The UPDATE matches only rows still unclaimed, so two sweeps
  // racing — a slow run overlapping the next tick — split the work rather than
  // mailing it twice.
  const claimed = arrayOf(new DynamicModel({ id: "" }));
  app
    .db()
    .newQuery(
      "UPDATE community_place_endorsements SET notified_at = {:stamped} " +
        "WHERE COALESCE(notified_at, '') = '' " +
        "AND id IN (" +
        "SELECT id FROM community_place_endorsements " +
        "WHERE COALESCE(notified_at, '') = '' " +
        "ORDER BY created ASC LIMIT 200" +
        ") RETURNING id"
    )
    .bind({ stamped: stamped })
    .all(claimed);
  if (!claimed.length) return 0;

  // The rows this pass claimed are exactly the rows carrying this pass's stamp,
  // so the follow-up query selects on that rather than assembling an id list —
  // one bound parameter instead of interpolated ids.
  //
  // Everything the email needs, in one pass: who marked it, what they marked,
  // and whose note they went on. A row whose recommendation was withdrawn since
  // has nobody to tell and drops out on the join.
  const details = arrayOf(
    new DynamicModel({
      endorsement_id: "",
      recipient_id: "",
      recipient_email: "",
      endorser_name: "",
      venue_name: "",
      city: "",
      note: "",
    })
  );
  app
    .db()
    .newQuery(
      "SELECT e.id AS endorsement_id, author.id AS recipient_id, author.email AS recipient_email, " +
        "COALESCE(NULLIF(TRIM(endorser.pseudo), ''), TRIM(endorser.display_name)) AS endorser_name, " +
        "w.venue_name, w.city, r.note " +
        "FROM community_place_endorsements e " +
        "JOIN community_recommendations r ON r.id = e.recommendation " +
        "JOIN members author ON author.id = r.member " +
        "JOIN members endorser ON endorser.id = e.member " +
        "JOIN community_waitlist_entries w ON w.id = e.waitlist " +
        "WHERE e.notified_at = {:stamped} " +
        // Neither side may be a fixture or an internal account, and nobody is
        // told they endorsed themselves — the write path already refuses that,
        // and this is the belt to its braces.
        "AND author.id != e.member " +
        "AND " + realMemberSql("author") + " " +
        "AND " + realMemberSql("endorser") + " " +
        "AND TRIM(COALESCE(author.email, '')) != '' " +
        "ORDER BY author.id ASC, e.created ASC"
    )
    .bind({ stamped: stamped })
    .all(details);
  if (!details.length) return 0;

  // One email per recipient, however many places it covers.
  const byRecipient = {};
  const order = [];
  for (const row of details) {
    if (!byRecipient[row.recipient_id]) {
      byRecipient[row.recipient_id] = { email: String(row.recipient_email || "").trim(), items: [] };
      order.push(row.recipient_id);
    }
    byRecipient[row.recipient_id].items.push({
      who: String(row.endorser_name || "").trim() || "A Detourist",
      place: String(row.venue_name || "").trim() || "a place",
      city: String(row.city || "").trim(),
      note: String(row.note || "").trim(),
    });
  }

  const siteUrl = "https://takedetour.app";
  let sent = 0;
  for (const recipientId of order) {
    const recipient = byRecipient[recipientId];
    if (!recipient.email || RESERVED_EMAIL.test(recipient.email)) continue;
    try {
      const items = recipient.items;
      const first = items[0];
      const where = first.city ? first.place + " in " + first.city : first.place;
      const subject =
        items.length === 1
          ? first.who + " went to " + first.place + ", and loved it"
          : items.length + " Detourists went where you sent them";

      const textParts = [];
      const htmlParts = [];
      for (const item of items) {
        const place = item.city ? item.place + " in " + item.city : item.place;
        textParts.push(
          item.who +
            " has been to " +
            place +
            " on your recommendation, and loved it." +
            (item.note ? "\n\nYou wrote:\n" + item.note : "")
        );
        htmlParts.push(
          "<p><strong>" +
            mailer.escapeHtml(item.who) +
            "</strong> has been to " +
            mailer.escapeHtml(place) +
            " on your recommendation, and loved it.</p>" +
            (item.note
              ? "<blockquote><p>" + mailer.escapeHtml(item.note) + "</p></blockquote>"
              : "")
        );
      }

      mailer.sendMail(app, {
        to: recipient.email,
        subject: subject,
        text:
          textParts.join("\n\n---\n\n") +
          "\n\nSee it: " +
          siteUrl +
          "\n\nYou received this because you recommended " +
          (items.length === 1 ? where : "these places") +
          " on Detour.",
        html:
          htmlParts.join("") +
          '<p><a href="' +
          siteUrl +
          '">See it on Detour</a></p>' +
          "<p>You received this because you recommended " +
          mailer.escapeHtml(items.length === 1 ? where : "these places") +
          " on Detour.</p>",
      });
      sent += 1;
    } catch (error) {
      // The rows stay claimed. A notice about somebody agreeing with you is not
      // worth a retry loop that risks sending it twice.
      try {
        app.logger().error(
          "Detour been-and-loved notice failed.",
          "recipient",
          recipientId,
          "error",
          String(error)
        );
      } catch {
        // Logging must not turn a best-effort notice into an error.
      }
    }
  }
  return sent;
}

module.exports = {
  clearEndorsement,
  deliverEndorsementNotices,
  endorsementSignals,
  endorsementTotal,
  findEndorsement,
  frontingRecommendationId,
  ownEndorsements,
  resolvePlaceEntry,
};

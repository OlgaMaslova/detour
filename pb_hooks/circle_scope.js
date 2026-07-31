/// <reference path="../pb_data/types.d.ts" />
//
// Who a member is allowed to hear from.
//
// Detour grows only by personal invitation, and the invitation graph is also the
// reach of the list: member-authored content travels one hop out from a member's
// own two edges, plus the founding circle, and no further. My Circle draws
// exactly that set (see /api/detour/circle), so the page a member reads as "my
// circle" and the set that decides what reaches them are the same set — derived
// from the same column, by the same five relational branches.
//
// The set, for a caller C:
//
//   C themself
//   C's inviter
//   every member C invited
//   the other members C's inviter invited        (C's siblings)
//   the members C's invitees invited             (one hop past C's own edge)
//   every founding member, at any distance
//
// Deliberately asymmetric: C sees the members their invitees brought in, but
// those members do not see C. That is what the drawing shows, so it is what this
// enforces.
//
// One column, no stored set. `members.invited_by` already holds the graph, and
// the whole set is one predicate over it — so there is nothing to materialise,
// nothing to backfill, and no cache to invalidate when an invitation is
// redeemed. A stored hop distance was considered and rejected: nothing ranks by
// distance today, so it would buy an edge table, a backfill and three
// maintenance hooks in exchange for a new failure mode — a stored set quietly
// disagreeing with the graph it was derived from. If distance ever earns its
// place, this is the one function to change.
//
// Every read path that returns member-authored content — notes, photos, and any
// count derived from them — must filter with visibleRecommenderSql(). It emits
// TWO clauses, graph membership OR founding member. A read path carrying only
// the first is the most likely bug in this model.

/**
 * SQL: this member's authored content may reach the caller. `alias` is the
 * members alias in the surrounding query; `callerParam` names the bound caller
 * id (default `caller`), which the caller's query must bind.
 *
 * Two clauses, always: graph membership, or founding membership.
 *
 * The COALESCE guard on the sibling branch matters. Without it, a caller whose
 * own `invited_by` is blank — the Founder, or a seeded account — would match
 * every other member whose `invited_by` is also blank, silently widening their
 * circle to every unparented account in the table.
 */
function visibleRecommenderSql(alias, callerParam) {
  const founding = require(__hooks + "/founding_cap.js");
  return (
    "(" +
    graphMemberSql(alias, callerParam) +
    // The founding circle, which is not relational and reads the same for every
    // caller. This is the second clause; a filter without it is the bug.
    " OR " +
    founding.foundingMemberSql(alias || "m") +
    ")"
  );
}

/**
 * SQL: the graph clause on its own — this member is in the caller's invitation
 * graph, whether or not they are also a founding member.
 *
 * Exported because "is a founding member" and "reaches me only because they are a
 * founding member" are different questions, and the feed's Founders' places switch
 * needs the second one. A member's own inviter is frequently also founding; hiding
 * founders' places must not hide the person who brought them in.
 */
function graphMemberSql(alias, callerParam) {
  const a = alias || "m";
  const p = callerParam || "caller";
  return (
    "(" +
    // Self.
    a + ".id = {:" + p + "} " +
    // Everyone the caller invited.
    "OR " + a + ".invited_by = {:" + p + "} " +
    // The caller's inviter.
    "OR " + a + ".id = (SELECT invited_by FROM members WHERE id = {:" + p + "}) " +
    // One hop out: the other members the caller's inviter invited.
    "OR (COALESCE(" + a + ".invited_by, '') != '' " +
    "AND " + a + ".invited_by = (SELECT invited_by FROM members WHERE id = {:" + p + "})) " +
    // One hop out: the members the caller's invitees invited.
    "OR " + a + ".invited_by IN (SELECT id FROM members WHERE invited_by = {:" + p + "})" +
    ")"
  );
}

/**
 * Whether one member's authored content may reach another. The same predicate as
 * visibleRecommenderSql, for routes that resolve a single member and need a
 * yes/no rather than a filter.
 */
function canSee(app, callerId, memberId) {
  const caller = String(callerId || "").trim();
  const member = String(memberId || "").trim();
  if (!caller || !member) return false;
  if (caller === member) return true;
  const summary = new DynamicModel({ total: 0 });
  try {
    app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM members m " +
          "WHERE m.id = {:member} AND " +
          visibleRecommenderSql("m", "caller")
      )
      .bind({ caller: caller, member: member })
      .one(summary);
  } catch {
    // A failed visibility check is a no, never a yes.
    return false;
  }
  return Number(summary.total || 0) > 0;
}

module.exports = {
  canSee,
  graphMemberSql,
  visibleRecommenderSql,
};

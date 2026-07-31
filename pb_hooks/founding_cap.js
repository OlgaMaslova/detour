// Founding membership. Require from inside request callbacks; PocketBase
// executes handlers in isolated VMs without hook-file globals.
//
// FIFTY SEATS, THE FOUNDER'S INCLUDED. The landing page promises "one of fifty —
// fifty founding seats, and no more", and this is where that promise is kept:
// founding membership is the Founder's own account plus the first
// FOUNDING_SEATS - 1 real accounts the Founder personally invited, in the order
// they joined. Fifty founding members in total, of whom forty-nine were invited.
//
// It used to be every account the Founder invited, uncapped, which quietly turned
// each of the Founder's personal invitations into a permanent broadcast right and
// made the fifty on the landing page unenforceable. Seats now run out. The
// fifty-first person the Founder invites is an ordinary member — exactly what the
// landing page already tells applicants ("if the fifty are gone by the time we
// reach your request, it's considered for regular membership instead").
//
// Still derived, still nothing stored: no marker is written at signup and nothing
// is granted, so the answer stays a fact about the invitation graph and cannot
// drift from who actually invited whom. The `direct_founder_invited` and
// `founder_invitation_issuer` columns survive in the schema but no longer decide
// anything; members still cannot set them (see the members update guard).
//
// Two consequences of deriving rather than granting, both intended:
//   - Seats are ordered by join time, so an existing founding member never loses
//     their seat to someone who arrives later.
//   - A seat freed by a departing member is taken by the next member in order.
//     Fifty is a live count of who holds a seat, not a ledger of who ever did.
//
// Internal accounts and reserved `.invalid` fixtures never occupy a seat.
//
// The Founder's account is named by DETOUR_FOUNDER_EMAIL, defaulting to the
// address the founding-member seed migration creates. Set it in the environment
// if that address ever changes; nothing else needs to know.

// Founding members in total, the Founder's own seat included: 1 + 49 invited.
const FOUNDING_SEATS = 50;

// Unclaimed-invitation allowance — a different quantity that happens to share the
// number, and the source of some confusion: this is how many open invitations a
// founding member may hold at once, not how many founding members there are.
// Growing the circle by personal invitation is the job they took on, and the
// landing page promises them this. Both allowances count *unclaimed* codes, so a
// slot returns as soon as someone redeems one — neither is a lifetime total.
const FOUNDING_INVITATION_LIMIT = 50;
const MEMBER_INVITATION_LIMIT = 10;

const DEFAULT_FOUNDER_EMAIL = "maslova_olga@hotmail.com";

function founderEmail() {
  const configured = String($os.getenv("DETOUR_FOUNDER_EMAIL") || "")
    .trim()
    .toLowerCase();
  return configured || DEFAULT_FOUNDER_EMAIL;
}

// The address as a SQL literal, with quotes doubled — the one escape SQLite
// needs. Inlined rather than bound because these fragments compose into queries
// that already carry their own named parameters.
function founderEmailSql() {
  return "'" + founderEmail().replace(/'/g, "''") + "'";
}

/** SQL: this row IS the Founder's account. */
function rootFounderSql(alias) {
  return "LOWER(TRIM(" + (alias || "m") + ".email)) = " + founderEmailSql();
}

/**
 * SQL: the real accounts holding an invited founding seat — the Founder's first
 * FOUNDING_SEATS - 1 invitees, in join order. One short of fifty, because the
 * Founder holds the remaining seat.
 *
 * `joined_at` is the only time column on `members` — the collection has no
 * `created`/`updated` — and it is blank on accounts that predate the field. Those
 * are the oldest accounts there are, so blanking to NULL and letting SQLite's
 * default ASC put NULLs first seats them ahead of every dated account, which is
 * the right order. `id` breaks ties only for determinism; PocketBase ids are
 * random, not chronological.
 */
function foundingSeatIdsSql() {
  return (
    "SELECT id FROM members " +
    "WHERE invited_by = (SELECT id FROM members WHERE LOWER(TRIM(email)) = " +
    founderEmailSql() +
    ") " +
    "AND COALESCE(internal_member, FALSE) = FALSE " +
    "AND LOWER(TRIM(email)) NOT LIKE '%.invalid' " +
    "ORDER BY NULLIF(TRIM(joined_at), '') ASC, id ASC " +
    "LIMIT " + (FOUNDING_SEATS - 1)
  );
}

/**
 * SQL: this row is a founding member — the Founder, or one of the first
 * FOUNDING_SEATS - 1 members they invited. Drop-in for a WHERE clause or a
 * CASE WHEN.
 *
 * A founding member's own invitees are ordinary members: the seat list admits only
 * accounts the *Founder* invited, so founding status never propagates down a
 * branch.
 *
 * The seat subquery is uncorrelated, so SQLite evaluates it once per statement
 * rather than once per row.
 */
function foundingMemberSql(alias) {
  const a = alias || "m";
  return "(" + rootFounderSql(a) + " OR " + a + ".id IN (" + foundingSeatIdsSql() + "))";
}

/** The Founder's member id, or "" when that account does not exist yet. */
function rootFounderId(app) {
  const row = new DynamicModel({ id: "" });
  try {
    app
      .db()
      .newQuery(
        "SELECT id FROM members WHERE LOWER(TRIM(email)) = " + founderEmailSql() + " LIMIT 1"
      )
      .one(row);
  } catch {
    return "";
  }
  return String(row.id || "");
}

function isFoundingMember(app, member) {
  if (!app || !member) return false;
  const root = rootFounderId(app);
  if (!root) return false;
  if (member.id === root) return true;
  // Being invited by the Founder is no longer sufficient — the seat has to still
  // be there. Asked of the same ordered list the SQL predicate uses, so a member
  // can never read as founding on one surface and ordinary on another.
  if (member.getString("invited_by") !== root) return false;
  const summary = new DynamicModel({ total: 0 });
  try {
    app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM (" + foundingSeatIdsSql() + ") seats " +
          "WHERE seats.id = {:member}"
      )
      .bind({ member: member.id })
      .one(summary);
  } catch {
    return false;
  }
  return Number(summary.total || 0) > 0;
}

function invitationLimitFor(app, member) {
  return isFoundingMember(app, member) ? FOUNDING_INVITATION_LIMIT : MEMBER_INVITATION_LIMIT;
}

function requireFoundingMember(app, member, action) {
  if (!isFoundingMember(app, member)) {
    throw new ForbiddenError(
      "Founding membership is required before " + (action || "curating Detour") + "."
    );
  }
  return member;
}

/**
 * How many founding members there are — the figure behind "n of fifty", and the
 * Founder is one of them. Capped at FOUNDING_SEATS by the predicate itself rather
 * than by anything here.
 *
 * Real accounts only: internal lanes and reserved `.invalid` fixtures are never
 * counted, and never hold a seat.
 */
function countFoundingMembers(app) {
  const summary = new DynamicModel({ total: 0 });
  app
    .db()
    .newQuery(
      "SELECT COUNT(*) AS total FROM members m " +
        "WHERE " +
        foundingMemberSql("m") +
        " AND COALESCE(m.internal_member, FALSE) = FALSE " +
        "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid'"
    )
    .one(summary);
  return Number(summary.total || 0);
}

module.exports = {
  FOUNDING_INVITATION_LIMIT,
  FOUNDING_SEATS,
  MEMBER_INVITATION_LIMIT,
  countFoundingMembers,
  founderEmail,
  foundingMemberSql,
  foundingSeatIdsSql,
  invitationLimitFor,
  isFoundingMember,
  requireFoundingMember,
  rootFounderId,
  rootFounderSql,
};

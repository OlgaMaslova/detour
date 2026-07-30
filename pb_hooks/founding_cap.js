// Founding membership. Require from inside request callbacks; PocketBase
// executes handlers in isolated VMs without hook-file globals.
//
// One rule, one place: a founding member is the Founder's own account, or an
// account the Founder personally invited. Nothing is stored and nothing is
// granted — no marker written at signup, no seat counted at the door — so the
// answer is a fact about the invitation graph and can never drift from who
// actually invited whom. The `direct_founder_invited` and
// `founder_invitation_issuer` columns survive in the schema but no longer decide
// anything; members still cannot set them (see the members update guard).
//
// There is deliberately no cap. Everyone the Founder invites is founding, however
// many that becomes.
//
// The Founder's account is named by DETOUR_FOUNDER_EMAIL, defaulting to the
// address the founding-member seed migration creates. Set it in the environment
// if that address ever changes; nothing else needs to know.

// Unclaimed-invitation allowance. Founding members carry a larger one: growing
// the circle by personal invitation is the job they took on, and the landing
// page promises them this. Both allowances count *unclaimed* codes, so a slot
// returns as soon as someone redeems one — neither is a lifetime total.
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
 * SQL: this row is a founding member — the Founder, or someone the Founder
 * invited. Drop-in for a WHERE clause or a CASE WHEN.
 */
function foundingMemberSql(alias) {
  const a = alias || "m";
  return (
    "(" +
    rootFounderSql(a) +
    " OR " +
    a +
    ".invited_by = (SELECT id FROM members WHERE LOWER(TRIM(email)) = " +
    founderEmailSql() +
    ")" +
    ")"
  );
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
  return member.id === root || member.getString("invited_by") === root;
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

// Real accounts only: internal lanes and reserved .invalid fixtures are never
// counted as founding members.
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
  MEMBER_INVITATION_LIMIT,
  countFoundingMembers,
  founderEmail,
  foundingMemberSql,
  invitationLimitFor,
  isFoundingMember,
  requireFoundingMember,
  rootFounderId,
  rootFounderSql,
};

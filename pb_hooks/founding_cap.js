// Founding-membership seat cap. Require from inside request callbacks;
// PocketBase executes handlers in isolated VMs without hook-file globals.
//
// Founding membership is granted at invite redemption when the invitation's
// issuer carries founder_invitation_issuer (see the members create hook).
// The founding circle is capped: once FOUNDING_MEMBER_CAP real founding
// members are seated, a founder-issued invitation still admits the invitee —
// as a regular verified member — so a personally-sent code never fails at the
// door. Internal accounts and reserved .invalid fixtures never occupy seats.

// Fifty, not a few hundred: a founding circle small enough that a member can
// plausibly know the taste of the people in it, and small enough that
// "founding" still means early by the time the last seat is taken.
const FOUNDING_MEMBER_CAP = 50;

// Unclaimed-invitation allowance. Founding members carry a larger one: growing
// the circle by personal invitation is the job they took on, and the landing
// page promises them this. Both allowances count *unclaimed* codes, so a slot
// returns as soon as someone redeems one — neither is a lifetime total.
const FOUNDING_INVITATION_LIMIT = 50;
const MEMBER_INVITATION_LIMIT = 10;

// The founding circle for allowance purposes is the same one the public
// recommendation preview draws from: capped founding members plus the
// authorized Founder issuer, who can never have a smaller allowance than the
// members they seat.
function invitationLimitFor(member) {
  if (!member) return MEMBER_INVITATION_LIMIT;
  const founding =
    member.getBool("direct_founder_invited") ||
    member.getBool("founder_invitation_issuer");
  return founding ? FOUNDING_INVITATION_LIMIT : MEMBER_INVITATION_LIMIT;
}

function countFoundingMembers(app) {
  const summary = new DynamicModel({ total: 0 });
  app
    .db()
    .newQuery(
      "SELECT COUNT(*) AS total FROM members " +
        "WHERE COALESCE(direct_founder_invited, FALSE) = TRUE " +
        "AND COALESCE(internal_member, FALSE) = FALSE " +
        "AND LOWER(TRIM(email)) NOT LIKE '%.invalid'"
    )
    .one(summary);
  return Number(summary.total || 0);
}

module.exports = {
  FOUNDING_MEMBER_CAP,
  FOUNDING_INVITATION_LIMIT,
  MEMBER_INVITATION_LIMIT,
  countFoundingMembers,
  invitationLimitFor,
};

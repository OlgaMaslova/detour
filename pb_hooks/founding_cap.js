// Founding-membership seat cap. Require from inside request callbacks;
// PocketBase executes handlers in isolated VMs without hook-file globals.
//
// Founding membership is granted at invite redemption when the invitation's
// issuer carries founder_invitation_issuer (see the members create hook).
// The founding circle is capped: once FOUNDING_MEMBER_CAP real founding
// members are seated, a founder-issued invitation still admits the invitee —
// as a regular verified member — so a personally-sent code never fails at the
// door. Internal accounts and reserved .invalid fixtures never occupy seats.

const FOUNDING_MEMBER_CAP = 200;

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

module.exports = { FOUNDING_MEMBER_CAP, countFoundingMembers };

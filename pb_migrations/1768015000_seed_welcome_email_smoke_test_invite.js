/// <reference path="../pb_data/types.d.ts" />
//
// Seeds one identifiable, single-use invitation for the welcome-email live
// smoke test. Its code is generated only at migration runtime, never committed.
// The fixed record id makes a retry after a partial boot a no-op, and the invite
// belongs only to the reserved non-interactive curation-proof member.
migrate((app) => {
  const PROOF_MEMBER_ID = "s5cd3wrhi7cum2w";
  const SMOKE_INVITE_ID = "welcomesmoke001";

  // Production uses the durable reserved id. The email fallback keeps a full
  // fresh migration replay valid, because the original proof-member migration
  // predates that id becoming an established live fixture.
  let proofMember;
  try {
    proofMember = app.findRecordById("members", PROOF_MEMBER_ID);
  } catch {
    proofMember = app.findFirstRecordByFilter(
      "members",
      "email = {:email}",
      { email: "community-proof@detour.invalid" }
    );
  }
  if (proofMember.getString("email") !== "community-proof@detour.invalid") {
    throw new Error(
      "Cannot seed the welcome-email smoke-test invite: the reserved curation-proof member does not match."
    );
  }

  let existing = null;
  try {
    existing = app.findRecordById("invites", SMOKE_INVITE_ID);
  } catch {
    // The smoke-test invite has not been seeded yet.
  }
  if (existing) {
    if (existing.getString("issued_by") !== proofMember.id) {
      throw new Error(
        "Cannot seed the welcome-email smoke-test invite: its reserved record id is already in use."
      );
    }
    return;
  }

  const now = new Date().toISOString().replace("T", " ");
  app
    .db()
    .newQuery(
      "INSERT INTO invites " +
        "(id, issued_by, code, claimed_by, claimed_at, created, updated) " +
        "VALUES ({:id}, {:issuer}, {:code}, '', '', {:created}, {:updated})"
    )
    .bind({
      id: SMOKE_INVITE_ID,
      issuer: proofMember.id,
      code: "DTR-" + $security.randomString(20).toUpperCase(),
      created: now,
      updated: now,
    })
    .execute();
}, () => {
  // Forward-only: the invitation may have been consumed by the requested live
  // smoke test and must never be recreated or have its claim state rolled back.
  return null;
});

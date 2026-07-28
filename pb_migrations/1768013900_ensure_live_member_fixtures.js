/// <reference path="../pb_data/types.d.ts" />
//
// Later migrations depend on two member accounts that exist in production only
// because they were created through the live app: Olga's Founder account
// (required by 1768014000_seed_olga_detourist_recommendations.js) and the
// non-Founder issuer account (required by
// 1768018100_create_member_publication_rule_verification_fixture.js). A fresh
// database boot (local runs, new environments) would abort on those migrations
// because the accounts are missing.
//
// This migration guarantees both accounts exist before they are needed. In
// production every lookup succeeds, so it is a pure no-op there. Created
// accounts are not interactively usable: passwords are generated at migration
// time and never stored or exposed. The synthetic issuer uses a reserved
// .invalid email, consistent with the repo's fixture-account convention, so it
// is excluded from all public recommendation surfaces.
//
// Idempotent and retry-safe: every record is looked up (by immutable id, then
// by email) before anything is created.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");

  function ensureMember(id, email, displayName, extraFields) {
    try {
      app.findRecordById("members", id);
      return; // already present (production path)
    } catch {}
    try {
      app.findFirstRecordByFilter("members", "email = {:email}", { email });
      return; // present under a different id; dependants that fall back to
      // email lookups still find it, and a duplicate email would fail to save
    } catch {}

    const member = new Record(members);
    member.set("id", id);
    member.set("email", email);
    member.setPassword($security.randomString(48));
    member.set("verified", true);
    member.set("emailVisibility", false);
    member.set("display_name", displayName);
    member.set("community_status", "verified");
    for (const key in extraFields || {}) {
      member.set(key, extraFields[key]);
    }
    app.save(member);
  }

  // Olga's Founder account: the seed migration aborts the boot without it.
  // The pseudo and discovery visibility mirror her live account so her seeded
  // recommendations pass the public-recommendations surface filters
  // (pb_hooks/main.pb.js requires a non-empty pseudo and discovery_visible).
  ensureMember("sh86mgpuicyisau", "olga@supernaut.dev", "Olga", {
    pseudo: "Olga",
    discovery_visible: true,
  });

  // Reserved non-Founder issuer for the publication-rule verification fixture.
  // Must NOT have founder_invitation_issuer set — 1768018100 asserts that.
  ensureMember(
    "8zekkzyjrgmg9fx",
    "publication-fixture-issuer@detour.invalid",
    "Detour publication fixture issuer"
  );
}, () => {
  // Forward-only: never delete member accounts, and in production this
  // migration created nothing.
});

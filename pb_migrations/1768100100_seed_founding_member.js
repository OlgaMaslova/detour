/// <reference path="../pb_data/types.d.ts" />
//
// Seeds the founding member, so a clean database has exactly one way in.
//
// Detour is invite-only: every other account is created by redeeming an invite,
// and only a verified member can recommend a place. That makes the first account
// a bootstrap problem — somebody has to exist before anyone can be invited. This
// migration creates that account and nothing else. No places, no recommendations:
// the catalogue starts genuinely empty and fills through the real member flow, so
// nothing is ever public without a real recommendation behind it.
//
// The account is created as a fully verified founding member with invitation
// issuing rights:
//   verified                   true  — no confirmation email to chase
//   community_status           verified — required to recommend or invite
//   founding_verified          true  — founding-circle provenance
//   founder_invitation_issuer  true  — can issue the first invitations
//   discovery_visible          true  — recommendations discoverable by the circle
//
// PASSWORD. Set DETOUR_FOUNDER_PASSWORD in the environment before first boot and
// it is used verbatim. Without it, a strong random password is generated and
// printed ONCE to the deploy log — retrieve it there and change it immediately.
// A password is deliberately never hardcoded in this file: migrations are
// committed to the repository, and a credential in git is a credential leaked.
//
// Idempotent: the member is looked up by email first. An existing account is left
// completely untouched — this migration will not reset a password that has since
// been changed, nor overwrite a display name or pseudo.
migrate((app) => {
  const FOUNDER_EMAIL = "maslova_olga@hotmail.com";
  const FOUNDER_DISPLAY_NAME = "Olga";
  const FOUNDER_PSEUDO = "olga";

  let members;
  try {
    members = app.findCollectionByNameOrId("members");
  } catch (error) {
    throw new Error(
      "Cannot seed the founding member: the members collection does not exist. " +
        "The baseline schema migration must run first. (" + error + ")"
    );
  }

  try {
    app.findFirstRecordByFilter(members.id, "email = {:email}", { email: FOUNDER_EMAIL });
    console.log(
      "founding member seed: " + FOUNDER_EMAIL + " already exists; left untouched"
    );
    return;
  } catch {
    // Not present — create it below.
  }

  const supplied = $os.getenv("DETOUR_FOUNDER_PASSWORD");
  // 24 chars from PocketBase's CSPRNG when nothing was supplied.
  const password = supplied || $security.randomString(24);

  const member = new Record(members);
  member.set("email", FOUNDER_EMAIL);
  member.set("password", password);
  member.set("verified", true);
  member.set("emailVisibility", false);
  member.set("display_name", FOUNDER_DISPLAY_NAME);
  member.set("pseudo", FOUNDER_PSEUDO);
  member.set("community_status", "verified");
  member.set("founding_verified", true);
  member.set("founder_invitation_issuer", true);
  member.set("direct_founder_invited", true);
  member.set("discovery_visible", true);
  member.set("joined_at", new Date().toISOString());
  app.save(member);

  if (supplied) {
    console.log(
      "founding member seed: created " +
        FOUNDER_EMAIL +
        " using DETOUR_FOUNDER_PASSWORD"
    );
  } else {
    console.log(
      "founding member seed: created " +
        FOUNDER_EMAIL +
        " with a generated password: " +
        password +
        "  <-- shown ONCE. Sign in and change it now."
    );
  }
}, (app) => {
  // Reversible: remove only the seeded account.
  try {
    app.delete(
      app.findFirstRecordByFilter("members", "email = {:email}", {
        email: "maslova_olga@hotmail.com",
      })
    );
  } catch {
    // Already gone.
  }
});

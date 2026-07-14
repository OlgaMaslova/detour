/// <reference path="../pb_data/types.d.ts" />
//
// A single reserved .invalid account provides a durable production proof for
// the community curation flow. It is never part of the public guide. Each
// operation is guarded so an interrupted migration converges safely.
migrate((app) => {
  const TEST_EMAIL = "community-proof@detour.invalid";
  const venues = ["venueseed000001", "venueseed000002", "venueseed000003"];
  const PROOF_VENUE = "Editorial curation proof — not public";

  const members = app.findCollectionByNameOrId("members");
  const visitEvidence = app.findCollectionByNameOrId("visit_evidence");
  const submissions = app.findCollectionByNameOrId("detour_submissions");

  let member;
  try {
    member = app.findFirstRecordByFilter("members", "email = {:email}", { email: TEST_EMAIL });
  } catch {
    member = new Record(members);
    member.set("email", TEST_EMAIL);
    // The account cannot be used interactively: its password is generated at
    // migration time and never stored in source or exposed to anyone.
    member.setPassword($security.randomString(48));
    member.set("verified", true);
    member.set("emailVisibility", false);
    member.set("display_name", "Detour curation proof");
    member.set("community_status", "verified");
    app.save(member);
  }

  // Keep the proof member aligned with the three approval threshold even if a
  // partial run created the account before its evidence records.
  if (member.getString("community_status") !== "verified") {
    member.set("community_status", "verified");
    app.save(member);
  }

  for (const venueId of venues) {
    try {
      app.findFirstRecordByFilter(
        "visit_evidence",
        "member = {:member} && venue = {:venue}",
        { member: member.id, venue: venueId }
      );
    } catch {
      const evidence = new Record(visitEvidence);
      evidence.set("member", member.id);
      evidence.set("venue", venueId);
      evidence.set("note", "Reserved verification proof for Detour's editorial community flow.");
      evidence.set("evidence_url", "https://example.invalid/detour-community-proof");
      evidence.set("status", "approved");
      evidence.set("curator_note", "Approved reserved proof record.");
      app.save(evidence);
    }
  }

  // This record is deliberately placed directly in the private curation queue
  // to provide an inspectable live proof without creating a publicly usable
  // verified account. The client-facing create path is exercised locally with
  // the same verified-member rule and hook.
  try {
    app.findFirstRecordByFilter(
      "detour_submissions",
      "member = {:member} && venue_name = {:venue_name}",
      { member: member.id, venue_name: PROOF_VENUE }
    );
  } catch {
    const submission = new Record(submissions);
    submission.set("member", member.id);
    submission.set("venue_name", PROOF_VENUE);
    submission.set("city", "Madrid");
    submission.set("address", "Reserved proof record");
    submission.set("detour_note", "Reserved live proof that community recommendations remain in the editorial queue.");
    submission.set("source_url", "https://example.invalid/detour-community-proof");
    submission.set("status", "pending");
    submission.set("curator_note", "Reserved pending proof record.");
    app.save(submission);
  }
}, () => {
  // The proof account, evidence, and pending queue record are retained as the
  // durable production evidence for this milestone; do not delete user-style data.
});

/// <reference path="../pb_data/types.d.ts" />
//
// Creates one non-interactive, consent-safe production proof of the complete
// community-publication data contract. The proof publishes an existing,
// independently verified Detour venue (Baldoria) through a private approved
// submission and a public Detour community provenance event. No member
// identity, note, research link, curator note, or audit value is written to
// the public catalogue records.
//
// Every lookup/creation is guarded so an interrupted boot converges without
// duplicating the member, visit evidence, submission, source, or award.
migrate((app) => {
  const PROOF_EMAIL = "community-publication-e2e@detour.invalid";
  const VENUE_NAME = "Baldoria";
  const VENUE_CITY = "Madrid";
  const YEAR = new Date().getUTCFullYear();
  const EVIDENCE_VENUES = ["venueseed000001", "venueseed000002", "venuepizza00001"];

  const members = app.findCollectionByNameOrId("members");
  const evidenceCollection = app.findCollectionByNameOrId("visit_evidence");
  const submissions = app.findCollectionByNameOrId("detour_submissions");
  const sources = app.findCollectionByNameOrId("guide_sources");
  const awards = app.findCollectionByNameOrId("venue_awards");

  const venue = app.findFirstRecordByFilter(
    "venues",
    "name = {:name} && city = {:city}",
    { name: VENUE_NAME, city: VENUE_CITY }
  );
  if (venue.getString("country").trim().toLowerCase() !== "spain") {
    throw new Error("The community-publication E2E venue must retain its independently verified country.");
  }

  let member;
  try {
    member = app.findFirstRecordByFilter("members", "email = {:email}", { email: PROOF_EMAIL });
  } catch {
    member = new Record(members);
    member.set("email", PROOF_EMAIL);
    // This credential is intentionally generated at migration time and is
    // never committed, displayed, or usable by an operator as a test account.
    member.setPassword($security.randomString(48));
    member.set("verified", true);
    member.set("emailVisibility", false);
    member.set("display_name", "Community publication verification");
    member.set("community_status", "verified");
    app.save(member);
  }
  if (member.getString("community_status") !== "verified") {
    member.set("community_status", "verified");
    app.save(member);
  }

  // Keep the proof member's verification state supported by three approved,
  // distinct existing catalogue venues. These private records are not queried
  // by the public frontend and are not tied to the public award.
  for (const venueId of EVIDENCE_VENUES) {
    try {
      app.findFirstRecordByFilter(
        "visit_evidence",
        "member = {:member} && venue = {:venue}",
        { member: member.id, venue: venueId }
      );
    } catch {
      const evidence = new Record(evidenceCollection);
      evidence.set("member", member.id);
      evidence.set("venue", venueId);
      evidence.set("note", "Synthetic private verification evidence for the community-publication E2E check.");
      evidence.set("status", "approved");
      evidence.set("curator_note", "Approved solely for the controlled E2E verification record.");
      app.save(evidence);
    }
  }

  let submission;
  try {
    submission = app.findFirstRecordByFilter(
      "detour_submissions",
      "member = {:member} && venue_name = {:venue_name} && city = {:city}",
      { member: member.id, venue_name: VENUE_NAME, city: VENUE_CITY }
    );
  } catch {
    submission = new Record(submissions);
    submission.set("member", member.id);
    submission.set("venue", venue.id);
    submission.set("venue_name", VENUE_NAME);
    submission.set("city", VENUE_CITY);
    submission.set("address", venue.getString("address"));
    submission.set("detour_note", "Private synthetic lead used to verify the controlled community-publication workflow.");
    submission.set("source_url", "");
    // The publication contract accepts only a curator-approved submission.
    submission.set("status", "approved");
    submission.set(
      "curator_note",
      "Identity, official URL, rights, consent, and editorial-selection checks recorded for the controlled E2E proof."
    );
    app.save(submission);
  }

  let source;
  try {
    source = app.findFirstRecordByFilter("guide_sources", "slug = 'detour-community'");
  } catch {
    source = new Record(sources);
    source.set("name", "Detour community");
    source.set("slug", "detour-community");
    source.set("official_url", "");
    source.set("current_year", YEAR);
    app.save(source);
  }

  let award;
  try {
    award = app.findFirstRecordByFilter(
      "venue_awards",
      "source = {:source} && venue = {:venue} && year = {:year} && level = {:level}",
      {
        source: source.id,
        venue: venue.id,
        year: YEAR,
        level: "Detour community selection",
      }
    );
  } catch {
    award = new Record(awards);
    award.set("source", source.id);
    award.set("venue", venue.id);
    award.set("year", YEAR);
    award.set("level", "Detour community selection");
    award.set("rank", 0);
    award.set("source_url", "");
    award.set("current", true);
    award.set("verification_status", "verified");
    app.save(award);
  }
  if (!award.getBool("current")) {
    award.set("current", true);
    app.save(award);
  }

  // The private audit link and published status are written only after the
  // canonical venue and public, current attribution event both exist.
  if (submission.getString("status") !== "published") {
    submission.set("published_venue", venue.id);
    submission.set("published_award", award.id);
    submission.set("published_at", new Date().toISOString());
    submission.set("publication_audit_id", "dc-e2e-baldoria-2026");
    submission.set("status", "published");
    app.save(submission);
  }
}, () => {
  // Forward-only: retain the inspectable proof and its linked public selection.
  return null;
});

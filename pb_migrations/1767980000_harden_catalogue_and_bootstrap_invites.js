/// <reference path="../pb_data/types.d.ts" />
//
// Public catalogue hardening and the one-time community bootstrap cohort.
// This migration is deliberately forward-only and converges safely if a boot
// stops midway: schema changes are guarded, the backfill is repeatable, and
// invite creation stops once the reserved issuer has three open invitations.
migrate((app) => {
  const venues = app.findCollectionByNameOrId("venues");
  const awards = app.findCollectionByNameOrId("venue_awards");

  // Detailed source and coordinate research remains stored for editorial use,
  // but must not be returned by the public catalogue API.
  const coordNote = venues.fields.getByName("coord_verification_note");
  if (coordNote) coordNote.hidden = true;
  const awardNote = awards.fields.getByName("verification_note");
  if (awardNote) awardNote.hidden = true;

  if (!venues.fields.getByName("approx_location")) {
    venues.fields.add(new BoolField({ name: "approx_location" }));
  }
  app.save(venues);
  app.save(awards);

  // Preserve the only client-relevant location qualifier as a public boolean.
  // Unknown 0/0 locations remain unpinned; only genuinely approximate mapped
  // locations receive this flag.
  app
    .db()
    .newQuery(
      "UPDATE venues SET approx_location = CASE " +
        "WHEN lower(COALESCE(coord_verification_note, '')) LIKE '%approx%' " +
        "OR lower(COALESCE(coord_verification_note, '')) LIKE '%street-level%' " +
        "THEN TRUE ELSE FALSE END"
    )
    .execute();

  // The reserved proof account is the non-interactive issuer for Detour's
  // opening cohort. Codes are random at migration time and never committed.
  const proofMember = app.findFirstRecordByFilter(
    "members",
    "email = {:email}",
    { email: "community-proof@detour.invalid" }
  );
  const invites = app.findCollectionByNameOrId("invites");
  const openBootstrapInvites = app.findRecordsByFilter(
    "invites",
    "issued_by = {:issuer} && claimed_by = ''",
    "",
    3,
    0,
    { issuer: proofMember.id }
  );

  // On a partial retry this creates only the missing portion of the initial
  // three. The migration runs once after it succeeds, so redeemed invitations
  // are never silently replenished.
  for (let i = openBootstrapInvites.length; i < 3; i += 1) {
    const invite = new Record(invites);
    invite.set("issued_by", proofMember.id);
    invite.set("code", "DTR-" + $security.randomString(20).toUpperCase());
    invite.set("claimed_by", "");
    invite.set("claimed_at", "");
    app.save(invite);
  }
}, () => {
  // Forward-only: invitation and editorial provenance data are retained.
  return null;
});

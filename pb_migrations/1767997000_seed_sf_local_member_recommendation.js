/// <reference path="../pb_data/types.d.ts" />
//
// Seeds one public, curator-approved San Francisco member recommendation for
// the occasion-led discovery view. The contributor is the retained,
// non-interactive publication-proof member: its fixed .invalid identity and
// trust state are verified here but never created or elevated by this seed.
//
// The fixed record id is this seed's unique source marker. A retry accepts only
// the exact approved seed record, never changes an in-review contribution, and
// never writes to the canonical venue, award, editorial, or guide collections.
migrate((app) => {
  const SEED_ID = "sfmemberseed001";
  const MEMBER_EMAIL = "community-publication-e2e@detour.invalid";
  const NOW = "2026-07-20 00:00:00.000Z";
  const expected = {
    source: "member_recommended",
    placeName: "Anchor Oyster Bar",
    city: "San Francisco",
    country: "United States",
    address: "579 Castro St., San Francisco, CA 94114",
    category: "restaurant",
    occasions: [
      "casual_local_favorite",
      "neighborhood_meal",
      "solo_friendly",
    ],
    recommendationNote:
      "A longtime Castro standby for oysters and chowder, especially good for a relaxed neighborhood meal.",
    normalizedName: "anchor oyster bar",
    normalizedCity: "san francisco",
    status: "approved",
  };

  let member;
  try {
    member = app.findFirstRecordByFilter("members", "email = {:email}", {
      email: MEMBER_EMAIL,
    });
  } catch {
    throw new Error(
      "Cannot seed the SF local-member recommendation: the retained trusted member is missing."
    );
  }
  if (
    member.getString("community_status") !== "verified" ||
    !member.getBool("verified") ||
    !member.getBool("founding_verified")
  ) {
    throw new Error(
      "Cannot seed the SF local-member recommendation: the retained member is not trusted and verified."
    );
  }

  let existingSeed = null;
  try {
    existingSeed = app.findRecordById("member_place_contributions", SEED_ID);
  } catch {
    // This seed marker has not been written yet.
  }
  if (existingSeed) {
    const sameOccasions =
      JSON.stringify(existingSeed.getStringSlice("occasions")) ===
      JSON.stringify(expected.occasions);
    if (
      existingSeed.getString("member") !== member.id ||
      existingSeed.getString("source") !== expected.source ||
      existingSeed.getString("place_name") !== expected.placeName ||
      existingSeed.getString("city") !== expected.city ||
      existingSeed.getString("country") !== expected.country ||
      existingSeed.getString("address") !== expected.address ||
      existingSeed.getString("category") !== expected.category ||
      !sameOccasions ||
      existingSeed.getString("recommendation_note") !== expected.recommendationNote ||
      existingSeed.getString("normalized_name") !== expected.normalizedName ||
      existingSeed.getString("normalized_city") !== expected.normalizedCity ||
      existingSeed.getString("status") !== expected.status
    ) {
      throw new Error(
        "Cannot seed the SF local-member recommendation: its unique seed marker is already in use."
      );
    }
    return null;
  }

  let openDuplicate = null;
  try {
    openDuplicate = app.findFirstRecordByFilter(
      "member_place_contributions",
      "normalized_name = {:name} && normalized_city = {:city} && (status = 'in_review' || status = 'approved')",
      { name: expected.normalizedName, city: expected.normalizedCity }
    );
  } catch {
    // No submitted contribution currently owns this normalized place identity.
  }
  if (openDuplicate) {
    throw new Error(
      "Cannot seed the SF local-member recommendation without changing an existing open contribution."
    );
  }

  app
    .db()
    .newQuery(
      "INSERT INTO member_place_contributions " +
        "(id, member, source, place_name, city, country, address, category, occasions, " +
        "recommendation_note, normalized_name, normalized_city, status, curator_note, " +
        "reviewed_at, created, updated) VALUES " +
        "({:id}, {:member}, {:source}, {:placeName}, {:city}, {:country}, {:address}, " +
        "{:category}, {:occasions}, {:recommendationNote}, {:normalizedName}, " +
        "{:normalizedCity}, {:status}, '', {:reviewedAt}, {:created}, {:updated})"
    )
    .bind({
      id: SEED_ID,
      member: member.id,
      source: expected.source,
      placeName: expected.placeName,
      city: expected.city,
      country: expected.country,
      address: expected.address,
      category: expected.category,
      occasions: JSON.stringify(expected.occasions),
      recommendationNote: expected.recommendationNote,
      normalizedName: expected.normalizedName,
      normalizedCity: expected.normalizedCity,
      status: expected.status,
      reviewedAt: NOW,
      created: NOW,
      updated: NOW,
    })
    .execute();
}, () => {
  // Forward-only: retain the approved recommendation and its moderation audit.
  return null;
});

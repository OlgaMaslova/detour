/// <reference path="../pb_data/types.d.ts" />
//
// Removes only the exact founding-feedback response created by the live
// activity-alert verification. Re-running is a no-op after it is gone.
migrate((app) => {
  try {
    app.findCollectionByNameOrId("founding_feedback_responses");
  } catch {
    return null;
  }

  app
    .db()
    .newQuery(
      "DELETE FROM founding_feedback_responses " +
        "WHERE source = {:source} " +
        "AND discovery_source = {:discoverySource} " +
        "AND circle_interest = {:circleInterest} " +
        "AND value_needed = {:valueNeeded}"
    )
    .bind({
      source: "public_survey",
      discoverySource: "friends",
      circleInterest: "yes",
      valueNeeded:
        "I would share a personal recommendation when it helps people I trust find a thoughtful place for a memorable meal.",
    })
    .execute();

  return null;
}, () => {
  // Forward-only: deleted verification feedback must never be recreated.
  return null;
});

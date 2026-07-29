/// <reference path="../pb_data/types.d.ts" />
//
// Drops `venues.market`. Detour routes by city only.
//
// Migration 1767998000 added `market` so venues in Oakland, Alameda, and the
// Peninsula could appear under one browsable `san-francisco` route while
// keeping their own localities for display. Those venues were Detour editorial
// local picks, and 1768019000/1768019200 removed every place without a real
// member recommendation — so the mechanism lost its only users and no venue
// has had a market differing from its city since.
//
// Behaviour-preserving: at the time of writing the only rows with a non-empty
// market are the three San Francisco venues, where market equals city, so the
// route each place resolves to and every place-page slug are unchanged.
migrate(
  (app) => {
    let venues;
    try {
      venues = app.findCollectionByNameOrId("venues");
    } catch {
      return;
    }

    // Guard against dropping a column that is still grouping venues across
    // cities: that would silently move places to a different route.
    const straddling = new DynamicModel({ total: 0 });
    app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM venues " +
          "WHERE COALESCE(market, '') != '' AND market != city"
      )
      .one(straddling);
    if (Number(straddling.total || 0) > 0) {
      throw new Error(
        "Cannot drop venues.market: " + straddling.total +
          " venue(s) still use a market that differs from their city. " +
          "Reassign those places to their own city routes first."
      );
    }

    if (venues.fields.getByName("market")) {
      venues.fields.removeByName("market");
      app.save(venues);
    }
  },
  (app) => {
    // Recreates the column, empty. The old values were all equal to `city`, so
    // nothing meaningful is lost; 1767998000 holds the original intent.
    let venues;
    try {
      venues = app.findCollectionByNameOrId("venues");
    } catch {
      return;
    }
    if (!venues.fields.getByName("market")) {
      venues.fields.add(new TextField({ name: "market", required: false, max: 120 }));
      return app.save(venues);
    }
  }
);

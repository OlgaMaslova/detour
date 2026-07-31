// Shared daily launch-number rollup. Require this module inside cron/migration
// callbacks because PocketBase executes hook callbacks in isolated JS VMs.

function utcSqlTimestamp(date) {
  return date.toISOString().replace("T", " ");
}

function collectLaunchNumbers(app) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const periodStartSql = utcSqlTimestamp(periodStart);
  const periodEndSql = utcSqlTimestamp(periodEnd);
  const metrics = new DynamicModel({
    new_members_24h: 0,
    total_members: 0,
    new_invite_requests_24h: 0,
    total_invite_requests: 0,
    new_recommendations_24h: 0,
    total_recommendations: 0,
    new_published_places_24h: 0,
    total_published_places: 0,
    new_contributors_24h: 0,
    total_contributors: 0,
  });

  // A real member is neither explicitly internal nor on the reserved .invalid
  // fixture domain. Published-place counts use distinct venue ids and require a
  // recommendation from such a member, so repeated recommendations never
  // double-count the same place and synthetic publications never qualify.
  //
  // Contributors are real members with at least one recommendation, counted
  // against total_members. That ratio is the claim Detour rests on — places are
  // here because members put their name behind them — so a period where members
  // arrive and the contributor count does not move is the signal to act on.
  // A "new contributor" is a member whose *first* recommendation lands in the
  // period, so someone adding a second place is never counted twice.
  app
    .db()
    .newQuery(
      "WITH real_members AS (" +
        "SELECT id FROM members " +
        "WHERE COALESCE(internal_member, FALSE) = FALSE " +
        "AND LOWER(TRIM(email)) NOT LIKE '%.invalid'" +
        "), real_recommendations AS (" +
        "SELECT r.id, r.member, r.waitlist, r.created " +
        "FROM community_recommendations r " +
        "JOIN real_members m ON m.id = r.member" +
        "), first_recommendations AS (" +
        "SELECT member, MIN(created) AS first_created " +
        "FROM real_recommendations GROUP BY member" +
        "), real_published_places AS (" +
        "SELECT DISTINCT w.published_venue AS venue_id, w.published_at " +
        "FROM community_waitlist_entries w " +
        "WHERE w.status = 'published' " +
        "AND w.published_venue != '' " +
        "AND EXISTS (" +
        "SELECT 1 FROM real_recommendations r WHERE r.waitlist = w.id" +
        ")" +
        ") " +
        "SELECT " +
        "(SELECT COUNT(*) FROM members m " +
        " WHERE COALESCE(m.internal_member, FALSE) = FALSE " +
        " AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
        " AND m.joined_at >= {:periodStart} AND m.joined_at < {:periodEnd}) AS new_members_24h, " +
        "(SELECT COUNT(*) FROM real_members) AS total_members, " +
        "(SELECT COUNT(*) FROM invite_requests i " +
        " WHERE LOWER(TRIM(i.email)) NOT LIKE '%.invalid' " +
        " AND i.created >= {:periodStart} AND i.created < {:periodEnd}) AS new_invite_requests_24h, " +
        "(SELECT COUNT(*) FROM invite_requests i " +
        " WHERE LOWER(TRIM(i.email)) NOT LIKE '%.invalid') AS total_invite_requests, " +
        "(SELECT COUNT(*) FROM real_recommendations r " +
        " WHERE r.created >= {:periodStart} AND r.created < {:periodEnd}) AS new_recommendations_24h, " +
        "(SELECT COUNT(*) FROM real_recommendations) AS total_recommendations, " +
        "(SELECT COUNT(DISTINCT venue_id) FROM real_published_places p " +
        " WHERE p.published_at >= {:periodStart} AND p.published_at < {:periodEnd}) AS new_published_places_24h, " +
        "(SELECT COUNT(DISTINCT venue_id) FROM real_published_places) AS total_published_places, " +
        "(SELECT COUNT(*) FROM first_recommendations f " +
        " WHERE f.first_created >= {:periodStart} AND f.first_created < {:periodEnd}) AS new_contributors_24h, " +
        "(SELECT COUNT(*) FROM first_recommendations) AS total_contributors"
    )
    .bind({ periodStart: periodStartSql, periodEnd: periodEndSql })
    .one(metrics);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    newMembers24h: Number(metrics.new_members_24h || 0),
    totalMembers: Number(metrics.total_members || 0),
    newInviteRequests24h: Number(metrics.new_invite_requests_24h || 0),
    totalInviteRequests: Number(metrics.total_invite_requests || 0),
    newRecommendations24h: Number(metrics.new_recommendations_24h || 0),
    totalRecommendations: Number(metrics.total_recommendations || 0),
    newPublishedPlaces24h: Number(metrics.new_published_places_24h || 0),
    totalPublishedPlaces: Number(metrics.total_published_places || 0),
    newContributors24h: Number(metrics.new_contributors_24h || 0),
    totalContributors: Number(metrics.total_contributors || 0),
  };
}

function hasPeriodActivity(metrics) {
  return (
    metrics.newMembers24h > 0 ||
    metrics.newInviteRequests24h > 0 ||
    metrics.newRecommendations24h > 0 ||
    metrics.newPublishedPlaces24h > 0
  );
}

function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

function formatLaunchNumbers(metrics) {
  return (
    "Last 24h: " +
    metrics.newMembers24h +
    " new " +
    plural(metrics.newMembers24h, "member", "members") +
    " (" +
    metrics.totalMembers +
    " total), " +
    metrics.newInviteRequests24h +
    " new invite " +
    plural(metrics.newInviteRequests24h, "request", "requests") +
    " (" +
    metrics.totalInviteRequests +
    " total), " +
    metrics.newRecommendations24h +
    " new " +
    plural(metrics.newRecommendations24h, "recommendation", "recommendations") +
    " (" +
    metrics.totalRecommendations +
    " total), and " +
    metrics.newPublishedPlaces24h +
    " " +
    plural(metrics.newPublishedPlaces24h, "place", "places") +
    " newly published (" +
    metrics.totalPublishedPlaces +
    " total). " +
    // Reported as a count against its denominator, never a percentage: at this
    // size a rate would swing on one person and read as precision we do not
    // have.
    metrics.totalContributors +
    " of " +
    metrics.totalMembers +
    " " +
    plural(metrics.totalMembers, "member", "members") +
    " " +
    plural(metrics.totalContributors, "has", "have") +
    " contributed" +
    (metrics.newContributors24h > 0
      ? ", including " +
        metrics.newContributors24h +
        " for the first time in the last 24h."
      : ".")
  );
}

function logFailure(app, error) {
  try {
    app.logger().error(
      "Detour launch-number rollup failed.",
      "error",
      String(error)
    );
  } catch {
    try {
      console.log("Detour launch-number rollup failed: " + error);
    } catch {
      // Reporting must never turn a best-effort rollup into a failed callback.
    }
  }
}

function emitLaunchNumbers(app) {
  let metrics;
  try {
    metrics = collectLaunchNumbers(app);
    if (!hasPeriodActivity(metrics)) {
      return { sent: false, reason: "no_period_activity", metrics: metrics };
    }

    require(__hooks + "/mailer.js").notifyOps(app, {
      subject: "Detour launch numbers — last 24h",
      text: formatLaunchNumbers(metrics),
    });

    return { sent: true, metrics: metrics };
  } catch (error) {
    logFailure(app, error);
    return { sent: false, reason: "failed", metrics: metrics || null };
  }
}

module.exports = {
  collectLaunchNumbers,
  emitLaunchNumbers,
  formatLaunchNumbers,
  hasPeriodActivity,
};

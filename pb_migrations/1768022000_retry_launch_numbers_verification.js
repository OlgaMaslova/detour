/// <reference path="../pb_data/types.d.ts" />
//
// Retry the one-off daily launch-number verification after members.joined_at is
// available. The previously applied verification migration cannot run again.
// This invokes the exact cron helper, creates no test data, and posts only when
// the preceding 24 hours contain qualifying non-fixture activity.
migrate((app) => {
  const launchMetrics = require(__hooks + "/launch_metrics.js");
  launchMetrics.emitLaunchNumbers(app);
}, () => {
  // Forward-only: an external verification attempt cannot be rolled back.
  return null;
});

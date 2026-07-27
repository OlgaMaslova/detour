/// <reference path="../pb_data/types.d.ts" />
//
// One-off deploy verification for the daily launch-number path. It invokes the
// exact shared helper used by the committed cron, so fixture exclusions,
// 24-hour bounds, zero-activity suppression, payload formatting, and delivery
// behavior cannot drift. The helper logs and absorbs delivery failures; this
// best-effort verification must never block startup or invent test data.
migrate((app) => {
  const launchMetrics = require(__hooks + "/launch_metrics.js");
  launchMetrics.emitLaunchNumbers(app);
}, () => {
  // Forward-only: an external verification attempt cannot be rolled back.
  return null;
});

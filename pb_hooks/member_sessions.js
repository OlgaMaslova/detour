// When a member comes back. Require from inside request callbacks; PocketBase
// executes handlers in isolated VMs without hook-file globals.
//
// A SESSION IS NOT A PAGE LOAD. The client asks /api/detour/community/me once per
// document load — that is where the member's standing comes from, on every
// surface — so counting those calls would count reloads and new tabs as returns.
// A visit stays open while the member is active and closes only after
// SESSION_GAP_MS of silence, which is what makes the count mean "came back".
// Anything keyed to it, a rotating prompt most obviously, would otherwise advance
// while the member sat still.
//
// The stored timestamps never leave the server: they are hidden fields (see the
// member_sessions migration) and callers are handed a count and a whole-day gap.

const SESSION_GAP_MS = 30 * 60 * 1000;
// Within a session the sighting is refreshed, but not on every page load: the
// member record does not need a write each time somebody opens a place.
const SESSION_TOUCH_MS = 5 * 60 * 1000;

function parseStamp(raw) {
  // PocketBase stores "2026-08-01 15:01:49.903Z"; the space is not a format
  // JavaScript is required to parse, so it is made into one.
  return raw ? new Date(String(raw).replace(" ", "T")).getTime() : 0;
}

/**
 * Record that this member is here, and report what their attendance says.
 *
 * Best-effort by contract: /me is what decides whether the masthead offers
 * Curation, so a failed write leaves the member their menu and reports zeroes
 * rather than failing the request.
 */
function touchMemberSession(app, auth) {
  try {
    const record = app.findRecordById("members", auth.id);
    const now = Date.now();
    const lastRaw = record.getString("last_seen_at");
    const lastSeen = parseStamp(lastRaw);
    const newSession = !lastSeen || now - lastSeen > SESSION_GAP_MS;
    const visits = record.getInt("visit_count");
    const stamp = new Date(now).toISOString();

    if (newSession) {
      // The visit that just ended becomes the one the next gap is measured from.
      if (lastSeen) record.set("previous_seen_at", lastRaw);
      record.set("visit_count", visits + 1);
      record.set("last_seen_at", stamp);
      app.save(record);
    } else if (now - lastSeen > SESSION_TOUCH_MS) {
      record.set("last_seen_at", stamp);
      app.save(record);
    }

    // Measured from the end of the previous visit — the sighting this session
    // displaced — so it reads as "away for eleven days" rather than "away since
    // the first time we ever saw them". Unknown on a first visit.
    const priorRaw = newSession && lastSeen ? lastRaw : record.getString("previous_seen_at");
    const prior = parseStamp(priorRaw);
    return {
      visit_count: newSession ? visits + 1 : visits,
      days_away: prior ? Math.floor((now - prior) / 86400000) : null,
      new_session: newSession,
    };
  } catch (error) {
    app.logger().warn("Member session ping failed.", "member", auth.id, "error", String(error));
    return { visit_count: 0, days_away: null, new_session: false };
  }
}

module.exports = {
  SESSION_GAP_MS,
  SESSION_TOUCH_MS,
  touchMemberSession,
};

/// <reference path="../pb_data/types.d.ts" />
//
// When a member comes back.
//
// Detour had no idea. The only thing resembling a session was a module-level
// `let` in the client, which lives and dies with the document — so "this member
// returned after a fortnight" was not a fact the app could act on, or even read.
// Three fields make it one, on the member rather than in a browser: it follows
// the account across devices and survives cleared storage.
//
// A session is not a page load. Reloading, opening a place in a new tab, or
// coming back from a link ten minutes later is the same visit, so
// `/api/detour/community/me` only opens a new one when the gap since the last
// sighting exceeds an idle window (see MEMBER_SESSION_GAP_MS in main.pb.js).
// Without that, a member who reloads twice looks like a member who came back
// twice, and anything keyed to the count — a rotating prompt, most obviously —
// would advance while they sat still.
//
// Hidden, all three: this is bookkeeping about attendance, not a fact about the
// member, and `members` is readable by the member it belongs to. The client is
// told a computed count and a day gap by the route; it never reads the
// timestamps themselves. Same treatment, and for the same reason, as
// `inviter_introduced_at`.
//
// Not backfilled on purpose. An existing member's history is unknown — they may
// have visited daily for months — and inventing a count would put a number
// behind decisions that deserve a real one. `visit_count` therefore means
// "sessions since Detour started counting", and every member starts at zero.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    let changed = false;

    // The current visit. Extended while a member is active, so the gap that
    // opens the next session is measured from their last sighting rather than
    // from whenever the visit happened to start.
    if (!members.fields.getByName("last_seen_at")) {
      members.fields.add(
        new DateField({
          name: "last_seen_at",
          required: false,
          hidden: true,
        })
      );
      changed = true;
    }

    // The end of the visit before this one. Kept so a gap stays readable after
    // the fact — "who came back after a month away" is a question worth being
    // able to ask of the record, not only at the moment the route computes it.
    if (!members.fields.getByName("previous_seen_at")) {
      members.fields.add(
        new DateField({
          name: "previous_seen_at",
          required: false,
          hidden: true,
        })
      );
      changed = true;
    }

    if (!members.fields.getByName("visit_count")) {
      members.fields.add(
        new NumberField({
          name: "visit_count",
          required: false,
          onlyInt: true,
          min: 0,
          hidden: true,
        })
      );
      changed = true;
    }

    if (changed) app.save(members);
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    let changed = false;
    ["last_seen_at", "previous_seen_at", "visit_count"].forEach((name) => {
      const field = members.fields.getByName(name);
      if (field) {
        members.fields.removeById(field.id);
        changed = true;
      }
    });
    if (changed) app.save(members);
  }
);

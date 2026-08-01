/// <reference path="../pb_data/types.d.ts" />
//
// The ladder behind the contribution prompt.
//
// A member who has come back but has never added a place is asked about it, and
// asked differently each time: once on their next visit, then not for a week,
// then not for a fortnight. That escalation needs two things the session fields
// cannot supply — which rung they are on, and when that rung was shown.
//
// WHY NOT DERIVE IT FROM visit_count. The gaps are wall-clock, measured from the
// last time the member was actually asked, not from their last visit. A member
// who comes back daily and one who comes back monthly reach the same rung on the
// same schedule; only the asking is paced. Counting sessions would pace it by how
// often they show up, which is precisely backwards — the more loyal member would
// be nagged the hardest.
//
// WHY IT IS STORED AND NOT COMPUTED. There is nowhere else for it: nothing else
// records that a member was shown something. And it belongs on the account rather
// than in a browser, so the ladder does not restart when they open Detour on
// their phone.
//
// Hidden, both, and never sent: the route hands the client a rung number and the
// copy tokens for it. See pb_hooks/place_prompts.js for the gating, and the
// member_sessions migration for the visit fields it reads.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    let changed = false;

    // How many prompts this member has been shown; also which rung's wording
    // they are due next. Zero means never asked.
    if (!members.fields.getByName("place_prompt_step")) {
      members.fields.add(
        new NumberField({
          name: "place_prompt_step",
          required: false,
          onlyInt: true,
          min: 0,
          hidden: true,
        })
      );
      changed = true;
    }

    // When the current rung was shown. Both gates read this: the wall-clock gap
    // before the next rung is due, and whether a prompt is already live for the
    // visit in progress — so it cannot change under a member between page loads.
    if (!members.fields.getByName("place_prompt_shown_at")) {
      members.fields.add(
        new DateField({
          name: "place_prompt_shown_at",
          required: false,
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
    ["place_prompt_step", "place_prompt_shown_at"].forEach((name) => {
      const field = members.fields.getByName(name);
      if (field) {
        members.fields.removeById(field.id);
        changed = true;
      }
    });
    if (changed) app.save(members);
  }
);

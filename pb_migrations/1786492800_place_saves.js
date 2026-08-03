/// <reference path="../pb_data/types.d.ts" />
//
// Wanna go: the private rung. Somewhere a member means to get to, seen by
// nobody else, ever.
//
// See docs/wanna-go-spec.md. Two jobs, and only one of them is for the member:
// their own list of places they mean to reach, and a hook for a later question —
// *you saved this three weeks ago, been yet?* — which arrives at the one moment
// they have something to say. On its own, saving does nothing for anybody else,
// and that is the design rather than a shortfall.
//
// WHY THE COLLECTION IS CALLED save. `saved` is stable and boring; "Wanna go" is
// deliberately the most casual phrase in the product and is the most likely of
// the three rungs to be re-worded. The schema should not move when it is.
//
// WHY IT HANGS OFF THE WAITING-LIST ENTRY. Same reason as an endorsement and a
// recommendation: the entry is what carries publication state, and a mark on the
// venue would be a mark on a catalogue row that can exist before anybody stood
// behind it.
//
// FULLY PRIVATE MEANS FULLY PRIVATE, and it is this file that has to hold the
// line. There is no read path for anybody but the row's own member — no
// projection, no count, no notification to the recommender — and the test to
// apply to any future change is: could a member learn anything at all about
// another member's saves, including that they exist? A visible tally would be a
// popularity ranking, which is the thing this product exists in opposition to.
migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const waitlist = app.findCollectionByNameOrId("community_waitlist_entries");

    let saves;
    try {
      saves = app.findCollectionByNameOrId("community_place_saves");
    } catch {
      saves = new Collection({
        name: "community_place_saves",
        type: "base",
      });
    }

    const fields = [
      // Cascade on both sides, as with endorsements: a departed member takes
      // their intentions with them, and an entry that is deleted cannot leave an
      // intention to visit nothing behind.
      new RelationField({
        name: "member",
        collectionId: members.id,
        maxSelect: 1,
        required: true,
        cascadeDelete: true,
      }),
      new RelationField({
        name: "waitlist",
        collectionId: waitlist.id,
        maxSelect: 1,
        required: true,
        cascadeDelete: true,
      }),
      // Which surface actually produced the intention. Feeds the follow-up's
      // wording and tells us where saving is worth offering at all — `share` in
      // particular is the only way a private share becomes a save, because a
      // share is somebody else's intention for the member and filing it
      // automatically would put words in their mouth.
      //
      // Not required: an older row, or a surface added later that forgets to say,
      // is a save with unknown provenance rather than a failed write.
      new SelectField({
        name: "source",
        values: ["place_page", "triage", "share", "feed"],
        maxSelect: 1,
        required: false,
      }),
      // When "been yet?" was last asked about this one, so it is not asked twice
      // in a week. NOTHING READS THIS YET: the follow-up prompt is specified but
      // not built, and the field is here because it belongs to the shape of a
      // save rather than to the surface that will eventually use it. Whoever
      // builds the prompt will also need a decline count — "twice declined and it
      // stops being asked about" cannot be read off a date, which says when but
      // not how often — and that field is deliberately left for them rather than
      // shipped unread alongside this one.
      new DateField({
        name: "prompted_at",
        required: false,
        hidden: true,
      }),
      new AutodateField({
        name: "created",
        onCreate: true,
        onUpdate: false,
      }),
    ];

    for (const field of fields) {
      if (!saves.fields.getByName(field.name)) {
        saves.fields.add(field);
      }
    }

    // A member may list and remove their own saves and nothing else. Creation and
    // update go through the routes, which is where "not your own place",
    // "published only" and "verified members only" live — an open create rule
    // would make every rule in the spec advisory, and an open update rule would
    // let a member reset the follow-up's own gates.
    //
    // There is no list rule that would let anybody read anybody else's rows, and
    // there is no server projection either. That is the difference between this
    // collection and community_place_endorsements: an endorsement is scoped-public
    // and needs a projection, a save is private and must never acquire one.
    saves.listRule = "@request.auth.id != '' && member = @request.auth.id";
    saves.viewRule = "@request.auth.id != '' && member = @request.auth.id";
    saves.createRule = null;
    saves.updateRule = null;
    saves.deleteRule = "@request.auth.id != '' && member = @request.auth.id";
    // Save once before the indexes so PocketBase initialises the base
    // collection's system columns first.
    app.save(saves);

    // One save per member per place. The toggle looks the row up first and turns
    // an ordinary double tap into the removal branch; this index is what makes a
    // racing double tap safe.
    const uniqueIndex =
      "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_place_saves_member_place` " +
      "ON `community_place_saves` (member, waitlist)";
    // The tab, newest first, and the follow-up's own work-list — both are always
    // scoped to one member, so one index serves both.
    const memberIndex =
      "CREATE INDEX IF NOT EXISTS `idx_community_place_saves_member_created` " +
      "ON `community_place_saves` (member, created)";
    // DELIBERATELY NO INDEX ON `waitlist` ALONE. Nothing should ever be counting
    // saves per place, and not building the index that would make it cheap is a
    // small structural discouragement to the first person who tries.
    let indexesChanged = false;
    for (const index of [uniqueIndex, memberIndex]) {
      if (saves.indexes.indexOf(index) === -1) {
        saves.indexes.push(index);
        indexesChanged = true;
      }
    }
    if (indexesChanged) app.save(saves);
  },
  (app) => {
    try {
      const saves = app.findCollectionByNameOrId("community_place_saves");
      app.delete(saves);
    } catch {
      // A partial or repeated rollback is already at the desired state.
    }
  }
);

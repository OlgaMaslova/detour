/// <reference path="../pb_data/types.d.ts" />
//
// Been & loved: the one-tap rung below writing a note.
//
// A member who went somewhere on another member's recommendation, and would
// send you there too, presses one button. Two claims, both stated: they were
// there, and they stand behind it. See docs/been-and-loved-spec.md for why both
// halves are needed — "been" alone takes no position, and silence is Detour's
// only disagreement mechanism, so a marker that means merely "I went" makes the
// absence of one unreadable.
//
// WHY THE COLLECTION IS CALLED endorsement. The member-facing phrase is copy and
// will be revised; the schema should not have to move with it. `endorsement` is
// neutral and accurate, and `second` is already spoken for in the code paths
// that resolve a place collision (`place_intent: "second"`).
//
// WHY IT HANGS OFF THE WAITING-LIST ENTRY. That is what a recommendation
// attaches to, and the entry is the thing that carries publication state. A mark
// on the venue would be a mark on a catalogue row that can exist before anybody
// stood behind it.
//
// WHAT IT MUST NEVER DO. It never publishes a place, never contributes to
// `signal_count`, and never changes who can see anything — it is corroboration
// of a place that is already there. Reads for anybody other than the row's own
// member go through a server projection (see pb_hooks/place_endorsements.js),
// never a client-side list: a collection a member could query directly would let
// them enumerate who has been where, which is the invitation graph by another
// route.
migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const waitlist = app.findCollectionByNameOrId("community_waitlist_entries");
    const recommendations = app.findCollectionByNameOrId(
      "community_recommendations"
    );

    let endorsements;
    try {
      endorsements = app.findCollectionByNameOrId(
        "community_place_endorsements"
      );
    } catch {
      endorsements = new Collection({
        name: "community_place_endorsements",
        type: "base",
      });
    }

    const fields = [
      // Cascade on both sides: a departed member takes their marks with them,
      // and an entry that is deleted cannot leave corroboration of nothing
      // behind. Neither deletion is a product event anybody is notified about.
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
      // The note this member went on — the fronting one at the time they
      // pressed. Provenance, and the address of the person the notice goes to.
      //
      // Deliberately NOT cascadeDelete and deliberately not required. A mark is
      // a mark on the place; if the note it went on is later withdrawn the mark
      // still stands, and PocketBase unsets a non-cascading relation when its
      // target goes, which leaves exactly that: the endorsement, without the
      // provenance. A place whose visible notes have all been withdrawn can also
      // be marked with nothing to point at.
      new RelationField({
        name: "recommendation",
        collectionId: recommendations.id,
        maxSelect: 1,
        required: false,
        cascadeDelete: false,
      }),
      // Claimed before the notice is sent, never after — a delivery failure
      // after the claim is a lost email rather than a repeated one, which is the
      // correct way round. Withdrawing and re-marking creates a new row, so this
      // is per-row rather than per-pair; the sweep's own guard is what stops a
      // withdraw/re-mark loop from mailing the recommender repeatedly.
      new DateField({
        name: "notified_at",
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
      if (!endorsements.fields.getByName(field.name)) {
        endorsements.fields.add(field);
      }
    }

    // A member may read and withdraw their own marks and nothing else. Creation
    // goes through the toggle route, which is where the "not your own place",
    // "published only", and "verified members only" rules live; nobody may list
    // anybody else's rows, at all, ever — see the header note.
    endorsements.listRule = "@request.auth.id != '' && member = @request.auth.id";
    endorsements.viewRule = "@request.auth.id != '' && member = @request.auth.id";
    endorsements.createRule = null;
    endorsements.updateRule = null;
    endorsements.deleteRule = "@request.auth.id != '' && member = @request.auth.id";
    // Save once before the indexes so PocketBase initialises the base
    // collection's system columns first.
    app.save(endorsements);

    // One mark per member per place. The toggle route looks the row up and turns
    // an ordinary double-tap into a friendly no-op; this index is what makes a
    // racing double-tap safe, in the same spirit as the invite-request index.
    const uniqueIndex =
      "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_place_endorsements_member_place` " +
      "ON `community_place_endorsements` (member, waitlist)";
    // The place-page and card counts read by entry; My detours reads by member.
    const placeIndex =
      "CREATE INDEX IF NOT EXISTS `idx_community_place_endorsements_waitlist` " +
      "ON `community_place_endorsements` (waitlist)";
    const memberIndex =
      "CREATE INDEX IF NOT EXISTS `idx_community_place_endorsements_member_created` " +
      "ON `community_place_endorsements` (member, created)";
    // The notice sweep's work-list: the unsent rows, oldest first.
    const noticeIndex =
      "CREATE INDEX IF NOT EXISTS `idx_community_place_endorsements_unnotified` " +
      "ON `community_place_endorsements` (created) WHERE notified_at = ''";
    let indexesChanged = false;
    for (const index of [uniqueIndex, placeIndex, memberIndex, noticeIndex]) {
      if (endorsements.indexes.indexOf(index) === -1) {
        endorsements.indexes.push(index);
        indexesChanged = true;
      }
    }
    if (indexesChanged) app.save(endorsements);
  },
  (app) => {
    try {
      const endorsements = app.findCollectionByNameOrId(
        "community_place_endorsements"
      );
      app.delete(endorsements);
    } catch {
      // A partial or repeated rollback is already at the desired state.
    }
  }
);

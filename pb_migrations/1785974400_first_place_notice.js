/// <reference path="../pb_data/types.d.ts" />
//
// One notification, once: the member who invited you hears when you put your
// first place on Detour.
//
// The invitation graph already records who brought whom (`members.invited_by`),
// and the recommendation after-create hook already knows when a place goes live.
// What was missing is a durable marker saying the inviter has been told, so the
// notice cannot be sent twice — the same problem `publication_notification_sent_at`
// solves for the author's own publication email, and solved the same way: a
// single UPDATE ... WHERE the column is still empty ... RETURNING claims the
// right to send, so a concurrent second recommendation loses the claim rather
// than sending a second email.
//
// The backfill matters as much as the column. Every member who has already
// recommended something is stamped as introduced here, because their inviter
// found out long ago by other means; without it, the next place any existing
// member added would read as their first and mail their inviter about it.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");

    // Hidden: it is bookkeeping about a delivery, not a fact about the member,
    // and `members` is readable by the member it belongs to.
    if (!members.fields.getByName("inviter_introduced_at")) {
      members.fields.add(
        new DateField({
          name: "inviter_introduced_at",
          required: false,
          hidden: true,
        })
      );
      app.save(members);
    }

    // Idempotent: a member already stamped keeps their stamp, and one with no
    // recommendations is left empty so their first place still counts as first.
    const stamped = new Date().toISOString();
    app
      .db()
      .newQuery(
        "UPDATE members SET inviter_introduced_at = {:stamped} " +
          "WHERE COALESCE(inviter_introduced_at, '') = '' " +
          "AND EXISTS (" +
          "SELECT 1 FROM community_recommendations " +
          "WHERE community_recommendations.member = members.id" +
          ")"
      )
      .bind({ stamped })
      .execute();
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const field = members.fields.getByName("inviter_introduced_at");
    if (field) {
      members.fields.removeById(field.id);
      app.save(members);
    }
  }
);

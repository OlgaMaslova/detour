/// <reference path="../pb_data/types.d.ts" />
//
// A founding seat is offered, not caught by arriving early.
//
// Founding membership used to be pure arrival order: the Founder's first
// forty-nine invitees took the forty-nine invited seats, whoever they happened to
// be. That made an ordinary invitation and a founding invitation the same object,
// so the Founder could not invite a friend for the sake of inviting them without
// spending one of fifty seats, and could not hold a seat open for someone who
// would take a fortnight to sign up.
//
// `grants_founding` on the invite is the whole of the change: the Founder marks an
// invitation as founding when issuing it, and only a member who redeemed a marked
// invitation can hold a seat. Order still decides who gets in when more marked
// invitations are redeemed than there are seats left — see founding_cap.js — so
// fifty stays fifty. Nothing is stored on the member: the answer is still derived,
// it now reads one column further along the same edge.
//
// BACKFILL. Every seat that exists on the day this runs keeps its holder. The old
// derivation is replayed here verbatim — the Founder's first forty-nine real
// invitees in join order — and each of their redeemed invitations is marked, so
// the new predicate returns exactly the same members it did before. A seat holder
// whose invitation record is missing is named in the deploy log rather than
// quietly demoted; there should be none, because public signup always records the
// invitation it redeemed.
migrate(
  (app) => {
    const invites = app.findCollectionByNameOrId("invites");

    if (!invites.fields.getByName("grants_founding")) {
      invites.fields.add(
        new BoolField({
          name: "grants_founding",
          // Visible to the two members the invites rules already admit — its
          // issuer and whoever claimed it. The Founder has to be able to tell her
          // open founding invitations apart from her ordinary ones, and someone
          // who joined on a founding invitation may see what they were offered.
          hidden: false,
        })
      );
      app.save(invites);
    }

    // The pre-change seat list, replayed as it stood: real accounts only, in join
    // order, one short of fifty because the Founder holds the other seat.
    const holders = arrayOf(new DynamicModel({ id: "", redeemed_invite: "" }));
    app
      .db()
      .newQuery(
        "SELECT id, COALESCE(redeemed_invite, '') AS redeemed_invite FROM members " +
          "WHERE invited_by = (SELECT id FROM members " +
          "WHERE LOWER(TRIM(email)) = LOWER(TRIM({:founder}))) " +
          "AND COALESCE(internal_member, FALSE) = FALSE " +
          "AND LOWER(TRIM(email)) NOT LIKE '%.invalid' " +
          "ORDER BY NULLIF(TRIM(joined_at), '') ASC, id ASC " +
          "LIMIT 49"
      )
      .bind({
        founder:
          String($os.getenv("DETOUR_FOUNDER_EMAIL") || "").trim() ||
          "maslova_olga@hotmail.com",
      })
      .all(holders);

    let marked = 0;
    for (const holder of holders) {
      const inviteId = String(holder.redeemed_invite || "");
      if (!inviteId) {
        console.log(
          "founding invitation backfill: member " +
            holder.id +
            " holds a seat but records no redeemed invitation; mark one by hand to keep it"
        );
        continue;
      }
      try {
        const invite = app.findRecordById("invites", inviteId);
        if (invite.getBool("grants_founding")) continue;
        invite.set("grants_founding", true);
        app.save(invite);
        marked++;
      } catch (error) {
        console.log(
          "founding invitation backfill: member " +
            holder.id +
            " points at missing invitation " +
            inviteId +
            " (" + error + ")"
        );
      }
    }
    console.log(
      "founding invitation backfill: marked " + marked + " of " + holders.length + " seats"
    );
  },
  (app) => {
    const invites = app.findCollectionByNameOrId("invites");
    const field = invites.fields.getByName("grants_founding");
    if (field) {
      invites.fields.removeById(field.id);
      app.save(invites);
    }
  }
);

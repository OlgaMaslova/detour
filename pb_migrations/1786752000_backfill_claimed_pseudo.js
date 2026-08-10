/// <reference path="../pb_data/types.d.ts" />
//
// Who claimed the invitations that were already claimed.
//
// `claimed_pseudo` is a snapshot taken at redemption (see the members
// after-create hook), so it only ever fills in for signups that happen after
// the field exists. Every invitation redeemed before then reads back as a bare
// "Claimed <date>" — the issuer's own list cannot name the member who took it,
// which is the one thing the column was added for.
//
// Nothing was actually lost: the claiming member still records which invitation
// they redeemed, so the pair can be read straight back off the edge that
// already exists. This walks the claimed invitations that have no snapshot and
// fills each from its claimant's current pseudo.
//
// A pseudo the member has since changed backfills as the current one rather
// than the one they held on the day. That is the honest answer here — the old
// value was never recorded, and naming the member as they are now is what the
// issuer needs to recognise them.
migrate(
  (app) => {
    // Read the pairs in one pass rather than filtering records and resolving a
    // relation each time: the join is the whole of the question, and the
    // migration runs inside the boot transaction.
    const rows = arrayOf(new DynamicModel({ id: "", pseudo: "" }));
    app
      .db()
      .newQuery(
        "SELECT i.id AS id, COALESCE(m.pseudo, '') AS pseudo FROM invites i " +
          "JOIN members m ON m.id = i.claimed_by " +
          "WHERE COALESCE(i.claimed_by, '') != '' " +
          "AND COALESCE(i.claimed_pseudo, '') = ''"
      )
      .all(rows);

    let filled = 0;
    let nameless = 0;
    for (const row of rows) {
      // An account with no pseudo has no name to show, so the row keeps its
      // plain "Claimed <date>" rather than gaining an empty "Claimed by".
      if (!row.pseudo) {
        nameless++;
        continue;
      }
      try {
        const invite = app.findRecordById("invites", row.id);
        invite.set("claimed_pseudo", row.pseudo);
        app.save(invite);
        filled++;
      } catch (error) {
        console.log(
          "claimed pseudo backfill: invitation " + row.id + " could not be named (" + error + ")"
        );
      }
    }
    console.log(
      "claimed pseudo backfill: named " +
        filled +
        " of " +
        rows.length +
        " claimed invitations" +
        (nameless ? " (" + nameless + " claimed by an account with no pseudo)" : "")
    );
  },
  (app) => {
    // The column itself belongs to the migration that added it; this one only
    // ever wrote values, so undoing it means clearing what it wrote. Rows that
    // a later redemption filled in legitimately are indistinguishable from
    // backfilled ones, so the safe reverse is to leave every value alone and
    // let the field's own down-migration drop the column.
  }
);

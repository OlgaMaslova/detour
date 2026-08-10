/// <reference path="../pb_data/types.d.ts" />
//
// An invitation is issued today and often redeemed weeks later, by which point
// its issuer has forgotten who "DTR-9F2K..." was meant for. `hint` is the
// issuer's own note to themselves — free text, never read by any hook, never
// shown to anyone but the two people the invites rules already admit.
//
// `claimed_pseudo` answers the companion question once a code is redeemed:
// who actually took it. It is a snapshot of the claiming member's pseudo at
// the moment of redemption, denormalised onto the invite exactly as
// `author_pseudo` is denormalised onto a share reply — because the invites
// collection's own rules let its issuer view the record, but the members
// collection does not let that issuer view the claimant's member record, and
// resolving the relation with `expand` would silently come back empty.
//
// An unclaimed invitation may also now be withdrawn: `deleteRule` admits the
// issuer, and only while the invite is still unspent. A claimed invitation is
// the record of how a real member joined and stays permanent, same as before.
migrate(
  (app) => {
    const invites = app.findCollectionByNameOrId("invites");

    if (!invites.fields.getByName("hint")) {
      invites.fields.add(
        new TextField({
          name: "hint",
          max: 120,
          required: false,
        })
      );
    }

    if (!invites.fields.getByName("claimed_pseudo")) {
      invites.fields.add(
        new TextField({
          name: "claimed_pseudo",
          max: 40,
          required: false,
        })
      );
    }

    invites.deleteRule =
      "@request.auth.id != '' && issued_by = @request.auth.id && claimed_by = ''";

    app.save(invites);
  },
  (app) => {
    const invites = app.findCollectionByNameOrId("invites");

    const hint = invites.fields.getByName("hint");
    if (hint) invites.fields.removeById(hint.id);

    const claimedPseudo = invites.fields.getByName("claimed_pseudo");
    if (claimedPseudo) invites.fields.removeById(claimedPseudo.id);

    invites.deleteRule = null;

    app.save(invites);
  }
);

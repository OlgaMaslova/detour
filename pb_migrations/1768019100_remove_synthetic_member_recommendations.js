/// <reference path="../pb_data/types.d.ts" />
//
// Removes member place recommendations that did not come from real members.
// The retained publication-proof account (and any other synthetic fixture
// account) uses a reserved `.invalid` email domain; recommendations written
// under such accounts — like the seeded "Anchor Oyster Bar" row — are
// deleted here, and the public list/view rules are tightened so an approved
// contribution only surfaces when its contributor is a real member.
//
// Idempotent and fail-safe: a missing collection means nothing to do, and a
// per-record failure is logged and skipped so a single bad row cannot block
// boot.
migrate((app) => {
  function findCollectionOrNull(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return null;
    }
  }

  const members = findCollectionOrNull("members");
  const contributions = findCollectionOrNull("member_place_contributions");
  if (!members || !contributions) {
    console.log(
      "synthetic recommendation sweep: collections missing; nothing to do"
    );
    return;
  }

  let syntheticMembers = [];
  try {
    syntheticMembers = app.findRecordsByFilter(
      members.id,
      "email ~ '%.invalid'",
      "id",
      1000,
      0
    );
  } catch (error) {
    throw new Error("Unable to inspect synthetic members: " + error);
  }

  let removed = 0;
  for (const member of syntheticMembers) {
    let records = [];
    try {
      records = app.findRecordsByFilter(
        contributions.id,
        "member = {:member}",
        "id",
        1000,
        0,
        { member: member.id }
      );
    } catch (error) {
      console.log(
        "synthetic recommendation sweep: unable to inspect contributions of " +
          member.id +
          ": " +
          error
      );
      continue;
    }
    for (const record of records) {
      try {
        app.delete(record);
        removed++;
      } catch (error) {
        console.log(
          "synthetic recommendation sweep: contribution " +
            record.id +
            " (" +
            record.getString("place_name") +
            ") not removed: " +
            error
        );
      }
    }
  }
  console.log(
    "synthetic recommendation sweep: removed " +
      removed +
      " contributions from " +
      syntheticMembers.length +
      " synthetic members"
  );

  // From now on an approved contribution is public only when its contributor
  // is a real member; synthetic `.invalid` accounts still see their own rows.
  contributions.listRule =
    "(status = 'approved' && member.email !~ '%.invalid') || (@request.auth.id != '' && member = @request.auth.id)";
  contributions.viewRule =
    "(status = 'approved' && member.email !~ '%.invalid') || (@request.auth.id != '' && member = @request.auth.id)";
  return app.save(contributions);
}, () => {
  // Forward-only: synthetic recommendations must not be recreated by a
  // migration-history rollback.
  return null;
});

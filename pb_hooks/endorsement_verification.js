// Shared endorsement verification recalculation. Require this file from inside
// every hook handler; PocketBase isolates handler callbacks from module scope.
module.exports = {
  recalculateVerification: function (app, initialMemberId) {
    if (!initialMemberId) {
      return;
    }

    const queue = [initialMemberId];
    const queued = {};
    queued[initialMemberId] = true;

    while (queue.length > 0) {
      const memberId = queue.shift();
      delete queued[memberId];

      let member;
      try {
        member = app.findRecordById("members", memberId);
      } catch {
        // A member deletion can cascade through endorsements. There is no
        // member status left to update in that case.
        continue;
      }

      const verifiedEndorsements = app.findRecordsByFilter(
        "endorsements",
        "endorsee = {:endorsee} && active = true && endorser.community_status = 'verified'",
        "",
        2,
        0,
        { endorsee: memberId }
      );
      const shouldBeVerified =
        member.getBool("founding_verified") || verifiedEndorsements.length >= 2;
      const currentStatus = member.getString("community_status");
      const requiredStatus = shouldBeVerified ? "verified" : "unverified";

      if (currentStatus === requiredStatus) {
        continue;
      }

      member.set("community_status", requiredStatus);
      app.save(member);

      // A changed member can no longer be treated as a stale trust source (or
      // can become a new one), so recalculate every active downstream endorsee.
      const downstream = app.findRecordsByFilter(
        "endorsements",
        "endorser = {:endorser} && active = true",
        "",
        1000,
        0,
        { endorser: memberId }
      );
      for (const endorsement of downstream) {
        const endorseeId = endorsement.getString("endorsee");
        if (endorseeId && !queued[endorseeId]) {
          queue.push(endorseeId);
          queued[endorseeId] = true;
        }
      }
    }
  },
};

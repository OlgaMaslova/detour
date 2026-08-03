/// <reference path="../pb_data/types.d.ts" />
//
// The last step of a new member's first visit: the person who invited them hears
// about it.
//
// An invitation is the only way in, so somebody vouched for every member here.
// When that member finally puts a place on the list, the one person who has been
// waiting to see it is their inviter — and nothing told them. This hook is that
// notice, and deliberately only that: one email, on the first place, to one
// person.
//
// It lives in its own hook file rather than beside the author's own publication
// email in main.pb.js because it is a different notification with a different
// recipient and a different claim marker; PocketBase registers hooks from every
// file, so both handlers run on the same event without either knowing about the
// other. Nothing here may fail the recommendation: every step is inside a try,
// and the save is already committed by the time this runs.
onRecordAfterCreateSuccess((e) => {
  try {
    const memberId = e.record.getString("member");
    if (memberId) {
      const author = e.app.findRecordById("members", memberId);
      const inviterId = author.getString("invited_by");
      const authorEmail = author.getString("email").trim();
      // The .invalid TLD is reserved (RFC 2606) and is what this repo's fixture
      // and smoke-test accounts use, so neither side of a fixture edge mails.
      const reserved = /@(?:[^@\s]+\.)*invalid$/i;

      if (
        inviterId &&
        !author.getBool("internal_member") &&
        author.getString("community_status") === "verified" &&
        !reserved.test(authorEmail)
      ) {
        // Claim the right to send before sending. The UPDATE only matches while
        // the column is still empty, so of two recommendations racing to be this
        // member's first, exactly one claim returns a row — and a delivery
        // failure after the claim is a lost email rather than a repeated one,
        // which is the correct way round for a notice about a first place.
        const claimed = arrayOf(new DynamicModel({ id: "" }));
        e.app
          .db()
          .newQuery(
            "UPDATE members SET inviter_introduced_at = {:stamped} " +
              "WHERE id = {:memberId} " +
              "AND COALESCE(inviter_introduced_at, '') = '' " +
              "RETURNING id"
          )
          .bind({ stamped: new Date().toISOString(), memberId: memberId })
          .all(claimed);

        if (claimed.length === 1) {
          const inviter = e.app.findRecordById("members", inviterId);
          const recipient = inviter.getString("email").trim();
          if (
            recipient &&
            !reserved.test(recipient) &&
            !inviter.getBool("internal_member")
          ) {
            const mailer = require(__hooks + "/mailer.js");
            // Members have one name on Detour and it is the pseudo;
            // display_name is only a fallback for pre-consolidation accounts.
            const name =
              author.getString("pseudo").trim() ||
              author.getString("display_name").trim() ||
              "Someone you invited";
            const place = e.record.getString("venue_name").trim() || "a place";
            const city = e.record.getString("city").trim();
            const where = city ? place + " in " + city : place;
            const siteUrl = "https://takedetour.app";

            mailer.sendMail(e.app, {
              to: recipient,
              subject: name + " added their first place",
              text:
                name +
                " joined on your invitation and has put their first place on Detour: " +
                where +
                ".\n\nSee it: " +
                siteUrl +
                mailer.signatureText() +
                "\n\nYou received this because they joined on your invitation.",
              html:
                "<p><strong>" +
                mailer.escapeHtml(name) +
                "</strong> joined on your invitation and has put their first" +
                " place on Detour: " +
                mailer.escapeHtml(where) +
                ".</p>" +
                '<p><a href="' +
                siteUrl +
                '">See it on Detour</a></p>' +
                mailer.signatureHtml() +
                "<p>You received this because they joined on your" +
                " invitation.</p>",
            });
          }
        }
      }
    }
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour first-place inviter notice failed.",
        "recommendationId",
        e.record.id,
        "error",
        String(error)
      );
    } catch {
      // Logging must not turn a best-effort notice into a failed save.
    }
  }

  e.next();
}, "community_recommendations");

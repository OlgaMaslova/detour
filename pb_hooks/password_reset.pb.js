/// <reference path="../pb_data/types.d.ts" />
//
// The reset-password email, pointed at Detour instead of at PocketBase.
//
// PocketBase's stock template links to its own admin UI
// ({APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}), which asks a member for a
// new password behind a superuser console they have no business seeing and no
// reason to trust. The token is the same either way -- the confirm call is public
// -- so all that has to change is where the link goes: the membership card on
// takedetour.app, which reads ?reset= and spends the token there
// (applyPasswordResetRoute in src/community.ts).
//
// Rewriting it in a hook rather than in the collection's template field is what
// lets it be written like every other Detour email: one voice, signed by hand,
// through the same mailer module. It also keeps the wording in the repo, where it
// is reviewable, instead of in a settings blob in the database.
//
// Never fatal. A hook that throws here fails the send, and the member's answer to
// "reset my password" becomes an error -- so anything unexpected is logged and the
// stock template goes out instead. A link to the wrong page still beats no email.
onMailerRecordPasswordResetSend((e) => {
  try {
    const mailer = require(__hooks + "/mailer.js");
    const token = String((e.meta && e.meta.token) || "");
    if (!token) {
      throw new Error("No reset token on the mailer event.");
    }

    // The deploy this hook is running for. Hardcoded like the other hooks' site
    // URL, with an override so a local PocketBase mails links back to the local
    // app rather than to production.
    const siteUrl = (
      String($os.getenv("DETOUR_SITE_URL") || "").trim() || "https://takedetour.app"
    ).replace(/\/+$/, "");
    const link = siteUrl + "/?view=members&reset=" + token;
    // A member has one name on Detour and it is the pseudo; display_name is only
    // a fallback for accounts that predate the consolidation.
    const name =
      e.record.getString("pseudo").trim() ||
      e.record.getString("display_name").trim() ||
      "there";

    e.message.subject = "Set a new Detour password";
    e.message.text =
      "Hello " +
      name +
      ",\n\nSomebody asked to set a new password for your Detour account. Open" +
      " this link within thirty minutes and choose one:\n\n" +
      link +
      "\n\nIf that was not you, nothing has changed and there is nothing to do —" +
      " the link expires on its own." +
      mailer.signatureText() +
      "\n\nYou received this email because a password reset was requested for" +
      " this address on Detour.";
    e.message.html =
      "<p>Hello " +
      mailer.escapeHtml(name) +
      ",</p>" +
      "<p>Somebody asked to set a new password for your Detour account." +
      " Open this link within thirty minutes and choose one.</p>" +
      '<p><a href="' +
      mailer.escapeHtml(link) +
      '">Choose a new password</a></p>' +
      "<p>If that was not you, nothing has changed and there is nothing to" +
      " do — the link expires on its own.</p>" +
      mailer.signatureHtml() +
      "<p>You received this email because a password reset was requested for" +
      " this address on Detour.</p>";
  } catch (error) {
    try {
      e.app
        .logger()
        .error(
          "Detour reset-password email could not be rewritten; sending the stock template.",
          "memberId",
          e.record ? e.record.id : "",
          "error",
          String(error)
        );
    } catch {
      // Logging must not be the thing that stops the email.
    }
  }

  e.next();
}, "members");

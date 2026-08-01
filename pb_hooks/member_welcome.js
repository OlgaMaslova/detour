/// <reference path="../pb_data/types.d.ts" />

// The welcome email, in one place so the signup hook and the curation re-send
// route cannot drift apart in wording.
//
// A re-send route exists because delivery is best-effort and never retried: the
// message is attempted once, inside the members after-create hook, and a relay
// that was misconfigured at that moment (as it was on 2026-08-01, when SMTP was
// pointed at port 465 with StartTLS and every send died before reaching Resend)
// loses that member's welcome permanently. Recovering it by hand otherwise means
// sending mail outside the app, with copy that then has to be kept in step by
// hand.
//
// Require this file *inside* the hook or route callback -- PocketBase runs each
// callback in an isolated VM, so a module-scope require is not in scope by the
// time the callback executes.

const SITE_URL = "https://takedetour.app";

// Throws whatever the mail client throws. Both call sites decide for themselves
// whether that is fatal: signup logs and swallows it, the re-send route reports
// it back to the caller.
function sendWelcomeEmail(app, member) {
  const mailer = require(__hooks + "/mailer.js");
  const displayName = member.getString("display_name").trim() || "there";

  mailer.sendMail(app, {
    to: member.getString("email"),
    subject: "Welcome to Detour",
    text:
      "Hello " +
      displayName +
      ",\n\nWelcome to Detour — a private circle sharing exceptional food-and-drink places.\n\nAdd your first place: " +
      SITE_URL +
      "\n\nYou received this email because you joined Detour.",
    html:
      "<p>Hello " +
      mailer.escapeHtml(displayName) +
      ",</p>" +
      "<p>Welcome to Detour — a private circle sharing exceptional food-and-drink places.</p>" +
      '<p><a href="' +
      SITE_URL +
      '">Add your first place</a></p>' +
      "<p>You received this email because you joined Detour.</p>",
  });
}

module.exports = { sendWelcomeEmail: sendWelcomeEmail };

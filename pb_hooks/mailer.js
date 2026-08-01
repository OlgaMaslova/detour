/// <reference path="../pb_data/types.d.ts" />

// All outbound mail goes through PocketBase's own mail client, which relays via
// the SMTP server configured in Settings -> Mail settings. Detour previously
// posted to two third-party services owned by the platform it was hosted on
// (AgentMail for member email, a webhook for operator notifications); both went
// away with that platform. Routing through PocketBase means the provider is a
// settings change rather than a code change, and the credentials live in the
// settings blob encrypted with PB_ENCRYPTION_KEY instead of in env vars.
//
// Callers must require this file *inside* their hook callback -- PocketBase
// runs each callback in an isolated VM, so a module-scope require is not in
// scope by the time the callback executes.

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Member-facing mail. Throws on a missing recipient or an unconfigured sender
// so the caller's existing try/catch logs it -- every call site is already
// best-effort and must not fail the surrounding write.
function sendMail(app, options) {
  const to = String((options && options.to) || "").trim();
  if (!to) {
    throw new Error("No recipient address.");
  }

  const settings = app.settings();
  const senderAddress = settings.meta.senderAddress;
  if (!senderAddress) {
    throw new Error(
      "No sender address configured (Settings -> Mail settings)."
    );
  }

  // With SMTP disabled, newMailClient() returns a sendmail client that shells
  // out to a local binary the Alpine image does not ship, so the send fails
  // with an opaque exec error and nothing ever reaches the relay -- the relay
  // dashboard shows zero attempts rather than failures. Fail with the actual
  // reason instead.
  if (!settings.smtp.enabled) {
    throw new Error(
      "SMTP is disabled (Settings -> Mail settings): mail is not being relayed."
    );
  }

  // Optional, and normally unset: mail is sent as takedetour.app, which
  // Cloudflare Email Routing already receives, so replies arrive without help.
  // Set DETOUR_REPLY_TO only to point replies somewhere other than the From
  // address.
  const headers = {};
  const replyTo = String($os.getenv("DETOUR_REPLY_TO") || "").trim();
  if (replyTo) {
    headers["Reply-To"] = replyTo;
  }

  const message = new MailerMessage({
    from: {
      address: senderAddress,
      name: settings.meta.senderName,
    },
    to: [{ address: to }],
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers: headers,
  });

  app.newMailClient().send(message);
}

// Operator notifications -- the daily rollup, new survey responses, invite
// requests. These used to POST to the host platform's dashboard; they now go to
// whoever DETOUR_REPORTS_EMAIL names. Unset the env var to switch them off
// entirely without touching the call sites.
function notifyOps(app, options) {
  const to = String($os.getenv("DETOUR_REPORTS_EMAIL") || "").trim();
  if (!to) {
    throw new Error("DETOUR_REPORTS_EMAIL is not configured.");
  }

  sendMail(app, {
    to: to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}

module.exports = {
  escapeHtml: escapeHtml,
  sendMail: sendMail,
  notifyOps: notifyOps,
};

/// <reference path="../pb_data/types.d.ts" />

// Public invite requests are normalized and deduplicated before PocketBase
// persists them. The unique index is the final concurrency guard; the explicit
// lookups turn both ordinary retries and a racing retry into a friendly 400.
onRecordCreateRequest((e) => {
  // PocketBase executes each hook handler in an isolated VM, so every helper
  // used by this handler must be declared inside the callback.
  function normalizeBounded(value, label, maxLength, rawMaxLength) {
    let raw = String(value === undefined || value === null ? "" : value);
    if (raw.length > rawMaxLength) {
      throw new BadRequestError(label + " is too long.");
    }
    if (typeof raw.normalize === "function") {
      raw = raw.normalize("NFKC");
    }
    const normalized = raw
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length > maxLength) {
      throw new BadRequestError(label + " is too long.");
    }
    return normalized;
  }

  function validEmail(email) {
    if (!email || email.length > 254) return false;
    const at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return false;

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (
      local.length > 64 ||
      domain.length > 253 ||
      local.charAt(0) === "." ||
      local.charAt(local.length - 1) === "." ||
      local.indexOf("..") !== -1 ||
      !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)
    ) {
      return false;
    }

    const labels = domain.split(".");
    if (labels.length < 2) return false;
    for (const label of labels) {
      if (
        !label ||
        label.length > 63 ||
        label.charAt(0) === "-" ||
        label.charAt(label.length - 1) === "-" ||
        !/^[a-z0-9-]+$/.test(label)
      ) {
        return false;
      }
    }
    return true;
  }

  function findDuplicate(app, email) {
    try {
      return app.findFirstRecordByFilter(
        "invite_requests",
        "email = {:email}",
        { email: email }
      );
    } catch {
      return null;
    }
  }

  function duplicateError() {
    return new BadRequestError(
      "An invite request for this email already exists. The Detour team will be in touch personally."
    );
  }

  const email = normalizeBounded(
    e.record.getString("email"),
    "Email",
    254,
    1024
  ).toLowerCase();
  if (!validEmail(email)) {
    throw new BadRequestError("Enter a valid email address.");
  }

  const name = normalizeBounded(e.record.getString("name"), "Name", 120, 544);
  const city = normalizeBounded(e.record.getString("city"), "City", 120, 544);
  const why = normalizeBounded(e.record.getString("why"), "Reason", 500, 2064);
  const source = normalizeBounded(
    e.record.getString("source"),
    "Source",
    120,
    544
  );

  e.record.set("email", email);
  e.record.set("name", name);
  e.record.set("city", city);
  e.record.set("why", why);
  e.record.set("source", source);

  if (e.hasSuperuserAuth()) {
    const status = normalizeBounded(
      e.record.getString("status"),
      "Status",
      16,
      80
    ).toLowerCase();
    if (["new", "invited", "declined"].indexOf(status) === -1) {
      throw new BadRequestError("Status must be new, invited, or declined.");
    }
    e.record.set("status", status);
  } else {
    // Public callers can never self-approve or decline their request.
    e.record.set("status", "new");
  }

  if (findDuplicate(e.app, email)) {
    throw duplicateError();
  }

  try {
    e.next();
  } catch (error) {
    // A simultaneous request may pass the lookup first and then lose the unique
    // index race. Convert that storage error into the same friendly response.
    if (findDuplicate(e.app, email)) {
      throw duplicateError();
    }
    throw error;
  }
}, "invite_requests");

// Side effects run only after a record has committed, so rejected duplicates
// produce neither an event nor an email. Both deliveries are intentionally
// best-effort: each is attempted once, in order, and failures are logged without
// changing the already-saved invite request.
onRecordAfterCreateSuccess((e) => {
  // Handler-local helpers are required because hook callbacks use isolated VMs.
  function logFailure(message, error) {
    try {
      e.app.logger().error(
        message,
        "inviteRequestId",
        e.record.id,
        "error",
        String(error)
      );
    } catch {
      // Logging must never turn a best-effort delivery into a failed request.
    }
  }

  try {
    const eventsUrl = $os.getenv("SUPERNAUT_EVENTS_URL");
    if (!eventsUrl) {
      throw new Error("SUPERNAUT_EVENTS_URL is not configured.");
    }

    const name = e.record.getString("name").trim() || "Not provided";
    const city = e.record.getString("city").trim() || "Not provided";
    const reason = e.record.getString("why").trim() || "Not provided";
    const response = $http.send({
      url: eventsUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "detour.invite_request.created",
        subject: "New Detour invite request",
        text: "Name: " + name + "\nCity: " + city + "\nReason: " + reason,
      }),
      timeout: 5,
    });
    if (!response || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        "Dashboard events endpoint returned HTTP " +
          (response && response.statusCode ? response.statusCode : "unknown") +
          "."
      );
    }
  } catch (error) {
    logFailure("Detour invite-request event delivery failed.", error);
  }

  const recipient = e.record.getString("email").trim().toLowerCase();
  const recipientDomain = recipient.slice(recipient.lastIndexOf("@") + 1);
  const reservedInvalidRecipient = /(^|\.)invalid$/.test(recipientDomain);

  // RFC 2606 .invalid addresses are used for smoke tests and can never receive
  // mail. Suppressing them here guarantees no AgentMail request is attempted.
  if (!reservedInvalidRecipient) {
    try {
      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      const apiKey = $os.getenv("AGENTMAIL_API_KEY");
      const inboxId = $os.getenv("AGENTMAIL_INBOX_ID");
      if (!apiKey || !inboxId) {
        throw new Error("AgentMail runtime configuration is missing.");
      }

      const name = e.record.getString("name").trim();
      const greeting = name ? "Hello " + name + "," : "Hello,";
      const siteUrl = "https://takedetour.app";
      const response = $http.send({
        url:
          "https://api.agentmail.to/v0/inboxes/" +
          encodeURIComponent(inboxId) +
          "/messages/send",
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: recipient,
          subject: "We received your Detour request",
          text:
            greeting +
            "\n\nThanks for your interest in Detour. The team will reply personally.\n\n" +
            siteUrl,
          html:
            "<p>" +
            escapeHtml(greeting) +
            "</p><p>Thanks for your interest in Detour. The team will reply personally.</p>" +
            '<p><a href="' +
            siteUrl +
            '">Visit Detour</a></p>',
          labels: ["app"],
        }),
        timeout: 10,
      });
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          "AgentMail returned HTTP " +
            (response && response.statusCode ? response.statusCode : "unknown") +
            "."
        );
      }
    } catch (error) {
      logFailure("Detour invite-request confirmation email failed.", error);
    }
  }

  e.next();
}, "invite_requests");

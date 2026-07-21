/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/supernaut/ready", (event) => {
  return event.json(200, { ok: true });
});

// These private routes bypass member rules only for explicit safe projections.
routerAdd(
  "GET",
  "/api/detour/community/me",
  (e) => {
    return e.json(200, {
      member: {
        id: e.auth.id,
        display_name: e.auth.getString("display_name"),
        pseudo: e.auth.getString("pseudo"),
        community_status: e.auth.getString("community_status"),
      },
    });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "GET",
  "/api/detour/network-discovery",
  (e) => {
    // Route handlers run in isolated VMs, so all route-specific helpers and
    // query models live inside this handler.
    function projectReply(row) {
      return {
        id: row.id,
        body: row.body,
        author_name: row.author_name,
        author_pseudo: row.author_pseudo,
        created: row.created,
      };
    }

    function projectShare(row, replies) {
      return {
        id: row.id,
        direction: row.direction,
        venue_name: row.venue_name,
        city: row.city,
        country: row.country,
        address: row.address,
        personal_note: row.personal_note,
        sender_name: row.sender_name,
        sender_pseudo: row.sender_pseudo,
        recipient_name: row.recipient_name,
        recipient_pseudo: row.recipient_pseudo,
        seen: row.seen,
        created: row.created,
        replies: replies,
      };
    }

    function projectRecommendation(row) {
      return {
        venue_name: row.venue_name,
        recommender_name: row.recommender_name,
        recommender_pseudo: row.recommender_pseudo,
        note: row.note,
        city: row.city,
        country: row.country,
        address: row.address,
        created: row.created,
      };
    }

    const callerId = e.auth.id;
    const caller = e.app.findRecordById("members", callerId);
    const invitedBy = caller.getString("invited_by");

    // The endpoint deliberately uses bounded, explicit SQL projections. It
    // bypasses collection rules only for caller-participant shares/replies and
    // opted-in direct-peer recommendations. No email, relation, moderation, or
    // unrelated member fields are selected or returned.
    const shareRows = arrayOf(
      new DynamicModel({
        id: "",
        direction: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        personal_note: "",
        sender_name: "",
        sender_pseudo: "",
        recipient_name: "",
        recipient_pseudo: "",
        seen: false,
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT id, " +
          "CASE WHEN recipient = {:caller} THEN 'received' ELSE 'sent' END AS direction, " +
          "venue_name, city, country, address, personal_note, " +
          "sender_name, sender_pseudo, recipient_name, recipient_pseudo, seen, created " +
          "FROM community_shares " +
          "WHERE sender = {:caller} OR recipient = {:caller} " +
          "ORDER BY created DESC, id DESC LIMIT 100"
      )
      .bind({ caller: callerId })
      .all(shareRows);

    // At most 50 chronological replies are returned for each of the same 100
    // caller-owned share threads selected above. The repeated bounded share CTE
    // avoids loading replies from older or unrelated threads.
    const replyRows = arrayOf(
      new DynamicModel({
        id: "",
        share_id: "",
        body: "",
        author_name: "",
        author_pseudo: "",
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "WITH selected_shares AS (" +
          "SELECT id FROM community_shares " +
          "WHERE sender = {:caller} OR recipient = {:caller} " +
          "ORDER BY created DESC, id DESC LIMIT 100" +
          "), ranked_replies AS (" +
          "SELECT r.id, r.share AS share_id, r.body, r.author_name, r.author_pseudo, r.created, " +
          "ROW_NUMBER() OVER (PARTITION BY r.share ORDER BY r.created ASC, r.id ASC) AS reply_rank " +
          "FROM community_share_replies r " +
          "JOIN selected_shares selected ON selected.id = r.share" +
          ") " +
          "SELECT id, share_id, body, author_name, author_pseudo, created " +
          "FROM ranked_replies WHERE reply_rank <= 50 " +
          "ORDER BY share_id ASC, created ASC, id ASC LIMIT 5000"
      )
      .bind({ caller: callerId })
      .all(replyRows);

    const repliesByShare = {};
    for (const row of replyRows) {
      if (!repliesByShare[row.share_id]) repliesByShare[row.share_id] = [];
      repliesByShare[row.share_id].push(projectReply(row));
    }

    const recommendationRows = arrayOf(
      new DynamicModel({
        recommender_name: "",
        recommender_pseudo: "",
        note: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT m.display_name AS recommender_name, m.pseudo AS recommender_pseudo, " +
          "r.note, r.venue_name, r.city, r.country, r.address, r.created " +
          "FROM community_recommendations r " +
          "JOIN members m ON m.id = r.member " +
          "WHERE m.id != {:caller} AND m.discovery_visible = TRUE AND (" +
          "m.invited_by = {:caller} OR " +
          "({:invitedBy} != '' AND m.id = {:invitedBy}) OR " +
          "EXISTS (" +
          "SELECT 1 FROM community_shares peer_share " +
          "WHERE (peer_share.sender = {:caller} AND peer_share.recipient = m.id) " +
          "OR (peer_share.recipient = {:caller} AND peer_share.sender = m.id)" +
          ")" +
          ") ORDER BY r.created DESC, r.id DESC LIMIT 100"
      )
      .bind({ caller: callerId, invitedBy: invitedBy })
      .all(recommendationRows);

    const shares = [];
    for (const row of shareRows) {
      shares.push(projectShare(row, repliesByShare[row.id] || []));
    }
    const recommendations = [];
    for (const row of recommendationRows) {
      recommendations.push(projectRecommendation(row));
    }

    return e.json(200, {
      discovery_visible: caller.getBool("discovery_visible"),
      shares: shares,
      recommendations: recommendations,
    });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "GET",
  "/api/detour/member-place-contributions",
  (e) => {
    const records = e.app.findRecordsByFilter(
      "member_place_contributions",
      "member = {:member}",
      "-created",
      10000,
      0,
      { member: e.auth.id }
    );
    const items = [];
    for (const record of records) {
      items.push({
        id: record.id,
        place_name: record.getString("place_name"),
        city: record.getString("city"),
        country: record.getString("country"),
        address: record.getString("address"),
        category: record.getString("category"),
        occasions: record.getStringSlice("occasions"),
        status: record.getString("status"),
        created: record.getString("created"),
        updated: record.getString("updated"),
      });
    }

    return e.json(200, { items: items });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "GET",
  "/api/detour/member-directory",
  (e) => {
    const rawQuery = e.request.url.query().get("q") || "";
    // A leading "@" is the conventional way to write a pseudo; searching
    // matches both the pseudo handle and the display name either way.
    const query = rawQuery
      .slice(0, 100)
      .replace(/[\x00-\x1F\x7F%_]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^@+/, "");

    if (query.length < 2) {
      throw new BadRequestError("q must contain at least two searchable characters.");
    }

    const matches = e.app.findRecordsByFilter(
      "members",
      "id != {:member} && (pseudo ~ {:query} || display_name ~ {:query})",
      "pseudo",
      12,
      0,
      { member: e.auth.id, query: query }
    );
    const candidates = [];
    for (const match of matches) {
      candidates.push({
        id: match.id,
        display_name: match.getString("display_name"),
        pseudo: match.getString("pseudo"),
      });
    }

    return e.json(200, { items: candidates });
  },
  $apis.requireAuth("members")
);

// A public member account is valid only when it redeems an unused, server-
// generated invitation. `redeemed_invite` has a partial unique index, so a
// simultaneous second redemption cannot create another member account.
onRecordCreateRequest((e) => {
  // Visibility is always an explicit post-signup opt-in by the member. Ignore
  // any create payload (including privileged fixture creation) that attempts
  // to make a new account discoverable immediately.
  e.record.set("discovery_visible", false);
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  // Founder policy is server-owned. Public signup can neither authorize a new
  // issuer nor self-assert the direct-invite fast track.
  e.record.set("founder_invitation_issuer", false);
  e.record.set("direct_founder_invited", false);

  const inviteCode = e.record.getString("invite_code").trim().toUpperCase();
  if (!inviteCode) {
    throw new BadRequestError("A valid invitation code is required to join Detour.");
  }

  let invite;
  try {
    invite = e.app.findFirstRecordByFilter(
      "invites",
      "code = {:code} && claimed_by = ''",
      { code: inviteCode }
    );
  } catch {
    throw new BadRequestError("This invitation code is invalid or has already been used.");
  }

  const { assertPseudoAvailable, normalizeMemberPseudo } = require(
    __hooks + "/member_profile.js"
  );
  const pseudo = normalizeMemberPseudo(e.record.getString("pseudo"));
  assertPseudoAvailable(e.app, pseudo, "");

  const issuerId = invite.getString("issued_by");
  const issuer = e.app.findRecordById("members", issuerId);

  e.record.set("pseudo", pseudo);
  e.record.set("invite_code", "");
  e.record.set("invited_by", issuerId);
  e.record.set("redeemed_invite", invite.id);
  e.record.set("community_status", "verified");
  // Derive from the invitation's actual issuer marker, not ancestry: a direct
  // Founder invitee does not confer Founder status on people they later invite.
  e.record.set(
    "direct_founder_invited",
    issuer.getBool("founder_invitation_issuer")
  );
  e.next();
}, "members");

// Record the winning member only after the account has been committed. This
// keeps a failed account validation from consuming an invitation.
onRecordAfterCreateSuccess((e) => {
  const inviteId = e.record.getString("redeemed_invite");
  if (inviteId) {
    const invite = e.app.findRecordById("invites", inviteId);
    invite.set("claimed_by", e.record.id);
    invite.set("claimed_at", new Date().toISOString());
    e.app.save(invite);
  }
  e.next();
}, "members");

// Members may edit their own profile and auth details, but never alter the
// verification or invitation provenance that is maintained on the server.
onRecordUpdateRequest((e) => {
  const original = e.record.original();
  if (e.hasSuperuserAuth()) {
    if (
      e.record.getBool("discovery_visible") !==
      original.getBool("discovery_visible")
    ) {
      throw new BadRequestError(
        "Network discovery visibility can be changed only by the member."
      );
    }
    return e.next();
  }
  if (!e.auth || e.auth.id !== e.record.id) {
    throw new BadRequestError("You can update only your own member profile.");
  }

  if (
    e.record.getString("community_status") !== original.getString("community_status") ||
    e.record.getBool("founding_verified") !== original.getBool("founding_verified") ||
    e.record.getString("invited_by") !== original.getString("invited_by") ||
    e.record.getString("redeemed_invite") !== original.getString("redeemed_invite") ||
    e.record.getBool("founder_invitation_issuer") !==
      original.getBool("founder_invitation_issuer") ||
    e.record.getBool("direct_founder_invited") !==
      original.getBool("direct_founder_invited")
  ) {
    // Keep both Founder markers inside the existing protected membership
    // provenance boundary; profile requests may never change publication trust.
    throw new BadRequestError("Membership verification and invitation details are managed by Detour.");
  }
  if (e.record.getString("pseudo") !== original.getString("pseudo")) {
    const { assertPseudoAvailable, normalizeMemberPseudo } = require(
      __hooks + "/member_profile.js"
    );
    const pseudo = normalizeMemberPseudo(e.record.getString("pseudo"));
    assertPseudoAvailable(e.app, pseudo, e.record.id);
    e.record.set("pseudo", pseudo);
  }
  e.record.set("invite_code", "");
  e.next();
}, "members");

// Invitation codes are generated server-side and are always assigned to the
// authenticated member who created the invite. Each member may keep up to
// three invitations open at once; redeeming one frees a slot.
onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    if (e.hasSuperuserAuth()) {
      return e.next();
    }
    throw new BadRequestError("Sign in to issue an invitation.");
  }

  const openInviteCount = e.app.countRecords(
    "invites",
    $dbx.hashExp({ issued_by: e.auth.id, claimed_by: "" })
  );
  if (openInviteCount >= 3) {
    throw new BadRequestError(
      "You already have three unclaimed invitations. An invitation slot becomes available once someone redeems a code."
    );
  }

  e.record.set("issued_by", e.auth.id);
  e.record.set("code", "DTR-" + $security.randomString(20).toUpperCase());
  e.record.set("claimed_by", "");
  e.record.set("claimed_at", "");
  e.next();
}, "invites");

// Evidence is always attributed to the current member and begins pending.
// Curators approve or reject it in the operator interface.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth) {
    throw new BadRequestError("Sign in to submit visit evidence.");
  }

  e.record.set("member", e.auth.id);
  e.record.set("status", "pending");
  e.record.set("curator_note", "");
  e.next();
}, "visit_evidence");

// PocketBase select fields do not have a schema-level default. Normalize every
// public recommendation to pending before validation, regardless of any status
// supplied by the caller. Superusers retain explicit moderation-state control.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    e.record.set("status", "pending");
  }
  e.next();
}, "recommendations");

// Every server-side Detour community award creation carries the catalogue lane
// marker, including automatic waiting-list publication and the legacy curator
// route below. Other award sources keep their explicitly supplied provenance.
onRecordCreate((e) => {
  if (!e.record.getString("provenance")) {
    const sourceId = e.record.getString("source");
    if (sourceId) {
      const source = e.app.findRecordById("guide_sources", sourceId);
      if (source.getString("slug") === "detour-community") {
        e.record.set("provenance", "community_selection");
      }
    }
  }
  e.next();
}, "venue_awards");

// A verified member recommendation is one independent signal on the shared,
// normalized waiting-list entry. All attribution, place resolution, private
// participant state, and publication state are server-owned.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "recommending a place");

  const note = community.validateRecommendationNote(e.record.getString("note"));
  const category = community.validateCategory(e.record.getString("category"));
  const occasions = community.validateOccasions(e.record.getStringSlice("occasions"));
  const resolved = community.resolveEntry(e.app, e.record.getString("waitlist"), {
    venueName: e.record.getString("venue_name"),
    city: e.record.getString("city"),
    country: e.record.getString("country"),
    address: e.record.getString("address"),
  });
  community.ensureEntryPending(resolved.entry, "recommended again");
  community.mergePlaceFacts(e.app, resolved.entry, category, occasions);

  const duplicate = community.findMemberRecommendation(
    e.app,
    e.auth.id,
    resolved.entry.id
  );
  if (duplicate) {
    // A retry after an after-create publication failure must still reconcile
    // the already-committed signal before returning the duplicate response.
    community.recalculateAndPublish(e.app, resolved.entry.id);
    throw new BadRequestError("You have already recommended this place.");
  }

  community.addParticipants(e.app, resolved.entry, [e.auth.id]);
  e.record.set("member", e.auth.id);
  e.record.set("waitlist", resolved.entry.id);
  e.record.set("note", note);
  e.record.set("venue_name", resolved.entry.getString("venue_name"));
  e.record.set("city", resolved.entry.getString("city"));
  e.record.set("country", resolved.entry.getString("country"));
  e.record.set("address", resolved.entry.getString("address"));
  e.record.set("category", category);
  e.record.set("occasions", occasions);
  e.next();
}, "community_recommendations");

onRecordAfterCreateSuccess((e) => {
  const community = require(__hooks + "/community_waitlist.js");
  const waitlistId = e.record.getString("waitlist");
  community.recalculateAndPublish(e.app, waitlistId);
  // Publication happened inside the transaction above; the external
  // address/location validation runs after it so a geocoder outage can never
  // block or roll back the publish. Failures are retried by the nightly sweep.
  try {
    const entry = e.app.findRecordById("community_waitlist_entries", waitlistId);
    const publishedVenue = entry.getString("published_venue");
    if (entry.getString("status") === "published" && publishedVenue) {
      community.geocodeVenue(e.app, publishedVenue);
    }
  } catch {
    // Entry lookup is best-effort; the sweep covers anything missed.
  }
  e.next();
}, "community_recommendations");

// Nightly retry for published community venues that still lack verified
// coordinates (geocoder outage, no-match addresses corrected later, …).
// geocodeVenue exits early for venues that already have coordinates.
cronAdd("community_geocode_sweep", "0 4 * * *", () => {
  const community = require(__hooks + "/community_waitlist.js");
  let awards = [];
  try {
    awards = $app.findRecordsByFilter(
      "venue_awards",
      "level = 'Detour community selection' && current = true",
      "-created",
      50,
      0
    );
  } catch {
    return;
  }
  for (const award of awards) {
    const venueId = award.getString("venue");
    if (venueId) community.geocodeVenue($app, venueId);
  }
});

// Deleting a pending signal updates the server-maintained count. A place that
// has already auto-published remains a public selection and is never
// automatically withdrawn merely because a later recommendation is removed.
onRecordAfterDeleteSuccess((e) => {
  const { recalculateAndPublish } = require(__hooks + "/community_waitlist.js");
  recalculateAndPublish(e.app, e.record.getString("waitlist"));
  e.next();
}, "community_recommendations");

// A share sends a place to another member with a personal note. The place is
// either an existing catalogue venue (referenced directly) or the sender's own
// place, which enters the shared waiting list. A share never counts as a
// recommendation signal.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "sharing a place");

  const recipientId = e.record.getString("recipient");
  if (!recipientId) {
    throw new BadRequestError("Choose a Detour member to share with.");
  }
  if (recipientId === e.auth.id) {
    throw new BadRequestError("You cannot share a place with yourself.");
  }
  let recipient;
  try {
    recipient = e.app.findRecordById("members", recipientId);
  } catch {
    throw new BadRequestError("The share recipient is not a valid Detour member.");
  }

  const note = community.validateShareNote(e.record.getString("personal_note"));

  const venueId = e.record.getString("venue");
  if (venueId) {
    let venue;
    try {
      venue = e.app.findRecordById("venues", venueId);
    } catch {
      throw new BadRequestError("The shared place is not in the Detour selection.");
    }
    e.record.set("waitlist", "");
    e.record.set("venue_name", venue.getString("name"));
    e.record.set("city", venue.getString("city"));
    e.record.set("country", venue.getString("country"));
    e.record.set("address", venue.getString("address"));
  } else {
    const resolved = community.resolveEntry(e.app, e.record.getString("waitlist"), {
      venueName: e.record.getString("venue_name"),
      city: e.record.getString("city"),
      country: e.record.getString("country"),
      address: e.record.getString("address"),
    });
    // A place that already published is shared as its catalogue venue; an
    // unpublished one links the sender to its waiting-list entry.
    const publishedVenue = resolved.entry.getString("published_venue");
    if (resolved.entry.getString("status") === "published" && publishedVenue) {
      e.record.set("venue", publishedVenue);
      e.record.set("waitlist", "");
    } else {
      community.addParticipants(e.app, resolved.entry, [e.auth.id]);
      e.record.set("waitlist", resolved.entry.id);
    }
    e.record.set("venue_name", resolved.entry.getString("venue_name"));
    e.record.set("city", resolved.entry.getString("city"));
    e.record.set("country", resolved.entry.getString("country"));
    e.record.set("address", resolved.entry.getString("address"));
  }

  e.record.set("sender", e.auth.id);
  e.record.set("recipient", recipientId);
  e.record.set("sender_name", e.auth.getString("display_name") || "A Detour member");
  e.record.set("recipient_name", recipient.getString("display_name") || "A Detour member");
  e.record.set("sender_pseudo", e.auth.getString("pseudo"));
  e.record.set("recipient_pseudo", recipient.getString("pseudo"));
  e.record.set("personal_note", note);
  e.record.set("seen", false);
  e.next();
}, "community_shares");

// The recipient's inbox marks shares as seen; every other share field is
// server-owned and immutable after creation.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.id !== e.record.getString("recipient")) {
    throw new BadRequestError("Only the recipient can update a share.");
  }
  const original = e.record.original();
  const frozen = [
    "sender",
    "recipient",
    "waitlist",
    "venue",
    "personal_note",
    "venue_name",
    "city",
    "country",
    "address",
    "sender_name",
    "recipient_name",
    "sender_pseudo",
    "recipient_pseudo",
  ];
  for (const field of frozen) {
    if (e.record.getString(field) !== original.getString(field)) {
      throw new BadRequestError("Only the seen state of a share can change.");
    }
  }
  e.next();
}, "community_shares");

// Replies are contextual to one existing share, never a generic chat/feed. The
// server owns author attribution and accepts replies only from a verified share
// participant.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "replying to a shared place");

  const shareId = e.record.getString("share");
  if (!shareId) {
    throw new BadRequestError("Choose a valid shared place to reply to.");
  }

  let share;
  try {
    share = e.app.findRecordById("community_shares", shareId);
  } catch {
    throw new BadRequestError("The referenced shared place is not available.");
  }
  if (
    share.getString("sender") !== e.auth.id &&
    share.getString("recipient") !== e.auth.id
  ) {
    throw new BadRequestError("Only the share participants can reply.");
  }

  const rawBody = String(e.record.getString("body") || "");
  if (rawBody.length > 1200) {
    throw new BadRequestError("A reply can be at most 1200 characters.");
  }
  const body = rawBody
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = body
    .split(/\s+/)
    .map((word) =>
      word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, "")
    )
    .filter((word) => word.length >= 2);
  if (body.length < 8 || words.length < 2) {
    throw new BadRequestError("Add a thoughtful reply of at least 8 characters and two words.");
  }

  const authorName = e.auth.getString("display_name") || "A Detour member";
  const authorPseudo = e.auth.getString("pseudo");
  if (!authorPseudo) {
    throw new BadRequestError("Complete your member pseudo before replying.");
  }

  e.record.set("share", share.id);
  e.record.set("author", e.auth.id);
  e.record.set("author_name", authorName);
  e.record.set("author_pseudo", authorPseudo);
  e.record.set("body", body);
  e.next();
}, "community_share_replies");

// Member replies cannot be edited or deleted after creation. This preserves
// the private thread as sent while still allowing superuser moderation tools.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  throw new BadRequestError("Replies cannot be edited after they are sent.");
}, "community_share_replies");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  throw new BadRequestError("Replies cannot be deleted after they are sent.");
}, "community_share_replies");

// Recommendations enter a private, pending curation queue. A verified status
// is checked server-side as well as in the collection rule.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError("Verified Detour membership is required before submitting a detour.");
  }

  e.record.set("member", e.auth.id);
  e.record.set("status", "pending");
  e.record.set("curator_note", "");
  e.next();
}, "detour_submissions");

// Olga and other authorized curators can retain the historic founding-cohort
// marker. Invitation redemption remains the membership requirement, so this
// legacy field never revokes active membership.
routerAdd(
  "POST",
  "/api/detour/curation/members/{id}/founding-verification",
  (e) => {
    const body = e.requestInfo().body || {};
    const memberId = e.request.pathValue("id");
    const verified = body.verified === undefined ? true : body.verified;

    if (typeof verified !== "boolean") {
      throw new BadRequestError("verified must be a boolean.");
    }

    const member = e.app.findRecordById("members", memberId);
    member.set("founding_verified", verified);
    member.set("community_status", "verified");
    e.app.save(member);

    const updated = e.app.findRecordById("members", member.id);
    return e.json(200, {
      member_id: updated.id,
      founding_verified: updated.getBool("founding_verified"),
      community_status: updated.getString("community_status"),
    });
  },
  $apis.requireSuperuserAuth()
);

// Publication is deliberately a curator-only action rather than a record update.
// It writes the safe public catalogue facts and the private audit link together
// in one transaction, so a submission is never marked published on its own.
routerAdd(
  "POST",
  "/api/detour/curation/submissions/{id}/publish",
  (e) => {
    const body = e.requestInfo().body || {};
    const submissionId = e.request.pathValue("id");
    const country = typeof body.country === "string" ? body.country.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const officialUrl = typeof body.official_url === "string" ? body.official_url.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const hasLat = typeof body.lat === "number";
    const hasLng = typeof body.lng === "number";

    function requireCheck(name) {
      if (body[name] !== true) {
        throw new BadRequestError("Curator confirmation is required: " + name + ".");
      }
    }

    let result;
    e.app.runInTransaction((txApp) => {
      const submission = txApp.findRecordById("detour_submissions", submissionId);
      const status = submission.getString("status");
      const member = txApp.findRecordById("members", submission.getString("member"));
      const venueName = submission.getString("venue_name").trim();
      const city = submission.getString("city").trim();

      if (
        member.getString("email") === "community-proof@detour.invalid" ||
        venueName === "Editorial curation proof — not public"
      ) {
        throw new BadRequestError("The reserved community proof fixture can never be published.");
      }
      if (status === "published") {
        const publishedVenueId = submission.getString("published_venue");
        const publishedAwardId = submission.getString("published_award");
        if (!publishedVenueId || !publishedAwardId) {
          throw new BadRequestError("This published submission is missing its private publication audit link.");
        }
        result = {
          submission_id: submission.id,
          venue_id: publishedVenueId,
          award_id: publishedAwardId,
          status: "published",
          attribution: "Detour community selection",
          idempotent: true,
        };
        return;
      }
      if (status !== "approved") {
        throw new BadRequestError("Only an approved submission can be published.");
      }
      if (!country || country.length > 120) {
        throw new BadRequestError("A separately verified country is required.");
      }
      if (address.length > 300 || officialUrl.length > 2048 || category.length > 120) {
        throw new BadRequestError("One or more public venue fields exceed their allowed length.");
      }
      requireCheck("identity_checked");
      requireCheck("official_url_checked");
      requireCheck("rights_checked");
      requireCheck("consent_checked");
      requireCheck("editorial_selected");
      if (address) requireCheck("address_checked");
      if (hasLat !== hasLng) {
        throw new BadRequestError("Latitude and longitude must be supplied together.");
      }
      if (hasLat) {
        if (
          !body.location_verified ||
          typeof body.location_approximate !== "boolean" ||
          body.lat < -90 ||
          body.lat > 90 ||
          body.lng < -180 ||
          body.lng > 180
        ) {
          throw new BadRequestError("Verified, qualified coordinates are required for a public map location.");
        }
      } else if (body.location_verified === true || body.location_approximate !== undefined) {
        throw new BadRequestError("Location qualification may be supplied only with latitude and longitude.");
      }
      if (!venueName || !city) {
        throw new BadRequestError("The approved submission is missing a venue name or city.");
      }

      let venue;
      try {
        venue = txApp.findFirstRecordByFilter(
          "venues",
          "name = {:name} && city = {:city}",
          { name: venueName, city: city }
        );
      } catch {
        const venues = txApp.findCollectionByNameOrId("venues");
        venue = new Record(venues);
        venue.set("name", venueName);
        venue.set("city", city);
        venue.set("country", country);
        venue.set("address", address);
        venue.set("official_url", officialUrl);
        venue.set("category", category);
        venue.set("approx_location", hasLat ? body.location_approximate : false);
        if (hasLat) {
          venue.set("lat", body.lat);
          venue.set("lng", body.lng);
        }
        txApp.save(venue);
      }

      if (venue.getString("country").trim().toLowerCase() !== country.toLowerCase()) {
        throw new BadRequestError("The canonical venue country does not match the curator-verified country.");
      }

      let source;
      try {
        source = txApp.findFirstRecordByFilter(
          "guide_sources",
          "slug = 'detour-community'"
        );
      } catch {
        const sources = txApp.findCollectionByNameOrId("guide_sources");
        source = new Record(sources);
        source.set("name", "Detour community");
        source.set("slug", "detour-community");
        source.set("official_url", "");
        source.set("current_year", new Date().getUTCFullYear());
        txApp.save(source);
      }

      const year = new Date().getUTCFullYear();
      let award;
      try {
        award = txApp.findFirstRecordByFilter(
          "venue_awards",
          "source = {:source} && venue = {:venue} && year = {:year} && level = {:level}",
          {
            source: source.id,
            venue: venue.id,
            year: year,
            level: "Detour community selection",
          }
        );
      } catch {
        // The unique source/venue/year/level index makes this creation path
        // converge if a retry follows a failed transaction.
      }
      if (award) {
        award.set("source_url", "");
        award.set("current", true);
        award.set("verification_status", "verified");
        txApp.save(award);
      } else {
        const awards = txApp.findCollectionByNameOrId("venue_awards");
        award = new Record(awards);
        award.set("source", source.id);
        award.set("venue", venue.id);
        award.set("year", year);
        award.set("level", "Detour community selection");
        award.set("rank", 0);
        award.set("source_url", "");
        award.set("current", true);
        award.set("verification_status", "verified");
        txApp.save(award);
      }

      submission.set("published_venue", venue.id);
      submission.set("published_award", award.id);
      submission.set("published_at", new Date().toISOString());
      submission.set("publication_audit_id", "dc-" + $security.randomString(32));
      submission.set("status", "published");
      txApp.save(submission);

      result = {
        submission_id: submission.id,
        venue_id: venue.id,
        award_id: award.id,
        status: "published",
        attribution: "Detour community selection",
        idempotent: false,
      };
    });

    return e.json(200, result);
  },
  $apis.requireSuperuserAuth()
);

// Corrections and rights concerns remove the community label first while
// retaining the private submission for an audited re-review or rejection.
routerAdd(
  "POST",
  "/api/detour/curation/submissions/{id}/unpublish",
  (e) => {
    const submissionId = e.request.pathValue("id");
    let result;

    e.app.runInTransaction((txApp) => {
      const submission = txApp.findRecordById("detour_submissions", submissionId);
      if (submission.getString("status") !== "published") {
        result = {
          submission_id: submission.id,
          status: submission.getString("status"),
          idempotent: true,
        };
        return;
      }

      const awardId = submission.getString("published_award");
      if (awardId) {
        const award = txApp.findRecordById("venue_awards", awardId);
        const source = txApp.findRecordById("guide_sources", award.getString("source"));
        if (source.getString("slug") !== "detour-community") {
          throw new BadRequestError("The submission publication audit link is not a Detour community selection.");
        }
        if (award.getBool("current")) {
          award.set("current", false);
          txApp.save(award);
        }
      }

      submission.set("published_venue", "");
      submission.set("published_award", "");
      submission.set("published_at", "");
      submission.set("publication_audit_id", "");
      submission.set("status", "approved");
      txApp.save(submission);
      result = { submission_id: submission.id, status: "approved", idempotent: false };
    });

    return e.json(200, result);
  },
  $apis.requireSuperuserAuth()
);

// Member-contributed places use a distinct curator-reviewed lane. The request
// hook owns attribution, private moderation state, normalization, rate limits,
// and open-submission duplicate protection; it never writes catalogue venues.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError(
      "Verified Detour membership is required before contributing a place."
    );
  }

  function cleanText(value, max, label) {
    let cleaned = String(value || "");
    if (typeof cleaned.normalize === "function") {
      cleaned = cleaned.normalize("NFKC");
    }
    cleaned = cleaned
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > max) {
      throw new BadRequestError(label + " is too long.");
    }
    return cleaned;
  }

  function normalizePlacePart(value) {
    let normalized = value;
    if (typeof normalized.normalize === "function") {
      normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
    return normalized
      .toLowerCase()
      .replace(/[’'`´]/g, "")
      .replace(/&/g, " and ")
      .replace(/[\u2010-\u2015]/g, " ")
      .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const privateInput = new DynamicModel({ recommendation_note: "" });
  e.bindBody(privateInput);
  const placeName = cleanText(e.record.getString("place_name"), 200, "Place name");
  const city = cleanText(e.record.getString("city"), 120, "City");
  const country = cleanText(e.record.getString("country"), 120, "Country");
  const address = cleanText(e.record.getString("address"), 300, "Address");
  // Hidden fields are not hydrated from the public record input, so read the
  // private recommendation directly from this create request and then set it
  // on the record after validation.
  const recommendationNote = cleanText(
    privateInput.recommendation_note,
    2400,
    "Recommendation note"
  );
  const normalizedName = normalizePlacePart(placeName);
  const normalizedCity = normalizePlacePart(city);

  if (placeName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid place name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }
  if (country.length < 2) {
    throw new BadRequestError("A valid country is required.");
  }

  const noteWords = recommendationNote
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ""))
    .filter((word) => word.length >= 2);
  if (recommendationNote.length < 24 || noteWords.length < 5) {
    throw new BadRequestError(
      "Add a meaningful recommendation of at least 24 characters and five words."
    );
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ");
  const recentContributions = e.app.findRecordsByFilter(
    "member_place_contributions",
    "member = {:member} && created >= {:cutoff}",
    "-created",
    5,
    0,
    { member: e.auth.id, cutoff: cutoff }
  );
  if (recentContributions.length >= 5) {
    throw new BadRequestError(
      "You can contribute up to five places in any seven-day period."
    );
  }

  let duplicate = null;
  try {
    duplicate = e.app.findFirstRecordByFilter(
      "member_place_contributions",
      "normalized_name = {:name} && normalized_city = {:city} && (status = 'in_review' || status = 'approved')",
      { name: normalizedName, city: normalizedCity }
    );
  } catch {
    // No open contribution currently has this normalized place identity.
  }
  if (duplicate) {
    throw new BadRequestError(
      "This place already has a contribution in review or approved for this city."
    );
  }

  e.record.set("place_name", placeName);
  e.record.set("city", city);
  e.record.set("country", country);
  e.record.set("address", address);
  e.record.set("recommendation_note", recommendationNote);
  e.record.set("normalized_name", normalizedName);
  e.record.set("normalized_city", normalizedCity);
  e.record.set("member", e.auth.id);
  e.record.set("source", "member_recommended");
  e.record.set("status", "in_review");
  e.record.set("curator_note", "");
  e.record.set("reviewed_at", "");
  e.next();
}, "member_place_contributions");

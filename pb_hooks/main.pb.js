/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/supernaut/ready", (event) => {
  return event.json(200, { ok: true });
});

// These private routes bypass member rules only for explicit safe projections.
routerAdd(
  "GET",
  "/api/detour/community/me",
  (e) => {
    const memberId = e.auth.id;
    let qualifyingCount = 0;
    let offset = 0;

    while (true) {
      const qualifying = e.app.findRecordsByFilter(
        "endorsements",
        "endorsee = {:endorsee} && active = true && endorser.community_status = 'verified'",
        "id",
        1000,
        offset,
        { endorsee: memberId }
      );
      qualifyingCount += qualifying.length;
      if (qualifying.length < 1000) {
        break;
      }
      offset += qualifying.length;
    }

    let outgoingActiveCount = 0;
    offset = 0;
    while (true) {
      const outgoing = e.app.findRecordsByFilter(
        "endorsements",
        "endorser = {:endorser} && active = true",
        "id",
        1000,
        offset,
        { endorser: memberId }
      );
      outgoingActiveCount += outgoing.length;
      if (outgoing.length < 1000) {
        break;
      }
      offset += outgoing.length;
    }

    return e.json(200, {
      member: {
        id: memberId,
        display_name: e.auth.getString("display_name"),
        community_status: e.auth.getString("community_status"),
      },
      endorsements: {
        qualifying_count: qualifyingCount,
        outgoing_active_count: outgoingActiveCount,
        limit: 3,
      },
    });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "GET",
  "/api/detour/member-directory",
  (e) => {
    const rawQuery = e.request.url.query().get("q") || "";
    const query = rawQuery
      .slice(0, 100)
      .replace(/[\x00-\x1F\x7F%_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (query.length < 2) {
      throw new BadRequestError("q must contain at least two searchable characters.");
    }

    const matches = e.app.findRecordsByFilter(
      "members",
      "id != {:member} && display_name ~ {:query}",
      "display_name",
      12,
      0,
      { member: e.auth.id, query: query }
    );
    const candidates = [];
    for (const match of matches) {
      candidates.push({
        id: match.id,
        display_name: match.getString("display_name"),
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
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

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

  e.record.set("invite_code", "");
  e.record.set("invited_by", invite.getString("issued_by"));
  e.record.set("redeemed_invite", invite.id);
  e.record.set("community_status", "unverified");
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
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.id !== e.record.id) {
    throw new BadRequestError("You can update only your own member profile.");
  }

  const original = e.record.original();
  if (
    e.record.getString("community_status") !== original.getString("community_status") ||
    e.record.getBool("founding_verified") !== original.getBool("founding_verified") ||
    e.record.getString("invited_by") !== original.getString("invited_by") ||
    e.record.getString("redeemed_invite") !== original.getString("redeemed_invite")
  ) {
    throw new BadRequestError("Membership verification and invitation details are managed by Detour.");
  }
  e.record.set("invite_code", "");
  e.next();
}, "members");

// Invitation codes are generated server-side and are always assigned to the
// authenticated member who created the invite.
onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    if (e.hasSuperuserAuth()) {
      return e.next();
    }
    throw new BadRequestError("Sign in to issue an invitation.");
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

// Endorsements are private trust records. Public creation is available only to
// verified member accounts; the server owns attribution and active state.
onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    throw new BadRequestError("Sign in with a verified Detour member account to endorse someone.");
  }
  if (e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError("Only verified Detour members can create endorsements.");
  }

  const endorseeId = e.record.getString("endorsee");
  if (!endorseeId) {
    throw new BadRequestError("Choose a Detour member to endorse.");
  }
  if (endorseeId === e.auth.id) {
    throw new BadRequestError("You cannot endorse yourself.");
  }

  let duplicate = false;
  try {
    e.app.findFirstRecordByFilter(
      "endorsements",
      "endorser = {:endorser} && endorsee = {:endorsee}",
      { endorser: e.auth.id, endorsee: endorseeId }
    );
    duplicate = true;
  } catch {
    duplicate = false;
  }
  if (duplicate) {
    throw new BadRequestError("You have already endorsed this member.");
  }

  const activeOutgoing = e.app.findRecordsByFilter(
    "endorsements",
    "endorser = {:endorser} && active = true",
    "",
    3,
    0,
    { endorser: e.auth.id }
  );
  if (activeOutgoing.length >= 3) {
    throw new BadRequestError("You can have at most three active outgoing endorsements.");
  }

  e.record.set("endorser", e.auth.id);
  e.record.set("active", true);
  e.next();
}, "endorsements");

onRecordAfterCreateSuccess((e) => {
  const { recalculateVerification } = require(__hooks + "/endorsement_verification.js");
  recalculateVerification(e.app, e.record.getString("endorsee"));
  e.next();
}, "endorsements");

onRecordAfterDeleteSuccess((e) => {
  const { recalculateVerification } = require(__hooks + "/endorsement_verification.js");
  recalculateVerification(e.app, e.record.getString("endorsee"));
  e.next();
}, "endorsements");

// PocketBase select fields do not have a schema-level default. Normalize every
// public recommendation to pending before validation, regardless of any status
// supplied by the caller. Superusers retain explicit moderation-state control.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    e.record.set("status", "pending");
  }
  e.next();
}, "recommendations");

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
  const resolved = community.resolveEntry(e.app, e.record.getString("waitlist"), {
    venueName: e.record.getString("venue_name"),
    city: e.record.getString("city"),
    country: e.record.getString("country"),
  });
  community.ensureEntryPending(resolved.entry, "recommended again");

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
  e.next();
}, "community_recommendations");

onRecordAfterCreateSuccess((e) => {
  const { recalculateAndPublish } = require(__hooks + "/community_waitlist.js");
  recalculateAndPublish(e.app, e.record.getString("waitlist"));
  e.next();
}, "community_recommendations");

// Deleting a pending signal updates the server-maintained count. A place that
// has already auto-published remains a public selection and is never
// automatically withdrawn merely because a later recommendation is removed.
onRecordAfterDeleteSuccess((e) => {
  const { recalculateAndPublish } = require(__hooks + "/community_waitlist.js");
  recalculateAndPublish(e.app, e.record.getString("waitlist"));
  e.next();
}, "community_recommendations");

// Shares are private invitations into an existing waiting-list entry. A share
// creates no recommendation signal; it only links the sender and recipient as
// private participants so the recipient can add their own independent note.
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
  try {
    e.app.findRecordById("members", recipientId);
  } catch {
    throw new BadRequestError("The share recipient is not a valid Detour member.");
  }

  const note = community.validateShareNote(e.record.getString("personal_note"));
  const requestedWaitlistId = e.record.getString("waitlist");
  const resolved = community.resolveEntry(e.app, requestedWaitlistId, {
    venueName: e.record.getString("venue_name"),
    city: e.record.getString("city"),
    country: e.record.getString("country"),
  });
  community.ensureEntryPending(resolved.entry, "shared from the waiting list");

  // Supplying safe place fields may create a new entry, but if those fields
  // resolve to someone else's existing queue entry the sender must already be
  // a participant before they can share it.
  if (!resolved.created && !community.isParticipant(resolved.entry, e.auth.id)) {
    throw new BadRequestError(
      "Only a participant can share an existing waiting-list entry."
    );
  }

  community.addParticipants(e.app, resolved.entry, [e.auth.id, recipientId]);
  e.record.set("sender", e.auth.id);
  e.record.set("recipient", recipientId);
  e.record.set("waitlist", resolved.entry.id);
  e.record.set("personal_note", note);
  e.record.set("venue_name", resolved.entry.getString("venue_name"));
  e.record.set("city", resolved.entry.getString("city"));
  e.record.set("country", resolved.entry.getString("country"));
  e.next();
}, "community_shares");

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

// Olga and other authorized curators can explicitly preserve or revoke a
// member's founding-cohort verification. Endorsement consequences are
// recalculated immediately and propagated through the private trust graph.
routerAdd(
  "POST",
  "/api/detour/curation/members/{id}/founding-verification",
  (e) => {
    const { recalculateVerification } = require(__hooks + "/endorsement_verification.js");
    const body = e.requestInfo().body || {};
    const memberId = e.request.pathValue("id");
    const verified = body.verified === undefined ? true : body.verified;

    if (typeof verified !== "boolean") {
      throw new BadRequestError("verified must be a boolean.");
    }

    const member = e.app.findRecordById("members", memberId);
    member.set("founding_verified", verified);
    e.app.save(member);
    recalculateVerification(e.app, member.id);

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

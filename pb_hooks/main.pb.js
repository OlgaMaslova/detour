/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/supernaut/ready", (event) => {
  return event.json(200, { ok: true });
});

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

// A member is verified exactly when they have three approved, distinct venue
// visits. Rejections or curator reversals can therefore remove verification.
onRecordAfterCreateSuccess((e) => {
  const memberId = e.record.getString("member");
  if (memberId) {
    const approvedCount = e.app.countRecords(
      "visit_evidence",
      $dbx.hashExp({ member: memberId, status: "approved" })
    );
    const member = e.app.findRecordById("members", memberId);
    const requiredStatus = approvedCount >= 3 ? "verified" : "unverified";
    if (member.getString("community_status") !== requiredStatus) {
      member.set("community_status", requiredStatus);
      e.app.save(member);
    }
  }
  e.next();
}, "visit_evidence");

onRecordAfterUpdateSuccess((e) => {
  const memberId = e.record.getString("member");
  if (memberId) {
    const approvedCount = e.app.countRecords(
      "visit_evidence",
      $dbx.hashExp({ member: memberId, status: "approved" })
    );
    const member = e.app.findRecordById("members", memberId);
    const requiredStatus = approvedCount >= 3 ? "verified" : "unverified";
    if (member.getString("community_status") !== requiredStatus) {
      member.set("community_status", requiredStatus);
      e.app.save(member);
    }
  }
  e.next();
}, "visit_evidence");

onRecordAfterDeleteSuccess((e) => {
  const memberId = e.record.getString("member");
  if (memberId) {
    const approvedCount = e.app.countRecords(
      "visit_evidence",
      $dbx.hashExp({ member: memberId, status: "approved" })
    );
    const member = e.app.findRecordById("members", memberId);
    const requiredStatus = approvedCount >= 3 ? "verified" : "unverified";
    if (member.getString("community_status") !== requiredStatus) {
      member.set("community_status", requiredStatus);
      e.app.save(member);
    }
  }
  e.next();
}, "visit_evidence");

// Recommendations enter a private, pending curation queue. A verified status
// is checked server-side as well as in the collection rule.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError("Three approved visits are required before submitting a detour.");
  }

  e.record.set("member", e.auth.id);
  e.record.set("status", "pending");
  e.record.set("curator_note", "");
  e.next();
}, "detour_submissions");

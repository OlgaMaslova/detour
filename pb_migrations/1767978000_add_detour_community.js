/// <reference path="../pb_data/types.d.ts" />
//
// Detour's invite-only community foundation. Each operation is guarded so a
// partial migration can converge safely on the next boot without replacing
// existing production data.
migrate((app) => {
  function getOrCreateCollection(name, type) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return new Collection({ name, type });
    }
  }

  function addFieldIfMissing(collection, field) {
    if (!collection.fields.getByName(field.name)) {
      collection.fields.add(field);
    }
  }

  function addIndexIfMissing(collection, index) {
    if (collection.indexes.indexOf(index) === -1) {
      collection.indexes.push(index);
    }
  }

  // ---------- members (auth + member profile) ----------
  const members = getOrCreateCollection("members", "auth");
  addFieldIfMissing(members, new TextField({ name: "display_name", required: true, max: 100 }));
  addFieldIfMissing(
    members,
    new SelectField({
      name: "community_status",
      required: true,
      values: ["unverified", "verified"],
      maxSelect: 1,
    })
  );
  // The submitted code is transient: the signup hook validates and clears it.
  addFieldIfMissing(members, new TextField({ name: "invite_code", max: 80 }));
  members.listRule = "@request.auth.id != '' && id = @request.auth.id";
  members.viewRule = "@request.auth.id != '' && id = @request.auth.id";
  members.createRule = "";
  members.updateRule = "@request.auth.id != '' && id = @request.auth.id";
  members.deleteRule = null;
  app.save(members);

  // Self-relations require the generated collection id, which is available
  // only after the first save of a newly created auth collection.
  addFieldIfMissing(
    members,
    new RelationField({
      name: "invited_by",
      hidden: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  app.save(members);

  // ---------- invites ----------
  const invites = getOrCreateCollection("invites", "base");
  addFieldIfMissing(
    invites,
    new RelationField({
      name: "issued_by",
      required: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(invites, new TextField({ name: "code", required: true, max: 80 }));
  addFieldIfMissing(
    invites,
    new RelationField({
      name: "claimed_by",
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(invites, new DateField({ name: "claimed_at" }));
  addFieldIfMissing(invites, new AutodateField({ name: "created", onCreate: true }));
  addFieldIfMissing(invites, new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  addIndexIfMissing(invites, "CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code ON invites (code)");
  addIndexIfMissing(invites, "CREATE INDEX IF NOT EXISTS idx_invites_issued_by ON invites (issued_by)");
  addIndexIfMissing(invites, "CREATE INDEX IF NOT EXISTS idx_invites_claimed_by ON invites (claimed_by)");
  invites.listRule = "@request.auth.id != '' && (issued_by = @request.auth.id || claimed_by = @request.auth.id)";
  invites.viewRule = "@request.auth.id != '' && (issued_by = @request.auth.id || claimed_by = @request.auth.id)";
  // The create hook assigns issued_by and code after the rule check.
  invites.createRule = "@request.auth.id != ''";
  invites.updateRule = null;
  invites.deleteRule = null;
  app.save(invites);

  // The member-to-invite relation is added only after both collections exist.
  // Its unique index makes a code unambiguously redeemable only once, including
  // concurrent redemption attempts.
  addFieldIfMissing(
    members,
    new RelationField({
      name: "redeemed_invite",
      hidden: true,
      collectionId: invites.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  const redeemedInvite = members.fields.getByName("redeemed_invite");
  if (redeemedInvite) {
    redeemedInvite.collectionId = invites.id;
  }
  addIndexIfMissing(
    members,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_members_redeemed_invite ON members (redeemed_invite) WHERE redeemed_invite != ''"
  );
  app.save(members);

  // ---------- visit evidence ----------
  const venues = app.findCollectionByNameOrId("venues");
  const visitEvidence = getOrCreateCollection("visit_evidence", "base");
  addFieldIfMissing(
    visitEvidence,
    new RelationField({
      name: "member",
      required: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: true,
    })
  );
  addFieldIfMissing(
    visitEvidence,
    new RelationField({
      name: "venue",
      required: true,
      collectionId: venues.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(visitEvidence, new URLField({ name: "evidence_url" }));
  addFieldIfMissing(visitEvidence, new TextField({ name: "note", required: true, max: 1200 }));
  addFieldIfMissing(
    visitEvidence,
    new SelectField({
      name: "status",
      required: true,
      values: ["pending", "approved", "rejected"],
      maxSelect: 1,
    })
  );
  addFieldIfMissing(visitEvidence, new TextField({ name: "curator_note", hidden: true, max: 1200 }));
  addFieldIfMissing(visitEvidence, new AutodateField({ name: "created", onCreate: true }));
  addFieldIfMissing(visitEvidence, new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  addIndexIfMissing(
    visitEvidence,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_evidence_member_venue ON visit_evidence (member, venue)"
  );
  addIndexIfMissing(
    visitEvidence,
    "CREATE INDEX IF NOT EXISTS idx_visit_evidence_member_status ON visit_evidence (member, status)"
  );
  visitEvidence.listRule = "@request.auth.id != '' && member = @request.auth.id";
  visitEvidence.viewRule = "@request.auth.id != '' && member = @request.auth.id";
  // The create hook assigns member and enforces the pending state.
  visitEvidence.createRule = "@request.auth.id != ''";
  visitEvidence.updateRule = null;
  visitEvidence.deleteRule = null;
  app.save(visitEvidence);

  // ---------- detour submissions (private editorial curation queue) ----------
  const submissions = getOrCreateCollection("detour_submissions", "base");
  addFieldIfMissing(
    submissions,
    new RelationField({
      name: "member",
      required: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: true,
    })
  );
  addFieldIfMissing(
    submissions,
    new RelationField({
      name: "venue",
      collectionId: venues.id,
      maxSelect: 1,
      cascadeDelete: false,
    })
  );
  addFieldIfMissing(submissions, new TextField({ name: "venue_name", required: true, max: 200 }));
  addFieldIfMissing(submissions, new TextField({ name: "city", required: true, max: 120 }));
  addFieldIfMissing(submissions, new TextField({ name: "address", max: 300 }));
  addFieldIfMissing(submissions, new TextField({ name: "detour_note", required: true, max: 2400 }));
  addFieldIfMissing(submissions, new URLField({ name: "source_url" }));
  addFieldIfMissing(
    submissions,
    new SelectField({
      name: "status",
      required: true,
      values: ["pending", "approved", "rejected"],
      maxSelect: 1,
    })
  );
  addFieldIfMissing(submissions, new TextField({ name: "curator_note", hidden: true, max: 1200 }));
  addFieldIfMissing(submissions, new AutodateField({ name: "created", onCreate: true }));
  addFieldIfMissing(submissions, new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  addIndexIfMissing(
    submissions,
    "CREATE INDEX IF NOT EXISTS idx_detour_submissions_member_status ON detour_submissions (member, status)"
  );
  submissions.listRule = "@request.auth.id != '' && member = @request.auth.id";
  submissions.viewRule = "@request.auth.id != '' && member = @request.auth.id";
  // The create hook assigns member and always resets status to pending.
  submissions.createRule = "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  submissions.updateRule = null;
  submissions.deleteRule = null;
  app.save(submissions);
}, (app) => {
  // The community data is user-created production data. Deliberately no down
  // migration deletes it.
});

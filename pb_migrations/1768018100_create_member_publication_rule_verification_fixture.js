/// <reference path="../pb_data/types.d.ts" />
//
// Creates one private runtime credential and invitation-backed internal member
// for a controlled browser verification of immediate member publication. The
// reserved .invalid fixture is issued by a known non-Founder member and is kept
// out of member discovery and operational notifications.
//
// This migration is forward-only and convergent. A separate cleanup migration
// will remove the fixture, its already-claimed internal invite, and the private
// credentials collection after the browser verification is complete.
migrate((app) => {
  const COLLECTION_NAME = "member_publication_rule_verification_credentials";
  const FIXTURE_EMAIL = "member-publication-rule-verification@detour.invalid";
  const FIXTURE_DISPLAY_NAME = "Detour member publication rule verification fixture";
  const ISSUER_ID = "8zekkzyjrgmg9fx";
  const INVITE_ID = "mempubverify001";

  function findFirstOrNull(collection, filter, params) {
    try {
      return app.findFirstRecordByFilter(collection, filter, params);
    } catch {
      return null;
    }
  }

  function ensureField(collection, name, expectedType, createField, configureField) {
    let field = collection.fields.getByName(name);
    if (!field) {
      field = createField();
      collection.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " +
          collection.name +
          "." +
          name +
          ": expected " +
          expectedType +
          " field, found " +
          field.type()
      );
    }
    configureField(field);
  }

  function ensureIndex(collection, name, unique, columns) {
    if (!collection.getIndex(name)) {
      collection.addIndex(name, unique, columns, "");
    }
  }

  function validPseudo(value) {
    return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(value);
  }

  function chooseUniquePseudo(member) {
    const current = member.getString("pseudo");
    if (validPseudo(current)) {
      const owner = findFirstOrNull("members", "pseudo = {:pseudo}", {
        pseudo: current,
      });
      if (!owner || owner.id === member.id) return current;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate =
        "member-pub-rule-" + $security.randomString(12).toLowerCase();
      if (!validPseudo(candidate)) continue;
      if (!findFirstOrNull("members", "pseudo = {:pseudo}", { pseudo: candidate })) {
        return candidate;
      }
    }
    throw new Error("Unable to allocate a unique pseudo for the publication fixture.");
  }

  const members = app.findCollectionByNameOrId("members");
  const invites = app.findCollectionByNameOrId("invites");
  const issuer = app.findRecordById("members", ISSUER_ID);
  if (issuer.getBool("founder_invitation_issuer")) {
    throw new Error(
      "Cannot create the publication verification fixture: the reserved issuer is a Founder invitation issuer."
    );
  }

  let credentials;
  try {
    credentials = app.findCollectionByNameOrId(COLLECTION_NAME);
  } catch {
    credentials = new Collection({ name: COLLECTION_NAME, type: "base" });
  }
  if (credentials.type !== "base") {
    throw new Error(COLLECTION_NAME + " must remain a base collection");
  }

  ensureField(
    credentials,
    "member",
    "relation",
    () =>
      new RelationField({
        name: "member",
        required: true,
        collectionId: members.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    (field) => {
      field.required = true;
      field.collectionId = members.id;
      field.maxSelect = 1;
      field.cascadeDelete = false;
      field.hidden = false;
    }
  );
  ensureField(
    credentials,
    "email",
    "email",
    () => new EmailField({ name: "email", required: true }),
    (field) => {
      field.required = true;
      field.hidden = false;
    }
  );
  ensureField(
    credentials,
    "password",
    "text",
    () => new TextField({ name: "password", required: true, max: 128, hidden: true }),
    (field) => {
      field.required = true;
      field.max = 128;
      field.hidden = true;
    }
  );

  ensureIndex(
    credentials,
    "idx_member_publication_rule_verification_member",
    true,
    "member"
  );
  ensureIndex(
    credentials,
    "idx_member_publication_rule_verification_email",
    true,
    "email"
  );

  // Null API rules deny every client operation. Only a platform superuser can
  // retrieve the runtime password for the controlled browser session.
  credentials.listRule = null;
  credentials.viewRule = null;
  credentials.createRule = null;
  credentials.updateRule = null;
  credentials.deleteRule = null;
  app.save(credentials);

  let credential = findFirstOrNull(COLLECTION_NAME, "email = {:email}", {
    email: FIXTURE_EMAIL,
  });
  let password = credential ? credential.getString("password") : "";
  let member = findFirstOrNull("members", "email = {:email}", {
    email: FIXTURE_EMAIL,
  });
  let memberChanged = false;

  if (!password) password = $security.randomString(64);

  if (!member) {
    member = new Record(members);
    member.set("email", FIXTURE_EMAIL);
    member.setPassword(password);
    memberChanged = true;
  } else if (!credential || !credential.getString("password")) {
    // If a partial boot saved the auth member before its credential row, rotate
    // the otherwise unrecoverable password once and persist the replacement.
    member.setPassword(password);
    memberChanged = true;
  }

  const existingInviter = member.getString("invited_by");
  if (existingInviter && existingInviter !== issuer.id) {
    throw new Error(
      "Cannot reuse the publication verification member: invited_by belongs to another issuer."
    );
  }
  const existingRedeemedInvite = member.getString("redeemed_invite");
  if (existingRedeemedInvite && existingRedeemedInvite !== INVITE_ID) {
    throw new Error(
      "Cannot reuse the publication verification member: redeemed_invite belongs to another invite."
    );
  }

  const pseudo = chooseUniquePseudo(member);
  if (member.getString("pseudo") !== pseudo) {
    member.set("pseudo", pseudo);
    memberChanged = true;
  }
  if (member.getString("display_name") !== FIXTURE_DISPLAY_NAME) {
    member.set("display_name", FIXTURE_DISPLAY_NAME);
    memberChanged = true;
  }
  if (member.getString("community_status") !== "verified") {
    member.set("community_status", "verified");
    memberChanged = true;
  }
  if (!member.getBool("verified")) {
    member.set("verified", true);
    memberChanged = true;
  }
  if (member.getBool("emailVisibility")) {
    member.set("emailVisibility", false);
    memberChanged = true;
  }
  if (member.getBool("founding_verified")) {
    member.set("founding_verified", false);
    memberChanged = true;
  }
  if (member.getBool("founder_invitation_issuer")) {
    member.set("founder_invitation_issuer", false);
    memberChanged = true;
  }
  if (member.getBool("direct_founder_invited")) {
    member.set("direct_founder_invited", false);
    memberChanged = true;
  }
  if (!member.getBool("internal_member")) {
    member.set("internal_member", true);
    memberChanged = true;
  }
  if (member.getString("invited_by") !== issuer.id) {
    member.set("invited_by", issuer.id);
    memberChanged = true;
  }
  if (member.getString("invite_code")) {
    member.set("invite_code", "");
    memberChanged = true;
  }
  if (memberChanged) app.save(member);

  let invite = null;
  try {
    invite = app.findRecordById("invites", INVITE_ID);
  } catch {
    // The dedicated already-claimed internal invite has not been created yet.
  }

  if (!invite) {
    invite = new Record(invites);
    invite.id = INVITE_ID;
    invite.set("issued_by", issuer.id);
    invite.set("code", "DTR-" + $security.randomString(32).toUpperCase());
    invite.set("claimed_by", member.id);
    invite.set("claimed_at", new Date().toISOString());
    app.save(invite);
  } else {
    if (invite.getString("issued_by") !== issuer.id) {
      throw new Error(
        "Cannot reuse the publication verification invite: its reserved id belongs to another issuer."
      );
    }
    const claimedBy = invite.getString("claimed_by");
    if (claimedBy && claimedBy !== member.id) {
      throw new Error(
        "Cannot reuse the publication verification invite: it is claimed by another member."
      );
    }
    let inviteChanged = false;
    if (!invite.getString("code")) {
      invite.set("code", "DTR-" + $security.randomString(32).toUpperCase());
      inviteChanged = true;
    }
    if (claimedBy !== member.id) {
      invite.set("claimed_by", member.id);
      inviteChanged = true;
    }
    if (!invite.getString("claimed_at")) {
      invite.set("claimed_at", new Date().toISOString());
      inviteChanged = true;
    }
    if (inviteChanged) app.save(invite);
  }

  if (member.getString("redeemed_invite") !== invite.id) {
    member.set("redeemed_invite", invite.id);
    app.save(member);
  }

  if (!credential) credential = new Record(credentials);
  credential.set("member", member.id);
  credential.set("email", FIXTURE_EMAIL);
  credential.set("password", password);
  app.save(credential);
}, () => {
  // Forward-only: a later cleanup migration will remove this temporary fixture
  // after the single controlled browser verification has completed.
  return null;
});

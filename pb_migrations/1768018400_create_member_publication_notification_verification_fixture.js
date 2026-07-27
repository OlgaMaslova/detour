/// <reference path="../pb_data/types.d.ts" />
//
// Provisions one short-lived ordinary member and a private runtime credential
// for a controlled authenticated check of the real publication-notification
// path. It creates no recommendation, publication, app event, invite, or email.
//
// Forward-only and convergent: retries preserve an already-stored password and
// repair only incomplete state belonging to the exact reserved fixture.
migrate((app) => {
  const COLLECTION_NAME =
    "member_publication_notification_verification_credentials";
  const FIXTURE_EMAIL = "agent@detour.supernaut.to";
  const FIXTURE_DISPLAY_NAME =
    "Detour publication notification verification";
  const PSEUDO_PREFIX = "notification-check-";

  function findSingleOrNull(collection, filter, params) {
    const records = app.findRecordsByFilter(
      collection,
      filter,
      "id",
      2,
      0,
      params || {}
    );
    if (records.length > 1) {
      throw new Error(
        "Cannot safely identify the verification fixture: multiple matching records exist in " +
          collection +
          "."
      );
    }
    return records.length ? records[0] : null;
  }

  function normalizedIndex(index) {
    return String(index)
      .toLowerCase()
      .replace(/[`"\[\]]/g, "")
      .replace(/\bif\s+not\s+exists\b/g, "")
      .replace(/;$/, "")
      .replace(/\s+/g, " ")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isExactUniqueColumnIndex(index, collectionName, column) {
    const expression = new RegExp(
      "^create unique index [^ ]+ on " +
        escapeRegExp(collectionName.toLowerCase()) +
        "\\(" +
        escapeRegExp(column.toLowerCase()) +
        "\\)$"
    );
    return expression.test(normalizedIndex(index));
  }

  function ensureUniqueIndex(collection, name, column) {
    const named = collection.getIndex(name);
    if (named) {
      if (!isExactUniqueColumnIndex(named, collection.name, column)) {
        throw new Error(
          "Cannot safely configure " +
            collection.name +
            " index " +
            name +
            ": an incompatible index already uses that name."
        );
      }
      return;
    }

    for (const existing of collection.indexes) {
      if (isExactUniqueColumnIndex(existing, collection.name, column)) return;
    }
    collection.addIndex(name, true, column, "");
  }

  function ensureField(collection, name, expectedType, createField, reconcileField) {
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
    reconcileField(field);
  }

  function validFixturePseudo(value) {
    return (
      value.indexOf(PSEUDO_PREFIX) === 0 &&
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(value)
    );
  }

  function chooseUniquePseudo(member) {
    const current = member.getString("pseudo");
    if (validFixturePseudo(current)) {
      const owner = findSingleOrNull("members", "pseudo = {:pseudo}", {
        pseudo: current,
      });
      if (!owner || owner.id === member.id) return current;
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate =
        PSEUDO_PREFIX + $security.randomString(10).toLowerCase();
      if (!validFixturePseudo(candidate)) continue;
      if (!findSingleOrNull("members", "pseudo = {:pseudo}", { pseudo: candidate })) {
        return candidate;
      }
    }
    throw new Error(
      "Unable to allocate a unique pseudo for the publication-notification fixture."
    );
  }

  function setString(record, field, value) {
    if (record.getString(field) === value) return false;
    record.set(field, value);
    return true;
  }

  function setBool(record, field, value) {
    if (record.getBool(field) === value) return false;
    record.set(field, value);
    return true;
  }

  const members = app.findCollectionByNameOrId("members");
  if (members.type !== "auth") {
    throw new Error("members must remain an auth collection");
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
      if (field.collectionId !== members.id || field.maxSelect !== 1) {
        throw new Error(
          "Cannot safely configure " +
            COLLECTION_NAME +
            ".member: the existing relation target or cardinality is incompatible."
        );
      }
      field.required = true;
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

  ensureUniqueIndex(
    credentials,
    "idx_member_publication_notification_verification_member",
    "member"
  );
  ensureUniqueIndex(
    credentials,
    "idx_member_publication_notification_verification_email",
    "email"
  );

  credentials.listRule = null;
  credentials.viewRule = null;
  credentials.createRule = null;
  credentials.updateRule = null;
  credentials.deleteRule = null;
  app.save(credentials);

  let member = findSingleOrNull("members", "email = {:email}", {
    email: FIXTURE_EMAIL,
  });
  const memberAlreadyExisted = !!member;
  if (memberAlreadyExisted) {
    if (member.getString("email") !== FIXTURE_EMAIL) {
      throw new Error(
        "Refusing to alter a member whose stored email is not the exact verification address."
      );
    }
    if (member.getString("display_name") !== FIXTURE_DISPLAY_NAME) {
      throw new Error(
        "Refusing to alter the existing member at " +
          FIXTURE_EMAIL +
          ": its display name does not identify the verification fixture."
      );
    }
  }

  let credentialByEmail = findSingleOrNull(
    COLLECTION_NAME,
    "email = {:email}",
    { email: FIXTURE_EMAIL }
  );

  if (!member && credentialByEmail) {
    throw new Error(
      "Refusing to create the verification member: its reserved credential email is already linked to another member."
    );
  }

  let credentialByMember = null;
  if (member) {
    credentialByMember = findSingleOrNull(
      COLLECTION_NAME,
      "member = {:member}",
      { member: member.id }
    );
  }

  if (credentialByEmail) {
    if (
      credentialByEmail.getString("email") !== FIXTURE_EMAIL ||
      credentialByEmail.getString("member") !== member.id
    ) {
      throw new Error(
        "Refusing to reuse the reserved credential row: it does not match the verification fixture member."
      );
    }
  }
  if (credentialByMember) {
    if (
      credentialByMember.getString("email") !== FIXTURE_EMAIL ||
      (credentialByEmail && credentialByMember.id !== credentialByEmail.id)
    ) {
      throw new Error(
        "Refusing to reuse the fixture member: its credential row belongs to another email or record."
      );
    }
  }

  let credential = credentialByEmail || credentialByMember;
  let password = credential ? credential.getString("password") : "";
  if (password && (password.length < 8 || password.length > 128)) {
    throw new Error(
      "Refusing to replace the verification fixture password: the stored credential is incompatible."
    );
  }
  if (!password) password = $security.randomString(64);

  if (!member) {
    member = new Record(members);
    member.set("email", FIXTURE_EMAIL);
    member.setPassword(password);
  } else if (!credential || !credential.getString("password")) {
    // A prior boot may have saved the member before its private credential row.
    // Rotate that otherwise unrecoverable password once, then preserve it.
    member.setPassword(password);
  }

  if (member.getString("invited_by") || member.getString("redeemed_invite")) {
    throw new Error(
      "Refusing to reuse the verification member because it is linked to an invitation."
    );
  }

  let memberChanged = !memberAlreadyExisted;
  memberChanged = setString(member, "display_name", FIXTURE_DISPLAY_NAME) || memberChanged;
  memberChanged = setString(member, "pseudo", chooseUniquePseudo(member)) || memberChanged;
  memberChanged = setString(member, "community_status", "verified") || memberChanged;
  memberChanged = setBool(member, "verified", true) || memberChanged;
  memberChanged = setBool(member, "founding_verified", false) || memberChanged;
  memberChanged = setBool(member, "founder_invitation_issuer", false) || memberChanged;
  memberChanged = setBool(member, "direct_founder_invited", false) || memberChanged;
  memberChanged = setBool(member, "internal_member", false) || memberChanged;
  memberChanged = setBool(member, "discovery_visible", false) || memberChanged;
  memberChanged = setBool(member, "emailVisibility", false) || memberChanged;
  memberChanged = setString(member, "invited_by", "") || memberChanged;
  memberChanged = setString(member, "redeemed_invite", "") || memberChanged;
  memberChanged = setString(member, "invite_code", "") || memberChanged;

  if (memberChanged || !credential || !credential.getString("password")) {
    app.save(member);
  }

  if (!credential) credential = new Record(credentials);
  credential.set("member", member.id);
  credential.set("email", FIXTURE_EMAIL);
  credential.set("password", password);
  app.save(credential);
}, () => {
  // Forward-only: a dedicated later migration will remove this temporary member
  // and its private credential after the controlled live verification.
  return null;
});

/// <reference path="../pb_data/types.d.ts" />
//
// Provisions two temporary internal members and private credentials for a
// controlled browser verification of the already-shipped member-status copy.
// It creates no invitation, recommendation, waitlist entry, venue, award,
// share, event, or email, and does not rely on request hooks firing.
//
// This forward-only fixture is convergent after a partial boot. A later
// forward-only migration will clean it up after the browser checks complete.
migrate((app) => {
  const COLLECTION_NAME = "member_status_copy_verification_credentials";
  const fixtures = [
    {
      email: "member-status-copy-check-a@detour.invalid",
      displayName: "Detour member status copy verification A",
      pseudoPrefix: "status-copy-a-",
      role: "member_status_copy_check_a",
    },
    {
      email: "member-status-copy-check-b@detour.invalid",
      displayName: "Detour member status copy verification B",
      pseudoPrefix: "status-copy-b-",
      role: "member_status_copy_check_b",
    },
  ];

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
        "Cannot safely identify the member-status verification fixture: multiple matching records exist in " +
          collection +
          "."
      );
    }
    return records.length ? records[0] : null;
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

  function validFixturePseudo(value, prefix) {
    return (
      value.indexOf(prefix) === 0 &&
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(value)
    );
  }

  function chooseUniquePseudo(member, prefix) {
    const current = member.getString("pseudo");
    if (validFixturePseudo(current, prefix)) {
      const owner = findSingleOrNull("members", "pseudo = {:pseudo}", {
        pseudo: current,
      });
      if (!owner || owner.id === member.id) return current;
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = prefix + $security.randomString(12).toLowerCase();
      if (!validFixturePseudo(candidate, prefix)) continue;
      if (!findSingleOrNull("members", "pseudo = {:pseudo}", { pseudo: candidate })) {
        return candidate;
      }
    }
    throw new Error(
      "Unable to allocate a unique pseudo for the member-status verification fixture."
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
  ensureField(
    credentials,
    "role",
    "text",
    () => new TextField({ name: "role", required: true, max: 80 }),
    (field) => {
      field.required = true;
      field.max = 80;
      field.hidden = false;
    }
  );

  ensureUniqueIndex(
    credentials,
    "idx_member_status_copy_verification_member",
    "member"
  );
  ensureUniqueIndex(
    credentials,
    "idx_member_status_copy_verification_email",
    "email"
  );

  // Null API rules keep the runtime passwords available only to a platform
  // superuser retrieving them for the controlled browser session.
  credentials.listRule = null;
  credentials.viewRule = null;
  credentials.createRule = null;
  credentials.updateRule = null;
  credentials.deleteRule = null;
  app.save(credentials);

  for (const fixture of fixtures) {
    let member = findSingleOrNull("members", "email = {:email}", {
      email: fixture.email,
    });
    const memberAlreadyExisted = !!member;

    // Exact reserved email plus exact display name are the only boundaries that
    // permit this migration to repair an already-existing auth record.
    if (memberAlreadyExisted) {
      if (
        member.getString("email") !== fixture.email ||
        member.getString("display_name") !== fixture.displayName
      ) {
        throw new Error(
          "Refusing to alter the existing member at " +
            fixture.email +
            ": its exact fixture identity does not match."
        );
      }
    }

    let credentialByEmail = findSingleOrNull(
      COLLECTION_NAME,
      "email = {:email}",
      { email: fixture.email }
    );
    if (!member && credentialByEmail) {
      throw new Error(
        "Refusing to create the fixture member: its reserved credential email is already present without the matching member."
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
        credentialByEmail.getString("email") !== fixture.email ||
        credentialByEmail.getString("member") !== member.id
      ) {
        throw new Error(
          "Refusing to reuse the reserved credential row: it does not match the exact fixture member."
        );
      }
    }
    if (credentialByMember) {
      if (
        credentialByMember.getString("email") !== fixture.email ||
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
        "Refusing to replace the member-status fixture password: the stored credential is incompatible."
      );
    }
    if (!password) password = $security.randomString(64);

    if (!member) {
      member = new Record(members);
      member.set("email", fixture.email);
      member.setPassword(password);
    } else if (!credential || !credential.getString("password")) {
      // A partial boot may save the auth member before its credential row. In
      // that case rotate the unrecoverable password once, then preserve it.
      member.setPassword(password);
    }

    if (
      member.getString("invited_by") ||
      member.getString("redeemed_invite") ||
      member.getString("invite_code")
    ) {
      throw new Error(
        "Refusing to reuse the member-status fixture because it has invitation provenance."
      );
    }

    let memberChanged = !memberAlreadyExisted;
    memberChanged = setString(member, "display_name", fixture.displayName) || memberChanged;
    memberChanged =
      setString(member, "pseudo", chooseUniquePseudo(member, fixture.pseudoPrefix)) ||
      memberChanged;
    memberChanged = setString(member, "community_status", "verified") || memberChanged;
    memberChanged = setBool(member, "verified", true) || memberChanged;
    memberChanged = setBool(member, "internal_member", true) || memberChanged;
    memberChanged = setBool(member, "founder_invitation_issuer", false) || memberChanged;
    memberChanged = setBool(member, "direct_founder_invited", false) || memberChanged;
    memberChanged = setBool(member, "founding_verified", false) || memberChanged;
    memberChanged = setBool(member, "emailVisibility", false) || memberChanged;
    memberChanged = setBool(member, "discovery_visible", true) || memberChanged;
    memberChanged = setString(member, "invited_by", "") || memberChanged;
    memberChanged = setString(member, "redeemed_invite", "") || memberChanged;
    memberChanged = setString(member, "invite_code", "") || memberChanged;

    if (memberChanged || !credential || !credential.getString("password")) {
      app.save(member);
    }

    if (!credential) credential = new Record(credentials);
    credential.set("member", member.id);
    credential.set("email", fixture.email);
    credential.set("password", password);
    credential.set("role", fixture.role);
    app.save(credential);
  }
}, () => {
  // Forward-only: a later forward-only migration will remove this temporary
  // verification fixture and its private credentials after browser checks.
  return null;
});

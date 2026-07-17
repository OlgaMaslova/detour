/// <reference path="../pb_data/types.d.ts" />
//
// Creates a private, temporary credential bundle for controlled live-browser
// verification of the existing community frontend. Runtime-generated secrets
// are retained only in a superuser-only collection for the later verification
// procedure and its separately delivered cleanup migration.
//
// This migration is forward-only and convergent. After an interrupted boot it
// reuses the collection, fields, indexes, fixture members, credential rows,
// group key, and passwords that were already saved, repairing only incomplete
// fixture state.
migrate((app) => {
  const COLLECTION_NAME = "community_frontend_verification_credentials";
  const fixtures = [
    {
      email: "community-frontend-verification-a@detour.invalid",
      displayName: "Detour frontend verification A - founding verified",
      fixtureRole: "frontend_verification_a_founding",
      communityStatus: "verified",
      foundingVerified: true,
    },
    {
      email: "community-frontend-verification-b@detour.invalid",
      displayName: "Detour frontend verification B - founding verified",
      fixtureRole: "frontend_verification_b_founding",
      communityStatus: "verified",
      foundingVerified: true,
    },
    {
      email: "community-frontend-verification-c@detour.invalid",
      displayName: "Detour frontend verification C - founding verified",
      fixtureRole: "frontend_verification_c_founding",
      communityStatus: "verified",
      foundingVerified: true,
    },
    {
      email: "community-frontend-verification-d@detour.invalid",
      displayName: "Detour frontend verification D - unverified",
      fixtureRole: "frontend_verification_d_unverified",
      communityStatus: "unverified",
      foundingVerified: false,
    },
  ];

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

  const members = app.findCollectionByNameOrId("members");

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
    "fixture_group_key",
    "text",
    () => new TextField({ name: "fixture_group_key", required: true, max: 128 }),
    (field) => {
      field.required = true;
      field.max = 128;
      field.hidden = false;
    }
  );
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
    "fixture_role",
    "text",
    () => new TextField({ name: "fixture_role", required: true, max: 100 }),
    (field) => {
      field.required = true;
      field.max = 100;
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
    "idx_community_frontend_verification_email",
    true,
    "email"
  );
  ensureIndex(
    credentials,
    "idx_community_frontend_verification_member",
    true,
    "member"
  );
  ensureIndex(
    credentials,
    "idx_community_frontend_verification_role",
    true,
    "fixture_role"
  );

  // Null rules deny all client API operations. Only a superuser can retrieve
  // the plaintext runtime credentials for the controlled verification run.
  credentials.listRule = null;
  credentials.viewRule = null;
  credentials.createRule = null;
  credentials.updateRule = null;
  credentials.deleteRule = null;
  app.save(credentials);

  const existingCredentials = fixtures.map((fixture) =>
    findFirstOrNull(COLLECTION_NAME, "email = {:email}", { email: fixture.email })
  );

  let fixtureGroupKey = "";
  for (const credential of existingCredentials) {
    if (credential && credential.getString("fixture_group_key")) {
      fixtureGroupKey = credential.getString("fixture_group_key");
      break;
    }
  }
  if (!fixtureGroupKey) {
    fixtureGroupKey = $security.randomString(64);
  }

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    let credential = existingCredentials[index];
    let password = credential ? credential.getString("password") : "";
    let member = findFirstOrNull("members", "email = {:email}", {
      email: fixture.email,
    });
    let memberChanged = false;

    if (!password) {
      password = $security.randomString(64);
    }

    if (!member) {
      member = new Record(members);
      member.set("email", fixture.email);
      member.setPassword(password);
      memberChanged = true;
    } else if (!credential || !credential.getString("password")) {
      // If a prior boot saved the auth member but not its credential row, rotate
      // the unrecoverable password once and persist the replacement below.
      member.setPassword(password);
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
    if (member.getString("display_name") !== fixture.displayName) {
      member.set("display_name", fixture.displayName);
      memberChanged = true;
    }
    if (member.getString("community_status") !== fixture.communityStatus) {
      member.set("community_status", fixture.communityStatus);
      memberChanged = true;
    }
    if (member.getBool("founding_verified") !== fixture.foundingVerified) {
      member.set("founding_verified", fixture.foundingVerified);
      memberChanged = true;
    }
    if (memberChanged) {
      app.save(member);
    }

    if (!credential) {
      credential = new Record(credentials);
    }
    credential.set("fixture_group_key", fixtureGroupKey);
    credential.set("member", member.id);
    credential.set("email", fixture.email);
    credential.set("fixture_role", fixture.fixtureRole);
    credential.set("password", password);
    app.save(credential);
  }
}, () => {
  // Forward-only: retain these fixtures and private credentials until the
  // separately delivered cleanup migration removes them after verification.
  return null;
});

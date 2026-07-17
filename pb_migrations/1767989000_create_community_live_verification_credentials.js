/// <reference path="../pb_data/types.d.ts" />
//
// Creates one private credential bundle for a controlled, authenticated live
// verification of the community waitlist loop. The runtime-generated secrets
// are retained only in a superuser-only collection so the follow-up procedure
// can authenticate three clearly marked operational fixture members.
//
// This migration is forward-only and convergent. If a boot is interrupted, it
// reuses the collection, fixture members, credential rows, group key, and saved
// passwords that already exist, and creates or repairs only missing fixture
// state.
migrate((app) => {
  const COLLECTION_NAME = "community_live_verification_credentials";
  const fixtures = [
    {
      email: "community-live-verification-1@detour.invalid",
      displayName: "Detour operational live verification fixture 1",
    },
    {
      email: "community-live-verification-2@detour.invalid",
      displayName: "Detour operational live verification fixture 2",
    },
    {
      email: "community-live-verification-3@detour.invalid",
      displayName: "Detour operational live verification fixture 3",
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
    () => new TextField({ name: "fixture_group_key", required: true, max: 100 }),
    (field) => {
      field.required = true;
      field.max = 100;
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
    "password",
    "text",
    () => new TextField({ name: "password", required: true, max: 128, hidden: true }),
    (field) => {
      field.required = true;
      field.max = 128;
      field.hidden = true;
    }
  );

  ensureIndex(credentials, "idx_community_live_verification_email", true, "email");
  ensureIndex(credentials, "idx_community_live_verification_member", true, "member");

  // Null rules deny every client API operation. Platform superuser access is
  // intentionally the only way to retrieve these one-time credentials.
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
    fixtureGroupKey = "community-live-" + $security.randomString(48);
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
      // A prior boot may have saved the auth record but stopped before saving
      // its credential row. Rotate that otherwise-unrecoverable password once
      // and persist the replacement below.
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
    if (member.getString("community_status") !== "verified") {
      member.set("community_status", "verified");
      memberChanged = true;
    }
    if (!member.getBool("founding_verified")) {
      member.set("founding_verified", true);
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
    credential.set("password", password);
    app.save(credential);
  }
}, () => {
  // Forward-only: retain the private credentials until the controlled live
  // verification procedure explicitly consumes and cleans up its fixtures.
  return null;
});

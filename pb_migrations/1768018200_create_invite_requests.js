/// <reference path="../pb_data/types.d.ts" />
//
// Creates Detour's public invite-request inbox. This migration is forward-only
// and convergent: an interrupted run may leave the collection, fields, or index
// behind, so every schema operation first inspects and safely updates what is
// already present rather than assuming an empty database.
migrate((app) => {
  let requests;
  try {
    requests = app.findCollectionByNameOrId("invite_requests");
  } catch {
    requests = new Collection({ name: "invite_requests", type: "base" });
  }

  if (requests.type !== "base") {
    throw new Error("invite_requests exists but is not a base collection.");
  }

  function ensureField(name, expectedType, createField, configureField) {
    let field = requests.fields.getByName(name);
    if (!field) {
      field = createField();
      requests.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure invite_requests." +
          name +
          ": expected " +
          expectedType +
          " field, found " +
          field.type()
      );
    }
    configureField(field);
  }

  function ensureText(name, required, max) {
    ensureField(
      name,
      "text",
      () => new TextField({ name, required, max }),
      (field) => {
        field.required = required;
        field.max = max;
        field.hidden = false;
      }
    );
  }

  function ensureAutodate(name, onCreate, onUpdate) {
    ensureField(
      name,
      "autodate",
      () => new AutodateField({ name, onCreate, onUpdate }),
      (field) => {
        field.onCreate = onCreate;
        field.onUpdate = onUpdate;
        field.hidden = false;
      }
    );
  }

  ensureField(
    "email",
    "email",
    () => new EmailField({ name: "email", required: true }),
    (field) => {
      field.required = true;
      field.hidden = false;
    }
  );
  ensureText("name", false, 120);
  ensureText("city", false, 120);
  ensureText("why", false, 500);
  ensureText("source", false, 120);
  ensureField(
    "status",
    "select",
    () =>
      new SelectField({
        name: "status",
        required: true,
        values: ["new", "invited", "declined"],
        maxSelect: 1,
      }),
    (field) => {
      field.required = true;
      field.values = ["new", "invited", "declined"];
      field.maxSelect = 1;
      field.hidden = false;
    }
  );
  ensureAutodate("created", true, false);
  ensureAutodate("updated", true, true);

  function normalizedIndex(index) {
    return String(index)
      .toLowerCase()
      .replace(/[`"\[\]]/g, "")
      .replace(/\bif\s+not\s+exists\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .trim();
  }

  function isUniqueEmailIndex(index) {
    const normalized = normalizedIndex(index);
    return (
      normalized.indexOf("create unique index ") === 0 &&
      normalized.indexOf(" on invite_requests(email)") !== -1
    );
  }

  const indexName = "idx_invite_requests_email";
  const namedIndex = requests.getIndex(indexName);
  if (namedIndex) {
    if (!isUniqueEmailIndex(namedIndex)) {
      requests.addIndex(indexName, true, "email", "");
    }
  } else if (!requests.indexes.some((index) => isUniqueEmailIndex(index))) {
    requests.addIndex(indexName, true, "email", "");
  }

  // Empty createRule means anyone may create. Null rules deny every other
  // client API operation; superusers retain their normal administrative access.
  requests.listRule = null;
  requests.viewRule = null;
  requests.createRule = "";
  requests.updateRule = null;
  requests.deleteRule = null;

  return app.save(requests);
}, () => {
  // Forward-only: invite requests must survive rollback/history repair actions.
  return null;
});

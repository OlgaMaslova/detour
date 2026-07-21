/// <reference path="../pb_data/types.d.ts" />
//
// Adds private, contextual replies to an existing place share. This is a new
// collection only: legacy community_shares rows and behavior remain untouched.
// The migration is forward-only and converges safely after a partially applied
// boot by inspecting every field and index before configuring it.
migrate((app) => {
  function getOrCreateBaseCollection(name) {
    try {
      return app.findCollectionByNameOrId(name);
    } catch {
      return new Collection({ name, type: "base" });
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

  function ensureRelation(collection, name, targetId, cascadeDelete) {
    ensureField(
      collection,
      name,
      "relation",
      () =>
        new RelationField({
          name,
          required: true,
          collectionId: targetId,
          maxSelect: 1,
          cascadeDelete,
        }),
      (field) => {
        field.required = true;
        field.collectionId = targetId;
        field.maxSelect = 1;
        field.cascadeDelete = cascadeDelete;
        field.hidden = false;
      }
    );
  }

  function ensureText(collection, name, required, max) {
    ensureField(
      collection,
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

  function ensureAutodate(collection, name, onCreate, onUpdate) {
    ensureField(
      collection,
      name,
      "autodate",
      () => new AutodateField({ name, onCreate, onUpdate }),
      (field) => {
        field.onCreate = onCreate;
        field.onUpdate = onUpdate;
      }
    );
  }

  function addIndexIfMissing(collection, indexName, columns) {
    if (collection.getIndex(indexName)) return;
    for (const existing of collection.indexes) {
      const normalized = String(existing)
        .toLowerCase()
        .replace(/[`"\[\]]/g, "")
        .replace(/\bif\s+not\s+exists\b/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*/g, ")")
        .trim();
      if (
        normalized.indexOf(
          " on " + collection.name.toLowerCase() + "(" + columns.toLowerCase() + ")"
        ) !== -1
      ) {
        return;
      }
    }
    collection.addIndex(indexName, false, columns, "");
  }

  const shares = app.findCollectionByNameOrId("community_shares");
  const members = app.findCollectionByNameOrId("members");
  const replies = getOrCreateBaseCollection("community_share_replies");

  ensureRelation(replies, "share", shares.id, true);
  ensureRelation(replies, "author", members.id, true);
  ensureText(replies, "author_name", true, 100);
  ensureText(replies, "author_pseudo", true, 30);
  ensureText(replies, "body", true, 1200);
  ensureAutodate(replies, "created", true, false);
  ensureAutodate(replies, "updated", true, true);

  addIndexIfMissing(
    replies,
    "idx_community_share_replies_share_created",
    "share, created"
  );
  addIndexIfMissing(
    replies,
    "idx_community_share_replies_author_created",
    "author, created"
  );

  replies.listRule =
    "@request.auth.id != '' && (share.sender = @request.auth.id || share.recipient = @request.auth.id)";
  replies.viewRule =
    "@request.auth.id != '' && (share.sender = @request.auth.id || share.recipient = @request.auth.id)";
  // The request hook validates that the verified caller participates in the
  // referenced share, then owns all author attribution fields.
  replies.createRule =
    "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  replies.updateRule = null;
  replies.deleteRule = null;

  return app.save(replies);
}, () => {
  // Forward-only: private member replies are production data and are retained.
  return null;
});

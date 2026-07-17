/// <reference path="../pb_data/types.d.ts" />
//
// Adds the private, automatic Detour community waiting-list loop. This
// migration is forward-only and deliberately convergent: every collection,
// field, rule, and index is created or configured only after inspecting the
// current schema, so an interrupted boot can safely retry without replacing
// legacy data or the historical detour_submissions workflow.
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

  function ensureText(collection, name, required, max, hidden) {
    ensureField(
      collection,
      name,
      "text",
      () => new TextField({ name, required, max, hidden }),
      (field) => {
        field.required = required;
        field.max = max;
        field.hidden = hidden;
      }
    );
  }

  function ensureNumber(collection, name, required, hidden) {
    ensureField(
      collection,
      name,
      "number",
      () => new NumberField({ name, required, onlyInt: true, min: 0, hidden }),
      (field) => {
        field.required = required;
        field.onlyInt = true;
        field.min = 0;
        field.hidden = hidden;
      }
    );
  }

  function ensureSelect(collection, name, required, values, hidden) {
    ensureField(
      collection,
      name,
      "select",
      () => new SelectField({ name, required, values, maxSelect: 1, hidden }),
      (field) => {
        field.required = required;
        field.values = values;
        field.maxSelect = 1;
        field.hidden = hidden;
      }
    );
  }

  function ensureRelation(
    collection,
    name,
    required,
    targetId,
    maxSelect,
    cascadeDelete,
    hidden
  ) {
    ensureField(
      collection,
      name,
      "relation",
      () =>
        new RelationField({
          name,
          required,
          collectionId: targetId,
          maxSelect,
          cascadeDelete,
          hidden,
        }),
      (field) => {
        field.required = required;
        field.collectionId = targetId;
        field.maxSelect = maxSelect;
        field.cascadeDelete = cascadeDelete;
        field.hidden = hidden;
      }
    );
  }

  function ensureDate(collection, name, hidden) {
    ensureField(
      collection,
      name,
      "date",
      () => new DateField({ name, hidden }),
      (field) => {
        field.required = false;
        field.hidden = hidden;
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

  function isMatchingIndex(index, collectionName, columns, unique) {
    const normalized = normalizedIndex(index);
    const prefix = unique ? "create unique index " : "create index ";
    return (
      normalized.indexOf(prefix) === 0 &&
      normalized.indexOf(
        " on " + collectionName.toLowerCase() + "(" + columns.toLowerCase() + ")"
      ) !== -1
    );
  }

  function ensureIndex(collection, name, columns, unique) {
    const namedIndex = collection.getIndex(name);
    if (namedIndex) {
      if (!isMatchingIndex(namedIndex, collection.name, columns, unique)) {
        collection.addIndex(name, unique, columns, "");
      }
      return;
    }
    if (
      !collection.indexes.some((index) =>
        isMatchingIndex(index, collection.name, columns, unique)
      )
    ) {
      collection.addIndex(name, unique, columns, "");
    }
  }

  const members = app.findCollectionByNameOrId("members");
  const venues = app.findCollectionByNameOrId("venues");
  const awards = app.findCollectionByNameOrId("venue_awards");

  // ---------- shared waiting-list entries ----------
  const entries = getOrCreateBaseCollection("community_waitlist_entries");
  ensureText(entries, "venue_name", true, 200, false);
  ensureText(entries, "city", true, 120, false);
  ensureText(entries, "country", true, 120, false);
  ensureText(entries, "normalized_name", true, 240, true);
  ensureText(entries, "normalized_city", true, 160, true);
  ensureSelect(entries, "status", true, ["pending", "published"], false);
  // PocketBase treats numeric zero as the empty value for required validation;
  // keep the field optional in schema while the server always writes it.
  ensureNumber(entries, "signal_count", false, false);
  ensureRelation(entries, "participants", false, members.id, 1000, false, true);
  ensureRelation(entries, "canonical_venue", false, venues.id, 1, false, true);
  ensureRelation(entries, "published_venue", false, venues.id, 1, false, true);
  ensureRelation(entries, "published_award", false, awards.id, 1, false, true);
  ensureDate(entries, "published_at", true);
  ensureText(entries, "publication_audit_id", false, 100, true);
  ensureAutodate(entries, "created", true, false);
  ensureAutodate(entries, "updated", true, true);
  ensureIndex(
    entries,
    "idx_community_waitlist_normalized_place",
    "normalized_name, normalized_city",
    true
  );
  ensureIndex(entries, "idx_community_waitlist_status", "status", false);
  entries.listRule =
    "@request.auth.id != '' && participants.id ?= @request.auth.id";
  entries.viewRule =
    "@request.auth.id != '' && participants.id ?= @request.auth.id";
  entries.createRule = null;
  entries.updateRule = null;
  entries.deleteRule = null;
  app.save(entries);

  // ---------- independent member recommendation signals ----------
  const recommendations = getOrCreateBaseCollection("community_recommendations");
  ensureRelation(recommendations, "waitlist", true, entries.id, 1, true, false);
  ensureRelation(recommendations, "member", true, members.id, 1, true, true);
  ensureText(recommendations, "note", true, 2400, false);
  // Private input mirrors let the standard records endpoint resolve or create a
  // waiting-list entry without exposing server-owned entry fields for writes.
  ensureText(recommendations, "venue_name", false, 200, false);
  ensureText(recommendations, "city", false, 120, false);
  ensureText(recommendations, "country", false, 120, false);
  ensureAutodate(recommendations, "created", true, false);
  ensureAutodate(recommendations, "updated", true, true);
  ensureIndex(
    recommendations,
    "idx_community_recommendations_member_waitlist",
    "member, waitlist",
    true
  );
  ensureIndex(
    recommendations,
    "idx_community_recommendations_waitlist",
    "waitlist",
    false
  );
  recommendations.listRule =
    "@request.auth.id != '' && member = @request.auth.id";
  recommendations.viewRule =
    "@request.auth.id != '' && member = @request.auth.id";
  recommendations.createRule =
    "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  recommendations.updateRule = null;
  recommendations.deleteRule =
    "@request.auth.id != '' && member = @request.auth.id";
  app.save(recommendations);

  // ---------- private queue-linked shares (never signals) ----------
  const shares = getOrCreateBaseCollection("community_shares");
  // Sender is overwritten by the request hook and is visible only within the
  // private sender/recipient-scoped collection response.
  ensureRelation(shares, "sender", true, members.id, 1, true, false);
  // Recipient is a required request input and is visible only within the
  // private sender/recipient-scoped collection response.
  ensureRelation(shares, "recipient", true, members.id, 1, true, false);
  ensureRelation(shares, "waitlist", true, entries.id, 1, true, false);
  ensureText(shares, "personal_note", true, 1200, false);
  ensureText(shares, "venue_name", false, 200, false);
  ensureText(shares, "city", false, 120, false);
  ensureText(shares, "country", false, 120, false);
  ensureAutodate(shares, "created", true, false);
  ensureAutodate(shares, "updated", true, true);
  ensureIndex(shares, "idx_community_shares_sender", "sender", false);
  ensureIndex(shares, "idx_community_shares_recipient", "recipient", false);
  ensureIndex(shares, "idx_community_shares_waitlist", "waitlist", false);
  shares.listRule =
    "@request.auth.id != '' && (sender = @request.auth.id || recipient = @request.auth.id)";
  shares.viewRule =
    "@request.auth.id != '' && (sender = @request.auth.id || recipient = @request.auth.id)";
  shares.createRule =
    "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  shares.updateRule = null;
  shares.deleteRule =
    "@request.auth.id != '' && sender = @request.auth.id";
  app.save(shares);
}, () => {
  // Forward-only: community participation, recommendation, share, and
  // publication audit data must survive rollback/history repair operations.
  return null;
});

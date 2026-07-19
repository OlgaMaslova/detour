/// <reference path="../pb_data/types.d.ts" />
//
// Adds a distinct, curator-reviewed lane for member-submitted places. This
// migration is forward-only and convergent: an interrupted boot can safely
// retry collection, field, rule, and index configuration without touching the
// guide-backed catalogue or the legacy/automatic community workflows.
migrate((app) => {
  const COLLECTION_NAME = "member_place_contributions";

  let contributions;
  try {
    contributions = app.findCollectionByNameOrId(COLLECTION_NAME);
  } catch {
    contributions = new Collection({ name: COLLECTION_NAME, type: "base" });
  }
  if (contributions.type !== "base") {
    throw new Error(COLLECTION_NAME + " must remain a base collection");
  }

  function ensureField(name, expectedType, createField, configureField) {
    let field = contributions.fields.getByName(name);
    if (!field) {
      field = createField();
      contributions.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure " +
          COLLECTION_NAME +
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

  function ensureText(name, required, max, hidden) {
    ensureField(
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

  function ensureSelect(name, required, values, maxSelect, hidden) {
    ensureField(
      name,
      "select",
      () => new SelectField({ name, required, values, maxSelect, hidden }),
      (field) => {
        field.required = required;
        field.values = values;
        field.maxSelect = maxSelect;
        field.hidden = hidden;
      }
    );
  }

  function ensureRelation(name, required, collectionId, hidden) {
    ensureField(
      name,
      "relation",
      () =>
        new RelationField({
          name,
          required,
          collectionId,
          maxSelect: 1,
          cascadeDelete: true,
          hidden,
        }),
      (field) => {
        field.required = required;
        field.collectionId = collectionId;
        field.maxSelect = 1;
        field.cascadeDelete = true;
        field.hidden = hidden;
      }
    );
  }

  function ensureDate(name, hidden) {
    ensureField(
      name,
      "date",
      () => new DateField({ name, hidden }),
      (field) => {
        field.required = false;
        field.hidden = hidden;
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

  function normalizedIndex(index) {
    return String(index)
      .toLowerCase()
      .replace(/[`"\[\]]/g, "")
      .replace(/\bif\s+not\s+exists\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .trim();
  }

  function isMatchingIndex(index, unique, columns, where) {
    const normalized = normalizedIndex(index);
    const prefix = unique ? "create unique index " : "create index ";
    const normalizedColumns = normalizedIndex(columns);
    const tableAndColumns =
      " on " + COLLECTION_NAME.toLowerCase() + "(" + normalizedColumns + ")";
    if (normalized.indexOf(prefix) !== 0 || normalized.indexOf(tableAndColumns) === -1) {
      return false;
    }

    const wherePosition = normalized.indexOf(" where ");
    if (!where) return wherePosition === -1;
    return (
      wherePosition !== -1 &&
      normalized.slice(wherePosition + 7) === normalizedIndex(where)
    );
  }

  function ensureIndex(name, unique, columns, where) {
    const namedIndex = contributions.getIndex(name);
    if (namedIndex) {
      if (!isMatchingIndex(namedIndex, unique, columns, where)) {
        contributions.addIndex(name, unique, columns, where);
      }
      return;
    }
    if (
      !contributions.indexes.some((index) =>
        isMatchingIndex(index, unique, columns, where)
      )
    ) {
      contributions.addIndex(name, unique, columns, where);
    }
  }

  const members = app.findCollectionByNameOrId("members");

  ensureRelation("member", true, members.id, true);
  ensureSelect("source", true, ["member_recommended"], 1, false);
  ensureText("place_name", true, 200, false);
  ensureText("city", true, 120, false);
  ensureText("country", true, 120, false);
  ensureText("address", false, 300, false);
  ensureSelect(
    "category",
    false,
    [
      "restaurant",
      "cafe",
      "bakery",
      "bar",
      "cocktail_bar",
      "wine_bar",
      "brewery",
      "food_market",
      "deli",
      "dessert_shop",
      "ice_cream",
      "takeaway",
      "other",
    ],
    1,
    false
  );
  ensureSelect(
    "occasions",
    false,
    [
      "celebration",
      "casual_local_favorite",
      "coffee",
      "bakery",
      "drinks_nightcap",
      "neighborhood_meal",
      "date_night",
      "group_gathering",
      "quick_bite",
      "breakfast_brunch",
      "solo_friendly",
      "family_friendly",
      "late_night",
      "outdoor_seating",
    ],
    14,
    false
  );
  ensureText("recommendation_note", true, 2400, true);
  ensureText("normalized_name", true, 240, true);
  ensureText("normalized_city", true, 160, true);
  ensureSelect("status", true, ["in_review", "approved", "rejected"], 1, false);
  ensureText("curator_note", false, 1200, true);
  ensureDate("reviewed_at", false);
  ensureAutodate("created", true, false);
  ensureAutodate("updated", true, true);

  ensureIndex(
    "idx_member_place_contributions_member_status",
    false,
    "member, status",
    ""
  );
  ensureIndex(
    "idx_member_place_contributions_city_status",
    false,
    "city, status",
    ""
  );
  ensureIndex(
    "idx_member_place_contributions_open_place",
    true,
    "normalized_name, normalized_city",
    "status = 'in_review' OR status = 'approved'"
  );

  contributions.listRule =
    "status = 'approved' || (@request.auth.id != '' && member = @request.auth.id)";
  contributions.viewRule =
    "status = 'approved' || (@request.auth.id != '' && member = @request.auth.id)";
  contributions.createRule =
    "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  contributions.updateRule = null;
  contributions.deleteRule = null;

  return app.save(contributions);
}, () => {
  // Forward-only: member contributions and their review history are retained.
  return null;
});

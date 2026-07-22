/// <reference path="../pb_data/types.d.ts" />
//
// Stores anonymous founding-feedback survey submissions behind a server-only
// write route. The schema converges safely if an interrupted migration already
// created the collection or only some of its fields.
migrate((app) => {
  const COLLECTION_NAME = "founding_feedback_responses";

  let responses;
  try {
    responses = app.findCollectionByNameOrId(COLLECTION_NAME);
  } catch {
    responses = new Collection({ name: COLLECTION_NAME, type: "base" });
  }
  if (responses.type !== "base") {
    throw new Error(COLLECTION_NAME + " must remain a base collection");
  }

  function ensureField(name, expectedType, createField, configureField) {
    let field = responses.fields.getByName(name);
    if (!field) {
      field = createField();
      responses.fields.add(field);
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

  function ensureSelect(name, values) {
    ensureField(
      name,
      "select",
      () =>
        new SelectField({
          name,
          required: true,
          values,
          maxSelect: 1,
          hidden: false,
        }),
      (field) => {
        field.required = true;
        field.values = values;
        field.maxSelect = 1;
        field.hidden = false;
      }
    );
  }

  function ensureText(name, required, min, max, hidden) {
    ensureField(
      name,
      "text",
      () => new TextField({ name, required, min, max, hidden }),
      (field) => {
        field.required = required;
        field.min = min;
        field.max = max;
        field.hidden = hidden;
      }
    );
  }

  ensureSelect("discovery_source", [
    "friends",
    "food-people",
    "social",
    "reviews",
    "other",
  ]);
  ensureSelect("circle_interest", ["yes", "maybe", "no"]);
  ensureText("value_needed", true, 8, 1200, false);
  ensureText("source", true, 0, 40, true);

  // Every ordinary API operation stays locked. The public survey route creates
  // records through the server-side app API and returns no stored response.
  responses.listRule = null;
  responses.viewRule = null;
  responses.createRule = null;
  responses.updateRule = null;
  responses.deleteRule = null;

  return app.save(responses);
}, () => {
  // Forward-only: anonymous survey responses must not be deleted on rollback.
  return null;
});

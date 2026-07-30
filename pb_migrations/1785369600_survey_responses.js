/// <reference path="../pb_data/types.d.ts" />
//
// One store for every survey, replacing the single-purpose
// `founding_feedback_responses` table whose columns were the questions.
//
// Questions are meant to change — that is the point of asking them — and a
// column per question made every change a migration that either dropped the
// old answers or left dead columns behind. Here a response is its form id, the
// version of the form that asked it, and an `answers` JSON object keyed by
// question. The question set lives in pb_hooks/survey_forms.json, which both
// the survey page and the submission route read, so adding a survey for
// friends or for founding members is a config edit rather than a schema
// change. Answers stay readable under the version that asked them.
//
// Nothing public may read responses: like the table it replaces, this
// collection has no CRUD rules and is reachable only through the submission
// route and the admin dashboard.
migrate((app) => {
  const members = app.findCollectionByNameOrId("members");

  let responses;
  try {
    responses = app.findCollectionByNameOrId("survey_responses");
  } catch {
    responses = new Collection({
      name: "survey_responses",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
  }

  const fields = [
    new TextField({
      name: "form",
      max: 60,
      required: true,
    }),
    new NumberField({
      name: "form_version",
      min: 1,
      onlyInt: true,
      required: true,
    }),
    new JSONField({
      name: "answers",
      maxSize: 24000,
      required: true,
    }),
    // Member surveys record who answered; public ones never set this, which is
    // what keeps "anonymous by design" true rather than merely promised.
    new RelationField({
      name: "member",
      collectionId: members.id,
      maxSelect: 1,
      required: false,
      cascadeDelete: false,
      hidden: true,
    }),
    new TextField({
      name: "source",
      max: 40,
      required: true,
      hidden: true,
    }),
    new AutodateField({
      name: "created",
      onCreate: true,
      onUpdate: false,
    }),
    new AutodateField({
      name: "updated",
      onCreate: true,
      onUpdate: true,
    }),
  ];
  for (const field of fields) {
    if (!responses.fields.getByName(field.name)) responses.fields.add(field);
  }
  // Saved before the indexes so PocketBase creates the base collection's
  // system columns first.
  app.save(responses);

  const formIndex =
    "CREATE INDEX IF NOT EXISTS `idx_survey_responses_form_created` ON `survey_responses` (form, created)";
  if (responses.indexes.indexOf(formIndex) === -1) responses.indexes.push(formIndex);
  app.save(responses);

  // Carry over any answers already collected. The old collection had no
  // timestamps, so the copies are dated now — there was no original date to
  // keep. They land under the survey they were asked by, as version 1: the
  // wording before it was rewritten for anyone rather than founding members.
  let legacy = null;
  try {
    legacy = app.findCollectionByNameOrId("founding_feedback_responses");
  } catch {
    legacy = null;
  }
  if (legacy) {
    const rows = app.findAllRecords("founding_feedback_responses");
    for (const row of rows) {
      const carried = new Record(responses);
      carried.set("form", "discovery-habits");
      carried.set("form_version", 1);
      carried.set("answers", {
        discoverySource: row.getString("discovery_source"),
        circleInterest: row.getString("circle_interest"),
        valueNeeded: row.getString("value_needed"),
      });
      carried.set("source", row.getString("source") || "public_survey");
      app.save(carried);
    }
    app.delete(legacy);
  }
}, (app) => {
  // Reverting restores the old collection's shape, not its rows: the answers
  // were copied into a JSON column and there is no faithful way to split a v2
  // response back into columns that never asked those questions.
  let legacy;
  try {
    legacy = app.findCollectionByNameOrId("founding_feedback_responses");
  } catch {
    legacy = new Collection({
      name: "founding_feedback_responses",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
  }
  const legacyFields = [
    new SelectField({
      name: "discovery_source",
      values: ["friends", "food-people", "social", "reviews", "other"],
      maxSelect: 1,
      required: true,
    }),
    new SelectField({
      name: "circle_interest",
      values: ["yes", "maybe", "no"],
      maxSelect: 1,
      required: true,
    }),
    new TextField({
      name: "value_needed",
      min: 8,
      max: 1200,
      required: true,
    }),
    new TextField({
      name: "source",
      max: 40,
      required: true,
      hidden: true,
    }),
  ];
  for (const field of legacyFields) {
    if (!legacy.fields.getByName(field.name)) legacy.fields.add(field);
  }
  app.save(legacy);

  try {
    app.delete(app.findCollectionByNameOrId("survey_responses"));
  } catch {
    // A partial or repeated rollback is already at the desired state.
  }
});

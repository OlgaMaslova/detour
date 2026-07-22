/// <reference path="../pb_data/types.d.ts" />
//
// Tracks the LLM web-discovery pass over published community venues (see
// enrichVenueFromWebSearch in pb_hooks/community_waitlist.js). The stamp
// bounds how often a venue is retried against the paid OpenAI API; the note
// records what the pass concluded so a curator can audit why a link was or
// wasn't filled. Both fields are server-owned and hidden from the public API.
migrate((app) => {
  const venues = app.findCollectionByNameOrId("venues");

  function ensureField(name, expectedType, createField, configureField) {
    let field = venues.fields.getByName(name);
    if (!field) {
      field = createField();
      venues.fields.add(field);
    }
    if (field.type() !== expectedType) {
      throw new Error(
        "Cannot safely configure venues." +
          name +
          ": expected " +
          expectedType +
          " field, found " +
          field.type()
      );
    }
    configureField(field);
  }

  ensureField(
    "web_discovery_at",
    "date",
    () => new DateField({ name: "web_discovery_at", hidden: true }),
    (field) => {
      field.required = false;
      field.hidden = true;
    }
  );

  ensureField(
    "web_discovery_note",
    "text",
    () => new TextField({ name: "web_discovery_note", max: 300, hidden: true }),
    (field) => {
      field.required = false;
      field.max = 300;
      field.hidden = true;
    }
  );

  return app.save(venues);
}, () => {
  // Forward-only: discovery bookkeeping is retained.
  return null;
});

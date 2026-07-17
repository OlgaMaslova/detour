/// <reference path="../pb_data/types.d.ts" />
//
// Adds Detour's private member endorsement trust model. This migration is
// forward-only and retry-safe: collection, field, and index creation are all
// guarded, and the founding-cohort backfill is idempotent.
migrate((app) => {
  function addFieldIfMissing(collection, field) {
    if (!collection.fields.getByName(field.name)) {
      collection.fields.add(field);
    }
  }

  function addIndexIfMissing(collection, name, definition) {
    const exists = collection.indexes.some((index) => index.indexOf(name) !== -1);
    if (!exists) {
      collection.indexes.push(definition);
    }
  }

  const members = app.findCollectionByNameOrId("members");
  addFieldIfMissing(
    members,
    new BoolField({ name: "founding_verified", hidden: true })
  );
  const foundingVerified = members.fields.getByName("founding_verified");
  if (foundingVerified) {
    foundingVerified.hidden = true;
  }
  app.save(members);

  // Preserve everyone who was validly verified under the preceding curator
  // model as the founding cohort. Re-running this after a partial boot only
  // updates rows that still need the marker.
  app
    .db()
    .newQuery(
      "UPDATE members SET founding_verified = TRUE " +
        "WHERE community_status = 'verified' " +
        "AND COALESCE(founding_verified, FALSE) = FALSE"
    )
    .execute();

  let endorsements;
  try {
    endorsements = app.findCollectionByNameOrId("endorsements");
  } catch {
    endorsements = new Collection({ name: "endorsements", type: "base" });
  }

  addFieldIfMissing(
    endorsements,
    new RelationField({
      name: "endorser",
      required: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: true,
    })
  );
  addFieldIfMissing(
    endorsements,
    new RelationField({
      name: "endorsee",
      required: true,
      collectionId: members.id,
      maxSelect: 1,
      cascadeDelete: true,
    })
  );
  addFieldIfMissing(endorsements, new BoolField({ name: "active" }));
  addFieldIfMissing(
    endorsements,
    new AutodateField({ name: "created", onCreate: true })
  );
  addFieldIfMissing(
    endorsements,
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
  );

  addIndexIfMissing(
    endorsements,
    "idx_endorsements_endorser_endorsee",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_endorsements_endorser_endorsee ON endorsements (endorser, endorsee)"
  );
  addIndexIfMissing(
    endorsements,
    "idx_endorsements_active_endorser",
    "CREATE INDEX IF NOT EXISTS idx_endorsements_active_endorser ON endorsements (active, endorser)"
  );
  addIndexIfMissing(
    endorsements,
    "idx_endorsements_active_endorsee",
    "CREATE INDEX IF NOT EXISTS idx_endorsements_active_endorsee ON endorsements (active, endorsee)"
  );

  endorsements.listRule =
    "@request.auth.id != '' && (endorser = @request.auth.id || endorsee = @request.auth.id)";
  endorsements.viewRule =
    "@request.auth.id != '' && (endorser = @request.auth.id || endorsee = @request.auth.id)";
  // The request hook assigns endorser and active after the rule check.
  endorsements.createRule =
    "@request.auth.id != '' && @request.auth.community_status = 'verified'";
  endorsements.updateRule = null;
  endorsements.deleteRule =
    "@request.auth.id != '' && endorser = @request.auth.id";
  app.save(endorsements);
}, () => {
  // Forward-only: endorsement and founding-cohort trust data must be retained.
  return null;
});

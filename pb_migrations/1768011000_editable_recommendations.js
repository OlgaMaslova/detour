/// <reference path="../pb_data/types.d.ts" />
//
// A member may correct their own recommendation after the fact — a typo in the
// personal note, a wrong category, a missing occasion. Until now the note was
// write-once (updateRule = null); only a place's links were editable. The
// update request hook owns validation and freezes the identity fields (member,
// waitlist), so this own-member rule never exposes server-owned state to
// writes. Deletion and creation rules are unchanged.
migrate((app) => {
  const recommendations = app.findCollectionByNameOrId("community_recommendations");
  recommendations.updateRule =
    "@request.auth.id != '' && member = @request.auth.id";
  return app.save(recommendations);
}, (app) => {
  const recommendations = app.findCollectionByNameOrId("community_recommendations");
  recommendations.updateRule = null;
  return app.save(recommendations);
});

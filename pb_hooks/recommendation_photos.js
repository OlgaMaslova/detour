/// <reference path="../pb_data/types.d.ts" />
//
// One place to say how a recommendation's photo is selected and addressed.
//
// Every route that projects recommendations reads the photo through the SQL
// fragments below, joined to the recommendation row itself. That is the whole
// point: the photo travels with the note in a single projection, so it inherits
// the note's visibility exactly. A photo cannot reach a caller who is not
// already allowed to read the words it belongs to.
//
// This is what lets the client pick a place's cover from the newest
// recommendation that has a photo rather than strictly from the one whose note
// it shows (see coverRecommendation in src/network.ts). That search runs over
// the caller's own visible set and nothing else, so a widened cover rule cannot
// surface — or hint at — a recommendation the caller was never shown.
//
// Only an approved snapshot is addressable. A submission in screening, awaiting
// founder review, rejected, or superseded resolves to no photo at all, and the
// caller falls through to the venue's enrichment cover.

const PHOTO_ALIAS = "detour_photo";

// Columns to append to a recommendation projection. Requires photoJoin() with
// the same recommendation alias.
//
// Both columns are COALESCE'd. The join is a LEFT JOIN and most recommendations
// have no photo, so the common case is two NULLs — and a DynamicModel string
// field cannot scan NULL, which fails the whole query rather than the one row.
// An empty string is the honest value here anyway: no photo.
function photoColumns() {
  return (
    ", COALESCE(" +
    PHOTO_ALIAS +
    ".id, '') AS photo_id, COALESCE(" +
    PHOTO_ALIAS +
    ".snapshot, '') AS photo_file "
  );
}

// The join that attaches the approved photo to each recommendation row.
// `recommendationAlias` is the alias community_recommendations is selected as.
function photoJoin(recommendationAlias) {
  return (
    "LEFT JOIN community_place_images " +
    PHOTO_ALIAS +
    " ON " +
    PHOTO_ALIAS +
    ".recommendation = " +
    recommendationAlias +
    ".id AND " +
    PHOTO_ALIAS +
    ".status = 'approved' "
  );
}

// The DynamicModel fields the columns above bind into.
function photoRowFields() {
  return { photo_id: "", photo_file: "" };
}

// Turns a projected row into the value clients receive as `photo_url`, or "".
//
// Deliberately a root-relative API path rather than an absolute URL: the
// PocketBase API and the static frontend are on different origins, and the
// server has no reliable knowledge of the origin the caller reached it through.
// The client resolves it against its own configured API base and appends the
// thumb size the surface needs.
function photoUrl(app, row) {
  const id = String((row && row.photo_id) || "").trim();
  const file = String((row && row.photo_file) || "").trim();
  if (!id || !file) return "";
  let collectionId;
  try {
    collectionId = app.findCollectionByNameOrId("community_place_images").id;
  } catch {
    return "";
  }
  return (
    "/api/files/" +
    encodeURIComponent(collectionId) +
    "/" +
    encodeURIComponent(id) +
    "/" +
    encodeURIComponent(file)
  );
}

module.exports = {
  photoColumns,
  photoJoin,
  photoRowFields,
  photoUrl,
};

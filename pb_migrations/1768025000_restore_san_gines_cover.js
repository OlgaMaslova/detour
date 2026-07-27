/// <reference path="../pb_data/types.d.ts" />
//
// Undo 1768024000_clear_unreachable_san_gines_cover: restore the San Ginés
// cover image URL that migration cleared. Scoped to the blank state that
// migration left behind so a manually set replacement is never overwritten.
//
// Note: the gstatic clears from 1768023000 are not restorable — the original
// URLs were never recorded.
migrate((app) => {
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = {:coverUrl} " +
        "WHERE id = {:venueId} AND COALESCE(TRIM(image_url), '') = ''"
    )
    .bind({
      venueId: "inpd3ywyh780d1r",
      coverUrl:
        "https://chocolateriasangines.com/wp-content/uploads/2021/09/slide2iniciochoco.jpg",
    })
    .execute();
}, (app) => {
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = '' " +
        "WHERE id = {:venueId} AND image_url = {:coverUrl}"
    )
    .bind({
      venueId: "inpd3ywyh780d1r",
      coverUrl:
        "https://chocolateriasangines.com/wp-content/uploads/2021/09/slide2iniciochoco.jpg",
    })
    .execute();
});

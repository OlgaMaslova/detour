/// <reference path="../pb_data/types.d.ts" />
//
// The previously verified San Ginés image now returns HTTP 403 to public
// requests. Clear only that exact stale URL so cards and details use the
// intentional no-image fallback rather than presenting a broken cover.
migrate((app) => {
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = '' " +
        "WHERE id = {:venueId} AND image_url = {:staleUrl}"
    )
    .bind({
      venueId: "inpd3ywyh780d1r",
      staleUrl:
        "https://chocolateriasangines.com/wp-content/uploads/2021/09/slide2iniciochoco.jpg",
    })
    .execute();
}, () => {
  // Forward-only: do not restore an unreachable remote image URL.
  return null;
});

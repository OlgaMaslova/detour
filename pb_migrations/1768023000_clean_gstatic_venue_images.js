/// <reference path="../pb_data/types.d.ts" />
//
// Google thumbnail URLs are cache/search artifacts rather than venue-owned
// images. Clear every gstatic.com host first, then restore only the current
// venues whose official websites publish a direct image that was verified to
// return 200 with an image/* content type.
//
// Forward-only and retry-safe: the host-scoped clear cannot touch any other
// image URL, and the replacement backfill only fills blank deterministic ids.
migrate((app) => {
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = '' WHERE " +
        "LOWER(TRIM(image_url)) = 'http://gstatic.com' OR " +
        "LOWER(TRIM(image_url)) = 'https://gstatic.com' OR " +
        "LOWER(TRIM(image_url)) LIKE 'http://gstatic.com/%' OR " +
        "LOWER(TRIM(image_url)) LIKE 'https://gstatic.com/%' OR " +
        "LOWER(TRIM(image_url)) LIKE 'http://%.gstatic.com/%' OR " +
        "LOWER(TRIM(image_url)) LIKE 'https://%.gstatic.com/%'"
    )
    .execute();

  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = CASE id " +
        "WHEN {:sanGinesId} THEN {:sanGinesUrl} " +
        "WHEN {:duPainId} THEN {:duPainUrl} " +
        "WHEN {:tartineId} THEN {:tartineUrl} " +
        "ELSE image_url END " +
        "WHERE id IN ({:sanGinesId}, {:duPainId}, {:tartineId}) " +
        "AND COALESCE(TRIM(image_url), '') = ''"
    )
    .bind({
      sanGinesId: "inpd3ywyh780d1r",
      sanGinesUrl:
        "https://chocolateriasangines.com/wp-content/uploads/2021/09/slide2iniciochoco.jpg",
      duPainId: "kutd24xl1x79tlm",
      duPainUrl:
        "https://cdn.prod.website-files.com/68d3ac079a10da70917c11f6/68f4b97e470178262d819ef5_opengraph_dpdi.png",
      tartineId: "vlhcf5p2go10vei",
      tartineUrl: "https://tartinebakery.com/assets/tartine-share.jpg",
    })
    .execute();
}, () => {
  // Forward-only: do not restore third-party Google thumbnail URLs.
  return null;
});

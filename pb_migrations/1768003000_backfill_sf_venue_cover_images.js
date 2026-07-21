/// <reference path="../pb_data/types.d.ts" />
//
// Backfills verified cover, dish, or venue images published by each venue's
// official website. The URLs are static here so boot never performs remote
// work. Dumpling Home is intentionally absent because its official URL
// currently redirects to a generic ordering-service page with no venue image.
//
// Forward-only and retry-safe: one bulk update is restricted to deterministic
// target ids with a blank image_url, so absent records are harmless and a
// retry never overwrites an image populated before or during a prior attempt.
migrate((app) => {
  app
    .db()
    .newQuery(
      "UPDATE venues SET image_url = CASE id " +
        "WHEN {:anchorId} THEN {:anchorUrl} " +
        "WHEN {:arsicaultId} THEN {:arsicaultUrl} " +
        "WHEN {:bansangId} THEN {:bansangUrl} " +
        "WHEN {:benuId} THEN {:benuUrl} " +
        "WHEN {:betterHalfId} THEN {:betterHalfUrl} " +
        "WHEN {:birdsongId} THEN {:birdsongUrl} " +
        "WHEN {:californiosId} THEN {:californiosUrl} " +
        "WHEN {:hildaId} THEN {:hildaUrl} " +
        "WHEN {:kitchenIstanbulId} THEN {:kitchenIstanbulUrl} " +
        "WHEN {:saisonId} THEN {:saisonUrl} " +
        "WHEN {:tonysId} THEN {:tonysUrl} " +
        "WHEN {:yankSingId} THEN {:yankSingUrl} " +
        "ELSE image_url END " +
        "WHERE id IN (" +
        "{:anchorId}, {:arsicaultId}, {:bansangId}, {:benuId}, " +
        "{:betterHalfId}, {:birdsongId}, {:californiosId}, {:hildaId}, " +
        "{:kitchenIstanbulId}, {:saisonId}, {:tonysId}, {:yankSingId}" +
        ") AND COALESCE(TRIM(image_url), '') = ''"
    )
    .bind({
      anchorId: "venuesf20260012",
      anchorUrl: "http://www.anchoroysterbar.com/anchorlay.png",
      arsicaultId: "venuesflocal001",
      arsicaultUrl:
        "https://arsicault-bakery.com/images/carousel/arguello.webp",
      bansangId: "venuesf20260013",
      bansangUrl:
        "https://static.wixstatic.com/media/6911ae_fc137f5201c644d5879fc1a39a247a79~mv2.jpg",
      benuId: "venuesf20260003",
      benuUrl:
        "https://static1.squarespace.com/static/55d235d8e4b075ba97039186/t/60ce581168579e7a028fb957/1624135697345/22+Hawthorne+Street%2C+San+Srancisco%2C+CA+94105.jpg",
      betterHalfId: "venuesflocal006",
      betterHalfUrl:
        "https://cdn.prod.website-files.com/64550ffd85bc54240b056570/6460715c8897146b220f0034_IMG_3CA08369DD03-3.jpeg",
      birdsongId: "venuesf20260010",
      birdsongUrl:
        "https://images.squarespace-cdn.com/content/v1/65c2ccd62a56cf0cd107eaf6/1455508b-aa73-458d-91d9-90bc1f84f66e/Birdsong_Paper_Pigeon.jpg?format=1500w",
      californiosId: "venuesf20260002",
      californiosUrl: "https://www.californiossf.com/images/gallery1.png",
      hildaId: "venuesf20260023",
      hildaUrl:
        "https://images.squarespace-cdn.com/content/v1/5c4a1641cc8fed7d3000f92b/1655416618541-9SS9BHM7HPNIOPPU1EA4/7E671ACB-B348-4058-915F-2E1EE58F95D5_1_105_c.jpeg?format=1500w",
      kitchenIstanbulId: "venuesf20260022",
      kitchenIstanbulUrl:
        "https://static.wixstatic.com/media/7853b5_882d98894a1849149ba3f2b109f5dd1c~mv2.jpg",
      saisonId: "venuesf20260009",
      saisonUrl:
        "https://saisonsf.com/wp-content/uploads/2025/06/20140418-Saison-7-14.jpg",
      tonysId: "venuesf20260025",
      tonysUrl:
        "https://tonyspizzanapoletana.com/wp-content/uploads/2024/10/Tony-making-a-pizza-tpn.webp",
      yankSingId: "venuesf20260020",
      yankSingUrl:
        "https://yanksing.com/wp-content/uploads/2021/03/banner-home-03.jpg",
    })
    .execute();
}, () => {
  // Forward-only: do not clear production images on migration rollback.
  return null;
});

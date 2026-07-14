# Three-city production deployment verification

**Verified:** 2026-07-14  
**Frontend:** https://detour-app.supernaut.to  
**Frontend commit:** `e2030ed9b28e05b601eaeb5477d44f55147dc93b`  
**Backend deployment:** `e556daeb-e7b6-4ce6-a81f-7a8792d79ce5` (healthy)  
**Backend URL:** https://sn-pb-repo-1297566350-6aebd3.fly.dev

## Live data verification

Platform-side reads against the healthy deployed backend confirmed the seeded catalogue is live:

- Madrid: 43 venues.
- Paris: 29 venues, 29 awards, and 29 source entries.
- San Francisco: 10 venues, 10 awards, and 10 source entries.

These Paris and San Francisco counts match the committed validation reports: [Paris coverage report](michelin-2026-paris-two-three-starred-coverage-report.md) and [San Francisco validation report](michelin-2026-san-francisco-starred-validation-report.md).

## Production browser smoke checks

- Desktop at 1440 × 1000 loaded Madrid (43 places), Paris (29), and San Francisco (10) through the city selector.
- Mobile at 390 × 844 opened Paris (29), switched to San Francisco (10), and loaded Madrid (43) through its direct city URL.
- San Francisco rendered all ten pins. Selecting the Atelier Crenn pin opened its detail view with award, address, and official MICHELIN guide link.
- The San Francisco 3 Stars filter reduced the active selection from 10 places to 4.
- The map-first layout, city selector, result counts, filter controls, venue detail, and official-guide links rendered without a browser-visible blocking error.

## Known coverage limitation

Paris is intentionally published with 29 source-attributed venues and awards but **zero independently verified coordinates**. Its city map therefore has no venue pins and explicitly tells visitors that map positions are being refined, while keeping every verified venue available in the list with an official-guide link. This is the rights-aware coverage limitation documented in the [Paris source-rights and curation plan](paris-source-rights-and-curation-plan.md), not a deployment defect.

## Result

The managed backend is healthy, the Paris and San Francisco seed migrations are applied to the persistent live volume, and the Cloudflare frontend is live on the commit above. Madrid, Paris, and San Francisco now load as distinct live city experiences.

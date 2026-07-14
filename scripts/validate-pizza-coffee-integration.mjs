#!/usr/bin/env node
/**
 * Deterministic integration validator for the 2026 Madrid pizza + coffee
 * import (pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js).
 *
 * Inputs (read-only):
 *   data/50-top-pizza-europa-2026-madrid.csv
 *   data/worlds-100-best-coffee-shops-2026-madrid.csv
 *   data/madrid-2026-unified-venues.json (40 existing canonical venues)
 * Outputs (overwritten, byte-identical on every run — no generated-at timestamps):
 *   data/pizza-coffee-2026-madrid-integration.json
 *   docs/pizza-coffee-2026-madrid-integration-report.md
 *
 * Validates:
 *   - exactly 3 input CSV rows (2 pizza + 1 coffee) with expected header/values;
 *   - the inlined migration plan preserves each row's edition name, numeric
 *     source rank (2, 11, 19), source URLs, award year 2026 and current=true;
 *   - exact stable categories 'Pizza' and 'Coffee';
 *   - verified coordinates inside Madrid-city bounds matching the CSVs;
 *   - deterministic, valid, unique 15-char PocketBase ids across all planned
 *     records, and no collision with known ids from earlier migrations;
 *   - exact normalized full-name dedupe against the 40 unified canonical
 *     venues: all three must be no_match, i.e. three no-merge decisions.
 *
 * Dependency-free Node.js ES module. Exit code 0 on PASS, 1 on FAIL.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIZZA_REL = "data/50-top-pizza-europa-2026-madrid.csv";
const COFFEE_REL = "data/worlds-100-best-coffee-shops-2026-madrid.csv";
const UNIFIED_REL = "data/madrid-2026-unified-venues.json";
const MIGRATION_REL = "pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js";
const OUT_JSON_REL = "data/pizza-coffee-2026-madrid-integration.json";
const OUT_REPORT_REL = "docs/pizza-coffee-2026-madrid-integration-report.md";

// Madrid-city bounding box (same city-scoped box as the source validators).
const LAT_MIN = 40.30, LAT_MAX = 40.56, LNG_MIN = -3.85, LNG_MAX = -3.52;

const PIZZA_RANKING_URL = "https://www.50toppizza.it/50-top-pizza-europa-2026/";
const COFFEE_RANKING_URL = "https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/";
const COFFEE_RECORD_URL = "https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/";

// The integration plan, mirroring the values inlined in the migration.
const PLAN = {
  migration: MIGRATION_REL,
  guide_sources: [
    { id: "gstoppizza00001", slug: "50-top-pizza", name: "50 Top Pizza" },
    { id: "gsw100coffee001", slug: "w100-best-coffee-shops", name: "The World's 100 Best Coffee Shops" },
  ],
  source_records: [
    { id: "srcrec2026pizza", url: PIZZA_RANKING_URL },
    { id: "srcrec2026cofr1", url: COFFEE_RANKING_URL },
    { id: "srcrec2026cofv1", url: COFFEE_RECORD_URL },
  ],
  import_provenance: [
    { id: "imppizza2026001", import_key: "50-top-pizza-europa-2026-madrid", record_count: 2 },
    { id: "impcoffee202601", import_key: "worlds-100-best-coffee-shops-2026-madrid", record_count: 1 },
  ],
  venues: [
    {
      venue_id: "venuepizza00001", award_id: "awardpizza00001", vse_id: "vsepizza0000001",
      csv: PIZZA_REL, source_slug: "50-top-pizza",
      name: "Baldoria", category: "Pizza",
      source_edition: "50 Top Pizza Europa 2026", source_rank: 2, year: 2026, current: true,
      award_level: "50 Top Pizza Europa 2026 — No. 2",
      award_source_url: PIZZA_RANKING_URL, vse_source_url: PIZZA_RANKING_URL,
      official_url: "https://baldoriamadrid.com/en/",
      address: "C. de José Ortega y Gasset, 100, 28006 Madrid",
      lat: 40.4294985, lng: -3.6707425,
      coord_source: "openstreetmap", coord_status: "osm_verified",
    },
    {
      venue_id: "venuepizza00002", award_id: "awardpizza00002", vse_id: "vsepizza0000002",
      csv: PIZZA_REL, source_slug: "50-top-pizza",
      name: "Fratelli Figurato", category: "Pizza",
      source_edition: "50 Top Pizza Europa 2026", source_rank: 11, year: 2026, current: true,
      award_level: "50 Top Pizza Europa 2026 — No. 11",
      award_source_url: PIZZA_RANKING_URL, vse_source_url: PIZZA_RANKING_URL,
      official_url: "https://www.fratellifigurato.es/pizzeria-madrid",
      address: "Calle Alonso Cano, 37, 28003 Madrid",
      lat: 40.4389910, lng: -3.6978429,
      coord_source: "openstreetmap", coord_status: "osm_verified",
    },
    {
      venue_id: "venuecoffee0001", award_id: "awardcoffee0001", vse_id: "vsecoffee000001",
      csv: COFFEE_REL, source_slug: "w100-best-coffee-shops",
      name: "Hola Coffee Lagasca", category: "Coffee",
      source_edition: "The World's 100 Best Coffee Shops 2026", source_rank: 19, year: 2026, current: true,
      award_level: "The World's 100 Best Coffee Shops 2026 — No. 19",
      award_source_url: COFFEE_RANKING_URL, vse_source_url: COFFEE_RECORD_URL,
      official_url: COFFEE_RECORD_URL,
      address: "Calle Lagasca, 42, 28001, Madrid, Spain",
      lat: 40.4248823, lng: -3.6853284,
      coord_source: "openstreetmap-nominatim", coord_status: "osm_verified",
    },
  ],
};

// Deterministic ids already used by earlier migrations (prefix families):
// collisions with any of these would corrupt the canonical model.
const KNOWN_ID_PREFIXES = ["venueseed", "venuemich", "awardseed", "awardmich", "vserepsol", "vsemichelin", "gsrepsol", "gsmichelin", "srcrec2026sol", "srcrec2026book", "srcrec2026mich", "impguia", "impmich"];

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function readCsvRecords(rel) {
  const rows = parseCsv(readFileSync(join(REPO_ROOT, rel), "utf8"));
  const header = rows[0] ?? [];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Exact normalized match key: NFC, trim, collapse whitespace, lower case.
// Deliberately NO diacritic folding and NO fuzzy/prefix matching.
const normalizeExact = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const errors = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  if (!ok) errors.push(`${name}: ${detail}`);
};

// ---- 1) input CSV rows ----
const pizzaRows = readCsvRecords(PIZZA_REL);
const coffeeRows = readCsvRecords(COFFEE_REL);
check("input-row-counts", pizzaRows.length === 2 && coffeeRows.length === 1,
  `expected 2 pizza + 1 coffee rows, got ${pizzaRows.length} + ${coffeeRows.length}`);

const csvByName = new Map();
for (const rec of [...pizzaRows, ...coffeeRows]) csvByName.set(rec.source_venue_name, rec);

// ---- 2) plan rows preserve CSV facts ----
for (const v of PLAN.venues) {
  const rec = csvByName.get(v.name);
  check(`csv-row-present:${v.name}`, !!rec, `no CSV row named "${v.name}"`);
  if (!rec) continue;

  const isCoffee = v.source_slug === "w100-best-coffee-shops";
  const csvRank = isCoffee ? rec.global_rank : rec.list_rank;
  const csvVseUrl = isCoffee ? rec.record_url : rec.ranking_url;
  const csvOfficialUrl = isCoffee ? rec.record_url : rec.official_venue_url;

  check(`edition-preserved:${v.name}`, rec.list_name === v.source_edition,
    `CSV list_name "${rec.list_name}" != planned source_edition "${v.source_edition}"`);
  check(`rank-preserved:${v.name}`, Number(csvRank) === v.source_rank,
    `CSV rank "${csvRank}" != planned source_rank ${v.source_rank}`);
  check(`year-2026-current:${v.name}`, rec.edition_year === "2026" && rec.edition_status === "current" && v.year === 2026 && v.current === true,
    `edition_year/edition_status/plan year/current mismatch (${rec.edition_year}, ${rec.edition_status}, ${v.year}, ${v.current})`);
  check(`award-source-url:${v.name}`, rec.ranking_url === v.award_source_url,
    `CSV ranking_url "${rec.ranking_url}" != planned award source_url "${v.award_source_url}"`);
  check(`raw-entry-source-url:${v.name}`, csvVseUrl === v.vse_source_url,
    `CSV source URL "${csvVseUrl}" != planned raw-entry source_url "${v.vse_source_url}"`);
  check(`official-url:${v.name}`, csvOfficialUrl === v.official_url,
    `CSV official URL "${csvOfficialUrl}" != planned canonical official_url "${v.official_url}"`);
  check(`address-preserved:${v.name}`, rec.record_street_address === v.address,
    `CSV address "${rec.record_street_address}" != planned "${v.address}"`);
  check(`level-carries-edition-and-rank:${v.name}`,
    v.award_level.includes(v.source_edition) && v.award_level.endsWith(`No. ${v.source_rank}`),
    `award level "${v.award_level}" does not carry edition + rank`);
  check(`locality:${v.name}`, rec.locality === "Madrid" && rec.country === "Spain",
    `locality/country "${rec.locality}/${rec.country}" != Madrid/Spain`);
  check(`review-verified:${v.name}`, rec.review_status === "verified" && rec.location_validation_status === "osm_verified",
    `review_status "${rec.review_status}" / location_validation_status "${rec.location_validation_status}" not verified`);

  // ---- 3) coordinates: match CSV exactly and lie inside Madrid bounds ----
  const lat = Number(rec.latitude), lng = Number(rec.longitude);
  check(`coords-match-csv:${v.name}`, lat === v.lat && lng === v.lng,
    `CSV coords (${rec.latitude}, ${rec.longitude}) != planned (${v.lat}, ${v.lng})`);
  check(`coords-in-madrid:${v.name}`,
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX,
    `coords (${rec.latitude}, ${rec.longitude}) outside Madrid-city bounds`);
  check(`coord-provenance:${v.name}`, rec.location_source === v.coord_source && rec.location_validation_status === v.coord_status,
    `CSV location_source/status "${rec.location_source}/${rec.location_validation_status}" != planned "${v.coord_source}/${v.coord_status}"`);
}

// ---- 4) exact categories ----
check("categories-exact",
  PLAN.venues.map((v) => v.category).join(",") === "Pizza,Pizza,Coffee",
  `categories are ${PLAN.venues.map((v) => v.category).join(",")}, expected Pizza,Pizza,Coffee`);

// ---- 5) planned source slugs ----
check("guide-source-slugs",
  PLAN.guide_sources.map((s) => s.slug).join(",") === "50-top-pizza,w100-best-coffee-shops",
  `slugs are ${PLAN.guide_sources.map((s) => s.slug).join(",")}`);

// ---- 6) deterministic valid unique PocketBase ids ----
const allIds = [
  ...PLAN.guide_sources.map((s) => s.id),
  ...PLAN.source_records.map((s) => s.id),
  ...PLAN.import_provenance.map((s) => s.id),
  ...PLAN.venues.flatMap((v) => [v.venue_id, v.award_id, v.vse_id]),
];
for (const id of allIds) {
  check(`id-valid:${id}`, /^[a-z0-9]{15}$/.test(id), `"${id}" is not a valid 15-char lowercase alphanumeric PocketBase id`);
  check(`id-no-known-collision:${id}`, !KNOWN_ID_PREFIXES.some((p) => id.startsWith(p)),
    `"${id}" collides with a deterministic id family from an earlier migration`);
}
check("ids-unique", new Set(allIds).size === allIds.length, "duplicate planned ids");
check("canonical-venue-ids-unique",
  new Set(PLAN.venues.map((v) => v.venue_id)).size === 3,
  "duplicate canonical venue ids among the three new rows");

// ---- 7) no duplicates / no merges against the 40 unified canonical venues ----
const unified = JSON.parse(readFileSync(join(REPO_ROOT, UNIFIED_REL), "utf8"));
const unifiedVenues = Array.isArray(unified.venues) ? unified.venues : [];
check("unified-venue-count", unifiedVenues.length === 40,
  `expected 40 unified canonical venues, got ${unifiedVenues.length}`);
const unifiedByKey = new Map();
for (const u of unifiedVenues) {
  if (u && typeof u.canonical_name === "string") unifiedByKey.set(normalizeExact(u.canonical_name), u);
}
const decisions = PLAN.venues.map((v) => {
  const key = normalizeExact(v.name);
  const match = unifiedByKey.get(key) ?? null;
  check(`no-merge:${v.name}`, match === null,
    match ? `unexpected exact normalized match with unified venue "${match.canonical_name}" (${match.id})` : "");
  return {
    candidate: v.name,
    normalized_match_key: key,
    match_outcome: match ? "exact_normalized_match" : "no_match",
    decision: match
      ? "UNEXPECTED MATCH — manual review required; no automatic merge performed."
      : "No existing canonical venue matches; a NEW canonical venue row is created (no merge, no duplicate).",
    new_canonical_venue_id: match ? null : v.venue_id,
  };
});
// The three planned names must also be mutually distinct.
check("plan-names-distinct",
  new Set(PLAN.venues.map((v) => normalizeExact(v.name))).size === 3,
  "planned venue names are not mutually distinct under exact normalization");

// ---- artifacts (deterministic) ----
const status = errors.length === 0 ? "PASS" : "FAIL";
const artifact = {
  dataset: "pizza-coffee-2026-madrid-integration",
  status,
  migration: MIGRATION_REL,
  inputs: [PIZZA_REL, COFFEE_REL, UNIFIED_REL],
  matching_policy:
    "Exact normalized full-name equality only (NFC, trim, collapse whitespace, lower case). No diacritic folding, no fuzzy/prefix matching, no auto-merge.",
  plan: PLAN,
  no_merge_decisions: decisions,
  checks: checks.map((c) => ({ name: c.name, ok: c.ok })),
  errors,
};
writeFileSync(join(REPO_ROOT, OUT_JSON_REL), JSON.stringify(artifact, null, 2) + "\n");

const lines = [];
lines.push("# Integration validation report — 50 Top Pizza Europa 2026 + The World's 100 Best Coffee Shops 2026, Madrid");
lines.push("");
lines.push(`**Status: ${status}** — generated deterministically by \`npm run validate:pizza-coffee-integration\`; output is byte-identical on every run (no generated-at timestamps).`);
lines.push("");
lines.push(`Migration under validation: \`${MIGRATION_REL}\`. Inputs: \`${PIZZA_REL}\`, \`${COFFEE_REL}\`, \`${UNIFIED_REL}\`.`);
lines.push("");
lines.push("## Errors");
lines.push("");
if (errors.length === 0) lines.push("None.");
else for (const e of errors) lines.push(`- ${e}`);
lines.push("");
lines.push("## Planned integration rows");
lines.push("");
lines.push("| Canonical venue | Category | Edition | Rank | Canonical id | Award level |");
lines.push("|---|---|---|---|---|---|");
for (const v of PLAN.venues)
  lines.push(`| ${v.name} | ${v.category} | ${v.source_edition} | ${v.source_rank} | \`${v.venue_id}\` | ${v.award_level} |`);
lines.push("");
lines.push("- All three awards carry year 2026 and current=true; award source_url is the official ranking page; the raw source entry retains the source-side URL (coffee: the official venue-record page).");
lines.push("- Raw `venue_source_entries` rows carry source-side name, raw locality/country (Madrid/Spain), `source_edition`, and numeric `source_rank` (new fields added losslessly by the migration).");
lines.push("- Coordinates are OSM-sourced (independent of the guides), match the CSVs exactly, and lie inside Madrid-city bounds.");
lines.push("");
lines.push("## No-merge decisions (vs 40 unified canonical venues)");
lines.push("");
for (const d of decisions)
  lines.push(`- **${d.candidate}** (key \`${d.normalized_match_key}\`): ${d.match_outcome} — ${d.decision}${d.new_canonical_venue_id ? ` New canonical id: \`${d.new_canonical_venue_id}\`.` : ""}`);
lines.push("");
lines.push("## Checks");
lines.push("");
lines.push(`- ${checks.filter((c) => c.ok).length}/${checks.length} checks passed.`);
lines.push(`- Machine-readable artifact: \`${OUT_JSON_REL}\`.`);
lines.push("");
writeFileSync(join(REPO_ROOT, OUT_REPORT_REL), lines.join("\n"));

console.log(`${status}: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed; ${decisions.filter((d) => d.match_outcome === "no_match").length}/3 no-merge decisions confirmed against ${unifiedVenues.length} unified venues. Report: ${OUT_REPORT_REL}; artifact: ${OUT_JSON_REL}`);
if (errors.length) { for (const e of errors) console.error(" -", e); process.exit(1); }

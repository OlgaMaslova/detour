#!/usr/bin/env node
/**
 * Dependency-free deterministic validator for the 15-row San Francisco
 * catalogue expansion. Validates the audit CSV, deterministic ids, source and
 * coordinate qualifiers, no exact-name collision with the existing SF seed,
 * and the retry-safe migration shape. Writes a stable Markdown report.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_REL = "data/san-francisco-catalogue-expansion.csv";
const EXISTING_REL = "data/michelin-2026-san-francisco-two-three-starred.csv";
const MIGRATION_REL = "pb_migrations/1767984000_add_san_francisco_catalogue_expansion.js";
const REPORT_REL = "docs/san-francisco-catalogue-expansion-validation-report.md";
const csvText = readFileSync(join(ROOT, CSV_REL), "utf8");
const migration = readFileSync(join(ROOT, MIGRATION_REL), "utf8");

const HEADER = [
  "canonical_name", "category", "street_address", "latitude", "longitude", "source_name", "source_slug",
  "source_edition", "guide_year", "distinction", "distinction_level", "source_rank", "source_url", "source_type",
  "shared_source_url", "shared_source_type", "shared_source_published_at", "source_accessed_at", "official_url",
  "coordinate_source", "coordinate_validation_status", "coordinate_note",
];
const ACCESS_DATE = "2026-07-16";
const BIB_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/california-s-most-affordable-restaurants-in-2026";
const EDITION_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california";
const PIZZA_URL = "https://www.50toppizza.it/50-top-usa-2025/";
const EXPECTED = [
  ["A16", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Anchor Oyster Bar", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Bansang", "Casual", "bib-gourmand", "0", "osm_address_verified"],
  ["Dumpling Home", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Good Good Culture Club", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Izakaya Rintaro", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Okane", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Outerlands", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Trestle", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Yank Sing", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Z & Y", "Casual", "bib-gourmand", "0", "osm_address_verified"],
  ["Kitchen Istanbul", "Casual", "bib-gourmand", "0", "osm_verified"],
  ["Hilda and Jesse", "Fine dining", "one-star", "1", "osm_verified"],
  ["Nisei", "Fine dining", "one-star", "1", "osm_address_verified"],
  ["Tony’s Pizza Napoletana", "Pizza", "50 Top Pizza USA 2025 — No. 3", "3", "osm_verified"],
];

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const normalize = (value) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const validUrl = (value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
};
const raw = parseCsv(csvText);
const header = raw[0] ?? [];
const records = raw.slice(1).map((row) => Object.fromEntries(header.map((name, index) => [name, (row[index] ?? "").trim()])));
const errors = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  if (!ok) errors.push(`${name}: ${detail}`);
};

check("header", header.join("|") === HEADER.join("|"), `unexpected CSV header: ${header.join(",")}`);
check("record-count", records.length === 15, `expected 15 rows, got ${records.length}`);
const expectedByName = new Map(EXPECTED.map((row) => [row[0], row]));
const seenNames = new Set();
const seenSourceUrls = new Set();
const categoryCounts = { Casual: 0, Pizza: 0, "Fine dining": 0 };
const distinctionCounts = { "bib-gourmand": 0, "one-star": 0, pizza: 0 };
const coordCounts = { osm_verified: 0, osm_address_verified: 0 };

for (const [index, record] of records.entries()) {
  const label = `row-${index + 2}:${record.canonical_name || "?"}`;
  for (const field of HEADER) {
    const optional = new Set(["shared_source_url", "shared_source_type", "shared_source_published_at"]);
    if (!optional.has(field)) check(`${label}:required:${field}`, !!record[field], `${field} is blank`);
  }
  const expected = expectedByName.get(record.canonical_name);
  check(`${label}:approved-name`, !!expected, "row is not in the approved 15-venue roster");
  if (expected) {
    check(`${label}:category`, record.category === expected[1], `expected ${expected[1]}, got ${record.category}`);
    check(`${label}:distinction`, record.distinction === expected[2], `expected ${expected[2]}, got ${record.distinction}`);
    check(`${label}:distinction-level`, record.distinction_level === expected[3], `expected ${expected[3]}, got ${record.distinction_level}`);
    check(`${label}:coord-status`, record.coordinate_validation_status === expected[4], `expected ${expected[4]}, got ${record.coordinate_validation_status}`);
  }
  const key = normalize(record.canonical_name);
  check(`${label}:unique-name`, !seenNames.has(key), "duplicate normalized canonical name");
  seenNames.add(key);
  check(`${label}:unique-source-url`, !seenSourceUrls.has(record.source_url), "duplicate row-authority source URL");
  seenSourceUrls.add(record.source_url);
  check(`${label}:access-date`, record.source_accessed_at === ACCESS_DATE, `expected ${ACCESS_DATE}`);
  check(`${label}:address-sf`, /San Francisco, CA 94\d{3}$/.test(record.street_address), "address is not an SF postal address");
  const lat = Number(record.latitude), lng = Number(record.longitude);
  check(`${label}:nonzero-coordinates`, Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0, `invalid coordinates ${record.latitude},${record.longitude}`);
  check(`${label}:sf-bounds`, lat >= 37.70 && lat <= 37.83 && lng >= -122.53 && lng <= -122.34, `coordinates outside San Francisco bounds`);
  check(`${label}:coord-source`, record.coordinate_source === "openstreetmap-nominatim", `unexpected coordinate source ${record.coordinate_source}`);
  check(`${label}:coord-note-independent`, /OSM/.test(record.coordinate_note) && /not supplied by/.test(record.coordinate_note), "coordinate note must identify independent OSM provenance");
  check(`${label}:source-url`, validUrl(record.source_url), "invalid row source URL");
  check(`${label}:official-url`, validUrl(record.official_url), "invalid official operator URL");
  if (Object.hasOwn(categoryCounts, record.category)) categoryCounts[record.category]++;
  if (Object.hasOwn(coordCounts, record.coordinate_validation_status)) coordCounts[record.coordinate_validation_status]++;

  if (record.distinction === "bib-gourmand") {
    distinctionCounts["bib-gourmand"]++;
    check(`${label}:bib-source`, record.source_slug === "michelin-guide" && record.source_type === "official-restaurant-record", "Bib row must use an individual Michelin restaurant record");
    check(`${label}:bib-year-edition`, record.guide_year === "2026" && record.source_edition === "MICHELIN Guide California 2026", "Bib year/edition mismatch");
    check(`${label}:bib-shared-source`, record.shared_source_url === BIB_URL && record.shared_source_type === "official-roundup" && record.shared_source_published_at === "", "Bib shared roundup mismatch");
    check(`${label}:bib-rank-zero`, record.source_rank === "0", "Bib source_rank must be numeric zero for an unranked recognition");
  } else if (record.distinction === "one-star") {
    distinctionCounts["one-star"]++;
    check(`${label}:star-source`, record.source_slug === "michelin-guide" && record.source_type === "official-restaurant-record", "one-star row must use an individual Michelin restaurant record");
    check(`${label}:star-year-edition`, record.guide_year === "2026" && record.source_edition === "MICHELIN Guide California 2026", "one-star year/edition mismatch");
    check(`${label}:star-shared-source`, record.shared_source_url === EDITION_URL && record.shared_source_type === "official-edition-announcement" && record.shared_source_published_at === "2026-06-24", "one-star governing edition mismatch");
    check(`${label}:star-rank-zero`, record.source_rank === "0", "one-star source_rank must be numeric zero for an unranked recognition");
  } else {
    distinctionCounts.pizza++;
    check(`${label}:pizza-source`, record.source_name === "50 Top Pizza" && record.source_slug === "50-top-pizza" && record.source_url === PIZZA_URL && record.source_type === "official-ranking-page", "pizza source mismatch");
    check(`${label}:pizza-ranking`, record.guide_year === "2025" && record.source_edition === "50 Top Pizza USA 2025" && record.source_rank === "3", "pizza year/edition/rank mismatch");
    check(`${label}:pizza-shared-empty`, !record.shared_source_url && !record.shared_source_type && !record.shared_source_published_at, "pizza row should not invent a second source surface");
  }
}

check("roster-complete", EXPECTED.every(([name]) => seenNames.has(normalize(name))), "one or more approved names are missing");
check("category-counts", categoryCounts.Casual === 12 && categoryCounts.Pizza === 1 && categoryCounts["Fine dining"] === 2, `got ${JSON.stringify(categoryCounts)}`);
check("distinction-counts", distinctionCounts["bib-gourmand"] === 12 && distinctionCounts["one-star"] === 2 && distinctionCounts.pizza === 1, `got ${JSON.stringify(distinctionCounts)}`);
check("coordinate-counts", coordCounts.osm_verified === 12 && coordCounts.osm_address_verified === 3, `got ${JSON.stringify(coordCounts)}`);
check("row-source-count", seenSourceUrls.size === 15, `expected 15 unique row-authority URLs, got ${seenSourceUrls.size}`);

// No exact normalized canonical-name collision with the 10 existing SF rows.
const existingRaw = parseCsv(readFileSync(join(ROOT, EXISTING_REL), "utf8"));
const existingHeader = existingRaw[0] ?? [];
const existingNameIndex = existingHeader.indexOf("restaurant_name");
const existingNames = new Set(existingRaw.slice(1).map((row) => normalize(row[existingNameIndex] ?? "")));
const collisions = records.map((r) => r.canonical_name).filter((name) => existingNames.has(normalize(name)));
check("no-existing-sf-name-collisions", collisions.length === 0, `exact normalized collisions: ${collisions.join(", ")}`);

// Deterministic 15-character ids, continuing the existing SF 001-010 family.
const venueIds = records.map((_, index) => "venuesf2026" + String(index + 11).padStart(4, "0"));
const awardIds = records.map((_, index) => "awardsf2026" + String(index + 11).padStart(4, "0"));
const entryIds = records.map((_, index) => "vsesf2026" + String(index + 11).padStart(6, "0"));
const recordIds = records.map((_, index) => index < 14 ? "srcsf2026rec" + String(index + 11).padStart(3, "0") : "srcsf2025piz001");
const supportingIds = ["srcsf2026bib001", "srcsf2026ann001", "impsf2026cat001", "impsf2025piz001"];
const allIds = [...venueIds, ...awardIds, ...entryIds, ...recordIds, ...supportingIds];
for (const id of allIds) check(`id-valid:${id}`, /^[a-z0-9]{15}$/.test(id), `${id} is not 15 lowercase alphanumeric characters`);
check("ids-unique", new Set(allIds).size === allIds.length, "planned ids are not unique");

// Migration shape: no schema invention, all six data families use retry-safe inserts.
check("migration-no-schema-change", !/new\s+(TextField|NumberField|Collection)|\.fields\.(add|remove)|\.fields\s*=/.test(migration), "migration must not alter the schema");
for (const table of ["guide_sources", "source_records", "import_provenance", "venues", "venue_awards", "venue_source_entries"]) {
  check(`migration-insert-or-ignore:${table}`, migration.includes(`INSERT OR IGNORE INTO ${table}`), `${table} is not seeded with INSERT OR IGNORE`);
}
check("migration-source-edition-rank", migration.includes("source_edition, source_rank"), "raw entries must preserve source edition/rank");
check("migration-ranks-numeric", !migration.includes("rank: null") && !migration.includes('row.rank === null ? "NULL"'), "migration must bind numeric rank 0 for unranked MICHELIN rows instead of generating SQL NULL");
check("migration-forward-only", migration.includes("return null;"), "down migration must be a no-op");
check("migration-no-editorial-field", !/editorial[_ ]description/i.test(migration), "migration invents an editorial description field");
for (const [index, record] of records.entries()) {
  check(`migration-row:${record.canonical_name}`, migration.includes(JSON.stringify(record.canonical_name)) && migration.includes(JSON.stringify(record.source_url)), "migration does not inline the exact name/source URL");
  check(`migration-ids:${record.canonical_name}`, migration.includes(recordIds[index]), `migration missing source record id ${recordIds[index]}`);
}

const status = errors.length ? "FAIL" : "PASS";
const lines = [
  "# Validation report — San Francisco catalogue expansion",
  "",
  `**Status: ${status}** — generated deterministically by \`npm run validate:sf-catalogue-expansion\`.`,
  "",
  `Inputs: \`${CSV_REL}\`, \`${EXISTING_REL}\`, and \`${MIGRATION_REL}\`.`,
  "",
  "## Coverage",
  "",
  `- New canonical venues: ${records.length}`,
  `- MICHELIN 2026 Bib Gourmands: ${distinctionCounts["bib-gourmand"]}`,
  `- MICHELIN 2026 one-star additions: ${distinctionCounts["one-star"]}`,
  `- 50 Top Pizza USA 2025 entries: ${distinctionCounts.pizza}`,
  `- Categories: Casual ${categoryCounts.Casual}, Fine dining ${categoryCounts["Fine dining"]}, Pizza ${categoryCounts.Pizza}`,
  `- Named OSM/Nominatim pins (including Rintaro under its exact short name): ${coordCounts.osm_verified}`,
  `- Address-level OSM/Nominatim pins: ${coordCounts.osm_address_verified}`,
  `- Nonzero map coordinates: ${records.filter((r) => Number(r.latitude) !== 0 && Number(r.longitude) !== 0).length}`,
  `- Unique row-authority source URLs: ${seenSourceUrls.size}`,
  "",
  "## Provenance rules checked",
  "",
  "- Each MICHELIN row uses its individual official restaurant record as row authority.",
  `- The 12 Bib rows retain the [official 2026 roundup](${BIB_URL}) as a shared source record.`,
  `- The two one-star rows retain the [California edition announcement](${EDITION_URL}) published 2026-06-24.`,
  `- Tony’s Pizza Napoletana retains the [official 50 Top Pizza USA 2025 ranking](${PIZZA_URL}) and rank 3.`,
  "- Coordinate provenance is independently attributed to OpenStreetMap/Nominatim, never to either guide.",
  "- Exact normalized-name comparison found no collision with the 10 existing San Francisco canonical rows.",
  "- Unranked MICHELIN recognitions use numeric rank `0` in both awards and source entries; the migration generates no SQL `NULL` for rank columns.",
  "- The migration adds no schema field and uses bulk `INSERT OR IGNORE` for every seeded table.",
  "",
  "## Validation errors",
  "",
  ...(errors.length ? errors.map((error) => `- ${error}`) : ["None."]),
  "",
  "## Approved roster",
  "",
  "| Venue | Category | Distinction | Coordinate status |",
  "|---|---|---|---|",
  ...EXPECTED.map(([name, category, distinction, , coordStatus]) => `| ${name} | ${category} | ${distinction} | ${coordStatus} |`),
  "",
  `Checks passed: ${checks.filter((c) => c.ok).length}/${checks.length}.`,
  "",
];
writeFileSync(join(ROOT, REPORT_REL), lines.join("\n"));
console.log(`${status}: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed; 15 venues; Bib 12; one-star 2; pizza 1; named pins ${coordCounts.osm_verified}; address-level pins ${coordCounts.osm_address_verified}. Report: ${REPORT_REL}`);
if (errors.length) {
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

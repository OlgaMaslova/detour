#!/usr/bin/env node
/**
 * Deterministic validator for the 2026 Michelin Guide Madrid-city starred dataset.
 *
 * Input:  data/michelin-2026-madrid-city-starred.csv
 * Output: docs/michelin-2026-madrid-starred-qa-report.md (overwritten)
 *
 * Validates per-record required fields, official guide.michelin.com HTTPS
 * provenance (exact per-star-category listing URL), guide year, coordinate
 * bounds with a qualified status (osm_verified / osm_address_verified /
 * osm_approximate) or deliberate blank+needs_review pairing, normalized duplicates, and
 * the exact scope shape (30 records; 1 three-star, 6 two-star, 23 one-star;
 * 38 stars = 1×3 + 6×2 + 23×1). It also enumerates the known out-of-scope exclusions and every
 * coordinate exception so QA is inspectable.
 *
 * Dependency-free Node.js ES module. No generated-at timestamp: output depends
 * only on the input CSV, so the report is fully deterministic.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_REL = "data/michelin-2026-madrid-city-starred.csv";
const INPUT = join(REPO_ROOT, INPUT_REL);
const OUTPUT_REL = "docs/michelin-2026-madrid-starred-qa-report.md";
const OUTPUT = join(REPO_ROOT, OUTPUT_REL);

const REQUIRED_FIELDS = [
  "restaurant_name",
  "source_restaurant_name",
  "michelin_distinction",
  "michelin_stars",
  "guide_year",
  "locality",
  "country",
  "source_url",
  "source_type",
  "source_accessed_at",
  "coord_validation_status",
  "note",
];
// street_address, latitude, longitude, coord_source are conditionally required.

const HEADER = [
  ...REQUIRED_FIELDS.slice(0, 7),
  "street_address",
  "latitude",
  "longitude",
  ...REQUIRED_FIELDS.slice(7, 10),
  "coord_source",
  ...REQUIRED_FIELDS.slice(10),
];

const REQUIRED_GUIDE_YEAR = "2026";
const REQUIRED_LOCALITY = "Madrid";
const REQUIRED_COUNTRY = "Spain";
const REQUIRED_ACCESS_DATE = "2026-07-12";
const REQUIRED_SOURCE_TYPE = "official-category-listing";
const CATEGORY_URLS = {
  3: "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/3-estrellas-michelin",
  2: "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/2-estrellas-michelin",
  1: "https://guide.michelin.com/es/es/comunidad-de-madrid/madrid/restaurantes/1-estrella-michelin",
};
const DISTINCTION_BY_STARS = { 3: "three-stars", 2: "two-stars", 1: "one-star" };
// Coordinate quality tiers for rows carrying coordinates:
// - osm_verified: named restaurant identity confirmed in OSM.
// - osm_address_verified: exact OSM address/building geometry, venue identity not necessarily tagged.
// - osm_approximate: explicit location approximation (e.g. plaza centroid), not exact venue geometry.
const COORD_STATUSES = new Set(["osm_verified", "osm_address_verified", "osm_approximate"]);
const NONVERIFIED_STATUSES = new Set(["needs_review"]);
// Madrid-city bounding box (generous but city-scoped).
const LAT_MIN = 40.30, LAT_MAX = 40.56, LNG_MIN = -3.85, LNG_MAX = -3.52;

const EXPECTED_TOTAL = 30;
const EXPECTED_BREAKDOWN = { 3: 1, 2: 6, 1: 23 };
const EXPECTED_STARS = 38; // 1×3 + 6×2 + 23×1

// Official capture 2026-07-12: 1-star results excluded as outside Madrid city.
const KNOWN_EXCLUSIONS = [
  { name: "Ancestral", locality: "Pozuelo de Alarcón", stars: 1 },
  { name: "Chirón", locality: "Valdemoro", stars: 1 },
];

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

const normalizeName = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const errors = [];
const rowsRaw = parseCsv(readFileSync(INPUT, "utf8"));
const header = rowsRaw[0] ?? [];
if (header.join(",") !== HEADER.join(",")) {
  errors.push(`Header mismatch. Expected: ${HEADER.join(",")} — got: ${header.join(",")}`);
}
const records = rowsRaw.slice(1).map((r) =>
  Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))
);

const coordExceptions = [];
const approximateRows = [];
const statusCounts = { osm_verified: 0, osm_address_verified: 0, osm_approximate: 0, needs_review: 0 };
const seen = new Map();
for (const [i, rec] of records.entries()) {
  const label = `row ${i + 2} (${rec.restaurant_name || "?"})`;
  for (const f of REQUIRED_FIELDS) {
    if (!rec[f]) errors.push(`${label}: missing required field "${f}"`);
  }
  const stars = Number(rec.michelin_stars);
  if (![1, 2, 3].includes(stars)) errors.push(`${label}: invalid michelin_stars "${rec.michelin_stars}"`);
  else {
    if (rec.michelin_distinction !== DISTINCTION_BY_STARS[stars])
      errors.push(`${label}: michelin_distinction "${rec.michelin_distinction}" does not match ${stars} star(s)`);
    if (rec.source_url !== CATEGORY_URLS[stars])
      errors.push(`${label}: source_url is not the official ${stars}-star category listing URL`);
  }
  try {
    const u = new URL(rec.source_url);
    if (u.protocol !== "https:" || u.hostname !== "guide.michelin.com")
      errors.push(`${label}: source_url is not HTTPS guide.michelin.com`);
  } catch { errors.push(`${label}: source_url is not a valid URL`); }
  if (rec.guide_year !== REQUIRED_GUIDE_YEAR) errors.push(`${label}: guide_year must be ${REQUIRED_GUIDE_YEAR}`);
  if (rec.locality !== REQUIRED_LOCALITY) errors.push(`${label}: locality must be ${REQUIRED_LOCALITY}`);
  if (rec.country !== REQUIRED_COUNTRY) errors.push(`${label}: country must be ${REQUIRED_COUNTRY}`);
  if (rec.source_type !== REQUIRED_SOURCE_TYPE) errors.push(`${label}: source_type must be ${REQUIRED_SOURCE_TYPE}`);
  if (rec.source_accessed_at !== REQUIRED_ACCESS_DATE) errors.push(`${label}: source_accessed_at must be ${REQUIRED_ACCESS_DATE}`);

  const hasLat = rec.latitude !== "", hasLng = rec.longitude !== "";
  if (hasLat !== hasLng) errors.push(`${label}: latitude/longitude must be both present or both blank`);
  if (hasLat && hasLng) {
    const lat = Number(rec.latitude), lng = Number(rec.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX)
      errors.push(`${label}: coordinates (${rec.latitude}, ${rec.longitude}) outside Madrid-city bounds`);
    if (!COORD_STATUSES.has(rec.coord_validation_status))
      errors.push(`${label}: rows with coordinates must have coord_validation_status in {${[...COORD_STATUSES].join(", ")}}, got "${rec.coord_validation_status}"`);
    if (rec.coord_source !== "openstreetmap-nominatim")
      errors.push(`${label}: rows with coordinates must have coord_source=openstreetmap-nominatim`);
    if (!rec.street_address) errors.push(`${label}: rows with coordinates must carry a street_address`);
    if (rec.coord_validation_status === "osm_approximate") approximateRows.push(rec);
  } else {
    if (!NONVERIFIED_STATUSES.has(rec.coord_validation_status))
      errors.push(`${label}: blank coordinates require a nonverified status (e.g. needs_review), got "${rec.coord_validation_status}"`);
    if (rec.coord_source !== "") errors.push(`${label}: blank-coordinate rows must leave coord_source blank`);
    coordExceptions.push(rec);
  }
  if (rec.coord_validation_status in statusCounts) statusCounts[rec.coord_validation_status]++;

  const key = normalizeName(rec.restaurant_name);
  if (seen.has(key)) errors.push(`${label}: normalized duplicate of ${seen.get(key)}`);
  else seen.set(key, label);
}

const breakdown = { 1: 0, 2: 0, 3: 0 };
let totalStars = 0;
for (const rec of records) {
  const s = Number(rec.michelin_stars);
  if ([1, 2, 3].includes(s)) { breakdown[s]++; totalStars += s; }
}
if (records.length !== EXPECTED_TOTAL)
  errors.push(`Total records ${records.length} != expected ${EXPECTED_TOTAL}`);
for (const s of [3, 2, 1]) {
  if (breakdown[s] !== EXPECTED_BREAKDOWN[s])
    errors.push(`${s}-star count ${breakdown[s]} != expected ${EXPECTED_BREAKDOWN[s]}`);
}
if (totalStars !== EXPECTED_STARS)
  errors.push(`Total stars ${totalStars} != expected ${EXPECTED_STARS}`);

const status = errors.length === 0 ? "PASS" : "FAIL";
const lines = [];
lines.push("# QA report — 2026 Michelin Guide Madrid-city starred dataset");
lines.push("");
lines.push(`**Status: ${status}** — generated deterministically by \`npm run validate:michelin-madrid\` from \`${INPUT_REL}\`.`);
lines.push("");
lines.push("## Scope shape");
lines.push("");
lines.push(`- Total records: ${records.length} (expected ${EXPECTED_TOTAL})`);
lines.push(`- 3-star: ${breakdown[3]} (expected ${EXPECTED_BREAKDOWN[3]}); 2-star: ${breakdown[2]} (expected ${EXPECTED_BREAKDOWN[2]}); 1-star: ${breakdown[1]} (expected ${EXPECTED_BREAKDOWN[1]})`);
lines.push(`- Total stars: ${totalStars} (expected ${EXPECTED_STARS})`);
lines.push("");
lines.push("## Errors");
lines.push("");
if (errors.length === 0) lines.push("None.");
else for (const e of errors) lines.push(`- ${e}`);
lines.push("");
lines.push("## Deliberate out-of-scope exclusions (official capture 2026-07-12)");
lines.push("");
lines.push("These appeared on the official 1-star “Madrid y alrededores” category page but sit outside Madrid city and are excluded by design:");
lines.push("");
for (const x of KNOWN_EXCLUSIONS) lines.push(`- ${x.name} (${x.locality}, ${x.stars}-star)`);
lines.push("");
lines.push("Non-starred categories (Bib Gourmand / Selected) are entirely out of scope and unenumerated.");
lines.push("");
lines.push("## Coordinate quality breakdown");
lines.push("");
lines.push(`- osm_verified (named restaurant identity in OSM): ${statusCounts.osm_verified}`);
lines.push(`- osm_address_verified (exact OSM address/building geometry, venue identity not necessarily tagged): ${statusCounts.osm_address_verified}`);
lines.push(`- osm_approximate (explicit location approximation, not exact venue geometry): ${statusCounts.osm_approximate}`);
lines.push(`- needs_review (blank coordinates, no pin asserted): ${statusCounts.needs_review}`);
lines.push("");
lines.push("## Coordinate exceptions (blank coordinates, retained records)");
lines.push("");
if (coordExceptions.length === 0) lines.push("None — every record carries OSM-qualified coordinates.");
else {
  lines.push(`${coordExceptions.length} of ${records.length} records are retained without coordinates rather than asserting an unverified pin:`);
  lines.push("");
  for (const rec of coordExceptions)
    lines.push(`- ${rec.restaurant_name} (${rec.michelin_stars}-star) — ${rec.coord_validation_status}: ${rec.note}`);
}
lines.push("");
lines.push("## Approximate coordinates (retained, explicitly not exact venue geometry)");
lines.push("");
if (approximateRows.length === 0) lines.push("None.");
else {
  for (const rec of approximateRows)
    lines.push(`- ${rec.restaurant_name} (${rec.michelin_stars}-star) — ${rec.coord_validation_status}: ${rec.note}`);
}
lines.push("");
lines.push(`Coordinate-carrying records: ${records.length - coordExceptions.length} of ${records.length} (source: OpenStreetMap/Nominatim, independent of Michelin). Address/building-level and approximate pins are labelled and are never presented as named-restaurant OSM matches.`);
lines.push("");

writeFileSync(OUTPUT, lines.join("\n"));
console.log(`${status}: ${records.length} records, stars 3/2/1 = ${breakdown[3]}/${breakdown[2]}/${breakdown[1]}, total stars ${totalStars}, coords verified/address/approx = ${statusCounts.osm_verified}/${statusCounts.osm_address_verified}/${statusCounts.osm_approximate}, blank needs_review ${coordExceptions.length}. Report: ${OUTPUT_REL}`);
if (errors.length) { for (const e of errors) console.error(" -", e); process.exit(1); }

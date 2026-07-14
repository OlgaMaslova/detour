#!/usr/bin/env node
/**
 * Deterministic validator for Detour's verified San Francisco Michelin 2026
 * two- and three-star seed. It uses only the local normalized CSV and writes
 * a stable report with no generated-at timestamp.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_REL = "data/michelin-2026-san-francisco-two-three-starred.csv";
const OUTPUT_REL = "docs/michelin-2026-san-francisco-starred-validation-report.md";
const INPUT = join(ROOT, INPUT_REL);
const OUTPUT = join(ROOT, OUTPUT_REL);

const HEADER = [
  "restaurant_name", "source_restaurant_name", "michelin_distinction", "michelin_stars", "guide_year",
  "locality", "country", "street_address", "latitude", "longitude", "source_url", "source_type",
  "source_published_or_updated_at", "source_accessed_at", "venue_official_url", "location_source_url",
  "location_verification_status", "coord_source", "coord_validation_status", "verification_status", "note",
];
const EDITION_URL = "https://guide.michelin.com/us/en/article/michelin-guide-ceremony/guide-michelin-california";
const EDITION_PUBLISHED = "2026-06-24";
const ACCESS_DATE = "2026-07-14";
const APPROVED = {
  "three-stars": ["Quince", "Californios", "Benu", "Atelier Crenn"],
  "two-stars": ["Acquerello", "Kiln", "Lazy Bear", "Sons & Daughters", "Saison", "Birdsong"],
};
const EXCLUSIONS = [
  "Sun Moon Studio (Oakland, CA)",
  "Commis (Oakland, CA)",
  "Madcap (San Anselmo, CA)",
  "Wakuriya (San Mateo, CA)",
];
const ALLOWED_COORD_STATUSES = new Set(["osm_verified", "osm_address_verified", "osm_approximate"]);
const DISTINCTION_STARS = { "three-stars": "3", "two-stars": "2" };

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
  return rows.filter((row) => row.length > 1 || row[0] !== "");
}

const normalizeName = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const raw = parseCsv(readFileSync(INPUT, "utf8"));
const header = raw[0] ?? [];
const errors = [];
if (header.join(",") !== HEADER.join(",")) {
  errors.push(`Header mismatch. Expected: ${HEADER.join(",")} — got: ${header.join(",")}`);
}
const records = raw.slice(1).map((row) => Object.fromEntries(header.map((name, i) => [name, (row[i] ?? "").trim()])));
const approvedNames = new Set(Object.values(APPROVED).flat());
const names = new Set();
const assertions = new Set();
const sources = new Set();
const counts = { "three-stars": 0, "two-stars": 0 };
const coordCounts = { osm_verified: 0, osm_address_verified: 0, osm_approximate: 0 };

for (const [index, record] of records.entries()) {
  const label = `row ${index + 2} (${record.restaurant_name || "?"})`;
  for (const field of HEADER) {
    if (field !== "source_published_or_updated_at" && !record[field]) {
      errors.push(`${label}: missing required field ${field}`);
    }
  }
  if (record.restaurant_name !== record.source_restaurant_name) {
    errors.push(`${label}: restaurant_name must preserve the verified source spelling`);
  }
  if (!Object.hasOwn(DISTINCTION_STARS, record.michelin_distinction)) {
    errors.push(`${label}: michelin_distinction must be two-stars or three-stars`);
  } else {
    counts[record.michelin_distinction]++;
    if (record.michelin_stars !== DISTINCTION_STARS[record.michelin_distinction]) {
      errors.push(`${label}: michelin_stars does not match the distinction`);
    }
  }
  if (!approvedNames.has(record.restaurant_name)) errors.push(`${label}: not in the approved cohort`);
  if (record.guide_year !== "2026") errors.push(`${label}: guide_year must be 2026`);
  if (record.locality !== "San Francisco" || record.country !== "United States") {
    errors.push(`${label}: locality/country must be San Francisco, United States`);
  }
  if (record.source_type !== "official-restaurant-record") {
    errors.push(`${label}: source_type must be official-restaurant-record`);
  }
  if (record.source_published_or_updated_at !== "") {
    errors.push(`${label}: individual record publication date must remain blank`);
  }
  if (record.source_accessed_at !== ACCESS_DATE) errors.push(`${label}: access date must be ${ACCESS_DATE}`);
  if (record.verification_status !== "verified" || record.location_verification_status !== "verified") {
    errors.push(`${label}: award and location verification statuses must be verified`);
  }
  const source = httpsUrl(record.source_url);
  if (!source || source.hostname !== "guide.michelin.com" || !source.pathname.includes("/restaurant/")) {
    errors.push(`${label}: source_url must be an individual HTTPS guide.michelin.com restaurant record`);
  } else sources.add(record.source_url);
  const official = httpsUrl(record.venue_official_url);
  if (!official || official.hostname === "guide.michelin.com") {
    errors.push(`${label}: venue_official_url must be an HTTPS first-party operator URL`);
  }
  const location = httpsUrl(record.location_source_url);
  if (!location) errors.push(`${label}: location_source_url must be HTTPS first-party evidence`);
  const lat = Number(record.latitude), lng = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 37.70 || lat > 37.83 || lng < -122.53 || lng > -122.34) {
    errors.push(`${label}: coordinates must be within San Francisco bounds`);
  }
  if (record.coord_source !== "openstreetmap-nominatim") {
    errors.push(`${label}: coord_source must be openstreetmap-nominatim`);
  }
  if (!ALLOWED_COORD_STATUSES.has(record.coord_validation_status)) {
    errors.push(`${label}: coord_validation_status must be an allowed map-ready OSM qualifier`);
  } else coordCounts[record.coord_validation_status]++;
  const normalized = normalizeName(record.restaurant_name);
  if (names.has(normalized)) errors.push(`${label}: duplicate normalized canonical name`);
  names.add(normalized);
  const assertion = `${normalizeName(record.source_restaurant_name)}|${record.guide_year}|${record.michelin_distinction}`;
  if (assertions.has(assertion)) errors.push(`${label}: duplicate source-side assertion`);
  assertions.add(assertion);
}

if (records.length !== 10) errors.push(`Record count ${records.length} != expected 10`);
if (counts["three-stars"] !== 4) errors.push(`Three-star count ${counts["three-stars"]} != expected 4`);
if (counts["two-stars"] !== 6) errors.push(`Two-star count ${counts["two-stars"]} != expected 6`);
if (sources.size !== 10) errors.push(`Individual official-record URL count ${sources.size} != expected 10`);
for (const name of approvedNames) if (!names.has(normalizeName(name))) errors.push(`Approved venue missing: ${name}`);

const status = errors.length ? "FAIL" : "PASS";
const lines = [
  "# Validation report — 2026 MICHELIN Guide San Francisco two- and three-star seed",
  "",
  `**Status: ${status}** — generated deterministically by \`npm run validate:michelin-san-francisco\` from \`${INPUT_REL}\`.`,
  "",
  "## Verified coverage",
  "",
  "This is a selective, attributable launch cohort. It is not a complete San Francisco MICHELIN selection or a judgement about omitted restaurants.",
  "",
  `- Source entries: ${records.length}`,
  `- Canonical venues: ${records.length}`,
  `- Awards: ${records.length}`,
  `- Three-star entries: ${counts["three-stars"]}`,
  `- Two-star entries: ${counts["two-stars"]}`,
  `- Official source records: ${sources.size + 1} (10 individual restaurant records plus the California 2026 edition announcement)`,
  `- Locations independently verified: ${records.length}`,
  `- Coordinate-qualified map pins: ${records.length}`,
  "- Excluded nearby-city entries: 4",
  "- Unresolved locations: 0",
  "",
  "## Provenance and location limits",
  "",
  `- The governing edition record is [Every MICHELIN-Starred Restaurant in California for 2026](${EDITION_URL}), published ${EDITION_PUBLISHED}.`,
  "- Every dataset row links to one individual official MICHELIN restaurant record, rather than the mutable city listing.",
  "- Award provenance is separate from location corroboration. Coordinates come from OpenStreetMap/Nominatim and are labelled as named-place or address-level evidence; they are not attributed to MICHELIN.",
  "- Address-level geometry is not presented as a named restaurant match where OpenStreetMap carries another name or no restaurant identity.",
  "",
  "## Coordinate qualification",
  "",
  `- osm_verified (named restaurant and address): ${coordCounts.osm_verified}`,
  `- osm_address_verified (address/building or street geometry, not necessarily a named restaurant): ${coordCounts.osm_address_verified}`,
  `- osm_approximate: ${coordCounts.osm_approximate}`,
  "",
  "## Nearby-city exclusions",
  "",
  "These appeared on the mutable San Francisco-and-surroundings discovery surface but are outside the City and County of San Francisco cohort:",
  "",
  ...EXCLUSIONS.map((entry) => `- ${entry}`),
  "",
  "## Validation errors",
  "",
  ...(errors.length ? errors.map((error) => `- ${error}`) : ["None."]),
  "",
  "## Approved roster",
  "",
  "### Three Stars (4)",
  "",
  ...APPROVED["three-stars"].map((name) => `- ${name}`),
  "",
  "### Two Stars (6)",
  "",
  ...APPROVED["two-stars"].map((name) => `- ${name}`),
  "",
];

writeFileSync(OUTPUT, lines.join("\n"));
console.log(`${status}: ${records.length} source entries; 3-star ${counts["three-stars"]}, 2-star ${counts["two-stars"]}; official records ${sources.size + 1}; map-ready ${records.length}; unresolved 0. Report: ${OUTPUT_REL}`);
if (errors.length) {
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

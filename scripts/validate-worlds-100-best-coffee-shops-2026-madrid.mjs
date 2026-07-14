#!/usr/bin/env node
/**
 * Deterministic validator for the 2026 "The World's 100 Best Coffee Shops"
 * Madrid source dataset (standalone; NOT integrated into the unified venues).
 *
 * Inputs:
 *   data/worlds-100-best-coffee-shops-2026-madrid.csv
 *   data/madrid-2026-unified-venues.json (read-only, for exact-name dedupe check)
 * Outputs (overwritten, deterministic — no generated-at timestamps):
 *   data/worlds-100-best-coffee-shops-2026-madrid-dedupe.json
 *   docs/worlds-100-best-coffee-shops-2026-madrid-validation-report.md
 *
 * Policy: docs/2026-07-14-madrid-pizza-coffee-source-policy.md (facts as of 2026-07-14).
 * Validates exact expected scope (exactly 1 qualifying global candidate:
 * Hola Coffee Lagasca, global rank 19), complete source provenance with
 * official HTTPS theworlds100bestcoffeeshops.com URLs, Madrid/Spain locality,
 * current 2026 edition, official-record address, independent OSM location
 * evidence (node id, coordinates within Madrid-city bounds, source, status),
 * ISO access date, verified review status, no normalized duplicates, and
 * that the non-governing Europe-subset display name "Hola Coffee Roastery"
 * (#8) does NOT appear as a source row.
 *
 * Dedupe: exact normalized full-name matching only against canonical unified
 * venue names — NFC, trim, collapse whitespace, lower case. No diacritic
 * folding, no fuzzy/prefix matching, no merges.
 *
 * Dependency-free Node.js ES module.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_REL = "data/worlds-100-best-coffee-shops-2026-madrid.csv";
const UNIFIED_REL = "data/madrid-2026-unified-venues.json";
const DEDUPE_REL = "data/worlds-100-best-coffee-shops-2026-madrid-dedupe.json";
const REPORT_REL = "docs/worlds-100-best-coffee-shops-2026-madrid-validation-report.md";
const POLICY_REL = "docs/2026-07-14-madrid-pizza-coffee-source-policy.md";

const HEADER = [
  "source_slug", "source_name", "list_name", "edition_year", "edition_status",
  "global_rank", "source_venue_name", "locality", "country",
  "ranking_url", "record_url", "capture_method", "source_accessed_at",
  "review_status", "source_verification_note",
  "record_street_address", "record_address_source",
  "osm_node_id", "latitude", "longitude",
  "location_source", "location_validation_status", "location_verification_note",
];

const EXPECTED = {
  total: 1,
  source_slug: "w100-best-coffee-shops",
  source_name: "The World's 100 Best Coffee Shops",
  list_name: "The World's 100 Best Coffee Shops 2026",
  edition_year: "2026",
  edition_status: "current",
  global_rank: "19",
  source_venue_name: "Hola Coffee Lagasca",
  locality: "Madrid",
  country: "Spain",
  ranking_url: "https://theworlds100bestcoffeeshops.com/top-100-coffee-shops/",
  record_url: "https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/",
  capture_method: "manual",
  source_accessed_at: "2026-07-14",
  review_status: "verified",
  record_street_address: "Calle Lagasca, 42, 28001, Madrid, Spain",
  record_address_source: "official-venue-record",
  osm_node_id: "12147737601",
  location_source: "openstreetmap-nominatim",
  location_validation_status: "osm_verified",
};

// Non-governing related regional display name (Europe subset #8) — must NOT
// appear as a source row; the global list and official record govern.
const EXCLUDED_DISPLAY_NAME = "Hola Coffee Roastery";

// Madrid-city bounding box (same generous city-scoped box as the Michelin validator).
const LAT_MIN = 40.30, LAT_MAX = 40.56, LNG_MIN = -3.85, LNG_MAX = -3.52;

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

// Exact normalized match key: NFC, trim, collapse whitespace, lower case.
// Deliberately NO diacritic folding and NO fuzzy/prefix matching.
const normalizeExact = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const errors = [];
const rowsRaw = parseCsv(readFileSync(join(REPO_ROOT, INPUT_REL), "utf8"));
const header = rowsRaw[0] ?? [];
if (header.join(",") !== HEADER.join(",")) {
  errors.push(`Header mismatch. Expected: ${HEADER.join(",")} — got: ${header.join(",")}`);
}
const records = rowsRaw.slice(1).map((r) =>
  Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))
);

if (records.length !== EXPECTED.total)
  errors.push(`Total records ${records.length} != expected ${EXPECTED.total} (exactly one qualifying Madrid candidate in the 2026 global top-100)`);

const seen = new Map();
for (const [i, rec] of records.entries()) {
  const label = `row ${i + 2} (${rec.source_venue_name || "?"})`;

  for (const f of HEADER) {
    if (!rec[f]) errors.push(`${label}: missing required field "${f}"`);
  }

  // Exact provenance / scope fields.
  for (const f of [
    "source_slug", "source_name", "list_name", "edition_year", "edition_status",
    "global_rank", "source_venue_name", "locality", "country",
    "ranking_url", "record_url", "capture_method", "source_accessed_at",
    "review_status", "record_street_address", "record_address_source",
    "osm_node_id", "location_source", "location_validation_status",
  ]) {
    if (rec[f] !== EXPECTED[f])
      errors.push(`${label}: ${f} "${rec[f]}" != expected "${EXPECTED[f]}"`);
  }

  // Official URL host/path checks (HTTPS, official domain).
  for (const [f, path] of [["ranking_url", "/top-100-coffee-shops/"], ["record_url", "/locales/hola-coffee-lagasca/"]]) {
    try {
      const u = new URL(rec[f]);
      if (u.protocol !== "https:" || u.hostname !== "theworlds100bestcoffeeshops.com" || u.pathname !== path)
        errors.push(`${label}: ${f} is not the official HTTPS theworlds100bestcoffeeshops.com URL at path ${path}`);
    } catch { errors.push(`${label}: ${f} is not a valid URL`); }
  }

  // ISO access date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.source_accessed_at))
    errors.push(`${label}: source_accessed_at is not an ISO YYYY-MM-DD date`);

  // Global rank must be an integer in 1..100.
  const rank = Number(rec.global_rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 100)
    errors.push(`${label}: global_rank "${rec.global_rank}" is not an integer in 1..100`);

  // OSM node id and coordinate bounds.
  if (!/^\d+$/.test(rec.osm_node_id))
    errors.push(`${label}: osm_node_id "${rec.osm_node_id}" is not a numeric OSM node id`);
  const lat = Number(rec.latitude), lng = Number(rec.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX)
    errors.push(`${label}: coordinates (${rec.latitude}, ${rec.longitude}) missing or outside Madrid-city bounds`);

  // Non-governing regional display must never be imported as a source row.
  if (normalizeExact(rec.source_venue_name) === normalizeExact(EXCLUDED_DISPLAY_NAME))
    errors.push(`${label}: non-governing Europe-subset display name "${EXCLUDED_DISPLAY_NAME}" must not appear as a source row`);

  // No normalized duplicates.
  const key = normalizeExact(rec.source_venue_name);
  if (seen.has(key)) errors.push(`${label}: normalized duplicate of ${seen.get(key)}`);
  else seen.set(key, label);
}

// ---- Dedupe check against unified Michelin/Repsol venues (read-only) ----
const unified = JSON.parse(readFileSync(join(REPO_ROOT, UNIFIED_REL), "utf8"));
const venues = Array.isArray(unified.venues) ? unified.venues : [];
const unifiedByKey = new Map();
for (const v of venues) {
  if (v && typeof v.canonical_name === "string")
    unifiedByKey.set(normalizeExact(v.canonical_name), v);
}

const candidate = records[0] ?? null;
const candidateKey = candidate ? normalizeExact(candidate.source_venue_name) : null;
const match = candidateKey !== null ? unifiedByKey.get(candidateKey) ?? null : null;
const matchOutcome = match ? "exact_normalized_match" : "no_match";
if (match)
  errors.push(`Unexpected exact normalized match against unified venue "${match.canonical_name}" (${match.id}); policy expects no existing canonical venue for this candidate`);

const dedupe = {
  dataset: "worlds-100-best-coffee-shops-2026-madrid-dedupe",
  policy: {
    document: POLICY_REL,
    matching: "Exact normalized full-name equality only: NFC, trim, collapse whitespace, lower case. No diacritic folding, no fuzzy/prefix/alias matching, no auto-merge.",
    fuzzy_merge: false,
    notes: "A separately corroborated address may corroborate a match but never creates one. Aliases such as the Europe-subset display name require manual review and are excluded here.",
  },
  candidate: candidate && {
    source_slug: candidate.source_slug,
    source_venue_name: candidate.source_venue_name,
    normalized_match_key: candidateKey,
    global_rank: Number(candidate.global_rank),
    edition_year: Number(candidate.edition_year),
    locality: candidate.locality,
    country: candidate.country,
  },
  checked_target_dataset: {
    file: UNIFIED_REL,
    dataset: unified.dataset ?? null,
    canonical_venues_checked: venues.length,
    sources: ["michelin", "repsol"],
  },
  match_outcome: matchOutcome,
  matched_venue: match ? { id: match.id, canonical_name: match.canonical_name } : null,
  decision: match
    ? "UNEXPECTED MATCH — manual review required; no automatic merge performed."
    : "No existing canonical venue matches; candidate remains a standalone source row (no Detour canonical venue linkage). No merge performed.",
  excluded_non_governing_display: {
    name: EXCLUDED_DISPLAY_NAME,
    context: "The World's 100 Best Coffee Shops — Europe subset, #8",
    reason: "Related, non-governing regional display name; not auto-merged and not imported as a second source row. The global list and official venue record govern.",
  },
};
writeFileSync(join(REPO_ROOT, DEDUPE_REL), JSON.stringify(dedupe, null, 2) + "\n");

// ---- Report ----
const status = errors.length === 0 ? "PASS" : "FAIL";
const lines = [];
lines.push("# Validation report — The World's 100 Best Coffee Shops 2026, Madrid source dataset");
lines.push("");
lines.push(`**Status: ${status}** — generated deterministically by \`npm run validate:coffee-madrid\` from \`${INPUT_REL}\` and \`${UNIFIED_REL}\`. Facts as of access date 2026-07-14 (no other timestamps generated).`);
lines.push("");
lines.push(`Policy: \`${POLICY_REL}\`.`);
lines.push("");
lines.push("## Errors");
lines.push("");
if (errors.length === 0) lines.push("None.");
else for (const e of errors) lines.push(`- ${e}`);
lines.push("");
lines.push("## Source coverage");
lines.push("");
lines.push(`- Records: ${records.length} (expected ${EXPECTED.total}). The current 2026 global top-100 contains exactly one Madrid entry.`);
lines.push(`- Candidate: ${EXPECTED.source_venue_name}, global rank ${EXPECTED.global_rank}, ${EXPECTED.locality}, ${EXPECTED.country} (edition: ${EXPECTED.list_name}, status ${EXPECTED.edition_status}).`);
lines.push(`- Provenance: ${EXPECTED.capture_method} capture on ${EXPECTED.source_accessed_at}; review status ${EXPECTED.review_status}.`);
lines.push(`- Official ranking URL: ${EXPECTED.ranking_url}`);
lines.push(`- Official venue record URL: ${EXPECTED.record_url}`);
lines.push("");
lines.push("## Excluded non-governing related display");
lines.push("");
lines.push(`- "${EXCLUDED_DISPLAY_NAME}" appears at #8 on the official Europe subset page. It is a related, non-governing regional display name: it is not auto-merged with the global record and is validated as absent from the source rows.`);
lines.push("");
lines.push("## Location evidence (kept separate from imported source facts)");
lines.push("");
lines.push(`- Official venue record address: ${EXPECTED.record_street_address} (source: ${EXPECTED.record_address_source}).`);
lines.push(`- Independent corroboration: OpenStreetMap Nominatim named cafe node ${EXPECTED.osm_node_id} with matching address; coordinates within Madrid-city bounds; status ${EXPECTED.location_validation_status}, source ${EXPECTED.location_source}.`);
lines.push("- Coordinates are OSM-sourced (independent of the guide) and never copied from source editorial material.");
lines.push("");
lines.push("## Dedupe decision");
lines.push("");
lines.push(`- Checked against \`${UNIFIED_REL}\` (${venues.length} canonical Michelin/Repsol venues) using exact normalized full-name matching only (NFC, trim, collapse whitespace, lower case; no diacritic folding, no fuzzy/prefix matching).`);
lines.push(`- Outcome: **${matchOutcome}** — ${dedupe.decision}`);
lines.push(`- Machine-readable artifact: \`${DEDUPE_REL}\`. No fuzzy merge is performed under any circumstance.`);
lines.push("");
lines.push("## Rights and provenance constraints");
lines.push("");
lines.push("- Links and facts only: source name, list, edition, rank, venue spelling, city/country, official URLs, access date, compact verification notes.");
lines.push("- No guide prose, images, logos, reviews, or other editorial material is copied; no reuse licence is assumed for any source content.");
lines.push("- Each fact is attributed to its official source URL; corrections/removals on request are recorded in the verification note per the source policy.");
lines.push("- This dataset is standalone: it is NOT integrated into the unified venues dataset and makes no merge decisions.");
lines.push("");

writeFileSync(join(REPO_ROOT, REPORT_REL), lines.join("\n"));
console.log(`${status}: ${records.length} record(s); candidate "${EXPECTED.source_venue_name}" global rank ${EXPECTED.global_rank}; dedupe outcome ${matchOutcome} against ${venues.length} unified venues. Report: ${REPORT_REL}; dedupe artifact: ${DEDUPE_REL}`);
if (errors.length) { for (const e of errors) console.error(" -", e); process.exit(1); }

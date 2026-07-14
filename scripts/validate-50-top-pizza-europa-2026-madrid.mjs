#!/usr/bin/env node
/**
 * Deterministic validator for the "50 Top Pizza Europa 2026" Madrid source
 * dataset (standalone; NOT integrated into the unified venues).
 *
 * Inputs:
 *   data/50-top-pizza-europa-2026-madrid.csv
 *   data/madrid-2026-unified-venues.json (read-only, for exact-name dedupe check)
 * Outputs (overwritten, deterministic — no generated-at timestamps):
 *   data/50-top-pizza-europa-2026-madrid-dedupe.json
 *   docs/50-top-pizza-europa-2026-madrid-validation-report.md
 *
 * Policy: docs/2026-07-14-madrid-pizza-coffee-source-policy.md (facts as of 2026-07-14).
 * Validates the exact expected scope: exactly 2 Madrid records from the
 * official 60-entry 50 Top Pizza Europa 2026 ranking (Baldoria rank 2,
 * Fratelli Figurato rank 11), complete source provenance with the official
 * HTTPS 50toppizza.it ranking URL, official operator venue URLs, Madrid/Spain
 * locality, current 2026 edition, separately verified addresses with
 * independent OSM location evidence (node id, coordinates within Madrid-city
 * bounds, source, status), ISO access date, verified review status, and no
 * normalized duplicate candidate names.
 *
 * Branch caveat (validated as documented in the CSV note): the ranking names
 * only "Fratelli Figurato" / Madrid without a branch; the operator has several
 * Madrid locations. The recorded address is the operator's primary
 * "Pizzeria Fratelli Figurato" (Calle Alonso Cano, 37), a separately
 * corroborated location fact — never a claim that the guide awarded a branch.
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
const INPUT_REL = "data/50-top-pizza-europa-2026-madrid.csv";
const UNIFIED_REL = "data/madrid-2026-unified-venues.json";
const DEDUPE_REL = "data/50-top-pizza-europa-2026-madrid-dedupe.json";
const REPORT_REL = "docs/50-top-pizza-europa-2026-madrid-validation-report.md";
const POLICY_REL = "docs/2026-07-14-madrid-pizza-coffee-source-policy.md";

const HEADER = [
  "source_slug", "source_name", "list_name", "edition_year", "edition_status",
  "list_rank", "source_venue_name", "locality", "country",
  "ranking_url", "official_venue_url", "capture_method", "source_accessed_at",
  "review_status", "source_verification_note",
  "record_street_address", "record_address_source",
  "osm_node_id", "latitude", "longitude",
  "location_source", "location_validation_status", "location_verification_note",
];

const COMMON = {
  source_slug: "50-top-pizza",
  source_name: "50 Top Pizza",
  list_name: "50 Top Pizza Europa 2026",
  edition_year: "2026",
  edition_status: "current",
  locality: "Madrid",
  country: "Spain",
  ranking_url: "https://www.50toppizza.it/50-top-pizza-europa-2026/",
  capture_method: "manual",
  source_accessed_at: "2026-07-14",
  review_status: "verified",
  location_source: "openstreetmap",
  location_validation_status: "osm_verified",
};

const EXPECTED_RECORDS = [
  {
    list_rank: "2",
    source_venue_name: "Baldoria",
    official_venue_url: "https://baldoriamadrid.com/en/",
    official_venue_host: "baldoriamadrid.com",
    record_street_address: "C. de José Ortega y Gasset, 100, 28006 Madrid",
    record_address_source: "official-venue-site",
    osm_node_id: "11916159225",
    latitude: "40.4294985",
    longitude: "-3.6707425",
  },
  {
    list_rank: "11",
    source_venue_name: "Fratelli Figurato",
    official_venue_url: "https://www.fratellifigurato.es/pizzeria-madrid",
    official_venue_host: "www.fratellifigurato.es",
    record_street_address: "Calle Alonso Cano, 37, 28003 Madrid",
    record_address_source: "official-operator-page",
    osm_node_id: "6131891485",
    latitude: "40.4389910",
    longitude: "-3.6978429",
  },
];

// Official operator booking page evidencing multiple Madrid locations
// (branch-ambiguity evidence; must be cited in the Fratelli source note).
const BOOKING_URL = "https://www.fratellifigurato.es/reserva-mesa";

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

if (records.length !== EXPECTED_RECORDS.length)
  errors.push(`Total records ${records.length} != expected ${EXPECTED_RECORDS.length} (exactly the two verified Madrid entries in the official 60-entry Europa 2026 ranking)`);

const seen = new Map();
for (const [i, rec] of records.entries()) {
  const label = `row ${i + 2} (${rec.source_venue_name || "?"})`;
  const exp = EXPECTED_RECORDS[i];

  for (const f of HEADER) {
    if (!rec[f]) errors.push(`${label}: missing required field "${f}"`);
  }

  // Shared provenance/scope fields.
  for (const [f, v] of Object.entries(COMMON)) {
    if (rec[f] !== v) errors.push(`${label}: ${f} "${rec[f]}" != expected "${v}"`);
  }

  // Per-record fields.
  if (exp) {
    for (const f of [
      "list_rank", "source_venue_name", "official_venue_url",
      "record_street_address", "record_address_source",
      "osm_node_id", "latitude", "longitude",
    ]) {
      if (rec[f] !== exp[f])
        errors.push(`${label}: ${f} "${rec[f]}" != expected "${exp[f]}"`);
    }
  }

  // Official ranking URL: HTTPS on the official 50toppizza.it host and edition path.
  try {
    const u = new URL(rec.ranking_url);
    if (u.protocol !== "https:" || u.hostname !== "www.50toppizza.it" || u.pathname !== "/50-top-pizza-europa-2026/")
      errors.push(`${label}: ranking_url is not the official HTTPS www.50toppizza.it URL at path /50-top-pizza-europa-2026/`);
  } catch { errors.push(`${label}: ranking_url is not a valid URL`); }

  // Official venue URL: HTTPS on the expected official operator host.
  try {
    const u = new URL(rec.official_venue_url);
    if (u.protocol !== "https:" || (exp && u.hostname !== exp.official_venue_host))
      errors.push(`${label}: official_venue_url is not an HTTPS URL on the expected official host ${exp?.official_venue_host}`);
  } catch { errors.push(`${label}: official_venue_url is not a valid URL`); }

  // ISO access date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.source_accessed_at))
    errors.push(`${label}: source_accessed_at is not an ISO YYYY-MM-DD date`);

  // List rank must be an integer in 1..60 (official Europa 2026 ranking has 60 entries).
  const rank = Number(rec.list_rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 60)
    errors.push(`${label}: list_rank "${rec.list_rank}" is not an integer in 1..60`);

  // OSM node id and coordinate bounds (independent location evidence,
  // kept separate from imported source facts).
  if (!/^\d+$/.test(rec.osm_node_id))
    errors.push(`${label}: osm_node_id "${rec.osm_node_id}" is not a numeric OSM node id`);
  const lat = Number(rec.latitude), lng = Number(rec.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX)
    errors.push(`${label}: coordinates (${rec.latitude}, ${rec.longitude}) missing or outside Madrid-city bounds`);

  // Branch-ambiguity documentation: the Fratelli Figurato row must cite the
  // official booking page and state the branch caveat in its notes.
  if (rec.source_venue_name === "Fratelli Figurato") {
    if (!rec.source_verification_note.includes(BOOKING_URL))
      errors.push(`${label}: source_verification_note must cite the official booking page ${BOOKING_URL} as evidence of multiple Madrid locations`);
    if (!/does NOT identify a specific branch/.test(rec.source_verification_note))
      errors.push(`${label}: source_verification_note must state that the ranking does not identify a specific branch`);
  }

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

const candidates = records.map((rec) => {
  const key = normalizeExact(rec.source_venue_name);
  const match = unifiedByKey.get(key) ?? null;
  if (match)
    errors.push(`Unexpected exact normalized match against unified venue "${match.canonical_name}" (${match.id}); policy expects no existing canonical venue for these candidates`);
  return {
    source_slug: rec.source_slug,
    source_venue_name: rec.source_venue_name,
    normalized_match_key: key,
    list_rank: Number(rec.list_rank),
    edition_year: Number(rec.edition_year),
    locality: rec.locality,
    country: rec.country,
    match_outcome: match ? "exact_normalized_match" : "no_match",
    matched_venue: match ? { id: match.id, canonical_name: match.canonical_name } : null,
    decision: match
      ? "UNEXPECTED MATCH — manual review required; no automatic merge performed."
      : "No existing canonical venue matches; candidate remains a standalone source row (no canonical venue linkage). No merge performed.",
  };
});

const dedupe = {
  dataset: "50-top-pizza-europa-2026-madrid-dedupe",
  policy: {
    document: POLICY_REL,
    matching: "Exact normalized full-name equality only: NFC, trim, collapse whitespace, lower case. No diacritic folding, no fuzzy/prefix/alias matching, no auto-merge.",
    fuzzy_merge: false,
    notes: "A separately corroborated address may corroborate a match but never creates one. Branch/address attribution for Fratelli Figurato is a separate corroborated location fact, not a guide claim.",
  },
  candidates,
  checked_target_dataset: {
    file: UNIFIED_REL,
    dataset: unified.dataset ?? null,
    canonical_venues_checked: venues.length,
    sources: ["michelin", "repsol"],
  },
  rejected_candidates: [
    {
      scope: "50 Top Pizza Europa 2026 (official 60-entry ranking)",
      reason: "No other Madrid entry appears in the official 60-entry Europa 2026 ranking; only Baldoria (rank 2) and Fratelli Figurato (rank 11) qualify.",
    },
    {
      scope: "50 Top Pizza World 2025",
      reason: "Historic edition; excluded per source policy (current-edition-only import).",
    },
    {
      scope: "50 Top Pizza World 2026",
      reason: "Future/unpublished-at-access edition relative to the 2026-07-14 access date; excluded per source policy.",
    },
  ],
  branch_ambiguity: {
    venue: "Fratelli Figurato",
    ranking_identifies: "Only 'Fratelli Figurato' / Madrid — no specific branch is named by the guide.",
    resolution: "Operator's primary 'Pizzeria Fratelli Figurato' (Calle Alonso Cano, 37, 28003 Madrid) per official operator page https://www.fratellifigurato.es/pizzeria-madrid, corroborated by OSM node 6131891485.",
    evidence_multiple_locations: BOOKING_URL,
    caveat: "The recorded address is a separately corroborated named Pizzeria venue, NOT a claim that the guide awarded a particular branch.",
  },
};
writeFileSync(join(REPO_ROOT, DEDUPE_REL), JSON.stringify(dedupe, null, 2) + "\n");

// ---- Report ----
const status = errors.length === 0 ? "PASS" : "FAIL";
const lines = [];
lines.push("# Validation report — 50 Top Pizza Europa 2026, Madrid source dataset");
lines.push("");
lines.push(`**Status: ${status}** — generated deterministically by \`npm run validate:pizza-madrid\` from \`${INPUT_REL}\` and \`${UNIFIED_REL}\`. Facts as of access date 2026-07-14 (no other timestamps generated).`);
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
lines.push(`- Records: ${records.length} (expected ${EXPECTED_RECORDS.length}). The official 60-entry 50 Top Pizza Europa 2026 ranking contains exactly two Madrid entries.`);
lines.push("- Candidates: Baldoria (rank 2) and Fratelli Figurato (rank 11), Madrid, Spain (edition: 50 Top Pizza Europa 2026, status current).");
lines.push(`- Provenance: ${COMMON.capture_method} capture on ${COMMON.source_accessed_at}; review status ${COMMON.review_status}.`);
lines.push(`- Official ranking URL: ${COMMON.ranking_url}`);
lines.push(`- Official venue URLs: ${EXPECTED_RECORDS.map((r) => r.official_venue_url).join(" ; ")}`);
lines.push("");
lines.push("## Explicitly rejected candidates");
lines.push("");
for (const r of dedupe.rejected_candidates) lines.push(`- ${r.scope}: ${r.reason}`);
lines.push("");
lines.push("## Branch/address caveat (Fratelli Figurato)");
lines.push("");
lines.push("- The 50 Top Pizza ranking names only \"Fratelli Figurato\" with city Madrid and does not identify a specific branch; the operator runs multiple Madrid locations (evidence: official booking page " + BOOKING_URL + ").");
lines.push("- For deterministic location, the primary \"Pizzeria Fratelli Figurato\" at Calle Alonso Cano, 37, 28003 Madrid is used, identified via the official operator page https://www.fratellifigurato.es/pizzeria-madrid and corroborated by OSM node 6131891485.");
lines.push("- This is a separately corroborated named Pizzeria venue — never an invented claim that the guide awarded a particular branch.");
lines.push("");
lines.push("## Location evidence (kept separate from imported source facts)");
lines.push("");
for (const r of EXPECTED_RECORDS) {
  lines.push(`- ${r.source_venue_name}: official address "${r.record_street_address}" (source: ${r.record_address_source}); OSM node ${r.osm_node_id} at (${r.latitude}, ${r.longitude}) within Madrid-city bounds; status ${COMMON.location_validation_status}, source ${COMMON.location_source}.`);
}
lines.push("- Coordinates are OSM-sourced (independent of the guide) and never copied from source editorial material.");
lines.push("");
lines.push("## Dedupe decision");
lines.push("");
lines.push(`- Checked against \`${UNIFIED_REL}\` (${venues.length} canonical Michelin/Repsol venues) using exact normalized full-name matching only (NFC, trim, collapse whitespace, lower case; no diacritic folding, no fuzzy/prefix matching).`);
for (const c of candidates) lines.push(`- ${c.source_venue_name}: **${c.match_outcome}** — ${c.decision}`);
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
console.log(`${status}: ${records.length} record(s); candidates ${records.map((r) => `"${r.source_venue_name}" rank ${r.list_rank}`).join(", ")}; dedupe outcomes ${candidates.map((c) => c.match_outcome).join(", ")} against ${venues.length} unified venues. Report: ${REPORT_REL}; dedupe artifact: ${DEDUPE_REL}`);
if (errors.length) { for (const e of errors) console.error(" -", e); process.exit(1); }

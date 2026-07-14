#!/usr/bin/env node
/**
 * Deterministic validator for Detour's conservative Paris Michelin 2026 seed.
 *
 * Input:  data/michelin-2026-paris-two-three-starred.csv
 * Output: docs/michelin-2026-paris-two-three-starred-coverage-report.md
 *
 * This validates minimal, attributed factual assertions only. It deliberately
 * rejects unsupported venue enrichment: no official venue URL, address, or
 * coordinates are included in this award import.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_REL = "data/michelin-2026-paris-two-three-starred.csv";
const OUTPUT_REL = "docs/michelin-2026-paris-two-three-starred-coverage-report.md";
const INPUT = join(ROOT, INPUT_REL);
const OUTPUT = join(ROOT, OUTPUT_REL);

const HEADER = [
  "source_venue_name", "canonical_venue_name", "city", "country", "distinction", "guide_year",
  "source_url", "source_record_key", "source_type", "edition_announcement_url",
  "edition_announcement_published_or_updated_at", "source_accessed_at", "source_published_or_updated_at",
  "verification_status", "verification_note", "venue_official_url", "venue_official_url_source",
  "street_address", "address_source_url", "lat", "lng", "coordinate_source", "coordinate_validation_status",
];

const CATEGORY_URLS = {
  "3 Stars": "https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/3-stars-michelin",
  "2 Stars": "https://guide.michelin.com/us/en/ile-de-france/paris/restaurants/2-stars-michelin",
};
const CATEGORY_KEYS = {
  "3 Stars": "michelin-2026-paris-3-stars-category",
  "2 Stars": "michelin-2026-paris-2-stars-category",
};
const EDITION_URL = "https://guide.michelin.com/kr/en/article/news-and-views/michelin-star-restaurants-france-full-list";
const APPROVED = {
  "3 Stars": [
    "Le Gabriel - La Réserve Paris", "Épicure", "Kei", "Plénitude - Cheval Blanc Paris", "Le Cinq",
    "Pierre Gagnaire", "Arpège", "Alléno Paris au Pavillon Ledoyen", "Le Pré Catelan",
  ],
  "2 Stars": [
    "La Scène", "L'Oiseau Blanc", "Le Grand Restaurant - Jean-François Piège", "Restaurant Le Meurice Alain Ducasse",
    "Maison Rostang", "Le Taillevent", "Alliance", "Marsan par Hélène Darroze", "Le Clarence", "David Toutain",
    "Blanc", "Hakuba", "L'Abysse Paris", "L'Orangerie", "Guy Savoy", "Table - Bruno Verjus", "L'Ambroisie",
    "Le Jules Verne", "Virtus", "Sushi Yoshinaga",
  ],
};

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

const validMichelinUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "guide.michelin.com";
  } catch {
    return false;
  }
};

const raw = parseCsv(readFileSync(INPUT, "utf8"));
const header = raw[0] ?? [];
const errors = [];
if (header.join(",") !== HEADER.join(",")) errors.push(`Header mismatch. Expected: ${HEADER.join(",")} — got: ${header.join(",")}`);
const records = raw.slice(1).map((row) => Object.fromEntries(header.map((name, i) => [name, (row[i] ?? "").trim()])));
const expectedNames = new Set(Object.values(APPROVED).flat());
const seen = new Set();
const count = { "3 Stars": 0, "2 Stars": 0 };

for (const [index, record] of records.entries()) {
  const label = `row ${index + 2} (${record.source_venue_name || "?"})`;
  for (const key of ["source_venue_name", "canonical_venue_name", "city", "country", "distinction", "guide_year", "source_url", "source_record_key", "source_type", "edition_announcement_url", "edition_announcement_published_or_updated_at", "source_accessed_at", "verification_status", "verification_note", "coordinate_validation_status"]) {
    if (!record[key]) errors.push(`${label}: missing required field ${key}`);
  }
  if (!Object.hasOwn(CATEGORY_URLS, record.distinction)) errors.push(`${label}: distinction must be 3 Stars or 2 Stars`);
  else {
    count[record.distinction]++;
    if (record.source_url !== CATEGORY_URLS[record.distinction]) errors.push(`${label}: source URL does not match distinction`);
    if (record.source_record_key !== CATEGORY_KEYS[record.distinction]) errors.push(`${label}: source record key does not match distinction`);
  }
  if (!validMichelinUrl(record.source_url)) errors.push(`${label}: source_url must be first-party HTTPS guide.michelin.com`);
  if (record.city !== "Paris" || record.country !== "France") errors.push(`${label}: must be Paris, France`);
  if (record.guide_year !== "2026") errors.push(`${label}: guide_year must be 2026`);
  if (record.source_type !== "official-category-listing") errors.push(`${label}: source_type must be official-category-listing`);
  if (record.edition_announcement_url !== EDITION_URL || !validMichelinUrl(record.edition_announcement_url)) errors.push(`${label}: edition announcement URL must be the official France 2026 announcement`);
  if (record.edition_announcement_published_or_updated_at !== "2026-03-17") errors.push(`${label}: edition announcement date must be 2026-03-17`);
  if (record.source_accessed_at !== "2026-07-14") errors.push(`${label}: source access date must be 2026-07-14`);
  if (record.source_published_or_updated_at !== "") errors.push(`${label}: category listing publication date must remain blank`);
  if (record.verification_status !== "verified") errors.push(`${label}: verification status must be verified`);
  if (record.source_venue_name !== record.canonical_venue_name) errors.push(`${label}: canonical name must preserve the approved source spelling`);
  if (!expectedNames.has(record.source_venue_name)) errors.push(`${label}: not in the approved cohort`);
  if (record.source_venue_name === "Le Corot") errors.push(`${label}: Le Corot is explicitly excluded`);
  if (seen.has(record.source_venue_name)) errors.push(`${label}: duplicate source venue name`);
  seen.add(record.source_venue_name);
  for (const key of ["venue_official_url", "venue_official_url_source", "street_address", "address_source_url", "lat", "lng", "coordinate_source"]) {
    if (record[key] !== "") errors.push(`${label}: unsupported ${key} must be blank`);
  }
  if (record.coordinate_validation_status !== "not_provided") errors.push(`${label}: coordinate validation status must be not_provided`);
}

if (records.length !== 29) errors.push(`Record count ${records.length} != expected 29`);
if (count["3 Stars"] !== 9) errors.push(`3-star count ${count["3 Stars"]} != expected 9`);
if (count["2 Stars"] !== 20) errors.push(`2-star count ${count["2 Stars"]} != expected 20`);
for (const name of expectedNames) if (!seen.has(name)) errors.push(`Approved venue missing: ${name}`);

const status = errors.length ? "FAIL" : "PASS";
const lines = [
  "# Coverage report — 2026 MICHELIN Guide Paris two- and three-star seed",
  "",
  `**Status: ${status}** — generated deterministically by \`npm run validate:michelin-paris\` from \`${INPUT_REL}\`.`,
  "",
  "## Verified coverage",
  "",
  "**29 verified MICHELIN 2026 two- and three-star source entries in the City of Paris.**",
  "",
  "This is a bounded, attributed selection, not the complete Paris MICHELIN selection or a claim about other star categories.",
  "",
  "- Source entries: 29",
  "- Canonical venues before dedupe: 29",
  "- Awards: 29",
  "- 3-star entries: 9",
  "- 2-star entries: 20",
  "- Official source records: 3 (two category pages plus the France 2026 edition announcement)",
  "- Locations with verified coordinates: 0",
  "- Unresolved locations: 29",
  "",
  "## Provenance and limits",
  "",
  "- Each award/source entry links to its exact official MICHELIN Paris category page and records the 2026-07-14 access date.",
  "- The official France 2026 announcement, published 2026-03-17, corroborates the guide year for the cohort.",
  "- The category pages establish only minimal factual source assertions: venue name, Paris locality, and two- or three-star distinction.",
  "- Venue-owned URLs, street addresses, and coordinates are deliberately blank. No map pin is asserted from the award evidence.",
  "- Le Corot is excluded because its category-page locality is Ville-d'Avray, not Paris.",
  "",
  "## Validation errors",
  "",
  ...(errors.length ? errors.map((error) => `- ${error}`) : ["None."]),
  "",
  "## Approved roster",
  "",
  "### 3 Stars (9)",
  "",
  ...APPROVED["3 Stars"].map((name) => `- ${name}`),
  "",
  "### 2 Stars (20)",
  "",
  ...APPROVED["2 Stars"].map((name) => `- ${name}`),
  "",
];
writeFileSync(OUTPUT, lines.join("\n"));
console.log(`${status}: ${records.length} records; 3 Stars ${count["3 Stars"]}, 2 Stars ${count["2 Stars"]}; source entries 29, canonical venues 29, awards 29, verified coordinates 0, unresolved locations 29. Report: ${OUTPUT_REL}`);
if (errors.length) {
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

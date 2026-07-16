#!/usr/bin/env node
/**
 * Deterministic integrity check for the reviewed 31-row location-backfill
 * research artifact. This validates the bounded catalogue-standard evidence
 * set without making claims about live runtime data outside this cohort.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_REL = "data/verified-location-backfill-2026-07-16.csv";
const INPUT = join(ROOT, INPUT_REL);
const HEADER = [
  "venue_id", "canonical_name", "city", "country", "verified_street_address",
  "venue_official_url", "address_source_url", "latitude", "longitude",
  "coordinate_source", "coordinate_validation_status", "audit_note", "source_access_date",
];
const ALLOWED_STATUSES = new Set(["osm_verified", "osm_address_verified"]);
const CITY_RULES = {
  Paris: { country: "France", latMin: 48.80, latMax: 48.92, lngMin: 2.20, lngMax: 2.45 },
  Madrid: { country: "Spain", latMin: 40.30, latMax: 40.56, lngMin: -3.85, lngMax: -3.52 },
};
const EXPECTED = new Map([
  ["venueparis00001", ["Le Gabriel - La Réserve Paris", "Paris"]],
  ["venueparis00002", ["Épicure", "Paris"]],
  ["venueparis00003", ["Kei", "Paris"]],
  ["venueparis00004", ["Plénitude - Cheval Blanc Paris", "Paris"]],
  ["venueparis00005", ["Le Cinq", "Paris"]],
  ["venueparis00006", ["Pierre Gagnaire", "Paris"]],
  ["venueparis00007", ["Arpège", "Paris"]],
  ["venueparis00008", ["Alléno Paris au Pavillon Ledoyen", "Paris"]],
  ["venueparis00009", ["Le Pré Catelan", "Paris"]],
  ["venueparis00010", ["La Scène", "Paris"]],
  ["venueparis00011", ["L'Oiseau Blanc", "Paris"]],
  ["venueparis00012", ["Le Grand Restaurant - Jean-François Piège", "Paris"]],
  ["venueparis00013", ["Restaurant Le Meurice Alain Ducasse", "Paris"]],
  ["venueparis00014", ["Maison Rostang", "Paris"]],
  ["venueparis00015", ["Le Taillevent", "Paris"]],
  ["venueparis00016", ["Alliance", "Paris"]],
  ["venueparis00017", ["Marsan par Hélène Darroze", "Paris"]],
  ["venueparis00018", ["Le Clarence", "Paris"]],
  ["venueparis00019", ["David Toutain", "Paris"]],
  ["venueparis00020", ["Blanc", "Paris"]],
  ["venueparis00021", ["Hakuba", "Paris"]],
  ["venueparis00022", ["L'Abysse Paris", "Paris"]],
  ["venueparis00023", ["L'Orangerie", "Paris"]],
  ["venueparis00024", ["Guy Savoy", "Paris"]],
  ["venueparis00025", ["Table - Bruno Verjus", "Paris"]],
  ["venueparis00026", ["L'Ambroisie", "Paris"]],
  ["venueparis00027", ["Le Jules Verne", "Paris"]],
  ["venueparis00028", ["Virtus", "Paris"]],
  ["venueparis00029", ["Sushi Yoshinaga", "Paris"]],
  ["venuemich000006", ["OSA", "Madrid"]],
  ["venuemich000008", ["Pabú", "Madrid"]],
]);

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
if (header.join(",") !== HEADER.join(",")) errors.push(`Header mismatch. Expected: ${HEADER.join(",")} — got: ${header.join(",")}`);
const records = raw.slice(1).map((row) => Object.fromEntries(header.map((name, i) => [name, (row[i] ?? "").trim()])));
const seen = new Set();
const cityCounts = { Paris: 0, Madrid: 0 };
const statusCounts = { osm_verified: 0, osm_address_verified: 0 };

for (const [index, record] of records.entries()) {
  const label = `row ${index + 2} (${record.venue_id || "?"})`;
  for (const field of HEADER) if (!record[field]) errors.push(`${label}: missing required field ${field}`);

  const expected = EXPECTED.get(record.venue_id);
  if (!expected) errors.push(`${label}: unexpected venue id`);
  else {
    if (record.canonical_name !== expected[0]) errors.push(`${label}: canonical name does not match the reviewed id`);
    if (record.city !== expected[1]) errors.push(`${label}: city does not match the reviewed id`);
  }
  if (seen.has(record.venue_id)) errors.push(`${label}: duplicate venue id`);
  seen.add(record.venue_id);

  const cityRule = CITY_RULES[record.city];
  if (!cityRule) errors.push(`${label}: city must be Paris or Madrid`);
  else {
    cityCounts[record.city]++;
    if (record.country !== cityRule.country) errors.push(`${label}: country does not match city`);
    const lat = Number(record.latitude);
    const lng = Number(record.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < cityRule.latMin || lat > cityRule.latMax || lng < cityRule.lngMin || lng > cityRule.lngMax) {
      errors.push(`${label}: coordinates are outside the sane ${record.city} bounding box`);
    }
    if (lat === 0 && lng === 0) errors.push(`${label}: 0/0 is forbidden for this verified backfill`);
  }

  if (!record.verified_street_address) errors.push(`${label}: verified street address must be nonempty`);
  if (!httpsUrl(record.venue_official_url)) errors.push(`${label}: venue_official_url must be valid HTTPS evidence`);
  if (!httpsUrl(record.address_source_url)) errors.push(`${label}: address_source_url must be valid HTTPS evidence`);

  const osmUrl = httpsUrl(record.coordinate_source);
  const osmMatch = osmUrl?.hostname === "www.openstreetmap.org" && osmUrl.pathname.match(/^\/(node|way|relation)\/(\d+)$/);
  if (!osmMatch) errors.push(`${label}: coordinate_source must be an HTTPS OpenStreetMap element URL`);
  else if (!record.audit_note.toLowerCase().includes(`${osmMatch[1]} ${osmMatch[2]}`)) {
    errors.push(`${label}: audit_note must preserve the coordinate element type/id relationship`);
  }

  if (!ALLOWED_STATUSES.has(record.coordinate_validation_status)) {
    errors.push(`${label}: coordinate_validation_status must be osm_verified or osm_address_verified`);
  } else statusCounts[record.coordinate_validation_status]++;
  if (record.source_access_date !== "2026-07-16") errors.push(`${label}: source_access_date must be 2026-07-16`);
  if (record.audit_note.length > 300) errors.push(`${label}: audit_note exceeds the 300-character venue note limit`);
}

if (records.length !== 31) errors.push(`Record count ${records.length} != expected 31`);
if (cityCounts.Paris !== 29) errors.push(`Paris count ${cityCounts.Paris} != expected 29`);
if (cityCounts.Madrid !== 2) errors.push(`Madrid count ${cityCounts.Madrid} != expected 2`);
for (const id of EXPECTED.keys()) if (!seen.has(id)) errors.push(`Expected venue id missing: ${id}`);

const status = errors.length ? "FAIL" : "PASS";
console.log(`${status}: ${records.length} reviewed rows; Paris ${cityCounts.Paris}, Madrid ${cityCounts.Madrid}; osm_verified ${statusCounts.osm_verified}, osm_address_verified ${statusCounts.osm_address_verified}; 0/0 locations 0.`);
if (errors.length) {
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

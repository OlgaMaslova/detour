#!/usr/bin/env node
/**
 * Deterministic validator for the Guía Repsol 2026 Madrid new-Sol cohort seed CSV.
 *
 * Input:  data/guia-repsol-2026-madrid-new-sol-cohort.csv
 * Output: docs/guia-repsol-2026-madrid-seed-validation-report.md (overwritten)
 *
 * Dependency-free Node.js ES module. No generated-at timestamp: output depends
 * only on the input CSV, so the report is fully deterministic.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_CSV = join(REPO_ROOT, "data", "guia-repsol-2026-madrid-new-sol-cohort.csv");
const OUTPUT_REPORT = join(REPO_ROOT, "docs", "guia-repsol-2026-madrid-seed-validation-report.md");

const REQUIRED_FIELDS = [
  "venue_name",
  "sol_level",
  "guide_year",
  "locality",
  "source_url",
  "source_type",
  "source_accessed_at",
  "verification_status",
];
// street_address is intentionally optional.

const ALLOWED_SOL_LEVELS = new Set(["1", "2", "3"]);
const REQUIRED_GUIDE_YEAR = "2026";
const REQUIRED_LOCALITY = "Madrid";
const ALLOWED_VERIFICATION_STATUS = new Set(["verified"]);
const OFFICIAL_HOSTS = new Set(["guiarepsol.com", "www.guiarepsol.com"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- RFC-4180-style CSV parsing (handles quoted fields, escaped quotes, newlines in quotes) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function normalizeVenueName(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isOfficialHttpsSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && OFFICIAL_HOSTS.has(url.hostname.toLowerCase());
}

// --- Load and validate ---
const raw = readFileSync(INPUT_CSV, "utf8");
const rows = parseCsv(raw);
if (rows.length === 0) {
  console.error("CSV is empty.");
  process.exit(1);
}
const header = rows[0].map((h) => h.trim());
const records = rows.slice(1).map((cells, idx) => {
  const rec = { __row: idx + 2 }; // 1-based line, after header
  header.forEach((h, i) => {
    rec[h] = (cells[i] ?? "").trim();
  });
  return rec;
});

const missingRequired = []; // { row, venue, fields[] }
const invalidAward = []; // { row, venue, field, value, reason }
const sourceFailures = []; // { row, venue, field, value, reason }
const duplicates = []; // { key, rows[] }

const solCounts = { 1: 0, 2: 0, 3: 0, other: 0 };
const dupeMap = new Map();

for (const rec of records) {
  const venue = rec.venue_name || "(missing venue_name)";
  const missing = REQUIRED_FIELDS.filter((f) => !(rec[f] && rec[f].length > 0));
  if (missing.length > 0) {
    missingRequired.push({ row: rec.__row, venue, fields: missing });
  }

  // Award values
  if (rec.sol_level && !ALLOWED_SOL_LEVELS.has(rec.sol_level)) {
    invalidAward.push({ row: rec.__row, venue, field: "sol_level", value: rec.sol_level, reason: "must be 1, 2, or 3" });
  }
  if (rec.guide_year && rec.guide_year !== REQUIRED_GUIDE_YEAR) {
    invalidAward.push({ row: rec.__row, venue, field: "guide_year", value: rec.guide_year, reason: "must be 2026" });
  }
  if (rec.locality && rec.locality !== REQUIRED_LOCALITY) {
    invalidAward.push({ row: rec.__row, venue, field: "locality", value: rec.locality, reason: "must be Madrid" });
  }

  if (ALLOWED_SOL_LEVELS.has(rec.sol_level)) solCounts[rec.sol_level] += 1;
  else solCounts.other += 1;

  // Source / verification failures (missing OR invalid values both count)
  if (!rec.source_url) {
    sourceFailures.push({ row: rec.__row, venue, field: "source_url", value: "(empty)", reason: "missing source URL" });
  } else if (!isOfficialHttpsSourceUrl(rec.source_url)) {
    sourceFailures.push({ row: rec.__row, venue, field: "source_url", value: rec.source_url, reason: "must be an HTTPS URL on official guiarepsol.com (or www.guiarepsol.com)" });
  }
  if (!rec.source_type) {
    sourceFailures.push({ row: rec.__row, venue, field: "source_type", value: "(empty)", reason: "source_type must be nonempty" });
  }
  if (!rec.source_accessed_at) {
    sourceFailures.push({ row: rec.__row, venue, field: "source_accessed_at", value: "(empty)", reason: "missing access date" });
  } else if (!isValidDate(rec.source_accessed_at)) {
    sourceFailures.push({ row: rec.__row, venue, field: "source_accessed_at", value: rec.source_accessed_at, reason: "must be a valid YYYY-MM-DD date" });
  }
  if (!rec.verification_status) {
    sourceFailures.push({ row: rec.__row, venue, field: "verification_status", value: "(empty)", reason: "missing verification status" });
  } else if (!ALLOWED_VERIFICATION_STATUS.has(rec.verification_status)) {
    sourceFailures.push({ row: rec.__row, venue, field: "verification_status", value: rec.verification_status, reason: "must be 'verified'" });
  }

  // Duplicate detection: normalized venue name + guide_year
  const key = `${normalizeVenueName(rec.venue_name || "")}|${rec.guide_year}`;
  if (!dupeMap.has(key)) dupeMap.set(key, []);
  dupeMap.get(key).push({ row: rec.__row, venue });
}

for (const [key, entries] of dupeMap) {
  if (entries.length > 1) duplicates.push({ key, entries });
}

const pass =
  missingRequired.length === 0 &&
  invalidAward.length === 0 &&
  duplicates.length === 0 &&
  sourceFailures.length === 0;

// --- Report (deterministic: no generated-at timestamp) ---
const lines = [];
lines.push("# Guía Repsol 2026 Madrid Seed Validation Report");
lines.push("");
lines.push("Deterministic validation of `data/guia-repsol-2026-madrid-new-sol-cohort.csv`.");
lines.push("Generated by `scripts/validate-guia-repsol-2026-madrid-seed.mjs` (`npm run validate:madrid-seed`).");
lines.push("This report contains no timestamp; its content depends only on the input CSV.");
lines.push("");
lines.push(`## Result: ${pass ? "PASS" : "FAIL"}`);
lines.push("");
lines.push("## Totals");
lines.push("");
lines.push(`- Total records: ${records.length}`);
lines.push(`- Sol level 3: ${solCounts["3"]}`);
lines.push(`- Sol level 2: ${solCounts["2"]}`);
lines.push(`- Sol level 1: ${solCounts["1"]}`);
lines.push(`- Other/invalid Sol level: ${solCounts.other}`);
lines.push("");

lines.push("## Missing required fields");
lines.push("");
lines.push("Required fields: " + REQUIRED_FIELDS.map((f) => `\`${f}\``).join(", ") + ". `street_address` is intentionally optional.");
lines.push("");
if (missingRequired.length === 0) {
  lines.push("None.");
} else {
  lines.push("| CSV line | Venue | Missing fields |");
  lines.push("| --- | --- | --- |");
  for (const m of missingRequired) lines.push(`| ${m.row} | ${m.venue} | ${m.fields.join(", ")} |`);
}
lines.push("");

lines.push("## Invalid award values");
lines.push("");
lines.push("Rules: `sol_level` in {1, 2, 3}; `guide_year` = 2026; `locality` = Madrid.");
lines.push("");
if (invalidAward.length === 0) {
  lines.push("None.");
} else {
  lines.push("| CSV line | Venue | Field | Value | Reason |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const e of invalidAward) lines.push(`| ${e.row} | ${e.venue} | ${e.field} | ${e.value} | ${e.reason} |`);
}
lines.push("");

lines.push("## Duplicate candidates");
lines.push("");
lines.push("Detected by normalized venue name (case-, accent-, and punctuation-insensitive) + `guide_year`.");
lines.push("");
if (duplicates.length === 0) {
  lines.push("None.");
} else {
  lines.push("| Normalized key | CSV lines | Venues |");
  lines.push("| --- | --- | --- |");
  for (const d of duplicates) {
    lines.push(`| ${d.key} | ${d.entries.map((e) => e.row).join(", ")} | ${d.entries.map((e) => e.venue).join(", ")} |`);
  }
}
lines.push("");

lines.push("## Source-verification failures");
lines.push("");
lines.push("Rules: `source_url` is HTTPS on official `guiarepsol.com` (including `www.guiarepsol.com`); `source_type` is nonempty; `source_accessed_at` is a valid `YYYY-MM-DD` date; `verification_status` = `verified`. Missing or invalid values both count as failures.");
lines.push("");
if (sourceFailures.length === 0) {
  lines.push("None.");
} else {
  lines.push("| CSV line | Venue | Field | Value | Reason |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const e of sourceFailures) lines.push(`| ${e.row} | ${e.venue} | ${e.field} | ${e.value} | ${e.reason} |`);
}
lines.push("");

writeFileSync(OUTPUT_REPORT, lines.join("\n"));

console.log(`Validated ${records.length} records: ${pass ? "PASS" : "FAIL"}`);
console.log(`Report written to docs/guia-repsol-2026-madrid-seed-validation-report.md`);
process.exit(pass ? 0 : 1);

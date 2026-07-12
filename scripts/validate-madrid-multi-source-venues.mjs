#!/usr/bin/env node
/**
 * Validate the unified 2026 Madrid multi-source venue dataset.
 *
 * Rebuilds all artifacts via scripts/build-madrid-multi-source-venues.mjs
 * (regenerating data/madrid-2026-unified-venues.json,
 * data/madrid-2026-multi-source-match-exceptions.json, and
 * docs/madrid-2026-multi-source-deduplication-report.md), then asserts the
 * expected deduplication invariants. Exits non-zero on any failure.
 *
 * Deterministic and dependency-free; no run timestamps.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeArtifacts, normalizeName } from "./build-madrid-multi-source-venues.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
let checkCount = 0;
function check(ok, label) {
  checkCount++;
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.error(`FAIL  ${label}`);
  }
}

let built;
try {
  built = writeArtifacts();
} catch (err) {
  console.error(`FAIL  build step threw: ${err.message}`);
  process.exit(1);
}

const unified = JSON.parse(
  readFileSync(join(ROOT, "data/madrid-2026-unified-venues.json"), "utf8")
);
const exceptions = JSON.parse(
  readFileSync(join(ROOT, "data/madrid-2026-multi-source-match-exceptions.json"), "utf8")
);
const { venues, counts } = unified;
const allDistinctions = venues.flatMap((v) => v.distinctions);
const repsolD = allDistinctions.filter((d) => d.source_slug === "guia-repsol");
const michelinD = allDistinctions.filter((d) => d.source_slug === "michelin-guide");

// --- Source preservation ----------------------------------------------------
check(allDistinctions.length === 50, "exactly 50 source distinction entries preserved");
check(repsolD.length === 20, "exactly 20 Guía Repsol source entries");
check(michelinD.length === 30, "exactly 30 Michelin source entries");
check(counts.source_entries_total === 50, "counts.source_entries_total === 50");

// No source fields lost: every distinction carries the required fields non-empty.
const requiredFields = [
  "source_name",
  "source_slug",
  "source_venue_name",
  "year",
  "distinction",
  "distinction_level",
  "source_url",
  "source_type",
  "source_accessed_at",
  "validation_status",
  "validation_evidence",
  "input_file",
];
check(
  allDistinctions.every((d) =>
    requiredFields.every((f) => d[f] !== undefined && d[f] !== null && d[f] !== "")
  ),
  "every distinction preserves all required source fields (name/slug/source name/year/level/url/type/access date/validation status/evidence)"
);
check(
  allDistinctions.every((d) => "location_provenance" in d),
  "every distinction carries an explicit location_provenance field"
);

// Exact preservation of source venue names against the input CSVs.
function csvColumn(rel, col) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const header = lines[0].split(",");
  const idx = header.indexOf(col);
  return lines.slice(1).map((l) => l.split(",")[idx]);
}
const inputRepsolNames = [
  ...csvColumn("data/guia-repsol-2026-madrid-new-sol-cohort.csv", "venue_name"),
  ...csvColumn("data/guia-repsol-2026-madrid-continuing-sol-selection.csv", "venue_name"),
].sort();
const inputMichelinNames = csvColumn(
  "data/michelin-2026-madrid-city-starred.csv",
  "restaurant_name"
).sort();
check(
  JSON.stringify(repsolD.map((d) => d.source_venue_name).sort()) ===
    JSON.stringify(inputRepsolNames),
  "Repsol source venue names preserved exactly from both input CSVs"
);
check(
  JSON.stringify(michelinD.map((d) => d.source_venue_name).sort()) ===
    JSON.stringify(inputMichelinNames),
  "Michelin source restaurant names preserved exactly from the input CSV"
);

// --- Unified venue outcomes --------------------------------------------------
check(venues.length === 40, "exactly 40 unified canonical venues");
const merged = venues.filter((v) => v.source_outcome === "multi-source");
const repsolOnly = venues.filter((v) => v.source_outcome === "repsol-only");
const michelinOnly = venues.filter((v) => v.source_outcome === "michelin-only");
check(merged.length === 10, "exactly 10 exact-name auto-merged multi-source venues");
check(repsolOnly.length === 10, "exactly 10 Repsol-only venues");
check(michelinOnly.length === 20, "exactly 20 Michelin-only venues");

// Merged venues preserve exactly two distinctions, one per source.
check(
  merged.every(
    (v) =>
      v.distinctions.length === 2 &&
      v.distinctions.some((d) => d.source_slug === "guia-repsol") &&
      v.distinctions.some((d) => d.source_slug === "michelin-guide")
  ),
  "each merged venue preserves exactly two distinctions (one Repsol, one Michelin)"
);
check(
  [...repsolOnly, ...michelinOnly].every((v) => v.distinctions.length === 1),
  "each single-source venue carries exactly one distinction"
);

// --- No silent fuzzy matches --------------------------------------------------
check(
  merged.every((v) => {
    const [a, b] = v.distinctions;
    return normalizeName(a.source_venue_name) === normalizeName(b.source_venue_name);
  }),
  "every merge is exact-normalized-full-name only (no fuzzy/prefix merges)"
);
check(
  merged.every(
    (v) =>
      v.match &&
      v.match.method === "exact-normalized-full-name" &&
      v.match.blocking_key === "Madrid|Spain|2026" &&
      typeof v.match.evidence === "string" &&
      v.match.evidence.length > 0
  ),
  "every merged venue carries match provenance/evidence"
);
check(
  [...repsolOnly, ...michelinOnly].every((v) => v.match === null),
  "single-source venues carry no match record"
);
// Ramón Freixa Tradición and Ramón Freixa Atelier must remain distinct venues.
const ids = venues.map((v) => v.id);
check(
  ids.includes("madrid-2026-ramon-freixa-tradicion") &&
    ids.includes("madrid-2026-ramon-freixa-atelier"),
  "Ramón Freixa Tradición and Ramón Freixa Atelier remain separate canonical venues"
);
check(
  venues.find((v) => v.id === "madrid-2026-ramon-freixa-tradicion")?.source_outcome ===
    "repsol-only",
  "Ramón Freixa Tradición is Repsol-only (never prefix-merged with Michelin's Atelier)"
);

// --- Deterministic identifiers & ordering -------------------------------------
check(new Set(ids).size === ids.length, "canonical venue ids are unique");
check(
  ids.every((id) => /^madrid-2026-[a-z0-9-]+$/.test(id)),
  "canonical venue ids are deterministic slugs (madrid-2026-<slug>)"
);
check(
  JSON.stringify(ids) === JSON.stringify([...ids].sort()),
  "venues are emitted in deterministic sorted-id order"
);
// Rebuild determinism: a second build must be byte-identical.
const firstBytes = readFileSync(join(ROOT, "data/madrid-2026-unified-venues.json"), "utf8");
writeArtifacts();
const secondBytes = readFileSync(join(ROOT, "data/madrid-2026-unified-venues.json"), "utf8");
check(firstBytes === secondBytes, "rebuild is byte-identical (no run-dependent timestamps)");

// --- Coordinate policy ---------------------------------------------------------
check(
  repsolD.every((d) => d.location_provenance === null),
  "Repsol distinctions carry no coordinates (absent in source CSVs; not copied from migrations)"
);
check(
  venues.every((v) => {
    const m = v.distinctions.find((d) => d.source_slug === "michelin-guide");
    const michHasCoords = m?.location_provenance?.latitude != null;
    if (michHasCoords) {
      return (
        v.canonical_location &&
        v.canonical_location.latitude === m.location_provenance.latitude &&
        v.canonical_location.longitude === m.location_provenance.longitude &&
        v.canonical_location.coord_source === m.location_provenance.coord_source &&
        v.canonical_location.coord_validation_status ===
          m.location_provenance.coord_validation_status &&
        v.canonical_location.provenance_source_slug === "michelin-guide"
      );
    }
    return v.canonical_location === null;
  }),
  "canonical coordinates come only from qualified Michelin pins (with source + validation status); otherwise null"
);

// --- Exception artifact ----------------------------------------------------------
const freixaException = (exceptions.rejected_candidates ?? []).find(
  (c) =>
    c.candidate_a?.source_venue_name === "Ramón Freixa Tradición" &&
    c.candidate_b?.source_venue_name === "Ramón Freixa Atelier"
);
check(
  Boolean(freixaException),
  "exception artifact records the rejected Ramón Freixa Tradición (Repsol) vs Ramón Freixa Atelier (Michelin) candidate"
);
check(
  Boolean(
    freixaException &&
      freixaException.evidence &&
      freixaException.reason &&
      freixaException.action &&
      /suffix/i.test(freixaException.reason)
  ),
  "Ramón Freixa exception includes evidence/reason/action citing the differing identity-bearing suffixes"
);

// --- Summary --------------------------------------------------------------------
console.log("");
if (failures.length > 0) {
  console.error(
    `RESULT: FAIL — ${failures.length} of ${checkCount} checks failed:\n` +
      failures.map((f) => `  - ${f}`).join("\n")
  );
  process.exit(1);
}
console.log(
  `RESULT: PASS — all ${checkCount} checks passed (50 source entries -> 40 unified venues; 10 exact-name merges; artifacts + report regenerated).`
);

#!/usr/bin/env node
/**
 * Build the unified 2026 Madrid multi-source venue dataset.
 *
 * Deterministic, dependency-free Node ESM. Inputs (never modified):
 *   - data/michelin-2026-madrid-city-starred.csv          (30 Michelin source entries)
 *   - data/guia-repsol-2026-madrid-new-sol-cohort.csv      (10 Repsol source entries)
 *   - data/guia-repsol-2026-madrid-continuing-sol-selection.csv (10 Repsol source entries)
 *
 * Outputs (regenerated, byte-identical for identical inputs — no run timestamps):
 *   - data/madrid-2026-unified-venues.json
 *   - data/madrid-2026-multi-source-match-exceptions.json
 *   - docs/madrid-2026-multi-source-deduplication-report.md
 *
 * Matching policy:
 *   - Block by (locality=Madrid, country=Spain, guide_year=2026).
 *   - Auto-merge ONLY on normalized full-name equality that is one-to-one
 *     unique across sources. No fuzzy, prefix, or chef-name matching.
 *   - Rejected near-candidates are recorded in the exceptions artifact.
 *
 * Coordinate policy:
 *   - Repsol source CSVs carry no coordinates; none are invented or copied
 *     from migrations.
 *   - Michelin OSM/Nominatim-qualified coordinates become canonical when
 *     present, carrying their coord_source and coord_validation_status.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-ish: quoted fields, escaped quotes, no embedded CRLF
// needed by these inputs but handled anyway).
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])));
}

function readCsv(rel) {
  return parseCsv(readFileSync(join(ROOT, rel), "utf8"));
}

// ---------------------------------------------------------------------------
// Name normalization used ONLY for exact full-name equality matching.
// Unicode NFC + trim + collapse internal whitespace + case-fold.
// Deliberately does NOT strip suffixes, diacritics-fold, or prefix-truncate:
// identity-bearing name parts must survive normalization.
// ---------------------------------------------------------------------------
export function normalizeName(name) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

// Deterministic ASCII slug for canonical ids (diacritics folded here is safe:
// ids only need to be deterministic and unique, matching never uses slugs).
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''´`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SOL_LABEL = { 1: "1 Sol", 2: "2 Soles", 3: "3 Soles" };

export function buildDataset() {
  const repsolRows = [
    ...readCsv("data/guia-repsol-2026-madrid-new-sol-cohort.csv").map((r) => ({
      row: r,
      input_file: "data/guia-repsol-2026-madrid-new-sol-cohort.csv",
      cohort: "new-sol-cohort",
    })),
    ...readCsv("data/guia-repsol-2026-madrid-continuing-sol-selection.csv").map((r) => ({
      row: r,
      input_file: "data/guia-repsol-2026-madrid-continuing-sol-selection.csv",
      cohort: "continuing-sol-selection",
    })),
  ];
  const michelinRows = readCsv("data/michelin-2026-madrid-city-starred.csv").map((r) => ({
    row: r,
    input_file: "data/michelin-2026-madrid-city-starred.csv",
  }));

  // -- Build source distinction entries (all input fields preserved) --------
  const repsolEntries = repsolRows.map(({ row, input_file, cohort }) => ({
    source_name: "Guía Repsol",
    source_slug: "guia-repsol",
    source_venue_name: row.source_venue_name,
    venue_name: row.venue_name,
    guide_year: Number(row.guide_year),
    distinction: SOL_LABEL[Number(row.sol_level)],
    distinction_level: Number(row.sol_level),
    source_url: row.source_url,
    source_type: row.source_type,
    source_published_or_updated_at: row.source_published_or_updated_at || null,
    source_accessed_at: row.source_accessed_at,
    validation_status: row.verification_status,
    validation_evidence: row.verification_note,
    input_file,
    cohort,
    locality: row.locality,
    country: "Spain",
    street_address: row.street_address || null,
    // Repsol source CSVs carry no coordinates; treated as absent by policy
    // (not copied from pb_migrations).
    location_provenance: null,
  }));

  const michelinEntries = michelinRows.map(({ row, input_file }) => {
    const hasCoords = row.latitude !== "" && row.longitude !== "";
    return {
      source_name: "Michelin Guide",
      source_slug: "michelin-guide",
      source_venue_name: row.source_restaurant_name,
      venue_name: row.restaurant_name,
      guide_year: Number(row.guide_year),
      distinction: row.michelin_distinction,
      distinction_level: Number(row.michelin_stars),
      source_url: row.source_url,
      source_type: row.source_type,
      source_published_or_updated_at: null,
      source_accessed_at: row.source_accessed_at,
      validation_status: row.coord_validation_status,
      validation_evidence: row.note,
      input_file,
      cohort: null,
      locality: row.locality,
      country: row.country,
      street_address: row.street_address || null,
      location_provenance: hasCoords
        ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            street_address: row.street_address || null,
            coord_source: row.coord_source,
            coord_validation_status: row.coord_validation_status,
          }
        : {
            latitude: null,
            longitude: null,
            street_address: row.street_address || null,
            coord_source: row.coord_source || null,
            coord_validation_status: row.coord_validation_status,
          },
    };
  });

  // -- Blocking: only entries within (Madrid, Spain, 2026) may be compared --
  const inBlock = (e) =>
    e.locality === "Madrid" && e.country === "Spain" && e.guide_year === 2026;
  for (const e of [...repsolEntries, ...michelinEntries]) {
    if (!inBlock(e)) {
      throw new Error(`Entry outside Madrid/Spain/2026 block: ${e.venue_name}`);
    }
  }

  // -- Exact normalized full-name matching, one-to-one unique ----------------
  const byNorm = new Map();
  const addToNorm = (e) => {
    const k = normalizeName(e.venue_name);
    if (!byNorm.has(k)) byNorm.set(k, { repsol: [], michelin: [] });
    byNorm.get(k)[e.source_slug === "guia-repsol" ? "repsol" : "michelin"].push(e);
  };
  repsolEntries.forEach(addToNorm);
  michelinEntries.forEach(addToNorm);

  const venues = [];
  for (const [normKey, group] of byNorm) {
    const { repsol, michelin } = group;
    // One-to-one uniqueness guard: exact-name groups with more than one entry
    // per source are never auto-merged (would be ambiguous). Not expected in
    // these inputs; enforced anyway.
    if (repsol.length > 1 || michelin.length > 1) {
      throw new Error(
        `Ambiguous exact-name group '${normKey}' (${repsol.length} Repsol, ${michelin.length} Michelin); refusing to auto-merge`
      );
    }
    const entries = [...repsol, ...michelin];
    const merged = repsol.length === 1 && michelin.length === 1;
    // Canonical name: prefer Michelin's rendering when present, else Repsol's.
    const canonicalName = (michelin[0] ?? repsol[0]).venue_name;
    const mich = michelin[0] ?? null;
    const michLoc = mich?.location_provenance;
    const hasMichCoords = michLoc && michLoc.latitude !== null;

    venues.push({
      id: `madrid-2026-${slugify(canonicalName)}`,
      canonical_name: canonicalName,
      normalized_match_key: normKey,
      locality: "Madrid",
      country: "Spain",
      canonical_location: hasMichCoords
        ? {
            latitude: michLoc.latitude,
            longitude: michLoc.longitude,
            street_address: michLoc.street_address,
            coord_source: michLoc.coord_source,
            coord_validation_status: michLoc.coord_validation_status,
            provenance_source_slug: "michelin-guide",
          }
        : null,
      match: merged
        ? {
            method: "exact-normalized-full-name",
            blocking_key: "Madrid|Spain|2026",
            matched_names: {
              "guia-repsol": repsol[0].venue_name,
              "michelin-guide": michelin[0].venue_name,
            },
            evidence: `Normalized full names are identical ('${normKey}') and unique one-to-one across both sources within the Madrid/Spain/2026 block.`,
          }
        : null,
      source_outcome: merged
        ? "multi-source"
        : repsol.length === 1
          ? "repsol-only"
          : "michelin-only",
      distinctions: entries.map((e) => ({
        source_name: e.source_name,
        source_slug: e.source_slug,
        source_venue_name: e.source_venue_name,
        year: e.guide_year,
        distinction: e.distinction,
        distinction_level: e.distinction_level,
        source_url: e.source_url,
        source_type: e.source_type,
        source_published_or_updated_at: e.source_published_or_updated_at,
        source_accessed_at: e.source_accessed_at,
        validation_status: e.validation_status,
        validation_evidence: e.validation_evidence,
        input_file: e.input_file,
        cohort: e.cohort,
        location_provenance: e.location_provenance,
      })),
    });
  }

  // Deterministic ordering: sort venues by id (ASCII codepoint order),
  // distinctions within a venue by source_slug (guia-repsol before
  // michelin-guide, codepoint order).
  venues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const v of venues) {
    v.distinctions.sort((a, b) =>
      a.source_slug < b.source_slug ? -1 : a.source_slug > b.source_slug ? 1 : 0
    );
  }

  const counts = {
    source_entries_total: repsolEntries.length + michelinEntries.length,
    source_entries_repsol: repsolEntries.length,
    source_entries_michelin: michelinEntries.length,
    unified_venues: venues.length,
    merged_multi_source: venues.filter((v) => v.source_outcome === "multi-source").length,
    repsol_only: venues.filter((v) => v.source_outcome === "repsol-only").length,
    michelin_only: venues.filter((v) => v.source_outcome === "michelin-only").length,
  };

  const unified = {
    dataset: "madrid-2026-unified-venues",
    description:
      "Unified 2026 Madrid-city venue entities deduplicated across Guía Repsol and Michelin Guide source CSVs. Deterministic build; regenerate with `npm run build:multi-source-madrid`.",
    blocking: { locality: "Madrid", country: "Spain", guide_year: 2026 },
    matching_policy:
      "Auto-merge only on exact normalized full-name equality (NFC, trimmed, whitespace-collapsed, case-folded), one-to-one unique across sources. No fuzzy, prefix, or chef-name merging. Rejected near-candidates are recorded in data/madrid-2026-multi-source-match-exceptions.json.",
    coordinate_policy:
      "Repsol source CSVs carry no coordinates (treated as absent; not copied from migrations). Michelin OSM/Nominatim-qualified coordinates are canonical when present, with coord_source and coord_validation_status preserved.",
    inputs: [
      "data/guia-repsol-2026-madrid-new-sol-cohort.csv",
      "data/guia-repsol-2026-madrid-continuing-sol-selection.csv",
      "data/michelin-2026-madrid-city-starred.csv",
    ],
    counts,
    venues,
  };

  const exceptions = {
    dataset: "madrid-2026-multi-source-match-exceptions",
    description:
      "Inspectable record of near-candidate venue pairs that were considered and deliberately NOT merged by the exact-name-only matching policy. Regenerated by scripts/build-madrid-multi-source-venues.mjs.",
    policy:
      "Only exact normalized full-name equality (one-to-one unique) auto-merges. Similar names, shared prefixes, or shared chef/operator names never merge.",
    rejected_candidates: [
      {
        candidate_a: {
          source_slug: "guia-repsol",
          source_venue_name: "Ramón Freixa Tradición",
          distinction: "1 Sol",
          year: 2026,
          input_file: "data/guia-repsol-2026-madrid-new-sol-cohort.csv",
        },
        candidate_b: {
          source_slug: "michelin-guide",
          source_venue_name: "Ramón Freixa Atelier",
          distinction: "two-stars",
          year: 2026,
          input_file: "data/michelin-2026-madrid-city-starred.csv",
        },
        evidence:
          "Both names share the chef-name prefix 'Ramón Freixa' within the Madrid/Spain/2026 block, but the identity-bearing suffixes differ: 'Tradición' vs 'Atelier'. These denote two distinct restaurant concepts by the same chef; Guía Repsol 2026 separately lists 'Ramón Freixa Atelier' (3 Soles), which exact-name matching correctly merges with Michelin's 'Ramón Freixa Atelier' (two-stars).",
        reason:
          "Differing identity-bearing suffixes ('Tradición' vs 'Atelier') prohibit a prefix/chef-name merge under the exact-full-name-only policy; a prefix merge would conflate two distinct venues.",
        action:
          "rejected — kept as separate canonical venues (madrid-2026-ramon-freixa-tradicion stays Repsol-only; madrid-2026-ramon-freixa-atelier merges only with the exact-name Repsol entry).",
      },
    ],
  };

  return { unified, exceptions, counts };
}

function buildReport({ unified, exceptions, counts }) {
  const merged = unified.venues.filter((v) => v.source_outcome === "multi-source");
  const repsolOnly = unified.venues.filter((v) => v.source_outcome === "repsol-only");
  const michelinOnly = unified.venues.filter((v) => v.source_outcome === "michelin-only");
  const lines = [];
  lines.push("# Madrid 2026 multi-source deduplication report");
  lines.push("");
  lines.push(
    "Deterministic report regenerated by `npm run build:multi-source-madrid` / `npm run validate:multi-source-madrid` (`scripts/build-madrid-multi-source-venues.mjs`). No run timestamps: content changes only when inputs change."
  );
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  for (const f of unified.inputs) lines.push(`- \`${f}\``);
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  lines.push(`- Blocking: locality=Madrid, country=Spain, guide_year=2026.`);
  lines.push(`- Matching: ${unified.matching_policy}`);
  lines.push(`- Coordinates: ${unified.coordinate_policy}`);
  lines.push("");
  lines.push("## Result counts");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Source entries (total) | ${counts.source_entries_total} |`);
  lines.push(`| Guía Repsol source entries | ${counts.source_entries_repsol} |`);
  lines.push(`| Michelin source entries | ${counts.source_entries_michelin} |`);
  lines.push(`| Unified canonical venues | ${counts.unified_venues} |`);
  lines.push(`| Exact-name auto-merges (multi-source venues) | ${counts.merged_multi_source} |`);
  lines.push(`| Repsol-only venues | ${counts.repsol_only} |`);
  lines.push(`| Michelin-only venues | ${counts.michelin_only} |`);
  lines.push("");
  lines.push("## Exact-name auto-merges");
  lines.push("");
  lines.push("| Canonical venue | Repsol distinction | Michelin distinction | Canonical coordinates |");
  lines.push("| --- | --- | --- | --- |");
  for (const v of merged) {
    const r = v.distinctions.find((d) => d.source_slug === "guia-repsol");
    const m = v.distinctions.find((d) => d.source_slug === "michelin-guide");
    const loc = v.canonical_location
      ? `${v.canonical_location.latitude}, ${v.canonical_location.longitude} (${v.canonical_location.coord_validation_status})`
      : "none (no responsible pin)";
    lines.push(`| ${v.canonical_name} | ${r.distinction} | ${m.distinction} | ${loc} |`);
  }
  lines.push("");
  lines.push("## Repsol-only venues");
  lines.push("");
  for (const v of repsolOnly) {
    lines.push(`- ${v.canonical_name} (${v.distinctions[0].distinction})`);
  }
  lines.push("");
  lines.push("## Michelin-only venues");
  lines.push("");
  for (const v of michelinOnly) {
    lines.push(`- ${v.canonical_name} (${v.distinctions[0].distinction})`);
  }
  lines.push("");
  lines.push("## Rejected near-candidates (not merged)");
  lines.push("");
  for (const c of exceptions.rejected_candidates) {
    lines.push(
      `- **${c.candidate_a.source_venue_name}** (${c.candidate_a.source_slug}, ${c.candidate_a.distinction}) vs **${c.candidate_b.source_venue_name}** (${c.candidate_b.source_slug}, ${c.candidate_b.distinction})`
    );
    lines.push(`  - Evidence: ${c.evidence}`);
    lines.push(`  - Reason: ${c.reason}`);
    lines.push(`  - Action: ${c.action}`);
  }
  lines.push("");
  lines.push(
    "Full machine-readable exception detail: `data/madrid-2026-multi-source-match-exceptions.json`."
  );
  lines.push("");
  return lines.join("\n");
}

export function writeArtifacts() {
  const built = buildDataset();
  writeFileSync(
    join(ROOT, "data/madrid-2026-unified-venues.json"),
    JSON.stringify(built.unified, null, 2) + "\n"
  );
  writeFileSync(
    join(ROOT, "data/madrid-2026-multi-source-match-exceptions.json"),
    JSON.stringify(built.exceptions, null, 2) + "\n"
  );
  writeFileSync(
    join(ROOT, "docs/madrid-2026-multi-source-deduplication-report.md"),
    buildReport(built)
  );
  return built;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { counts } = writeArtifacts();
  console.log(
    `Built madrid-2026 unified venues: ${counts.source_entries_total} source entries (${counts.source_entries_repsol} Repsol / ${counts.source_entries_michelin} Michelin) -> ${counts.unified_venues} canonical venues (${counts.merged_multi_source} merged, ${counts.repsol_only} Repsol-only, ${counts.michelin_only} Michelin-only).`
  );
  console.log("Wrote data/madrid-2026-unified-venues.json");
  console.log("Wrote data/madrid-2026-multi-source-match-exceptions.json");
  console.log("Wrote docs/madrid-2026-multi-source-deduplication-report.md");
}

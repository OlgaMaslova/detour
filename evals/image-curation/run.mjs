// Regression eval for the image curation classifier in pb_hooks/image_curation.js.
//
// WHY THIS EXISTS. The hook decides whether a member's photo is shown on a public
// place page. Two things can silently degrade it: a prompt edit, or OpenAI moving
// the model under a floating alias. Neither breaks a build. Both change what
// reaches production. This suite is the thing that notices.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not load the hook. That code runs in
// PocketBase's JSVM against $http, $os and app, and shimming those to get at a
// classifier would test the shim as much as the classifier. Instead this issues
// the same two requests the hook issues — same endpoints, same instructions, same
// model default, same `detail: "low"` — and parses the reply with the same logic.
// The contract is what is under test, not the plumbing around it.
//
// Usage:
//   OPENAI_API_KEY=sk-... node evals/image-curation/run.mjs
//   OPENAI_API_KEY=sk-... node evals/image-curation/run.mjs --model gpt-4o --limit 5

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, "cases.jsonl");
const RESULTS_DIR = join(HERE, "results");

// Kept identical to the hook. If you edit the hook's instructions, edit them here
// in the same commit — a diff in this string is the whole point of the suite.
const INSTRUCTIONS =
  "Classify a candidate image for a food-and-drink destination. " +
  "Judge what the photograph is of, not whether the venue can be " +
  "identified from it. Relevant: the subject is a food-and-drink " +
  "establishment or something served or done in one — an exterior, an " +
  "interior, a sign, a menu, food, drinks, or staff at work. Do not " +
  "require branding, a visible name, or any other proof that the subject " +
  "is the named venue; most photographs of a place carry none, and " +
  "relevant is still the right answer. An ordinary photograph of a plate " +
  "or a glass is relevant even when no venue is visible around it: " +
  "missing context is never a reason to answer irrelevant. Irrelevant: " +
  "the subject has no food-and-drink content at all — memes, screenshots, " +
  "maps, animals, unrelated people and objects, a street scene, or a room " +
  "that is not part of an establishment. Uncertain: the photograph is too " +
  "dark, blurred, or closely cropped to tell what its subject is. " +
  "Return JSON only.";

const RELEVANCE = ["relevant", "uncertain", "irrelevant"];

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE_URL = process.env.DETOUR_OPENAI_BASE_URL || "https://api.openai.com";
const MODEL = arg("model", process.env.DETOUR_IMAGE_CURATION_MODEL || "gpt-4o-mini");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const API_KEY = process.env.OPENAI_API_KEY;

// ---------------------------------------------------------------------------
// Response parsing — mirrors outputText() and parseJsonObject() in the hook.
// Reimplemented rather than imported because the hook is a JSVM module; keeping
// them byte-for-byte equivalent is the maintenance cost of that choice.
// ---------------------------------------------------------------------------

function outputText(payload) {
  let text = "";
  for (const item of (payload && payload.output) || []) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

function parseJsonObject(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function mimeForFileName(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

// The hook inlines bytes rather than passing a link, so the eval must too — a
// link would test a CDN's availability instead of the classifier.
async function dataUrl(path) {
  const bytes = await readFile(path);
  return "data:" + mimeForFileName(path) + ";base64," + bytes.toString("base64");
}

// ---------------------------------------------------------------------------
// The two API calls, as the hook makes them.
// ---------------------------------------------------------------------------

async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { statusCode: res.status, json: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

async function moderate(url) {
  const res = await post(
    "/v1/moderations",
    { model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url } }] },
    45000
  );
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return { ok: false, reason: "moderation HTTP " + res.statusCode };
  }
  const result = ((res.json || {}).results || [])[0];
  if (!result || typeof result.flagged !== "boolean") {
    return { ok: false, reason: "moderation returned an invalid result" };
  }
  return { ok: true, flagged: result.flagged, categories: result.categories || {} };
}

async function classify(url, venue) {
  const res = await post(
    "/v1/responses",
    {
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Venue: " +
                venue.venue_name +
                "\nCity: " +
                venue.city +
                "\nCountry: " +
                venue.country +
                '\nReturn {"relevance":"relevant"|"uncertain"|"irrelevant","note":"brief reason"}.',
            },
            { type: "input_image", image_url: url, detail: "low" },
          ],
        },
      ],
    },
    60000
  );

  if (res.statusCode < 200 || res.statusCode >= 300) {
    return { schema_ok: false, reason: "responses HTTP " + res.statusCode };
  }

  // Deterministic checks. These need no labels and are the cheapest early warning
  // that a model or prompt change broke the contract: the hook silently falls
  // back to "uncertain" on a malformed reply, so in production this failure looks
  // like caution rather than breakage.
  const answer = parseJsonObject(outputText(res.json || {}));
  if (!answer) return { schema_ok: false, reason: "reply was not a JSON object" };
  if (!RELEVANCE.includes(answer.relevance)) {
    return { schema_ok: false, reason: "relevance not in enum: " + answer.relevance };
  }

  return {
    schema_ok: true,
    relevance: answer.relevance,
    note: typeof answer.note === "string" ? answer.note : "",
    usage: (res.json || {}).usage || null,
  };
}

// ---------------------------------------------------------------------------
// Scoring.
//
// Errors here are not symmetric, so a single accuracy number would hide the one
// that matters. The hook publishes on "relevant" and routes both other answers to
// founder review, so abstention is a safe outcome that costs attention rather
// than trust — and a leak is not a bad annotation, it is a bad photograph on a
// public place page:
//
//   leak        irrelevant or unsafe photo classified relevant  → gates the suite
//   over_strict a good photo called irrelevant                  → annoys a member
//   abstained   correct-but-deferred                            → costs review time
//   hit         exact match
//
// LEAK_BUDGET is the gate. Zero is the honest target for a public page; raise it
// only with a reason written next to it.
// ---------------------------------------------------------------------------

const LEAK_BUDGET = 0;

function score(expected, observed) {
  if (expected === observed) return "hit";
  if (observed === "relevant") return "leak";
  if (observed === "uncertain") return "abstained";
  if (observed === "irrelevant" && expected === "relevant") return "over_strict";
  return "miss";
}

async function main() {
  if (!API_KEY) {
    console.error("OPENAI_API_KEY is not set.");
    process.exit(2);
  }

  const raw = await readFile(CASES, "utf8");
  const cases = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .map((line) => JSON.parse(line))
    .slice(0, LIMIT);

  const results = [];
  let tokens = 0;

  for (const c of cases) {
    const path = resolve(HERE, c.image);
    let record;
    try {
      const url = await dataUrl(path);
      const mod = await moderate(url);

      if (!mod.ok) {
        record = { ...c, outcome: "error", reason: mod.reason };
      } else if (mod.flagged) {
        // The hook auto-rejects here and never reaches the classifier, so the
        // safety gate is its own outcome rather than a relevance label.
        record = {
          ...c,
          observed: "unsafe",
          outcome: c.expected === "unsafe" ? "hit" : "miss",
          categories: Object.keys(mod.categories).filter((k) => mod.categories[k]),
        };
      } else if (c.expected === "unsafe") {
        // Moderation let through something we labelled unsafe. Worst case here.
        record = { ...c, observed: "not_flagged", outcome: "leak" };
      } else {
        const out = await classify(url, c);
        record = out.schema_ok
          ? { ...c, observed: out.relevance, note: out.note, outcome: score(c.expected, out.relevance) }
          : { ...c, outcome: "schema_fail", reason: out.reason };
        if (out.usage) tokens += out.usage.total_tokens || 0;
      }
    } catch (err) {
      record = { ...c, outcome: "error", reason: String(err && err.message) };
    }

    results.push(record);
    const mark = { hit: "ok", leak: "LEAK", schema_fail: "SCHEMA", error: "ERR" }[record.outcome] || record.outcome;
    console.log(
      [pad(mark, 11), pad(c.id, 24), "expected=" + pad(c.expected, 11), "got=" + (record.observed || "-")].join(" ")
    );
  }

  const tally = {};
  for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;

  const leaks = tally.leak || 0;
  const summary = {
    ran_at: new Date().toISOString(),
    model: MODEL,
    cases: results.length,
    tally,
    leaks,
    leak_budget: LEAK_BUDGET,
    total_tokens: tokens,
  };

  console.log("\n" + JSON.stringify(summary, null, 2));

  await mkdir(RESULTS_DIR, { recursive: true });
  // Stamped to the second, not the day. A prompt edit is tested by running this
  // twice in a row, and a date-only name made the second run overwrite the
  // baseline it was supposed to be compared against — losing the diff that is the
  // whole reason a result is committed.
  const stamp = summary.ran_at.replace(/:/g, "-").replace(/\.\d+Z$/, "");
  const file = join(RESULTS_DIR, `${stamp}-${MODEL.replace(/[^a-z0-9.-]/gi, "_")}.json`);
  await writeFile(file, JSON.stringify({ summary, results }, null, 2) + "\n");
  console.log("\nwrote " + basename(file) + " — commit it, and diff it on the next run.");

  // Non-zero exit so this can gate a workflow. Schema failures and leaks both
  // fail; over_strict and abstained do not, because they degrade politely.
  const hardFails = leaks - LEAK_BUDGET + (tally.schema_fail || 0) + (tally.error || 0);
  process.exit(hardFails > 0 ? 1 : 0);
}

function pad(value, width) {
  return String(value === undefined ? "-" : value).padEnd(width);
}

main();

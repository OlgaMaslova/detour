#!/usr/bin/env node
/**
 * Deterministic production validator for Detour's public community selection.
 *
 * Uses a fresh, unauthenticated Playwright browser context for the normal
 * Madrid catalogue path, then unauthenticated Node fetches for the exact public
 * records and private-data boundary. Exit code 0 on PASS, nonzero on failure.
 */

import { chromium } from "playwright";

const APP_URL = "https://detour.supernaut.to/?city=madrid";
const API_BASE = "https://sn-pb-repo-1297566350-a88d3c.fly.dev";
const COMMUNITY_LABEL = "Detour community selection";

const VENUE_ID = "venuepizza00001";
const SOURCE_ID = "16x2e1bvp590use";
const AWARD_ID = "x6duwjjme161jy4";
const PRIVATE_IDS = ["mtx6p2lxr0b8632", "pjhvwl5zeubwsys"];
const DENIED_STATUSES = new Set([401, 403, 404]);

class ValidationError extends Error {}

function assert(condition, name, detail = "") {
  if (!condition) {
    throw new ValidationError(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`PASS: ${name}`);
}

function collectionRecordsUrl(collection, id = "") {
  const suffix = id ? `/${id}` : "";
  return `${API_BASE}/api/collections/${collection}/records${suffix}`;
}

function isCollectionRequest(url, collection) {
  try {
    return new URL(url).pathname.startsWith(
      `/api/collections/${collection}/records`
    );
  } catch {
    return false;
  }
}

async function fetchResponse(url) {
  const response = await fetch(url);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { response, text, body };
}

async function fetchPublicRecord(collection, id) {
  const result = await fetchResponse(collectionRecordsUrl(collection, id));
  assert(
    result.response.status === 200,
    `public ${collection}/${id} returns 200`,
    `received HTTP ${result.response.status}`
  );
  assert(
    result.body !== null && typeof result.body === "object",
    `public ${collection}/${id} returns JSON`,
    result.text.slice(0, 160)
  );
  return result.body;
}

function findForbiddenKey(value, forbidden, path = "$") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenKey(value[index], forbidden, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbidden.has(key)) return childPath;
    const found = findForbiddenKey(child, forbidden, childPath);
    if (found) return found;
  }
  return null;
}

function disclosesPrivateRecord(body, id) {
  if (!body || typeof body !== "object") return false;
  if (body.id === id || body.collectionName === "detour_submissions") return true;
  return Boolean(
    findForbiddenKey(
      body,
      new Set([
        "member",
        "detour_note",
        "curator_note",
        "published_venue",
        "published_award",
        "published_at",
        "publication_audit_id",
      ])
    )
  );
}

async function validateBrowser() {
  let browser;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser = await chromium.launch(
      executablePath ? { executablePath, headless: true } : { headless: true }
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    const requestUrls = [];

    // Register before navigation so the complete normal anonymous data path is captured.
    page.on("request", (request) => requestUrls.push(request.url()));

    const navigation = await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    assert(
      navigation?.ok() === true,
      "anonymous Madrid catalogue navigation succeeds",
      `received HTTP ${navigation?.status() ?? "no response"}`
    );

    const baldoriaCard = page.locator(`button[data-venue="${VENUE_ID}"]`);
    await baldoriaCard.waitFor({ state: "visible", timeout: 45_000 });
    assert(await baldoriaCard.isVisible(), "Baldoria is visible in the normal catalogue");

    const visibleBadge = baldoriaCard.locator(".award-community").first();
    await visibleBadge.waitFor({ state: "visible", timeout: 15_000 });
    const visibleText = (await visibleBadge.innerText()).replace(/\s+/g, " ").trim();
    assert(
      (await visibleBadge.isVisible()) && visibleText.includes(COMMUNITY_LABEL),
      `catalogue visibly renders literal “${COMMUNITY_LABEL}”`,
      `visible badge text was “${visibleText}”`
    );

    const accessibleCard = page.getByRole("button", {
      name: /Baldoria[\s\S]*Detour community selection/,
    });
    assert(
      (await accessibleCard.count()) > 0 && (await accessibleCard.first().isVisible()),
      `catalogue accessibility name exposes literal “${COMMUNITY_LABEL}”`
    );

    const publicCollections = ["venues", "venue_awards", "guide_sources"];
    const missingPublicRequests = publicCollections.filter(
      (collection) => !requestUrls.some((url) => isCollectionRequest(url, collection))
    );
    assert(
      missingPublicRequests.length === 0,
      "browser requests venues, venue_awards, and guide_sources",
      missingPublicRequests.length
        ? `missing ${missingPublicRequests.join(", ")}; captured ${requestUrls.join(" | ")}`
        : ""
    );
    assert(
      !requestUrls.some((url) => isCollectionRequest(url, "detour_submissions")),
      "browser never requests detour_submissions"
    );
  } finally {
    if (browser) await browser.close();
  }
}

async function validatePublicRecords() {
  const venue = await fetchPublicRecord("venues", VENUE_ID);
  assert(
    venue.id === VENUE_ID &&
      venue.name === "Baldoria" &&
      venue.city === "Madrid" &&
      venue.country === "Spain",
    "public Baldoria venue record is exact",
    JSON.stringify({ id: venue.id, name: venue.name, city: venue.city, country: venue.country })
  );

  const source = await fetchPublicRecord("guide_sources", SOURCE_ID);
  assert(
    source.id === SOURCE_ID &&
      source.name === "Detour community" &&
      source.slug === "detour-community" &&
      source.current_year === 2026 &&
      source.official_url === "",
    "public Detour community source record is exact",
    JSON.stringify({
      id: source.id,
      name: source.name,
      slug: source.slug,
      current_year: source.current_year,
      official_url: source.official_url,
    })
  );

  const award = await fetchPublicRecord("venue_awards", AWARD_ID);
  assert(
    award.id === AWARD_ID &&
      award.venue === VENUE_ID &&
      award.source === SOURCE_ID &&
      award.year === 2026 &&
      award.level === COMMUNITY_LABEL &&
      award.current === true &&
      award.verification_status === "verified" &&
      award.source_url === "",
    "public community-selection award record is exact",
    JSON.stringify({
      id: award.id,
      venue: award.venue,
      source: award.source,
      year: award.year,
      level: award.level,
      current: award.current,
      verification_status: award.verification_status,
      source_url: award.source_url,
    })
  );
}

async function validatePrivateIsolation() {
  for (const id of PRIVATE_IDS) {
    const { response, body } = await fetchResponse(
      collectionRecordsUrl("detour_submissions", id)
    );
    assert(
      DENIED_STATUSES.has(response.status) && !disclosesPrivateRecord(body, id),
      `private detour_submissions/${id} is not disclosed`,
      `received HTTP ${response.status}`
    );
  }

  const { response, body, text } = await fetchResponse(
    collectionRecordsUrl("detour_submissions")
  );
  if (DENIED_STATUSES.has(response.status)) {
    assert(true, `anonymous detour_submissions listing is denied (HTTP ${response.status})`);
    return;
  }

  assert(
    response.status === 200 && body !== null && typeof body === "object",
    "anonymous detour_submissions listing is denied or returns JSON",
    `received HTTP ${response.status}: ${text.slice(0, 160)}`
  );
  const items = Array.isArray(body.items) ? body.items : null;
  assert(
    items !== null && items.length === 0 && Number(body.totalItems ?? 0) === 0,
    "anonymous detour_submissions listing contains zero items",
    JSON.stringify({ items: body.items, totalItems: body.totalItems })
  );

  const privateSubmissionFields = new Set([
    "member",
    "venue",
    "venue_name",
    "city",
    "address",
    "detour_note",
    "source_url",
    "status",
    "curator_note",
    "published_venue",
    "published_award",
    "published_at",
    "publication_audit_id",
  ]);
  const forbiddenPath = findForbiddenKey(body, privateSubmissionFields);
  assert(
    forbiddenPath === null,
    "anonymous detour_submissions listing exposes no private fields",
    forbiddenPath ? `found ${forbiddenPath}` : ""
  );
}

async function main() {
  await validateBrowser();
  await validatePublicRecords();
  await validatePrivateIsolation();
  console.log("PASS: live Detour community-selection release is valid");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  if (
    /executable doesn['’]t exist|playwright was just installed|please run.*playwright install/i.test(
      message
    )
  ) {
    console.error(
      'Browser binaries are missing. Run "npx playwright install chromium" or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a Chromium executable, then retry "npm run validate:community-selection-live".'
    );
  }
  process.exitCode = 1;
});

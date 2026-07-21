#!/usr/bin/env node
/**
 * Backfills `venues.image_url` with a cover image for each place, resolved
 * from the venue's own official website (og:image / twitter:image) and, when
 * the site yields nothing, its Instagram profile page as a best-effort
 * fallback (Instagram often refuses anonymous requests; failures are
 * reported, never fatal).
 *
 * Every candidate image URL is verified to actually serve an image before it
 * is written back, so the frontend never stores a dead link.
 *
 * Usage:
 *   PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... \
 *     node scripts/fetch-venue-cover-images.mjs [--dry-run] [--force] [--only=<venueId>]
 *
 * Env:
 *   POCKETBASE_URL          backend base URL (defaults to the production API)
 *   PB_SUPERUSER_EMAIL      superuser email    (required unless --dry-run-local)
 *   PB_SUPERUSER_PASSWORD   superuser password
 *
 * Flags:
 *   --dry-run   resolve and report covers without writing anything
 *   --force     re-resolve venues that already have an image_url
 *   --only=ID   process a single venue record id
 */

const BASE_URL = (process.env.POCKETBASE_URL || "https://sn-pb-repo-1297566350-a88d3c.fly.dev").replace(/\/+$/, "");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const ONLY = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7) || "";

const FETCH_TIMEOUT_MS = 15000;
const BETWEEN_VENUES_MS = 600;
// A realistic browser UA: many restaurant sites (and all of Instagram) serve
// bot-detected requests an empty shell without og tags.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...init,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8",
        "accept-language": "en",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the best-candidate social/cover image URLs out of an HTML document. */
function extractImageCandidates(html, pageUrl) {
  const candidates = [];
  const metaRe = /<meta\s[^>]*>/gi;
  for (const tag of html.match(metaRe) || []) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!property || !content) continue;
    if (property === "og:image:secure_url") candidates.unshift(content);
    else if (property === "og:image" || property === "og:image:url") candidates.push(content);
    else if (property === "twitter:image" || property === "twitter:image:src") candidates.push(content);
  }
  const linkImage = html.match(/<link\s[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
  if (linkImage) candidates.push(linkImage);

  const resolved = [];
  for (const raw of candidates) {
    try {
      const url = new URL(raw.replace(/&amp;/g, "&"), pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") resolved.push(url.href);
    } catch {
      // skip malformed candidate
    }
  }
  return [...new Set(resolved)];
}

/** True when the URL actually serves an image (checked with a 1-byte GET). */
async function servesImage(url) {
  try {
    const response = await fetchWithTimeout(url, { headers: { range: "bytes=0-0" } });
    if (!response.ok && response.status !== 206) return false;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    await response.body?.cancel?.();
    return type.startsWith("image/");
  } catch {
    return false;
  }
}

/** Resolve a verified cover image URL from a venue web page, or ''. */
async function coverFromPage(pageUrl) {
  const response = await fetchWithTimeout(pageUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  for (const candidate of extractImageCandidates(html, response.url || pageUrl)) {
    if (await servesImage(candidate)) return candidate;
  }
  return "";
}

async function authenticate() {
  const email = process.env.PB_SUPERUSER_EMAIL;
  const password = process.env.PB_SUPERUSER_PASSWORD;
  if (!email || !password) fail("PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD are required.");
  const response = await fetchWithTimeout(`${BASE_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!response.ok) fail(`Superuser auth failed: HTTP ${response.status}`);
  const { token } = await response.json();
  return token;
}

async function listVenues(token) {
  const venues = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "200",
      sort: "city,name",
      fields: "id,name,city,official_url,instagram_url,image_url",
    });
    const response = await fetchWithTimeout(`${BASE_URL}/api/collections/venues/records?${params}`, {
      headers: { authorization: token },
    });
    if (!response.ok) fail(`Listing venues failed: HTTP ${response.status}`);
    const data = await response.json();
    venues.push(...(data.items || []));
    if (page >= (data.totalPages || 1)) break;
  }
  return venues;
}

async function saveCover(token, venueId, imageUrl) {
  const response = await fetchWithTimeout(`${BASE_URL}/api/collections/venues/records/${venueId}`, {
    method: "PATCH",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  if (!response.ok) throw new Error(`PATCH failed: HTTP ${response.status}`);
}

const token = await authenticate();
let venues = await listVenues(token);
if (ONLY) venues = venues.filter((venue) => venue.id === ONLY);
const pending = FORCE ? venues : venues.filter((venue) => !venue.image_url);

console.log(`${venues.length} venues on ${BASE_URL}; resolving covers for ${pending.length}${DRY_RUN ? " (dry run)" : ""}.`);

const updated = [];
const skipped = [];
const failed = [];

for (const venue of pending) {
  const label = `${venue.name} (${venue.city})`;
  const sources = [
    venue.official_url && { kind: "official site", url: venue.official_url },
    venue.instagram_url && { kind: "instagram", url: venue.instagram_url },
  ].filter(Boolean);

  if (!sources.length) {
    skipped.push(label);
    console.log(`— ${label}: no official or Instagram URL on record.`);
    continue;
  }

  let cover = "";
  let via = "";
  for (const source of sources) {
    try {
      cover = await coverFromPage(source.url);
      if (cover) {
        via = source.kind;
        break;
      }
    } catch (error) {
      console.log(`  ${label}: ${source.kind} gave no image (${error.message}).`);
    }
  }

  if (!cover) {
    failed.push(label);
    console.log(`✗ ${label}: no usable cover image found.`);
  } else if (DRY_RUN) {
    updated.push(label);
    console.log(`✓ ${label}: would set cover from ${via}: ${cover}`);
  } else {
    try {
      await saveCover(token, venue.id, cover);
      updated.push(label);
      console.log(`✓ ${label}: cover set from ${via}.`);
    } catch (error) {
      failed.push(label);
      console.log(`✗ ${label}: resolved a cover but saving failed (${error.message}).`);
    }
  }
  await sleep(BETWEEN_VENUES_MS);
}

console.log(
  `\nDone. ${updated.length} ${DRY_RUN ? "resolvable" : "updated"}, ` +
    `${skipped.length} without any source URL, ${failed.length} unresolved.`
);
if (skipped.length) console.log(`No source URL: ${skipped.join("; ")}`);
if (failed.length) console.log(`Unresolved: ${failed.join("; ")}`);

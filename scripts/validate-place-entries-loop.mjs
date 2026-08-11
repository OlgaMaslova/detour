#!/usr/bin/env node
/**
 * Focused local validator for the private Detour community waiting-list loop.
 *
 * Runs the real PocketBase 0.39 binary against a fresh temporary data dir,
 * exercises authenticated recommendation/share/publication/delete paths, then
 * removes the migration-history marker with a forward-only down and reapplies
 * the migration over populated collections to verify retry convergence.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pocketbase = process.env.POCKETBASE_BIN || "pocketbase";
const port = 18000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const adminEmail = "community-validator@detour.invalid";
const adminPassword = "CommunityValidator-2026!";
const personalNote =
  "I would return for the thoughtful cooking and genuinely warm neighborhood welcome.";

class ValidationError extends Error {}

function assert(condition, label, detail = "") {
  if (!condition) {
    throw new ValidationError(`${label}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`PASS: ${label}`);
}

function runPocketBase(args, label) {
  const result = spawnSync(pocketbase, args, {
    cwd: repo,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new ValidationError(
      `${label} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result;
}

async function request(path, { method = "GET", token = "", body, expected } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const expectedStatuses = Array.isArray(expected) ? expected : [expected ?? 200];
  if (!expectedStatuses.includes(response.status)) {
    throw new ValidationError(
      `${method} ${path} returned ${response.status}; expected ${expectedStatuses.join(
        ", "
      )}: ${text.slice(0, 800)}`
    );
  }
  return { status: response.status, data };
}

async function waitForReady(serverLogs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await request("/api/detour/ready", { expected: 200 });
      if (result.data?.ok === true) return;
    } catch {
      // Server is still applying migrations or binding its socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new ValidationError(`PocketBase did not become ready:\n${serverLogs.join("")}`);
}

function startServer(dataDir) {
  const logs = [];
  const child = spawn(
    pocketbase,
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--hooksDir=${join(repo, "pb_hooks")}`,
      `--migrationsDir=${join(repo, "pb_migrations")}`,
      `--publicDir=${join(repo, "pb_public")}`,
      "--hooksWatch=false",
    ],
    { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  return { child, logs };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveWait) => server.child.once("exit", resolveWait)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5000)),
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function authenticate(collection, identity, password) {
  const result = await request(`/api/collections/${collection}/auth-with-password`, {
    method: "POST",
    body: { identity, password },
    expected: 200,
  });
  assert(Boolean(result.data?.token), `${collection} authentication succeeds`);
  return result.data.token;
}

async function createMember(adminToken, index, communityStatus = "verified") {
  const email = `community-loop-member-${index}@detour.invalid`;
  const password = `CommunityMember-${index}-2026!`;
  const created = await request("/api/collections/members/records", {
    method: "POST",
    token: adminToken,
    body: {
      email,
      password,
      passwordConfirm: password,
      verified: true,
      display_name: `Community member ${index}`,
      community_status: communityStatus,
      founding_verified: communityStatus === "verified",
    },
    expected: 200,
  });
  const token = await authenticate("members", email, password);
  return { id: created.data.id, token, email };
}

async function getEntry(id, token) {
  return (
    await request(`/api/collections/community_place_entries/records/${id}`, {
      token,
      expected: 200,
    })
  ).data;
}

async function createRecommendation(token, body, expected = 200) {
  return request("/api/collections/community_recommendations/records", {
    method: "POST",
    token,
    body: { note: personalNote, ...body },
    expected,
  });
}

async function main() {
  const version = runPocketBase(["--version"], "PocketBase version check");
  assert(
    /0\.39\.4/.test(version.stdout + version.stderr),
    "validator uses PocketBase 0.39.4",
    (version.stdout + version.stderr).trim()
  );

  const root = await mkdtemp(join(tmpdir(), "detour-community-loop-"));
  const dataDir = join(root, "pb_data");
  let server = null;

  try {
    runPocketBase(
      ["superuser", "create", adminEmail, adminPassword, `--dir=${dataDir}`],
      "superuser creation"
    );

    server = startServer(dataDir);
    await waitForReady(server.logs);
    const adminToken = await authenticate("_superusers", adminEmail, adminPassword);
    const members = [];
    for (let index = 1; index <= 4; index += 1) {
      members.push(await createMember(adminToken, index));
    }
    const unverifiedMember = await createMember(adminToken, 5, "unverified");

    const unverifiedRecommendation = await createRecommendation(
      unverifiedMember.token,
      {
        venue_name: "Unverified Place",
        city: "Validation City",
        country: "Testland",
      },
      [400, 403]
    );
    assert(
      unverifiedRecommendation.status === 400 || unverifiedRecommendation.status === 403,
      "unverified members cannot create recommendation signals"
    );

    const canonical = await request("/api/collections/venues/records", {
      method: "POST",
      token: adminToken,
      body: {
        name: "Café Atlas",
        city: "Validation City",
        country: "Testland",
      },
      expected: 200,
    });

    const first = await createRecommendation(members[0].token, {
      venue_name: "  Cafe   Atlas ",
      city: "validation city",
      country: "Testland",
    });
    const entryId = first.data.entry;
    assert(Boolean(entryId), "first recommendation resolves a waiting-list entry");

    let entry = await getEntry(entryId, members[0].token);
    assert(
      entry.status === "pending" && entry.signal_count === 1,
      "first independent recommendation produces one pending signal",
      JSON.stringify(entry)
    );
    for (const privateField of [
      "participants",
      "normalized_name",
      "normalized_city",
      "canonical_venue",
      "published_venue",
      "published_award",
      "published_at",
      "publication_audit_id",
    ]) {
      assert(!(privateField in entry), `entry response hides ${privateField}`);
    }

    const weakNote = await createRecommendation(
      members[1].token,
      { entry: entryId, note: "Great place" },
      400
    );
    assert(weakNote.status === 400, "non-meaningful recommendation notes are rejected");

    const unverifiedShare = await request("/api/collections/community_shares/records", {
      method: "POST",
      token: unverifiedMember.token,
      body: {
        entry: entryId,
        recipient: members[1].id,
        personal_note: "Please consider this place.",
      },
      expected: [400, 403],
    });
    assert(
      unverifiedShare.status === 400 || unverifiedShare.status === 403,
      "unverified members cannot send shares"
    );

    const selfShare = await request("/api/collections/community_shares/records", {
      method: "POST",
      token: members[0].token,
      body: {
        entry: entryId,
        recipient: members[0].id,
        personal_note: "A note addressed to myself.",
      },
      expected: 400,
    });
    assert(selfShare.status === 400, "self-targeted shares are rejected");

    const invalidRecipientShare = await request(
      "/api/collections/community_shares/records",
      {
        method: "POST",
        token: members[0].token,
        body: {
          entry: entryId,
          recipient: "invalidmember01",
          personal_note: "Please consider this place.",
        },
        expected: 400,
      }
    );
    assert(invalidRecipientShare.status === 400, "invalid share recipients are rejected");

    const forbiddenShare = await request("/api/collections/community_shares/records", {
      method: "POST",
      token: members[3].token,
      body: {
        entry: entryId,
        recipient: members[1].id,
        personal_note: "Please add your own recommendation.",
      },
      expected: 400,
    });
    assert(
      forbiddenShare.status === 400,
      "a nonparticipant cannot share an existing entry",
      JSON.stringify(forbiddenShare.data)
    );

    await request("/api/collections/community_shares/records", {
      method: "POST",
      token: members[0].token,
      body: {
        entry: entryId,
        recipient: members[2].id,
        personal_note: "Please add your own recommendation.",
      },
      expected: 200,
    });
    entry = await getEntry(entryId, members[2].token);
    assert(
      entry.signal_count === 1 && entry.status === "pending",
      "a share adds the recipient as a participant but not as a signal"
    );

    const second = await createRecommendation(members[1].token, {
      venue_name: "CAFÉ ATLAS",
      city: " Validation   City ",
      country: "Testland",
    });
    assert(second.data.entry === entryId, "normalized name and city deduplicate proposals");
    entry = await getEntry(entryId, members[1].token);
    assert(entry.signal_count === 2, "second member produces the second signal");

    const third = await createRecommendation(members[2].token, { entry: entryId });
    assert(third.data.entry === entryId, "shared recipient recommends the linked entry");
    entry = await getEntry(entryId, members[2].token);
    assert(
      entry.signal_count === 3 && entry.status === "published",
      "third independent recommendation auto-publishes without curator approval",
      JSON.stringify(entry)
    );

    // Simulate a response-time publication failure that left the already-saved
    // signals on a pending entry. A duplicate client retry must reconcile and
    // idempotently complete publication before it returns the duplicate error.
    await request(`/api/collections/community_place_entries/records/${entryId}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "pending" },
      expected: 200,
    });
    const duplicate = await createRecommendation(
      members[0].token,
      { entry: entryId },
      400
    );
    assert(
      duplicate.status === 400,
      "duplicate member signal is rejected on retry",
      JSON.stringify(duplicate.data)
    );
    entry = await getEntry(entryId, members[0].token);
    assert(
      entry.status === "published" && entry.signal_count === 3,
      "duplicate retry reconciles and idempotently completes publication"
    );

    const venueFilter = encodeURIComponent(
      `name = "Café Atlas" && city = "Validation City"`
    );
    const venues = await request(
      `/api/collections/venues/records?filter=${venueFilter}&perPage=20`,
      { expected: 200 }
    );
    assert(
      venues.data.totalItems === 1 && venues.data.items[0].id === canonical.data.id,
      "publication reuses exactly one normalized canonical venue",
      JSON.stringify(venues.data.items)
    );

    const sourceFilter = encodeURIComponent(`slug = "detour-community"`);
    const sources = await request(
      `/api/collections/guide_sources/records?filter=${sourceFilter}&perPage=20`,
      { expected: 200 }
    );
    assert(
      sources.data.totalItems === 1 &&
        sources.data.items[0].name === "Detour community" &&
        sources.data.items[0].official_url === "",
      "publication creates or reuses the exact public community source"
    );
    const sourceId = sources.data.items[0].id;

    const awardFilter = encodeURIComponent(
      `source = "${sourceId}" && venue = "${canonical.data.id}" && level = "Detour community selection" && current = true`
    );
    const awards = await request(
      `/api/collections/venue_awards/records?filter=${awardFilter}&perPage=20`,
      { expected: 200 }
    );
    assert(
      awards.data.totalItems === 1 && awards.data.items[0].source_url === "",
      "publication exposes one current community-selection award with blank source URL"
    );
    assert(
      !JSON.stringify([venues.data, sources.data, awards.data]).includes(personalNote),
      "public records contain no member recommendation prose"
    );

    await request(
      `/api/collections/community_recommendations/records/${second.data.id}`,
      { method: "DELETE", token: members[1].token, expected: 204 }
    );
    entry = await getEntry(entryId, members[0].token);
    assert(
      entry.signal_count === 2 && entry.status === "published",
      "post-publication recommendation deletion updates count without auto-unpublishing"
    );
    const awardsAfterDelete = await request(
      `/api/collections/venue_awards/records?filter=${awardFilter}&perPage=20`,
      { expected: 200 }
    );
    assert(
      awardsAfterDelete.data.totalItems === 1,
      "post-publication signal deletion leaves the public selection current"
    );

    const newPlaceName = "Fresh Publication Place";
    const newPlaceFirst = await createRecommendation(members[0].token, {
      venue_name: newPlaceName,
      city: "Validation City",
      country: "Testland",
    });
    const newPlaceSecond = await createRecommendation(members[1].token, {
      venue_name: " fresh  publication place ",
      city: "VALIDATION CITY",
      country: "Testland",
    });
    const newPlaceThird = await createRecommendation(members[3].token, {
      entry: newPlaceFirst.data.entry,
    });
    assert(
      newPlaceSecond.data.entry === newPlaceFirst.data.entry &&
        newPlaceThird.data.entry === newPlaceFirst.data.entry,
      "new non-canonical proposals converge before publication"
    );
    const newPublishedEntry = await getEntry(
      newPlaceFirst.data.entry,
      members[3].token
    );
    assert(
      newPublishedEntry.status === "published" && newPublishedEntry.signal_count === 3,
      "three signals publish a new non-canonical place"
    );
    const newVenueFilter = encodeURIComponent(
      `name = "${newPlaceName}" && city = "Validation City"`
    );
    const newVenues = await request(
      `/api/collections/venues/records?filter=${newVenueFilter}&perPage=20`,
      { expected: 200 }
    );
    assert(
      newVenues.data.totalItems === 1 &&
        newVenues.data.items[0].country === "Testland" &&
        newVenues.data.items[0].address === "" &&
        newVenues.data.items[0].official_url === "",
      "new venue publication uses supplied country and guesses no public details",
      JSON.stringify(newVenues.data.items)
    );

    const queueOnlyShare = await request("/api/collections/community_shares/records", {
      method: "POST",
      token: members[3].token,
      body: {
        recipient: members[1].id,
        personal_note: "This looks worth trying together.",
        venue_name: "Queue Only Place",
        city: "Validation City",
        country: "Testland",
      },
      expected: 200,
    });
    const queueOnlyEntry = await getEntry(queueOnlyShare.data.entry, members[3].token);
    assert(
      queueOnlyEntry.status === "pending" && queueOnlyEntry.signal_count === 0,
      "share without an entry creates a linked queue entry with zero signals"
    );

    const invalidCountry = await createRecommendation(
      members[3].token,
      {
        venue_name: "Country Missing Place",
        city: "Validation City",
      },
      400
    );
    assert(
      /country/i.test(JSON.stringify(invalidCountry.data)),
      "new non-canonical recommendation requires country"
    );

    const privateRead = await request(
      `/api/collections/community_recommendations/records/${first.data.id}`,
      { token: members[3].token, expected: [403, 404] }
    );
    assert(
      privateRead.status === 403 || privateRead.status === 404,
      "another member cannot read someone else's recommendation"
    );

    for (const collection of [
      "community_place_entries",
      "community_recommendations",
      "community_shares",
    ]) {
      const anonymous = await request(`/api/collections/${collection}/records`, {
        expected: [200, 401, 403, 404],
      });
      const disclosed =
        anonymous.status === 200 &&
        (Number(anonymous.data?.totalItems || 0) > 0 ||
          (Array.isArray(anonymous.data?.items) && anonymous.data.items.length > 0));
      assert(!disclosed, `anonymous ${collection} listing discloses no records`);
    }

    await stopServer(server);
    server = null;

    runPocketBase(
      [
        "migrate",
        "down",
        "1",
        `--dir=${dataDir}`,
        `--migrationsDir=${join(repo, "pb_migrations")}`,
      ],
      "forward-only migration history removal"
    );
    runPocketBase(
      [
        "migrate",
        "up",
        `--dir=${dataDir}`,
        `--migrationsDir=${join(repo, "pb_migrations")}`,
      ],
      "retry-safe migration reapply"
    );
    assert(true, "new migration reapplies over populated collections without data loss");

    server = startServer(dataDir);
    await waitForReady(server.logs);
    const retainedAdminToken = await authenticate(
      "_superusers",
      adminEmail,
      adminPassword
    );
    const retained = await request(
      `/api/collections/community_place_entries/records/${entryId}`,
      { token: retainedAdminToken, expected: 200 }
    );
    assert(
      retained.data.status === "published" && retained.data.signal_count === 2,
      "retry reapply preserves existing workflow records and publication state"
    );

    console.log("PASS: local Detour community waiting-list workflow is valid");
  } finally {
    await stopServer(server);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.stack || error.message : error}`);
  process.exitCode = 1;
});

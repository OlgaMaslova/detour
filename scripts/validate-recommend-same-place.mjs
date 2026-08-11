#!/usr/bin/env node
/**
 * Focused local regression for the place-page "Been here too?" path.
 *
 * Runs the real PocketBase binary with fresh data, publishes a place from one
 * verified member, then proves a second verified member can recommend that
 * same published entry while a duplicate from either member stays rejected.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pocketbase = process.env.POCKETBASE_BIN || join(repo, "pocketbase");
const port = 19000 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const adminEmail = "same-place-validator@detour.invalid";
const adminPassword = "SamePlaceValidator-2026!";
const note = "The warm service and precise seasonal cooking make this worth returning to.";

class ValidationError extends Error {}

function assert(condition, label, detail = "") {
  if (!condition) throw new ValidationError(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`PASS: ${label}`);
}

function runPocketBase(args, label) {
  const result = spawnSync(pocketbase, args, { cwd: repo, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new ValidationError(`${label} failed\n${result.stdout}\n${result.stderr}`);
  }
}

async function request(path, { method = "GET", token = "", body, expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new ValidationError(
      `${method} ${path} returned ${response.status}; expected ${statuses.join(", ")}: ${text.slice(0, 800)}`
    );
  }
  return { status: response.status, data };
}

async function waitForReady(logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/detour/ready");
      if (response.data?.ok === true) return;
    } catch {
      // Migrations are still running or the socket is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new ValidationError(`PocketBase did not become ready:\n${logs.join("")}`);
}

async function authenticate(collection, identity, password) {
  const response = await request(`/api/collections/${collection}/auth-with-password`, {
    method: "POST",
    body: { identity, password },
  });
  return response.data.token;
}

async function createMember(adminToken, index) {
  const email = `same-place-member-${index}@detour.invalid`;
  const password = `SamePlaceMember-${index}-2026!`;
  await request("/api/collections/members/records", {
    method: "POST",
    token: adminToken,
    body: {
      email,
      password,
      passwordConfirm: password,
      verified: true,
      display_name: `Same-place member ${index}`,
      community_status: "verified",
      founding_verified: true,
    },
  });
  return authenticate("members", email, password);
}

async function recommend(token) {
  return request("/api/collections/community_recommendations/records", {
    method: "POST",
    token,
    body: {
      venue_name: "Same Place Validation Café",
      address: "1 Validation Way",
      city: "Validation City",
      country: "Testland",
      note,
    },
  });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "detour-same-place-"));
  const dataDir = join(root, "pb_data");
  let server;
  try {
    runPocketBase(
      ["superuser", "create", adminEmail, adminPassword, `--dir=${dataDir}`],
      "superuser creation"
    );
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
    server = child;
    await waitForReady(logs);

    const adminToken = await authenticate("_superusers", adminEmail, adminPassword);
    const firstMember = await createMember(adminToken, 1);
    const secondMember = await createMember(adminToken, 2);

    const first = await recommend(firstMember);
    assert(Boolean(first.data?.entry), "first recommendation resolves the shared place");

    const firstEntry = await request(
      `/api/collections/community_place_entries/records/${first.data.entry}`,
      { token: firstMember }
    );
    assert(
      firstEntry.data.status === "published" && firstEntry.data.signal_count === 1,
      "the first member publishes the place with one signal",
      JSON.stringify(firstEntry.data)
    );

    const second = await recommend(secondMember);
    assert(second.data.entry === first.data.entry, "the second member reuses the same published place");

    const secondEntry = await request(
      `/api/collections/community_place_entries/records/${first.data.entry}`,
      { token: secondMember }
    );
    assert(
      secondEntry.data.status === "published" && secondEntry.data.signal_count === 2,
      "the published place records both distinct recommendations",
      JSON.stringify(secondEntry.data)
    );

    const duplicate = await request("/api/collections/community_recommendations/records", {
      method: "POST",
      token: secondMember,
      body: {
        venue_name: "Same Place Validation Café",
        city: "Validation City",
        country: "Testland",
        note,
      },
      expected: 400,
    });
    assert(duplicate.status === 400, "one member still cannot recommend the same place twice");
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolveWait) => server.once("exit", resolveWait)),
        new Promise((resolveWait) => setTimeout(resolveWait, 5000)),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

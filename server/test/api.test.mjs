import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLeaderboardServer } from "../app.mjs";

const adminCode = "a-test-admin-secret";
const allowedOrigin = "http://localhost:5173";
const fallbackNames = new Set([
  "StarDestroyer", "SolarVoyager", "NebulaRider", "CometPilot",
  "OrbitGuardian", "LunarRanger", "CosmicExplorer", "NovaCaptain",
]);

function run(id, changes = {}) {
  return {
    runId: id,
    revision: 1,
    score: 2500,
    credits: 340,
    wave: 4,
    level: 6,
    stage: "sectors",
    status: "active",
    durationSeconds: 137,
    sector: 2,
    primary: "pulse",
    weapons: { pulse: 3, spread: 1 },
    upgrades: { overclock: 2, armor: 1 },
    deathCause: null,
    assisted: false,
    drone: { purchased: true, weapon: "spread", upgrades: { twinCannons: 1 } },
    ...changes,
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "helio-leaderboard-test-"));
  const configuration = {
    databasePath: join(directory, "leaderboard.sqlite"),
    adminCode,
    allowedOrigins: [allowedOrigin],
    production: false,
    ...options,
  };
  let app;
  let baseUrl;
  async function start() {
    app = createLeaderboardServer(configuration);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    baseUrl = `http://127.0.0.1:${app.server.address().port}/api`;
  }
  await start();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { method = "GET", token, body, rawBody, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined && rawBody === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(rawBody === undefined ? (body === undefined ? {} : { body: JSON.stringify(body) }) : { body: rawBody }),
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, headers: response.headers, data };
  }
  async function player(username = "CometPilot") {
    const response = await request("/players", { method: "POST", body: { username } });
    assert.ok([200, 201].includes(response.status), JSON.stringify(response.data));
    assert.equal(typeof response.data.playerId, "string");
    assert.equal(typeof response.data.playerToken, "string");
    return response.data;
  }
  async function submit(identity, report) {
    return request(`/runs/${report.runId}`, {
      method: "PUT", token: identity.playerToken, body: report,
    });
  }
  async function admin() {
    const response = await request("/admin/session", { method: "POST", body: { code: adminCode } });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(typeof response.data.token, "string");
    assert.ok(Number.isFinite(Date.parse(response.data.expiresAt)));
    return response.data;
  }
  return {
    request, player, submit, admin,
    async restart() {
      await app.close();
      await start();
    },
  };
}

test("identities and global runs survive a server restart without exposing credentials", async (t) => {
  const api = await fixture(t);
  assert.equal((await api.request("/health")).status, 200);
  const identity = await api.player("Solar Ace");
  const report = run("persisted_run_0001");
  assert.deepEqual((await api.submit(identity, report)).data, { accepted: true });

  await api.restart();
  const renamed = await api.request("/players/me", {
    method: "PATCH", token: identity.playerToken, body: { username: "Solar Captain" },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.username, "Solar Captain");
  assert.deepEqual((await api.submit(identity, { ...report, revision: 2, wave: 5 })).data, { accepted: true });

  const page = await api.request("/leaderboard");
  assert.equal(page.status, 200);
  assert.equal(page.data.total, 1);
  assert.equal(page.data.entries[0].username, "Solar Captain");
  assert.equal(page.data.entries[0].wave, 5);
  assert.equal(page.data.entries[0].rank, 1);
  assert.ok(!JSON.stringify(page.data).includes(identity.playerToken));
  assert.ok(!JSON.stringify(page.data).includes("playerToken"));
  assert.ok(Number.isFinite(Date.parse(page.data.updatedAt)));
});

test("the global board ranks each player's furthest run with MK6 stages and stable pagination", async (t) => {
  const api = await fixture(t);
  const sectorPilot = await api.player("Sector Pilot");
  const mk6Pilot = await api.player("MK6 Pilot");
  const clearPilot = await api.player("Clear Pilot");
  const scorePilot = await api.player("Score Pilot");
  const creditPilot = await api.player("Credit Pilot");
  const tiedPilot = await api.player("Tie Pilot");
  const entries = [
    [sectorPilot, run("sector_weaker_001", { wave: 9, score: 999999, credits: 999999 })],
    [sectorPilot, run("sector_strong_001", { wave: 10, score: 100, credits: 20 })],
    [mk6Pilot, run("mk6_boss_run_0001", { stage: "mk6", wave: 1, sector: 7, score: 1, credits: 1 })],
    [clearPilot, run("mk6_clear_run_001", { stage: "mk6-cleared", status: "victory", wave: 1, sector: 7, score: 0, credits: 0 })],
    [scorePilot, run("score_winner_0001", { wave: 10, score: 101, credits: 0 })],
    [creditPilot, run("credit_winner_001", { wave: 10, score: 100, credits: 21 })],
    [tiedPilot, run("z_tied_sector_001", { wave: 10, score: 100, credits: 20 })],
  ];
  for (const [identity, report] of entries) {
    const response = await api.submit(identity, report);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.accepted, true);
  }
  const first = await api.request("/leaderboard?offset=0&limit=3");
  const second = await api.request("/leaderboard?offset=3&limit=3");
  assert.equal(first.data.total, 6);
  assert.equal(second.data.total, 6);
  assert.deepEqual([...first.data.entries, ...second.data.entries].map((entry) => entry.id), [
    "mk6_clear_run_001", "mk6_boss_run_0001", "score_winner_0001",
    "credit_winner_001", "sector_strong_001", "z_tied_sector_001",
  ]);
  assert.deepEqual([...first.data.entries, ...second.data.entries].map((entry) => entry.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual((await api.request("/leaderboard?offset=6&limit=3")).data.entries, []);
});

test("name moderation replaces profanity and common evasions on registration and renaming", async (t) => {
  const api = await fixture(t);
  for (const username of ["fuck", "sh1t", "f.u.c.k", "bіtch", "n1gg3r", "n-i-g-g-a", "fuuuuuck"]) {
    const identity = await api.player(username);
    assert.ok(fallbackNames.has(identity.username), `${username} was not replaced`);
  }
  const identity = await api.player("  Star Pilot  ");
  assert.equal(identity.username, "Star Pilot");
  const renamed = await api.request("/players/me", {
    method: "PATCH", token: identity.playerToken, body: { username: "$h!t" },
  });
  assert.equal(renamed.status, 200);
  assert.ok(fallbackNames.has(renamed.data.username));
});

test("run ownership and revision rules stop other players and late reports from replacing a final run", async (t) => {
  const api = await fixture(t);
  const owner = await api.player("Run Owner");
  const stranger = await api.player("Other Pilot");
  const report = run("owned_run_000001");
  assert.equal((await api.request(`/runs/${report.runId}`, { method: "PUT", body: report })).status, 401);
  assert.equal((await api.submit(owner, report)).data.accepted, true);
  assert.ok([403, 409].includes((await api.submit(stranger, { ...report, revision: 2, score: 9999 })).status));
  assert.equal((await api.submit(owner, report)).data.accepted, false);
  const finalReport = { ...report, revision: 3, status: "dead", deathCause: "MK6 plasma barrage", score: 3000 };
  assert.equal((await api.submit(owner, finalReport)).data.accepted, true);
  assert.equal((await api.submit(owner, { ...report, revision: 2 })).data.accepted, false);
  assert.equal((await api.submit(owner, { ...report, revision: 4, wave: 999 })).data.accepted, false);
  const entry = (await api.request("/leaderboard")).data.entries[0];
  assert.equal(entry.score, 3000);
  assert.equal(entry.status, "dead");
});

test("moderation requires a valid server session and exposes full run detail only to developers", async (t) => {
  const api = await fixture(t);
  const identity = await api.player("Detailed Pilot");
  const report = run("detailed_run_0001", { status: "dead", deathCause: "Mine explosion", assisted: true });
  await api.submit(identity, report);
  const path = `/admin/runs/${report.runId}`;
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const body = method === "PATCH" ? { score: 1 } : undefined;
    assert.equal((await api.request(path, { method, body })).status, 401);
    assert.equal((await api.request(path, { method, token: identity.playerToken, body })).status, 401);
  }
  assert.equal((await api.request("/admin/session", { method: "POST", body: { code: "incorrect-code" } })).status, 401);
  const session = await api.admin();
  const detail = await api.request(path, { token: session.token });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data.report, report);
  assert.equal(detail.data.username, identity.username);
  assert.ok(Number.isFinite(Date.parse(detail.data.createdAt)));
  assert.ok(!JSON.stringify(detail.data).includes(identity.playerToken));
  assert.ok(!JSON.stringify(detail.data).includes(session.token));
  assert.ok(!JSON.stringify(detail.data).includes(adminCode));
  assert.ok(!("report" in (await api.request("/leaderboard")).data.entries[0]));
  const logout = await api.request("/admin/session", { method: "DELETE", token: session.token });
  assert.ok([200, 204].includes(logout.status));
  assert.equal((await api.request(path, { token: session.token })).status, 401);
});

test("developer edits persist and lock the record against later player reports", async (t) => {
  const api = await fixture(t);
  const identity = await api.player("Original Pilot");
  const report = run("moderated_run_001");
  await api.submit(identity, report);
  const session = await api.admin();
  const edited = await api.request(`/admin/runs/${report.runId}`, {
    method: "PATCH", token: session.token,
    body: { username: "Renamed Pilot", score: 1200, credits: 30, wave: 3, level: 4, status: "dead" },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.entry.username, "Renamed Pilot");
  assert.equal(edited.data.entry.score, 1200);
  assert.equal((await api.submit(identity, { ...report, revision: 2, wave: 999 })).data.accepted, false);
  const detail = await api.request(`/admin/runs/${report.runId}`, { token: session.token });
  assert.equal(detail.data.moderated, true);
  assert.equal(detail.data.report.score, 1200);
  assert.equal(detail.data.report.wave, 3);
  await api.restart();
  const page = await api.request("/leaderboard");
  assert.equal(page.data.entries[0].username, "Renamed Pilot");
  assert.equal(page.data.entries[0].score, 1200);
  const renamed = await api.request("/players/me", {
    method: "PATCH", token: identity.playerToken, body: { username: "Future Pilot" },
  });
  assert.equal(renamed.status, 200);
  assert.equal((await api.request("/leaderboard")).data.entries[0].username, "Renamed Pilot");
  const nextReport = run("future_named_run_1", { wave: 5 });
  assert.equal((await api.submit(identity, nextReport)).data.accepted, true);
  assert.equal((await api.request("/leaderboard")).data.entries[0].username, "Future Pilot");
});

test("removed runs remain removed when queued reports retry, including after restart", async (t) => {
  const api = await fixture(t);
  const identity = await api.player("Deleted Pilot");
  const report = run("deleted_run_0001");
  await api.submit(identity, report);
  const session = await api.admin();
  const removed = await api.request(`/admin/runs/${report.runId}`, { method: "DELETE", token: session.token });
  assert.ok([200, 204].includes(removed.status));
  assert.equal((await api.request("/leaderboard")).data.total, 0);
  assert.equal((await api.submit(identity, { ...report, revision: 2 })).data.accepted, false);
  assert.equal((await api.request(`/admin/runs/${report.runId}`, { token: session.token })).status, 404);
  await api.restart();
  assert.equal((await api.submit(identity, { ...report, revision: 3 })).data.accepted, false);
  assert.equal((await api.request("/leaderboard")).data.total, 0);
});

test("expired developer sessions cannot change records", async (t) => {
  let currentTime = Date.UTC(2026, 9, 7);
  const api = await fixture(t, { now: () => currentTime });
  const identity = await api.player("Session Pilot");
  const report = run("expired_run_0001");
  await api.submit(identity, report);
  const session = await api.admin();
  currentTime = Date.parse(session.expiresAt) + 1;
  assert.equal((await api.request(`/admin/runs/${report.runId}`, {
    method: "DELETE", token: session.token,
  })).status, 401);
  assert.equal((await api.request("/leaderboard")).data.total, 1);
});

test("normal victory can advance into MK6 while assisted status and progress remain truthful", async (t) => {
  const api = await fixture(t);
  const identity = await api.player("Victory Pilot");
  const report = run("victory_to_mk6_01", { status: "victory", assisted: true, wave: 20, sector: 6 });
  assert.equal((await api.submit(identity, report)).data.accepted, true);
  const bossReport = { ...report, revision: 2, stage: "mk6", status: "active", wave: 21, sector: 7, credits: 10, assisted: false };
  assert.equal((await api.submit(identity, bossReport)).data.accepted, true);
  const page = (await api.request("/leaderboard")).data;
  assert.equal(page.entries[0].stage, "mk6");
  assert.equal(page.entries[0].credits, 10);
  assert.equal(page.entries[0].assisted, true);
  assert.equal((await api.submit(identity, { ...bossReport, revision: 3, wave: 20 })).status, 400);
  assert.equal((await api.submit(identity, { ...bossReport, revision: 3, score: 1 })).status, 400);
  assert.equal((await api.submit(identity, { ...bossReport, revision: 3, durationSeconds: 1 })).status, 400);
  assert.equal((await api.submit(identity, { ...bossReport, revision: 3, stage: "sectors" })).status, 400);
  const clearedReport = { ...bossReport, revision: 4, stage: "mk6-cleared", status: "victory" };
  assert.equal((await api.submit(identity, clearedReport)).data.accepted, true);
  assert.equal((await api.submit(identity, { ...clearedReport, revision: 5, wave: 999 })).data.accepted, false);
});

test("invalid run data, edits, and pagination are rejected without altering the board", async (t) => {
  const api = await fixture(t);
  const identity = await api.player("Validation Pilot");
  const report = run("validation_run_01");
  for (const changes of [
    { score: -1 }, { credits: 1.5 }, { wave: 0 }, { level: Number.MAX_SAFE_INTEGER },
    { sector: 8 }, { revision: 0 }, { durationSeconds: -1 }, { assisted: "yes" },
    { primary: "unknown" }, { weapons: { spread: 1 } },
    { weapons: { pulse: 1, injectedWeapon: 1 } }, { upgrades: { injectedUpgrade: 1 } },
    { upgrades: { armor: -1 } }, { drone: { purchased: true, weapon: "unknown", upgrades: {} } },
    { deathCause: "invalid\nnewline" }, { stage: "mk6-cleared", status: "active" },
  ]) {
    const response = await api.submit(identity, { ...report, ...changes });
    assert.equal(response.status, 400, `Accepted ${JSON.stringify(changes)}`);
  }
  for (const body of [null, [], "invalid"]) {
    assert.equal((await api.request(`/runs/${report.runId}`, {
      method: "PUT", token: identity.playerToken, body,
    })).status, 400);
  }
  assert.equal((await api.request(`/runs/${report.runId}`, {
    method: "PUT", token: identity.playerToken, rawBody: '{"invalid":',
  })).status, 400);
  assert.equal((await api.request(`/runs/${report.runId}`, {
    method: "PUT", token: identity.playerToken, body: report,
    headers: { "Content-Type": "text/plain" },
  })).status, 415);
  assert.equal((await api.request(`/runs/${report.runId}`, {
    method: "PUT", token: identity.playerToken, body: { ...report, extra: "x".repeat(17_000) },
  })).status, 413);
  assert.equal((await api.request(`/runs/${report.runId}`, {
    method: "PUT", token: identity.playerToken, body: { ...report, runId: "mismatched_run_01" },
  })).status, 400);
  assert.equal((await api.request("/leaderboard")).data.total, 0);
  assert.equal((await api.submit(identity, report)).data.accepted, true);
  const session = await api.admin();
  for (const body of [{}, { score: -1 }, { unknown: true }, { username: "a".repeat(161) }]) {
    assert.equal((await api.request(`/admin/runs/${report.runId}`, {
      method: "PATCH", token: session.token, body,
    })).status, 400);
  }
  for (const query of ["offset=-1", "limit=0", "offset=nope", "limit=1000000"]) {
    assert.equal((await api.request(`/leaderboard?${query}`)).status, 400);
  }
  assert.equal((await api.request("/leaderboard")).data.entries[0].score, report.score);
});

test("CORS grants the configured game origin without reflecting arbitrary origins", async (t) => {
  const api = await fixture(t);
  const allowed = await api.request("/leaderboard", { headers: { Origin: allowedOrigin } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);
  const denied = await api.request("/leaderboard", { headers: { Origin: "https://untrusted.example" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.ok(denied.status < 500);
  const preflight = await api.request("/runs/preflight_run_01", {
    method: "OPTIONS", headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.ok([200, 204].includes(preflight.status));
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.match(preflight.headers.get("access-control-allow-methods"), /PUT/);
});

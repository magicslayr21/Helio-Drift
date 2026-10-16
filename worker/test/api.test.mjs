import assert from "node:assert/strict";
import test from "node:test";
import { leaderboardContract, run } from "../../server/test/contract.mjs";
import { fixture } from "./fixture.mjs";

leaderboardContract(fixture);

test("co-op records are ranked separately without changing single-player rows", async (t) => {
  const api = await fixture(t);
  const timestamp = "2026-10-12T02:00:00.000Z";
  await api.db.batch([
    api.db
      .prepare(
        `INSERT INTO coop_runs VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "coop-loss",
        "AAA234",
        "Nova",
        "Vega",
        90_000,
        24,
        5,
        1500,
        4,
        "defeat",
        0,
        timestamp,
        timestamp,
      ),
    api.db
      .prepare(
        `INSERT INTO coop_runs VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "coop-win",
        "BBB234",
        "Alpha",
        "Bravo",
        70_000,
        25,
        5,
        1800,
        5,
        "victory",
        1,
        timestamp,
        timestamp,
      ),
  ]);

  const board = await api.request("/leaderboard/coop?limit=10");
  assert.equal(board.status, 200);
  assert.equal(board.data.total, 2);
  assert.equal(board.data.entries[0].id, "coop-win");
  assert.deepEqual(
    [board.data.entries[0].playerOne, board.data.entries[0].playerTwo],
    ["Alpha", "Bravo"],
  );
  assert.equal(board.data.entries[0].completed, true);
  assert.equal((await api.request("/leaderboard")).data.total, 0);
});

test("two players racing to create a run cannot take ownership from each other", async (t) => {
  const api = await fixture(t);
  const first = await api.player("First Pilot");
  const second = await api.player("Second Pilot");
  const report = run("simultaneous_claim_1");
  const results = await Promise.all([api.submit(first, report), api.submit(second, report)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 403]);
  const board = await api.request("/leaderboard");
  assert.equal(board.data.total, 1);
  assert.equal(
    board.data.entries[0].playerId,
    results[0].status === 200 ? first.playerId : second.playerId,
  );
});

test("scheduled cleanup deletes only expired sessions and rate limit buckets", async (t) => {
  const api = await fixture(t);
  await api.admin();
  await api.db.batch([
    api.db.prepare("INSERT INTO admin_sessions VALUES ('expired-session', 0)"),
    api.db.prepare("INSERT INTO rate_limits VALUES ('expired-bucket', 1, 0)"),
  ]);
  await api.scheduled();
  assert.equal(
    (await api.db.prepare("SELECT COUNT(*) AS total FROM admin_sessions").first()).total,
    1,
  );
  assert.equal(
    (await api.db.prepare("SELECT COUNT(*) AS total FROM rate_limits").first()).total,
    1,
  );
});

test("simultaneous run revisions retain the newest score and reject a competing owner", async (t) => {
  const api = await fixture(t);
  const owner = await api.player("Owner Pilot");
  const other = await api.player("Other Pilot");
  const report = run("concurrent_run_001");
  await api.submit(owner, report);
  const updates = await Promise.all(
    [2, 3, 4, 5].map((revision) =>
      api.submit(owner, { ...report, revision, score: revision * 2500 }),
    ),
  );
  assert.ok(
    updates.every((result) => result.status === 200),
    JSON.stringify(updates),
  );
  assert.equal((await api.submit(other, { ...report, revision: 6 })).status, 403);
  const board = await api.request("/leaderboard");
  assert.equal(board.data.entries[0].score, 12500);
  assert.equal(board.data.entries[0].playerId, owner.playerId);
});

test("concurrent deletion and submissions cannot resurrect a run", async (t) => {
  const api = await fixture(t);
  const owner = await api.player();
  const report = run("concurrent_delete_1");
  await api.submit(owner, report);
  const session = await api.admin();
  await Promise.all([
    api.submit(owner, { ...report, revision: 2, score: 5000 }),
    api.request(`/admin/runs/${report.runId}`, { method: "DELETE", token: session.token }),
  ]);
  assert.equal(
    (await api.submit(owner, { ...report, revision: 3, score: 10000 })).data.accepted,
    false,
  );
  assert.equal((await api.request("/leaderboard")).data.total, 0);
});

test("developer login rate limiting survives Worker restart and does not store raw IPs", async (t) => {
  const api = await fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal(
      (await api.request("/admin/session", { method: "POST", body: { code: "wrong" } })).status,
      401,
    );
  }
  await api.restart();
  const result = await api.request("/admin/session", {
    method: "POST",
    body: { code: "a-test-admin-secret" },
  });
  assert.equal(result.status, 429);
  assert.ok(result.headers.get("retry-after"));
  const { results } = await api.db.prepare("SELECT key FROM rate_limits").all();
  assert.ok(results.every((row) => /^[0-9a-f]{64}$/.test(row.key)));
});

test("missing or weak moderation secrets leave the Worker unavailable", async (t) => {
  for (const code of ["", "dev", "too-short"]) {
    const api = await fixture(t, { LEADERBOARD_ADMIN_CODE: code });
    assert.equal((await api.request("/health")).status, 503);
    assert.equal(
      (await api.request("/players", { method: "POST", body: { username: "Pilot" } })).status,
      503,
    );
  }
});

test("co-op moderation authenticates, reads legacy stats, edits rankings and hides deleted runs", async (t) => {
  const api = await fixture(t);
  const stamp = "2026-10-15T01:00:00.000Z";
  for (const [id, wave, score] of [
    ["coop-admin-old", 20, 1000],
    ["coop-admin-new", 25, 2000],
  ]) {
    await api.db
      .prepare("INSERT INTO coop_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, "ABC234", "Alpha", "Bravo", score, wave, 5, 1500, 4, "defeat", 0, stamp, stamp)
      .run();
  }
  const path = "/admin/coop-runs/coop-admin-old";
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal(
      (
        await api.request(path, {
          method,
          body: method === "PATCH" ? { revision: 0, score: 999 } : undefined,
        })
      ).status,
      401,
    );
  const session = await api.admin();
  const options = { token: session.token };
  const old = await api.request(path, options);
  assert.equal(old.status, 200);
  assert.equal(old.data.telemetry, null);
  assert.equal(old.data.wave, 20);
  assert.equal(old.data.rank, 2);
  const edited = await api.request(path, {
    ...options,
    method: "PATCH",
    body: {
      revision: 0,
      playerOne: "Renamed Pilot",
      score: 9999,
      wave: 26,
      status: "victory",
      bossesDefeated: 6,
    },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.entry.moderated, true);
  assert.equal(edited.data.entry.revision, 1);
  let board = await api.request("/leaderboard/coop");
  assert.equal(board.data.entries[0].id, "coop-admin-old");
  assert.equal(board.data.entries[0].playerOne, "Renamed Pilot");
  assert.equal(board.data.entries[0].completed, true);
  assert.equal(
    (await api.request(path, { ...options, method: "PATCH", body: { revision: 0, score: 1 } }))
      .status,
    409,
  );
  for (const body of [
    { revision: 1, score: -1 },
    { revision: 1, status: "active" },
    { revision: 1, sector: 8 },
    { revision: 1, unknown: 123 },
    { score: 10 },
  ])
    assert.equal((await api.request(path, { ...options, method: "PATCH", body })).status, 400);
  assert.equal((await api.request(path, { ...options, method: "DELETE" })).status, 200);
  board = await api.request("/leaderboard/coop");
  assert.equal(board.data.total, 1);
  assert.equal(board.data.entries[0].rank, 1);
  assert.equal((await api.request(path, options)).status, 404);
  assert.equal(
    (await api.db.prepare("SELECT score FROM coop_runs WHERE id = 'coop-admin-old'").first()).score,
    9999,
  );
  assert.equal((await api.request("/leaderboard")).data.total, 0);
  await api.expireSessions();
  assert.equal((await api.request("/admin/coop-runs/coop-admin-new", options)).status, 401);
});

test("concurrent co-op edits cannot overwrite each other or resurrect a deleted record", async (t) => {
  const api = await fixture(t);
  const stamp = "2026-10-15T01:00:00.000Z";
  await api.db
    .prepare("INSERT INTO coop_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      "coop-concurrent",
      "ABC234",
      "Alpha",
      "Bravo",
      1000,
      20,
      5,
      1500,
      4,
      "defeat",
      0,
      stamp,
      stamp,
    )
    .run();
  const session = await api.admin();
  const path = "/admin/coop-runs/coop-concurrent";
  const responses = await Promise.all(
    [2000, 3000].map((score) =>
      api.request(path, { method: "PATCH", token: session.token, body: { revision: 0, score } }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await Promise.all([
    api.request(path, { method: "DELETE", token: session.token }),
    api.request(path, {
      method: "PATCH",
      token: session.token,
      body: { revision: 1, score: 4000 },
    }),
  ]);
  assert.equal((await api.request("/leaderboard/coop")).data.total, 0);
});

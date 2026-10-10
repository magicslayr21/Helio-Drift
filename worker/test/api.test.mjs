import assert from "node:assert/strict";
import test from "node:test";
import { leaderboardContract, run } from "../../server/test/contract.mjs";
import { fixture } from "./fixture.mjs";

leaderboardContract(fixture);

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

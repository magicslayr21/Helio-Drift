import assert from "node:assert/strict";
import test from "node:test";
import { writeCoopResult } from "../results.mjs";
import { multiplayerFixture } from "./fixture.mjs";

function finishedRoom() {
  return {
    matchId: "authoritative-match-001",
    code: "ABC234",
    createdAt: Date.parse("2026-10-12T01:00:00.000Z"),
    finishedAt: Date.parse("2026-10-12T01:28:43.000Z"),
    players: {
      p1: { callsign: "Alpha" },
      p2: { callsign: "Bravo" },
    },
    match: {
      players: {
        p1: { callsign: "Alpha" },
        p2: { callsign: "Bravo" },
      },
      team: {
        score: 98_765.8,
        wave: 25,
        sector: 5,
        elapsedSeconds: 1723.9,
        bossesDefeated: 5,
      },
    },
  };
}

test("authoritative co-op results are idempotent and retain the first completed record", async (t) => {
  const app = await multiplayerFixture(t);
  const room = finishedRoom();
  const first = await writeCoopResult(app.db, room, "victory");
  assert.equal(first.score, 98_765);
  assert.equal(first.completed, 1);

  room.match.team.score = 1;
  await writeCoopResult(app.db, room, "defeat");
  const rows = await app.db.prepare("SELECT * FROM coop_runs").all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].score, 98_765);
  assert.equal(rows.results[0].status, "victory");
  assert.equal(rows.results[0].player_one, "Alpha");
  assert.equal(rows.results[0].player_two, "Bravo");
});

test("co-op pilot telemetry is retained and result retries cannot restore moderated records", async (t) => {
  const app = await multiplayerFixture(t);
  const room = finishedRoom();
  const pilot = (name) => ({
    callsign: name,
    level: 8,
    credits: 120,
    ship: { hull: 60, maxHull: 100, primary: "pulse", weapons: { pulse: 3 } },
    upgrades: { crit: 2 },
    stats: {
      damage: 1200,
      kills: 12,
      asteroidKills: 8,
      bossDamage: 400,
      revives: 1,
      creditsCollected: 500,
    },
    drone: { purchased: true, weapon: "pulse", upgrades: { scan: 2 } },
  });
  room.match.players = { p1: pilot("Alpha"), p2: pilot("Bravo") };
  await writeCoopResult(app.db, room, "victory");
  const row = await app.db
    .prepare("SELECT * FROM coop_run_details WHERE run_id = ?")
    .bind(room.matchId)
    .first();
  const telemetry = JSON.parse(row.telemetry_json);
  assert.equal(telemetry.pilots.p1.stats.revives, 1);
  assert.equal(telemetry.pilots.p2.weapons.pulse, 3);
  assert.equal(telemetry.pilots.p1.drone.upgrades.scan, 2);
  await app.db
    .prepare("UPDATE coop_run_details SET deleted=1, moderated=1, revision=1 WHERE run_id=?")
    .bind(room.matchId)
    .run();
  room.match.players.p1.stats.revives = 999;
  await writeCoopResult(app.db, room, "defeat");
  const retained = await app.db
    .prepare("SELECT * FROM coop_run_details WHERE run_id=?")
    .bind(room.matchId)
    .first();
  assert.equal(retained.deleted, 1);
  assert.equal(retained.revision, 1);
  assert.equal(JSON.parse(retained.telemetry_json).pilots.p1.stats.revives, 1);
});

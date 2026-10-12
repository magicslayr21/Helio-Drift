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

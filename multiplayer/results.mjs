const RESULT_STATUSES = new Set(["victory", "defeat", "abandoned"]);

export function coopResultFromRoom(room, status) {
  if (!room?.match || !RESULT_STATUSES.has(status)) throw new Error("Co-op result is invalid.");
  const match = room.match;
  const finishedAt = room.finishedAt ?? Date.now();
  return {
    id: room.matchId,
    roomCode: room.code,
    playerOne: room.players.p1?.callsign ?? match.players.p1.callsign,
    playerTwo: room.players.p2?.callsign ?? match.players.p2.callsign,
    score: Math.max(0, Math.floor(match.team.score)),
    wave: Math.max(0, Math.floor(match.team.wave)),
    sector: Math.max(0, Math.floor(match.team.sector)),
    durationSeconds: Math.max(0, Math.floor(match.team.elapsedSeconds)),
    bossesDefeated: Math.max(0, Math.floor(match.team.bossesDefeated)),
    status,
    completed: status === "victory" ? 1 : 0,
    createdAt: new Date(room.createdAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
  };
}

/** Only the authoritative MatchRoom calls this; clients have no result-write route. */
export async function writeCoopResult(db, room, status) {
  const result = coopResultFromRoom(room, status);
  const insert = db
    .prepare(
      `INSERT OR IGNORE INTO coop_runs
        (id, room_code, player_one, player_two, score, wave, sector, duration_seconds,
          bosses_defeated, status, completed, created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      result.id,
      result.roomCode,
      result.playerOne,
      result.playerTwo,
      result.score,
      result.wave,
      result.sector,
      result.durationSeconds,
      result.bossesDefeated,
      result.status,
      result.completed,
      result.createdAt,
      result.finishedAt,
    );
  const hasTelemetry = Object.values(room.match.players).every((p) => p.ship && p.drone && p.stats);
  const pilots = hasTelemetry
    ? Object.fromEntries(
        Object.entries(room.match.players).map(([id, p]) => [
          id,
          {
            callsign: p.callsign,
            level: p.level,
            credits: p.credits,
            hull: p.ship.hull,
            maxHull: p.ship.maxHull,
            primary: p.ship.primary,
            weapons: p.ship.weapons,
            upgrades: p.upgrades,
            stats: p.stats,
            drone: {
              purchased: p.drone.purchased,
              weapon: p.drone.weapon,
              upgrades: p.drone.upgrades,
            },
          },
        ]),
      )
    : null;
  await db.batch([
    insert,
    db
      .prepare(
        `INSERT OR IGNORE INTO coop_run_details(run_id, telemetry_json, updated_at) VALUES (?, ?, ?)`,
      )
      .bind(
        result.id,
        pilots
          ? JSON.stringify({
              pilots,
              directive: room.match.team.directive,
              bonusDefeated: room.match.team.bonusDefeated,
            })
          : null,
        result.finishedAt,
      ),
  ]);
  return result;
}

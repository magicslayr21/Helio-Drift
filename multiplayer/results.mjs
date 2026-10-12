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
  await db
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
    )
    .run();
  return result;
}

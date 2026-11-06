import { HttpError, integer, object } from "../server/validation.mjs";
import { sanitizeUsername } from "../server/moderation.mjs";

export const coopRanking =
  "completed DESC, wave DESC, score DESC, bosses_defeated DESC, duration_seconds DESC, id ASC";
export const coopVisible = `SELECT runs.*, details.telemetry_json, COALESCE(details.moderated, 0) AS moderated,
  COALESCE(details.revision, 0) AS revision, COALESCE(details.updated_at, runs.finished_at) AS updated_at
  FROM coop_runs AS runs LEFT JOIN coop_run_details AS details ON details.run_id = runs.id
  WHERE COALESCE(details.deleted, 0) = 0`;
export const coopEntry = (row) => ({
  id: row.id,
  playerOne: row.player_one,
  playerTwo: row.player_two,
  score: row.score,
  wave: row.wave,
  sector: row.sector,
  durationSeconds: row.duration_seconds,
  bossesDefeated: row.bosses_defeated,
  status: row.status,
  completed: Boolean(row.completed),
  finishedAt: row.finished_at,
  rank: row.rank,
});
export async function getCoopRun(db, id) {
  const row = await db
    .prepare(
      `WITH visible AS (${coopVisible}), ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY ${coopRanking}) AS rank FROM visible)
    SELECT * FROM ranked WHERE id = ?`,
    )
    .bind(id)
    .first();
  if (!row) throw new HttpError(404, "Co-op run not found.");
  return row;
}
export function coopDetails(row) {
  return {
    ...coopEntry(row),
    roomCode: row.room_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    moderated: Boolean(row.moderated),
    telemetry: row.telemetry_json ? JSON.parse(row.telemetry_json) : null,
  };
}
export function validateCoopEdit(value) {
  object(value);
  const fields = [
    "revision",
    "playerOne",
    "playerTwo",
    "score",
    "wave",
    "sector",
    "durationSeconds",
    "bossesDefeated",
    "status",
  ];
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new HttpError(400, "Unknown co-op edit field.");
  const edits = { revision: integer(value.revision, "Revision", 0, Number.MAX_SAFE_INTEGER) };
  if (Object.keys(value).length < 2) throw new HttpError(400, "Provide at least one edit.");
  for (const key of ["playerOne", "playerTwo"])
    if (key in value) edits[key] = sanitizeUsername(value[key]);
  for (const [key, max] of [
    ["score", 1e12],
    ["wave", 1000000],
    ["sector", 7],
    ["durationSeconds", 31536000],
    ["bossesDefeated", 1000000],
  ]) {
    if (key in value) edits[key] = integer(value[key], key, 0, max);
  }
  if ("status" in value) {
    if (!["victory", "defeat", "abandoned"].includes(value.status))
      throw new HttpError(400, "Co-op status is invalid.");
    edits.status = value.status;
  }
  return edits;
}
export async function moderateCoopRun(db, id, method, edit, now) {
  // A tombstone retains the authoritative ID, so delayed result retries cannot restore it.
  if (method === "DELETE") {
    await db
      .prepare(
        `INSERT INTO coop_run_details(run_id, deleted, moderated, revision, updated_at)
      VALUES (?, 1, 1, 1, ?) ON CONFLICT(run_id) DO UPDATE SET deleted = 1, moderated = 1,
      revision = revision + 1, updated_at = excluded.updated_at`,
      )
      .bind(id, now)
      .run();
    return;
  }
  const row = await getCoopRun(db, id);
  const merged = { ...coopEntry(row), ...edit };
  const results = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO coop_run_details(run_id, updated_at) VALUES (?, ?)")
      .bind(id, now),
    db
      .prepare(
        `UPDATE coop_run_details SET moderated = 1, revision = revision + 1, updated_at = ?
      WHERE run_id = ? AND deleted = 0 AND revision = ?`,
      )
      .bind(now, id, edit.revision),
    db
      .prepare(
        `UPDATE coop_runs SET player_one = ?, player_two = ?, score = ?, wave = ?, sector = ?,
      duration_seconds = ?, bosses_defeated = ?, status = ?, completed = ? WHERE id = ? AND changes() > 0`,
      )
      .bind(
        merged.playerOne,
        merged.playerTwo,
        merged.score,
        merged.wave,
        merged.sector,
        merged.durationSeconds,
        merged.bossesDefeated,
        merged.status,
        merged.status === "victory" ? 1 : 0,
        id,
      ),
  ]);
  if (!results[1].meta.changes)
    throw new HttpError(409, "Run changed concurrently. Reload it before editing.");
}

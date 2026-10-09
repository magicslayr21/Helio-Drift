import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sanitizeUsername } from "../server/moderation.mjs";
import {
  HttpError,
  identifier,
  integer,
  object,
  stages,
  validateEdit,
  validateReport,
} from "../server/validation.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const sort = "stage_order DESC, wave DESC, score DESC, credits DESC, id ASC";
const bestRuns = `WITH candidates AS (
  SELECT runs.*, COALESCE(runs.username_override, players.username) AS username,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY ${sort.replace("id ASC", "runs.id ASC")}) AS player_position
  FROM runs JOIN players ON players.id = runs.player_id WHERE deleted = 0
), best AS (SELECT * FROM candidates WHERE player_position = 1), ranked AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY ${sort}) AS rank FROM best
)`;

// Ordinary request limits are best-effort per isolate. Registration and developer
// login limits live in D1, so restarting/scaling a Worker cannot reset them.
const buckets = new Map();

export async function handleRequest(request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  const send = (status, result) =>
    new Response(result === undefined ? null : JSON.stringify(result), { status, headers });
  try {
    const code = env.LEADERBOARD_ADMIN_CODE;
    if (typeof code !== "string" || code.length < 12 || code.length > 256 || code === "dev") {
      throw new HttpError(503, "Leaderboard configuration is incomplete.");
    }
    const origins = new Set(
      (env.LEADERBOARD_ORIGINS || "https://magicslayr21.github.io")
        .split(",")
        .map((value) => value.trim()),
    );
    for (const origin of origins) {
      if (new URL(origin).origin !== origin || !/^https?:/.test(origin))
        throw new Error("Invalid origin configuration");
    }
    const origin = request.headers.get("Origin");
    if (origin && !origins.has(origin)) throw new HttpError(403, "This origin is not allowed.");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      headers.set("Access-Control-Max-Age", "600");
      return send(204);
    }
    const db = env.DB;
    const now = Date.now;
    const iso = () => new Date(now()).toISOString();
    // changes() refers to the preceding write in the same atomic D1 batch.
    const changed = (conditional = false) =>
      db
        .prepare(
          "UPDATE metadata SET value = ? WHERE key = 'updated_at'" +
            (conditional ? " AND changes() > 0" : ""),
        )
        .bind(iso());
    const limit = async (key, maximum, windowMs) => {
      const timestamp = now();
      if (key.startsWith("login:") || key.startsWith("register:")) {
        // Store only a secret-salted bucket identifier, never the client IP.
        const bucket = await db
          .prepare(
            `INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
            expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
          WHERE expires_at <= ? OR count < ? RETURNING count`,
          )
          .bind(
            hash(code + ":" + key),
            timestamp + windowMs,
            timestamp,
            timestamp,
            timestamp,
            maximum,
          )
          .first();
        if (!bucket) throw new HttpError(429, "Too many requests. Please try again later.");
        return;
      }
      let bucket = buckets.get(key);
      if (!bucket || bucket.until <= timestamp) {
        if (buckets.size >= 10_000) {
          for (const [id, item] of buckets) if (item.until <= timestamp) buckets.delete(id);
          if (buckets.size >= 10_000)
            throw new HttpError(503, "Leaderboard is busy. Please try again shortly.");
        }
        bucket = { count: 0, until: timestamp + windowMs };
        buckets.set(key, bucket);
      }
      if (++bucket.count > maximum)
        throw new HttpError(429, "Too many requests. Please try again later.");
    };
    function bearer(request) {
      const authorization = request.headers.get("Authorization");
      if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) {
        throw new HttpError(401, "Sign in to continue.");
      }
      return hash(authorization.slice(7));
    }
    const authenticatePlayer = async (request) => {
      const player = await db
        .prepare("SELECT id, username FROM players WHERE token_hash = ?")
        .bind(bearer(request))
        .first();
      if (!player) throw new HttpError(401, "Player identity is no longer valid.");
      return player;
    };
    const authenticateAdmin = async (request) => {
      const tokenHash = bearer(request);
      const session = await db
        .prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .first();
      if (!session || session.expires_at <= now())
        throw new HttpError(401, "Developer session expired. Enter the code again.");
      return tokenHash;
    };
    const getRun = async (id) => {
      const row = await db
        .prepare(
          `SELECT runs.*, COALESCE(runs.username_override, players.username) AS username
      FROM runs JOIN players ON players.id = runs.player_id WHERE runs.id = ? AND deleted = 0`,
        )
        .bind(id)
        .first();
      if (!row) throw new HttpError(404, "Run not found.");
      const ranked = await db
        .prepare(`${bestRuns} SELECT rank FROM ranked WHERE id = ?`)
        .bind(id)
        .first();
      return { ...row, rank: ranked?.rank ?? 0 };
    };
    const entry = (row) => ({
      id: row.id,
      playerId: row.player_id,
      username: row.username,
      score: row.score,
      credits: row.credits,
      wave: row.wave,
      level: row.level,
      stage: stages[row.stage_order],
      status: row.status,
      assisted: Boolean(row.assisted),
      updatedAt: row.updated_at,
      rank: row.rank,
    });

    async function readBody(request) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
        throw new HttpError(415, "Send JSON with Content-Type: application/json.");
      }
      if (Number(request.headers.get("Content-Length") ?? 0) > 16_384)
        throw new HttpError(413, "Request is too large.");
      const reader = request.body?.getReader();
      let text = "";
      let size = 0;
      const decoder = new TextDecoder();
      if (reader) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16_384) {
              await reader.cancel();
              throw new HttpError(413, "Request is too large.");
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      try {
        return object(JSON.parse(text));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "Invalid JSON body.");
      }
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    // Cloudflare sets this header at the edge; ignore client X-Forwarded-For.
    const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (request.method === "GET" && path === "/api/health") {
      await db.prepare("SELECT 1 FROM metadata WHERE key = 'updated_at'").first();
      return send(200, { ok: true });
    }
    if (request.method === "GET" && path === "/api/leaderboard") {
      await limit(`read:${address}`, 240, 60_000);
      const offset = integer(Number(url.searchParams.get("offset") ?? 0), "Offset", 0, 1_000_000);
      const pageSize = integer(Number(url.searchParams.get("limit") ?? 25), "Limit", 1, 100);
      // Read the page, total and timestamp in one consistent database snapshot.
      const [page, count, metadata] = await db.batch([
        db
          .prepare(`${bestRuns} SELECT * FROM ranked ORDER BY rank LIMIT ? OFFSET ?`)
          .bind(pageSize, offset),
        db.prepare("SELECT COUNT(DISTINCT player_id) AS total FROM runs WHERE deleted = 0"),
        db.prepare("SELECT value FROM metadata WHERE key = 'updated_at'"),
      ]);
      return send(200, {
        entries: page.results.map(entry),
        total: count.results[0].total,
        updatedAt: metadata.results[0].value,
      });
    }
    if (request.method === "POST" && path === "/api/players") {
      await limit(`register:${address}`, 40, 3_600_000);
      const body = await readBody(request);
      if (typeof body.username !== "string" || body.username.length > 160)
        throw new HttpError(400, "Username is invalid.");
      const username = sanitizeUsername(body.username);
      const playerId = randomUUID();
      const playerToken = newToken();
      const timestamp = iso();
      await db
        .prepare(
          "INSERT INTO players(id, token_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(playerId, hash(playerToken), username, timestamp, timestamp)
        .run();
      return send(201, { playerId, playerToken, username });
    }
    if (request.method === "PATCH" && path === "/api/players/me") {
      const player = await authenticatePlayer(request);
      await limit(`rename:${player.id}`, 20, 60_000);
      const body = await readBody(request);
      if (typeof body.username !== "string" || body.username.length > 160)
        throw new HttpError(400, "Username is invalid.");
      const username = sanitizeUsername(body.username);
      await db.batch([
        db
          .prepare("UPDATE players SET username = ?, updated_at = ? WHERE id = ?")
          .bind(username, iso(), player.id),
        changed(),
      ]);
      return send(200, { username });
    }
    const runRoute = path.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "PUT" && runRoute) {
      const player = await authenticatePlayer(request);
      await limit(`write:${player.id}`, 180, 60_000);
      const runId = identifier(runRoute[1]);
      const report = validateReport(await readBody(request), runId);
      let accepted = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const old = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first();
        if (old && old.player_id !== player.id)
          throw new HttpError(403, "This run belongs to another player.");
        if (
          old &&
          (old.deleted ||
            old.moderated ||
            old.revision >= report.revision ||
            ["dead", "abandoned"].includes(old.status) ||
            old.stage_order === 2)
        )
          break;
        if (old) {
          const previous = JSON.parse(old.report_json);
          if (
            stages.indexOf(report.stage) < old.stage_order ||
            report.wave < old.wave ||
            report.score < old.score ||
            report.durationSeconds < previous.durationSeconds
          ) {
            throw new HttpError(400, "Run progress cannot move backwards.");
          }
          if (old.assisted) report.assisted = true;
        }
        const timestamp = iso();
        const write = db
          .prepare(
            `INSERT INTO runs
            (id, player_id, revision, report_json, stage_order, wave, score, credits, level, status, assisted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, report_json = excluded.report_json,
              stage_order = excluded.stage_order, wave = excluded.wave, score = excluded.score,
              credits = excluded.credits, level = excluded.level, status = excluded.status,
              assisted = excluded.assisted, updated_at = excluded.updated_at
            WHERE runs.player_id = excluded.player_id AND runs.revision = ?
              AND runs.deleted = 0 AND runs.moderated = 0
              AND runs.status NOT IN ('dead', 'abandoned') AND runs.stage_order < 2`,
          )
          .bind(
            runId,
            player.id,
            report.revision,
            JSON.stringify(report),
            stages.indexOf(report.stage),
            report.wave,
            report.score,
            report.credits,
            report.level,
            report.status,
            Number(report.assisted),
            timestamp,
            timestamp,
            old?.revision ?? -1,
          );
        const [result] = await db.batch([write, changed(true)]);
        if (result.meta.changes > 0) {
          accepted = true;
          break;
        }
        // Another isolate changed the record after our read. Re-read and validate
        // ownership, revisions, progress and moderation against the current row.
        if (attempt === 3) throw new HttpError(409, "Run changed concurrently. Please retry.");
      }
      return send(200, { accepted });
    }
    if (request.method === "POST" && path === "/api/admin/session") {
      await limit(`login:${address}`, 10, 15 * 60_000);
      const body = await readBody(request);
      const given = typeof body.code === "string" && body.code.length <= 256 ? body.code : "";
      if (!timingSafeEqual(Buffer.from(hash(given), "hex"), Buffer.from(hash(code), "hex"))) {
        throw new HttpError(401, "Invalid developer code.");
      }
      const token = newToken();
      const expires = now() + 2 * 3_600_000;
      await db
        .prepare("INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)")
        .bind(hash(token), expires)
        .run();
      return send(200, { token, expiresAt: new Date(expires).toISOString() });
    }
    if (request.method === "DELETE" && path === "/api/admin/session") {
      const tokenHash = await authenticateAdmin(request);
      await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
      return send(200, { signedOut: true });
    }
    const adminRunRoute = path.match(/^\/api\/admin\/runs\/([a-zA-Z0-9_-]+)$/);
    if (adminRunRoute && ["GET", "PATCH", "DELETE"].includes(request.method)) {
      const tokenHash = await authenticateAdmin(request);
      await limit(`admin:${tokenHash}`, 120, 60_000);
      const runId = identifier(adminRunRoute[1]);
      const run = await getRun(runId);
      if (request.method === "GET") {
        return send(200, {
          ...entry(run),
          report: JSON.parse(run.report_json),
          createdAt: run.created_at,
          moderated: Boolean(run.moderated),
        });
      }
      if (request.method === "DELETE") {
        await db.batch([
          db
            .prepare("UPDATE runs SET deleted = 1, moderated = 1, updated_at = ? WHERE id = ?")
            .bind(iso(), runId),
          changed(),
        ]);
        return send(200, { deleted: true });
      }
      const edits = validateEdit(await readBody(request));
      const { username, ...progress } = edits;
      const report = validateReport({ ...JSON.parse(run.report_json), ...progress }, runId);
      const [result] = await db.batch([
        db
          .prepare(
            `UPDATE runs SET report_json = ?, stage_order = ?, wave = ?, score = ?, credits = ?,
            level = ?, status = ?, moderated = 1, username_override = ?, updated_at = ?
            WHERE id = ? AND deleted = 0 AND revision = ? AND report_json = ?
              AND updated_at = ? AND username_override IS ?`,
          )
          .bind(
            JSON.stringify(report),
            stages.indexOf(report.stage),
            report.wave,
            report.score,
            report.credits,
            report.level,
            report.status,
            username === undefined ? run.username_override : sanitizeUsername(username),
            iso(),
            runId,
            run.revision,
            run.report_json,
            run.updated_at,
            run.username_override,
          ),
        changed(true),
      ]);
      if (!result.meta.changes)
        throw new HttpError(409, "Run changed concurrently. Reload it before editing.");
      return send(200, { entry: entry(await getRun(runId)) });
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 429) headers.set("Retry-After", "60");
      return send(error.status, { error: error.message });
    }
    // Never log request bodies, credentials or database records.
    console.error(
      "Leaderboard request failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return send(500, { error: "Leaderboard is temporarily unavailable. Please try again." });
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(Date.now()),
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(Date.now()),
    ]);
  },
};

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sanitizeUsername } from "./moderation.mjs";
import { HttpError, identifier, integer, object, stages, validateEdit, validateReport } from "./validation.mjs";

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

export const defaultOrigins = [
  "https://magicslayr21.github.io",
  ...["localhost", "127.0.0.1"].flatMap((host) => [5173, 4173, 8787].map((port) => `http://${host}:${port}`)),
];

export function createLeaderboardServer({
  databasePath = "server/data/leaderboard.sqlite",
  adminCode,
  allowedOrigins,
  production = process.env.NODE_ENV === "production",
  trustProxy = false,
  now = Date.now,
} = {}) {
  const code = adminCode ?? (production ? "" : "dev");
  if (!code || (production && (code === "dev" || code.length < 12))) {
    throw new Error("Set LEADERBOARD_ADMIN_CODE to a private code of at least 12 characters for production.");
  }
  const origins = new Set(allowedOrigins ?? (production ? defaultOrigins.slice(0, 1) : defaultOrigins));
  for (const origin of origins) {
    if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) {
      throw new Error("LEADERBOARD_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes.");
    }
  }
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
      revision INTEGER NOT NULL, report_json TEXT NOT NULL, stage_order INTEGER NOT NULL,
      wave INTEGER NOT NULL, score INTEGER NOT NULL, credits INTEGER NOT NULL,
      level INTEGER NOT NULL, status TEXT NOT NULL, assisted INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, moderated INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0, username_override TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_player_best ON runs
      (player_id, deleted, stage_order DESC, wave DESC, score DESC, credits DESC, id);
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const iso = () => new Date(now()).toISOString();
  db.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('updated_at', ?)").run(iso());
  const changed = () => db.prepare("UPDATE metadata SET value = ? WHERE key = 'updated_at'").run(iso());
  const transaction = (operation) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  // IPs are used only in temporary in-memory rate-limit buckets and never saved.
  const buckets = new Map();
  const limit = (key, maximum, windowMs) => {
    const timestamp = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= timestamp) {
      if (buckets.size > 10_000) {
        for (const [id, item] of buckets) if (item.until <= timestamp) buckets.delete(id);
        if (buckets.size > 10_000) throw new HttpError(503, "Leaderboard is busy. Please try again shortly.");
      }
      bucket = { count: 0, until: timestamp + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > maximum) throw new HttpError(429, "Too many requests. Please try again later.");
  };
  const cleanup = setInterval(() => {
    for (const [key, bucket] of buckets) if (bucket.until <= now()) buckets.delete(key);
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now());
  }, 60_000);
  cleanup.unref();

  function bearer(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) {
      throw new HttpError(401, "Sign in to continue.");
    }
    return hash(authorization.slice(7));
  }
  const authenticatePlayer = (request) => {
    const player = db.prepare("SELECT id, username FROM players WHERE token_hash = ?").get(bearer(request));
    if (!player) throw new HttpError(401, "Player identity is no longer valid.");
    return player;
  };
  const authenticateAdmin = (request) => {
    const tokenHash = bearer(request);
    const session = db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(tokenHash);
    if (!session || session.expires_at <= now()) throw new HttpError(401, "Developer session expired. Enter the code again.");
    return tokenHash;
  };
  const getRun = (id) => {
    const row = db.prepare(`SELECT runs.*, COALESCE(runs.username_override, players.username) AS username
      FROM runs JOIN players ON players.id = runs.player_id WHERE runs.id = ? AND deleted = 0`).get(id);
    if (!row) throw new HttpError(404, "Run not found.");
    const ranked = db.prepare(`${bestRuns} SELECT rank FROM ranked WHERE id = ?`).get(id);
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
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
      throw new HttpError(415, "Send JSON with Content-Type: application/json.");
    }
    if (Number(request.headers["content-length"] ?? 0) > 16_384) {
      request.resume();
      throw new HttpError(413, "Request is too large.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16_384) throw new HttpError(413, "Request is too large.");
      chunks.push(chunk);
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Vary", "Origin");
    const send = (status, result) => {
      response.writeHead(status);
      response.end(result === undefined ? undefined : JSON.stringify(result));
    };
    try {
      const origin = request.headers.origin;
      if (origin && !origins.has(origin)) throw new HttpError(403, "This origin is not allowed.");
      if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response.setHeader("Access-Control-Max-Age", "600");
        return send(204);
      }
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname.replace(/\/$/, "");
      const forwarded = request.headers["x-forwarded-for"];
      const address = trustProxy && typeof forwarded === "string"
        ? forwarded.split(",").at(-1).trim().slice(0, 100)
        : request.socket.remoteAddress ?? "unknown";

      if (request.method === "GET" && path === "/api/health") {
        db.prepare("SELECT 1").get();
        return send(200, { ok: true });
      }
      if (request.method === "GET" && path === "/api/leaderboard") {
        limit(`read:${address}`, 240, 60_000);
        const offset = integer(Number(url.searchParams.get("offset") ?? 0), "Offset", 0, 1_000_000);
        const pageSize = integer(Number(url.searchParams.get("limit") ?? 25), "Limit", 1, 100);
        const rows = db.prepare(`${bestRuns} SELECT * FROM ranked ORDER BY rank LIMIT ? OFFSET ?`).all(pageSize, offset);
        const { total } = db.prepare("SELECT COUNT(DISTINCT player_id) AS total FROM runs WHERE deleted = 0").get();
        const { value: updatedAt } = db.prepare("SELECT value FROM metadata WHERE key = 'updated_at'").get();
        return send(200, { entries: rows.map(entry), total, updatedAt });
      }
      if (request.method === "POST" && path === "/api/players") {
        limit(`register:${address}`, 40, 3_600_000);
        const body = await readBody(request);
        if (typeof body.username !== "string" || body.username.length > 160) throw new HttpError(400, "Username is invalid.");
        const username = sanitizeUsername(body.username);
        const playerId = randomUUID();
        const playerToken = newToken();
        const timestamp = iso();
        db.prepare("INSERT INTO players(id, token_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(playerId, hash(playerToken), username, timestamp, timestamp);
        return send(201, { playerId, playerToken, username });
      }
      if (request.method === "PATCH" && path === "/api/players/me") {
        const player = authenticatePlayer(request);
        limit(`rename:${player.id}`, 20, 60_000);
        const body = await readBody(request);
        if (typeof body.username !== "string" || body.username.length > 160) throw new HttpError(400, "Username is invalid.");
        const username = sanitizeUsername(body.username);
        transaction(() => {
          db.prepare("UPDATE players SET username = ?, updated_at = ? WHERE id = ?").run(username, iso(), player.id);
          changed();
        });
        return send(200, { username });
      }
      const runRoute = path.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)$/);
      if (request.method === "PUT" && runRoute) {
        const player = authenticatePlayer(request);
        limit(`write:${player.id}`, 180, 60_000);
        const runId = identifier(runRoute[1]);
        const report = validateReport(await readBody(request), runId);
        const accepted = transaction(() => {
          const old = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
          if (old && old.player_id !== player.id) throw new HttpError(403, "This run belongs to another player.");
          if (old && (old.deleted || old.moderated || old.revision >= report.revision ||
            ["dead", "abandoned"].includes(old.status) || old.stage_order === 2)) return false;
          // A run may spend credits, but its historical progress and assisted flag
          // cannot move backwards. A normal victory may continue into MK6.
          if (old) {
            const previous = JSON.parse(old.report_json);
            if (stages.indexOf(report.stage) < old.stage_order || report.wave < old.wave ||
              report.score < old.score || report.durationSeconds < previous.durationSeconds) {
              throw new HttpError(400, "Run progress cannot move backwards.");
            }
            if (old.assisted) report.assisted = true;
          }
          const timestamp = iso();
          db.prepare(`INSERT INTO runs
            (id, player_id, revision, report_json, stage_order, wave, score, credits, level, status, assisted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, report_json = excluded.report_json,
              stage_order = excluded.stage_order, wave = excluded.wave, score = excluded.score,
              credits = excluded.credits, level = excluded.level, status = excluded.status,
              assisted = excluded.assisted, updated_at = excluded.updated_at`)
            .run(runId, player.id, report.revision, JSON.stringify(report), stages.indexOf(report.stage),
              report.wave, report.score, report.credits, report.level, report.status,
              Number(report.assisted), timestamp, timestamp);
          changed();
          return true;
        });
        return send(200, { accepted });
      }
      if (request.method === "POST" && path === "/api/admin/session") {
        limit(`login:${address}`, 10, 15 * 60_000);
        const body = await readBody(request);
        const given = typeof body.code === "string" && body.code.length <= 256 ? body.code : "";
        if (!timingSafeEqual(Buffer.from(hash(given), "hex"), Buffer.from(hash(code), "hex"))) {
          throw new HttpError(401, "Invalid developer code.");
        }
        const token = newToken();
        const expires = now() + 2 * 3_600_000;
        db.prepare("INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)").run(hash(token), expires);
        return send(200, { token, expiresAt: new Date(expires).toISOString() });
      }
      if (request.method === "DELETE" && path === "/api/admin/session") {
        const tokenHash = authenticateAdmin(request);
        db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
        return send(200, { signedOut: true });
      }
      const adminRunRoute = path.match(/^\/api\/admin\/runs\/([a-zA-Z0-9_-]+)$/);
      if (adminRunRoute && ["GET", "PATCH", "DELETE"].includes(request.method)) {
        const tokenHash = authenticateAdmin(request);
        limit(`admin:${tokenHash}`, 120, 60_000);
        const runId = identifier(adminRunRoute[1]);
        const run = getRun(runId);
        if (request.method === "GET") {
          return send(200, { ...entry(run), report: JSON.parse(run.report_json), createdAt: run.created_at, moderated: Boolean(run.moderated) });
        }
        if (request.method === "DELETE") {
          transaction(() => {
            db.prepare("UPDATE runs SET deleted = 1, moderated = 1, updated_at = ? WHERE id = ?").run(iso(), runId);
            changed();
          });
          return send(200, { deleted: true });
        }
        const edits = validateEdit(await readBody(request));
        const { username, ...progress } = edits;
        const report = validateReport({ ...JSON.parse(run.report_json), ...progress }, runId);
        transaction(() => {
          db.prepare(`UPDATE runs SET report_json = ?, stage_order = ?, wave = ?, score = ?, credits = ?,
            level = ?, status = ?, moderated = 1, username_override = ?, updated_at = ? WHERE id = ?`)
            .run(JSON.stringify(report), stages.indexOf(report.stage), report.wave, report.score,
              report.credits, report.level, report.status,
              username === undefined ? run.username_override : sanitizeUsername(username), iso(), runId);
          changed();
        });
        return send(200, { entry: entry(getRun(runId)) });
      }
      throw new HttpError(404, "Endpoint not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 429) response.setHeader("Retry-After", "60");
        send(error.status, { error: error.message });
      } else {
        // Log no body, credentials, names or database records.
        console.error("Leaderboard request failed:", error instanceof Error ? error.name : "UnknownError");
        send(500, { error: "Leaderboard is temporarily unavailable. Please try again." });
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(cleanup);
      if (server.listening) {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
      db.close();
    },
  };
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const adminCode = "a-test-admin-secret";
export async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "helio-d1-test-"));
  const options = convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL("../../worker-dist/index.js", import.meta.url)),
    compatibilityDate: "2026-10-09",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      LEADERBOARD_ADMIN_CODE: adminCode,
      LEADERBOARD_ORIGINS: "http://localhost:5173",
      ...overrides,
    },
    d1Databases: { DB: "leaderboard" },
    resourcePersistencePath: directory,
    telemetry: { enabled: false },
  });
  let mf = new Miniflare(options);
  let db = await mf.getD1Database("DB");
  t.after(async () => {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const migration = await readFile(
    new URL("../migrations/0001_leaderboard.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    migration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  async function request(path, { method = "GET", token, body, rawBody, headers = {} } = {}) {
    const response = await mf.dispatchFetch(`https://leaderboard.example/api${path}`, {
      method,
      headers: {
        ...(body === undefined && rawBody === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(rawBody === undefined
        ? body === undefined
          ? {}
          : { body: JSON.stringify(body) }
        : { body: rawBody }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : null,
    };
  }
  return {
    request,
    get db() {
      return db;
    },
    async player(username = "CometPilot") {
      const response = await request("/players", { method: "POST", body: { username } });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      return response.data;
    },
    submit(identity, report) {
      return request(`/runs/${report.runId}`, {
        method: "PUT",
        token: identity.playerToken,
        body: report,
      });
    },
    async admin() {
      const response = await request("/admin/session", {
        method: "POST",
        body: { code: adminCode },
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      return response.data;
    },
    async expireSessions() {
      await db.prepare("UPDATE admin_sessions SET expires_at = 0").run();
    },
    async scheduled() {
      return (await mf.getWorker()).scheduled();
    },
    async restart() {
      await mf.dispose();
      mf = new Miniflare(options);
      db = await mf.getD1Database("DB");
    },
  };
}

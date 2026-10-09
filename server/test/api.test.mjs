import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leaderboardContract } from "./contract.mjs";
import { createLeaderboardServer } from "../app.mjs";

const adminCode = "a-test-admin-secret";
const allowedOrigin = "http://localhost:5173";
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "helio-leaderboard-test-"));
  let currentTime = Date.now();
  const configuration = {
    now: () => currentTime,
    databasePath: join(directory, "leaderboard.sqlite"),
    adminCode,
    allowedOrigins: [allowedOrigin],
    production: false,
    ...options,
  };
  let app;
  let baseUrl;
  async function start() {
    app = createLeaderboardServer(configuration);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    baseUrl = `http://127.0.0.1:${app.server.address().port}/api`;
  }
  await start();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { method = "GET", token, body, rawBody, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
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
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, headers: response.headers, data };
  }
  async function player(username = "CometPilot") {
    const response = await request("/players", { method: "POST", body: { username } });
    assert.ok([200, 201].includes(response.status), JSON.stringify(response.data));
    assert.equal(typeof response.data.playerId, "string");
    assert.equal(typeof response.data.playerToken, "string");
    return response.data;
  }
  async function submit(identity, report) {
    return request(`/runs/${report.runId}`, {
      method: "PUT",
      token: identity.playerToken,
      body: report,
    });
  }
  async function admin() {
    const response = await request("/admin/session", { method: "POST", body: { code: adminCode } });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(typeof response.data.token, "string");
    assert.ok(Number.isFinite(Date.parse(response.data.expiresAt)));
    return response.data;
  }
  return {
    request,
    player,
    submit,
    admin,
    async expireSessions() {
      currentTime += 3 * 3_600_000;
    },
    async restart() {
      await app.close();
      await start();
    },
  };
}

leaderboardContract(fixture);

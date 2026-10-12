import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer as createViteServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "helio-browser-smoke-"));
const chromePath =
  process.env.CHROME_PATH ||
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

if (!chromePath)
  throw new Error("Chromium was not found. Set CHROME_PATH to run the two-browser smoke test.");

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
const close = (server) => new Promise((resolve) => server.close(resolve));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const availablePort = async () => {
  const probe = createHttpServer();
  await listen(probe, 0);
  const { port } = probe.address();
  await close(probe);
  return port;
};
const [leaderboardPort, multiplayerPort, vitePort, cdpPort] = await Promise.all([
  availablePort(),
  availablePort(),
  availablePort(),
  availablePort(),
]);
const smokeDeveloperCode = "smoke-developer-code";
const smokeDeveloperToken = "S".repeat(43);

const leaderboard = createHttpServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "POST" && request.url === "/api/admin/session") {
    response.end(
      JSON.stringify({
        token: smokeDeveloperToken,
        expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      }),
    );
  } else if (request.url?.startsWith("/api/leaderboard")) {
    response.end(
      JSON.stringify({
        entries: [],
        total: 0,
        offset: 0,
        limit: 50,
        updatedAt: new Date(0).toISOString(),
      }),
    );
  } else if (request.url === "/api/health") response.end(JSON.stringify({ ok: true }));
  else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  }
});

const miniflareOptions = convertV4MiniflareOptions({
  modules: true,
  scriptPath: join(root, "multiplayer-dist/worker.js"),
  compatibilityDate: "2026-10-12",
  compatibilityFlags: ["nodejs_compat"],
  bindings: { MULTIPLAYER_ORIGINS: `http://127.0.0.1:${vitePort}` },
  durableObjects: {
    MATCH_ROOMS: { className: "MatchRoom", useSQLite: true },
    LOBBY_INDEX: { className: "LobbyIndex", useSQLite: true },
  },
  d1Databases: { DB: "leaderboard" },
  resourcePersistencePath: join(scratch, "miniflare"),
  telemetry: { enabled: false },
});
const multiplayer = new Miniflare({
  ...miniflareOptions,
  host: "127.0.0.1",
  port: multiplayerPort,
});
const vite = await createViteServer({
  root,
  logLevel: "silent",
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${leaderboardPort}`,
      "/multiplayer-api": {
        target: `http://127.0.0.1:${multiplayerPort}`,
        rewrite: (path) => path.replace(/^\/multiplayer-api/, "/api"),
        ws: true,
      },
    },
  },
});
let chrome;
let cdp;

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params.exceptionDetails.text);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function connectCdp(port, chromeProcess, diagnostics, launchError) {
  let metadata;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError()) throw new Error(`Chromium failed to launch: ${launchError().message}`);
    if (chromeProcess.exitCode !== null) {
      const detail = diagnostics().trim();
      throw new Error(
        `Chromium exited with code ${chromeProcess.exitCode} before DevTools became ready.${detail ? `\n${detail}` : ""}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        metadata = await response.json();
        break;
      }
    } catch {}
    await delay(100);
  }
  if (!metadata) {
    const detail = diagnostics().trim();
    throw new Error(
      `Chromium DevTools endpoint did not become ready within 30 seconds.${detail ? `\n${detail}` : ""}`,
    );
  }
  const socket = new WebSocket(metadata.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return new CdpClient(socket);
}

async function makePage(client, callsign) {
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const { targetId } = await client.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Page.enable", {}, sessionId);
  const identity = JSON.stringify({
    playerId: `smoke-${callsign}`,
    playerToken: "local",
    username: callsign,
  });
  await client.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `localStorage.setItem("helios-leaderboard-player-v1", ${JSON.stringify(identity)}); localStorage.setItem("helios-confirmed-callsign-v1", ${JSON.stringify(callsign)}); window.confirm = () => true;`,
    },
    sessionId,
  );
  await client.send(
    "Page.navigate",
    { url: `http://127.0.0.1:${vitePort}/Helio-Drift/` },
    sessionId,
  );
  return { browserContextId, sessionId };
}

async function evaluate(client, page, expression) {
  const result = await client.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    page.sessionId,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(client, page, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, page, `Boolean(${expression})`)) return;
    } catch (error) {
      if (!/navigated|context.*destroyed|Cannot find context/i.test(error.message)) throw error;
    }
    await delay(75);
  }
  const text = await evaluate(client, page, "document.body?.innerText?.slice(0, 1200)");
  throw new Error(`Timed out waiting for ${label}. Page text:\n${text}`);
}

const clickText = (text, selector = "button") =>
  `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) => element.textContent.trim().includes(${JSON.stringify(text)})); if (!target) return false; target.click(); return true; })()`;

async function enterMultiplayer(client, page) {
  await waitFor(client, page, clickText("Deploy"), "main menu Deploy action");
  await waitFor(
    client,
    page,
    "(() => { const target = document.querySelector('button[aria-label=\"Multiplayer\"]'); if (!target) return false; target.click(); return true; })()",
    "Multiplayer mode action",
  );
  await waitFor(
    client,
    page,
    "document.body.innerText.includes('FLY TOGETHER')",
    "multiplayer menu",
  );
}

try {
  await listen(leaderboard, leaderboardPort);
  await multiplayer.ready;
  const db = await multiplayer.getD1Database("DB");
  const migrations = await Promise.all(
    ["0001_leaderboard.sql", "0002_coop_leaderboard.sql"].map((name) =>
      readFile(join(root, "worker/migrations", name), "utf8"),
    ),
  );
  await db.batch(
    migrations
      .join("\n")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db
    .prepare("INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)")
    .bind(
      createHash("sha256").update(smokeDeveloperToken).digest("hex"),
      Date.now() + 2 * 3_600_000,
    )
    .run();
  await vite.listen();

  let chromeDiagnostics = "";
  let chromeLaunchError = null;
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${join(scratch, "chromium")}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    chromeDiagnostics = `${chromeDiagnostics}${chunk}`.slice(-8_000);
  });
  chrome.once("error", (error) => {
    chromeLaunchError = error;
  });
  cdp = await connectCdp(
    cdpPort,
    chrome,
    () => chromeDiagnostics,
    () => chromeLaunchError,
  );
  const alpha = await makePage(cdp, "Smoke Alpha");
  const bravo = await makePage(cdp, "Smoke Bravo");
  await Promise.all([enterMultiplayer(cdp, alpha), enterMultiplayer(cdp, bravo)]);

  await waitFor(
    cdp,
    alpha,
    "[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Create private') && button.disabled)",
    "locked hosting action",
  );
  await evaluate(
    cdp,
    alpha,
    `(() => { const input = document.querySelector('#coop-developer-code'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(smokeDeveloperCode)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
  assert.equal(await evaluate(cdp, alpha, clickText("Unlock hosting")), true);
  await waitFor(
    cdp,
    alpha,
    "[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Create private') && !button.disabled)",
    "developer hosting authorization",
  );
  assert.equal(await evaluate(cdp, alpha, clickText("Create private")), true);
  await waitFor(cdp, alpha, "document.querySelector('.coop-room-code strong')", "private room");
  const roomCode = await evaluate(
    cdp,
    alpha,
    "document.querySelector('.coop-room-code strong').textContent.trim()",
  );
  assert.match(roomCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

  assert.equal(await evaluate(cdp, bravo, clickText("Join by code")), true);
  await waitFor(cdp, bravo, "document.querySelector('.coop-code-input')", "room code form");
  await evaluate(
    cdp,
    bravo,
    `(() => { const input = document.querySelector('.coop-code-input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(roomCode)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
  assert.equal(await evaluate(cdp, bravo, clickText("Join room")), true);
  await Promise.all([
    waitFor(cdp, alpha, "document.body.innerText.includes('Smoke Bravo')", "second pilot in room"),
    waitFor(cdp, bravo, "document.body.innerText.includes('Smoke Alpha')", "first pilot in room"),
  ]);
  await Promise.all([
    waitFor(
      cdp,
      alpha,
      "[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Ready up') && !button.disabled)",
      "alpha connection",
    ),
    waitFor(
      cdp,
      bravo,
      "[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Ready up') && !button.disabled)",
      "bravo connection",
    ),
  ]);

  await Promise.all([
    evaluate(cdp, alpha, clickText("Ready up")),
    evaluate(cdp, bravo, clickText("Ready up")),
  ]);
  await waitFor(
    cdp,
    alpha,
    "[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Start match') && !button.disabled)",
    "both pilots ready",
  );
  assert.equal(await evaluate(cdp, alpha, clickText("Start match")), true);
  await Promise.all([
    waitFor(
      cdp,
      alpha,
      "document.querySelector('canvas') && document.body.textContent.includes('Wave 01')",
      "alpha flight",
    ),
    waitFor(
      cdp,
      bravo,
      "document.querySelector('canvas') && document.body.textContent.includes('Wave 01')",
      "bravo flight",
    ),
  ]);

  await evaluate(cdp, alpha, "window.__helioSmokeReloadPending = true");
  await cdp.send("Page.reload", { ignoreCache: true }, alpha.sessionId);
  await waitFor(
    cdp,
    alpha,
    "window.__helioSmokeReloadPending !== true && document.readyState === 'complete'",
    "fresh document after reload",
  );
  await enterMultiplayer(cdp, alpha);
  await waitFor(
    cdp,
    alpha,
    "document.body.textContent.includes('Reconnect to')",
    "reconnect action",
  );
  assert.equal(await evaluate(cdp, alpha, clickText("Reconnect to")), true);
  await waitFor(
    cdp,
    alpha,
    "document.querySelector('canvas') && document.body.textContent.includes('Wave 01')",
    "reconnected flight",
  );

  assert.equal(await evaluate(cdp, bravo, clickText("Leave", ".coop-game-header button")), true);
  await waitFor(cdp, bravo, "document.body.innerText.includes('FLY TOGETHER')", "leave return");
  assert.deepEqual(cdp.exceptions, []);
  console.info(
    `[coop readiness] two-browser room ${roomCode}: join, ready, flight, refresh/reconnect and leave passed`,
  );
} finally {
  try {
    cdp?.close();
  } catch {}
  try {
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill("SIGTERM");
      await Promise.race([exited, delay(2_000)]);
    }
  } catch {}
  await vite.close().catch(() => {});
  await multiplayer.dispose().catch(() => {});
  if (leaderboard.listening) await close(leaderboard);
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

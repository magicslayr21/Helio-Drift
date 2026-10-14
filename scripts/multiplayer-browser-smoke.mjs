import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    },
    sessionId,
  );
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

async function capture(client, page, name) {
  if (!process.env.HELIOS_SCREENSHOT_DIR) return;
  const { data } = await client.send("Page.captureScreenshot", { format: "png" }, page.sessionId);
  await writeFile(join(process.env.HELIOS_SCREENSHOT_DIR, name), Buffer.from(data, "base64"));
}

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
  await waitFor(client, page, clickText("Got it · Continue"), "dismissible alpha warning");
  assert.equal(
    await evaluate(client, page, "Boolean(document.querySelector('.coop-callsign input'))"),
    true,
  );
}

async function observeFlight(client, page) {
  await evaluate(
    client,
    page,
    `(async () => {
    window.__keys=[];
    window.addEventListener('keydown', e => window.__keys.push({code:e.code, target:e.target.tagName}), true);
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) { const message=JSON.parse(data);if(message.type==='input'){window.__sentInput=message;window.__flightSocket=this;}return send.call(this,data); };
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/game/network/client-sync.ts')).name;
    const {ClientPrediction} = await import(url);
    const reconcile = ClientPrediction.prototype.reconcile;
    ClientPrediction.prototype.reconcile = function(snapshot) {
      window.__flight = snapshot.state;
      return reconcile.call(this, snapshot);
    };
  })()`,
  );
  await waitFor(client, page, "window.__flight", "authoritative flight probe");
}

async function checkMovement(client, pilot, observer, id, code, axis, direction) {
  await client.send("Page.bringToFront", {}, pilot.sessionId);
  // A HUD button retaining focus must not swallow WASD/arrows.
  await evaluate(client, pilot, "document.querySelector('.coop-game-header button').focus()");
  const start = await evaluate(client, observer, `window.__flight.players.${id}.ship.${axis}`);
  await client.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code, key: code === "KeyD" ? "d" : "ArrowUp" },
    pilot.sessionId,
  );
  try {
    await waitFor(
      client,
      observer,
      `window.__flight.players.${id}.input.${axis === "x" ? "moveX" : "moveY"} === ${direction}`,
      `${id} movement reaching other client`,
    );
    await waitFor(
      client,
      observer,
      `(window.__flight.players.${id}.ship.${axis} - ${start}) * ${direction} > 20`,
      `${id} authoritative movement`,
    );
  } catch (error) {
    console.info(
      "Movement diagnostics",
      await evaluate(
        client,
        pilot,
        "JSON.stringify({keys:window.__keys,sent:window.__sentInput,inputs:Object.values(window.__flight?.players ?? {}).map(p=>({id:p.id,input:p.input,x:p.ship.x,y:p.ship.y})),focus:document.activeElement?.tagName})",
      ),
    );
    throw error;
  } finally {
    await client.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", code, key: code === "KeyD" ? "d" : "ArrowUp" },
      pilot.sessionId,
    );
  }
  await waitFor(
    client,
    observer,
    `window.__flight.players.${id}.input.${axis === "x" ? "moveX" : "moveY"} === 0`,
    `${id} key release`,
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
  await capture(cdp, alpha, "helio-coop-menu.png");
  await evaluate(
    cdp,
    alpha,
    `(() => { const input = document.querySelector('.coop-callsign input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Unsaved Pilot'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await evaluate(cdp, alpha, clickText("Quick join"));
  await waitFor(
    cdp,
    alpha,
    "document.body.innerText.includes('Choose and save your callsign')",
    "unsaved callsign gate",
  );
  await evaluate(
    cdp,
    alpha,
    `(() => { const input = document.querySelector('.coop-callsign input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Smoke Alpha'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );

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

  await Promise.all([observeFlight(cdp, alpha), observeFlight(cdp, bravo)]);
  await checkMovement(cdp, alpha, bravo, "p1", "KeyD", "x", 1);
  await checkMovement(cdp, bravo, alpha, "p2", "ArrowUp", "y", -1);

  await evaluate(
    cdp,
    alpha,
    `(() => {
    const fetch = window.fetch;
    window.__failedTicket = false;
    window.__recoveryRequests = [];
    window.fetch = (...args) => {
      window.__recoveryRequests.push(String(args[0]));
      if (!window.__failedTicket && String(args[0]).endsWith('/tickets')) {
        window.__failedTicket = true;
        return Promise.resolve(new Response(JSON.stringify({error:'Temporary smoke-test outage'}), {status:503}));
      }
      return fetch(...args);
    };
    window.__droppedSocket = window.__flightSocket;
    window.__droppedSocket.close(4000, 'Simulated connection loss');
  })()`,
  );
  try {
    await waitFor(
      cdp,
      alpha,
      "window.__failedTicket && window.__flightSocket !== window.__droppedSocket && document.querySelector('.coop-game .coop-link.is-connected')",
      "automatic recovery from socket loss and a temporary ticket failure",
    );
  } catch (error) {
    console.info(
      "Recovery diagnostics",
      await evaluate(
        cdp,
        alpha,
        `({failed:window.__failedTicket,requests:window.__recoveryRequests,changed:window.__flightSocket!==window.__droppedSocket,oldReady:window.__droppedSocket.readyState,newReady:window.__flightSocket.readyState,links:[...document.querySelectorAll('.coop-link')].map(e=>e.className)})`,
      ),
    );
    throw error;
  }
  await checkMovement(cdp, alpha, bravo, "p1", "KeyD", "x", 1);

  await evaluate(
    cdp,
    alpha,
    `(async()=>{
    const resources=performance.getEntriesByType("resource");
    const engineUrl=resources.find(e=>e.name.includes("/src/game/engine.ts"))?.name;
    const rendererUrl=resources.find(e=>e.name.includes("/src/game/coop-renderer.ts"))?.name;
    if(!engineUrl||!rendererUrl) throw new Error("Campaign modules were not loaded by the co-op client");
    const {Game}=await import(engineUrl);
    const {CoopRenderer}=await import(rendererUrl);
    const draw=CoopRenderer.prototype.draw;
    window.__drawTimes=[];
    CoopRenderer.prototype.draw=function(...args){const start=performance.now();const result=draw.apply(this,args);window.__drawTimes.push(performance.now()-start);return result};
    const render=Game.prototype.render, pilot=Game.prototype.renderPilot;
    window.__campaignFrames=0;window.__campaignPilots=0;
    Game.prototype.render=function(){if(this instanceof CoopRenderer) window.__campaignFrames++;return render.call(this)};
    Game.prototype.renderPilot=function(ctx){if(this instanceof CoopRenderer) window.__campaignPilots++;return pilot.call(this,ctx)};
  })()`,
  );
  await waitFor(
    cdp,
    alpha,
    "window.__campaignFrames>3 && window.__campaignPilots>=window.__campaignFrames*2",
    "both pilots drawn by campaign renderer",
  );
  await waitFor(cdp, alpha, "window.__drawTimes.length>=60", "60 native rendered frames");
  const rendering = await evaluate(
    cdp,
    alpha,
    `(() => {
    const times=window.__drawTimes.slice(-60).sort((a,b)=>a-b);
    const canvas=document.querySelector('.coop-arena');
    const rect=canvas.getBoundingClientRect();
    return {meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[56],pixels:canvas.width,expectedPixels:Math.max(1000,Math.round(rect.width*devicePixelRatio)),aspect:rect.width/rect.height};
  })()`,
  );
  assert.equal(rendering.pixels, rendering.expectedPixels);
  assert.ok(Math.abs(rendering.aspect - 10 / 7) < 0.001, "arena must retain campaign proportions");
  console.info(`[coop rendering] ${JSON.stringify(rendering)}`);
  for (const display of [
    { width: 1440, height: 900, deviceScaleFactor: 3, mobile: false },
    { width: 640, height: 480, deviceScaleFactor: 1, mobile: false },
    { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", display, alpha.sessionId);
    try {
      await waitFor(
        cdp,
        alpha,
        `(() => {
      const canvas = document.querySelector('.coop-arena');
      const rect = canvas.getBoundingClientRect();
      return devicePixelRatio === ${display.deviceScaleFactor} &&
        Math.abs(canvas.width - Math.max(1000, Math.round(rect.width * devicePixelRatio))) <= 1 &&
        Math.abs(canvas.height - canvas.width * 0.7) <= 1 &&
        Math.abs(rect.width / rect.height - 10 / 7) < 0.001;
    })()`,
        "sharp canvas after viewport/display-density change",
      );
    } catch (error) {
      console.info(
        "Display diagnostics",
        display,
        await evaluate(
          cdp,
          alpha,
          `(() => {const c=document.querySelector('.coop-arena'),r=c.getBoundingClientRect();return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,dpr:devicePixelRatio}})()`,
        ),
      );
      throw error;
    }
    if (display.width === 640) {
      await cdp.send("Page.bringToFront", {}, alpha.sessionId);
      const point = await evaluate(
        cdp,
        alpha,
        `(() => {
        const r=document.querySelector('button[aria-label="Move left"]').getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`,
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", ...point, button: "left", clickCount: 1 },
        alpha.sessionId,
      );
      await waitFor(
        cdp,
        bravo,
        "window.__flight.players.p1.input.moveX === -1",
        "on-screen movement reaches teammate",
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseMoved", x: 5, y: 5, button: "left", buttons: 1 },
        alpha.sessionId,
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 },
        alpha.sessionId,
      );
      await waitFor(
        cdp,
        bravo,
        "window.__flight.players.p1.input.moveX === 0",
        "movement released outside on-screen button",
      );
    }
  }
  if (process.env.HELIO_SMOKE_SCREENSHOT) {
    const capture = await cdp.send("Page.captureScreenshot", { format: "png" }, alpha.sessionId);
    await writeFile(process.env.HELIO_SMOKE_SCREENSHOT, Buffer.from(capture.data, "base64"));
  }
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
  await observeFlight(cdp, alpha);
  await checkMovement(cdp, alpha, bravo, "p1", "KeyD", "x", 1);

  await cdp.send("Page.bringToFront", {}, bravo.sessionId);
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "Escape", key: "Escape" },
    bravo.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "Escape", key: "Escape" },
    bravo.sessionId,
  );
  await Promise.all([
    waitFor(cdp, alpha, "document.querySelector('.coop-pause')", "shared pause on alpha"),
    waitFor(cdp, bravo, "document.querySelector('.coop-pause')", "shared pause on bravo"),
  ]);
  await cdp.send("Page.bringToFront", {}, alpha.sessionId);
  await capture(cdp, alpha, "helio-coop-pause.png");
  assert.equal(await evaluate(cdp, alpha, clickText("Settings", ".coop-pause button")), true);
  await waitFor(
    cdp,
    alpha,
    "document.querySelector('.coop-settings select')",
    "multiplayer settings",
  );
  assert.equal(
    await evaluate(
      cdp,
      alpha,
      "document.querySelectorAll('.coop-settings input[type=checkbox]').length",
    ),
    4,
  );
  // Escape dismisses the settings subpage, keeping both pilots paused.
  await evaluate(
    cdp,
    alpha,
    "document.querySelector('.coop-settings input[type=checkbox]').click()",
  );
  assert.equal(
    await evaluate(cdp, alpha, "JSON.parse(localStorage.getItem('helios-settings-v1')).autoFire"),
    true,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await waitFor(cdp, alpha, "document.querySelector('.coop-pause-nav')", "return to pause menu");
  assert.equal(await evaluate(cdp, bravo, "Boolean(document.querySelector('.coop-pause'))"), true);
  await evaluate(cdp, alpha, clickText("Developer panel", ".coop-pause button"));
  await waitFor(
    cdp,
    alpha,
    "document.querySelector('.coop-pause input[type=password]')",
    "developer reauthorization after refresh",
  );
  await evaluate(
    cdp,
    alpha,
    `(() => { const input = document.querySelector('.coop-pause input[type=password]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(smokeDeveloperCode)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await evaluate(cdp, alpha, clickText("Unlock developer panel", ".coop-pause button"));
  await waitFor(
    cdp,
    alpha,
    clickText("Max weapons", ".coop-pause button"),
    "authorized developer console",
  );
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.ship.weapons.laser > 0",
    "developer loadout synchronized to teammate",
  );
  await evaluate(cdp, alpha, clickText("Back to pause menu", ".coop-pause button"));
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await Promise.all([
    waitFor(cdp, alpha, "!document.querySelector('.coop-pause')", "alpha resume"),
    waitFor(cdp, bravo, "!document.querySelector('.coop-pause')", "bravo resume"),
  ]);
  await checkMovement(cdp, bravo, alpha, "p2", "ArrowUp", "y", -1);
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.input.fire",
    "multiplayer auto-fire setting",
  );
  await evaluate(
    cdp,
    alpha,
    `(() => { const select = document.querySelector('select[aria-label="Choose secondary weapon"]'); select.value = 'laser'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.ship.primary === 'laser'",
    "secondary weapon selection",
  );
  await cdp.send("Page.bringToFront", {}, alpha.sessionId);
  await evaluate(cdp, alpha, "document.querySelector('.coop-arena').focus()");
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "Digit1", key: "1" },
    alpha.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "Digit1", key: "1" },
    alpha.sessionId,
  );
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.ship.primary === 'pulse'",
    "primary quick slot",
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "KeyD", key: "d" },
    alpha.sessionId,
  );
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.input.moveX === 1",
    "movement before opening loadout",
  );
  await evaluate(cdp, alpha, clickText("Loadout", ".coop-game-actions button"));
  await waitFor(
    cdp,
    bravo,
    "window.__flight.players.p1.input.moveX === 0 && !window.__flight.players.p1.input.fire",
    "loadout releases flight controls",
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "KeyD", key: "d" },
    alpha.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", code: "Escape", key: "Escape" },
    alpha.sessionId,
  );
  await waitFor(
    cdp,
    alpha,
    "!document.querySelector('.coop-shop') && document.querySelector('.coop-game')",
    "Escape closes loadout without leaving multiplayer",
  );
  await evaluate(cdp, bravo, clickText("Pause", ".coop-game-header button"));
  await waitFor(cdp, bravo, "document.querySelector('.coop-pause')", "pause menu before leaving");
  assert.equal(await evaluate(cdp, bravo, clickText("Leave match", ".coop-pause button")), true);
  await waitFor(cdp, bravo, "document.body.innerText.includes('FLY TOGETHER')", "leave return");
  assert.deepEqual(cdp.exceptions, []);
  console.info(
    `[coop readiness] two-browser room ${roomCode}: movement, display density, reconnect recovery, shared pause, settings, callsign gate, developer authorization, weapon slots, loadout controls and leave passed`,
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

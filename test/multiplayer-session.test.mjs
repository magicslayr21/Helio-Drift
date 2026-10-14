import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(
          readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", "({ DEV: true })"),
          {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          },
        ).outputText,
      };
    }
    return nextLoad(url, context);
  },
});

const values = new Map();
globalThis.window = {
  location: { href: "https://game.example/Helio-Drift/" },
};
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};

const { CoopConnection, apiToWebSocketUrl, clearCoopSession, loadCoopSession, saveCoopSession } =
  await import("../src/multiplayer/client.ts");

const room = {
  code: "ABC234",
  visibility: "private",
  name: null,
  phase: "waiting",
  playerCount: 1,
  capacity: 2,
  joinable: true,
  createdAt: 1,
  expiresAt: 2,
  players: {
    p1: { id: "p1", callsign: "Alpha", ready: false, connected: false, left: false },
    p2: null,
  },
};

test("co-op reconnect sessions survive refresh but reject malformed capabilities", () => {
  const session = {
    roomCode: "ABC234",
    playerId: "p1",
    reconnectToken: "A".repeat(43),
    room,
  };
  saveCoopSession(session);
  assert.deepEqual(loadCoopSession(), session);
  values.set("helios-coop-session-v1", JSON.stringify({ ...session, reconnectToken: "unsafe" }));
  assert.equal(loadCoopSession(), null);
  clearCoopSession();
  assert.equal(loadCoopSession(), null);
});

test("HTTP multiplayer API locations convert to same-origin WebSocket routes", () => {
  assert.equal(
    apiToWebSocketUrl("https://relay.example/api", "/rooms/ABC234/socket?ticket=token"),
    "wss://relay.example/api/rooms/ABC234/socket?ticket=token",
  );
  assert.equal(
    apiToWebSocketUrl("/multiplayer-api", "/rooms/ABC234/socket?ticket=token"),
    "wss://game.example/multiplayer-api/rooms/ABC234/socket?ticket=token",
  );
});

function connectionFixture(t, fetchTicket) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    WebSocket: globalThis.WebSocket,
  };
  globalThis.window = Object.assign(new EventTarget(), {
    location: previous.window.location,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const sockets = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    }
    message(data) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close(code = 1000) {
      this.readyState = 3;
      this.dispatchEvent(Object.assign(new Event("close"), { code }));
    }
  }
  globalThis.WebSocket = Socket;
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    fetchTicket ??
      (async () => {
        requests++;
        return { ok: true, json: async () => ({ socketTicket: `ticket-${requests}` }) };
      }),
  );
  const states = [],
    messages = [];
  const session = { roomCode: room.code, playerId: "p1", reconnectToken: "A".repeat(43), room };
  saveCoopSession(session);
  const connection = new CoopConnection(
    session,
    (m) => messages.push(m),
    (s) => states.push(s),
  );
  t.after(() => {
    connection.close();
    Object.assign(globalThis, previous);
  });
  return { connection, sockets, states, messages, session, requests: () => requests };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const welcome = { type: "welcome", playerId: "p1", room };

test("stalled handshakes retry with a fresh ticket and require welcome before connected", async (t) => {
  const f = connectionFixture(t);
  await f.connection.connect();
  f.sockets[0].open();
  assert.equal(f.states.at(-1), "connecting");
  t.mock.timers.tick(12_001);
  assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.states.at(-1), "reconnecting");
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(f.sockets.length, 2);
  assert.notEqual(f.sockets[0].url, f.sockets[1].url);
  f.sockets[1].open();
  f.sockets[1].message(welcome);
  assert.equal(f.states.at(-1), "connected");
});

test("silent connections recover after a network change and old sockets cannot deliver data", async (t) => {
  const f = connectionFixture(t);
  await f.connection.connect();
  const old = f.sockets[0];
  old.open();
  old.message(welcome);
  t.mock.timers.tick(30_001);
  assert.equal(f.states.at(-1), "reconnecting");
  window.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(f.sockets.length, 2);
  old.message({ type: "error", code: "stale", message: "old socket" });
  assert.equal(
    f.messages.some((m) => m.code === "stale"),
    false,
  );
  f.sockets[1].open();
  f.sockets[1].message(welcome);
  assert.equal(f.states.at(-1), "connected");
});

test("replaced tabs stop retrying without deleting the shared reconnect session", async (t) => {
  const f = connectionFixture(t);
  await f.connection.connect();
  f.sockets[0].open();
  f.sockets[0].message(welcome);
  f.sockets[0].message({
    type: "error",
    code: "session_replaced",
    message: "Another tab connected.",
  });
  assert.equal(f.states.at(-1), "closed");
  t.mock.timers.tick(60_000);
  window.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(f.requests(), 1);
  assert.deepEqual(loadCoopSession(), f.session);
});

test("closing or restarting a pending ticket request cannot resurrect an old connection", async (t) => {
  const pending = [];
  const f = connectionFixture(
    t,
    (_url, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal })),
  );
  const first = f.connection.connect();
  const second = f.connection.connect();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ ok: true, json: async () => ({ socketTicket: "new" }) });
  await second;
  pending[0].resolve({ ok: true, json: async () => ({ socketTicket: "old" }) });
  await first;
  assert.equal(f.sockets.length, 1);
  assert.match(f.sockets[0].url, /ticket=new/);
  const third = f.connection.connect();
  f.connection.close();
  pending[2].resolve({ ok: true, json: async () => ({ socketTicket: "closed" }) });
  await third;
  assert.equal(f.sockets.length, 1);
  assert.equal(f.states.at(-1), "closed");
});

test("temporary ticket errors retry but expired sessions stop with a useful error", async (t) => {
  let count = 0;
  const f = connectionFixture(t, async () =>
    ++count === 1
      ? { ok: false, status: 503, json: async () => ({ error: "temporarily unavailable" }) }
      : { ok: false, status: 401, json: async () => ({ error: "expired" }) },
  );
  await f.connection.connect();
  assert.equal(f.states.at(-1), "reconnecting");
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(f.states.at(-1), "closed");
  assert.equal(f.messages.at(-1).code, "session_expired");
  assert.equal(loadCoopSession(), null);
  t.mock.timers.tick(60_000);
  assert.equal(count, 2);
});

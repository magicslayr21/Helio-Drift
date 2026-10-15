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

const {
  CoopConnection,
  apiToWebSocketUrl,
  clearCoopSession,
  createPrivateRoom,
  getPublicRooms,
  joinRoom,
  loadCoopSession,
  quickJoinRoom,
  saveCoopSession,
} = await import("../src/multiplayer/client.ts");

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
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
const advance = async (t, duration = 3_000) => {
  for (let elapsed = 0; elapsed < duration; elapsed += 250) {
    t.mock.timers.tick(Math.min(250, duration - elapsed));
    await flush();
  }
};
const welcome = { type: "welcome", playerId: "p1", room };

function requestFixture(t, responder) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const previous = globalThis.window;
  globalThis.window = { ...previous, setTimeout, clearTimeout };
  values.clear();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = { url, ...options, body: options.body && JSON.parse(options.body) };
    requests.push(request);
    return responder(request, requests.length);
  });
  t.after(() => {
    globalThis.window = previous;
    values.clear();
  });
  return requests;
}

const successfulJoin = () => ({
  ok: true,
  json: async () => ({
    roomCode: room.code,
    playerId: "p2",
    reconnectToken: "B".repeat(43),
    room,
  }),
});

test("joining recovers from a dropped response with the same secure admission token", async (t) => {
  const requests = requestFixture(t, (_request, attempt) => {
    if (attempt === 1) throw new TypeError("Failed to fetch");
    return successfulJoin();
  });
  const joining = joinRoom("Retry Alpha", " abc234 ");
  await flush();
  assert.equal(requests.length, 1);
  await advance(t);
  const session = await joining;
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/rooms\/ABC234\/join$/);
  assert.match(requests[0].body.joinToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(requests[1].body, requests[0].body);
  assert.equal(loadCoopSession().reconnectToken, session.reconnectToken);
});

test("an exhausted join can be tried again without losing its reserved identity", async (t) => {
  let available = false;
  const requests = requestFixture(t, () => {
    if (!available) throw new TypeError("Failed to fetch");
    return successfulJoin();
  });
  const first = assert.rejects(joinRoom("Lost Alpha", "ABC235"), /reach|connection|network/i);
  await flush();
  await advance(t);
  await first;
  assert.equal(requests.length, 3);
  const token = requests[0].body.joinToken;
  assert.equal(requests.every((request) => request.body.joinToken === token), true);
  available = true;
  await joinRoom(" Lost Alpha ", " abc235 ");
  assert.equal(requests.length, 4);
  assert.equal(requests[3].body.joinToken, token);
});

test("manual retry after a rate-limited replay keeps the original reserved identity", async (t) => {
  const requests = requestFixture(t, (_request, attempt) => {
    if (attempt === 1) throw new TypeError("The join response was lost after admission.");
    if (attempt === 2)
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: "Please wait before trying again." }),
      };
    return successfulJoin();
  });
  const interrupted = assert.rejects(joinRoom("Rate Limited Pilot", "ABC239"), {
    status: 429,
    message: "Please wait before trying again.",
  });
  await flush();
  await advance(t);
  await interrupted;
  assert.equal(requests.length, 2);
  const token = requests[0].body.joinToken;
  assert.equal(requests[1].body.joinToken, token);
  await joinRoom("Rate Limited Pilot", "ABC239");
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.joinToken, token);
});

test("an expired pending admission rotates its capability before a later join", async (t) => {
  let available = false;
  const requests = requestFixture(t, () => {
    if (!available) throw new TypeError("Failed to fetch");
    return successfulJoin();
  });
  const interrupted = assert.rejects(joinRoom("Expired Pilot", "ABC23A"), /reach|connection/i);
  await flush();
  await advance(t);
  await interrupted;
  assert.equal(requests.length, 3);
  const expiredToken = requests[0].body.joinToken;
  t.mock.timers.tick(10 * 60_000);
  available = true;
  await joinRoom("Expired Pilot", "ABC23A");
  assert.equal(requests.length, 4);
  assert.match(requests[3].body.joinToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(requests[3].body.joinToken, expiredToken);
});

test("quick join preserves admission identity while recovering a lost response", async (t) => {
  const requests = requestFixture(t, (_request, attempt) => {
    if (attempt < 3) throw new TypeError("Load failed");
    return successfulJoin();
  });
  const joining = quickJoinRoom("Quick Alpha");
  await flush();
  await advance(t);
  await joining;
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /\/rooms\/quick$/);
  assert.match(requests[0].body.joinToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    requests.every((request) => request.body.joinToken === requests[0].body.joinToken),
    true,
  );
});

test("pending admissions do not share a capability between different pilots or rooms", async (t) => {
  const requests = requestFixture(t, () => {
    throw new TypeError("Failed to fetch");
  });
  for (const [callsign, code] of [
    ["First Pilot", "ABC237"],
    ["Second Pilot", "ABC237"],
    ["First Pilot", "ABC238"],
  ]) {
    const rejected = assert.rejects(joinRoom(callsign, code), /reach|connection|network/i);
    await flush();
    await advance(t);
    await rejected;
  }
  assert.equal(requests.length, 9);
  assert.equal(new Set([requests[0], requests[3], requests[6]].map((r) => r.body.joinToken)).size, 3);
});

test("permanent join errors retain the server explanation and are never retried", async (t) => {
  let status = 409;
  const requests = requestFixture(t, () => ({
    ok: false,
    status,
    json: async () => ({ error: `Room admission rejected (${status}).` }),
  }));
  for (status of [400, 401, 403, 404, 409, 410, 422, 429]) {
    const count = requests.length;
    const rejected = assert.rejects(joinRoom(`Rejected ${status}`, "ABC236"), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message, `Room admission rejected (${status}).`);
      return true;
    });
    await flush();
    await advance(t);
    await rejected;
    assert.equal(requests.length, count + 1);
  }
});

test("room browsing retries temporary gateway responses even when the body is HTML", async (t) => {
  const page = { rooms: [], nextCursor: "next-page" };
  const requests = requestFixture(t, (_request, attempt) =>
    attempt === 1
      ? {
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        }
      : { ok: true, json: async () => page },
  );
  const browsing = getPublicRooms("cursor /?", 10);
  await flush();
  await advance(t);
  assert.deepEqual(await browsing, page);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /limit=10&cursor=cursor%20%2F%3F$/);
  assert.equal(requests[1].url, requests[0].url);
});

test("safe room requests retry transient HTTP errors but stop after three attempts", async (t) => {
  let status = 408;
  const requests = requestFixture(t, () => ({
    ok: false,
    status,
    json: async () => ({ error: "Temporary relay outage." }),
  }));
  for (status of [408, 500, 502, 503, 504]) {
    const count = requests.length;
    const rejected = assert.rejects(getPublicRooms(), (error) => {
      assert.equal(error.status, status);
      return true;
    });
    await flush();
    await advance(t);
    await rejected;
    assert.equal(requests.length, count + 3);
  }
});

test("an invalid successful gateway body can recover without exposing a JSON error", async (t) => {
  const page = { rooms: [], nextCursor: null };
  const requests = requestFixture(t, (_request, attempt) =>
    attempt === 1
      ? {
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        }
      : { ok: true, json: async () => page },
  );
  const browsing = getPublicRooms();
  await flush();
  await advance(t);
  assert.deepEqual(await browsing, page);
  assert.equal(requests.length, 2);
});

test("room request timeouts retry within a bounded window and report a useful error", async (t) => {
  const requests = requestFixture(
    t,
    ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const browsing = assert.rejects(getPublicRooms(), /too long|timed out/i);
  await flush();
  await advance(t, 48_000);
  await browsing;
  assert.equal(requests.length, 3);
  assert.equal(requests.every((request) => request.signal.aborted), true);
});

test("aborting a browse during retry backoff prevents further requests", async (t) => {
  const requests = requestFixture(t, () => {
    throw new TypeError("Failed to fetch");
  });
  const controller = new AbortController();
  const browsing = assert.rejects(getPublicRooms("", 20, controller.signal), {
    name: "AbortError",
  });
  await flush();
  assert.equal(requests.length, 1);
  controller.abort();
  await browsing;
  await advance(t);
  assert.equal(requests.length, 1);
});

test("an already cancelled room browser never sends a network request", async (t) => {
  const requests = requestFixture(t, () => ({ ok: true, json: async () => ({ rooms: [] }) }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getPublicRooms("", 20, controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 0);
});

test("room creation does not repeat an operation whose result was lost", async (t) => {
  const requests = requestFixture(t, () => {
    throw new TypeError("Failed to fetch");
  });
  const creating = assert.rejects(createPrivateRoom("Host", "developer-token"), /reach|connection/i);
  await flush();
  await advance(t);
  await creating;
  assert.equal(requests.length, 1);
});

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

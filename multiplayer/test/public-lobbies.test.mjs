import assert from "node:assert/strict";
import test from "node:test";
import { multiplayerFixture } from "./fixture.mjs";
import { LobbyIndex, MatchRoom, handleRequest } from "../../multiplayer-dist/worker.js";

const send = (socket, message) => socket.send(JSON.stringify(message));

test("public listing exposes safe room summaries and never private rooms", async (t) => {
  const app = await multiplayerFixture(t);
  const privateRoom = await app.create("Hidden Pilot");
  const publicRoom = await app.createPublic("Outer Rim Patrol", "Open Pilot");
  assert.equal(publicRoom.room.visibility, "public");
  assert.equal(publicRoom.room.name, "Outer Rim Patrol");
  assert.equal(publicRoom.room.playerCount, 1);
  assert.equal(publicRoom.room.capacity, 2);
  assert.equal(publicRoom.room.joinable, true);

  const listing = await app.request("/rooms/public");
  assert.equal(listing.status, 200);
  assert.deepEqual(
    listing.data.rooms.map((room) => room.code),
    [publicRoom.roomCode],
  );
  assert.equal(listing.data.rooms[0].phase, "waiting");
  assert.equal(listing.data.rooms[0].name, "Outer Rim Patrol");
  assert.equal(JSON.stringify(listing.data).includes(privateRoom.roomCode), false);
  assert.equal(JSON.stringify(listing.data).includes(publicRoom.reconnectToken), false);
  assert.equal(JSON.stringify(listing.data).includes("Open Pilot"), false);

  assert.equal(
    (
      await app.request("/rooms/public", {
        method: "POST",
        body: { name: "Unauthorized Patrol", callsign: "Pilot" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request("/rooms/public", {
        method: "POST",
        token: app.developerToken,
        body: { name: "!", callsign: "Pilot" },
      })
    ).status,
    400,
  );
});

test("public listing paginates stably with bounded limits", async (t) => {
  const app = await multiplayerFixture(t);
  const created = [];
  for (const name of ["Alpha Flight", "Bravo Flight", "Charlie Flight"])
    created.push(await app.createPublic(name));

  const first = await app.request("/rooms/public?limit=2");
  assert.equal(first.status, 200);
  assert.equal(first.data.rooms.length, 2);
  assert.match(first.data.nextCursor, /^\d{10,16}\.[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  const second = await app.request(`/rooms/public?limit=2&cursor=${first.data.nextCursor}`);
  assert.equal(second.status, 200);
  assert.equal(second.data.rooms.length, 1);
  assert.equal(second.data.nextCursor, null);
  assert.deepEqual(
    [...first.data.rooms, ...second.data.rooms].map((room) => room.code),
    created.map((room) => room.roomCode),
  );
  assert.equal((await app.request("/rooms/public?limit=0")).status, 400);
  assert.equal((await app.request("/rooms/public?cursor=invalid")).status, 400);
});

test("simultaneous Quick Join calls allocate the final slot atomically", async (t) => {
  const app = await multiplayerFixture(t);
  const room = await app.createPublic("Atomic Patrol");
  const [first, second] = await Promise.all([
    app.request("/rooms/quick", { method: "POST", body: { callsign: "Quick One" } }),
    app.request("/rooms/quick", { method: "POST", body: { callsign: "Quick Two" } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 404]);
  const joined = first.status === 200 ? first.data : second.data;
  assert.equal(joined.roomCode, room.roomCode);
  assert.equal(joined.playerId, "p2");
  assert.match(joined.reconnectToken, /^[A-Za-z0-9_-]{43}$/);

  const listing = await app.request("/rooms/public");
  assert.equal(listing.data.rooms[0].playerCount, 2);
  assert.equal(listing.data.rooms[0].joinable, false);
  assert.equal(
    (await app.request("/rooms/quick", { method: "POST", body: { callsign: "Quick Three" } }))
      .status,
    404,
  );
});

test("Quick Join recovers a lost response from the same full room after restart", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.createPublic("Retry Patrol", "Original Pilot");
  const second = await app.createPublic("Other Patrol", "Other Pilot");
  const body = { callsign: "Retry Pilot", joinToken: "Q".repeat(43) };
  const initial = await app.request("/rooms/quick", { method: "POST", body });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.roomCode, first.roomCode);
  assert.equal(initial.data.reconnectToken, body.joinToken);
  await app.restart();
  const [repeated, concurrent] = await Promise.all([
    app.request("/rooms/quick", { method: "POST", body }),
    app.request("/rooms/quick", { method: "POST", body }),
  ]);
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.data, initial.data);
  assert.deepEqual(concurrent.data, initial.data);
  const untouched = await app.request(`/rooms/${second.roomCode}`);
  assert.equal(untouched.data.room.playerCount, 1);
  const conflict = await app.request("/rooms/quick", {
    method: "POST",
    body: { ...body, callsign: "Different Pilot" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "join_conflict");
  const listing = await app.request("/rooms/public");
  assert.equal(JSON.stringify(listing.data).includes(body.joinToken), false);
  assert.equal(JSON.stringify(listing.data).includes("join:"), false);

  const a = await app.connect(first),
    b = await app.connect(repeated.data);
  send(a.socket, { type: "ready", ready: true });
  send(b.socket, { type: "ready", ready: true });
  await app.nextMessage(
    a.socket,
    (m) => m.type === "room" && m.room.players.p1.ready && m.room.players.p2?.ready,
  );
  send(a.socket, { type: "start" });
  await app.nextMessage(a.socket, (m) => m.type === "snapshot");
  const runningReplay = await app.request("/rooms/quick", { method: "POST", body });
  assert.equal(runningReplay.status, 200);
  assert.equal(runningReplay.data.roomCode, first.roomCode);
  assert.equal(runningReplay.data.room.phase, "running");
  assert.equal((await app.request(`/rooms/${second.roomCode}`)).data.room.playerCount, 1);
});

test("distinct retryable Quick Join attempts retain distinct slots", async (t) => {
  const app = await multiplayerFixture(t);
  await app.createPublic("First Patrol");
  await app.createPublic("Second Patrol");
  const firstBody = { callsign: "First Guest", joinToken: "R".repeat(43) };
  const secondBody = { callsign: "Second Guest", joinToken: "S".repeat(43) };
  const [first, second] = await Promise.all([
    app.request("/rooms/quick", { method: "POST", body: firstBody }),
    app.request("/rooms/quick", { method: "POST", body: secondBody }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.data.roomCode, second.data.roomCode);
  assert.equal(first.data.reconnectToken, firstBody.joinToken);
  assert.equal(second.data.reconnectToken, secondBody.joinToken);
});

test("Quick Join never moves a departed retry token into another room", async (t) => {
  const app = await multiplayerFixture(t);
  await app.createPublic("Initial Patrol");
  const other = await app.createPublic("Next Patrol");
  const body = { callsign: "Departing Pilot", joinToken: "V".repeat(43) };
  const joined = await app.request("/rooms/quick", { method: "POST", body });
  const { socket } = await app.connect(joined.data);
  await app.nextMessage(socket, (m) => m.type === "welcome");
  const closed = app.nextClose(socket);
  send(socket, { type: "leave" });
  await closed;
  await app.restart();
  const repeated = await app.request("/rooms/quick", { method: "POST", body });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.data.code, "join_unavailable");
  assert.equal((await app.request(`/rooms/${other.roomCode}`)).data.room.playerCount, 1);
});

test("Quick Join persists its target before a post-allocation transport failure", async () => {
  const code = "ABC234";
  const rooms = {
    [code]: {
      code,
      name: "Retry Patrol",
      visibility: "public",
      phase: "waiting",
      playerCount: 1,
      joinable: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  };
  const saved = new Map([["rooms", structuredClone(rooms)]]);
  let alarm = null;
  const storage = {
    get: async (key) => structuredClone(saved.get(key)),
    put: async (key, value) => {
      saved.set(key, structuredClone(value));
    },
    delete: async (key) => saved.delete(key),
    getAlarm: async () => alarm,
    setAlarm: async (value) => {
      alarm = value;
    },
    list: async ({ prefix }) => new Map([...saved].filter(([key]) => key.startsWith(prefix))),
  };
  const state = {
    storage,
    blockConcurrencyWhile: (operation) => operation(),
    getWebSockets: () => [],
  };
  const room = new MatchRoom(state, {});
  await room.ready;
  room.room = {
    ...rooms[code],
    players: { p1: { id: "p1", callsign: "Original Pilot" }, p2: null },
  };
  room.persist = async () => {};
  let dropFirst = true;
  const env = {
    MATCH_ROOMS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url, init) => {
          const response = await room.fetch(new Request(url, init));
          if (dropFirst) {
            dropFirst = false;
            throw new Error("injected lost room response");
          }
          return response;
        },
      }),
    },
  };
  let lobby = new LobbyIndex(state, env);
  const join = () =>
    lobby.fetch(
      new Request("https://lobby.internal/internal/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: "Retry Pilot", joinToken: "W".repeat(43) }),
      }),
    );
  assert.equal((await join()).status, 500);
  assert.equal(room.room.players.p2.callsign, "Retry Pilot");
  assert.equal([...saved.keys()].filter((key) => key.startsWith("join:")).length, 1);
  assert.equal(JSON.stringify([...saved]).includes("W".repeat(43)), false);
  lobby = new LobbyIndex(state, env);
  const replayed = await join();
  assert.equal(replayed.status, 200);
  const result = await replayed.json();
  assert.equal(result.roomCode, code);
  assert.equal(result.playerId, "p2");
  assert.equal(result.reconnectToken, "W".repeat(43));
  assert.ok(alarm > Date.now());
  // Discovery persistence is secondary to the already committed room membership.
  const put = storage.put;
  storage.put = async (key, value) => {
    if (key === "rooms") throw new Error("injected discovery persistence failure");
    return put(key, value);
  };
  assert.equal((await join()).status, 200);
});

test("Durable Object transport failures return a retryable response with CORS", async () => {
  const response = await handleRequest(
    new Request("https://multiplayer.example/api/rooms/ABC234/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ callsign: "Retry Pilot", joinToken: "Y".repeat(43) }),
    }),
    {
      MULTIPLAYER_ORIGINS: "http://localhost:5173",
      MATCH_ROOMS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => {
            throw new Error("injected transport failure");
          },
        }),
      },
    },
  );
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.equal((await response.json()).error, "Multiplayer service failed.");
});

test("late discovery summaries cannot resurrect started or deleted rooms after restart", async () => {
  const saved = new Map();
  const state = {
    storage: {
      get: async (key) => structuredClone(saved.get(key)),
      put: async (key, value) => {
        saved.set(key, structuredClone(value));
      },
    },
    blockConcurrencyWhile: (operation) => operation(),
  };
  let lobby = new LobbyIndex(state, {});
  await lobby.ready;
  const waiting = {
    code: "ABC234",
    name: "Versioned Patrol",
    visibility: "public",
    phase: "waiting",
    playerCount: 1,
    createdAt: 100,
    expiresAt: Date.now() + 60_000,
    revision: 100,
  };
  lobby.upsert(waiting);
  lobby.upsert({ ...waiting, phase: "running", revision: 101 });
  lobby.upsert(waiting);
  assert.deepEqual(lobby.sortedRooms(), []);
  await lobby.persist();
  lobby = new LobbyIndex(state, {});
  await lobby.ready;
  lobby.upsert(waiting);
  assert.deepEqual(lobby.sortedRooms(), []);
  const deleted = await lobby.fetch(
    new Request("https://lobby.internal/internal/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: waiting.code, revision: 102 }),
    }),
  );
  assert.equal(deleted.status, 204);
  lobby.upsert({ ...waiting, revision: 101 });
  lobby.upsert({ ...waiting, revision: 102 });
  assert.deepEqual(lobby.sortedRooms(), []);
  // Checkpoints created before revision tracking still accept fresh summaries.
  const legacy = { ...waiting, code: "ABC235", revision: undefined };
  lobby.upsert(legacy);
  const [listed] = lobby.sortedRooms();
  assert.equal(listed.code, legacy.code);
  assert.equal("revision" in listed, false);

  lobby.rooms = {};
  lobby.upsert(waiting);
  lobby.env.MATCH_ROOMS = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async () =>
        new Response(JSON.stringify({ error: "Match already started." }), { status: 409 }),
    }),
  };
  const failedQuickJoin = await lobby.fetch(
    new Request("https://lobby.internal/internal/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callsign: "Late Pilot" }),
    }),
  );
  assert.equal(failedQuickJoin.status, 404);
  lobby.upsert(waiting);
  assert.deepEqual(lobby.sortedRooms(), [], "Quick Join must retain its stale-entry tombstone");
});

test("room discovery queues immutable summaries and keeps revisions monotonic", async () => {
  const sent = [];
  let unblock;
  const actor = new MatchRoom(
    {
      storage: { get: async () => undefined },
      blockConcurrencyWhile: (operation) => operation(),
      getWebSockets: () => [],
    },
    {
      LOBBY_INDEX: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (_url, init) => {
            sent.push(JSON.parse(init.body));
            if (sent.length === 1)
              await new Promise((resolve) => {
                unblock = resolve;
              });
            return new Response(null, { status: 204 });
          },
        }),
      },
    },
  );
  await actor.ready;
  actor.room = {
    code: "ABC234",
    name: "Ordered Patrol",
    visibility: "public",
    phase: "waiting",
    players: { p1: { id: "p1", callsign: "Alpha" }, p2: null },
    updatedAt: Date.now() + 1000,
  };
  const firstRevision = actor.room.updatedAt;
  const first = actor.syncLobby();
  actor.room.phase = "running";
  actor.touch();
  assert.equal(actor.room.updatedAt, firstRevision + 1);
  const second = actor.syncLobby();
  await Promise.resolve();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].room.phase, "waiting");
  assert.equal(sent[0].room.revision, firstRevision);
  unblock();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].room.phase, "running");
  assert.equal(sent[1].room.revision, firstRevision + 1);
  assert.equal("revision" in actor.view(), false);
});

test("direct joins and leaves keep public capacity synchronized", async (t) => {
  const app = await multiplayerFixture(t);
  const creator = await app.createPublic("Capacity Patrol", "Creator");
  const joined = await app.joinRoom(creator.roomCode, "Second Pilot");
  assert.equal(joined.status, 200);
  let listing = await app.request("/rooms/public");
  assert.equal(listing.data.rooms[0].playerCount, 2);
  assert.equal(listing.data.rooms[0].joinable, false);

  const connection = await app.connect(creator);
  await app.nextMessage(connection.socket, (message) => message.type === "welcome");
  const closed = app.nextClose(connection.socket);
  send(connection.socket, { type: "leave" });
  assert.equal((await closed).code, 1000);
  listing = await app.request("/rooms/public");
  assert.equal(listing.data.rooms[0].playerCount, 1);
  assert.equal(listing.data.rooms[0].joinable, true);

  const secondConnection = await app.connect(joined.data);
  await app.nextMessage(secondConnection.socket, (message) => message.type === "welcome");
  const secondClosed = app.nextClose(secondConnection.socket);
  send(secondConnection.socket, { type: "leave" });
  assert.equal((await secondClosed).code, 1000);
  listing = await app.request("/rooms/public");
  assert.equal(
    listing.data.rooms.some((room) => room.code === creator.roomCode),
    false,
  );
});

test("starting a public match removes it from discovery", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.createPublic("Launch Patrol", "Alpha");
  const second = (await app.joinRoom(first.roomCode, "Bravo")).data;
  const a = await app.connect(first);
  const b = await app.connect(second);
  await Promise.all([
    app.nextMessage(a.socket, (message) => message.type === "welcome"),
    app.nextMessage(b.socket, (message) => message.type === "welcome"),
  ]);
  send(a.socket, { type: "ready", ready: true });
  send(b.socket, { type: "ready", ready: true });
  await app.nextMessage(
    a.socket,
    (message) =>
      message.type === "room" && message.room.players.p1.ready && message.room.players.p2.ready,
  );
  send(b.socket, { type: "start" });
  await app.nextMessage(a.socket, (message) => message.type === "snapshot");
  const listing = await app.request("/rooms/public");
  assert.equal(
    listing.data.rooms.some((room) => room.code === first.roomCode),
    false,
  );
});

test("public index survives restart and concurrent room creation", async (t) => {
  const app = await multiplayerFixture(t);
  const responses = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      app.request("/rooms/public", {
        method: "POST",
        token: app.developerToken,
        body: { name: `Patrol ${index + 1}`, callsign: `Pilot ${index + 1}` },
      }),
    ),
  );
  assert.ok(responses.every((response) => response.status === 201));
  assert.equal(new Set(responses.map((response) => response.data.roomCode)).size, 6);
  await app.restart();
  const listing = await app.request("/rooms/public?limit=50");
  assert.equal(listing.data.rooms.length, 6);
  const quick = await app.request("/rooms/quick", {
    method: "POST",
    body: { callsign: "Restart Pilot" },
  });
  assert.equal(quick.status, 200);
  assert.equal(quick.data.roomCode, responses[0].data.roomCode);
});

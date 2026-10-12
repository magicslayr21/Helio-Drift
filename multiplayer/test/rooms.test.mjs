import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { multiplayerFixture } from "./fixture.mjs";

const send = (socket, message) => socket.send(JSON.stringify(message));

test("health, CORS and input validation are isolated from the leaderboard service", async (t) => {
  const app = await multiplayerFixture(t);
  const health = await app.request("/health", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(health.status, 200);
  assert.equal(health.data.service, "helio-drift-multiplayer");
  assert.equal(health.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.equal(
    (await app.request("/health", { headers: { Origin: "https://attacker.example" } })).status,
    403,
  );
  assert.equal(
    (await app.request("/rooms/private", { method: "POST", body: { callsign: "Open Pilot" } }))
      .status,
    401,
  );
  assert.equal(
    (
      await app.request("/rooms/private", {
        method: "POST",
        token: "A".repeat(43),
        body: { callsign: "Open Pilot" },
      })
    ).status,
    401,
  );
  const expiredToken = "E".repeat(43);
  await app.db
    .prepare("INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)")
    .bind(createHash("sha256").update(expiredToken).digest("hex"), Date.now() - 1)
    .run();
  assert.equal(
    (
      await app.request("/rooms/private", {
        method: "POST",
        token: expiredToken,
        body: { callsign: "Open Pilot" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request("/rooms/private", {
        method: "POST",
        token: app.developerToken,
        body: { callsign: "!" },
      })
    ).status,
    400,
  );
  assert.equal((await app.request("/rooms/INVALID"))?.status, 400);
  assert.equal(
    (
      await app.request("/rooms/private", {
        method: "POST",
        token: app.developerToken,
        rawBody: JSON.stringify({ callsign: "x".repeat(5000) }),
      })
    ).status,
    413,
  );
});

test("private rooms enforce two slots and simultaneous joins are atomic", async (t) => {
  const app = await multiplayerFixture(t);
  const creator = await app.create();
  assert.match(creator.roomCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.equal(creator.playerId, "p1");
  assert.match(creator.reconnectToken, /^[A-Za-z0-9_-]{43}$/);

  const [first, second] = await Promise.all([
    app.joinRoom(creator.roomCode, "Nova Two"),
    app.joinRoom(creator.roomCode, "Nova Three"),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const joined = first.status === 200 ? first.data : second.data;
  assert.equal(joined.playerId, "p2");
  assert.equal((await app.joinRoom(creator.roomCode, "Late Pilot")).status, 409);
  const status = await app.request(`/rooms/${creator.roomCode}`);
  assert.equal(status.data.room.players.p1.callsign, "Comet One");
  assert.equal(status.data.room.players.p2.callsign, joined.room.players.p2.callsign);
});

test("leaving a waiting room releases either slot without transferring host powers", async (t) => {
  const app = await multiplayerFixture(t);
  const creator = await app.create("Original One");
  const second = (await app.joinRoom(creator.roomCode, "Original Two")).data;
  const connection = await app.connect(creator);
  await app.nextMessage(connection.socket, (message) => message.type === "welcome");
  const closed = app.nextClose(connection.socket);
  send(connection.socket, { type: "leave" });
  assert.equal((await closed).code, 1000);
  const replacement = await app.joinRoom(creator.roomCode, "Replacement One");
  assert.equal(replacement.status, 200);
  assert.equal(replacement.data.playerId, "p1");
  assert.equal(replacement.data.room.players.p2.callsign, second.room.players.p2.callsign);
});

test("reconnect tokens issue one-use socket tickets without appearing in room state", async (t) => {
  const app = await multiplayerFixture(t);
  const creator = await app.create();
  const invalid = await app.request(`/rooms/${creator.roomCode}/tickets`, {
    method: "POST",
    token: "A".repeat(43),
  });
  assert.equal(invalid.status, 401);
  const { socket, ticket } = await app.connect(creator);
  const welcome = await app.nextMessage(socket, (message) => message.type === "welcome");
  assert.equal(welcome.playerId, "p1");
  assert.equal(
    JSON.stringify(welcome),
    JSON.stringify(welcome).replaceAll(creator.reconnectToken, ""),
  );
  const reused = await app.request(`/rooms/${creator.roomCode}/socket?ticket=${ticket}`, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(reused.status, 401);

  const replaced = app.nextMessage(socket, (message) => message.code === "session_replaced");
  const replacement = await app.connect(creator);
  assert.equal((await replaced).type, "error");
  assert.equal(
    (await app.nextMessage(replacement.socket, (message) => message.type === "welcome")).playerId,
    "p1",
  );
});

test("oversized and rate-flooded socket messages are closed at the room boundary", async (t) => {
  const app = await multiplayerFixture(t);
  const identity = await app.create();
  const oversized = await app.connect(identity);
  await app.nextMessage(oversized.socket, (message) => message.type === "welcome");
  const oversizedClose = app.nextClose(oversized.socket);
  oversized.socket.send("x".repeat(5000));
  assert.equal((await oversizedClose).code, 4009);

  const flooded = await app.connect(identity);
  await app.nextMessage(flooded.socket, (message) => message.type === "welcome");
  const floodedClose = app.nextClose(flooded.socket);
  for (let index = 0; index < 100; index++) send(flooded.socket, { type: "heartbeat" });
  assert.equal((await floodedClose).code, 4008);
});

test("either ready player can start and receive 15 Hz authoritative snapshots", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Alpha");
  const secondResponse = await app.joinRoom(first.roomCode, "Bravo");
  assert.equal(secondResponse.status, 200);
  const second = secondResponse.data;
  const firstConnection = await app.connect(first);
  const secondConnection = await app.connect(second);
  await Promise.all([
    app.nextMessage(firstConnection.socket, (message) => message.type === "welcome"),
    app.nextMessage(secondConnection.socket, (message) => message.type === "welcome"),
  ]);
  send(firstConnection.socket, { type: "ready", ready: true });
  send(secondConnection.socket, { type: "ready", ready: true });
  await app.nextMessage(
    secondConnection.socket,
    (message) =>
      message.type === "room" && message.room.players.p1.ready && message.room.players.p2.ready,
  );
  send(secondConnection.socket, { type: "start" });
  const initial = await app.nextMessage(
    firstConnection.socket,
    (message) => message.type === "snapshot",
  );
  assert.equal(initial.state.phase, "running");
  assert.ok(Buffer.byteLength(JSON.stringify(initial)) < 65_536);
  assert.equal("seed" in initial.state, false);
  assert.equal("randomState" in initial.state, false);
  assert.equal("nextEntityId" in initial.state, false);
  send(firstConnection.socket, {
    type: "input",
    sequence: 1,
    moveX: 1,
    moveY: 0,
    aimAngle: 0,
    fire: false,
    interact: false,
  });
  const acknowledged = await app.nextMessage(
    firstConnection.socket,
    (message) => message.type === "snapshot" && message.acknowledgements.p1 === 1,
  );
  const following = await app.nextMessage(
    firstConnection.socket,
    (message) => message.type === "snapshot" && message.serverTick > acknowledged.serverTick,
  );
  assert.ok(following.serverTick - acknowledged.serverTick <= 3);
  assert.ok(acknowledged.state.players.p1.ship.x > initial.state.players.p1.ship.x);
});

test("malformed and stale client messages cannot mutate another player", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Alpha");
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
  send(a.socket, { type: "start" });
  await app.nextMessage(a.socket, (message) => message.type === "snapshot");
  send(a.socket, { type: "input", sequence: 1, moveX: 0, moveY: -1, aimAngle: 0 });
  await app.nextMessage(
    a.socket,
    (message) => message.type === "snapshot" && message.acknowledgements.p1 === 1,
  );
  send(a.socket, { type: "input", sequence: 1, moveX: 0, moveY: 1, aimAngle: 0, playerId: "p2" });
  const error = await app.nextMessage(a.socket, (message) => message.type === "error");
  assert.equal(error.code, "stale_input");
  const snapshot = await app.nextMessage(a.socket, (message) => message.type === "snapshot");
  assert.equal(snapshot.acknowledgements.p2, -1);
  send(a.socket, { type: "buyWeapon", sequence: 2, weapon: "spread", playerId: "p2" });
  const rejectedPurchase = await app.nextMessage(
    a.socket,
    (message) =>
      message.type === "snapshot" &&
      message.acknowledgements.p1 === 1 &&
      message.events.some((event) => event.type === "purchaseRejected"),
  );
  assert.equal(rejectedPurchase.acknowledgements.p2, -1);
  assert.equal(
    rejectedPurchase.events.find((event) => event.type === "purchaseRejected").playerId,
    "p1",
  );
  send(a.socket, { type: "buyWeapon", sequence: 3, weapon: "invalid" });
  assert.equal(
    (await app.nextMessage(a.socket, (message) => message.type === "error")).code,
    "invalid_command",
  );
  send(a.socket, { type: "startBonusBoss", sequence: 3 });
  assert.equal(
    (await app.nextMessage(a.socket, (message) => message.type === "error")).code,
    "rejected_command",
  );
  a.socket.send("not json");
  assert.equal(
    (await app.nextMessage(a.socket, (message) => message.type === "error")).code,
    "invalid_json",
  );
});

test("room storage survives process restart and reconnect tokens reclaim the same slot", async (t) => {
  const app = await multiplayerFixture(t);
  const creator = await app.create("Persistent Pilot");
  const before = await app.request(`/rooms/${creator.roomCode}`);
  await app.restart();
  const after = await app.request(`/rooms/${creator.roomCode}`);
  assert.deepEqual(after.data.room, before.data.room);
  const { socket } = await app.connect(creator);
  const welcome = await app.nextMessage(socket, (message) => message.type === "welcome");
  assert.equal(welcome.playerId, "p1");
  assert.equal(welcome.room.players.p1.callsign, "Persistent Pilot");
});

test("creator disconnect does not grant host authority or prevent player two starting", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Alpha");
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
    b.socket,
    (message) =>
      message.type === "room" && message.room.players.p1.ready && message.room.players.p2.ready,
  );
  a.socket.close(1000, "temporary disconnect");
  send(b.socket, { type: "start" });
  const snapshot = await app.nextMessage(b.socket, (message) => message.type === "snapshot");
  assert.equal(snapshot.state.phase, "running");
  const reconnected = await app.connect(first);
  assert.equal(
    (await app.nextMessage(reconnected.socket, (message) => message.type === "welcome")).playerId,
    "p1",
  );
});

test("a running match advances during a temporary full disconnect", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Alpha");
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
  send(a.socket, { type: "start" });
  const before = await app.nextMessage(a.socket, (message) => message.type === "snapshot");
  a.socket.close(1000, "temporary disconnect");
  b.socket.close(1000, "temporary disconnect");
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const reconnected = await app.connect(first);
  await app.nextMessage(reconnected.socket, (message) => message.type === "welcome");
  const after = await app.nextMessage(reconnected.socket, (message) => message.type === "snapshot");
  assert.ok(after.serverTick > before.serverTick);
});

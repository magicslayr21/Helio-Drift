import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { multiplayerFixture } from "./fixture.mjs";

const send = (socket, message) => socket.send(JSON.stringify(message));

test("developer actions require authorization, synchronize while paused, and exclude records", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Developer");
  const second = (await app.joinRoom(first.roomCode, "Guest")).data;
  let a = await app.connect(first);
  let b = await app.connect(second);
  send(a.socket, { type: "ready", ready: true });
  send(b.socket, { type: "ready", ready: true });
  await app.nextMessage(
    a.socket,
    (m) => m.type === "room" && m.room.players.p1.ready && m.room.players.p2?.ready,
  );
  send(a.socket, { type: "start" });
  await app.nextMessage(a.socket, (m) => m.type === "snapshot");
  send(a.socket, { type: "pause" });
  const before = await app.nextMessage(a.socket, (m) => m.type === "snapshot" && m.pause);
  send(b.socket, { type: "developer", command: { action: "credits" }, token: "invalid" });
  assert.equal(
    (await app.nextMessage(b.socket, (m) => m.type === "error")).code,
    "developer_required",
  );
  send(a.socket, {
    type: "developer",
    command: { action: "enemy", kind: "warden", count: 500, size: 3 },
    token: app.developerToken,
  });
  assert.equal(
    (await app.nextMessage(a.socket, (m) => m.type === "error")).code,
    "invalid_command",
  );
  send(a.socket, { type: "developer", command: { action: "credits" }, token: app.developerToken });
  const after = await app.nextMessage(
    b.socket,
    (m) =>
      m.type === "snapshot" &&
      m.state.players.p1.credits >= before.state.players.p1.credits + 10000,
  );
  assert.equal(after.serverTick, before.serverTick);
  assert.equal(after.state.players.p2.credits, before.state.players.p2.credits);
  const view = await app.nextMessage(a.socket, (m) => m.type === "room" && m.room.assisted);
  assert.equal(view.room.assisted, true);
  await app.restart();
  a = await app.connect(first);
  b = await app.connect(second);
  const restored = await app.nextMessage(a.socket, (m) => m.type === "welcome");
  assert.equal(restored.room.assisted, true);
  await app.db.prepare("UPDATE admin_sessions SET expires_at = 0").run();
  send(a.socket, { type: "developer", command: { action: "weapons" }, token: app.developerToken });
  assert.equal(
    (await app.nextMessage(a.socket, (m) => m.type === "error")).code,
    "developer_required",
  );
  send(a.socket, { type: "leave" });
  send(b.socket, { type: "leave" });
  await app.nextClose(b.socket);
  const status = await app.request(`/rooms/${first.roomCode}`);
  assert.equal(status.data.room.phase, "closed");
  const results = await app.db.prepare("SELECT COUNT(*) AS count FROM coop_runs").first();
  assert.equal(results.count, 0);
});

test(
  "either pilot pauses both worlds, resumes, and the server enforces the 30 second deadline",
  { timeout: 45_000 },
  async (t) => {
    const app = await multiplayerFixture(t);
    const first = await app.create("Alpha");
    const second = (await app.joinRoom(first.roomCode, "Bravo")).data;
    let a = await app.connect(first);
    const b = await app.connect(second);
    send(a.socket, { type: "ready", ready: true });
    send(b.socket, { type: "ready", ready: true });
    await app.nextMessage(
      a.socket,
      (m) => m.type === "room" && m.room.players.p1.ready && m.room.players.p2?.ready,
    );
    send(a.socket, { type: "start" });
    await app.nextMessage(a.socket, (m) => m.type === "snapshot");
    send(b.socket, { type: "pause" });
    const paused = await app.nextMessage(a.socket, (m) => m.type === "snapshot" && m.pause);
    const other = await app.nextMessage(b.socket, (m) => m.type === "snapshot" && m.pause);
    assert.deepEqual(paused.pause, other.pause);
    assert.equal(paused.pause.playerId, "p2");
    assert.ok(paused.pause.until - paused.serverTime <= 30_000);
    send(a.socket, { type: "input", sequence: 10, moveX: 1, moveY: 0, aimAngle: 0, fire: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    send(a.socket, { type: "resume" });
    const resumed = await app.nextMessage(
      a.socket,
      (m) => m.type === "snapshot" && !m.pause && m.serverTime > paused.serverTime,
    );
    assert.equal(resumed.serverTick, paused.serverTick);
    assert.equal(resumed.state.team.elapsedSeconds, paused.state.team.elapsedSeconds);
    assert.equal(resumed.acknowledgements.p1, paused.acknowledgements.p1);
    send(a.socket, { type: "pause" });
    const timed = await app.nextMessage(
      a.socket,
      (m) => m.type === "snapshot" && m.pause && m.pause.playerId === "p1",
    );
    a = await app.connect(first);
    const reconnected = await app.nextMessage(a.socket, (m) => m.type === "snapshot");
    assert.deepEqual(reconnected.pause, timed.pause);
    assert.equal(reconnected.serverTick, timed.serverTick);
    let repeats = 0;
    const heartbeat = setInterval(() => {
      send(a.socket, { type: "heartbeat" });
      send(b.socket, { type: "heartbeat" });
      if (++repeats <= 5) send(b.socket, { type: "pause" });
    }, 5000);
    t.after(() => clearInterval(heartbeat));
    const automatic = await app.nextMessage(
      a.socket,
      (m) => m.type === "snapshot" && !m.pause && m.serverTime >= timed.pause.until,
      33_000,
    );
    assert.equal(automatic.serverTick, timed.serverTick);
    assert.equal(automatic.state.team.elapsedSeconds, timed.state.team.elapsedSeconds);
    assert.ok(automatic.serverTime - timed.pause.until < 1000);
    const running = await app.nextMessage(
      b.socket,
      (m) => m.type === "snapshot" && !m.pause && m.serverTick > timed.serverTick,
    );
    assert.ok(running.state.team.elapsedSeconds > timed.state.team.elapsedSeconds);
  },
);

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

test("overlapping reconnect tickets remain usable, bounded and single-use", async (t) => {
  const app = await multiplayerFixture(t);
  const identity = await app.create();
  const tickets = [];
  for (let i = 0; i < 4; i++) {
    const response = await app.request(`/rooms/${identity.roomCode}/tickets`, {
      method: "POST",
      token: identity.reconnectToken,
    });
    assert.equal(response.status, 200);
    tickets.push(response.data.socketTicket);
  }
  const oldest = await app.request(`/rooms/${identity.roomCode}/socket?ticket=${tickets[0]}`, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(oldest.status, 401);
  const first = await app.connect(identity, tickets[1]);
  assert.equal((await app.nextMessage(first.socket, (m) => m.type === "welcome")).playerId, "p1");
  const reused = await app.request(`/rooms/${identity.roomCode}/socket?ticket=${tickets[1]}`, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(reused.status, 401);
  const latest = await app.connect(identity, tickets[3]);
  assert.equal((await app.nextMessage(latest.socket, (m) => m.type === "welcome")).playerId, "p1");
});

test("client-initiated close is acknowledged promptly and the slot can reconnect", async (t) => {
  const app = await multiplayerFixture(t);
  const identity = await app.create();
  const first = await app.connect(identity);
  await app.nextMessage(first.socket, (m) => m.type === "welcome");
  const closed = app.nextClose(first.socket);
  first.socket.close(4000, "Temporary disconnect");
  await closed;
  const second = await app.connect(identity);
  assert.equal(
    (await app.nextMessage(second.socket, (m) => m.type === "welcome")).playerId,
    identity.playerId,
  );
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

test("a running native campaign survives Worker restart with its world and pilot state", async (t) => {
  const app = await multiplayerFixture(t);
  const first = await app.create("Checkpoint Alpha");
  const second = (await app.joinRoom(first.roomCode, "Checkpoint Bravo")).data;
  const a = await app.connect(first),
    b = await app.connect(second);
  await Promise.all([
    app.nextMessage(a.socket, (m) => m.type === "welcome"),
    app.nextMessage(b.socket, (m) => m.type === "welcome"),
  ]);
  send(a.socket, { type: "ready", ready: true });
  send(b.socket, { type: "ready", ready: true });
  await app.nextMessage(
    a.socket,
    (m) => m.type === "room" && m.room.players.p1.ready && m.room.players.p2.ready,
  );
  send(a.socket, { type: "start" });
  const before = await app.nextMessage(
    a.socket,
    (m) => m.type === "snapshot" && m.serverTick >= 32,
  );
  assert.ok(before.state.campaign.rocks.length);
  await app.restart();
  const reconnected = await app.connect(first);
  await app.nextMessage(reconnected.socket, (m) => m.type === "welcome");
  const after = await app.nextMessage(reconnected.socket, (m) => m.type === "snapshot");
  // Checkpoints are committed once per second; at most one interval can be replayed.
  assert.ok(after.serverTick >= before.serverTick - 30);
  assert.equal(after.state.team.wave, before.state.team.wave);
  assert.equal(after.state.players.p1.callsign, "Checkpoint Alpha");
  assert.equal(after.state.players.p2.callsign, "Checkpoint Bravo");
  assert.equal(after.state.players.p1.credits, before.state.players.p1.credits);
  assert.ok(after.state.campaign.rocks.every((r) => r.pts.length > 0 && Array.isArray(r.cracks)));
});

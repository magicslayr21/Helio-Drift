import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { multiplayerFixture } from "./fixture.mjs";

const send = (socket, message) => socket.send(JSON.stringify(message));

async function startRoom(app, index) {
  const first = await app.create(`Load A ${index}`);
  const joined = await app.joinRoom(first.roomCode, `Load B ${index}`);
  assert.equal(joined.status, 200);
  const second = joined.data;
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
  const [firstSnapshot, secondSnapshot] = await Promise.all([
    app.nextMessage(a.socket, (message) => message.type === "snapshot"),
    app.nextMessage(b.socket, (message) => message.type === "snapshot"),
  ]);
  return { first, second, a, b, firstSnapshot, secondSnapshot };
}

test("hostile socket payloads are rejected without crossing player ownership", async (t) => {
  const app = await multiplayerFixture(t);
  const room = await startRoom(app, 1);
  const cases = [
    { payload: "null", code: "invalid_message" },
    { payload: "[]", code: "invalid_message" },
    { payload: JSON.stringify({}), code: "unknown_message" },
    { payload: JSON.stringify({ type: 42 }), code: "unknown_message" },
    { payload: JSON.stringify({ type: "ready", ready: "true" }), code: "invalid_ready" },
    {
      payload: JSON.stringify({
        type: "input",
        sequence: Number.MAX_VALUE,
        moveX: 0,
        moveY: 0,
        aimAngle: 0,
      }),
      code: "invalid_input",
    },
    {
      payload: JSON.stringify({
        type: "input",
        sequence: 1,
        moveX: "1",
        moveY: 0,
        aimAngle: 0,
      }),
      code: "invalid_input",
    },
    {
      payload: JSON.stringify({ type: "chooseUpgrade", sequence: 1, upgrade: {} }),
      code: "invalid_command",
    },
  ];
  for (const entry of cases) {
    room.a.socket.send(entry.payload);
    const error = await app.nextMessage(
      room.a.socket,
      (message) => message.type === "error" && message.code === entry.code,
    );
    assert.equal(error.code, entry.code);
  }
  room.a.socket.send(new Uint8Array([0xff, 0xfe, 0xfd]));
  assert.equal(
    (await app.nextMessage(room.a.socket, (message) => message.type === "error")).code,
    "invalid_json",
  );

  send(room.a.socket, {
    type: "input",
    sequence: 2,
    moveX: 1,
    moveY: 0,
    aimAngle: 0,
    fire: true,
    playerId: "p2",
  });
  const snapshot = await app.nextMessage(
    room.a.socket,
    (message) => message.type === "snapshot" && message.acknowledgements.p1 === 2,
  );
  assert.equal(snapshot.acknowledgements.p2, -1);
});

test("eight concurrent Durable Object rooms launch and advance two clients each", async (t) => {
  const app = await multiplayerFixture(t);
  const started = performance.now();
  const rooms = await Promise.all(Array.from({ length: 8 }, (_, index) => startRoom(app, index)));
  assert.equal(new Set(rooms.map((room) => room.first.roomCode)).size, rooms.length);
  for (const room of rooms) {
    assert.equal(room.firstSnapshot.state.phase, "running");
    assert.equal(room.secondSnapshot.state.phase, "running");
    send(room.a.socket, {
      type: "input",
      sequence: 1,
      moveX: 1,
      moveY: 0,
      aimAngle: 0,
      fire: true,
      missile: false,
      interact: false,
    });
    send(room.b.socket, {
      type: "input",
      sequence: 1,
      moveX: -1,
      moveY: 0,
      aimAngle: Math.PI,
      fire: true,
      missile: false,
      interact: false,
    });
  }
  const advanced = await Promise.all(
    rooms.flatMap((room) => [
      app.nextMessage(
        room.a.socket,
        (message) => message.type === "snapshot" && message.acknowledgements.p1 === 1,
      ),
      app.nextMessage(
        room.b.socket,
        (message) => message.type === "snapshot" && message.acknowledgements.p2 === 1,
      ),
    ]),
  );
  const elapsedMs = performance.now() - started;
  assert.equal(advanced.length, 16);
  assert.ok(advanced.every((snapshot) => snapshot.serverTick > 0));
  assert.ok(elapsedMs < 15_000, `room load check took ${elapsedMs.toFixed(1)} ms`);
  console.info(`[coop readiness] 8 rooms / 16 sockets launched in ${elapsedMs.toFixed(1)} ms`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { multiplayerFixture } from "./fixture.mjs";

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
    (await app.request("/rooms/public", { method: "POST", body: { name: "!", callsign: "Pilot" } }))
      .status,
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

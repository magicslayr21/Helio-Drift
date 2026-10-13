import assert from "node:assert/strict";
import test from "node:test";
import { readRoomCheckpoint, writeRoomCheckpoint } from "../checkpoint.mjs";

function memoryStorage() {
  let committed = new Map();
  const store = {
    fail: false,
    async get(key) {
      return structuredClone(
        Array.isArray(key) ? new Map(key.map((k) => [k, committed.get(k)])) : committed.get(key),
      );
    },
    async transaction(action) {
      const pending = structuredClone(committed);
      await action({
        get: async (key) => structuredClone(pending.get(key)),
        put: async (values) => {
          for (const [key, value] of Object.entries(values)) {
            assert.ok(
              Buffer.byteLength(JSON.stringify(value)) < 128 * 1024,
              "checkpoint value exceeds platform limit",
            );
            pending.set(key, structuredClone(value));
          }
          if (store.fail) throw new Error("injected storage failure");
        },
        delete: async (key) => pending.delete(key),
      });
      committed = pending;
    },
    keys: () => [...committed.keys()],
    seed: (room) => committed.set("room", structuredClone(room)),
  };
  return store;
}

test("large campaign checkpoints round-trip within per-key limits and shrink without stale chunks", async () => {
  const storage = memoryStorage();
  const room = {
    code: "ABCDEF",
    phase: "running",
    match: {
      tick: 900,
      campaign: { geometry: "🌠".repeat(150000) },
      players: { p1: { credits: 1200 } },
    },
  };
  await writeRoomCheckpoint(storage, room);
  const restored = await readRoomCheckpoint(storage);
  assert.deepEqual(restored.match, room.match);
  assert.ok(storage.keys().length > 5);
  room.match = { tick: 901, campaign: { geometry: "small" } };
  await writeRoomCheckpoint(storage, room);
  assert.deepEqual((await readRoomCheckpoint(storage)).match, room.match);
  assert.deepEqual(storage.keys().sort(), ["match:0", "room"]);
});

test("a failed checkpoint preserves the previous complete world and can retry", async () => {
  const storage = memoryStorage(),
    room = { code: "ABCDEF", match: { tick: 1, world: "previous" } };
  await writeRoomCheckpoint(storage, room);
  storage.fail = true;
  room.match = { tick: 2, world: "next".repeat(100000) };
  await assert.rejects(writeRoomCheckpoint(storage, room), /injected storage failure/);
  assert.equal((await readRoomCheckpoint(storage)).match.tick, 1);
  storage.fail = false;
  await writeRoomCheckpoint(storage, room);
  assert.deepEqual((await readRoomCheckpoint(storage)).match, room.match);
});

test("pre-chunk rooms remain readable and migrate on their next save", async () => {
  const storage = memoryStorage(),
    room = { code: "ABCDEF", match: { tick: 100, players: { p1: { credits: 900 } } } };
  storage.seed(room);
  assert.deepEqual(await readRoomCheckpoint(storage), room);
  await writeRoomCheckpoint(storage, room);
  assert.deepEqual((await readRoomCheckpoint(storage)).match, room.match);
});

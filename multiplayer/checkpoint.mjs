/** Full campaign worlds can exceed Durable Object's per-value storage limit. */
export async function readRoomCheckpoint(storage) {
  const room = (await storage.get("room")) ?? null;
  if (room?.matchChunks) {
    const keys = Array.from({ length: room.matchChunks }, (_, i) => `match:${i}`);
    const chunks = await storage.get(keys);
    room.match = JSON.parse(keys.map((key) => chunks.get(key)).join(""));
  }
  return room;
}

export async function writeRoomCheckpoint(storage, currentRoom) {
  const room = structuredClone(currentRoom);
  const encoded = room.match ? JSON.stringify(room.match) : "";
  const chunks = [];
  // Even four-byte characters stay comfortably under the 128 KiB value limit.
  for (let i = 0; i < encoded.length; i += 24_000) chunks.push(encoded.slice(i, i + 24_000));
  room.match = null;
  room.matchChunks = chunks.length;
  await storage.transaction(async (txn) => {
    const previous = await txn.get("room");
    const values = { room };
    chunks.forEach((chunk, i) => {
      values[`match:${i}`] = chunk;
    });
    await txn.put(values);
    for (let i = chunks.length; i < (previous?.matchChunks ?? 0); i++)
      await txn.delete(`match:${i}`);
  });
}

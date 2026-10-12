export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const NETWORK_CONFIG = Object.freeze({
  maximumPlayers: 2,
  snapshotEveryTicks: 2,
  inputMessagesPerSecond: 90,
  maximumMessageBytes: 4096,
  ticketLifetimeMs: 30_000,
  waitingRoomLifetimeMs: 10 * 60_000,
  reconnectGraceMs: 90_000,
  heartbeatTimeoutMs: 30_000,
  completedRoomLifetimeMs: 5 * 60_000,
  publicListMaximum: 50,
  publicListDefault: 20,
  publicRoomNameMaximum: 32,
});

export function normalizeCallsign(value) {
  if (typeof value !== "string") return null;
  const callsign = value.trim().replace(/\s+/g, " ");
  if (callsign.length < 2 || callsign.length > 24) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(callsign)) return null;
  return callsign;
}

export function normalizeRoomCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export function normalizeRoomName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > NETWORK_CONFIG.publicRoomNameMaximum) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.'-]*$/.test(name)) return null;
  return name;
}

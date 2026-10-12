import { COOP_FIXED_DT } from "../src/game/simulation/coop-config.ts";
import { LocalCoopSimulation } from "../src/game/simulation/local-coop.ts";
import { createWireState } from "../src/game/network/wire-state.ts";
import {
  NETWORK_CONFIG,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TOKEN_PATTERN,
  normalizeCallsign,
  normalizeRoomCode,
} from "./config.mjs";

const encoder = new TextEncoder();
const requestBuckets = new Map();
const WEAPONS = new Set(["pulse", "spread", "seeker", "ricochet", "flak", "arc", "laser", "rail"]);
const DRONE_UPGRADES = new Set([
  "twinCannons",
  "overcharge",
  "piercing",
  "armor",
  "shield",
  "repairPulse",
  "magnet",
  "scan",
  "speed",
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (status, value, headers = new Headers()) => {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(value === undefined ? null : JSON.stringify(value), { status, headers });
};

async function readJson(request, maximumBytes = NETWORK_CONFIG.maximumMessageBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    throw new RequestError(415, "Send JSON with Content-Type: application/json.");
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > maximumBytes) {
    throw new RequestError(413, "Request is too large.");
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumBytes) {
          await reader.cancel();
          throw new RequestError(413, "Request is too large.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError(400, "Invalid JSON body.");
  }
}

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function newRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

function randomSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bearer(request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  return TOKEN_PATTERN.test(token) ? token : null;
}

function rateLimit(key, maximum, windowMs) {
  const now = Date.now();
  let bucket = requestBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    if (requestBuckets.size >= 5000) {
      for (const [id, candidate] of requestBuckets) {
        if (candidate.expiresAt <= now) requestBuckets.delete(id);
      }
    }
    bucket = { count: 0, expiresAt: now + windowMs };
    requestBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > maximum) throw new RequestError(429, "Too many requests.");
}

async function roomRequest(env, code, path, init) {
  const id = env.MATCH_ROOMS.idFromName(code);
  return env.MATCH_ROOMS.get(id).fetch(`https://room.internal${path}`, init);
}

function withCors(response, headers) {
  const merged = new Headers(response.headers);
  for (const [name, value] of headers) merged.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

export async function handleRequest(request, env) {
  const headers = new Headers({ Vary: "Origin" });
  try {
    const origins = new Set(
      (env.MULTIPLAYER_ORIGINS ?? "http://localhost:5173")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    for (const allowed of origins) {
      if (new URL(allowed).origin !== allowed || !/^https?:/.test(allowed)) {
        throw new Error("Invalid multiplayer origin configuration");
      }
    }
    const origin = request.headers.get("Origin");
    if (origin && !origins.has(origin)) throw new RequestError(403, "This origin is not allowed.");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (request.method === "GET" && path === "/api/health") {
      return json(200, { ok: true, service: "helio-drift-multiplayer" }, headers);
    }
    if (request.method === "POST" && path === "/api/rooms/private") {
      rateLimit(`create:${address}`, 20, 60_000);
      const body = await readJson(request);
      const callsign = normalizeCallsign(body.callsign);
      if (!callsign) throw new RequestError(400, "Callsign must be 2–20 safe characters.");
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = newRoomCode();
        const response = await roomRequest(env, code, "/internal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, callsign }),
        });
        if (response.status === 409) continue;
        return withCors(response, headers);
      }
      throw new RequestError(503, "Unable to allocate a room. Try again.");
    }

    const route = path.match(/^\/api\/rooms\/([^/]+)(?:\/(join|tickets|socket))?$/);
    if (!route) throw new RequestError(404, "Route not found.");
    const code = normalizeRoomCode(route[1]);
    if (!code) throw new RequestError(400, "Room code is invalid.");
    const action = route[2] ?? "status";
    if (request.method === "GET" && action === "status") {
      rateLimit(`status:${address}`, 120, 60_000);
      return withCors(await roomRequest(env, code, "/internal/status", { method: "GET" }), headers);
    }
    if (request.method === "POST" && action === "join") {
      rateLimit(`join:${address}`, 40, 60_000);
      const body = await readJson(request);
      const callsign = normalizeCallsign(body.callsign);
      if (!callsign) throw new RequestError(400, "Callsign must be 2–20 safe characters.");
      return withCors(
        await roomRequest(env, code, "/internal/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callsign }),
        }),
        headers,
      );
    }
    if (request.method === "POST" && action === "tickets") {
      rateLimit(`ticket:${address}`, 120, 60_000);
      const token = bearer(request);
      if (!token) throw new RequestError(401, "A valid reconnect token is required.");
      return withCors(
        await roomRequest(env, code, "/internal/ticket", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
        headers,
      );
    }
    if (request.method === "GET" && action === "socket") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        throw new RequestError(426, "A WebSocket upgrade is required.");
      }
      const ticket = url.searchParams.get("ticket");
      if (!ticket || !TOKEN_PATTERN.test(ticket))
        throw new RequestError(401, "Socket ticket is invalid.");
      return roomRequest(
        env,
        code,
        `/internal/socket?ticket=${encodeURIComponent(ticket)}`,
        request,
      );
    }
    throw new RequestError(405, "Method not allowed.");
  } catch (error) {
    if (error instanceof RequestError) return json(error.status, { error: error.message }, headers);
    console.error("multiplayer request failed", error);
    return json(500, { error: "Multiplayer service failed." }, headers);
  }
}

export class MatchRoom {
  constructor(state) {
    this.state = state;
    this.room = null;
    this.simulation = null;
    this.clock = null;
    this.lastClockAt = 0;
    this.lastPersistedTick = 0;
    this.messageBuckets = new Map();
    this.operationTail = Promise.resolve();
    this.ready = state.blockConcurrencyWhile(async () => {
      this.room = (await state.storage.get("room")) ?? null;
      if (!this.room) return;
      const now = Date.now();
      this.room.tickets = (this.room.tickets ?? []).filter((ticket) => ticket.expiresAt > now);
      const connectedIds = new Set(
        this.state
          .getWebSockets()
          .map((socket) => socket.deserializeAttachment()?.playerId)
          .filter(Boolean),
      );
      for (const [id, player] of Object.entries(this.room.players)) {
        if (player) player.connected = connectedIds.has(id);
      }
      if (this.room.match) {
        this.simulation = LocalCoopSimulation.restore(this.room.match);
        this.lastPersistedTick = this.room.match.tick;
      }
      await this.persist();
      if (this.room.phase === "running" && this.state.getWebSockets().length > 0)
        this.ensureClock();
    });
  }

  async fetch(request) {
    await this.ready;
    return this.exclusive(() => this.handleFetch(request));
  }

  async handleFetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/internal/create") {
        if (this.room) return json(409, { error: "Room already exists." });
        const body = await readJson(request);
        const code = normalizeRoomCode(body.code);
        const callsign = normalizeCallsign(body.callsign);
        if (!code || !callsign) throw new RequestError(400, "Room details are invalid.");
        const reconnectToken = newToken();
        const now = Date.now();
        this.room = {
          version: 1,
          code,
          seed: randomSeed(),
          phase: "waiting",
          createdAt: now,
          updatedAt: now,
          expiresAt: now + NETWORK_CONFIG.waitingRoomLifetimeMs,
          lastAdvancedAt: now,
          players: {
            p1: await this.makePlayer("p1", callsign, reconnectToken, now),
            p2: null,
          },
          tickets: [],
          match: null,
        };
        await this.persist();
        await this.scheduleAlarm();
        return json(201, { roomCode: code, playerId: "p1", reconnectToken, room: this.view() });
      }
      if (!this.room) return json(404, { error: "Room not found." });
      if (request.method === "GET" && url.pathname === "/internal/status") {
        return json(200, { room: this.view() });
      }
      if (request.method === "POST" && url.pathname === "/internal/join") {
        if (this.room.phase !== "waiting") return json(409, { error: "Match already started." });
        const playerId = !this.room.players.p1 ? "p1" : !this.room.players.p2 ? "p2" : null;
        if (!playerId) return json(409, { error: "Room is full." });
        const body = await readJson(request);
        const callsign = normalizeCallsign(body.callsign);
        if (!callsign) throw new RequestError(400, "Callsign is invalid.");
        const reconnectToken = newToken();
        this.room.players[playerId] = await this.makePlayer(
          playerId,
          callsign,
          reconnectToken,
          Date.now(),
        );
        this.touch();
        await this.persist();
        this.broadcastRoom();
        return json(200, {
          roomCode: this.room.code,
          playerId,
          reconnectToken,
          room: this.view(),
        });
      }
      if (request.method === "POST" && url.pathname === "/internal/ticket") {
        const token = bearer(request);
        if (!token) return json(401, { error: "Reconnect token is invalid." });
        const tokenHash = await hash(token);
        const player = Object.values(this.room.players).find(
          (candidate) => candidate?.tokenHash === tokenHash && !candidate.left,
        );
        if (!player) return json(401, { error: "Reconnect token is invalid." });
        const socketTicket = newToken();
        const now = Date.now();
        this.room.tickets = this.room.tickets
          .filter((ticket) => ticket.expiresAt > now && ticket.playerId !== player.id)
          .concat({
            tokenHash: await hash(socketTicket),
            playerId: player.id,
            expiresAt: now + NETWORK_CONFIG.ticketLifetimeMs,
          });
        this.touch();
        await this.persist();
        return json(200, { socketTicket, expiresAt: now + NETWORK_CONFIG.ticketLifetimeMs });
      }
      if (request.method === "GET" && url.pathname === "/internal/socket") {
        return this.connectSocket(request, url.searchParams.get("ticket"));
      }
      return json(404, { error: "Room route not found." });
    } catch (error) {
      if (error instanceof RequestError) return json(error.status, { error: error.message });
      console.error("match room request failed", error);
      return json(500, { error: "Match room failed." });
    }
  }

  async makePlayer(id, callsign, reconnectToken, now) {
    return {
      id,
      callsign,
      tokenHash: await hash(reconnectToken),
      ready: false,
      connected: false,
      left: false,
      joinedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      connectionVersion: 0,
    };
  }

  async connectSocket(request, ticket) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json(426, { error: "A WebSocket upgrade is required." });
    }
    if (!ticket || !TOKEN_PATTERN.test(ticket))
      return json(401, { error: "Socket ticket is invalid." });
    const now = Date.now();
    const ticketHash = await hash(ticket);
    const index = this.room.tickets.findIndex(
      (candidate) => candidate.tokenHash === ticketHash && candidate.expiresAt > now,
    );
    if (index < 0) return json(401, { error: "Socket ticket expired or was already used." });
    const [{ playerId }] = this.room.tickets.splice(index, 1);
    const player = this.room.players[playerId];
    if (!player || player.left) return json(401, { error: "Player session is unavailable." });

    for (const existing of this.state.getWebSockets()) {
      if (existing.deserializeAttachment()?.playerId !== playerId) continue;
      try {
        this.sendError(existing, "session_replaced", "Connected from another tab.");
        existing.close(4001, "Reconnected from another tab");
      } catch {}
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [playerId]);
    player.connectionVersion = (player.connectionVersion ?? 0) + 1;
    server.serializeAttachment({ playerId, connectionVersion: player.connectionVersion });
    player.connected = true;
    player.disconnectedAt = null;
    player.lastSeenAt = now;
    this.touch();
    await this.persist();
    await this.state.storage.deleteAlarm();
    this.send(server, { type: "welcome", playerId, room: this.view() });
    if (this.simulation) this.sendSnapshot(server);
    this.broadcastRoom();
    this.ensureClock();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, payload) {
    await this.ready;
    return this.exclusive(() => this.handleWebSocketMessage(socket, payload));
  }

  async handleWebSocketMessage(socket, payload) {
    const attachment = socket.deserializeAttachment();
    const playerId = attachment?.playerId;
    const player = this.room?.players[playerId];
    if (!player || player.left) return socket.close(4003, "Session is no longer valid");
    if (attachment.connectionVersion !== player.connectionVersion) {
      return socket.close(4001, "Session was replaced");
    }
    const size =
      typeof payload === "string" ? encoder.encode(payload).byteLength : payload.byteLength;
    if (size > NETWORK_CONFIG.maximumMessageBytes)
      return socket.close(4009, "Message is too large");
    if (!this.allowMessage(playerId)) return socket.close(4008, "Input rate exceeded");
    let message;
    try {
      message = JSON.parse(
        typeof payload === "string" ? payload : new TextDecoder().decode(payload),
      );
    } catch {
      return this.sendError(socket, "invalid_json", "Message must be valid JSON.");
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return this.sendError(socket, "invalid_message", "Message must be an object.");
    }
    player.lastSeenAt = Date.now();
    switch (message.type) {
      case "heartbeat":
        this.send(socket, { type: "pong", serverTime: Date.now() });
        return;
      case "ready":
        if (this.room.phase !== "waiting" || typeof message.ready !== "boolean") {
          return this.sendError(socket, "invalid_ready", "Ready state cannot be changed now.");
        }
        player.ready = message.ready;
        this.touch();
        await this.persist();
        this.broadcastRoom();
        return;
      case "start":
        return this.startMatch(socket);
      case "input":
        return this.applyInput(socket, playerId, message);
      case "buyWeapon":
      case "selectWeapon":
      case "buyDrone":
      case "buyDroneUpgrade":
      case "equipDroneWeapon":
      case "chooseUpgrade":
      case "activateOverdrive":
        return this.applyCombatCommand(socket, playerId, message);
      case "leave":
        return this.leave(socket, playerId);
      default:
        return this.sendError(socket, "unknown_message", "Message type is not supported.");
    }
  }

  async webSocketClose(socket) {
    await this.ready;
    await this.exclusive(() => this.disconnect(socket));
  }

  async webSocketError(socket) {
    await this.ready;
    await this.exclusive(() => this.disconnect(socket));
  }

  async disconnect(socket) {
    const attachment = socket.deserializeAttachment();
    const playerId = attachment?.playerId;
    const player = this.room?.players[playerId];
    if (!player) return;
    if (attachment.connectionVersion !== player.connectionVersion) return;
    const stillConnected = this.state
      .getWebSockets(playerId)
      .some((candidate) => candidate !== socket && candidate.readyState === WebSocket.OPEN);
    player.connected = stillConnected;
    if (!stillConnected) player.disconnectedAt = Date.now();
    this.touch();
    await this.persist();
    this.broadcastRoom();
    if (this.state.getWebSockets().length === 0) {
      this.stopClock();
      await this.scheduleAlarm(1000);
    }
  }

  allowMessage(playerId) {
    const now = Date.now();
    let bucket = this.messageBuckets.get(playerId);
    if (!bucket || bucket.expiresAt <= now) {
      bucket = { count: 0, expiresAt: now + 1000 };
      this.messageBuckets.set(playerId, bucket);
    }
    bucket.count++;
    return bucket.count <= NETWORK_CONFIG.inputMessagesPerSecond;
  }

  async startMatch(socket) {
    if (this.room.phase !== "waiting")
      return this.sendError(socket, "already_started", "Match already started.");
    const players = Object.values(this.room.players);
    if (
      players.length !== NETWORK_CONFIG.maximumPlayers ||
      players.some((player) => !player?.ready || player.left)
    ) {
      return this.sendError(socket, "not_ready", "Both players must be ready.");
    }
    this.simulation = new LocalCoopSimulation({
      seed: this.room.seed,
      callsigns: [this.room.players.p1.callsign, this.room.players.p2.callsign],
    });
    this.room.phase = "running";
    this.room.match = this.simulation.snapshot();
    this.room.lastAdvancedAt = Date.now();
    this.lastClockAt = this.room.lastAdvancedAt;
    this.lastPersistedTick = this.room.match.tick;
    this.touch();
    await this.persist();
    this.broadcastRoom();
    this.broadcastSnapshot();
    this.ensureClock();
  }

  applyInput(socket, playerId, message) {
    if (this.room.phase !== "running" || !this.simulation) {
      return this.sendError(socket, "not_running", "Match has not started.");
    }
    const values = [message.sequence, message.moveX, message.moveY, message.aimAngle];
    if (!values.every(Number.isFinite) || !Number.isSafeInteger(message.sequence)) {
      return this.sendError(socket, "invalid_input", "Input values are invalid.");
    }
    const accepted = this.simulation.submit({
      type: "input",
      playerId,
      sequence: message.sequence,
      moveX: message.moveX,
      moveY: message.moveY,
      aimAngle: message.aimAngle,
      fire: Boolean(message.fire),
      missile: Boolean(message.missile),
      interact: Boolean(message.interact),
    });
    if (!accepted) this.sendError(socket, "stale_input", "Input sequence was already processed.");
  }

  applyCombatCommand(socket, playerId, message) {
    if (this.room.phase !== "running" || !this.simulation) {
      return this.sendError(socket, "not_running", "Match has not started.");
    }
    if (!Number.isSafeInteger(message.sequence))
      return this.sendError(socket, "invalid_command", "Command sequence is invalid.");
    const command = { type: message.type, playerId, sequence: message.sequence };
    if (message.type === "buyWeapon" || message.type === "selectWeapon") {
      if (!WEAPONS.has(message.weapon))
        return this.sendError(socket, "invalid_command", "Weapon is invalid.");
      command.weapon = message.weapon;
    } else if (message.type === "buyDroneUpgrade") {
      if (!DRONE_UPGRADES.has(message.upgrade))
        return this.sendError(socket, "invalid_command", "Drone upgrade is invalid.");
      command.upgrade = message.upgrade;
    } else if (message.type === "equipDroneWeapon") {
      if (message.weapon !== null && !WEAPONS.has(message.weapon))
        return this.sendError(socket, "invalid_command", "Drone weapon is invalid.");
      command.weapon = message.weapon;
    } else if (message.type === "chooseUpgrade") {
      if (
        typeof message.upgrade !== "string" ||
        message.upgrade.length < 1 ||
        message.upgrade.length > 48
      )
        return this.sendError(socket, "invalid_command", "Upgrade is invalid.");
      command.upgrade = message.upgrade;
    }
    if (!this.simulation.submit(command))
      this.sendError(socket, "rejected_command", "Command was stale or not permitted.");
  }

  async leave(socket, playerId) {
    const player = this.room.players[playerId];
    player.left = true;
    player.ready = false;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.tokenHash = null;
    this.room.tickets = this.room.tickets.filter((ticket) => ticket.playerId !== playerId);
    if (this.room.phase === "waiting") this.room.players[playerId] = null;
    if (Object.values(this.room.players).filter(Boolean).length === 0) {
      this.room.phase = "closed";
      this.room.expiresAt = Date.now() + NETWORK_CONFIG.completedRoomLifetimeMs;
      this.stopClock();
    }
    this.touch();
    await this.persist();
    this.broadcastRoom();
    socket.close(1000, "Left room");
    if (
      this.room.phase !== "waiting" &&
      Object.values(this.room.players)
        .filter(Boolean)
        .every((candidate) => candidate.left)
    ) {
      this.room.phase = "closed";
      this.room.expiresAt = Date.now() + NETWORK_CONFIG.completedRoomLifetimeMs;
      this.stopClock();
    }
    await this.persist();
    await this.scheduleAlarm(1000);
  }

  ensureClock() {
    if (this.clock || this.room?.phase !== "running" || !this.simulation) return;
    this.lastClockAt = Date.now();
    this.clock = setInterval(() => this.tick(), 1000 / 30);
  }

  stopClock() {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }

  tick() {
    if (!this.simulation || this.room.phase !== "running") return this.stopClock();
    const now = Date.now();
    const elapsed = Math.max(0, (now - this.lastClockAt) / 1000);
    this.lastClockAt = now;
    const steps = this.simulation.advance(elapsed);
    this.room.lastAdvancedAt = now;
    if (steps === 0) return;
    this.room.match = this.simulation.snapshot();
    if (this.room.match.tick % 30 === 0) this.closeIdleSockets(now);
    if (this.room.match.tick % NETWORK_CONFIG.snapshotEveryTicks === 0) this.broadcastSnapshot();
    if (this.room.match.tick - this.lastPersistedTick >= 30) {
      this.lastPersistedTick = this.room.match.tick;
      this.touch();
      this.state.waitUntil(this.persist());
    }
    if (this.room.match.phase === "victory" || this.room.match.phase === "defeat") {
      this.room.phase = "finished";
      this.room.expiresAt = now + NETWORK_CONFIG.completedRoomLifetimeMs;
      this.stopClock();
      this.broadcastRoom();
      this.state.waitUntil(this.persist().then(() => this.scheduleAlarm()));
    }
  }

  async alarm() {
    await this.ready;
    await this.exclusive(() => this.handleAlarm());
  }

  async handleAlarm() {
    if (!this.room) return;
    const now = Date.now();
    if (this.room.expiresAt <= now) {
      this.stopClock();
      await this.state.storage.deleteAll();
      this.room = null;
      this.simulation = null;
      return;
    }
    if (
      this.room.phase === "running" &&
      this.simulation &&
      this.state.getWebSockets().length === 0
    ) {
      const elapsedTicks = Math.min(
        30,
        Math.floor((now - this.room.lastAdvancedAt) / (COOP_FIXED_DT * 1000)),
      );
      if (elapsedTicks > 0) {
        this.simulation.stepTicks(elapsedTicks);
        this.room.lastAdvancedAt += elapsedTicks * COOP_FIXED_DT * 1000;
        this.room.match = this.simulation.snapshot();
      }
      const active = Object.values(this.room.players).filter((player) => player && !player.left);
      const latestDisconnect = Math.max(...active.map((player) => player.disconnectedAt ?? now));
      if (active.length === 0 || now - latestDisconnect >= NETWORK_CONFIG.reconnectGraceMs) {
        this.room.phase = "closed";
        this.room.expiresAt = now + NETWORK_CONFIG.completedRoomLifetimeMs;
      }
      if (this.room.match?.phase === "victory" || this.room.match?.phase === "defeat") {
        this.room.phase = "finished";
        this.room.expiresAt = now + NETWORK_CONFIG.completedRoomLifetimeMs;
      }
      this.touch();
      await this.persist();
    }
    await this.scheduleAlarm(this.room.phase === "running" ? 1000 : undefined);
  }

  async scheduleAlarm(delay) {
    if (!this.room) return;
    const target =
      delay === undefined ? this.room.expiresAt : Math.min(this.room.expiresAt, Date.now() + delay);
    await this.state.storage.setAlarm(target);
  }

  view() {
    if (!this.room) return null;
    return {
      code: this.room.code,
      phase: this.room.phase,
      createdAt: this.room.createdAt,
      expiresAt: this.room.expiresAt,
      players: Object.fromEntries(
        Object.entries(this.room.players).map(([id, player]) => [
          id,
          player
            ? {
                id: player.id,
                callsign: player.callsign,
                ready: player.ready,
                connected: player.connected,
                left: player.left,
              }
            : null,
        ]),
      ),
    };
  }

  touch() {
    if (this.room) this.room.updatedAt = Date.now();
  }

  async persist() {
    if (this.room) await this.state.storage.put("room", this.room);
  }

  async exclusive(operation) {
    let release;
    const previous = this.operationTail;
    this.operationTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  closeIdleSockets(now) {
    for (const socket of this.state.getWebSockets()) {
      const player = this.room.players[socket.deserializeAttachment()?.playerId];
      if (player && now - player.lastSeenAt > NETWORK_CONFIG.heartbeatTimeoutMs) {
        try {
          socket.close(4000, "Heartbeat timed out");
        } catch {}
      }
    }
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {}
  }

  sendError(socket, code, message) {
    this.send(socket, { type: "error", code, message });
  }

  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(encoded);
      } catch {}
    }
  }

  broadcastRoom() {
    this.broadcast({ type: "room", room: this.view() });
  }

  sendSnapshot(socket) {
    if (!this.simulation) return;
    const state = this.simulation.snapshot();
    this.send(socket, {
      type: "snapshot",
      serverTime: Date.now(),
      serverTick: state.tick,
      acknowledgements: {
        p1: state.players.p1.lastInputSequence,
        p2: state.players.p2.lastInputSequence,
      },
      state: createWireState(state),
      events: [],
    });
  }

  broadcastSnapshot() {
    if (!this.simulation) return;
    const state = this.simulation.snapshot();
    this.broadcast({
      type: "snapshot",
      serverTime: Date.now(),
      serverTick: state.tick,
      acknowledgements: {
        p1: state.players.p1.lastInputSequence,
        p2: state.players.p2.lastInputSequence,
      },
      state: createWireState(state),
      events: this.simulation.drainEvents(),
    });
  }
}

export default { fetch: handleRequest };

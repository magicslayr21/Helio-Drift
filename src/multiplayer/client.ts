import type {
  MultiplayerClientMessage,
  MultiplayerRoomView,
  MultiplayerServerMessage,
  PublicRoomSummary,
} from "../game/network/protocol";
import type { CoopPlayerId } from "../game/simulation/coop-types";

const viteEnvironment = import.meta.env ?? ({} as ImportMetaEnv);
const configuredUrl = (viteEnvironment.VITE_MULTIPLAYER_URL || "").trim().replace(/\/+$/, "");
const API = configuredUrl || (viteEnvironment.DEV ? "/multiplayer-api" : "");
const SESSION_KEY = "helios-coop-session-v1";

export interface CoopSession {
  roomCode: string;
  playerId: CoopPlayerId;
  reconnectToken: string;
  room: MultiplayerRoomView;
}

export interface PublicRoomPage {
  rooms: PublicRoomSummary[];
  nextCursor: string | null;
}

export type CoopConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export class MultiplayerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isMultiplayerConfigured = () => Boolean(API);

const RETRY_DELAYS = [500, 1000];
const PENDING_JOIN_KEY = "helios-coop-pending-joins-v1";
const JOIN_LIFETIME_MS = 10 * 60_000;
const JOIN_TOKEN = /^[A-Za-z0-9_-]{43}$/;
interface PendingJoin {
  target: string;
  callsign: string;
  joinToken: string;
  createdAt: number;
}
let pendingJoins: PendingJoin[] = [];

class MultiplayerTransportError extends Error {}

const abortReason = (signal?: AbortSignal | null) =>
  signal?.reason ?? new DOMException("The request was cancelled.", "AbortError");

function pauseBeforeRetry(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const cancel = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(abortReason(signal));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function requestOnce<T>(path: string, options: RequestInit, token?: string): Promise<T> {
  if (options.signal?.aborted) throw abortReason(options.signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      // A gateway page or a dropped response body can arrive after a valid
      // request has committed. Preserve its retry identity instead of claiming
      // that the room is invalid or creating another player slot.
      if (response.ok)
        throw new MultiplayerTransportError(
          "Online co-op returned an incomplete response. Please try again.",
        );
    }
    if (!response.ok) {
      throw new MultiplayerError(
        typeof body?.error === "string"
          ? body.error
          : "Online co-op is temporarily unavailable. Please try again.",
        response.status,
      );
    }
    if (body === null || body === undefined)
      throw new MultiplayerTransportError(
        "Online co-op returned an incomplete response. Please try again.",
      );
    return body as T;
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (controller.signal.aborted)
      throw new MultiplayerTransportError(
        "Online co-op took too long to respond. Please try again.",
      );
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "NetworkError")
    )
      throw new MultiplayerTransportError(
        "Unable to reach the online co-op service. Check your connection and try again.",
      );
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
  retrySafe = false,
): Promise<T> {
  if (!API) throw new Error("Online co-op is not connected yet.");
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce<T>(path, options, token);
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      const transient =
        error instanceof MultiplayerTransportError ||
        (error instanceof MultiplayerError && (error.status === 408 || error.status >= 500));
      if (!retrySafe || !transient || attempt >= RETRY_DELAYS.length) throw error;
      await pauseBeforeRetry(RETRY_DELAYS[attempt], options.signal);
    }
  }
}

function writePendingJoins(entries: PendingJoin[]) {
  pendingJoins = entries;
  try {
    localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify(entries));
  } catch {
    /* Memory still protects retries when storage is unavailable. */
  }
}

function readPendingJoins() {
  let saved: unknown = [];
  try {
    saved = JSON.parse(localStorage.getItem(PENDING_JOIN_KEY) ?? "[]");
  } catch {
    /* Use the live attempt if storage is unavailable. */
  }
  const merged = new Map<string, PendingJoin>();
  for (const entry of [...(Array.isArray(saved) ? saved : []), ...pendingJoins]) {
    if (
      !entry ||
      typeof entry.target !== "string" ||
      entry.target.length > 128 ||
      typeof entry.callsign !== "string" ||
      entry.callsign.length > 24 ||
      typeof entry.joinToken !== "string" ||
      !JOIN_TOKEN.test(entry.joinToken) ||
      !Number.isFinite(entry.createdAt)
    )
      continue;
    const age = Date.now() - entry.createdAt;
    if (age < 0 || age >= JOIN_LIFETIME_MS) continue;
    const key = JSON.stringify([entry.target, entry.callsign]);
    const previous = merged.get(key);
    if (!previous || previous.createdAt <= entry.createdAt) merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
}

function pendingJoin(target: string, callsign: string): PendingJoin {
  const entries = readPendingJoins();
  const existing = entries.find((entry) => entry.target === target && entry.callsign === callsign);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const joinToken = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const next = { target, callsign, joinToken, createdAt: Date.now() };
  writePendingJoins([next, ...entries].slice(0, 8));
  return next;
}

function finishJoin(attempt: PendingJoin) {
  writePendingJoins(readPendingJoins().filter((entry) => entry.joinToken !== attempt.joinToken));
}

async function join(path: string, target: string, callsign: string): Promise<CoopSession> {
  const attempt = pendingJoin(target, callsign.trim().replace(/\s+/g, " "));
  try {
    const session = await request<CoopSession>(
      path,
      {
        method: "POST",
        body: JSON.stringify({ callsign: attempt.callsign, joinToken: attempt.joinToken }),
      },
      undefined,
      true,
    );
    saveCoopSession(session);
    finishJoin(attempt);
    return session;
  } catch (error) {
    // A rate limit or access check can fail before the room sees a replay.
    // Keep its capability so a later manual retry can recover a committed slot.
    if (error instanceof MultiplayerError && [400, 404, 409, 410, 422].includes(error.status))
      finishJoin(attempt);
    throw error;
  }
}

function create(path: string, body: object, developerToken?: string) {
  return request<CoopSession>(
    path,
    { method: "POST", body: JSON.stringify(body) },
    developerToken,
  ).then(saveCoopSession);
}

export const createPrivateRoom = (callsign: string, developerToken: string) =>
  create("/rooms/private", { callsign }, developerToken);
export const createPublicRoom = (callsign: string, name: string, developerToken: string) =>
  create("/rooms/public", { callsign, name }, developerToken);
export const quickJoinRoom = (callsign: string) => join("/rooms/quick", "quick", callsign);
export const joinRoom = (callsign: string, code: string) =>
  join(
    `/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`,
    `room:${code.trim().toUpperCase()}`,
    callsign,
  );
export const getPublicRooms = (cursor = "", limit = 20, signal?: AbortSignal) =>
  request<PublicRoomPage>(
    `/rooms/public?limit=${limit}&cursor=${encodeURIComponent(cursor)}`,
    { signal },
    undefined,
    true,
  );

export function saveCoopSession(session: CoopSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Reconnect remains available for the current component lifetime. */
  }
  return session;
}

export function loadCoopSession(): CoopSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (
      value &&
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(value.roomCode) &&
      (value.playerId === "p1" || value.playerId === "p2") &&
      /^[A-Za-z0-9_-]{43}$/.test(value.reconnectToken) &&
      value.room
    ) {
      return value as CoopSession;
    }
  } catch {
    /* Invalid or inaccessible storage is treated as no recoverable session. */
  }
  return null;
}

export function clearCoopSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* The live connection can still close normally. */
  }
}

export function apiToWebSocketUrl(api: string, path: string) {
  const target = new URL(`${api.replace(/\/$/, "")}${path}`, window.location.href);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}

export class CoopConnection {
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private retry: number | null = null;
  private disposed = false;
  private attempts = 0;
  private generation = 0;
  private ticketRequest: AbortController | null = null;
  private handshake: number | null = null;
  private lastReceivedAt = 0;
  private listening = false;

  private wake = () => {
    if (this.disposed || document.visibilityState === "hidden") return;
    if (!this.socket || Date.now() - this.lastReceivedAt > 25_000) void this.connect();
    else this.send({ type: "heartbeat" });
  };

  constructor(
    readonly session: CoopSession,
    private readonly onMessage: (message: MultiplayerServerMessage) => void,
    private readonly onState: (state: CoopConnectionState) => void,
  ) {}

  async connect() {
    this.disposed = false;
    if (!this.listening) {
      window.addEventListener("online", this.wake);
      document.addEventListener("visibilitychange", this.wake);
      this.listening = true;
    }
    const generation = ++this.generation;
    this.releaseTransport();
    const controller = new AbortController();
    this.ticketRequest = controller;
    this.onState(this.attempts ? "reconnecting" : "connecting");
    try {
      const ticket = await request<{ socketTicket: string }>(
        `/rooms/${this.session.roomCode}/tickets`,
        { method: "POST", signal: controller.signal },
        this.session.reconnectToken,
      );
      if (this.disposed || generation !== this.generation) return;
      this.ticketRequest = null;
      const socketUrl = apiToWebSocketUrl(
        API,
        `/rooms/${this.session.roomCode}/socket?ticket=${encodeURIComponent(ticket.socketTicket)}`,
      );
      const socket = new WebSocket(socketUrl);
      this.socket = socket;
      this.lastReceivedAt = Date.now();
      this.handshake = window.setTimeout(() => this.reconnect(socket), 12_000);
      socket.addEventListener("open", () => {
        if (this.disposed || socket !== this.socket) return socket.close();
        // Opening TCP alone does not prove that the room accepted this session.
        this.heartbeat = window.setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN || Date.now() - this.lastReceivedAt > 25_000)
            this.reconnect(socket);
          else this.send({ type: "heartbeat" });
        }, 5_000);
      });
      socket.addEventListener("message", (event) => {
        if (socket !== this.socket || typeof event.data !== "string") return;
        let message: MultiplayerServerMessage;
        try {
          message = JSON.parse(event.data) as MultiplayerServerMessage;
        } catch {
          return;
        }
        if (!message || typeof message !== "object" || !("type" in message)) return;
        this.lastReceivedAt = Date.now();
        if (message.type === "welcome") {
          if (this.handshake !== null) window.clearTimeout(this.handshake);
          this.handshake = null;
          this.attempts = 0;
          this.onState("connected");
        }
        if (message.type === "error" && message.code === "session_replaced") this.close();
        this.onMessage(message);
      });
      socket.addEventListener("close", (event) => {
        if (socket !== this.socket) return;
        if (event.code === 4001 || event.code === 4003) {
          this.close();
          if (event.code === 4003) clearCoopSession();
          this.onMessage({
            type: "error",
            code: event.code === 4001 ? "session_replaced" : "session_expired",
            message:
              event.code === 4001
                ? "This session is connected in another tab. Continue there, or reconnect here."
                : "This co-op session is no longer available. Join a new room.",
          });
        } else this.reconnect(socket);
      });
      socket.addEventListener("error", () => this.reconnect(socket));
    } catch (error) {
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      if (error instanceof MultiplayerError && (error.status === 401 || error.status === 404)) {
        this.close();
        clearCoopSession();
        this.onMessage({
          type: "error",
          code: "session_expired",
          message: "This co-op session has expired. Leave the room and join again.",
        });
        return;
      }
      this.scheduleReconnect();
    }
  }

  send(message: MultiplayerClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.reconnect(this.socket);
      return false;
    }
  }

  leave() {
    this.send({ type: "leave" });
    clearCoopSession();
    this.close();
  }

  close() {
    this.disposed = true;
    this.generation++;
    this.releaseTransport();
    if (this.listening) {
      window.removeEventListener("online", this.wake);
      document.removeEventListener("visibilitychange", this.wake);
      this.listening = false;
    }
    this.onState("closed");
  }

  private releaseTransport() {
    this.ticketRequest?.abort();
    this.ticketRequest = null;
    if (this.retry !== null) window.clearTimeout(this.retry);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    if (this.handshake !== null) window.clearTimeout(this.handshake);
    this.retry = this.heartbeat = this.handshake = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, "Client closed");
    } catch {
      /* Already gone. */
    }
  }

  private reconnect(socket: WebSocket) {
    if (socket !== this.socket) return;
    this.releaseTransport();
    if (!this.disposed) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed || this.retry !== null) return;
    this.onState("reconnecting");
    const delay =
      Math.min(5000, 500 * 2 ** Math.min(this.attempts++, 4)) * (0.8 + Math.random() * 0.4);
    this.retry = window.setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }
}

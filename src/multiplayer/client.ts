import type {
  MultiplayerClientMessage,
  MultiplayerRoomView,
  MultiplayerServerMessage,
  PublicRoomSummary,
} from "../game/network/protocol";
import type { CoopPlayerId } from "../game/simulation/coop-types";

const viteEnvironment = import.meta.env ?? ({} as ImportMetaEnv);
const configuredUrl = (viteEnvironment.VITE_MULTIPLAYER_URL || "").trim().replace(/\/$/, "");
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

class MultiplayerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isMultiplayerConfigured = () => Boolean(API);

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!API) throw new Error("Online co-op is not connected yet.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 8000);
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
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MultiplayerError(
        typeof body?.error === "string" ? body.error : "Online co-op request failed.",
        response.status,
      );
    }
    if (body === null) throw new Error("Online co-op returned an invalid response.");
    return body as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("Online co-op took too long to respond.");
    if (error instanceof TypeError) throw new Error("Unable to reach the online co-op service.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function create(path: string, body: object) {
  return request<CoopSession>(path, { method: "POST", body: JSON.stringify(body) }).then(
    saveCoopSession,
  );
}

export const createPrivateRoom = (callsign: string) => create("/rooms/private", { callsign });
export const createPublicRoom = (callsign: string, name: string) =>
  create("/rooms/public", { callsign, name });
export const quickJoinRoom = (callsign: string) => create("/rooms/quick", { callsign });
export const joinRoom = (callsign: string, code: string) =>
  create(`/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, { callsign });
export const getPublicRooms = (cursor = "", limit = 20, signal?: AbortSignal) =>
  request<PublicRoomPage>(`/rooms/public?limit=${limit}&cursor=${encodeURIComponent(cursor)}`, {
    signal,
  });

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

  constructor(
    readonly session: CoopSession,
    private readonly onMessage: (message: MultiplayerServerMessage) => void,
    private readonly onState: (state: CoopConnectionState) => void,
  ) {}

  async connect() {
    this.disposed = false;
    this.onState(this.attempts ? "reconnecting" : "connecting");
    try {
      const ticket = await request<{ socketTicket: string }>(
        `/rooms/${this.session.roomCode}/tickets`,
        { method: "POST" },
        this.session.reconnectToken,
      );
      if (this.disposed) return;
      const socketUrl = apiToWebSocketUrl(
        API,
        `/rooms/${this.session.roomCode}/socket?ticket=${encodeURIComponent(ticket.socketTicket)}`,
      );
      const socket = new WebSocket(socketUrl);
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (this.disposed || socket !== this.socket) return socket.close();
        this.attempts = 0;
        this.onState("connected");
        this.heartbeat = window.setInterval(() => this.send({ type: "heartbeat" }), 10_000);
      });
      socket.addEventListener("message", (event) => {
        if (socket !== this.socket || typeof event.data !== "string") return;
        try {
          this.onMessage(JSON.parse(event.data) as MultiplayerServerMessage);
        } catch {
          /* Ignore malformed server frames without taking down the page. */
        }
      });
      socket.addEventListener("close", () => this.handleClose(socket));
      socket.addEventListener("error", () => socket.close());
    } catch (error) {
      if (error instanceof MultiplayerError && (error.status === 401 || error.status === 404)) {
        this.disposed = true;
        clearCoopSession();
        this.onMessage({
          type: "error",
          code: "session_expired",
          message: "This co-op session has expired. Leave the room and join again.",
        });
        this.onState("closed");
        return;
      }
      this.scheduleReconnect();
    }
  }

  send(message: MultiplayerClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  leave() {
    this.send({ type: "leave" });
    clearCoopSession();
    this.close();
  }

  close() {
    this.disposed = true;
    if (this.retry !== null) window.clearTimeout(this.retry);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.retry = this.heartbeat = null;
    this.socket?.close(1000, "Client closed");
    this.socket = null;
    this.onState("closed");
  }

  private handleClose(socket: WebSocket) {
    if (socket !== this.socket) return;
    this.socket = null;
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (!this.disposed) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed || this.retry !== null) return;
    this.onState("reconnecting");
    const delay = Math.min(5000, 500 * 2 ** Math.min(this.attempts++, 4));
    this.retry = window.setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }
}

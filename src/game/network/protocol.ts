import type { CoopMatchState, CoopPlayerId } from "../simulation/coop-types";

export interface MultiplayerRoomPlayer {
  id: CoopPlayerId;
  callsign: string;
  ready: boolean;
  connected: boolean;
  left: boolean;
}

export interface MultiplayerRoomView {
  code: string;
  phase: "waiting" | "running" | "finished" | "closed";
  createdAt: number;
  expiresAt: number;
  players: Record<CoopPlayerId, MultiplayerRoomPlayer | null>;
}

export interface ClientInputMessage {
  type: "input";
  sequence: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  fire: boolean;
  interact: boolean;
}

export type MultiplayerClientMessage =
  | ClientInputMessage
  | { type: "heartbeat" }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "leave" };

export interface AuthoritativeSnapshot {
  type: "snapshot";
  serverTime: number;
  serverTick: number;
  acknowledgements: Record<CoopPlayerId, number>;
  state: CoopMatchState;
  events: unknown[];
}

export type MultiplayerServerMessage =
  | { type: "welcome"; playerId: CoopPlayerId; room: MultiplayerRoomView }
  | { type: "room"; room: MultiplayerRoomView }
  | AuthoritativeSnapshot
  | { type: "pong"; serverTime: number }
  | { type: "error"; code: string; message: string };

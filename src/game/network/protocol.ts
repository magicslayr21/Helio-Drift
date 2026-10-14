import type { SalvageUpgradeId, WeaponId } from "../types";
import type { CoopPlayerId } from "../simulation/coop-types";
import type { CoopWireState } from "./wire-state";

export interface MultiplayerRoomPlayer {
  id: CoopPlayerId;
  callsign: string;
  ready: boolean;
  connected: boolean;
  left: boolean;
}

export interface MultiplayerRoomView {
  assisted?: boolean;
  code: string;
  visibility: "private" | "public";
  name: string | null;
  phase: "waiting" | "running" | "finished" | "closed";
  playerCount: number;
  capacity: 2;
  joinable: boolean;
  createdAt: number;
  expiresAt: number;
  players: Record<CoopPlayerId, MultiplayerRoomPlayer | null>;
}

export interface PublicRoomSummary {
  code: string;
  name: string;
  phase: "waiting";
  playerCount: number;
  capacity: 2;
  joinable: boolean;
  createdAt: number;
}

export interface ClientInputMessage {
  type: "input";
  sequence: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  fire: boolean;
  missile: boolean;
  interact: boolean;
}

export type MultiplayerClientMessage =
  | ClientInputMessage
  | { type: "developer"; token: string; command: import("../developer-command").DeveloperCommand }
  | { type: "buyWeapon"; sequence: number; weapon: WeaponId }
  | { type: "selectWeapon"; sequence: number; weapon: WeaponId }
  | { type: "buyDrone"; sequence: number }
  | { type: "buyDroneUpgrade"; sequence: number; upgrade: SalvageUpgradeId }
  | { type: "equipDroneWeapon"; sequence: number; weapon: WeaponId | null }
  | { type: "chooseUpgrade"; sequence: number; upgrade: string }
  | { type: "rerollUpgrades"; sequence: number }
  | { type: "activateOverdrive"; sequence: number }
  | { type: "startBonusBoss"; sequence: number }
  | { type: "declineBonusBoss"; sequence: number }
  | { type: "heartbeat" }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "leave" };

export interface AuthoritativeSnapshot {
  pause?: { playerId: CoopPlayerId; until: number } | null;
  type: "snapshot";
  serverTime: number;
  serverTick: number;
  acknowledgements: Record<CoopPlayerId, number>;
  state: CoopWireState;
  events: unknown[];
}

export type MultiplayerServerMessage =
  | { type: "welcome"; playerId: CoopPlayerId; room: MultiplayerRoomView }
  | { type: "room"; room: MultiplayerRoomView }
  | AuthoritativeSnapshot
  | { type: "pong"; serverTime: number }
  | { type: "error"; code: string; message: string };

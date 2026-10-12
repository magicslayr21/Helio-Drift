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
  missile: boolean;
  interact: boolean;
}

export type MultiplayerClientMessage =
  | ClientInputMessage
  | { type: "buyWeapon"; sequence: number; weapon: WeaponId }
  | { type: "selectWeapon"; sequence: number; weapon: WeaponId }
  | { type: "buyDrone"; sequence: number }
  | { type: "buyDroneUpgrade"; sequence: number; upgrade: SalvageUpgradeId }
  | { type: "equipDroneWeapon"; sequence: number; weapon: WeaponId | null }
  | { type: "chooseUpgrade"; sequence: number; upgrade: string }
  | { type: "activateOverdrive"; sequence: number }
  | { type: "startBonusBoss"; sequence: number }
  | { type: "declineBonusBoss"; sequence: number }
  | { type: "heartbeat" }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "leave" };

export interface AuthoritativeSnapshot {
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

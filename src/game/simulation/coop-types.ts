import type { RockTrait, SalvageDrone, SalvageUpgradeId, WeaponId, Player } from "../types";
import type { FlightIntent } from "./movement";

export type CoopPlayerId = "p1" | "p2";
export type CoopMatchPhase = "waiting" | "running" | "victory" | "defeat";

export interface CoopInputState extends FlightIntent {
  fire: boolean;
  interact: boolean;
}

export interface CoopPlayerStats {
  damage: number;
  kills: number;
  asteroidKills: number;
  bossDamage: number;
  revives: number;
  creditsCollected: number;
}

export interface CoopPlayerState {
  id: CoopPlayerId;
  callsign: string;
  ship: Player;
  credits: number;
  level: number;
  xp: number;
  xpNext: number;
  upgrades: Record<string, number>;
  upgradePoints: number;
  drone: SalvageDrone;
  disabled: boolean;
  reviveProgress: number;
  reviveCooldown: number;
  lastInputSequence: number;
  input: CoopInputState;
  stats: CoopPlayerStats;
}

export interface CoopRockState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  size: 1 | 2 | 3;
  hp: number;
  maxHp: number;
  trait: RockTrait;
}

export interface CoopProjectileState {
  id: number;
  ownerId: CoopPlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  pierce: number;
  bounces: number;
  homing: number;
  hitIds: number[];
  weapon: WeaponId;
}

export interface CoopPickupState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: "credit" | "repair";
  value: number;
  life: number;
}

export interface CoopBossState {
  id: number;
  mk: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
}

export interface CoopTeamState {
  score: number;
  wave: number;
  sector: number;
  bossesDefeated: number;
  overdrive: number;
  overdriveRemaining: number;
  elapsedSeconds: number;
}

export interface CoopMatchState {
  version: 1;
  seed: number;
  randomState: number;
  tick: number;
  clockAccumulator: number;
  phase: CoopMatchPhase;
  nextEntityId: number;
  players: Record<CoopPlayerId, CoopPlayerState>;
  team: CoopTeamState;
  rocks: CoopRockState[];
  projectiles: CoopProjectileState[];
  pickups: CoopPickupState[];
  boss: CoopBossState | null;
}

export type CoopCommand =
  | {
      type: "input";
      playerId: CoopPlayerId;
      sequence: number;
      moveX: number;
      moveY: number;
      aimAngle: number;
      fire: boolean;
      interact: boolean;
    }
  | { type: "buyWeapon"; playerId: CoopPlayerId; sequence: number; weapon: WeaponId }
  | { type: "buyDrone"; playerId: CoopPlayerId; sequence: number }
  | {
      type: "buyDroneUpgrade";
      playerId: CoopPlayerId;
      sequence: number;
      upgrade: SalvageUpgradeId;
    }
  | { type: "chooseUpgrade"; playerId: CoopPlayerId; sequence: number; upgrade: string }
  | { type: "activateOverdrive"; playerId: CoopPlayerId; sequence: number };

export type CoopEvent =
  | { type: "waveStarted"; tick: number; wave: number; sector: number }
  | { type: "weaponFired"; tick: number; playerId: CoopPlayerId; weapon: WeaponId }
  | { type: "asteroidDestroyed"; tick: number; playerId: CoopPlayerId; entityId: number }
  | { type: "bossDamaged"; tick: number; playerId: CoopPlayerId; amount: number }
  | { type: "bossDefeated"; tick: number; playerId: CoopPlayerId; mk: number }
  | { type: "purchaseAccepted"; tick: number; playerId: CoopPlayerId; item: string; cost: number }
  | { type: "purchaseRejected"; tick: number; playerId: CoopPlayerId; item: string }
  | { type: "playerDisabled"; tick: number; playerId: CoopPlayerId }
  | { type: "playerRevived"; tick: number; playerId: CoopPlayerId; by: CoopPlayerId }
  | { type: "overdriveActivated"; tick: number; playerId: CoopPlayerId }
  | { type: "matchEnded"; tick: number; outcome: "victory" | "defeat" };

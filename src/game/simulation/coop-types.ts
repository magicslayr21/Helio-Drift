import type { RockTrait, SalvageDrone, SalvageUpgradeId, WeaponId, Player } from "../types";
import type { FlightIntent } from "./movement";

export type CoopPlayerId = "p1" | "p2";
export type CoopMatchPhase = "waiting" | "running" | "bonusOffer" | "victory" | "defeat";
export type CoopDirectiveId = "asteroidSurge" | "elitePatrol" | "volatileSpace";

export interface CoopInputState extends FlightIntent {
  fire: boolean;
  missile: boolean;
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
  reviveLockout: number;
  supportQuietTimer: number;
  lastInputSequence: number;
  lastCommandSequence: number;
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
  fuse: number;
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
  kind: "shot" | "missile" | "shrapnel";
  fuse: number;
  blastRadius: number;
  blastDamage: number;
  extra: number;
  extraDamage: number;
}

export type CoopEnemyKind =
  | "sentinel"
  | "warden"
  | "spiker"
  | "wardenTurret"
  | "tetherSentinel"
  | "mineWarden";

export interface CoopEnemyState {
  id: number;
  kind: CoopEnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  fireTimer: number;
  behaviorTimer: number;
  warningTimer: number;
  burst: number;
  targetPlayerId: CoopPlayerId | null;
  aimX: number;
  aimY: number;
}

export interface CoopHostileProjectileState {
  id: number;
  sourceId: number;
  source: CoopEnemyKind | "boss";
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  hitPlayerIds: CoopPlayerId[];
}

export interface CoopHazardState {
  id: number;
  sourceId: number;
  kind: "strike" | "shockwave" | "singularity";
  x: number;
  y: number;
  radius: number;
  timer: number;
  damage: number;
}

export interface CoopTetherState {
  id: number;
  sourceId: number;
  targetPlayerId: CoopPlayerId;
  strength: number;
  minimumDistance: number;
  maximumDistance: number;
}

export interface CoopMineState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  armTimer: number;
  triggerTimer: number;
  blastRadius: number;
  damage: number;
  life: number;
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
  vx: number;
  vy: number;
  phase: 1 | 2 | 3;
  attackTimer: number;
  abilityTimer: number;
}

export interface CoopTeamState {
  score: number;
  wave: number;
  sector: number;
  bossesDefeated: number;
  overdrive: number;
  overdriveRemaining: number;
  elapsedSeconds: number;
  directive: CoopDirectiveId | null;
  bonusAvailable: boolean;
  bonusActive: boolean;
  bonusDefeated: boolean;
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
  enemies: CoopEnemyState[];
  projectiles: CoopProjectileState[];
  hostileProjectiles: CoopHostileProjectileState[];
  hazards: CoopHazardState[];
  tethers: CoopTetherState[];
  mines: CoopMineState[];
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
      missile: boolean;
      interact: boolean;
    }
  | { type: "buyWeapon"; playerId: CoopPlayerId; sequence: number; weapon: WeaponId }
  | { type: "selectWeapon"; playerId: CoopPlayerId; sequence: number; weapon: WeaponId }
  | { type: "buyDrone"; playerId: CoopPlayerId; sequence: number }
  | {
      type: "buyDroneUpgrade";
      playerId: CoopPlayerId;
      sequence: number;
      upgrade: SalvageUpgradeId;
    }
  | { type: "chooseUpgrade"; playerId: CoopPlayerId; sequence: number; upgrade: string }
  | { type: "equipDroneWeapon"; playerId: CoopPlayerId; sequence: number; weapon: WeaponId | null }
  | { type: "activateOverdrive"; playerId: CoopPlayerId; sequence: number }
  | { type: "startBonusBoss"; playerId: CoopPlayerId; sequence: number }
  | { type: "declineBonusBoss"; playerId: CoopPlayerId; sequence: number };

export type CoopEvent =
  | { type: "waveStarted"; tick: number; wave: number; sector: number }
  | { type: "weaponFired"; tick: number; playerId: CoopPlayerId; weapon: WeaponId }
  | { type: "missileFired"; tick: number; playerId: CoopPlayerId }
  | { type: "asteroidDestroyed"; tick: number; playerId: CoopPlayerId; entityId: number }
  | { type: "bossDamaged"; tick: number; playerId: CoopPlayerId; amount: number }
  | { type: "bossDefeated"; tick: number; playerId: CoopPlayerId; mk: number }
  | { type: "bossAbility"; tick: number; mk: number; ability: string }
  | { type: "enemySpawned"; tick: number; entityId: number; kind: CoopEnemyKind }
  | { type: "enemyDestroyed"; tick: number; playerId: CoopPlayerId; entityId: number }
  | { type: "playerDamaged"; tick: number; playerId: CoopPlayerId; amount: number }
  | { type: "pickupCollected"; tick: number; playerId: CoopPlayerId; kind: "credit" | "repair" }
  | { type: "purchaseAccepted"; tick: number; playerId: CoopPlayerId; item: string; cost: number }
  | { type: "purchaseRejected"; tick: number; playerId: CoopPlayerId; item: string }
  | { type: "playerDisabled"; tick: number; playerId: CoopPlayerId }
  | { type: "playerRevived"; tick: number; playerId: CoopPlayerId; by: CoopPlayerId }
  | { type: "overdriveActivated"; tick: number; playerId: CoopPlayerId }
  | { type: "directiveSelected"; tick: number; directive: CoopDirectiveId; sector: number }
  | { type: "tetherStarted"; tick: number; entityId: number; playerId: CoopPlayerId }
  | { type: "tetherBroken"; tick: number; entityId: number; playerId: CoopPlayerId }
  | { type: "mineDeployed"; tick: number; entityId: number }
  | { type: "mineDestroyed"; tick: number; entityId: number; playerId: CoopPlayerId }
  | { type: "bonusBossOffered"; tick: number }
  | { type: "bonusBossStarted"; tick: number; playerId: CoopPlayerId }
  | { type: "matchEnded"; tick: number; outcome: "victory" | "defeat" };

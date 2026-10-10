/* Shared types for HELIOS DRIFT. Pure type definitions — no runtime code.
   New entities and HUD fields are declared here first. */

import type { Game } from "./engine";

/* ------------------------------------------------------------ core unions */

export type Mode = "menu" | "playing" | "paused" | "levelup" | "gameover" | "victory";
export type WeaponId =
  | "pulse"
  | "spread"
  | "seeker"
  | "ricochet"
  | "flak"
  | "arc"
  | "laser"
  | "rail";
export type RockTrait = "none" | "homing" | "bounce" | "boom" | "fast" | "meteor" | "meteorite";
export type SalvageUpgradeId =
  | "twinCannons"
  | "overcharge"
  | "piercing"
  | "armor"
  | "shield"
  | "repairPulse"
  | "magnet"
  | "scan"
  | "speed";
export type Rarity = "common" | "rare" | "epic";

/** Mutable run state; numeric tuning literals must widen to numbers here. */
export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hull: number;
  maxHull: number;
  armor: number;
  thrust: number;
  maxSpeed: number;
  turn: number;
  fireRateMul: number;
  damageMul: number;
  bulletSpeed: number;
  extraShots: number;
  pierce: number;
  crit: number;
  critMult: number;
  inaccuracy: number;
  heat: number;
  arcTimer: number;
  missiles: number;
  maxMissiles: number;
  blastDmg: number;
  blastR: number;
  missileTimer: number;
  missileRegen: number;
  missileCharge: number;
  magnet: number;
  creditChance: number;
  creditValue: number;
  leech: number;
  fireTimer: number;
  invuln: number;
  primary: WeaponId;
  weapons: Record<WeaponId, number>;
  overheated: boolean;
  beamOn: boolean;
  missileHeld: boolean;
  thrusting: boolean;
}

/* ------------------------------------------------------------ HUD & shop */

export interface Hud {
  mode: Mode;
  score: number;
  credits: number;
  wave: number;
  level: number;
  xp: number;
  xpNext: number;
  hull: number;
  maxHull: number;
  sector: number;
  primary: WeaponId;
  weaponLevel: number;
  owned: { id: WeaponId; level: number }[];
  missiles: number;
  maxMissiles: number;
  missileCharge: number;
  heat: number;
  comboTime: number;
  multiplier: number;
  banner: string;
  bannerSub: string;
  salvage: {
    purchased: boolean;
    active: boolean;
    hp: number;
    maxHp: number;
    rebuilding: number;
    weapon: WeaponId | null;
    upgrades: { id: SalvageUpgradeId; level: number }[];
  };
  /** for the pause screen: every stat upgrade taken and the combined result */
  boosts: {
    taken: { id: string; name: string; tag: string; level: number; max: number }[];
    totals: { label: string; value: string }[];
    totalStacks: number;
  };
  showerActive: boolean;
  bonusAvailable: boolean;
  bonusActive: boolean;
  bonusDefeated: boolean;
}

export interface UpgradeCard {
  id: string;
  name: string;
  desc: string;
  tag: string;
  rarity: Rarity;
  /** current level / stack count (0 = not owned yet) */
  level: number;
  kind: "stat";
}

export interface WeaponStatRow {
  label: string;
  value: string;
}

export interface WeaponShopInfo {
  id: WeaponId;
  level: number;
  maxLevel: number;
  price: number | null;
  rarity: Rarity;
  owned: boolean;
  current: WeaponStatRow[];
  next: WeaponStatRow[];
}

export interface SalvageUpgradeInfo {
  id: SalvageUpgradeId;
  name: string;
  path: "offense" | "support" | "utility";
  desc: string;
  level: number;
  max: number;
  price: number | null;
  owned: boolean;
}

export interface SalvageShopInfo {
  purchased: boolean;
  active: boolean;
  hp: number;
  maxHp: number;
  rebuilding: number;
  basePrice: number;
  weapon: WeaponId | null;
  weaponOptions: { id: WeaponId; level: number; owned: boolean; equippedByPlayer: boolean }[];
  upgrades: SalvageUpgradeInfo[];
}

/* ------------------------------------------------------------ entities */

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  dmg: number;
  kind:
    | "plasma"
    | "enemy"
    | "droneShot"
    | "rail"
    | "missile"
    | "seeker"
    | "ricochet"
    | "flak"
    | "shrap"
    | "wardenOrb"
    | "wardenShard";
  pierce: number;
  color: string;
  hitIds: Set<number>;
  target?: number;
  turn: number;
  bounces: number;
  fuse: number;
  extra: number; // flak: shrapnel count
  extraDmg: number; // flak: shrapnel damage
  /** Human-readable source for the fatal-hit report; has no combat effect. */
  damageCause?: string;
  /** enemy shells that detonate when they expire without hitting anything */
  blast?: number;
  /** Smart turret nest fields (persistent warden nest) */
  hpNow?: number;
  spawnT?: number;
  nested?: number;

  /** Warden miniboss ability: sniper telegraph + splitter-turret cooldown */
  pulseCharge?: number;
  volleyCd?: number;
  volleyCharge?: number;
}

export interface Crack {
  pts: { x: number; y: number }[];
  at: number;
}

export interface Rock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  size: 1 | 2 | 3;
  hp: number;
  maxHp: number;
  rot: number;
  rotSpeed: number;
  pts: number[];
  flash: number;
  cracks: Crack[];
  trait: RockTrait;
  /** wall rocks self-destruct so big patterns can never clog the arena */
  life?: number;
  /** launched by a boss ability on its own lifespan timer: survives the stage-change purge and passes the remaining time to its fragments */
  keep?: boolean;
  /** boom creeper timer when player is close */
  fuse?: number;
  bounces?: number;
}

/* Sentinels hunt, wardens snipe, and spikers drift while firing radial volleys. */
export interface Drone {
  id: number;
  kind: "sentinel" | "warden" | "spiker";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  angle: number;
  fire: number;
  flash: number;
  orbitDir: number;
  orbitTimer: number;
  evadeCd: number;
  burst: number;
  /** Warden miniboss ability: sniper telegraph countdown + splitter-turret charge state */
  pulseCharge?: number;
  volleyCd?: number;
  volleyCharge?: number;
  /** Locked sniper aim point (player position captured when the warden locks on) */
  sniperAimX: number;
  sniperAimY: number;
}

export interface Boss {
  id: number;
  name: string;
  suffix: string;
  mk: number;
  /** which asteroid trait its hull shards (and escorts) carry */
  spawnTrait: RockTrait;
  edgeColor: string;
  spawnWeight: number;
  hpMul: number;
  timerMul: number;
  /** projectile multiplier and rocks shed per spawn event — MK4/MK5 are packed */
  bulletMul: number;
  rocksPer: number;
  final: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  rot: number;
  rotSpeed: number;
  pts: number[];
  cracks: Crack[];
  flash: number;
  t: number;
  attackTimer: number;
  /** stage tracking — a new signature attack set fires at each stage change */
  phase: number;
  rainT: number;
  rainN: number;
  flankT: number;
  flankSide: number;
  /** t0 keeps each telegraph's progress relative to its own countdown */
  strikes: { x: number; y: number; t: number; t0: number }[];
  /** MK4 · Boom Launch — marked drop points that become boom rocks when their warning runs out */
  boomDrops: { x: number; y: number; t: number; t0: number }[];
  wallT: number;
  wallN: number;
  wallSide: number;
  /** MK3 · Pinball Cascade — launched bounce rocks and their rebound charge */
  cascadeN: number;
  cascadeT: number;
  cascadeCharge: number;
  /** MK3 · Ricochet Ring — orbiting bounce rocks that mirror-aim at the player */
  ricochetRing: number;
  ricochetPhase: number;
  ricochetFired: number;
  ricochetT: number;
  /** shockwave blast around the boss: telegraph countdown and its duration */
  shockT: number;
  shockDur: number;
  shockRadius: number;
  /** singularity: drags the player toward a point for a set time, can be destroyed by shooting */
  hole: Singularity | null;
  /** regenesis shield: an extra 10% buffer shown on the boss bar */
  shieldHp: number;
  shieldT: number;
  /**
   * Movement state is intentionally separate from attacks. MK1–MK5 keep moving
   * while their attacks run; MK6 is the exception and waits for a clean ability
   * slate before entering its scripted side-raid.
   */
  movement: {
    mode:
      | "drift"
      | "mk5Telegraph"
      | "mk5Dash"
      | "mk6Vanish"
      | "mk6Left"
      | "mk6Right"
      | "mk6ReturnTelegraph"
      | "mk6Return";
    timer: number;
    timerTotal?: number;
    startX?: number;
    startY?: number;
    targetX: number;
    targetY: number;
    baseSpeed: number;
    bounceBoost: number;
    mk4StrikeCd: number;
    mk6RaidPending: boolean;
    mk6RaidDone: boolean;
    raidMeteorT: number;
    /** frame of the last "hull locked" callout, so it never spams */
    mk6LockFrame?: number;
  };
  /** MK6 (bonus boss) state — a meteor-themed attack rotation */
  mk6: {
    /** one running set normally; two concurrently once below 35% health */
    slots: Mk6Slot[];
    /** ids of the transient random asteroid field, cleared before the next set */
    fieldIds: number[];
    /** contact-tick cooldown so meteor beams can't stack into an instakill */
    beamCd: number;
    /** health marks whose reinforcement wave has already been spent */
    reinforced: number[];
    /** last MK6 ability started; the next pick must be different */
    lastAttack: Exclude<Mk6Attack, "idle"> | null;
    enraged: boolean;
  } | null;
}

export type Mk6Attack =
  | "idle"
  | "shower"
  | "barrage"
  | "beam"
  | "strikes"
  | "field"
  | "hole"
  | "heal";

export interface Mk6Slot {
  attack: Mk6Attack;
  label: string;
  t: number;
  spawnT: number;
  beamA: number;
  /** telegraphed meteor impact points with a large blast radius */
  strikes: { x: number; y: number; t: number; t0: number; r: number }[];
  healBlasts: { t: number; fired: boolean; silent?: boolean }[];
}

export interface Hostile {
  id: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

export interface Singularity {
  /** Continuous time spent inside the core; optional for older saves. */
  damageTimer?: number;
  id: number;
  x: number;
  y: number;
  t: number;
  maxT: number;
  pull: number;
  radius: number;
  hp: number;
  maxHp: number;
  flash: number;
  r: number;
  color: string;
  coreColor: string;
  ringColor: string;
  mk: number;
}

/* ------------------------------------------------------------ fx */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
}
export interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
  w: number;
}
export interface Text {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
  size: number;
}
export interface Pickup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: "credit" | "repair";
  value: number;
  life: number;
  pulse?: number;
}
export interface Arc {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}

/* ------------------------------------------------------------ salvage drone */

export interface SalvageDrone {
  purchased: boolean;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  rebuilding: number;
  assembly: number;
  orbit: number;
  fireTimer: number;
  pulseTimer: number;
  hitTimer: number;
  weapon: WeaponId | null;
  devCount: number;
  upgrades: Record<SalvageUpgradeId, number>;
  /** beam mount: whether the drone beam is currently lit and where it points */
  beamOn: boolean;
  beamAngle: number;
  beamLen: number;
}

/** a dev-only extra squad member: real position, health and fire state,
 *  sharing the primary drone's build */
export interface SalvageClone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  orbit: number;
  fireTimer: number;
  hitTimer: number;
  beamOn: boolean;
  beamAngle: number;
  beamLen: number;
}

/* ------------------------------------------------------------ tables */

export interface SectorTheme {
  numeral: string;
  name: string;
  tint: string;
  stars: [string, string];
}

/* Each dreadnought is a different ship: its own sector shadow, its own
   health and pacing, and its own asteroid offspring — MK1 sheds normals,
   MK2 homings, MK3 bouncers, MK4 explosives, MK5 fast rocks. */
export interface BossSpec {
  name: string;
  suffix: string;
  trait: RockTrait;
  edge: string;
  hpMul: number;
  timerMul: number;
  spawnWeight: number;
  driftX: number;
  bulletMul: number;
  rocksPer: number;
}

export interface StatUpgrade {
  id: string;
  name: string;
  tag: string;
  desc: string;
  rarity: Rarity;
  weight: number;
  max: number;
  apply: (g: Game) => void;
}

/* ------------------------------------------------------------ persistence */

export interface ScoreEntry {
  score: number;
  wave: number;
  level: number;
  date: string;
}

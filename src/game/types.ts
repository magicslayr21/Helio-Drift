/* Shared types for HELIOS DRIFT. Pure type definitions — no runtime code.
   New entities and HUD fields are declared here first. */

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

/* ------------------------------------------------------------ warheads */

export type WarheadSlot = "payload" | "guidance" | "trigger";
export type PayloadId =
  | "blast"
  | "cluster"
  | "gravity"
  | "emp"
  | "incendiary"
  | "solarFlare"
  | "cryo";
export type GuidanceId = "direct" | "corkscrew" | "relay" | "orbit" | "boomerang";
export type TriggerId = "impact" | "proximity" | "chain" | "delayed" | "siphon";
export type WarheadTier = 1 | 2 | 3;
/** Tier of each fitted part, copied onto missiles at launch. */
export type BuildTiers = Record<WarheadSlot, WarheadTier>;

/** One owned part in the Forge: fitted to a slot or waiting on the bench. */
export interface ForgePart {
  id: WarheadPartId;
  tier: WarheadTier;
  /** Heat earned from the damage this part's warheads dealt (cumulative) */
  heat: number;
  /** kills landed by this part's warheads while it was fitted (shown as a stat) */
  kills: number;
  /** every credit spent on it (unlock and tempering): scrap refunds half */
  spent: number;
}
export type MissileBayTrack = "velocity" | "yield" | "magazine" | "autoloader" | "seeker";
export type MissileBay = Record<MissileBayTrack, number>;

export interface MissileBayInfo {
  track: MissileBayTrack;
  level: number;
  max: number;
  /** price of the next level, or null at max */
  price: number | null;
}
export interface ForgePartInfo {
  part: ForgePart;
  /** total Heat for the next tier (null at Tier III) */
  nextHeat: number | null;
  /** Heat for the current tier's start, for drawing the bar */
  prevHeat: number;
  /** price to temper to the next tier right now (rush included), or null at Tier III */
  temperPrice: number | null;
  /** true when the Heat bar is full and tempering costs the base price */
  temperReady: boolean;
  scrap: number;
}
export interface CatalogueEntry {
  id: WarheadPartId;
  /** wave from which it can be unlocked */
  unlockWave: number;
  locked: boolean;
  owned: boolean;
  veteran: boolean;
  price: number;
  /** why it cannot be unlocked (apart from credits), or null */
  blocked: string | null;
}
export interface ForgeShopInfo {
  bay: MissileBayInfo[];
  /** total Missile Bay levels and the synergy they grant */
  bayLevels: number;
  heatBonus: number;
  temperDiscount: number;
  fitted: Record<WarheadSlot, ForgePartInfo>;
  bench: (ForgePartInfo | null)[];
  catalogue: CatalogueEntry[];
  /** stock parts that can be fitted free (their slot holds a bought part) */
  stock: WarheadPartId[];
}
export interface Forge {
  fitted: Record<WarheadSlot, ForgePart>;
  bench: (ForgePart | null)[];
}
export type WarheadPartId = PayloadId | GuidanceId | TriggerId;
export interface MissileBuild {
  payload: PayloadId;
  guidance: GuidanceId;
  trigger: TriggerId;
}
/** Default parts are fitted to every new ship; the rest are found in the Workshop. */
export type WarheadRarity = Rarity | "default";

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
  rangeMul: number;
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
  /** Salvo Lock: painted target ids (a target appears once per lock it holds). */
  missileLocks: number[];
  /** Seconds E has been held while painting; -1 when not painting. */
  missileHoldT: number;
  /** Countdown to the next lock while painting. */
  missileLockT: number;
  /** missileHoldT at the moment locks reached the rack size; -1 when not at Full Lock. */
  fullLockAt: number;
  /** Warhead Workshop: the payload, guidance and trigger fitted to every missile. */
  missileBuild: MissileBuild;
  /** Warhead Forge: owned parts with tier, kills and spend; missileBuild mirrors forge.fitted. */
  forge: Forge;
  /** Boomerang Return Fire (III): extra locks granted to the next salvo. */
  bonusLocks: number;
  /** Missile Bay: levels bought in each run-long missile upgrade track. */
  missileBay: MissileBay;
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
  missileBuild: MissileBuild;
  /** Heat progress of each fitted part toward its next tier, for the bar under the rack */
  mastery: {
    slot: WarheadSlot;
    id: WarheadPartId;
    tier: WarheadTier;
    /** 0–1 toward the next tier (1 at Tier III) */
    progress: number;
    ready: boolean;
  }[];
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
  guidanceOrigin?: number;
  /** Room-owned identity; absent for offline campaign shots. */
  id?: number;
  ownerId?: "p1" | "p2";
  weapon?: WeaponId;
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
    | "wardenShard"
    | "bomblet";
  pierce: number;
  color: string;
  hitIds: Set<number>;
  target?: number;
  turn: number;
  bounces: number;
  wallBounces?: number;
  fuse: number;
  extra: number; // flak: shrapnel count
  extraDmg: number; // flak: shrapnel damage
  /** Human-readable source for the fatal-hit report; has no combat effect. */
  damageCause?: string;
  /** enemy shells that detonate when they expire without hitting anything */
  blast?: number;
  /** Salvo Lock missile payload: per-missile blast damage and radius at launch. */
  missileDmg?: number;
  missileR?: number;
  /** Corkscrew flight: phase offset, normalised flight time, age and current offset. */
  spiral?: { phase: number; flight: number; age: number; offset: number; amp?: number };
  /** Released inside the Full Lock window. */
  fullLock?: boolean;
  /** Warhead parts this missile launched with, and their tiers. */
  warhead?: MissileBuild;
  tiers?: BuildTiers;
  /** Salvo identity: Siphon caps its refunds per salvo. */
  salvo?: number;
  /** Boomerang: re-locks left, and whether it is flying home to be caught. */
  boomerang?: { relocks: number; returning: boolean };
  /** Corkscrew Itano (III): the one extra pass has been used. */
  itano?: boolean;
  /** Chain Cascade (III): how many more times this mini may chain. */
  chainDepth?: number;
  /** Shards and bomblets credit Heat and kills to the warhead that made them. */
  sourceWarhead?: MissileBuild;
  /** Chain mini missile: smaller, and never chains again. */
  mini?: boolean;
  /** Relay: hops taken so far and the salvo's other locks to fly on to. */
  hops?: number;
  relayTargets?: number[];
  /** Orbit guidance: circling the owner's ship before it strikes. */
  orbit?: { t: number; angle: number; blocks: number };
  /** Delayed trigger: stuck to a target, counting down. */
  stuck?: { id: number; dx: number; dy: number; t: number };
  /** Bomblet (Cluster payload) blast radius. */
  blastR?: number;
  /** Graze bookkeeping (bit per pilot): armed while inside the band, spent once awarded. */
  grazeArm?: number;
  grazed?: number;
  /** Smart turret nest fields (persistent warden nest) */
  hpNow?: number;
  spawnT?: number;
  nested?: number;

  /** Warden miniboss ability: sniper telegraph + splitter-turret cooldown */
  pulseCharge?: number;
  volleyCd?: number;
  volleyCharge?: number;
}

/** Lingering missile effects: Gravity wells and Incendiary burning patches. */
export interface MissileZone {
  kind: "gravity" | "fire";
  /** Gravity Crush / Incendiary Wildfire (Tier III) */
  perk?: boolean;
  /** which warhead made it, for mastery credit */
  build?: MissileBuild;
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  /** fire: damage per second; gravity: unused */
  dps: number;
  /** fire: countdown to the next damage tick, and damage ticks still to land */
  tick: number;
  ticksLeft?: number;
  ownerId?: "p1" | "p2";
  seed: number;
}

export interface Crack {
  pts: { x: number; y: number }[];
  at: number;
}

export interface Rock {
  supportShield?: SupportShield;
  coopMine?: { ownerId: number; armTimer: number; triggerTimer: number; life: number };
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
  /** Graze bookkeeping (bit per pilot): armed while inside the band, spent once awarded. */
  grazeArm?: number;
  grazed?: number;
  /** Warhead status effects: Solar Flare sunburn, Cryo freeze and Wildfire ignition. */
  sunburn?: { t: number; bonus: number; prominence: boolean };
  frozen?: number;
  frozenV?: { vx: number; vy: number };
  permafrost?: boolean;
  /** shards a hit on this frozen rock releases, and the warhead that froze it */
  cryo?: { shards: number; dmg: number; build: MissileBuild };
  shatter?: boolean;
  ignited?: boolean;
}

/* Sentinels hunt, wardens snipe, and spikers drift while firing radial volleys. */
export interface SupportShield {
  hp: number;
  maxHp: number;
  sourceId: number;
}

export interface Drone {
  supportShield?: SupportShield;
  coop?: {
    kind: "tetherSentinel" | "mineWarden" | "riftSpiker";
    timer: number;
    warning: number;
    target: "p1" | "p2" | null;
  };
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
  /** EMP payload: seconds this specialist stays offline. */
  emp?: number;
  /** EMP Overload (III): takes extra damage while offline. */
  overload?: boolean;
  /** Cryo: seconds frozen in place (treated like EMP for behaviour). */
  frozen?: number;
  sunburn?: { t: number; bonus: number; prominence: boolean };
}

export interface Boss {
  /** Solar Flare sunburn and Cryo slow (bosses move 40% slower instead of freezing). */
  sunburn?: { t: number; bonus: number; prominence: boolean };
  chill?: number;
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
  id?: number;
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
  apply: (state: StatUpgradeTarget) => void;
}

/** Small structural contract keeps upgrade rules independent of the browser Game class. */
export interface StatUpgradeTarget {
  p: Player;
}

/* ------------------------------------------------------------ persistence */

export interface ScoreEntry {
  score: number;
  wave: number;
  level: number;
  date: string;
}

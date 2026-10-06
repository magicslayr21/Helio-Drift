/* HELIOS DRIFT tuning tables and factories.
   New weapons, stat upgrades, salvage modules and boss tiers are added HERE —
   the Game class consumes these tables, so most content work never needs to
   touch the simulation itself. */

import type {
  BossSpec, Rarity, RockTrait, SalvageDrone, SalvageUpgradeId,
  SectorTheme, StatUpgrade, WeaponId,
} from "./types";

/* ------------------------------------------------------------ palette */

export const AMBER = "#ffb03a";
export const AMBER_HOT = "#ffe0a3";
export const ICE = "#6fe7ff";
export const MAGENTA = "#ff3d6e";
export const ORANGE = "#ff7a2a";

/* ------------------------------------------------------------ sectors */

export const THEMES: SectorTheme[] = [
  { numeral: "I",   name: "DEEP VOID",     tint: "rgba(26,29,43,0.10)", stars: ["#ffe0a3", "#8d93ad"] },
  { numeral: "II",  name: "VERDANT DRIFT", tint: "rgba(20,48,34,0.13)", stars: ["#c9ffd9", "#79a98c"] },
  { numeral: "III", name: "FROZEN BELT",   tint: "rgba(18,42,60,0.15)", stars: ["#d9f4ff", "#7ba0bd"] },
  { numeral: "IV",  name: "VIOLET STORM",  tint: "rgba(44,24,58,0.15)", stars: ["#f0d4ff", "#a07bcd"] },
  { numeral: "V",   name: "EMBER FIELD",   tint: "rgba(58,25,18,0.15)", stars: ["#ffc9b0", "#c08268"] },
  { numeral: "VI",  name: "THE CORE",      tint: "rgba(70,32,8,0.18)",  stars: ["#ffffff", "#ffd9a0"] },
  { numeral: "VII", name: "SOLAR CATACLYSM", tint: "rgba(80,38,6,0.26)", stars: ["#ffea88", "#ff9933"] },
];

/* ------------------------------------------------------------ weapons */

export const WEAPON_ORDER: WeaponId[] = ["pulse", "spread", "seeker", "ricochet", "flak", "arc", "laser", "rail"];
export const MAX_WEAPON_LEVEL = 6;

export const WEAPON_DEFS: Record<WeaponId, { name: string; short: string; desc: string; perLevel: string; rarity: Rarity; weight: number }> = {
  pulse:    { name: "Pulse Cannon",      short: "PULSE",    desc: "Reliable twin-fed plasma. The baseline everything is measured against.", perLevel: "+15% damage · +7% rate · +1 shot every 2 levels", rarity: "common", weight: 1 },
  spread:   { name: "Scattershot Array", short: "SCATTER",  desc: "A cone of pellets. Devastating up close, forgiving of bad aim.",           perLevel: "+1 pellet · +12% damage",                          rarity: "rare",   weight: 0.7 },
  seeker:   { name: "Seeker Pulse",      short: "SEEKER",   desc: "Rapid low-damage darts that hunt the nearest target on their own.",      perLevel: "+15% damage · +8% rate · +1 dart every 3 levels",  rarity: "rare",   weight: 0.7 },
  ricochet: { name: "Ricochet Blaster",  short: "RICOCHET", desc: "Heavy slugs that bounce off the sector edges instead of leaving.",       perLevel: "+15% damage · +1 bounce every 2 levels",           rarity: "rare",   weight: 0.7 },
  flak:     { name: "Flak Cannon",       short: "FLAK",     desc: "Timed shells that burst into a ring of shrapnel. Crowd control.",         perLevel: "+2 shrapnel · +15% damage",                        rarity: "rare",   weight: 0.6 },
  arc:      { name: "Arc Coil",          short: "ARC",      desc: "Short-range lightning that chains between nearby targets.",              perLevel: "+18% damage · +range · +1 chain every 2 levels",   rarity: "epic",   weight: 0.4 },
  laser:    { name: "Beam Emitter",      short: "BEAM",     desc: "A continuous cutting beam with an overheat gauge.",                       perLevel: "+20% dps · −6% heat build-up",                     rarity: "epic",   weight: 0.4 },
  rail:     { name: "Railgun",           short: "RAIL",     desc: "Slow, piercing, enormous damage.",                                        perLevel: "+22% damage · +1 pierce every 2 levels",           rarity: "epic",   weight: 0.4 },
};

export const WEAPON_BASE_PRICE: Record<Rarity, number> = {
  common: 120,
  rare: 280,
  epic: 560,
};

/* ------------------------------------------------------------ stat upgrades */

export const STAT_UPGRADES: StatUpgrade[] = [
  { id: "overclock", name: "Overclocked Barrels", tag: "Fire rate", rarity: "common", weight: 1, max: 6,
    desc: "Cyclic rate +9% on every weapon.", apply: (g) => { g.p.fireRateMul *= 1.09; } },
  { id: "hollow", name: "Hollow-Point Payload", tag: "Damage", rarity: "common", weight: 1, max: 6,
    desc: "All weapon damage +12%.", apply: (g) => { g.p.damageMul *= 1.12; } },
  { id: "thruster", name: "Vector Thruster Kit", tag: "Mobility", rarity: "common", weight: 1, max: 4,
    desc: "Thrust +9%, top speed +6%, turn rate +4%.", apply: (g) => { g.p.thrust *= 1.09; g.p.maxSpeed *= 1.06; g.p.turn *= 1.04; } },
  { id: "hull", name: "Reinforced Hull", tag: "Survival", rarity: "common", weight: 1, max: 6,
    desc: "Max hull +18 and immediately repair 18 hull.", apply: (g) => { g.p.maxHull += 18; g.p.hull = Math.min(g.p.maxHull, g.p.hull + 18); } },
  { id: "armor", name: "Reactive Armor Plating", tag: "Survival", rarity: "rare", weight: 0.7, max: 3,
    desc: "All incoming damage −12%. Stacks to −36%.", apply: (g) => { g.p.armor = Math.min(0.36, g.p.armor + 0.12); } },
  { id: "twin", name: "Twin-Linked Feeder", tag: "Weapon", rarity: "rare", weight: 0.7, max: 3,
    desc: "+1 projectile per volley on every projectile weapon.", apply: (g) => { g.p.extraShots += 1; } },
  { id: "pierce", name: "Sabot Rounds", tag: "Weapon", rarity: "rare", weight: 0.7, max: 3,
    desc: "Projectiles pierce one extra target.", apply: (g) => { g.p.pierce += 1; } },
  { id: "crit", name: "Targeting Optics", tag: "Weapon", rarity: "common", weight: 1, max: 5,
    desc: "Critical chance +7% (crits deal 2.2×).", apply: (g) => { g.p.crit += 0.07; } },
];

/* ------------------------------------------------------------ salvage drone */

export const SALVAGE_BASE_PRICE = 260;

export const SALVAGE_UPGRADES: Record<SalvageUpgradeId, {
  name: string;
  path: "offense" | "support" | "utility";
  desc: string;
  base: number;
  max: number;
}> = {
  twinCannons: { name: "Twin Cannons", path: "offense", desc: "Adds weak support cannons. The final level converts the mounts into a visible minigun.", base: 90, max: 3 },
  overcharge: { name: "Overcharge Core", path: "offense", desc: "Raises drone shot damage and fire cadence, with a major final-stage capacitor.", base: 105, max: 3 },
  piercing: { name: "Piercing Rounds", path: "offense", desc: "Drone shots pierce additional targets and gain a little range.", base: 120, max: 2 },
  armor: { name: "Armor Plating", path: "support", desc: "Visible hull plates increase drone max health and reduce collision damage.", base: 75, max: 3 },
  repairPulse: { name: "Repair Pulse", path: "support", desc: "A slow support pulse repairs the player's hull when the drone is nearby.", base: 90, max: 3 },

  magnet: { name: "Magnet Coil", path: "utility", desc: "A visible ring expands the drone's credit collection field.", base: 65, max: 3 },
  scan: { name: "Wide Scan", path: "utility", desc: "Longer scan range lets the drone find salvage and targets earlier.", base: 70, max: 3 },
  speed: { name: "Follow Thrusters", path: "utility", desc: "The drone orbits further and catches up faster instead of feeling glued on.", base: 75, max: 3 },
};

export const SALVAGE_UPGRADE_ORDER: SalvageUpgradeId[] = ["twinCannons", "overcharge", "piercing", "armor", "repairPulse", "magnet", "scan", "speed"];

/* ------------------------------------------------------------ asteroids */

export const TRAIT_COLOR: Record<RockTrait, string> = {
  none: "#8d6a3d", homing: "#ff6f9a", bounce: ICE, boom: ORANGE, fast: "#f4f7ff",
  meteor: "#ffd27a", meteorite: "#ffc36b",
};

/** meteor showers and meteorites are transient events — they never gate
 *  wave completion and never split into fragments */
export const isEventRock = (t: RockTrait) => t === "meteor" || t === "meteorite";

/* ------------------------------------------------------------ enemy bolts */

/** a sentinel bolt is the damage yardstick; a warden sniper round lands harder */
export const SENTINEL_BOLT_DMG = 7;
export const WARDEN_BOLT_DMG = 12;

/* ------------------------------------------------------------ bosses */

/** how many non-event rocks may be on the field before a dreadnought (MK1–MK5)
 *  stops shedding more. Keeps boss arenas readable instead of a rock blizzard. */
export const BOSS_ROCK_CAP = 10;

/** how long boom-launch and MK3 rocks live (seconds) before they quietly burn out */
export const BOSS_ROCK_LIFESPAN = 30;

/** MK1–MK3 health may never reach the MK5 / MK6 figures, whatever wave they are summoned on */
export const EARLY_BOSS_HP_CEILING = 13000;

/**
 * Boom asteroids: slower and heavier than other rocks, a short creeper fuse,
 * a gentle pull toward a nearby ship and a wide blast.
 */
export const BOOM = {
  /** seconds on the fuse once the ship is inside trigger range */
  fuse: 0.35,
  /** the fuse starts this far beyond the rock's own radius */
  triggerPad: 90,
  /** …but never less than this fraction of the blast radius, so the fuse always starts before the blast can reach the ship */
  triggerFrac: 0.8,
  /** inside this range (beyond the rock's radius) the rock drifts toward the ship */
  homeRange: 260,
  /** radians per second of steering while homing: deliberately lazy */
  homeTurn: 0.95,
  /** blast radius multiplier over the old values */
  blastMul: 1.7,
  /** fixed cruise speed per size (px/s), well under a plain rock */
  speed: { 3: 24, 2: 30, 1: 36 } as Record<1 | 2 | 3, number>,
} as const;

/* ------------------------------------------------------------ run pacing */

/**
 * The complete 25-wave campaign schedule. Every sector contains four combat
 * waves followed by its boss on the fifth. `legacyScale` preserves the old
 * 50-wave difficulty ramp while delivering it in half as many waves.
 */
export const RUN_PACING = {
  finalWave: 25,
  sectorLength: 5,
  legacyScale: 2,
  /** random showers never roll while a dreadnought is on the field */
  meteorShowersAfterWave: 10,
  sentinelBurstsFromWave: 8,
  lateWardenFromWave: 21,
  lateWardenToWave: 24,
  traitWaves: {
    /** no homing rocks at all until the MK1 boss fight is cleared */
    homing: 6,
    bounce: 11,
    boom: 16,
    fast: 21,
  },
  /** wave-completion credit payout: 80 + wave * this */
  creditsPerWaveBase: 80,
  creditsPerWaveStep: 24,
} as const;

/**
 * Concurrent sentinel cap. The opening sector stays sparse (1–2 at most) and
 * pressure builds gradually sector by sector.
 */
export function maxSentinels(wave: number) {
  if (wave <= 5) return 2;
  if (wave <= 10) return 3;
  if (wave <= 15) return 4;
  if (wave <= 20) return 5;
  return 6;
}

/** How many sentinels this wave should introduce, before the cap is applied. */
export function sentinelWaveCount(wave: number) {
  if (wave <= 1) return 0;
  if (wave <= 3) return 1;
  if (wave <= 5) return 2;
  return 3;
}

/** Main-run sector index. The separate bonus boss uses sector/theme index 6. */
export function sectorForWave(wave: number) {
  if (wave >= 21) return 4;
  if (wave >= 16) return 3;
  if (wave >= 11) return 2;
  if (wave >= 6) return 1;
  return 0;
}

export function isBossWave(wave: number) {
  return wave > 0 && wave <= RUN_PACING.finalWave && wave % RUN_PACING.sectorLength === 0;
}

export function bossMkForWave(wave: number) {
  return Math.max(1, Math.min(5, Math.ceil(wave / RUN_PACING.sectorLength)));
}

/** Equivalent point on the former 50-wave tuning curve. */
export function scaledWave(wave: number) {
  return wave * RUN_PACING.legacyScale;
}

export const BOSS_SPECS: Record<number, BossSpec> = {
  1: { name: "DREADNOUGHT", suffix: "MK1 · KOMETENHÜLLE", trait: "none",   edge: "#c05a3a", hpMul: 1.2,  timerMul: 1,    spawnWeight: 0.7,  driftX: 0,  bulletMul: 1,    rocksPer: 1 },
  2: { name: "DREADNOUGHT", suffix: "MK2 · JAGDZELL",     trait: "homing", edge: "#ff6f9a", hpMul: 1.495, timerMul: 0.92, spawnWeight: 0.7,  driftX: 6,  bulletMul: 1.1,  rocksPer: 1 },
  3: { name: "DREADNOUGHT", suffix: "MK3 · RICHTZELL",    trait: "bounce", edge: ICE,       hpMul: 1.89, timerMul: 1.05, spawnWeight: 0.9,  driftX: 10, bulletMul: 1.05, rocksPer: 2 },
  4: { name: "DREADNOUGHT", suffix: "MK4 · BRANDZELL",    trait: "boom",   edge: ORANGE,    hpMul: 3.0,  timerMul: 0.9,  spawnWeight: 0.7,  driftX: -4, bulletMul: 1.35, rocksPer: 2 },
  5: { name: "THE CORE",    suffix: "MK5 · STURMZELL",    trait: "fast",   edge: "#f4f7ff", hpMul: 1,    timerMul: 1.15, spawnWeight: 0.55, driftX: 0,  bulletMul: 1.35, rocksPer: 2 },
  6: { name: "THE METEOR", suffix: "MK6 · OMEGAZELL", trait: "meteorite", edge: "#ffd27a", hpMul: 1, timerMul: 1, spawnWeight: 0, driftX: 0, bulletMul: 1, rocksPer: 0 },
};

/* ------------------------------------------------------------ factories */

/** base ship stats — also the reset target when dev edits rebuild upgrades */
export function freshPlayer() {
  const weapons = {} as Record<WeaponId, number>;
  for (const w of WEAPON_ORDER) weapons[w] = 0;
  weapons.pulse = 1;
  return {
    x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2,
    hull: 100, maxHull: 100, armor: 0,
    thrust: 460, maxSpeed: 540, turn: 4.4,
    fireRateMul: 1, damageMul: 1, bulletSpeed: 720,
    primary: "pulse" as WeaponId, weapons,
    extraShots: 0, pierce: 0, crit: 0.06, critMult: 2.2, inaccuracy: 0.045,
    heat: 0, overheated: false, beamOn: false, arcTimer: 0,
    missiles: 3, maxMissiles: 3, blastDmg: 68, blastR: 96,
    missileTimer: 0, missileRegen: 6.5, missileCharge: 0, missileHeld: false,
    magnet: 150, creditChance: 0.72, creditValue: 1,
    leech: 0,
    fireTimer: 0, invuln: 0, thrusting: false,
  };
}

export function freshSalvageDrone(): SalvageDrone {
  const upgrades = {} as Record<SalvageUpgradeId, number>;
  for (const id of SALVAGE_UPGRADE_ORDER) upgrades[id] = 0;
  return {
    purchased: false,
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 24,
    maxHp: 24,
    rebuilding: 0,
    assembly: 0,
    orbit: 0,
    fireTimer: 0,
    pulseTimer: 4,
    hitTimer: 0,
    weapon: null,
    devCount: 1,
    upgrades,
    beamOn: false,
    beamAngle: 0,
    beamLen: 0,
  };
}

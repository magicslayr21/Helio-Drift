/* HELIOS DRIFT tuning tables and factories.
   New weapons, stat upgrades, salvage modules and boss tiers are added HERE —
   the Game class consumes these tables, so most content work never needs to
   touch the simulation itself. */

import type {
  BossSpec,
  Rarity,
  RockTrait,
  SalvageDrone,
  SalvageUpgradeId,
  SectorTheme,
  StatUpgrade,
  WeaponId,
} from "./types";
import { GAME_CONFIG } from "./game-config";

/* ------------------------------------------------------------ palette */

export const AMBER = GAME_CONFIG.colors.amber;
export const AMBER_HOT = GAME_CONFIG.colors.amberHot;
export const ICE = GAME_CONFIG.colors.ice;
export const MAGENTA = GAME_CONFIG.colors.magenta;
export const ORANGE = GAME_CONFIG.colors.orange;

/* ------------------------------------------------------------ sectors */

export const THEMES: SectorTheme[] = GAME_CONFIG.themes.map((theme) => ({
  ...theme,
  stars: [...theme.stars] as [string, string],
}));

/* ------------------------------------------------------------ weapons */

export const WEAPON_ORDER: WeaponId[] = [
  "pulse",
  "spread",
  "seeker",
  "ricochet",
  "flak",
  "arc",
  "laser",
  "rail",
];
export const MAX_WEAPON_LEVEL = GAME_CONFIG.weaponProgression.maxLevel;

export const WEAPON_DEFS: Record<
  WeaponId,
  { name: string; short: string; desc: string; perLevel: string; rarity: Rarity; weight: number }
> = {
  pulse: {
    name: "Pulse Cannon",
    short: "PULSE",
    desc: "Reliable twin-fed plasma. The baseline everything is measured against.",
    perLevel: "+15% damage · +7% rate · +1 shot every 2 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.pulse.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.pulse.weight,
  },
  spread: {
    name: "Scattershot Array",
    short: "SCATTER",
    desc: "A cone of pellets. Devastating up close, forgiving of bad aim.",
    perLevel: "+1 pellet · +12% damage",
    rarity: GAME_CONFIG.weaponProgression.weapons.spread.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.spread.weight,
  },
  seeker: {
    name: "Seeker Pulse",
    short: "SEEKER",
    desc: "Rapid low-damage darts that hunt the nearest target on their own.",
    perLevel: "+15% damage · +8% rate · +1 dart every 3 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.seeker.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.seeker.weight,
  },
  ricochet: {
    name: "Ricochet Blaster",
    short: "RICOCHET",
    desc: "Heavy slugs that bounce off the sector edges instead of leaving.",
    perLevel: "+15% damage · +1 bounce every 2 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.ricochet.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.ricochet.weight,
  },
  flak: {
    name: "Flak Cannon",
    short: "FLAK",
    desc: "Timed shells that burst into a ring of shrapnel. Crowd control.",
    perLevel: "+2 shrapnel · +15% damage",
    rarity: GAME_CONFIG.weaponProgression.weapons.flak.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.flak.weight,
  },
  arc: {
    name: "Arc Coil",
    short: "ARC",
    desc: "Short-range lightning that chains between nearby targets.",
    perLevel: "+18% damage · +range · +1 chain every 2 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.arc.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.arc.weight,
  },
  laser: {
    name: "Beam Emitter",
    short: "BEAM",
    desc: "A continuous cutting beam with an overheat gauge.",
    perLevel: "+20% dps · −6% heat build-up",
    rarity: GAME_CONFIG.weaponProgression.weapons.laser.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.laser.weight,
  },
  rail: {
    name: "Railgun",
    short: "RAIL",
    desc: "Slow, piercing, enormous damage.",
    perLevel: "+22% damage · +1 pierce every 2 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.rail.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.rail.weight,
  },
};

export const WEAPON_BASE_PRICE: Record<Rarity, number> = {
  ...GAME_CONFIG.weaponProgression.rarityBasePrices,
};

/* ------------------------------------------------------------ stat upgrades */

export const STAT_UPGRADES: StatUpgrade[] = [
  {
    id: "overclock",
    name: "Overclocked Barrels",
    tag: "Fire rate",
    rarity: GAME_CONFIG.statUpgrades.overclock.rarity,
    weight: GAME_CONFIG.statUpgrades.overclock.weight,
    max: GAME_CONFIG.statUpgrades.overclock.max,
    desc: "Cyclic rate +9% on every weapon.",
    apply: (g) => {
      g.p.fireRateMul *= GAME_CONFIG.statUpgrades.overclock.fireRateMultiplier;
    },
  },
  {
    id: "hollow",
    name: "Hollow-Point Payload",
    tag: "Damage",
    rarity: GAME_CONFIG.statUpgrades.hollow.rarity,
    weight: GAME_CONFIG.statUpgrades.hollow.weight,
    max: GAME_CONFIG.statUpgrades.hollow.max,
    desc: "All weapon damage +12%.",
    apply: (g) => {
      g.p.damageMul *= GAME_CONFIG.statUpgrades.hollow.damageMultiplier;
    },
  },
  {
    id: "thruster",
    name: "Vector Thruster Kit",
    tag: "Mobility",
    rarity: GAME_CONFIG.statUpgrades.thruster.rarity,
    weight: GAME_CONFIG.statUpgrades.thruster.weight,
    max: GAME_CONFIG.statUpgrades.thruster.max,
    desc: "Thrust +9%, top speed +6%, turn rate +4%.",
    apply: (g) => {
      g.p.thrust *= GAME_CONFIG.statUpgrades.thruster.thrustMultiplier;
      g.p.maxSpeed *= GAME_CONFIG.statUpgrades.thruster.speedMultiplier;
      g.p.turn *= GAME_CONFIG.statUpgrades.thruster.turnMultiplier;
    },
  },
  {
    id: "hull",
    name: "Reinforced Health",
    tag: "Survival",
    rarity: GAME_CONFIG.statUpgrades.hull.rarity,
    weight: GAME_CONFIG.statUpgrades.hull.weight,
    max: GAME_CONFIG.statUpgrades.hull.max,
    desc: "Max health +18 and immediately restore 18 health.",
    apply: (g) => {
      const hull = GAME_CONFIG.statUpgrades.hull.hullPerStack;
      g.p.maxHull += hull;
      g.p.hull = Math.min(g.p.maxHull, g.p.hull + hull);
    },
  },
  {
    id: "armor",
    name: "Reactive Armor Plating",
    tag: "Survival",
    rarity: GAME_CONFIG.statUpgrades.armor.rarity,
    weight: GAME_CONFIG.statUpgrades.armor.weight,
    max: GAME_CONFIG.statUpgrades.armor.max,
    desc: "All incoming damage −12%. Stacks to −36%.",
    apply: (g) => {
      g.p.armor = Math.min(
        GAME_CONFIG.statUpgrades.armor.maxDamageReduction,
        g.p.armor + GAME_CONFIG.statUpgrades.armor.damageReductionPerStack,
      );
    },
  },
  {
    id: "twin",
    name: "Twin-Linked Feeder",
    tag: "Weapon",
    rarity: GAME_CONFIG.statUpgrades.twin.rarity,
    weight: GAME_CONFIG.statUpgrades.twin.weight,
    max: GAME_CONFIG.statUpgrades.twin.max,
    desc: "+1 projectile per volley on every projectile weapon.",
    apply: (g) => {
      g.p.extraShots += GAME_CONFIG.statUpgrades.twin.extraShotsPerStack;
    },
  },
  {
    id: "pierce",
    name: "Sabot Rounds",
    tag: "Weapon",
    rarity: GAME_CONFIG.statUpgrades.pierce.rarity,
    weight: GAME_CONFIG.statUpgrades.pierce.weight,
    max: GAME_CONFIG.statUpgrades.pierce.max,
    desc: "Projectiles pierce one extra target.",
    apply: (g) => {
      g.p.pierce += GAME_CONFIG.statUpgrades.pierce.extraPiercePerStack;
    },
  },
  {
    id: "crit",
    name: "Targeting Optics",
    tag: "Weapon",
    rarity: GAME_CONFIG.statUpgrades.crit.rarity,
    weight: GAME_CONFIG.statUpgrades.crit.weight,
    max: GAME_CONFIG.statUpgrades.crit.max,
    desc: "Critical chance +7% (crits deal 2.2×).",
    apply: (g) => {
      g.p.crit += GAME_CONFIG.statUpgrades.crit.critPerStack;
    },
  },
];

/* ------------------------------------------------------------ salvage drone */

export const SALVAGE_BASE_PRICE = GAME_CONFIG.salvage.basePrice;

export const SALVAGE_UPGRADES: Record<
  SalvageUpgradeId,
  {
    name: string;
    path: "offense" | "support" | "utility";
    desc: string;
    base: number;
    max: number;
  }
> = {
  twinCannons: {
    name: "Twin Cannons",
    path: "offense",
    desc: "Adds weak support cannons. The final level converts the mounts into a visible minigun.",
    ...GAME_CONFIG.salvageUpgradePrices.twinCannons,
  },
  overcharge: {
    name: "Overcharge Core",
    path: "offense",
    desc: "Raises drone shot damage and fire cadence, with a major final-stage capacitor.",
    ...GAME_CONFIG.salvageUpgradePrices.overcharge,
  },
  piercing: {
    name: "Piercing Rounds",
    path: "offense",
    desc: "Drone shots pierce additional targets and gain a little range.",
    ...GAME_CONFIG.salvageUpgradePrices.piercing,
  },
  armor: {
    name: "Armor Plating",
    path: "support",
    desc: "Visible hull plates increase drone max health and reduce collision damage.",
    ...GAME_CONFIG.salvageUpgradePrices.armor,
  },
  repairPulse: {
    name: "Repair Pulse",
    path: "support",
    desc: "A slow support pulse restores the player's health when the drone is nearby.",
    ...GAME_CONFIG.salvageUpgradePrices.repairPulse,
  },

  magnet: {
    name: "Magnet Coil",
    path: "utility",
    desc: "A visible ring expands the drone's credit collection field.",
    ...GAME_CONFIG.salvageUpgradePrices.magnet,
  },
  scan: {
    name: "Wide Scan",
    path: "utility",
    desc: "Longer scan range lets the drone find salvage and targets earlier.",
    ...GAME_CONFIG.salvageUpgradePrices.scan,
  },
  speed: {
    name: "Follow Thrusters",
    path: "utility",
    desc: "The drone orbits further and catches up faster instead of feeling glued on.",
    ...GAME_CONFIG.salvageUpgradePrices.speed,
  },
};

export const SALVAGE_UPGRADE_ORDER: SalvageUpgradeId[] = [
  "twinCannons",
  "overcharge",
  "piercing",
  "armor",
  "repairPulse",
  "magnet",
  "scan",
  "speed",
];

/* ------------------------------------------------------------ asteroids */

export const TRAIT_COLOR: Record<RockTrait, string> = {
  none: GAME_CONFIG.colors.rocks.none,
  homing: GAME_CONFIG.colors.rocks.homing,
  bounce: ICE,
  boom: ORANGE,
  fast: GAME_CONFIG.colors.rocks.fast,
  meteor: GAME_CONFIG.colors.rocks.meteor,
  meteorite: GAME_CONFIG.colors.rocks.meteorite,
};

/** meteor showers and meteorites are transient events — they never gate
 *  wave completion and never split into fragments */
export const isEventRock = (t: RockTrait) => t === "meteor" || t === "meteorite";

/* ------------------------------------------------------------ enemy bolts */

/** a sentinel bolt is the damage yardstick; a warden sniper round lands harder */
export const SENTINEL_BOLT_DMG = GAME_CONFIG.enemies.sentinels.boltDamage;
export const WARDEN_BOLT_DMG = GAME_CONFIG.enemies.wardens.boltDamage;

/* ------------------------------------------------------------ bosses */

/** how many non-event rocks may be on the field before a dreadnought (MK1–MK5)
 *  stops shedding more. Keeps boss arenas readable instead of a rock blizzard. */
export const BOSS_ROCK_CAP = GAME_CONFIG.asteroids.bossFieldCap;

/** how long boom-launch and MK3 rocks live (seconds) before they quietly burn out */
export const BOSS_ROCK_LIFESPAN = GAME_CONFIG.asteroids.bossRockLifetime;

/** MK1–MK3 health may never reach the MK5 / MK6 figures, whatever wave they are summoned on */
export const EARLY_BOSS_HP_CEILING = GAME_CONFIG.bosses.earlyHpCeiling;

/**
 * Boom asteroids: slower and heavier than other rocks, a short creeper fuse,
 * a gentle pull toward a nearby ship and a wide blast.
 */
export const BOOM = {
  /** seconds on the fuse once the ship is inside trigger range */
  fuse: GAME_CONFIG.asteroids.traits.boom.fuse,
  /** the fuse starts this far beyond the rock's own radius */
  triggerPad: GAME_CONFIG.asteroids.traits.boom.triggerPad,
  /** …but never less than this fraction of the blast radius, so the fuse always starts before the blast can reach the ship */
  triggerFrac: GAME_CONFIG.asteroids.traits.boom.triggerRadiusFraction,
  /** inside this range (beyond the rock's radius) the rock drifts toward the ship */
  homeRange: GAME_CONFIG.asteroids.traits.boom.homeRange,
  /** radians per second of steering while homing: deliberately lazy */
  homeTurn: GAME_CONFIG.asteroids.traits.boom.homeTurn,
  /** blast radius multiplier over the old values */
  blastMul: GAME_CONFIG.asteroids.traits.boom.blastRadiusMultiplier,
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
  finalWave: GAME_CONFIG.waves.wavesPerBoss * 5,
  sectorLength: 5,
  legacyScale: GAME_CONFIG.asteroids.scaledWaveMultiplier,
  /** random showers never roll while a dreadnought is on the field */
  meteorShowersAfterWave: GAME_CONFIG.waves.showerAfterWave,
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
  creditsPerWaveBase: GAME_CONFIG.waves.waveCreditsBase,
  creditsPerWaveStep: GAME_CONFIG.waves.waveCreditsPerWave,
} as const;

/**
 * Concurrent sentinel cap. The opening sector stays sparse (1–2 at most) and
 * pressure builds gradually sector by sector.
 */
export function maxSentinels(wave: number) {
  const thresholds = GAME_CONFIG.enemies.sentinels.countWaveThresholds;
  const caps = GAME_CONFIG.enemies.sentinels.waveCaps;
  const index = thresholds.filter((threshold) => wave > threshold).length;
  return caps[index] ?? caps[caps.length - 1];
}

/** How many sentinels this wave should introduce, before the cap is applied. */
export function sentinelWaveCount(wave: number) {
  const thresholds = GAME_CONFIG.enemies.sentinels.countWaveThresholds;
  const counts = GAME_CONFIG.enemies.sentinels.countPerBand;
  const index = thresholds.filter((threshold) => wave > threshold).length;
  return counts[index] ?? counts[counts.length - 1];
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
  1: {
    name: "DREADNOUGHT",
    suffix: "MK1 · KOMETENHÜLLE",
    trait: "none",
    edge: "#c05a3a",
    hpMul: GAME_CONFIG.bosses.profiles[1].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[1].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[1].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[1].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[1].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[1].rocksPerSpawn,
  },
  2: {
    name: "DREADNOUGHT",
    suffix: "MK2 · JAGDZELL",
    trait: "homing",
    edge: "#ff6f9a",
    hpMul: GAME_CONFIG.bosses.profiles[2].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[2].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[2].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[2].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[2].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[2].rocksPerSpawn,
  },
  3: {
    name: "DREADNOUGHT",
    suffix: "MK3 · RICHTZELL",
    trait: "bounce",
    edge: ICE,
    hpMul: GAME_CONFIG.bosses.profiles[3].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[3].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[3].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[3].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[3].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[3].rocksPerSpawn,
  },
  4: {
    name: "DREADNOUGHT",
    suffix: "MK4 · BRANDZELL",
    trait: "boom",
    edge: ORANGE,
    hpMul: GAME_CONFIG.bosses.profiles[4].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[4].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[4].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[4].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[4].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[4].rocksPerSpawn,
  },
  5: {
    name: "THE CORE",
    suffix: "MK5 · STURMZELL",
    trait: "fast",
    edge: "#f4f7ff",
    hpMul: GAME_CONFIG.bosses.profiles[5].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[5].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[5].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[5].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[5].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[5].rocksPerSpawn,
  },
  6: {
    name: "THE METEOR",
    suffix: "MK6 · OMEGAZELL",
    trait: "meteorite",
    edge: "#ffd27a",
    hpMul: GAME_CONFIG.bosses.profiles[6].hpMultiplier,
    timerMul: GAME_CONFIG.bosses.profiles[6].timerMultiplier,
    spawnWeight: GAME_CONFIG.bosses.profiles[6].spawnWeight,
    driftX: GAME_CONFIG.bosses.profiles[6].driftX,
    bulletMul: GAME_CONFIG.bosses.profiles[6].projectileMultiplier,
    rocksPer: GAME_CONFIG.bosses.profiles[6].rocksPerSpawn,
  },
};

/* ------------------------------------------------------------ factories */

/** base ship stats — also the reset target when dev edits rebuild upgrades */
export function freshPlayer() {
  const weapons = {} as Record<WeaponId, number>;
  for (const w of WEAPON_ORDER) weapons[w] = 0;
  weapons.pulse = 1;
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    hull: GAME_CONFIG.player.hull,
    maxHull: GAME_CONFIG.player.hull,
    armor: GAME_CONFIG.player.armor,
    thrust: GAME_CONFIG.player.thrust,
    maxSpeed: GAME_CONFIG.player.maxSpeed,
    turn: GAME_CONFIG.player.turn,
    fireRateMul: GAME_CONFIG.player.fireRateMul,
    damageMul: GAME_CONFIG.player.damageMul,
    bulletSpeed: GAME_CONFIG.player.bulletSpeed,
    primary: "pulse" as WeaponId,
    weapons,
    extraShots: 0,
    pierce: 0,
    crit: GAME_CONFIG.player.crit,
    critMult: GAME_CONFIG.player.critMult,
    inaccuracy: GAME_CONFIG.player.inaccuracy,
    heat: 0,
    overheated: false,
    beamOn: false,
    arcTimer: 0,
    missiles: GAME_CONFIG.player.missiles,
    maxMissiles: GAME_CONFIG.player.maxMissiles,
    blastDmg: GAME_CONFIG.player.blastDamage,
    blastR: GAME_CONFIG.player.blastRadius,
    missileTimer: 0,
    missileRegen: GAME_CONFIG.player.missileRegen,
    missileCharge: 0,
    missileHeld: false,
    magnet: GAME_CONFIG.player.magnet,
    creditChance: GAME_CONFIG.player.creditChance,
    creditValue: GAME_CONFIG.player.creditValue,
    leech: GAME_CONFIG.player.leech,
    fireTimer: 0,
    invuln: 0,
    thrusting: false,
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
    hp: GAME_CONFIG.salvage.startingHp,
    maxHp: GAME_CONFIG.salvage.startingHp,
    rebuilding: 0,
    assembly: 0,
    orbit: 0,
    fireTimer: 0,
    pulseTimer: GAME_CONFIG.salvage.startingPulseTimer,
    hitTimer: 0,
    weapon: null,
    devCount: 1,
    upgrades,
    beamOn: false,
    beamAngle: 0,
    beamLen: 0,
  };
}

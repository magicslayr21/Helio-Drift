/* HELIOS DRIFT tuning tables and factories.
   New weapons, stat upgrades, salvage modules and boss tiers are added HERE —
   the Game class consumes these tables, so most content work never needs to
   touch the simulation itself. */

import type {
  BossSpec,
  MissileBuild,
  Player,
  Rarity,
  RockTrait,
  SalvageDrone,
  SalvageUpgradeId,
  SectorTheme,
  StatUpgrade,
  BuildTiers,
  MissileBay,
  MissileBayTrack,
  Forge,
  ForgePart,
  GuidanceId,
  PayloadId,
  TriggerId,
  WarheadPartId,
  WarheadRarity,
  WarheadSlot,
  WeaponId,
} from "./types";
import { GAME_CONFIG } from "./game-config";
export {
  RUN_PACING,
  bossMkForWave,
  isBossWave,
  maxSentinels,
  scaledWave,
  sectorForWave,
  sentinelWaveCount,
} from "./simulation/campaign";

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

export function weaponMaxLevel(id: WeaponId): number {
  const rarity = GAME_CONFIG.weaponProgression.weapons[id].rarity;
  return rarity === "common" ? 3 : rarity === "rare" ? 4 : MAX_WEAPON_LEVEL;
}

export const WEAPON_DEFS: Record<
  WeaponId,
  { name: string; short: string; desc: string; perLevel: string; rarity: Rarity; weight: number }
> = {
  pulse: {
    name: "Pulse Cannon",
    short: "PULSE",
    desc: "Reliable twin-fed plasma. The baseline everything is measured against.",
    perLevel: "+4% damage · +2.5% rate",
    rarity: GAME_CONFIG.weaponProgression.weapons.pulse.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.pulse.weight,
  },
  spread: {
    name: "Scattershot Array",
    short: "SCATTER",
    desc: "A cone of pellets. Devastating up close, forgiving of bad aim.",
    perLevel: "+12% damage · extra pellets as levels rise",
    rarity: GAME_CONFIG.weaponProgression.weapons.spread.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.spread.weight,
  },
  seeker: {
    name: "Seeker Pulse",
    short: "SEEKER",
    desc: "Rapid low-damage darts that hunt the nearest target on their own.",
    perLevel: "+15% damage · +6.5% rate · +1 dart every 3 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.seeker.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.seeker.weight,
  },
  ricochet: {
    name: "Ricochet Blaster",
    short: "RICOCHET",
    desc: "Wall-bouncing slugs: 2× damage after one bounce, 3.5× after two, 5× after three.",
    perLevel: "+15% damage · +1 bounce per level",
    rarity: GAME_CONFIG.weaponProgression.weapons.ricochet.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.ricochet.weight,
  },
  flak: {
    name: "Flak Cannon",
    short: "FLAK",
    desc: "Timed shells that burst into a ring of shrapnel. Crowd control.",
    perLevel: "+2 shrapnel · +13% shrapnel damage · +5% rate",
    rarity: GAME_CONFIG.weaponProgression.weapons.flak.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.flak.weight,
  },
  arc: {
    name: "Arc Coil",
    short: "ARC",
    desc: "Short-range lightning that chains between nearby targets.",
    perLevel: "+21% damage · +range · +1 chain every 2 levels",
    rarity: GAME_CONFIG.weaponProgression.weapons.arc.rarity,
    weight: GAME_CONFIG.weaponProgression.weapons.arc.weight,
  },
  laser: {
    name: "Beam Emitter",
    short: "BEAM",
    desc: "A continuous cutting beam with an overheat gauge.",
    perLevel: "+28% dps · wider beam · −6% heat · +35% damage in the red zone",
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
    id: "range",
    name: "Range",
    tag: "Reach",
    rarity: "common",
    weight: GAME_CONFIG.statUpgrades.range.weight,
    max: GAME_CONFIG.statUpgrades.range.max,
    desc: "+13.3% weapon and drone range. Max +40%.",
    apply: (g) => {
      g.p.rangeMul = (g.p.rangeMul ?? 1) + GAME_CONFIG.statUpgrades.range.rangePerStack;
    },
  },
  {
    id: "overclock",
    name: "Overclocked Barrels",
    tag: "Fire rate",
    rarity: GAME_CONFIG.statUpgrades.overclock.rarity,
    weight: GAME_CONFIG.statUpgrades.overclock.weight,
    max: GAME_CONFIG.statUpgrades.overclock.max,
    desc: "+9% attack speed for all weapons.",
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
    desc: "+12% damage for all weapons.",
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
    desc: "+9% thrust, +6% speed, +4% turning.",
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
    desc: "+18 max health. Repair 18 health now.",
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
    desc: "Take 12% less damage. Max 36% reduction.",
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
    desc: "+1 shot per volley; Beam also fires behind the ship.",
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
    desc: "Shots pass through 1 extra target.",
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
    desc: "+20% crit chance and +0.1× crit damage. Max 2.5× damage.",
    apply: (g) => {
      g.p.crit += GAME_CONFIG.statUpgrades.crit.critPerStack;
      g.p.critMult = Math.min(
        2.5,
        g.p.critMult + GAME_CONFIG.statUpgrades.crit.critMultiplierPerStack,
      );
    },
  },
  {
    id: "missileRack",
    name: "Missile Rack",
    tag: "Missiles",
    rarity: GAME_CONFIG.statUpgrades.missileRack.rarity,
    weight: GAME_CONFIG.statUpgrades.missileRack.weight,
    max: GAME_CONFIG.statUpgrades.missileRack.max,
    desc: "+1 missile rack slot and +1 lock per salvo. Loads the new slot now. Max 6 (Magazine adds more).",
    apply: (g) => {
      const add = GAME_CONFIG.statUpgrades.missileRack.rackPerStack;
      const before = g.p.maxMissiles;
      // Magazine levels from the Missile Bay sit on top of the Missile Rack cap
      const cap =
        GAME_CONFIG.salvo.maxRack +
        (g.p.missileBay?.magazine ?? 0) * GAME_CONFIG.missileBay.magazine.rackPerLevel;
      g.p.maxMissiles = Math.min(cap, g.p.maxMissiles + add);
      g.p.missiles = Math.min(g.p.maxMissiles, g.p.missiles + (g.p.maxMissiles - before));
    },
  },
];

/* ------------------------------------------------------------ warhead workshop */

export const DEFAULT_MISSILE_BUILD: MissileBuild = {
  payload: "blast",
  guidance: "direct",
  trigger: "impact",
};

export interface WarheadPartDef {
  slot: WarheadSlot;
  name: string;
  rarity: WarheadRarity;
  /** Tier I effect, as shown in the Workshop. */
  effect: string;
  /** Tier II effect and the Tier III perk (name and text). */
  tier2: string;
  perk: { name: string; text: string };
  /** Warhead tint: seeker cap, plume core and blast highlights. */
  color: string;
}

const W = GAME_CONFIG.warheads;
const pct = (n: number) => `${Math.round(n * 100)}%`;
export const WARHEAD_SLOTS: WarheadSlot[] = ["payload", "guidance", "trigger"];
export const WARHEAD_PARTS: Record<WarheadPartId, WarheadPartDef> = {
  blast: {
    slot: "payload",
    name: "Blast",
    rarity: "default",
    effect: `${W.blast.damage[0]} damage in a ${W.blast.radius[0]} radius.`,
    tier2: `${W.blast.damage[1]} damage in an ${W.blast.radius[1]} radius.`,
    perk: {
      name: "Aftershock",
      text: `A second blast ${W.blast.aftershockDelay} s later at ${pct(W.blast.aftershockShare)}.`,
    },
    color: "#ff3d6e",
  },
  cluster: {
    slot: "payload",
    name: "Cluster",
    rarity: "rare",
    effect: `Bursts into ${W.cluster.bomblets[0]} bomblets × ${W.cluster.bombletDamage[0]} damage that scatter and detonate.`,
    tier2: `${W.cluster.bomblets[1]} bomblets × ${W.cluster.bombletDamage[1]} damage.`,
    perk: { name: "Carpet", text: "Bomblets roll on along the missile's path." },
    color: "#ffb03a",
  },
  gravity: {
    slot: "payload",
    name: "Gravity",
    rarity: "rare",
    effect: `Opens a ${W.gravity.duration[0]} s well that pulls small and medium rocks within ${W.gravity.radius[0]}.`,
    tier2: `${W.gravity.duration[1]} s well, ${W.gravity.radius[1]} radius.`,
    perk: {
      name: "Crush",
      text: `Pulled rocks take ${W.gravity.crushDps} damage per second and collide with each other.`,
    },
    color: "#a98bff",
  },
  emp: {
    slot: "payload",
    name: "EMP",
    rarity: "epic",
    effect: `Disables specialists for ${W.emp.duration[0]} s and drops Tether Sentinel shields.`,
    tier2: `${W.emp.duration[1]} s disable; Warden mines fizzle.`,
    perk: {
      name: "Overload",
      text: `Disabled enemies take +${pct(W.emp.overloadMultiplier - 1)} damage.`,
    },
    color: "#8ff7ff",
  },
  incendiary: {
    slot: "payload",
    name: "Incendiary",
    rarity: "common",
    effect: `Leaves a burning patch for ${W.incendiary.duration[0]} s, ${W.incendiary.dps[0]} damage per second.`,
    tier2: `${W.incendiary.duration[1]} s at ${W.incendiary.dps[1]} damage per second.`,
    perk: { name: "Wildfire", text: "Fire spreads to touching rocks." },
    color: "#ff7a2e",
  },
  solarFlare: {
    slot: "payload",
    name: "Solar Flare",
    rarity: "epic",
    effect: `Sunburn: targets in the blast take +${pct(W.solarFlare.bonus[0])} damage from all sources for ${W.solarFlare.duration[0]} s.`,
    tier2: `+${pct(W.solarFlare.bonus[1])} for ${W.solarFlare.duration[1]} s; Sentinels stop firing for ${W.solarFlare.sentinelSilence[1]} s.`,
    perk: {
      name: "Prominence",
      text: "Marked kills release a mini flare that marks nearby targets.",
    },
    color: "#ffd23f",
  },
  cryo: {
    slot: "payload",
    name: "Cryo",
    rarity: "rare",
    effect: `Freezes for ${W.cryo.duration[0]} s; a hit on a frozen rock shatters it into ${W.cryo.shards[0]} shards × ${W.cryo.shardDamage[0]} damage. Bosses are slowed ${pct(W.cryo.bossSlow)} instead.`,
    tier2: `${W.cryo.duration[1]} s freeze; ${W.cryo.shards[1]} shards × ${W.cryo.shardDamage[1]} damage.`,
    perk: { name: "Permafrost", text: "Frozen rocks block enemy shots." },
    color: "#9fd8ff",
  },
  direct: {
    slot: "guidance",
    name: "Direct",
    rarity: "default",
    effect: `Pure pursuit with a ${GAME_CONFIG.salvo.turn} turn rate.`,
    tier2: `+${pct(W.direct.speedMultiplier[1] - 1)} speed.`,
    perk: { name: "Lead", text: "Predicts target movement and flies to the intercept." },
    color: "#ffe0a3",
  },
  corkscrew: {
    slot: "guidance",
    name: "Corkscrew",
    rarity: "common",
    effect: `+${pct(W.corkscrew.speedMultiplier[0] - 1)} speed and a wider spiral.`,
    tier2: `+${pct(W.corkscrew.speedMultiplier[1] - 1)} speed and an even wider spiral.`,
    perk: { name: "Itano", text: "A missile that misses spirals back for one more pass." },
    color: "#ffd166",
  },
  relay: {
    slot: "guidance",
    name: "Relay",
    rarity: "epic",
    effect: `On a kill, flies on to another lock at ${pct(W.relay.damageMultiplier[0])} damage, up to ${W.relay.hops[0]} hops.`,
    tier2: `${W.relay.hops[1]} hops at ${pct(W.relay.damageMultiplier[1])}.`,
    perk: { name: "Chainbreaker", text: "Each hop gains +10% instead of losing damage." },
    color: "#7dffb2",
  },
  orbit: {
    slot: "guidance",
    name: "Orbit",
    rarity: "rare",
    effect: `Circles the ship for ${W.orbit.duration[0]} s blocking ${W.orbit.blocks[0]} enemy shot each, then strikes.`,
    tier2: `${W.orbit.duration[1]} s, blocks ${W.orbit.blocks[1]} shots.`,
    perk: { name: "Halo", text: "Orbiting missiles damage rocks they touch." },
    color: "#6fe7ff",
  },
  boomerang: {
    slot: "guidance",
    name: "Boomerang",
    rarity: "rare",
    effect: `A missile that misses, or whose target dies, re-locks the nearest target ${W.boomerang.relocks[0]}×; catching it unused refunds ${pct(W.boomerang.refund[0])} of a missile.`,
    tier2: `${W.boomerang.relocks[1]} re-locks; ${pct(W.boomerang.refund[1])} refund.`,
    perk: { name: "Return Fire", text: "Each caught missile adds +1 lock to the next salvo." },
    color: "#c6ff6b",
  },
  impact: {
    slot: "trigger",
    name: "Impact",
    rarity: "default",
    effect: "Detonates on contact.",
    tier2: `+${pct(W.impact.damageMultiplier[1] - 1)} damage.`,
    perk: {
      name: "Breach",
      text: `+${pct(W.impact.breachMultiplier - 1)} damage against boss hulls.`,
    },
    color: "#ffe0a3",
  },
  proximity: {
    slot: "trigger",
    name: "Proximity",
    rarity: "common",
    effect: `Detonates ${W.proximity.distance} px early with +${pct(W.proximity.radiusMultiplier[0] - 1)} radius.`,
    tier2: `+${pct(W.proximity.radiusMultiplier[1] - 1)} radius.`,
    perk: { name: "Airburst", text: "Blasts delete enemy shots in range." },
    color: "#ffd166",
  },
  chain: {
    slot: "trigger",
    name: "Chain",
    rarity: "epic",
    effect: `Each blast launches a mini missile at ${pct(W.chain.damageMultiplier[0])} damage.`,
    tier2: `Mini missile at ${pct(W.chain.damageMultiplier[1])} damage.`,
    perk: { name: "Cascade", text: "Mini missiles can chain once more." },
    color: "#ff5ad8",
  },
  delayed: {
    slot: "trigger",
    name: "Delayed",
    rarity: "rare",
    effect: `Sticks to the target and detonates after ${W.delayed.fuse[0]} s for ${W.delayed.damageMultiplier[0]}× damage.`,
    tier2: `${W.delayed.fuse[1]} s fuse for ${W.delayed.damageMultiplier[1]}× damage.`,
    perk: {
      name: "Detonator",
      text: `Tap E to set off every stuck charge early at ${W.delayed.detonatorMultiplier}×.`,
    },
    color: "#ff9168",
  },
  siphon: {
    slot: "trigger",
    name: "Siphon",
    rarity: "epic",
    effect: `Each enemy hit by a blast refunds ${pct(W.siphon.refund[0])} of a missile, up to ${W.siphon.salvoCap} missile per salvo.`,
    tier2: `${pct(W.siphon.refund[1])} per hit and +${W.siphon.hullPerKill[1]} hull per kill.`,
    perk: { name: "Feedback", text: "Full Lock salvos refund one whole missile." },
    color: "#5dffd9",
  },
};

export const isWarheadPart = (id: unknown): id is WarheadPartId =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(WARHEAD_PARTS, id);

/** Replace a missing or invalid build (old saves, tampered rooms) with valid parts. */
export function normalizeMissileBuild(build: unknown): MissileBuild {
  const raw = (build && typeof build === "object" ? build : {}) as Record<string, unknown>;
  const pick = <T extends WarheadPartId>(slot: WarheadSlot, fallback: T): T =>
    isWarheadPart(raw[slot]) && WARHEAD_PARTS[raw[slot] as WarheadPartId].slot === slot
      ? (raw[slot] as T)
      : fallback;
  return {
    payload: pick("payload", DEFAULT_MISSILE_BUILD.payload),
    guidance: pick("guidance", DEFAULT_MISSILE_BUILD.guidance),
    trigger: pick("trigger", DEFAULT_MISSILE_BUILD.trigger),
  };
}

/* ------------------------------------------------------------ warhead forge */

const F = GAME_CONFIG.forge;
const BAY = GAME_CONFIG.missileBay;
const round5 = (n: number) => Math.round(n / 5) * 5;

/** Unlock price (default parts are priced as common). */
export const partPrice = (id: WarheadPartId) => F.prices[WARHEAD_PARTS[id].rarity];
/** Wave from which a part can be unlocked. */
export const partUnlockWave = (id: WarheadPartId) => F.unlockWave[WARHEAD_PARTS[id].rarity];
/** Total Heat needed to reach a tier (2 or 3). */
export const heatForTier = (id: WarheadPartId, tier: 2 | 3) =>
  F.heatToTier[WARHEAD_PARTS[id].rarity][tier - 2];
/** Scrap returns half of every credit spent on the part. */
export const scrapValue = (part: ForgePart) => Math.floor(part.spent * F.scrapShare);

/** Bay synergy: total Missile Bay levels → Heat gain multiplier and temper discount. */
export const bayLevels = (bay: MissileBay) =>
  MISSILE_BAY_TRACKS.reduce((sum, t) => sum + (bay[t] ?? 0), 0);
export const synergyHeat = (levels: number) => 1 + levels * F.synergyHeatPerLevel;
export const synergyDiscount = (levels: number) =>
  Math.min(F.synergyMaxDiscount, levels * F.synergyDiscountPerLevel);

/**
 * Price to temper a part to its next tier. With a full Heat bar it costs the base
 * share of the unlock price; earlier, the missing Heat is paid for as a surcharge.
 * Missile Bay synergy trims the result. Null at Tier III.
 */
export function temperPrice(part: ForgePart, levels: number): number | null {
  if (part.tier >= 3) return null;
  const next = (part.tier + 1) as 2 | 3;
  const base = partPrice(part.id) * F.temperShare[next - 2];
  const need = heatForTier(part.id, next);
  const missing = Math.max(0, 1 - part.heat / need);
  return round5(base * (1 + F.rushSurcharge * missing) * (1 - synergyDiscount(levels)));
}

export const stockPart = (id: WarheadPartId): ForgePart => ({
  id,
  tier: 1,
  heat: 0,
  kills: 0,
  spent: 0,
});

export function freshForge(): Forge {
  return {
    fitted: {
      payload: stockPart(DEFAULT_MISSILE_BUILD.payload),
      guidance: stockPart(DEFAULT_MISSILE_BUILD.guidance),
      trigger: stockPart(DEFAULT_MISSILE_BUILD.trigger),
    },
    bench: Array.from({ length: F.benchSlots }, () => null),
  };
}

function normalizePart(raw: unknown, slot?: WarheadSlot): ForgePart | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isWarheadPart(r.id) || (slot && WARHEAD_PARTS[r.id].slot !== slot)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const tier = r.tier === 2 || r.tier === 3 ? r.tier : 1;
  return {
    id: r.id,
    tier,
    heat: num(r.heat),
    kills: Math.floor(num(r.kills)),
    spent: Math.floor(num(r.spent)),
  };
}

/** Repair a forge from a save or room checkpoint; anything unreadable becomes the stock forge. */
export function normalizeForge(raw: unknown): Forge {
  const fresh = freshForge();
  if (!raw || typeof raw !== "object") return fresh;
  const r = raw as Record<string, unknown>;
  const fitted = (r.fitted && typeof r.fitted === "object" ? r.fitted : {}) as Record<
    string,
    unknown
  >;
  const bench = Array.isArray(r.bench) ? r.bench : [];
  return {
    fitted: {
      payload: normalizePart(fitted.payload, "payload") ?? fresh.fitted.payload,
      guidance: normalizePart(fitted.guidance, "guidance") ?? fresh.fitted.guidance,
      trigger: normalizePart(fitted.trigger, "trigger") ?? fresh.fitted.trigger,
    },
    bench: Array.from({ length: F.benchSlots }, (_, i) => normalizePart(bench[i])),
  };
}

/** missileBuild always mirrors the fitted parts. */
export const buildOf = (forge: Forge): MissileBuild => ({
  payload: forge.fitted.payload.id as PayloadId,
  guidance: forge.fitted.guidance.id as GuidanceId,
  trigger: forge.fitted.trigger.id as TriggerId,
});
export const tiersOf = (forge: Forge): BuildTiers => ({
  payload: forge.fitted.payload.tier,
  guidance: forge.fitted.guidance.tier,
  trigger: forge.fitted.trigger.tier,
});

/* ------------------------------------------------------------ missile bay */

export const MISSILE_BAY_TRACKS: MissileBayTrack[] = [
  "velocity",
  "yield",
  "magazine",
  "autoloader",
  "seeker",
];

export const MISSILE_BAY_DEFS: Record<
  MissileBayTrack,
  { name: string; tag: string; color: string; perLevel: string; effect: (level: number) => string }
> = {
  velocity: {
    name: "Velocity",
    tag: "Speed",
    color: "#6fe7ff",
    perLevel: `+${BAY.velocity.speedPerLevel * 100}% missile speed, +${BAY.velocity.turnPerLevel * 100}% turning`,
    effect: (l) =>
      `+${Math.round(l * BAY.velocity.speedPerLevel * 100)}% speed · +${Math.round(l * BAY.velocity.turnPerLevel * 100)}% turn`,
  },
  yield: {
    name: "Yield",
    tag: "Damage",
    color: "#ff3d6e",
    perLevel: `+${BAY.yield.damagePerLevel * 100}% missile damage`,
    effect: (l) => `+${Math.round(l * BAY.yield.damagePerLevel * 100)}% damage`,
  },
  magazine: {
    name: "Magazine",
    tag: "Amount",
    color: "#ff5ad8",
    perLevel: `+${BAY.magazine.rackPerLevel} rack slot and lock (past the Missile Rack cap)`,
    effect: (l) => `+${l * BAY.magazine.rackPerLevel} rack`,
  },
  autoloader: {
    name: "Autoloader",
    tag: "Recharge",
    color: "#91e7b0",
    perLevel: `−${BAY.autoloader.regenPerLevel * 100}% recharge time, +${BAY.autoloader.chargePerLevel * 100}% graze and kill charge`,
    effect: (l) =>
      `−${Math.round((1 - missileRegenMultiplier(l)) * 100)}% recharge · +${Math.round(l * BAY.autoloader.chargePerLevel * 100)}% charge`,
  },
  seeker: {
    name: "Seeker",
    tag: "Lock-on",
    color: "#ffd166",
    perLevel: `−${BAY.seeker.lockPerLevel * 100}% lock time, +${BAY.seeker.conePerLevel * 100}% lock range`,
    effect: (l) =>
      `−${Math.round((1 - lockIntervalMultiplier(l)) * 100)}% lock time · +${Math.round(l * BAY.seeker.conePerLevel * 100)}% range`,
  },
};

/** Recharge time multiplier: each Autoloader level cuts the remaining time by 12%. */
export function missileRegenMultiplier(level: number) {
  return (1 - BAY.autoloader.regenPerLevel) ** level;
}
/** Lock interval multiplier: each Seeker level cuts the remaining time by 12%. */
export function lockIntervalMultiplier(level: number) {
  return (1 - BAY.seeker.lockPerLevel) ** level;
}

export const freshMissileBay = (): MissileBay => ({
  velocity: 0,
  yield: 0,
  magazine: 0,
  autoloader: 0,
  seeker: 0,
});

export function normalizeMissileBay(raw: unknown): MissileBay {
  const bay = freshMissileBay();
  if (!raw || typeof raw !== "object") return bay;
  for (const t of MISSILE_BAY_TRACKS) {
    const v = (raw as Record<string, unknown>)[t];
    if (typeof v === "number" && Number.isFinite(v))
      bay[t] = Math.max(0, Math.min(BAY[t].levels, Math.floor(v)));
  }
  return bay;
}

/** Price of the next level of a track, or null at max. */
export function missileBayPrice(track: MissileBayTrack, level: number): number | null {
  const def = BAY[track];
  if (level >= def.levels) return null;
  return round5(def.basePrice * BAY.priceGrowth ** level);
}

/** A small, stable 32-bit hash (used for seeding run-scoped randomness). */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

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
    name: "Arsenal",
    path: "offense",
    desc: "+1 shot or Arc chain per level; Beam gains +20% damage. Works with any mount.",
    ...GAME_CONFIG.salvageUpgradePrices.twinCannons,
  },
  overcharge: {
    name: "Overcharge",
    path: "offense",
    desc: "More drone damage and faster fire. Max: a powerful damage surge.",
    ...GAME_CONFIG.salvageUpgradePrices.overcharge,
  },
  piercing: {
    name: "Sync Feed",
    path: "offense",
    desc: "+5% pilot / +10% drone attack speed per level. Boosts Beam DPS too.",
    ...GAME_CONFIG.salvageUpgradePrices.piercing,
  },
  armor: {
    name: "Armor",
    path: "support",
    desc: "+12 drone HP per level. Max: 60% damage reduction; Shield Link bypasses armor.",
    ...GAME_CONFIG.salvageUpgradePrices.armor,
  },
  repairPulse: {
    name: "Repair Pulse",
    path: "support",
    desc: "Both unharmed for 5s nearby: heal 1 HP/s. Max: 2 HP every 0.5s.",
    ...GAME_CONFIG.salvageUpgradePrices.repairPulse,
  },

  shield: {
    name: "Shield Link",
    path: "support",
    desc: "Nearby drone absorbs 20% / 35% / 50% of hull damage using its HP. Ends if destroyed.",
    ...GAME_CONFIG.salvageUpgradePrices.shield,
  },

  magnet: {
    name: "Magnet Coil",
    path: "utility",
    desc: "+90 pickup range per level; pulls credits and repair kits harder. Max: +90 extra range.",
    ...GAME_CONFIG.salvageUpgradePrices.magnet,
  },
  scan: {
    name: "Wide Scan",
    path: "utility",
    desc: "+150 target, +60 pickup and +50 support range per level. Max: +150 extra target range.",
    ...GAME_CONFIG.salvageUpgradePrices.scan,
  },
  speed: {
    name: "Thrusters",
    path: "utility",
    desc: "Faster catch-up and a wider orbit.",
    ...GAME_CONFIG.salvageUpgradePrices.speed,
  },
};

export const SALVAGE_UPGRADE_ORDER: SalvageUpgradeId[] = [
  "twinCannons",
  "overcharge",
  "piercing",
  "armor",
  "repairPulse",
  "shield",
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

/** MK1–MK2 retain their original ceiling; later bosses have explicit campaign HP. */
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
export function freshPlayer(): Player {
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
    rangeMul: 1,
    primary: "pulse",
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
    missileLocks: [],
    missileHoldT: -1,
    missileLockT: 0,
    fullLockAt: -1,
    missileBuild: { ...DEFAULT_MISSILE_BUILD },
    forge: freshForge(),
    bonusLocks: 0,
    missileBay: freshMissileBay(),
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

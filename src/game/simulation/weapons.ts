import { GAME_CONFIG } from "../game-config";
import type { Bullet, Player, SalvageDrone, WeaponId } from "../types";
import { weaponMaxLevel, WEAPON_BASE_PRICE, WEAPON_DEFS } from "../balance";

export interface WeaponSimulationStats {
  rate: number;
  damage: number;
  shots: number;
  arc: number;
  speed: number;
  life: number;
  radius: number;
  pierce: number;
  bounces: number;
  homing: number;
  fuse: number;
  extra: number;
  extraDamage: number;
  kind: Bullet["kind"];
}

export function weaponPrice(player: Player, weapon: WeaponId): number | null {
  const level = player.weapons[weapon];
  if (level >= weaponMaxLevel(weapon)) return null;
  const base = WEAPON_BASE_PRICE[WEAPON_DEFS[weapon].rarity];
  const rounding = GAME_CONFIG.weaponProgression.priceRounding;
  return (
    Math.round((base * Math.pow(GAME_CONFIG.weaponProgression.priceMultiplier, level)) / rounding) *
    rounding
  );
}

export function salvageUpgradePrice(drone: SalvageDrone, id: keyof SalvageDrone["upgrades"]) {
  const tuning = GAME_CONFIG.salvageUpgradePrices[id];
  const level = drone.upgrades[id];
  if (level >= tuning.max) return null;
  const finalMultiplier =
    level + 1 === tuning.max ? GAME_CONFIG.salvage.finalUpgradePriceMultiplier : 1;
  const rounding = GAME_CONFIG.weaponProgression.priceRounding;
  return (
    Math.round(
      (tuning.base *
        Math.pow(GAME_CONFIG.salvage.upgradePriceMultiplier, level) *
        finalMultiplier) /
        rounding,
    ) * rounding
  );
}

export function weaponSimulationStats(
  player: Player,
  drone: SalvageDrone,
  weaponId: WeaponId,
  level = player.weapons[weaponId],
): WeaponSimulationStats {
  const lv = Math.max(0, Math.min(weaponMaxLevel(weaponId), level) - 1);
  const weapon = GAME_CONFIG.weaponProgression.weapons[weaponId];
  const feeder =
    1 +
    (drone.purchased ? drone.upgrades.piercing : 0) * GAME_CONFIG.salvage.playerFeederRatePerLevel;
  const stats: WeaponSimulationStats = {
    rate: weapon.baseRate,
    damage: "baseDamage" in weapon ? weapon.baseDamage : 16,
    shots: "baseShots" in weapon ? weapon.baseShots : 1,
    arc: 0.026,
    speed: "speed" in weapon ? weapon.speed : 720,
    life: "life" in weapon ? weapon.life : 1.15,
    radius: "radius" in weapon ? weapon.radius : 3.6,
    pierce: player.pierce,
    bounces: 0,
    homing: 0,
    fuse: 0,
    extra: 0,
    extraDamage: 0,
    kind: "plasma",
  };

  switch (weaponId) {
    case "pulse": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.pulse;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage *= 1 + tuning.damagePerLevel * lv;
      stats.shots += Math.floor(lv / tuning.shotsEveryLevels);
      break;
    }
    case "spread": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.spread;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.baseDamage * (1 + tuning.damagePerLevel * lv);
      stats.shots = tuning.baseShots + Math.floor(lv * tuning.shotsPerLevel);
      stats.arc = tuning.arc;
      break;
    }
    case "seeker": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.seeker;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.baseDamage * (1 + tuning.damagePerLevel * lv);
      stats.shots = tuning.baseShots + Math.floor(lv / tuning.shotsEveryLevels);
      stats.arc = tuning.arc;
      stats.homing = tuning.turn;
      stats.kind = "seeker";
      break;
    }
    case "ricochet": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.ricochet;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.baseDamage * (1 + tuning.damagePerLevel * lv);
      stats.shots = tuning.baseShots + Math.floor(lv / tuning.shotsEveryLevels);
      stats.bounces = tuning.baseBounces + Math.floor(lv / tuning.bouncesEveryLevels);
      stats.kind = "ricochet";
      break;
    }
    case "flak": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.flak;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.baseDamage;
      stats.shots = tuning.baseShots + Math.floor(lv / tuning.shotsEveryLevels);
      stats.fuse = tuning.fuse;
      stats.extra = tuning.baseShrapnel + tuning.shrapnelPerLevel * lv;
      stats.extraDamage =
        tuning.shrapnelDamage * (1 + tuning.shrapnelDamagePerLevel * lv) * player.damageMul;
      stats.kind = "flak";
      break;
    }
    case "rail": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.rail;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage =
        tuning.baseDamage *
        tuning.damageScale *
        (1 + tuning.damagePerLevel * lv) *
        (lv >= 5 ? tuning.maxLevelDamageBonus : 1);
      stats.pierce = tuning.basePierce + Math.floor(lv / tuning.pierceEveryLevels) + player.pierce;
      stats.homing = tuning.turn;
      stats.kind = "rail";
      break;
    }
    case "laser": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.laser;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.damage * (1 + tuning.damagePerLevel * lv);
      stats.pierce = 1 + player.pierce;
      break;
    }
    case "arc": {
      const tuning = GAME_CONFIG.weaponProgression.weapons.arc;
      stats.rate *= 1 + tuning.ratePerLevel * lv;
      stats.damage = tuning.baseDamage * (1 + tuning.damagePerLevel * lv);
      break;
    }
  }
  stats.rate *= player.fireRateMul * feeder;
  stats.damage *= player.damageMul;
  stats.shots += player.extraShots;
  return stats;
}

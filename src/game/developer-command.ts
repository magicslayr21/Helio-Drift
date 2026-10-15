import type { Game } from "./engine";
import { SALVAGE_UPGRADE_ORDER, STAT_UPGRADES, WEAPON_ORDER, weaponMaxLevel } from "./balance";
import type { SalvageUpgradeId, WeaponId } from "./types";

export type DeveloperEnemy =
  | "sentinel"
  | "warden"
  | "spiker"
  | "tetherSentinel"
  | "mineWarden"
  | "riftSpiker";
export type DeveloperCommand =
  | {
      action:
        | "heal"
        | "credits"
        | "clear"
        | "killBoss"
        | "nextWave"
        | "weapons"
        | "drone"
        | "maxAll"
        | "missiles"
        | "god"
        | "restart";
    }
  | { action: "adjust"; field: "score" | "credits" | "hull"; amount: number }
  | { action: "advance"; waves: number }
  | { action: "level"; count: number }
  | { action: "stack"; id: string; level: number }
  | { action: "stacks"; mode: "add" | "max" | "zero" }
  | { action: "weapon"; id: WeaponId }
  | { action: "weaponLevel"; mode: "add" | "max" | "all" }
  | { action: "droneCount"; count: number }
  | { action: "droneHp"; hp: number }
  | { action: "droneUpgrade"; id: SalvageUpgradeId; level: number }
  | { action: "droneBuild"; mode: "max" | "reset" | "kill" }
  | { action: "droneWeapon"; id: WeaponId | null }
  | { action: "shower"; mode: "start" | "long" | "stop" }
  | {
      action: "rock";
      kind: "none" | "homing" | "bounce" | "boom" | "fast" | "meteor" | "meteorite";
      count: number;
      size: 1 | 2 | 3;
    }
  | { action: "enemy"; kind: DeveloperEnemy; count: number; size: 1 | 2 | 3 }
  | { action: "boss"; mk: number };

export function validDeveloperCommand(value: unknown): value is DeveloperCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  const oneOf = (v: unknown, choices: readonly string[]) =>
    typeof v === "string" && choices.includes(v);
  switch (c.action) {
    case "heal":
    case "credits":
    case "clear":
    case "killBoss":
    case "nextWave":
    case "weapons":
    case "drone":
    case "maxAll":
    case "missiles":
    case "god":
    case "restart":
      return true;
    case "adjust":
      return oneOf(c.field, ["score", "credits", "hull"]) && integer(c.amount, -10000, 10000);
    case "advance":
      return integer(c.waves, 1, 5);
    case "level":
      return integer(c.count, 1, 5);
    case "stack":
      return STAT_UPGRADES.some((u) => u.id === c.id) && integer(c.level, 0, 999);
    case "stacks":
      return oneOf(c.mode, ["add", "max", "zero"]);
    case "weapon":
      return oneOf(c.id, WEAPON_ORDER);
    case "weaponLevel":
      return oneOf(c.mode, ["add", "max", "all"]);
    case "droneCount":
      return integer(c.count, 1, 3);
    case "droneHp":
      return integer(c.hp, 1, 9999);
    case "droneUpgrade":
      return oneOf(c.id, SALVAGE_UPGRADE_ORDER) && integer(c.level, 0, 9);
    case "droneBuild":
      return oneOf(c.mode, ["max", "reset", "kill"]);
    case "droneWeapon":
      return c.id === null || oneOf(c.id, WEAPON_ORDER);
    case "shower":
      return oneOf(c.mode, ["start", "long", "stop"]);
    case "boss":
      return integer(c.mk, 1, 6);
    case "rock":
    case "enemy":
      return (
        integer(c.count, 1, 50) &&
        integer(c.size, 1, 3) &&
        oneOf(
          c.kind,
          c.action === "rock"
            ? ["none", "homing", "bounce", "boom", "fast", "meteor", "meteorite"]
            : ["sentinel", "warden", "spiker", "tetherSentinel", "mineWarden", "riftSpiker"],
        )
      );
    default:
      return false;
  }
}

/** Shared bounded engine operations. Network callers authorize before applying them. */
export function applyDeveloperCommand(g: Game, c: DeveloperCommand) {
  if (!validDeveloperCommand(c)) return false;
  if (c.action === "enemy" && c.kind === "riftSpiker" && !g.cooperative) return false;
  g.markLeaderboardAssisted();
  switch (c.action) {
    case "heal":
      g.p.hull = g.p.maxHull;
      break;
    case "credits":
      g.credits += 10000;
      break;
    case "adjust":
      if (c.field === "hull") g.p.hull = Math.max(1, Math.min(g.p.maxHull, g.p.hull + c.amount));
      else g[c.field] = Math.max(0, g[c.field] + c.amount);
      break;
    case "clear":
      g.clearAllArt();
      break;
    case "killBoss":
      if (g.boss) g.killBoss();
      break;
    case "nextWave":
    case "advance":
      g.clearAllArt();
      g.wave += c.action === "advance" ? c.waves - 1 : 0;
      g.nextWave();
      break;
    case "weapons":
      for (const id of WEAPON_ORDER) g.p.weapons[id] = weaponMaxLevel(id);
      break;
    case "drone":
      g.buySalvageDrone();
      break;
    case "rock":
      if (c.kind === "meteorite") g.devSpawnMeteorites(c.count);
      else if (c.kind === "meteor")
        for (let i = 0; i < c.count; i++) g.spawnMeteor(g.random() < 0.5 ? -1 : 1);
      else g.devSpawnRock(c.size, c.kind, c.count);
      break;
    case "enemy":
      g.devSpawnMob(c.kind, c.count, c.size);
      break;
    case "boss":
      g.boss = g.makeBoss(c.mk === 5, c.mk);
      g.banner = g.boss.name + " " + g.boss.suffix.split(" ")[0];
      g.bannerSub = "DEV SUMMON";
      g.bannerT = 2;
      g.sound.play("bossCharge");
      break;
    case "stack":
      g.devSetStack(c.id, c.level);
      break;
    case "stacks":
      if (c.mode === "add")
        for (const u of STAT_UPGRADES) g.devSetStack(u.id, (g.stacks[u.id] ?? 0) + 1);
      else g.devSetAllStacks(c.mode === "max" ? 999 : 0);
      break;
    case "level":
      for (let i = 0; i < c.count; i++) g.gainXp(g.xpNext);
      break;
    case "weapon":
      g.p.weapons[c.id] = Math.max(1, g.p.weapons[c.id]);
      g.selectWeapon(c.id);
      break;
    case "weaponLevel":
      if (c.mode === "all")
        for (const id of WEAPON_ORDER) g.p.weapons[id] = Math.max(1, g.p.weapons[id]);
      else
        g.p.weapons[g.p.primary] =
          c.mode === "max"
            ? weaponMaxLevel(g.p.primary)
            : Math.min(weaponMaxLevel(g.p.primary), g.p.weapons[g.p.primary] + 1);
      break;
    case "droneCount":
      g.devSpawnSalvage(c.count);
      break;
    case "droneHp":
      g.devSetSalvageHp(c.hp);
      break;
    case "droneUpgrade":
      g.devSetSalvageUpgrade(c.id, c.level);
      break;
    case "droneBuild":
      if (c.mode === "kill") g.damageSalvageDrone(9999);
      else
        for (const id of SALVAGE_UPGRADE_ORDER)
          g.devSetSalvageUpgrade(id, c.mode === "max" ? 9 : 0);
      break;
    case "droneWeapon":
      g.devEquipSalvageWeapon(c.id);
      break;
    case "shower":
      if (c.mode === "stop") {
        g.shower.t = 0;
        g.shower.active = false;
      } else if (c.mode === "long" || !g.shower.active)
        g.startShower(c.mode === "long" ? 14 : undefined);
      break;
    case "missiles":
      g.p.missiles = g.p.maxMissiles;
      break;
    case "god":
      g.god = !g.god;
      break;
    case "restart":
      g.startGame();
      g.markLeaderboardAssisted();
      break;
    case "maxAll":
      for (const id of WEAPON_ORDER) g.p.weapons[id] = weaponMaxLevel(id);
      g.devSetAllStacks(999);
      for (const id of SALVAGE_UPGRADE_ORDER) g.devSetSalvageUpgrade(id, 9);
      g.devSpawnSalvage(1);
      g.devSetSalvageHp(9999);
      g.p.maxHull = Math.max(g.p.maxHull, 500);
      g.p.hull = g.p.maxHull;
      g.p.missiles = g.p.maxMissiles;
      g.credits = 999999;
      g.score = Math.max(g.score, 999999);
      break;
  }
  return true;
}

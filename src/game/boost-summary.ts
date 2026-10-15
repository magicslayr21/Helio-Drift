import { STAT_UPGRADES, freshPlayer } from "./balance";
import { GAME_CONFIG } from "./game-config";
import type { Hud, Player, SalvageDrone } from "./types";
export function boostSummary(
  p: Player,
  salvageDrone: SalvageDrone,
  stacks: Record<string, number>,
): Hud["boosts"] {
  const attackRate =
    p.fireRateMul *
    (1 +
      (salvageDrone.purchased ? salvageDrone.upgrades.piercing : 0) *
        GAME_CONFIG.salvage.playerFeederRatePerLevel);

  const base = freshPlayer();
  const taken = STAT_UPGRADES.filter((u) => (stacks[u.id] ?? 0) > 0).map((u) => ({
    id: u.id,
    name: u.name,
    tag: u.tag,
    level: stacks[u.id] ?? 0,
    max: u.max,
  }));
  const pct = (mul: number) => `${mul >= 1 ? "+" : ""}${Math.round((mul - 1) * 100)}%`;
  const totals: { label: string; value: string }[] = [];
  if (attackRate !== 1) totals.push({ label: "Fire rate", value: pct(attackRate) });
  if (p.damageMul !== 1) totals.push({ label: "Damage", value: pct(p.damageMul) });
  if (p.extraShots > 0) totals.push({ label: "Extra projectiles", value: `+${p.extraShots}` });
  if (p.pierce > 0) totals.push({ label: "Pierce", value: `+${p.pierce}` });
  if (p.crit !== base.crit)
    totals.push({ label: "Crit chance", value: `${Math.round(p.crit * 100)}%` });
  if (p.thrust !== base.thrust)
    totals.push({ label: "Thrust", value: pct(p.thrust / base.thrust) });
  if (p.maxSpeed !== base.maxSpeed)
    totals.push({ label: "Top speed", value: pct(p.maxSpeed / base.maxSpeed) });
  if (p.maxHull !== base.maxHull)
    totals.push({
      label: "Max health",
      value: `${Math.round(p.maxHull)} (+${Math.round(p.maxHull - base.maxHull)})`,
    });
  if (p.armor > 0) totals.push({ label: "Damage taken", value: `−${Math.round(p.armor * 100)}%` });
  if (p.leech > 0) totals.push({ label: "Lifesteal", value: `${Math.round(p.leech * 100)}%` });
  if (p.maxMissiles !== base.maxMissiles)
    totals.push({
      label: "Missile rack",
      value: `${p.maxMissiles} (+${p.maxMissiles - base.maxMissiles})`,
    });
  if (p.blastDmg !== base.blastDmg)
    totals.push({ label: "Blast damage", value: pct(p.blastDmg / base.blastDmg) });
  return { taken, totals, totalStacks: taken.reduce((s, t) => s + t.level, 0) };
}

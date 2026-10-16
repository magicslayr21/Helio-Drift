import type { Game } from "./engine";
import { THEMES } from "./balance";
import type { Bullet } from "./types";

/** The actual campaign world, shared by room persistence and the campaign renderer. */
const WORLD_FIELDS = [
  "w",
  "h",
  "rocks",
  "drones",
  "boss",
  "pickups",
  "themeIdx",
  "score",
  "wave",
  "shower",
  "bonusAvailable",
  "bonusActive",
  "bonusDefeated",
  "waveHold",
  "nextId",
  "frame",
  "banner",
  "bannerSub",
  "bannerT",
  "timeScale",
  "flashAlpha",
  "particles",
  "rings",
  "texts",
  "arcs",
] as const;
export type CampaignWorld = Pick<Game, (typeof WORLD_FIELDS)[number]> & {
  bullets: (Omit<Bullet, "hitIds"> & { hitIds: number[] })[];
  shake: number;
};

export function captureCampaignWorld(game: Game): CampaignWorld {
  const fields = Object.fromEntries(WORLD_FIELDS.map((key) => [key, game[key]]));
  return structuredClone({
    ...fields,
    shake: game.shake,
    bullets: game.bullets.map((b) => ({ ...b, hitIds: [...b.hitIds] })),
  }) as CampaignWorld;
}

export function restoreCampaignWorld(game: Game, world: CampaignWorld) {
  const data = structuredClone(world);
  for (const key of WORLD_FIELDS)
    if (data[key] !== undefined) Object.assign(game, { [key]: data[key] });
  game.bullets = data.bullets.map((b) => ({ ...b, hitIds: new Set(b.hitIds) }));
  game.shake = data.shake;
  game.theme = THEMES[game.themeIdx];
}

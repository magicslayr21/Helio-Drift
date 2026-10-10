import type { Game } from "./engine";
import type { RunReport } from "../leaderboard/types";
import {
  weaponMaxLevel,
  WEAPON_ORDER,
  SALVAGE_UPGRADES,
  SALVAGE_UPGRADE_ORDER,
  STAT_UPGRADES,
} from "./balance";

export interface SavedLeaderboardRun {
  runId: string;
  revision: number;
  durationSeconds: number;
  deathCause: string | null;
  assisted: boolean;
  finalReport: RunReport | null;
}

const KEY = "helios-run-v1";
// Only simulation data belongs in a save. Developer access, god mode, input,
// browser objects, and audio state must never be restored.
const FIELDS = [
  "p",
  "salvageDrone",
  "stacks",
  "rocks",
  "drones",
  "boss",
  "bullets",
  "pickups",
  "themeIdx",
  "score",
  "credits",
  "wave",
  "level",
  "xp",
  "xpNext",
  "combo",
  "comboTimer",
  "choices",
  "rerollCost",
  "shower",
  "bonusAvailable",
  "bonusActive",
  "bonusDefeated",
  "waveHold",
  "nextId",
  "beamAngle",
  "frame",
  "banner",
  "bannerSub",
  "bannerT",
] as const;
type RunState = Pick<Game, (typeof FIELDS)[number]>;
type SavedRun = {
  version: 1;
  balanceVersion?: number;
  id: string;
  state: RunState | null;
  leaderboard?: SavedLeaderboardRun;
};

function read(): SavedRun | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw);
  return saved?.version === 1 && typeof saved.id === "string" ? saved : null;
}

function finiteData(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteData);
  if (value && typeof value === "object") return Object.values(value).every(finiteData);
  return value === null || ["string", "boolean"].includes(typeof value);
}

function validLeaderboard(value: unknown, id: string, game: Game): value is SavedLeaderboardRun {
  if (!value || typeof value !== "object" || !finiteData(value)) return false;
  const run = value as SavedLeaderboardRun;
  if (
    run.runId !== id ||
    !Number.isSafeInteger(run.revision) ||
    run.revision < 0 ||
    typeof run.durationSeconds !== "number" ||
    run.durationSeconds < 0 ||
    (run.deathCause !== null && typeof run.deathCause !== "string") ||
    typeof run.assisted !== "boolean"
  )
    return false;
  const report = run.finalReport;
  return (
    report === null ||
    (!!report &&
      report.runId === id &&
      Number.isSafeInteger(report.revision) &&
      report.revision >= 0 &&
      report.revision <= run.revision &&
      [
        report.score,
        report.credits,
        report.wave,
        report.level,
        report.durationSeconds,
        report.sector,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) &&
      ["sectors", "mk6", "mk6-cleared"].includes(report.stage) &&
      ["dead", "victory"].includes(report.status) &&
      typeof report.assisted === "boolean" &&
      (report.deathCause === null || typeof report.deathCause === "string") &&
      Object.prototype.hasOwnProperty.call(game.p.weapons, report.primary) &&
      matches(report.weapons, game.p.weapons) &&
      !!report.upgrades &&
      typeof report.upgrades === "object" &&
      Object.values(report.upgrades).every((n) => Number.isSafeInteger(n) && n >= 0) &&
      !!report.drone &&
      typeof report.drone.purchased === "boolean" &&
      (report.drone.weapon === null ||
        Object.prototype.hasOwnProperty.call(game.p.weapons, report.drone.weapon)) &&
      !!report.drone.upgrades &&
      matches({ shield: 0, ...report.drone.upgrades }, game.salvageDrone.upgrades))
  );
}

// Match required fields against a fresh run before assigning any saved data.
function matches(value: unknown, template: unknown): boolean {
  if (template === null) return value === null || typeof value === "object";
  if (Array.isArray(template)) return Array.isArray(value);
  if (typeof template === "object") {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.entries(template as object).every(([key, item]) =>
        matches((value as Record<string, unknown>)[key], item),
      )
    );
  }
  return typeof value === typeof template;
}

export class RunSave {
  private id: string | null = null;
  private ended = false;

  begin(game: Game) {
    this.id = game.leaderboardRun?.runId ?? crypto.randomUUID();
    this.ended = false;
    this.write(game, true);
  }

  restore(game: Game): boolean {
    try {
      const saved = read();
      const state = saved?.state;
      // New modules default to unpurchased in saves from earlier alpha releases.
      if (state?.salvageDrone?.upgrades && state.salvageDrone.upgrades.shield === undefined)
        state.salvageDrone.upgrades.shield = 0;
      if (
        !saved ||
        !state ||
        !finiteData(state) ||
        !FIELDS.every((key) => matches(state[key], game[key])) ||
        state.p.hull <= 0 ||
        state.wave < 1 ||
        state.level < 1 ||
        state.xpNext <= 0 ||
        !Number.isInteger(state.themeIdx) ||
        state.themeIdx < 0 ||
        state.themeIdx > 6 ||
        !Object.prototype.hasOwnProperty.call(game.p.weapons, state.p.primary) ||
        !state.choices.every(
          (choice) =>
            choice &&
            typeof choice.id === "string" &&
            choice.kind === "stat" &&
            typeof choice.name === "string",
        ) ||
        ![state.rocks, state.drones, state.bullets, state.pickups].every((items) =>
          items.every(
            (item) =>
              item &&
              [item.x, item.y, item.vx, item.vy].every(
                (n) => typeof n === "number" && Number.isFinite(n),
              ),
          ),
        ) ||
        !state.rocks.every((rock) => Array.isArray(rock.pts) && Array.isArray(rock.cracks)) ||
        (state.boss !== null &&
          (!Array.isArray(state.boss.pts) ||
            !Array.isArray(state.boss.cracks) ||
            !Array.isArray(state.boss.strikes) ||
            !Array.isArray(state.boss.boomDrops)))
      )
        return false;
      this.id = saved.id;
      this.ended = false;
      for (const key of FIELDS) {
        Object.assign(game, { [key]: state[key] });
      }
      for (const id of WEAPON_ORDER)
        game.p.weapons[id] = Math.max(
          0,
          Math.min(weaponMaxLevel(id), Math.floor(game.p.weapons[id])),
        );
      for (const id of SALVAGE_UPGRADE_ORDER)
        game.salvageDrone.upgrades[id] = Math.max(
          0,
          Math.min(SALVAGE_UPGRADES[id].max, Math.floor(game.salvageDrone.upgrades[id])),
        );
      if (!saved.balanceVersion) {
        game.rebuildStatUpgrades();
        for (const rock of game.rocks) {
          if (rock.trait === "fast") {
            rock.hp *= 1.2;
            rock.maxHp *= 1.2;
          }
        }
        if (game.boss && game.boss.mk >= 3) {
          const max = game.makeBoss(game.boss.final, game.boss.mk).maxHp;
          game.boss.hp = max * (game.boss.hp / game.boss.maxHp);
          game.boss.maxHp = max;
        }
        // Refresh offered descriptions and discard offers now at their cap.
        game.choices = game.choices.flatMap((choice) => {
          const def = STAT_UPGRADES.find((item) => item.id === choice.id);
          return def && (game.stacks[def.id] ?? 0) < def.max
            ? [{ ...choice, name: def.name, desc: def.desc, rarity: def.rarity }]
            : [];
        });
      }
      game.quietTime = 0;
      game.salvageDrone.pulseTimer = game.repairInterval();
      // Apply current spawn caps to fights saved before the balance update.
      const savedRocks = game.rocks;
      game.rocks = [];
      game.addRocks(...savedRocks);
      if (game.boss?.mk6) {
        const liveIds = new Set(game.rocks.map((rock) => rock.id));
        game.boss.mk6.fieldIds = game.boss.mk6.fieldIds.filter((id) => liveIds.has(id));
      }
      // Older saves keep their existing stable ID and start telemetry here.
      // Metadata stays outside FIELDS so adding it never invalidates a run save.
      game.leaderboardRun = validLeaderboard(saved.leaderboard, saved.id, game)
        ? saved.leaderboard
        : {
            runId: saved.id,
            revision: 0,
            durationSeconds: 0,
            deathCause: null,
            assisted: false,
            finalReport: null,
          };
      game.p.beamOn = false;
      game.p.missileHeld = false;
      game.p.thrusting = false;
      game.salvageDrone.devCount = 1;
      game.salvageDrone.beamOn = false;
      game.god = false;
      game.salvageClones = [];
      return true;
    } catch {
      // Unavailable storage or an incompatible save must not prevent a new run.
      return false;
    }
  }

  write(game: Game, replace = false) {
    if (!this.id || this.ended || game.wave < 1 || game.mode === "menu") return;
    if (game.p.hull <= 0 || game.mode === "gameover") {
      this.end();
      return;
    }
    try {
      const current = replace ? null : read();
      // A dead or superseded run cannot be resurrected by another open tab.
      if (!replace && (!current || current.id !== this.id || !current.state)) return;
      const state = Object.fromEntries(FIELDS.map((key) => [key, game[key]]));
      localStorage.setItem(
        KEY,
        JSON.stringify({
          version: 1,
          balanceVersion: 1,
          id: this.id,
          state,
          leaderboard: game.leaderboardRun,
        }),
      );
    } catch {
      // Play remains available when the browser blocks or fills storage.
    }
  }

  end() {
    this.ended = true;
    if (!this.id) return;
    try {
      const current = read();
      if (current?.id === this.id) {
        // Synchronous tombstone: removes player data and fences stale tab saves.
        localStorage.setItem(KEY, JSON.stringify({ version: 1, id: this.id, state: null }));
      }
    } catch {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* storage unavailable */
      }
    }
  }
}

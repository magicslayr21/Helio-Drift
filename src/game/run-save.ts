import type { Game } from "./engine";

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
type SavedRun = { version: 1; id: string; state: RunState | null };

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
    this.id = crypto.randomUUID();
    this.ended = false;
    this.write(game, true);
  }

  restore(game: Game): boolean {
    try {
      const saved = read();
      const state = saved?.state;
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
      localStorage.setItem(KEY, JSON.stringify({ version: 1, id: this.id, state }));
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

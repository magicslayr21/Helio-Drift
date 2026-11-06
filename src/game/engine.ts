/* HELIOS DRIFT — hand-written canvas vector-arcade engine.
   File map:
   - types.ts    shared interfaces and unions (pure types)
   - math.ts     small math helpers
   - balance.ts  tuning tables: weapons, upgrades, bosses, sectors + factories
   - audio.ts    procedural WebAudio synth
   The Game class below is the simulation. New content should land in the
   tables first, with the class consuming them. */

import { audio, type Sfx } from "./audio";
import { TAU, clamp, wrapAngle } from "./math";
import {
  AMBER,
  AMBER_HOT,
  ICE,
  MAGENTA,
  ORANGE,
  THEMES,
  TRAIT_COLOR,
  isEventRock,
  BOSS_ROCK_CAP,
  BOSS_ROCK_LIFESPAN,
  EARLY_BOSS_HP_CEILING,
  BOSS_SPECS,
  BOOM,
  RUN_PACING,
  sectorForWave,
  isBossWave,
  bossMkForWave,
  scaledWave,
  maxSentinels,
  sentinelWaveCount,
  WEAPON_ORDER,
  MAX_WEAPON_LEVEL,
  weaponMaxLevel,
  WEAPON_DEFS,
  STAT_UPGRADES,
  SALVAGE_BASE_PRICE,
  SALVAGE_UPGRADES,
  SALVAGE_UPGRADE_ORDER,
  SENTINEL_BOLT_DMG,
  WARDEN_BOLT_DMG,
  freshPlayer,
  freshSalvageDrone,
  DEFAULT_MISSILE_BUILD,
  WARHEAD_PARTS,
  WARHEAD_SLOTS,
  isWarheadPart,
  normalizeMissileBuild,
  normalizeForge,
  buildOf,
  tiersOf,
  masteryKills,
  masteryPrice,
  mergePrice,
  partPrice,
  scrapValue,
  stockPart,
  rollBlueprintOffers,
} from "./balance";
import { addKnownBlueprint, loadKnownBlueprints } from "./blueprints";
import type {
  Mode,
  WeaponId,
  RockTrait,
  SalvageUpgradeId,
  Hud,
  UpgradeCard,
  WeaponStatRow,
  WeaponShopInfo,
  SalvageShopInfo,
  Mk6Slot,
  Mk6Attack,
  ScoreEntry,
  Bullet,
  Crack,
  Rock,
  Drone,
  Boss,
  Hostile,
  Particle,
  Ring,
  Text,
  Pickup,
  Arc,
  SalvageDrone,
  SalvageClone,
  SectorTheme,
  MissileBuild,
  MissileZone,
  PayloadId,
  WarheadPartId,
  WarheadSlot,
  BuildTiers,
  Forge,
  ForgePart,
  ForgePartInfo,
  ForgeShopInfo,
  WarheadTier,
} from "./types";
import { renderSpecialist } from "./render-specialists";
import { DEFAULT_SETTINGS } from "./preferences";
import { boostSummary } from "./boost-summary";
import { COOP_CONFIG } from "./simulation/coop-config";
import type { CoopEvent, CoopTetherState, CoopPlayerId } from "./simulation/coop-types";
import type { DeveloperEnemy } from "./developer-command";
import { GAME_CONFIG } from "./game-config";
import { stepPlayerMovement, type FlightIntent } from "./simulation/movement";
import {
  salvageUpgradePrice as calculateSalvageUpgradePrice,
  weaponPrice as calculateWeaponPrice,
  weaponSimulationStats,
} from "./simulation/weapons";
import { RunSave, type SavedLeaderboardRun } from "./run-save";
import type { RunReport, RunStatus } from "../leaderboard/types";

/* The React shell imports everything from "./engine" — keep that surface
   stable by re-exporting the extracted modules. */
export * from "./types";
export * from "./math";
export * from "./balance";
export * from "./simulation/movement";
export * from "./simulation/weapons";

/* ------------------------------------------------------------ game */

export type GameSound = Pick<
  typeof audio,
  "play" | "unlock" | "silence" | "beamHeat" | "setMusic" | "stopMusic" | "hasMusicOverride"
>;
/** Visual flavour for a missile-family explosion. */
export interface MissileBlastStyle {
  color?: string;
  fullLock?: boolean;
  crossfire?: boolean;
  payload?: PayloadId;
  small?: boolean;
}

export const SILENT_GAME_SOUND: GameSound = {
  play() {},
  unlock() {},
  silence() {},
  beamHeat() {},
  setMusic() {},
  stopMusic() {},
  hasMusicOverride: false,
};
export interface GameRuntime {
  headless?: boolean;
  width?: number;
  height?: number;
  random?: () => number;
  sound?: GameSound;
}

export class Game {
  cooperative = false;
  readonly headless: boolean;
  readonly random: () => number;
  readonly sound: GameSound;
  flightIntent: FlightIntent | null = null;
  rnd(min: number, max: number) {
    return min + this.random() * (max - min);
  }
  /** Multiplayer overrides context selection; campaign uses its one pilot. */
  forEachPilot(action: () => void) {
    action();
  }
  selectTarget(_x: number, _y: number) {}
  selectBulletPilot(_bullet: Bullet) {}
  /** Salvo Lock colour for the bound pilot: magenta solo, the pilot's accent in co-op. */
  pilotAccent(): string {
    return MAGENTA;
  }
  /** Whether the bound pilot is the one this screen belongs to (draws the lock cone). */
  isLocalPilot(): boolean {
    return true;
  }
  /** Co-op adds Crossfire charge to shared Overdrive; the solo campaign has no meter. */
  crossfireBonus() {}
  campaignTethers: CoopTetherState[] = [];
  specialPilots() {
    return [{ id: "p1" as CoopPlayerId, ship: this.p, disabled: false }];
  }
  specialPilotId(): CoopPlayerId {
    return "p1";
  }
  specialTethers() {
    return this.campaignTethers;
  }
  specialEvent(_event: CoopEvent) {}
  specialTick() {
    return this.frame;
  }
  updateDroneSpecial(d: Drone, dt: number) {
    const extra = d.coop;
    if (!extra) return;
    if (extra.kind === "tetherSentinel") {
      extra.timer = 0;
      extra.warning = 0;
      extra.target = null;
      return;
    }
    extra.timer -= dt;
    if (extra.kind === "mineWarden") {
      if (
        extra.timer <= 0 &&
        this.rocks.filter((r) => r.coopMine).length < COOP_CONFIG.mineWarden.mineCap
      ) {
        const c = COOP_CONFIG.mineWarden;
        const mine = this.makeRock(d.x, d.y, 1, 0, 0, "boom");
        mine.r = c.mineRadius;
        mine.hp = mine.maxHp = c.mineHp;
        mine.coopMine = {
          ownerId: d.id,
          armTimer: c.mineArmSeconds,
          triggerTimer: -1,
          life: c.mineLifetime,
        };
        this.rocks.push(mine);
        this.specialEvent({ type: "mineDeployed", tick: this.specialTick(), entityId: mine.id });
        extra.timer = this.rnd(c.deploymentMin, c.deploymentMax);
      }
      return;
    }
    if (extra.kind === "riftSpiker") {
      const c = COOP_CONFIG.riftSpiker;
      if (extra.warning > 0) {
        extra.warning -= dt;
        for (const pilot of this.specialPilots()) {
          if (pilot.disabled) continue;
          const dx = d.x - pilot.ship.x,
            dy = d.y - pilot.ship.y,
            distance = Math.hypot(dx, dy);
          if (distance > 30 && distance < c.pullRadius) {
            pilot.ship.vx += (dx / distance) * c.pullStrength * dt;
            pilot.ship.vy += (dy / distance) * c.pullStrength * dt;
          }
        }
        if (extra.warning <= 0) {
          this.enemyBlast(d.x, d.y, c.pulseRadius, c.damage, "Rift Spiker gravity pulse");
          for (const pilot of this.specialPilots()) {
            const dx = pilot.ship.x - d.x,
              dy = pilot.ship.y - d.y,
              distance = Math.hypot(dx, dy);
            if (!pilot.disabled && distance < c.pulseRadius) {
              pilot.ship.vx += (distance ? dx / distance : 1) * c.knockback;
              pilot.ship.vy += (distance ? dy / distance : 0) * c.knockback;
            }
          }
          extra.timer = c.cooldownSeconds;
        }
      } else if (extra.timer <= 0) {
        extra.warning = c.telegraphSeconds;
        this.sound.play("bossCharge");
      }
    }
  }

  updateRockSpecial(r: Rock, dt: number) {
    const mine = r.coopMine;
    if (!mine) return false;
    mine.armTimer -= dt;
    mine.life -= dt;
    r.flash = Math.max(0, r.flash - dt * 4);
    if (mine.life <= 0) {
      this.rocks.splice(this.rocks.indexOf(r), 1);
      return true;
    }
    if (mine.armTimer > 0) return true;
    const config = COOP_CONFIG.mineWarden;
    if (
      mine.triggerTimer < 0 &&
      this.specialPilots().some((p) => {
        return (
          !p.disabled && Math.hypot(p.ship.x - r.x, p.ship.y - r.y) <= config.mineBlastRadius * 0.8
        );
      })
    ) {
      mine.triggerTimer = config.mineWarningSeconds;
      this.rings.push({
        x: r.x,
        y: r.y,
        r: r.r,
        max: config.mineBlastRadius,
        life: config.mineWarningSeconds,
        color: "#ff3d6e",
        w: 2,
      });
    }
    if (mine.triggerTimer >= 0) {
      mine.triggerTimer -= dt;
      if (mine.triggerTimer <= 0) this.breakRock(this.rocks.indexOf(r), 0, 0);
    }
    return true;
  }

  updateTethers(dt: number) {
    // Retire saved player tethers from older co-op rooms. This unit now shields allies.
    this.specialTethers().length = 0;
    const c = COOP_CONFIG.tetherSentinel;
    // an EMP'd Tether Sentinel projects nothing until it comes back online
    const sources = this.drones.filter(
      (d) => d.coop?.kind === "tetherSentinel" && d.hp > 0 && !((d.emp ?? 0) > 0),
    );
    for (const target of [...this.rocks, ...this.drones]) {
      let source: Drone | undefined,
        nearest: number = c.shieldRange;
      for (const candidate of sources) {
        if (candidate.id === target.id) continue;
        const distance = Math.hypot(candidate.x - target.x, candidate.y - target.y);
        if (distance <= nearest) {
          source = candidate;
          nearest = distance;
        }
      }
      if (!source) {
        delete target.supportShield;
        continue;
      }
      const maxHp = clamp(target.maxHp * c.shieldFraction, c.shieldMin, c.shieldMax);
      if (!target.supportShield) target.supportShield = { hp: maxHp, maxHp, sourceId: source.id };
      else {
        target.supportShield.sourceId = source.id;
        target.supportShield.maxHp = maxHp;
        target.supportShield.hp = Math.min(maxHp, target.supportShield.hp + c.shieldRecharge * dt);
      }
    }
  }

  absorbSupportShield(target: Rock | Drone, amount: number) {
    const shield = target.supportShield;
    if (!shield) return amount;
    const source = this.drones.find(
      (d) => d.id === shield.sourceId && d.hp > 0 && d.coop?.kind === "tetherSentinel",
    );
    if (
      !source ||
      Math.hypot(source.x - target.x, source.y - target.y) > COOP_CONFIG.tetherSentinel.shieldRange
    ) {
      delete target.supportShield;
      return amount;
    }
    const absorbed = Math.min(shield.hp, Math.max(0, amount));
    shield.hp -= absorbed;
    return amount - absorbed;
  }

  mineBoom(r: Rock) {
    this.enemyBlast(
      r.x,
      r.y,
      COOP_CONFIG.mineWarden.mineBlastRadius,
      COOP_CONFIG.mineWarden.mineDamage,
      "Mine Warden mine",
    );
    this.specialEvent({
      type: "mineDestroyed",
      tick: this.specialTick(),
      entityId: r.id,
      playerId: this.specialPilotId(),
    });
  }

  updateBossContactCooldown(boss: Boss, dt: number) {
    if (boss.mk6) boss.mk6.beamCd -= dt;
  }
  pickupCollected(_pickup: Pickup) {}
  loseRockHp(rock: Rock, amount: number) {
    rock.hp -= this.absorbSupportShield(rock, amount * this.markMultiplier(rock));
  }
  addBullet(...bullets: Bullet[]) {
    this.bullets.push(...bullets);
  }
  spawnClearance(x: number, y: number) {
    return Math.hypot(x - this.p.x, y - this.p.y);
  }

  private readonly runSave = new RunSave();
  private lastSave = 0;
  leaderboardRun: SavedLeaderboardRun | null = null;
  inputSuspended = false;

  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 1000;
  h = 700;
  dpr = 1;
  mode: Mode = "menu";
  raf = 0;
  last = 0;
  frame = 0;
  private lastIdleRender = 0;

  onHud: (h: Hud) => void;
  onMode: (m: Mode) => void;
  onRunReport?: (report: RunReport) => void;

  p = freshPlayer();
  salvageDrone = freshSalvageDrone();
  /** dev-only extra squad members that actually fly and fight */
  salvageClones: SalvageClone[] = [];
  stacks: Record<string, number> = {};

  rocks: Rock[] = [];
  drones: Drone[] = [];
  boss: Boss | null = null;
  bullets: Bullet[] = [];
  particles: Particle[] = [];
  rings: Ring[] = [];
  texts: Text[] = [];
  pickups: Pickup[] = [];
  arcs: Arc[] = [];
  stars: { x: number; y: number; z: number; s: number }[] = [];

  themeIdx = 0;
  theme: SectorTheme = THEMES[0];

  score = 0;
  credits = 0;
  wave = 0;
  level = 1;
  xp = 0;
  xpNext: number = GAME_CONFIG.progression.startingXpNext;
  combo = 0;
  comboTimer = 0;
  quietTime = 0;
  private shakeAmount = 0;
  get shake() {
    return this.shakeAmount;
  }
  set shake(value: number) {
    this.shakeAmount = clamp(value, 0, GAME_CONFIG.simulation.maxScreenShake);
  }

  decayShake(dt: number) {
    this.shake *= Math.pow(GAME_CONFIG.simulation.shakeDecayPerSecond, dt);
    if (this.shake < 0.1) this.shake = 0;
  }

  screenShakeAmount() {
    return this.settings.shake ? this.shake * (this.reduced ? 0.15 : 1) : 0;
  }
  timeScale = 1;
  flashAlpha = 0;
  /** Full Lock salvo: a short white screen flash, separate from the warm damage flash. */
  salvoFlash = 0;
  /** Simulation seconds; times Crossfire windows. */
  missileClock = 0;
  /** Last missile detonation per target id (Crossfire bookkeeping). */
  missileMarks: Record<number, { owner: string; at: number }> = {};
  /** Presentation-only missile trails keyed by bullet id (or object offline). */
  missileTrails = new Map<unknown, { x: number; y: number }[]>();
  /** Gravity wells and Incendiary patches left by Workshop payloads. */
  missileZones: MissileZone[] = [];
  /** Blast Aftershock (III): blasts waiting to go off. */
  pendingBlasts: {
    x: number;
    y: number;
    r: number;
    dmg: number;
    t: number;
    color: string;
    ownerId?: "p1" | "p2";
    build: MissileBuild;
    tiers: BuildTiers;
  }[] = [];
  /** Salvo numbering, and Siphon's refund total per salvo (capped at one missile). */
  salvoSeq = 0;
  siphonSalvos: Record<number, number> = {};
  siphonTotal = 0;
  /** The warhead whose damage is being applied right now: kills credit its parts' mastery. */
  warheadCredit: MissileBuild | null = null;
  warheadCreditTiers: BuildTiers | null = null;
  /** Breach (Impact III) multiplier for the blast in progress. */
  blastBossMul = 1;
  /** Seed for the blueprint shop stream; a Daily Flare run would set a shared seed. */
  runSeed = 0;
  /** Daily Flare runs ignore Known blueprints so every pilot sees the same offers. */
  dailyFlare = false;
  banner = "";
  bannerSub = "";
  bannerT = 0;
  choices: UpgradeCard[] = [];
  /** credit cost of the next reroll on the current upgrade rack (exponential) */
  rerollCost = 0;
  /** meteor shower event: seconds of shower remaining, spawn cadence and side */
  shower = { active: false, t: 0, spawnT: 0, side: 1, occurredThisWave: false, cooldownWaves: 0 };
  /** optional MK6 encounter offered after the wave-25 boss falls */
  bonusAvailable = false;
  bonusActive = false;
  bonusDefeated = false;
  /** seconds the sector holds after the MK1 sweep so the kill banner can be read before wave 6 */
  waveHold = 0;
  nextId = 1;
  beamAngle = 0;

  reduced = false;
  god = false;
  settings = { ...DEFAULT_SETTINGS };
  mouse = { x: 0, y: 0 };
  mouseDown = false;

  keys: Record<string, boolean> = {};
  stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  touchFire = false;
  private ro: ResizeObserver | null = null;

  constructor(
    canvas: HTMLCanvasElement | null,
    cb: {
      onHud: (h: Hud) => void;
      onMode: (m: Mode) => void;
      onRunReport?: (report: RunReport) => void;
    },
    runtime: GameRuntime = {},
  ) {
    this.headless = runtime.headless ?? false;
    this.random = runtime.random ?? (() => Math.random());
    this.sound = runtime.sound ?? (this.headless ? SILENT_GAME_SOUND : audio);
    this.canvas = canvas!;
    this.ctx = canvas?.getContext("2d", { alpha: true })!;
    this.onHud = cb.onHud;
    this.onMode = cb.onMode;
    this.onRunReport = cb.onRunReport;
    if (this.headless) {
      this.w = runtime.width ?? 1000;
      this.h = runtime.height ?? 700;
      this.resetRun();
      return;
    }
    this.resize();
    this.reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.makeStars();
    this.resetRun();
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    window.addEventListener("blur", this.onBlur);
    // the playfield now fills whatever the HUD leaves free, so follow its box, not just the window
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas!);
    }
    canvas!.addEventListener("pointerdown", this.onPointerDown);
    canvas!.addEventListener("pointermove", this.onPointerMove);
    canvas!.addEventListener("pointerup", this.onPointerUp);
    canvas!.addEventListener("pointercancel", this.onPointerUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    if (this.headless) return;
    this.saveRun();
    this.sound.silence();
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.onBlur);
    this.ro?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
  }

  /* ------------------------------------------------------------ lifecycle */

  resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(320, rect.width);
    this.h = Math.max(320, rect.height);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  };

  makeStars() {
    this.stars = [];
    for (let i = 0; i < GAME_CONFIG.simulation.starCount; i++) {
      this.stars.push({
        x: this.random() * 2000,
        y: this.random() * 1400,
        z: this.rnd(0.25, 1),
        s: this.rnd(0.5, 1.9),
      });
    }
  }

  saveRun() {
    if (this.headless) return false;
    return this.runSave.write(this);
  }

  /** Detached snapshots keep networking and moderation outside the simulation. */
  leaderboardReport(statusOverride?: RunStatus): RunReport | null {
    const run = this.leaderboardRun;
    if (!run || this.wave < 1) return null;
    const report = run.finalReport ?? this.captureLeaderboardReport(statusOverride);
    if (!report) return null;
    const snapshot: RunReport = {
      ...report,
      revision: ++run.revision,
      weapons: { ...report.weapons },
      upgrades: { ...report.upgrades },
      drone: { ...report.drone, upgrades: { ...report.drone.upgrades } },
    };
    this.saveRun();
    return snapshot;
  }

  private captureLeaderboardReport(statusOverride?: RunStatus): RunReport | null {
    const run = this.leaderboardRun;
    if (!run || this.wave < 1) return null;
    return {
      runId: run.runId,
      revision: run.revision,
      score: Math.max(0, Math.floor(this.score)),
      credits: Math.max(0, Math.floor(this.credits)),
      wave: Math.floor(this.wave),
      level: Math.floor(this.level),
      stage: this.bonusDefeated ? "mk6-cleared" : this.bonusActive ? "mk6" : "sectors",
      status:
        statusOverride ??
        (this.mode === "gameover"
          ? "dead"
          : this.mode === "victory"
            ? "victory"
            : this.mode === "playing"
              ? "active"
              : "paused"),
      durationSeconds: Math.floor(run.durationSeconds),
      sector: this.themeIdx + 1,
      primary: this.p.primary,
      weapons: { ...this.p.weapons },
      upgrades: { ...this.stacks },
      deathCause: run.deathCause,
      assisted: run.assisted,
      drone: {
        purchased: this.salvageDrone.purchased,
        weapon: this.salvageDrone.weapon,
        upgrades: Object.fromEntries(
          Object.entries(this.salvageDrone.upgrades).filter(
            ([id, level]) => id !== "shield" || level > 0,
          ),
        ),
      },
    };
  }

  markLeaderboardAssisted() {
    const run = this.leaderboardRun;
    if (!run || run.assisted) return;
    run.assisted = true;
    if (run.finalReport) run.finalReport.assisted = true;
    this.saveRun();
  }

  restoreRun(toMenu = false): boolean {
    if (!this.runSave.restore(this)) return false;
    this.theme = THEMES[this.themeIdx];
    this.setMode(toMenu ? "menu" : this.continueMode());
    this.onHud(this.snapshot());
    return true;
  }

  private continueMode(): Mode {
    return this.bonusAvailable || this.bonusDefeated
      ? "victory"
      : this.choices.length
        ? "levelup"
        : "paused";
  }

  continueRun() {
    if (this.wave < 1 || this.p.hull <= 0) return;
    const next = this.continueMode();
    this.setMode(next === "paused" ? "playing" : next);
    this.onHud(this.snapshot());
  }

  private onPageHide = () => {
    this.saveRun();
    this.god = false;
  };

  private onVisibilityChange = () => {
    // Never carry an inactive tab's elapsed time into simulation or autosave.
    this.last = this.lastSave = performance.now();
    this.lastIdleRender = 0;
    if (document.visibilityState === "hidden") this.onBlur();
  };

  private onBlur = () => {
    if (this.mode === "playing") this.setMode("paused");
    this.keys = {};
    this.mouseDown = false;
    this.touchFire = false;
    this.stick.on = false;
    this.saveRun();
  };

  resetRun() {
    this.leaderboardRun = null;
    this.choices = [];
    this.rerollCost = 0;
    // a fresh shop stream for every run; Warhead parts reset with the player
    this.runSeed = (this.random() * 2 ** 32) >>> 0;
    this.pendingBlasts = [];
    this.missileZones = [];
    this.siphonSalvos = {};
    this.p = freshPlayer();
    this.salvageDrone = freshSalvageDrone();
    this.salvageClones = [];
    this.p.x = this.w / 2;
    this.p.y = this.h / 2;
    this.stacks = {};
    this.rocks = [];
    this.campaignTethers = [];
    this.drones = [];
    this.bullets = [];
    this.pickups = [];
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.arcs = [];
    this.boss = null;
    this.themeIdx = 0;
    this.theme = THEMES[0];
    this.score = 0;
    this.credits = 0;
    this.wave = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = GAME_CONFIG.progression.startingXpNext;
    this.combo = 0;
    this.comboTimer = 0;
    this.quietTime = 0;
    this.shake = 0;
    this.timeScale = 1;
    this.shower = {
      active: false,
      t: 0,
      spawnT: 0,
      side: 1,
      occurredThisWave: false,
      cooldownWaves: 0,
    };
    this.bonusAvailable = false;
    this.bonusActive = false;
    this.bonusDefeated = false;
    this.waveHold = 0;
  }

  startGame() {
    if (this.leaderboardRun && !this.leaderboardRun.finalReport) {
      const abandoned = this.leaderboardReport("abandoned");
      if (abandoned) this.onRunReport?.(abandoned);
    }
    this.sound.unlock();
    this.resetRun();
    this.leaderboardRun = {
      runId: crypto.randomUUID(),
      revision: 0,
      durationSeconds: 0,
      deathCause: null,
      assisted: this.god,
      finalReport: null,
    };
    this.setMode("playing");
    this.nextWave();
    this.runSave.begin(this);
  }

  setMode(m: Mode) {
    this.mode = m;
    if (m === "playing" && this.leaderboardRun) this.leaderboardRun.finalReport = null;
    if ((m === "gameover" || m === "victory") && this.leaderboardRun) {
      // Capture before callbacks and before the existing celebration/death effects
      // can award more points or collect drops after the run has finished.
      this.leaderboardRun.finalReport ??= this.captureLeaderboardReport();
      const finalReport = this.leaderboardReport();
      if (finalReport) this.onRunReport?.(finalReport);
    }
    this.last = performance.now();
    this.lastIdleRender = 0;
    if (m === "playing") this.timeScale = 1;
    if (m !== "playing") {
      this.sound.silence();
      this.p.beamOn = false;
    }
    this.onMode(m);
    this.saveRun();
  }

  /* ------------------------------------------------------------ input */

  onKeyDown = (e: KeyboardEvent) => {
    if (this.inputSuspended || this.mode === "menu") return;
    const t = e.target as HTMLElement | null;
    if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (t && ["BUTTON", "A"].includes(t.tagName) && ["enter", " ", "tab"].includes(k)) return;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "tab"].includes(k))
      e.preventDefault();
    this.keys[k] = true;
    if (k === "p" || k === "escape") {
      if (this.mode === "playing") this.setMode("paused");
      else if (this.mode === "paused") this.setMode("playing");
    }
    if (k === "r" && (this.mode === "gameover" || this.mode === "victory")) this.startGame();
    if ((k === "enter" || k === " ") && (this.mode === "gameover" || this.mode === "victory"))
      this.startGame();
    if (k === "tab") this.cycleWeapon(1);
    if (k === "q") this.cycleWeapon(-1);
    const n = parseInt(k, 10);
    if (n >= 1 && n <= WEAPON_ORDER.length) this.selectWeapon(WEAPON_ORDER[n - 1]);
  };
  onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;
  };

  updateMouse(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
  }

  onPointerDown = (e: PointerEvent) => {
    this.sound.unlock();
    this.updateMouse(e);
    if (this.inputSuspended) return;
    if (this.mode !== "playing") return;
    if (this.settings.mouseControl && e.pointerType === "mouse") {
      this.mouseDown = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    // hybrid aim steers with the keyboard, so a mouse click is a trigger and
    // must never spawn the virtual thumbstick
    if ((this.settings.hybridAim || this.settings.trackpad) && e.pointerType === "mouse") {
      this.touchFire = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (x < rect.width * 0.48 && !this.stick.on) {
      this.stick = { on: true, id: e.pointerId, ox: x, oy: y, x, y };
    } else {
      this.touchFire = true;
    }
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  onPointerMove = (e: PointerEvent) => {
    this.updateMouse(e);
    if (!this.stick.on || e.pointerId !== this.stick.id) return;
    const rect = this.canvas.getBoundingClientRect();
    this.stick.x = e.clientX - rect.left;
    this.stick.y = e.clientY - rect.top;
  };
  onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      this.mouseDown = false;
      if (this.settings.hybridAim || this.settings.trackpad) this.touchFire = false;
    }
    if (e.pointerId === this.stick.id) this.stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    else this.touchFire = false;
  };

  /* ------------------------------------------------------------ weapons API */

  ownedWeapons(): WeaponId[] {
    return WEAPON_ORDER.filter((w) => this.p.weapons[w] > 0);
  }

  selectWeapon(w: WeaponId) {
    if (this.p.weapons[w] <= 0 || this.p.primary === w) return;
    if (this.salvageDrone.weapon === w) {
      this.floatText(this.p.x, this.p.y - 30, "DRONE HARDPOINT OCCUPIED", ICE, 11);
      return;
    }
    this.p.primary = w;
    this.p.heat = 0;
    this.p.overheated = false;
    if (this.p.beamOn) {
      this.sound.play("beamStop");
      this.p.beamOn = false;
    }
    this.p.fireTimer = Math.max(this.p.fireTimer, 0.12);
    this.sound.play("cycle");
    this.floatText(this.p.x, this.p.y - 30, WEAPON_DEFS[w].short, AMBER_HOT, 12);
  }

  cycleWeapon(dir: 1 | -1) {
    const owned = this.ownedWeapons();
    if (owned.length < 2) return;
    const i = owned.indexOf(this.p.primary);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  weaponStats(W: WeaponId, L: number) {
    const simulation = weaponSimulationStats(this.p, this.salvageDrone, W, L);
    let color: string = AMBER_HOT;
    let sfx: Sfx = "pulse";
    switch (W) {
      case "spread":
        sfx = "spread";
        break;
      case "seeker":
        color = "#ff8fb0";
        sfx = "seeker";
        break;
      case "ricochet":
        color = ICE;
        sfx = "ricochet";
        break;
      case "flak":
        color = AMBER;
        sfx = "flak";
        break;
      case "rail":
        color = ICE;
        sfx = "rail";
        break;
      case "laser":
        color = ICE;
        sfx = "arc";
        break;
      case "arc":
        color = "#bff3ff";
        sfx = "arc";
        break;
      case "pulse":
        break;
    }
    return {
      rate: simulation.rate,
      dmg: simulation.damage,
      shots: simulation.shots,
      arc: simulation.arc,
      speed: simulation.speed,
      life: simulation.life,
      r: simulation.radius,
      pierce: simulation.pierce,
      bounces: simulation.bounces,
      fuse: simulation.fuse,
      turn: simulation.homing,
      extra: simulation.extra,
      extraDmg: simulation.extraDamage,
      kind: simulation.kind,
      color,
      sfx,
    };
  }

  weaponPrice(w: WeaponId): number | null {
    return calculateWeaponPrice(this.p, w);
  }

  equipSalvageWeapon(w: WeaponId | null): boolean {
    if (w === null) {
      this.salvageDrone.weapon = null;
      return true;
    }
    if (!this.salvageDrone.purchased || this.p.primary === w || this.p.weapons[w] <= 0)
      return false;
    this.salvageDrone.weapon = w;
    this.floatText(
      this.salvageDrone.x,
      this.salvageDrone.y - 28,
      `DRONE ${WEAPON_DEFS[w].short}`,
      ICE,
      12,
    );
    this.sound.play("buy");
    return true;
  }

  weaponRows(w: WeaponId, level: number): WeaponStatRow[] {
    if (level <= 0) return [];
    if (w === "laser") {
      const s = this.laserStats(level);
      return [
        { label: "Beam DPS", value: Math.round(s.dps).toString() },
        { label: "Heat / sec", value: s.heatRate.toFixed(2) },
        { label: "Range", value: Math.round(s.range).toString() },
        { label: "Beam width", value: Math.round(s.width).toString() },
        {
          label: "Redline DPS",
          value: Math.round(
            s.dps *
              (s.redline ? 1 : GAME_CONFIG.weaponProgression.weapons.laser.redlineDamageMultiplier),
          ).toString(),
        },
        { label: "Overheat lock", value: level >= MAX_WEAPON_LEVEL ? "None · max level" : "15%" },
      ];
    }
    if (w === "arc") {
      const s = this.arcStats(level);
      return [
        { label: "Damage / tick", value: s.dmg.toFixed(1) },
        { label: "Ticks / sec", value: (1 / s.tick).toFixed(1) },
        { label: "Chain targets", value: s.chains.toString() },
        { label: "Acquisition range", value: Math.round(s.range).toString() },
      ];
    }
    const s = this.weaponStats(w, level);
    const rows: WeaponStatRow[] = [
      { label: "Damage", value: s.dmg.toFixed(1) },
      { label: "Rounds / sec", value: s.rate.toFixed(1) },
      { label: "Projectiles", value: s.shots.toString() },
      { label: "Projectile speed", value: Math.round(s.speed).toString() },
    ];
    if (s.pierce > 0) rows.push({ label: "Pierce", value: s.pierce.toString() });
    if (s.bounces > 0) rows.push({ label: "Wall bounces", value: s.bounces.toString() });
    if (s.extra > 0) rows.push({ label: "Shrapnel", value: s.extra.toString() });
    if (s.extraDmg > 0) rows.push({ label: "Shrapnel damage", value: s.extraDmg.toFixed(1) });
    if (s.turn > 0) rows.push({ label: "Homing turn", value: s.turn.toFixed(1) });
    if (w === "rail")
      rows.push({ label: "Effective range", value: Math.round(s.speed * s.life).toString() });
    return rows;
  }

  weaponShopInfo(w: WeaponId): WeaponShopInfo {
    const level = this.p.weapons[w];
    const nextLevel = Math.min(weaponMaxLevel(w), Math.max(1, level + 1));
    return {
      id: w,
      level,
      maxLevel: weaponMaxLevel(w),
      price: this.weaponPrice(w),
      rarity: WEAPON_DEFS[w].rarity,
      owned: level > 0,
      current: this.weaponRows(w, level),
      next: level < weaponMaxLevel(w) ? this.weaponRows(w, nextLevel) : [],
    };
  }

  /* ------------------------------------------------------------ warhead forge */

  /** The bound pilot's forge, repaired if a save or room snapshot left it malformed. */
  forgeOf(): Forge {
    const p = this.p;
    if (!p.forge || !p.forge.fitted) p.forge = normalizeForge(p.forge);
    return p.forge;
  }

  /** Seed for this pilot's blueprint offers (co-op mixes in the pilot id). */
  blueprintSeed(): number {
    return this.runSeed >>> 0;
  }

  /** Known blueprints weight this run's offers, except in Daily Flare and co-op rooms. */
  knownBlueprints(): WarheadPartId[] {
    if (this.dailyFlare || this.cooperative) return [];
    return loadKnownBlueprints();
  }

  ownedParts(): ForgePart[] {
    const f = this.forgeOf();
    return [
      ...WARHEAD_SLOTS.map((slot) => f.fitted[slot]),
      ...f.bench.filter((p): p is ForgePart => !!p),
    ];
  }

  ownedPart(id: WarheadPartId): ForgePart | undefined {
    return this.ownedParts().find((part) => part.id === id);
  }

  /** missileBuild mirrors the fitted parts so every reader sees the same warhead. */
  syncForge() {
    this.p.missileBuild = buildOf(this.forgeOf());
  }

  /** Offers are rolled once per wave from the seeded shop stream (and again on a reroll). */
  ensureBlueprintOffers(force = false) {
    const f = this.forgeOf();
    if (!force && f.offerWave === this.wave && f.offers.length) return;
    if (f.offerWave !== this.wave) f.offerRolls = 0;
    f.offerWave = this.wave;
    f.offers = rollBlueprintOffers({
      seed: this.blueprintSeed(),
      wave: this.wave,
      rolls: f.offerRolls,
      owned: this.ownedParts(),
      known: this.knownBlueprints(),
    });
  }

  /** A stock part nobody paid for or used can simply be discarded on a refit. */
  isFreshStock(part: ForgePart) {
    return (
      WARHEAD_PARTS[part.id].rarity === "default" && part.tier === 1 && !part.spent && !part.kills
    );
  }

  /** Put a part on the bench; false when both bench slots are taken. */
  benchPart(part: ForgePart): boolean {
    if (this.isFreshStock(part)) return true;
    const bench = this.forgeOf().bench;
    const free = bench.indexOf(null);
    if (free < 0) return false;
    bench[free] = part;
    return true;
  }

  /** Why an offer cannot be bought (apart from credits), or null. */
  blueprintBlocked(index: number): string | null {
    const f = this.forgeOf();
    const offer = f.offers[index];
    if (!offer) return "NO OFFER";
    if (offer.sold) return "SOLD";
    const owned = this.ownedPart(offer.id);
    if (owned) return owned.tier === 1 ? null : "OWNED";
    const current = f.fitted[WARHEAD_PARTS[offer.id].slot];
    if (!this.isFreshStock(current) && !f.bench.includes(null)) return "BENCH FULL";
    return null;
  }

  blueprintPrice(index: number): number {
    const offer = this.forgeOf().offers[index];
    if (!offer) return Infinity;
    return this.ownedPart(offer.id) ? mergePrice(offer.id) : partPrice(offer.id);
  }

  /**
   * Buy a blueprint offer. A new part is fitted at once and the part it replaces
   * moves to the bench; an offer for a part you own at Tier I merges it to Tier II
   * for 60% of list price.
   */
  buyBlueprint(index: number): boolean {
    this.ensureBlueprintOffers();
    const f = this.forgeOf();
    const offer = f.offers[index];
    if (!offer || this.blueprintBlocked(index)) return false;
    const price = this.blueprintPrice(index);
    if (this.credits < price) return false;
    const owned = this.ownedPart(offer.id);
    if (owned) {
      owned.tier = 2;
      owned.spent += price;
      this.floatText(
        this.p.x,
        this.p.y - 30,
        `${WARHEAD_PARTS[offer.id].name.toUpperCase()} II`,
        WARHEAD_PARTS[offer.id].color,
        14,
      );
      if (owned.kills >= masteryKills(owned.id)) this.announceMastery(owned.id);
    } else {
      const slot = WARHEAD_PARTS[offer.id].slot;
      if (!this.benchPart(f.fitted[slot])) return false;
      f.fitted[slot] = { id: offer.id, tier: 1, kills: 0, spent: price };
    }
    this.credits -= price;
    offer.sold = true;
    this.syncForge();
    this.sound.play("buy");
    return true;
  }

  /** Tier II → III: unlocked by kills, bought in the Missiles tab. */
  buyMastery(id: WarheadPartId): boolean {
    const part = isWarheadPart(id) ? this.ownedPart(id) : undefined;
    if (!part || part.tier !== 2 || part.kills < masteryKills(id)) return false;
    const price = masteryPrice(id);
    if (this.credits < price) return false;
    this.credits -= price;
    part.tier = 3;
    part.spent += price;
    this.recordKnownBlueprint(id);
    this.syncForge();
    this.floatText(
      this.p.x,
      this.p.y - 30,
      `${WARHEAD_PARTS[id].perk.name.toUpperCase()} UNLOCKED`,
      WARHEAD_PARTS[id].color,
      14,
    );
    this.sound.play("levelup");
    return true;
  }

  /** A Tier III part becomes a Known blueprint in the pilot's profile. */
  recordKnownBlueprint(id: WarheadPartId) {
    if (!this.cooperative && !this.dailyFlare) addKnownBlueprint(id);
  }

  /** Swap a bench part into its slot; the fitted part takes its bench slot. Free. */
  swapBench(index: number): boolean {
    const f = this.forgeOf();
    const part = f.bench[index];
    if (!part) return false;
    const slot = WARHEAD_PARTS[part.id].slot;
    const current = f.fitted[slot];
    f.fitted[slot] = part;
    f.bench[index] = this.isFreshStock(current) ? null : current;
    this.syncForge();
    this.sound.play("cycle");
    return true;
  }

  /** Scrap a bench part for half of everything ever spent on it. */
  scrapBench(index: number): boolean {
    const f = this.forgeOf();
    const part = f.bench[index];
    if (!part) return false;
    const refund = scrapValue(part);
    this.credits += refund;
    f.bench[index] = null;
    this.floatText(this.p.x, this.p.y - 30, `SCRAP +${refund} CR`, AMBER_HOT, 13);
    this.sound.play("creditDrop");
    return true;
  }

  /** Refit a slot's free stock part (Blast, Direct, Impact); the current part goes to the bench. */
  fitStock(slot: WarheadSlot): boolean {
    const f = this.forgeOf();
    const id = DEFAULT_MISSILE_BUILD[slot];
    if (f.fitted[slot].id === id) return false;
    const benched = f.bench.findIndex((p) => p?.id === id);
    if (benched >= 0) return this.swapBench(benched);
    if (!this.benchPart(f.fitted[slot])) return false;
    f.fitted[slot] = stockPart(id);
    this.syncForge();
    this.sound.play("cycle");
    return true;
  }

  /**
   * Fit a part you own: a bench part swaps in, a stock part is refitted free.
   * Parts you do not own are bought as blueprints instead.
   */
  fitWarheadPart(id: WarheadPartId): boolean {
    if (!isWarheadPart(id)) return false;
    const f = this.forgeOf();
    const benched = f.bench.findIndex((p) => p?.id === id);
    if (benched >= 0) return this.swapBench(benched);
    const slot = WARHEAD_PARTS[id].slot;
    if (DEFAULT_MISSILE_BUILD[slot] === id) return this.fitStock(slot);
    return false;
  }

  /** Developer console and tests: install a part at a tier, bypassing the shop. */
  devFitPart(id: WarheadPartId, tier: WarheadTier = 1, kills = 0): boolean {
    if (!isWarheadPart(id)) return false;
    this.forgeOf().fitted[WARHEAD_PARTS[id].slot] = { id, tier, kills, spent: 0 };
    this.syncForge();
    return true;
  }

  /** Remove a bench part to hand to a teammate (co-op); returns it, or null. */
  takeBenchPart(index: number): ForgePart | null {
    const f = this.forgeOf();
    const part = f.bench[index] ?? null;
    if (part) f.bench[index] = null;
    return part;
  }

  /** Everything the Missiles tab needs. */
  forgeShopInfo(): ForgeShopInfo {
    const f = this.forgeOf();
    const info = (part: ForgePart): ForgePartInfo => ({
      part: { ...part },
      need: masteryKills(part.id),
      masteryReady: part.tier === 2 && part.kills >= masteryKills(part.id),
      masteryPrice: masteryPrice(part.id),
      scrap: scrapValue(part),
    });
    return {
      fitted: {
        payload: info(f.fitted.payload),
        guidance: info(f.fitted.guidance),
        trigger: info(f.fitted.trigger),
      },
      bench: f.bench.map((p) => (p ? info(p) : null)),
      offers: f.offers.map((offer, index) => ({
        index,
        id: offer.id,
        price: this.blueprintPrice(index),
        merge: Boolean(this.ownedPart(offer.id)),
        sold: offer.sold,
        blocked: this.blueprintBlocked(index),
      })),
      rerollCost: this.rerollCost,
      stock: WARHEAD_SLOTS.filter((slot) => f.fitted[slot].id !== DEFAULT_MISSILE_BUILD[slot]).map(
        (slot) => DEFAULT_MISSILE_BUILD[slot],
      ),
    };
  }

  buyWeapon(w: WeaponId): boolean {
    const price = this.weaponPrice(w);
    if (price == null || this.credits < price) return false;
    const wasLocked = this.p.weapons[w] === 0;
    this.credits -= price;
    this.p.weapons[w] = Math.min(weaponMaxLevel(w), this.p.weapons[w] + 1);
    if (wasLocked) this.selectWeapon(w);
    this.sound.play("buy");
    this.floatText(
      this.p.x,
      this.p.y - 32,
      `${WEAPON_DEFS[w].short} LV ${this.p.weapons[w]}`,
      AMBER_HOT,
      14,
    );
    return true;
  }

  salvageUpgradePrice(id: SalvageUpgradeId): number | null {
    return calculateSalvageUpgradePrice(this.salvageDrone, id);
  }

  salvageShopInfo(): SalvageShopInfo {
    return {
      purchased: this.salvageDrone.purchased,
      active: this.salvageDrone.active,
      hp: Math.max(0, Math.round(this.salvageDrone.hp)),
      maxHp: Math.round(this.salvageDrone.maxHp),
      rebuilding: this.salvageDrone.rebuilding,
      basePrice: SALVAGE_BASE_PRICE,
      weapon: this.salvageDrone.weapon,
      weaponOptions: WEAPON_ORDER.map((id) => ({
        id,
        level: this.p.weapons[id],
        owned: this.p.weapons[id] > 0,
        equippedByPlayer: this.p.primary === id,
      })),
      upgrades: SALVAGE_UPGRADE_ORDER.map((id) => {
        const def = SALVAGE_UPGRADES[id];
        const level = this.salvageDrone.upgrades[id];
        return {
          id,
          name: def.name,
          path: def.path,
          desc: def.desc,
          level,
          max: def.max,
          price: this.salvageUpgradePrice(id),
          owned: level > 0,
        };
      }),
    };
  }

  buySalvageDrone(): boolean {
    const d = this.salvageDrone;
    if (d.purchased || this.credits < SALVAGE_BASE_PRICE) return false;
    this.credits -= SALVAGE_BASE_PRICE;
    d.purchased = true;
    d.active = true;
    d.rebuilding = 0;
    d.assembly = 1.8;
    d.x = this.p.x + 34;
    d.y = this.p.y + 14;
    d.hp = d.maxHp;
    this.rings.push({ x: d.x, y: d.y, r: 8, max: 80, life: 0.65, color: ICE, w: 3 });
    this.burst(d.x, d.y, 22, ICE);
    this.floatText(d.x, d.y - 26, "DRONE ASSEMBLED", ICE, 14);
    this.sound.play("droneAssemble");
    return true;
  }

  buySalvageUpgrade(id: SalvageUpgradeId): boolean {
    const d = this.salvageDrone;
    const def = SALVAGE_UPGRADES[id];
    const price = this.salvageUpgradePrice(id);
    if (!d.purchased || !def || price == null || this.credits < price) return false;
    this.credits -= price;
    d.upgrades[id]++;
    if (id === "armor") {
      d.maxHp += 12;
      d.hp = Math.min(d.maxHp, d.hp + 12);
    }
    if (id === "repairPulse") d.pulseTimer = this.repairInterval();
    this.floatText(d.x, d.y - 26, `${def.name.toUpperCase()} LV ${d.upgrades[id]}`, ICE, 12);
    this.burst(d.x, d.y, 8, ICE);
    this.sound.play("buy");
    return true;
  }

  playerAttackRate() {
    return this.p.fireRateMul * this.feederRate(false);
  }

  feederRate(drone: boolean) {
    return (
      1 +
      (this.salvageDrone.purchased ? this.salvageDrone.upgrades.piercing : 0) *
        (drone
          ? GAME_CONFIG.salvage.droneFeederRatePerLevel
          : GAME_CONFIG.salvage.playerFeederRatePerLevel)
    );
  }

  arcStats(L: number, drone = false) {
    const lv = Math.max(0, L - 1);
    return {
      range:
        (GAME_CONFIG.weaponProgression.weapons.arc.baseRange +
          GAME_CONFIG.weaponProgression.weapons.arc.rangePerLevel * lv) *
        (this.p.rangeMul ?? 1),
      chains:
        GAME_CONFIG.weaponProgression.weapons.arc.baseChains +
        Math.floor(lv / GAME_CONFIG.weaponProgression.weapons.arc.chainsEveryLevels),
      dmg:
        GAME_CONFIG.weaponProgression.weapons.arc.baseDamage *
        (1 + GAME_CONFIG.weaponProgression.weapons.arc.damagePerLevel * lv) *
        this.p.damageMul,
      tick: GAME_CONFIG.simulation.arcTick / (this.p.fireRateMul * this.feederRate(drone)),
    };
  }

  laserStats(L: number, drone = false) {
    const lv = Math.max(0, L - 1);
    const tuning = GAME_CONFIG.weaponProgression.weapons.laser;
    const redline = !drone && L < MAX_WEAPON_LEVEL && this.p.heat >= tuning.redlineThreshold;
    return {
      range: tuning.range * (this.p.rangeMul ?? 1),
      width: tuning.baseWidth + lv * tuning.widthPerLevel,
      color: redline ? "#ff3d45" : ICE,
      redline,
      dps:
        (redline ? tuning.redlineDamageMultiplier : 1) *
        GAME_CONFIG.weaponProgression.weapons.laser.baseDps *
        (1 + GAME_CONFIG.weaponProgression.weapons.laser.dpsPerLevel * lv) *
        this.p.damageMul *
        this.feederRate(drone),
      heatRate:
        L >= MAX_WEAPON_LEVEL
          ? 0
          : GAME_CONFIG.weaponProgression.weapons.laser.heatRate *
            (1 - GAME_CONFIG.weaponProgression.weapons.laser.heatReductionPerLevel * lv),
    };
  }

  /* ------------------------------------------------------------ loop */

  loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) {
      this.sound.silence();
      this.last = now;
      return;
    }
    // Modal transitions can set last after a frame timestamp has already been queued.
    // Never integrate physics or expanding effects backwards on that first frame.
    let dt = Math.max(0, (now - this.last) / 1000);
    this.last = Math.max(now, this.last);
    if (dt > GAME_CONFIG.simulation.frameDeltaCap) dt = GAME_CONFIG.simulation.frameDeltaCap;
    this.frame++;
    this.decayShake(dt);
    if (this.mode === "playing")
      this.sound.setMusic(
        this.boss?.mk === 6
          ? this.boss.mk6?.enraged
            ? "mk6Phase2"
            : "mk6"
          : this.boss
            ? "boss"
            : "flight",
      );
    else if (!this.sound.hasMusicOverride) this.sound.stopMusic();

    if (this.mode === "playing" || this.mode === "gameover" || this.mode === "victory") {
      const target = this.mode === "gameover" || this.mode === "victory" ? 0.3 : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, dt * 7);
      this.update(dt * this.timeScale);
    }
    if (this.mode === "playing" && now - this.lastSave >= 1000) {
      this.saveRun();
      this.lastSave = now;
    }
    // Static menus need occasional refreshes for HUD/dev changes, not 60 costly canvas draws.
    if (this.mode === "paused" || this.mode === "levelup" || this.mode === "menu") {
      if (now - this.lastIdleRender < 1000 / 15) return;
      this.lastIdleRender = now;
    }
    this.render();
    if (this.frame % 4 === 0) this.onHud(this.snapshot());
  };

  snapshot(): Hud {
    const p = this.p;
    return {
      mode: this.mode,
      score: Math.floor(this.score),
      credits: Math.floor(this.credits),
      wave: this.wave,
      level: this.level,
      xp: this.xp,
      xpNext: this.xpNext,
      hull: Math.max(0, Math.round(p.hull)),
      maxHull: Math.round(p.maxHull),
      sector: this.themeIdx,
      primary: p.primary,
      weaponLevel: p.weapons[p.primary],
      owned: this.ownedWeapons().map((id) => ({ id, level: p.weapons[id] })),
      missiles: p.missiles,
      maxMissiles: p.maxMissiles,
      missileBuild: normalizeMissileBuild(p.missileBuild),
      mastery: WARHEAD_SLOTS.map((slot) => {
        const part = this.forgeOf().fitted[slot];
        return {
          slot,
          id: part.id,
          tier: part.tier,
          kills: part.kills,
          need: masteryKills(part.id),
        };
      }),
      missileCharge:
        p.missiles >= p.maxMissiles ? 1 : clamp(p.missileCharge / p.missileRegen, 0, 1),
      heat: p.heat,
      comboTime: this.comboTimer,
      multiplier: 1 + Math.floor(this.combo / 4) * 0.5,
      banner: this.bannerT > 0 ? this.banner : "",
      bannerSub: this.bannerT > 0 ? this.bannerSub : "",
      salvage: {
        purchased: this.salvageDrone.purchased,
        active: this.salvageDrone.active,
        hp: Math.max(0, Math.round(this.salvageDrone.hp)),
        maxHp: Math.round(this.salvageDrone.maxHp),
        rebuilding: this.salvageDrone.rebuilding,
        weapon: this.salvageDrone.weapon,
        upgrades: SALVAGE_UPGRADE_ORDER.map((id) => ({
          id,
          level: this.salvageDrone.upgrades[id],
        })),
      },
      boosts: this.boostSummary(),
      showerActive: this.shower.active,
      bonusAvailable: this.bonusAvailable,
      bonusActive: this.bonusActive,
      bonusDefeated: this.bonusDefeated,
    };
  }

  /**
   * Pause-screen readout: which stat cards were taken (with stack counts) and
   * the combined effect of all of them on the ship, computed from the live
   * player state so it always agrees with what the game is actually doing.
   */
  boostSummary(): Hud["boosts"] {
    return boostSummary(this.p, this.salvageDrone, this.stacks);
  }

  /* ------------------------------------------------------------ update */

  updatePilot(dt: number) {
    if (this.mode === "playing") this.quietTime += dt;
    if (this.mode === "playing" && this.leaderboardRun) this.leaderboardRun.durationSeconds += dt;
    const p = this.p;
    const k = this.keys;

    // ---- flight ----
    let flight: FlightIntent;
    if (this.flightIntent) {
      flight = this.flightIntent;
    } else if (this.stick.on) {
      const dx = this.stick.x - this.stick.ox,
        dy = this.stick.y - this.stick.oy;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        const desired = Math.atan2(dy, dx);
        const mag = clamp(dist / 90, 0, 1);
        flight = {
          aimAngle: desired,
          aimTurnMultiplier: 1.9,
          forward: mag,
          thrustMultiplier: 1.15,
        };
      } else {
        flight = {};
      }
    } else if (
      this.settings.legacyMovement ||
      (!this.settings.hybridAim && !this.settings.mouseControl && !this.settings.trackpad)
    ) {
      // Legacy Movement: the classic cabinet scheme. Rotate with A/D or the
      // arrows, thrust with W. No mouse aiming whatsoever.
      const turn = (k["arrowleft"] || k["a"] ? -1 : 0) + (k["arrowright"] || k["d"] ? 1 : 0);
      flight = { turn, forward: k["arrowup"] || k["w"] ? 1 : 0 };
    } else if (this.settings.hybridAim || this.settings.trackpad) {
      // twin-stick hybrid: the hull always tracks the cursor while WASD /
      // arrows push the ship in world space, decoupling aim from movement
      const desired = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      const mx = (k["arrowleft"] || k["a"] ? -1 : 0) + (k["arrowright"] || k["d"] ? 1 : 0);
      const my = (k["arrowup"] || k["w"] ? -1 : 0) + (k["arrowdown"] || k["s"] ? 1 : 0);
      flight = { aimAngle: desired, aimTurnMultiplier: 3.2, moveX: mx, moveY: my };
    } else {
      // Mouse Control: the veteran scheme. The ship faces the cursor and holds
      // the left button to thrust.
      const desired = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      flight = { aimAngle: desired, aimTurnMultiplier: 1.9, forward: this.mouseDown ? 1 : 0 };
    }
    stepPlayerMovement(p, flight, dt, { width: this.w, height: this.h });
    if (p.thrusting && this.frame % 3 === 0) this.thrustParticle();

    // ---- firing ----
    p.fireTimer -= dt;
    p.missileTimer -= dt;
    const firing =
      this.settings.trackpad ||
      this.settings.autoFire ||
      !!k[" "] ||
      this.touchFire ||
      !!k["control"];
    const L = p.weapons[p.primary] || 1;

    if (p.primary === "laser") {
      const ls = this.laserStats(L);
      const unlimited = L >= MAX_WEAPON_LEVEL;
      if (firing && (unlimited || !p.overheated) && this.mode === "playing") {
        if (!p.beamOn) {
          this.sound.play("beamStart");
          p.beamOn = true;
        }
        p.heat = unlimited ? 0 : Math.min(1, p.heat + dt * ls.heatRate);
        this.sound.beamHeat(p.heat);
        if (!unlimited && p.heat >= 1) {
          p.overheated = true;
          this.sound.play("beamStop");
          p.beamOn = false;
          this.sound.play("overheat");
        }
        this.beamDamage(dt, this.laserStats(L).dps);
      } else {
        if (p.beamOn) {
          this.sound.play("beamStop");
          p.beamOn = false;
        }
        p.heat = unlimited ? 0 : Math.max(0, p.heat - dt * 0.5);
        if (p.heat <= 0.15) p.overheated = false;
      }
    } else if (p.primary === "arc") {
      p.arcTimer -= dt;
      if (firing && this.mode === "playing" && p.arcTimer <= 0) {
        const as = this.arcStats(L);
        p.arcTimer = as.tick;
        this.doArc(as);
      }
    } else if (firing && this.mode === "playing") {
      this.fire();
    }

    // missiles: hold E to paint locks, release to fire the salvo; tap for one missile
    this.updateMissileLock(dt, !!k["e"]);
    if (p.missiles < p.maxMissiles) this.addMissileCharge(dt / p.missileRegen);
    else p.missileCharge = 0;

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
  }

  update(dt: number) {
    if (this.bannerT > 0) this.bannerT -= dt;
    this.missileClock += dt;
    this.salvoFlash = Math.max(0, this.salvoFlash - dt * 4);
    this.forEachPilot(() => this.updatePilot(dt));
    // ---- meteor shower event ----
    this.updateShower(dt);

    // ---- rocks ----
    for (let ri = this.rocks.length - 1; ri >= 0; ri--) {
      const r = this.rocks[ri];
      // a boom chain-reaction can remove several rocks mid-pass, so the slot may already be gone
      if (!r) continue;
      if (this.updateRockSpecial(r, dt)) continue;
      if ((r.frozen ?? 0) > 0) {
        // Cryo: frozen solid until it thaws, then it picks up where it left off
        r.frozen = Math.max(0, (r.frozen ?? 0) - dt);
        r.flash = Math.max(0, r.flash - dt * 4);
        if (r.frozen <= 0) {
          if (r.frozenV) Object.assign(r, r.frozenV);
          delete r.frozenV;
          delete r.cryo;
          r.permafrost = false;
        }
        continue;
      }
      this.selectTarget(r.x, r.y);
      const p = this.p;
      // transient wall rocks quietly expire after their lifetime
      if (r.life != null) {
        r.life -= dt;
        if (r.life <= 0) {
          this.rocks.splice(ri, 1);
          this.burst(r.x, r.y, 5, TRAIT_COLOR[r.trait]);
          continue;
        }
      }
      if (r.trait === "meteor") {
        // meteors streak straight across and vanish at the far edge
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rot += r.rotSpeed * dt;
        r.flash = Math.max(0, r.flash - dt * 4);
        if (this.frame % 2 === 0) {
          this.particles.push({
            x: r.x,
            y: r.y,
            vx: -r.vx * 0.12 + this.rnd(-15, 15),
            vy: -r.vy * 0.12 + this.rnd(-15, 15),
            life: 0.42,
            max: 0.42,
            size: this.rnd(1.6, 3),
            color: this.random() < 0.5 ? AMBER_HOT : "#ffd27a",
            drag: 0.92,
          });
        }
        const m = 80;
        const gone =
          (r.vx > 0 && r.x > this.w + m) ||
          (r.vx < 0 && r.x < -m) ||
          (r.vy > 0 && r.y > this.h + m) ||
          (r.vy < 0 && r.y < -m);
        if (gone) this.rocks.splice(ri, 1);
        continue;
      }
      if (r.trait === "meteorite") {
        // slow, drifting debris that keeps its momentum and wraps normally
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rot += r.rotSpeed * dt;
        r.flash = Math.max(0, r.flash - dt * 4);
        this.wrap(r);
        continue;
      }
      if (r.trait === "homing") {
        // steer directly at the ship at a constant, size-dependent pace
        const spd =
          r.size === 3 ? 95 : r.size === 2 ? 88 : GAME_CONFIG.asteroids.traits.homing.smallSpeed;
        const turn = r.size === 3 ? 2.4 : r.size === 2 ? 1.8 : 1.3;
        const desired = Math.atan2(p.y - r.y, p.x - r.x);
        const cur = Math.atan2(r.vy, r.vx);
        const a = cur + clamp(wrapAngle(desired - cur), -turn * dt, turn * dt);
        r.vx = Math.cos(a) * spd;
        r.vy = Math.sin(a) * spd;
      }
      if (r.trait === "fast") this.updateFastRockSpeed(r);
      if (r.trait === "boom" && Math.hypot(p.x - r.x, p.y - r.y) < r.r + BOOM.homeRange) {
        // a slight pull toward a nearby ship: slow to turn, never faster than a brisk crawl
        const cruise = BOOM.speed[r.size] * 1.25;
        const cur = Math.atan2(r.vy, r.vx);
        const desired = Math.atan2(p.y - r.y, p.x - r.x);
        const a = cur + clamp(wrapAngle(desired - cur), -BOOM.homeTurn * dt, BOOM.homeTurn * dt);
        const spd = Math.hypot(r.vx, r.vy);
        const next = spd + (cruise - spd) * Math.min(1, dt * 1.5);
        r.vx = Math.cos(a) * next;
        r.vy = Math.sin(a) * next;
      }
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.rot += r.rotSpeed * dt;
      r.flash = Math.max(0, r.flash - dt * 4);

      // Creeper-style proximity fuse for boom asteroids
      if (r.trait === "boom") {
        const playerDist = Math.hypot(p.x - r.x, p.y - r.y);
        // the fuse starts well inside the (now larger) blast so a short fuse is still escapable
        const triggerRange = Math.max(
          r.r + BOOM.triggerPad,
          this.boomRadius(r.size) * BOOM.triggerFrac,
        );
        if (playerDist < triggerRange) {
          if (r.fuse === undefined) r.fuse = BOOM.fuse;
          r.fuse -= dt;
          r.flash = Math.max(r.flash, 0.6);
          if (this.frame % 2 === 0) {
            this.particles.push({
              x: r.x + this.rnd(-8, 8),
              y: r.y + this.rnd(-8, 8),
              vx: this.rnd(-30, 30),
              vy: this.rnd(-30, 30),
              life: 0.2,
              max: 0.2,
              size: 2.5,
              color: ORANGE,
              drag: 0.9,
            });
          }
          if (r.fuse <= 0) {
            this.breakRock(ri, 0, 0);
            continue;
          }
        } else if (r.fuse !== undefined) {
          r.fuse = Math.min(BOOM.fuse, r.fuse + dt * 0.5);
        }
      }

      if (r.trait === "bounce") {
        let hit = false;
        // Bounce off arena walls
        if (r.x < r.r) {
          r.x = r.r;
          r.vx = Math.abs(r.vx) * 1.05;
          hit = true;
        } else if (r.x > this.w - r.r) {
          r.x = this.w - r.r;
          r.vx = -Math.abs(r.vx) * 1.05;
          hit = true;
        }
        if (r.y < r.r) {
          r.y = r.r;
          r.vy = Math.abs(r.vy) * 1.05;
          hit = true;
        } else if (r.y > this.h - r.r) {
          r.y = this.h - r.r;
          r.vy = -Math.abs(r.vy) * 1.05;
          hit = true;
        }

        // Bounce off other asteroids
        for (let otherI = 0; otherI < this.rocks.length; otherI++) {
          if (otherI === ri) continue;
          const otherR = this.rocks[otherI];
          const dist = Math.hypot(otherR.x - r.x, otherR.y - r.y);
          if (dist < r.r + otherR.r) {
            const nx = (r.x - otherR.x) / (dist || 1);
            const ny = (r.y - otherR.y) / (dist || 1);
            r.vx = (r.vx + nx * 45) * 1.05;
            r.vy = (r.vy + ny * 45) * 1.05;
            hit = true;
            break;
          }
        }

        // Bounce off enemies (sentinels and wardens)
        for (const dr of this.drones) {
          const dist = Math.hypot(dr.x - r.x, dr.y - r.y);
          if (dist < r.r + dr.r) {
            const nx = (r.x - dr.x) / (dist || 1);
            const ny = (r.y - dr.y) / (dist || 1);
            r.vx = (r.vx + nx * 55) * 1.05;
            r.vy = (r.vy + ny * 55) * 1.05;
            hit = true;
            break;
          }
        }

        if (hit) {
          this.burst(r.x, r.y, 4, ICE);
          r.rotSpeed = -r.rotSpeed * 1.02;
          r.bounces = (r.bounces || 0) + 1;
          // Cap bounce speed at 30% above the base for this size
          const maxSpeed = (r.size === 3 ? 120 : r.size === 2 ? 150 : 185) * 1.3;
          const sp = Math.hypot(r.vx, r.vy);
          if (sp > maxSpeed) {
            r.vx = (r.vx / sp) * maxSpeed;
            r.vy = (r.vy / sp) * maxSpeed;
          }
        }
      } else this.wrap(r);

      if (r.trait === "fast" && this.frame % 3 === 0) {
        this.particles.push({
          x: r.x,
          y: r.y,
          vx: -r.vx * 0.15,
          vy: -r.vy * 0.15,
          life: 0.3,
          max: 0.3,
          size: 2,
          color: "#f4f7ff",
          drag: 0.9,
        });
      }
    }

    // ---- wardens ----
    for (const d of this.drones) {
      if ((d.emp ?? 0) > 0 || (d.frozen ?? 0) > 0) {
        this.driftDisabledDrone(d, dt);
        continue;
      }
      this.selectTarget(d.x, d.y);
      this.updateDrone(d, dt);
    }

    this.updateTethers(dt);
    this.updateMissileZones(dt);
    this.updatePendingBlasts(dt);
    this.updateWarheadMarks(dt);

    // ---- salvage drone ----
    this.forEachPilot(() => this.updateSalvageDrone(dt));

    // ---- boss ----
    if (this.boss) {
      this.selectTarget(this.boss.x, this.boss.y);
      const bo = this.boss;
      const x0 = bo.x,
        y0 = bo.y;
      this.updateBoss(bo, dt);
      // Cryo chills a boss instead of freezing it: it moves 40% slower
      if ((bo.chill ?? 0) > 0 && this.boss === bo) {
        const keep = 1 - GAME_CONFIG.warheads.cryo.bossSlow;
        bo.x = x0 + (bo.x - x0) * keep;
        bo.y = y0 + (bo.y - y0) * keep;
      }
    }

    // ---- ship collisions ----
    this.forEachPilot(() => this.shipCollisions(dt));

    // ---- bullets ----
    this.updateBullets(dt);

    // ---- pickups ----
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const u = this.pickups[i];
      this.selectTarget(u.x, u.y);
      const p = this.p;
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < p.magnet) {
        const a = Math.atan2(p.y - u.y, p.x - u.x);
        const pull = clamp(
          (1 - d / p.magnet) * GAME_CONFIG.simulation.pickupPullMax +
            GAME_CONFIG.simulation.pickupPullMin,
          GAME_CONFIG.simulation.pickupPullMin,
          GAME_CONFIG.simulation.pickupPullMax,
        );
        u.vx += Math.cos(a) * pull * 0.02;
        u.vy += Math.sin(a) * pull * 0.02;
      }
      u.x += u.vx;
      u.y += u.vy;
      u.vx *= GAME_CONFIG.simulation.pickupDragPerFrame;
      u.vy *= GAME_CONFIG.simulation.pickupDragPerFrame;
      u.life -= dt;
      if (d < GAME_CONFIG.pickups.pickupDistance) {
        if (u.kind === "credit") {
          this.credits += u.value;
          this.score += u.value * 6;
          this.floatText(u.x, u.y, `+${Math.round(u.value)} CR`, AMBER, 13);
          this.sound.play("pickup");
        } else {
          p.hull = Math.min(p.maxHull, p.hull + u.value);
          this.floatText(u.x, u.y, `+${Math.round(u.value)} HEALTH`, ICE, 13);
        }
        this.pickupCollected(u);
        this.pickups.splice(i, 1);
        continue;
      }
      if (u.life <= 0) this.pickups.splice(i, 1);
    }

    // ---- fx ----
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= Math.pow(q.drag, dt * 60);
      q.vy *= Math.pow(q.drag, dt * 60);
      q.life -= dt;
      if (q.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 8);
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y += t.vy * dt;
      t.vy *= 0.94;
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].life -= dt;
      if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
    }

    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3.2);

    if (this.waveHold > 0) this.waveHold -= dt;
    // event rocks (meteors / meteorites) never hold a wave open
    if (
      this.mode === "playing" &&
      this.waveHold <= 0 &&
      !this.shower.active &&
      this.drones.length === 0 &&
      this.boss === null &&
      !this.rocks.some((r) => !isEventRock(r.trait))
    ) {
      this.nextWave();
    }
  }

  /* ------------------------------------------------------------ meteor showers */

  /**
   * True for the whole span of a main-run dreadnought fight: the boss wave
   * itself, plus any live boss. Random showers never roll during this window
   * (MK6's own meteor abilities are separate and unaffected).
   */
  bossFightActive() {
    if (this.bonusActive) return false;
    return !!this.boss || isBossWave(this.wave);
  }

  /** Past the pacing gate a shower can open once per wave. Meteors streak across
   *  the sector from one side while meteorites rain down and disperse. */
  updateShower(dt: number) {
    const s = this.shower;
    if (!s.active) {
      if (
        this.mode === "playing" &&
        this.wave > RUN_PACING.meteorShowersAfterWave &&
        !s.occurredThisWave &&
        s.cooldownWaves <= 0 &&
        !this.bossFightActive()
      ) {
        // roughly a 1-in-3 chance per wave, rolled slowly so it lands mid-wave
        // Fewer total waves means fewer opportunities, so the per-second roll
        // is doubled to preserve roughly the same number of showers per run.
        if (this.random() < dt * 0.09) this.startShower();
      }
      return;
    }
    s.t -= dt;
    s.spawnT -= dt;
    if (s.spawnT <= 0) {
      s.spawnT = this.rnd(0.28, 0.5);
      this.spawnMeteor(s.side);
      if (this.random() < 0.55) this.spawnMeteorite();
    }
    if (s.t <= 0) {
      s.active = false;
      this.floatText(this.w / 2, this.h * 0.2, "SHOWER PASSING", AMBER_HOT, 14);
    }
  }

  startShower(duration = 7.5) {
    const s = this.shower;
    // hard guard: a shower may never overlap a dreadnought fight
    if (this.bossFightActive()) return;
    s.active = true;
    s.t = duration;
    s.spawnT = 0.2;
    s.side = this.random() < 0.5 ? -1 : 1;
    s.occurredThisWave = true;
    this.banner = "METEOR SHOWER";
    this.bannerSub = "STREAKS CROSS THE SECTOR · METEORITES PAY 10–20 CR";
    this.bannerT = 2.6;
    this.flashAlpha = 0.35;
    this.shake += 5;
    this.sound.play("bossCharge");
  }

  /** a fast streak that enters one side and leaves the other */
  spawnMeteor(side: number) {
    const fromLeft = side < 0;
    const y = this.rnd(40, this.h - 40);
    const x = fromLeft ? -50 : this.w + 50;
    // Ease pilots into showers; reach the original speed in the final sector.
    const speed = this.rnd(520, 700) * (0.55 + 0.45 * clamp((this.wave - 6) / 15, 0, 1));
    const drift = this.rnd(-0.32, 0.32);
    const rock = this.makeRock(
      x,
      y,
      1,
      (fromLeft ? 1 : -1) * Math.cos(drift) * speed,
      Math.sin(drift) * speed,
      "meteor",
    );
    rock.r *= 1.35;
    // tanky enough to feel like a real target, soft enough to be worth shooting
    const meteor = GAME_CONFIG.asteroids.traits.meteor;
    rock.hp = rock.maxHp = meteor.hpBase + scaledWave(this.wave) * meteor.hpPerScaledWave;
    rock.rotSpeed = this.rnd(4, 8) * (fromLeft ? 1 : -1);
    this.addRocks(rock);
  }

  /** a meteor breaking apart showers the impact point with salvageable debris */
  shatterMeteor(x: number, y: number, vx: number, vy: number) {
    const meteor = GAME_CONFIG.asteroids.traits.meteor;
    const shards = Math.floor(this.rnd(meteor.shardCountMin, meteor.shardCountMax));
    for (let i = 0; i < shards; i++) {
      const a = this.random() * TAU;
      const sp = this.rnd(60, 150);
      const rock = this.makeRock(
        x,
        y,
        1,
        Math.cos(a) * sp + vx * 0.12,
        Math.sin(a) * sp + vy * 0.12,
        "meteorite",
      );
      rock.r *= 0.8;
      rock.hp = rock.maxHp =
        GAME_CONFIG.asteroids.traits.meteorite.hpBase +
        scaledWave(this.wave) * GAME_CONFIG.asteroids.traits.meteorite.hpPerScaledWave;
      this.addRocks(rock);
    }
    this.rings.push({ x, y, r: 8, max: 110, life: 0.5, color: AMBER_HOT, w: 3 });
    this.burst(x, y, 34, AMBER_HOT);
    this.burst(x, y, 18, "#ffd27a");
    this.shake += 7;
    this.sound.play("explodeBig");
  }

  /** a small slow meteorite that falls in from the top and disperses */
  spawnMeteorite() {
    const x = this.rnd(40, this.w - 40);
    const rock = this.makeRock(x, -30, 1, this.rnd(-70, 70), this.rnd(45, 90), "meteorite");
    rock.r *= 0.8;
    rock.hp = rock.maxHp =
      GAME_CONFIG.asteroids.traits.meteorite.hpBase +
      scaledWave(this.wave) * GAME_CONFIG.asteroids.traits.meteorite.hpPerScaledWave; // pops in one or two shots
    this.addRocks(rock);
  }

  /** dev helper: drop a handful of meteorites right now */
  devSpawnMeteorites(n = 6) {
    for (let i = 0; i < n; i++) {
      const x = this.rnd(40, this.w - 40);
      const rock = this.makeRock(
        x,
        this.rnd(-60, -20),
        1,
        this.rnd(-70, 70),
        this.rnd(45, 90),
        "meteorite",
      );
      rock.r *= 0.8;
      rock.hp = rock.maxHp =
        GAME_CONFIG.asteroids.traits.meteorite.hpBase +
        scaledWave(this.wave) * GAME_CONFIG.asteroids.traits.meteorite.hpPerScaledWave;
      this.addRocks(rock);
    }
  }

  wrap(o: { x: number; y: number }) {
    const m = 44;
    if (o.x < -m) o.x += this.w + m * 2;
    if (o.x > this.w + m) o.x -= this.w + m * 2;
    if (o.y < -m) o.y += this.h + m * 2;
    if (o.y > this.h + m) o.y -= this.h + m * 2;
  }

  /* ------------------------------------------------------------ salvage drone */

  updateSalvageDrone(dt: number) {
    const d = this.salvageDrone;
    if (!d.purchased) return;
    d.hitTimer = Math.max(0, d.hitTimer - dt);
    d.assembly = Math.max(0, d.assembly - dt);

    if (!d.active) {
      if (d.rebuilding > 0) {
        d.rebuilding -= dt;
        d.x = this.p.x + 28;
        d.y = this.p.y + 12;
        if (this.frame % 4 === 0) {
          this.particles.push({
            x: d.x + this.rnd(-10, 10),
            y: d.y + this.rnd(-10, 10),
            vx: this.rnd(-20, 20),
            vy: this.rnd(-20, 20),
            life: 0.35,
            max: 0.35,
            size: 2,
            color: ICE,
            drag: 0.9,
          });
        }
        if (d.rebuilding <= 0) {
          d.rebuilding = 0;
          d.active = true;
          d.hp = d.maxHp;
          d.assembly = 1.2;
          this.rings.push({ x: d.x, y: d.y, r: 8, max: 68, life: 0.5, color: ICE, w: 2 });
          this.burst(d.x, d.y, 16, ICE);
          this.floatText(d.x, d.y - 24, "DRONE REBUILT", ICE, 12);
          this.sound.play("droneRebuild");
        }
      }
      return;
    }

    // primary unit flies slot 0; each dev clone takes its own orbit phase
    this.flySalvageUnit(d, dt, 0);
    for (let i = this.salvageClones.length - 1; i >= 0; i--) {
      const c = this.salvageClones[i];
      c.hitTimer = Math.max(0, c.hitTimer - dt);
      this.flySalvageUnit(c, dt, i + 1);
      if (c.hp <= 0) {
        this.burst(c.x, c.y, 24, ICE);
        this.rings.push({ x: c.x, y: c.y, r: 8, max: 64, life: 0.4, color: ICE, w: 2 });
        this.sound.play("droneDestroyed");
        this.salvageClones.splice(i, 1);
      }
    }
  }

  /**
   * Shared per-unit body: orbit-follow, rock collisions, magnet, support
   * pulses (primary only) and the mounted weapon. `slot` staggers the orbit so
   * a squad fans out instead of stacking on one point.
   */
  flySalvageUnit(u: SalvageDrone | SalvageClone, dt: number, slot: number) {
    const d = this.salvageDrone;
    const isPrimary = slot === 0;
    const speedLevel = d.upgrades.speed;
    u.orbit += dt * (1.15 + speedLevel * 0.18) * (slot % 2 === 0 ? 1 : -1);
    const followDistance = 48 + speedLevel * 18 + (speedLevel >= 3 ? 28 : 0) + slot * 22;
    const lead = 0.12 + speedLevel * 0.05;
    const phase = u.orbit + slot * (TAU / 3);
    const targetX = this.p.x + this.p.vx * lead + Math.cos(phase) * followDistance;
    const targetY = this.p.y + this.p.vy * lead + Math.sin(phase) * followDistance * 0.68;
    const dx = targetX - u.x,
      dy = targetY - u.y;
    u.vx += dx * (2.6 + speedLevel * 0.45) * dt;
    u.vy += dy * (2.6 + speedLevel * 0.45) * dt;
    u.vx *= Math.pow(0.94, dt * 60);
    u.vy *= Math.pow(0.94, dt * 60);
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    this.wrap(u);
    u.angle = Math.atan2(u.vy || targetY - u.y, u.vx || targetX - u.x);

    // Collision with rocks is independent of the player hitbox.
    if (u.hitTimer <= 0) {
      for (const r of this.rocks) {
        if (Math.hypot(u.x - r.x, u.y - r.y) < 13 + r.r * 0.72) {
          const dmg = r.trait === "meteor" ? 14 : r.trait === "meteorite" ? 4 : 8 + r.size * 4;
          if (isPrimary) this.damageSalvageDrone(dmg);
          else {
            u.hp -= dmg * (1 - (d.upgrades.armor >= 3 ? 0.6 : d.upgrades.armor * 0.15));
            this.burst(u.x, u.y, 6, ICE);
          }
          u.vx += (u.x - r.x) * 2.5;
          u.vy += (u.y - r.y) * 2.5;
          u.hitTimer = 0.42;
          break;
        }
      }
    }

    if (u.hp <= 0 || (isPrimary && !d.active)) return;
    if (!isPrimary) {
      this.salvageMagnet(u, dt);
      this.salvageFire(u, dt);
      return;
    }

    this.salvageMagnet(u, dt);
    this.repairSalvage(dt);
    this.salvageFire(u, dt);
  }

  salvageSupportRange() {
    return (
      GAME_CONFIG.salvage.repairPulseRange +
      this.salvageDrone.upgrades.scan * GAME_CONFIG.salvage.repairPulseRangePerScan
    );
  }

  repairInterval() {
    const level = this.salvageDrone.upgrades.repairPulse;
    return GAME_CONFIG.salvage.repairPulseIntervals[Math.max(0, Math.min(2, level - 1))];
  }

  repairSalvage(dt: number) {
    const d = this.salvageDrone;
    if (
      !d.purchased ||
      !d.active ||
      !d.upgrades.repairPulse ||
      this.quietTime < GAME_CONFIG.salvage.repairQuietSeconds ||
      Math.hypot(d.x - this.p.x, d.y - this.p.y) > this.salvageSupportRange()
    ) {
      d.pulseTimer = this.repairInterval();
      return;
    }
    // Do not bank time out of range or before the five-second quiet window.
    d.pulseTimer -= Math.min(
      dt,
      Math.max(0, this.quietTime - GAME_CONFIG.salvage.repairQuietSeconds),
    );
    if (d.pulseTimer <= 0.000001) {
      this.p.hull = Math.min(
        this.p.maxHull,
        this.p.hull +
          (d.upgrades.repairPulse >= 3
            ? GAME_CONFIG.salvage.repairPulseLevel3Heal
            : GAME_CONFIG.salvage.repairPulseHeal),
      );
      d.pulseTimer = this.repairInterval();
      this.rings.push({ x: this.p.x, y: this.p.y, r: 8, max: 28, life: 0.28, color: ICE, w: 1.5 });
    }
  }

  /** credit magnet + collection for any squad unit */
  salvageMagnet(u: SalvageDrone | SalvageClone, dt = 1 / 60) {
    const d = this.salvageDrone;
    const magnet =
      GAME_CONFIG.salvage.magnetRangeBase +
      d.upgrades.magnet * GAME_CONFIG.salvage.magnetRangePerLevel +
      d.upgrades.scan * GAME_CONFIG.salvage.magnetRangePerScan +
      (d.upgrades.magnet >= 3 ? GAME_CONFIG.salvage.magnetLevel3RangeBonus : 0);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (pk.kind !== "credit" && d.upgrades.magnet === 0) continue;
      const distance = Math.hypot(u.x - pk.x, u.y - pk.y);
      if (distance < magnet) {
        const a = Math.atan2(u.y - pk.y, u.x - pk.x);
        const pull = clamp((1 - distance / magnet) * 920 + 160, 160, 920);
        pk.vx += Math.cos(a) * pull * dt * (1.5 + d.upgrades.magnet * 0.5);
        pk.vy += Math.sin(a) * pull * dt * (1.5 + d.upgrades.magnet * 0.5);
      }
      if (distance < 22) {
        if (pk.kind === "credit") {
          this.credits += pk.value;
          this.score += pk.value * 4;
        } else this.p.hull = Math.min(this.p.maxHull, this.p.hull + pk.value);
        this.floatText(
          pk.x,
          pk.y,
          `DRONE +${Math.round(pk.value)} ${pk.kind === "credit" ? "CR" : "HP"}`,
          ICE,
          11,
        );
        this.burst(pk.x, pk.y, 5, ICE);
        this.sound.play("pickup");
        this.pickupCollected(pk);
        this.pickups.splice(i, 1);
      }
    }
  }

  /**
   * The mounted weapon, for any squad unit.
   *  - laser: a real continuous beam (raycast + drawn), scaled-down dps
   *  - arc:   real chain lightning from the drone, no facing cone
   *  - other: projectiles that inherit the weapon's full identity
   *
   * Adaptive Arsenal adds projectiles, chain targets, or beam power according
   * to the mount. Synchronized Feeders affects every mount's attack cadence.
   */
  salvageFire(u: SalvageDrone | SalvageClone, dt: number) {
    const d = this.salvageDrone;
    const twin = d.upgrades.twinCannons;
    const over = d.upgrades.overcharge;
    const attached = d.weapon;
    const attachedLevel = attached ? this.p.weapons[attached] : 0;
    const range =
      (this.p.rangeMul ?? 1) *
      (GAME_CONFIG.salvage.targetRangeBase +
        d.upgrades.scan * GAME_CONFIG.salvage.targetRangePerScan +
        (d.upgrades.scan >= 3 ? GAME_CONFIG.salvage.scanLevel3TargetBonus : 0) +
        (attached ? GAME_CONFIG.salvage.attachedWeaponRangeBonus : 0));
    const finalSurge = over === 3 ? 1.65 : 1;
    const overMul = (1 + over * 0.28) * (1 - Math.max(0, over - 1) * 0.08) * finalSurge;

    // ---- continuous beam mount ----
    if (attached === "laser") {
      u.fireTimer = 0;
      const target = this.nearestTarget(
        u.x,
        u.y,
        range + 200 * (this.p.rangeMul ?? 1),
        (r) => r.trait !== "meteor",
      );
      if (!target) {
        u.beamOn = false;
        return;
      }
      const desired = Math.atan2(target.y - u.y, target.x - u.x);
      // turret tracks smoothly rather than snapping
      u.beamAngle = u.beamOn
        ? u.beamAngle + clamp(wrapAngle(desired - u.beamAngle), -6 * dt, 6 * dt)
        : desired;
      u.beamOn = true;
      const dps = this.laserStats(attachedLevel, true).dps * 0.18 * overMul * (1 + twin * 0.2);
      u.beamLen = this.droneBeamDamage(
        u.x,
        u.y,
        u.beamAngle,
        range + 200 * (this.p.rangeMul ?? 1),
        dps * dt,
      );
      if (this.frame % 6 === 0) this.sound.play("arc");
      return;
    }
    u.beamOn = false;

    u.fireTimer -= dt;
    if (u.fireTimer > 0) return;

    // ---- chain lightning mount ----
    if (attached === "arc") {
      const as = this.arcStats(attachedLevel, true);
      const fired = this.arcFrom(
        u.x,
        u.y,
        {
          range: Math.min(as.range + d.upgrades.scan * 150, range),
          chains: Math.max(1, as.chains - 1) + twin,
          dmg: as.dmg,
        },
        { scale: 0.45 * overMul },
      );
      u.fireTimer = fired ? as.tick * 2.4 : 0.1;
      return;
    }

    // ---- projectile mounts (and the level-0 starter cannon) ----
    const target = this.nearestTarget(u.x, u.y, range, (r) => r.trait !== "meteor");
    if (!target) return;
    const weaponStats = attached ? this.weaponStats(attached, attachedLevel) : null;
    const shotKind: Bullet["kind"] = weaponStats ? weaponStats.kind : "droneShot";
    const shotColor = weaponStats ? weaponStats.color : ICE;
    const multiShotAllowed =
      attached === "pulse" || attached === "ricochet" || attached === "spread" || attached === null;
    const shots = (multiShotAllowed ? Math.min(4, Math.max(1, weaponStats?.shots ?? 1)) : 1) + twin;
    const baseDamage = (weaponStats?.dmg ?? 3.5) * 0.22;
    const damage = (baseDamage + over * 1.8) * (1 - Math.max(0, over - 1) * 0.08) * finalSurge;
    const speed = (weaponStats?.speed ?? 430) * 0.78 + d.upgrades.scan * 22;
    const spreadArc = weaponStats && weaponStats.arc > 0.05 ? weaponStats.arc : 0.08;
    const leadTime = Math.hypot(target.x - u.x, target.y - u.y) / speed;
    const aim = Math.atan2(
      target.y + target.vy * leadTime - u.y,
      target.x + target.vx * leadTime - u.x,
    );
    for (let i = 0; i < shots; i++) {
      const a = aim + (i - (shots - 1) / 2) * spreadArc;
      this.addBullet({
        x: u.x + Math.cos(a) * 13,
        y: u.y + Math.sin(a) * 13,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: weaponStats ? weaponStats.r : 3,
        life: weaponStats ? weaponStats.life : 1.4 * (this.p.rangeMul ?? 1),
        dmg: damage,
        kind: shotKind,
        pierce: weaponStats ? weaponStats.pierce : 0,
        color: shotColor,
        hitIds: new Set(),
        turn: weaponStats?.turn ?? 0,
        bounces: weaponStats?.bounces ?? 0,
        fuse: weaponStats?.fuse ?? 0,
        extra: weaponStats?.extra ?? 0,
        extraDmg: (weaponStats?.extraDmg ?? 0) * 0.5,
      });
    }
    u.fireTimer = Math.max(0.4, (attached ? 1.45 : 1.65) - over * 0.18) / this.feederRate(true);
    this.sound.play(weaponStats ? weaponStats.sfx : "seeker");
  }

  /** raycast beam from a drone; returns the beam's drawn length */
  droneBeamDamage(ox: number, oy: number, angle: number, range: number, dmg: number): number {
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const TOL = 6;
    let nearest = range;
    // beam stops at the first thing it hits, so find the closest along-ray target
    const hits: { t: number; apply: () => void }[] = [];
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      if (r.trait === "meteor") continue;
      const rx = r.x - ox,
        ry = r.y - oy;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(rx * dy - ry * dx) < r.r + TOL)
        hits.push({
          t,
          apply: () => {
            this.loseRockHp(r, dmg);
            r.flash = 1;
            if (r.hp <= 0) {
              const idx = this.rocks.indexOf(r);
              if (idx >= 0) this.breakRock(idx, dx * 80, dy * 80);
            }
          },
        });
    }
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const e = this.drones[i];
      const rx = e.x - ox,
        ry = e.y - oy;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(rx * dy - ry * dx) < e.r + TOL)
        hits.push({
          t,
          apply: () => {
            const idx = this.drones.indexOf(e);
            if (idx >= 0) this.damageDrone(idx, dmg, false, true);
          },
        });
    }
    if (this.boss) {
      const bo = this.boss;
      const rx = bo.x - ox,
        ry = bo.y - oy;
      const t = rx * dx + ry * dy;
      if (t > 0 && t < range && Math.abs(rx * dy - ry * dx) < bo.r + TOL)
        hits.push({
          t,
          apply: () => {
            this.loseBossHp(bo, dmg);
            bo.flash = 1;
            if (bo.hp <= 0) this.killBoss();
          },
        });
      if (bo.hole) {
        const h = bo.hole;
        const hx = h.x - ox,
          hy = h.y - oy;
        const ht = hx * dx + hy * dy;
        if (ht > 0 && ht < range && Math.abs(hx * dy - hy * dx) < h.r + TOL) {
          hits.push({
            t: ht,
            apply: () => {
              this.damageHole(dmg, false);
            },
          });
        }
      }
    }
    if (hits.length) {
      hits.sort((a, b) => a.t - b.t);
      nearest = hits[0].t;
      hits[0].apply();
      if (this.frame % 3 === 0) this.burst(ox + dx * nearest, oy + dy * nearest, 2, ICE);
    }
    return nearest;
  }

  damageSalvageDrone(amount: number, redirected = false) {
    const d = this.salvageDrone;
    if (!d.purchased || !d.active || (!redirected && d.hitTimer > 0)) return;
    this.quietTime = 0;
    d.pulseTimer = this.repairInterval();
    const armor = redirected ? 0 : d.upgrades.armor >= 3 ? 0.6 : d.upgrades.armor * 0.15;
    d.hp -= amount * (1 - armor);
    d.hitTimer = 0.35;
    this.burst(d.x, d.y, 8, ICE);
    this.rings.push({ x: d.x, y: d.y, r: 8, max: 34, life: 0.24, color: ICE, w: 1.5 });
    if (d.hp <= 0) {
      d.hp = 0;
      d.active = false;
      d.beamOn = false;
      d.rebuilding = -1;
      this.burst(d.x, d.y, 28, ICE);
      this.rings.push({ x: d.x, y: d.y, r: 8, max: 70, life: 0.45, color: ICE, w: 3 });
      this.rings.push({ x: d.x, y: d.y, r: 4, max: 110, life: 0.7, color: AMBER, w: 2 });
      this.rings.push({ x: d.x, y: d.y, r: 12, max: 150, life: 0.9, color: MAGENTA, w: 1.5 });
      this.floatText(d.x, d.y, "DRONE LOST", ICE, 13);
      this.sound.play("droneDestroyed");
      this.shake += 5;
      this.timeScale = Math.min(this.timeScale, 0.55);
    }
  }

  startDroneRebuild() {
    const d = this.salvageDrone;
    if (!d.purchased || d.active || d.rebuilding > 0) return;
    d.rebuilding = 2.5;
    d.x = this.p.x + 28;
    d.y = this.p.y + 12;
    this.sound.play("droneRebuild");
  }

  spikerShots(): 4 | 8 {
    return this.wave >= GAME_CONFIG.enemies.spikers.eightShotWave ? 8 : 4;
  }

  spikerHp() {
    const tuning = GAME_CONFIG.enemies.spikers;
    return tuning.hpBase + this.wave * tuning.hpPerWave;
  }

  spikerCap() {
    const tuning = GAME_CONFIG.enemies.spikers;
    return this.wave >= tuning.latePairFromWave && this.wave <= tuning.latePairToWave ? 2 : 1;
  }

  /** Natural reinforcements share a live cap; developer batches remain explicit overrides. */
  spawnSpikers(count = 1) {
    if (this.wave < GAME_CONFIG.enemies.spikers.unlockWave) return 0;
    const live = this.drones.filter(
      (d) => d.kind === "spiker" && d.coop?.kind !== "riftSpiker",
    ).length;
    const amount = Math.max(0, Math.min(count, this.spikerCap() - live));
    for (let i = 0; i < amount; i++) {
      const point = this.spikerEntryPoint(GAME_CONFIG.enemies.spikers.radius);
      this.drones.push(this.spawnDrone(point.x, point.y, this.spikerHp(), "spiker"));
    }
    return amount;
  }

  /** Enter from the furthest edge so both radial heavies telegraph their arrival. */
  spikerEntryPoint(radius: number) {
    const margin = radius + 20;
    const candidates = [
      { x: margin, y: this.rnd(margin, this.h - margin) },
      { x: this.w - margin, y: this.rnd(margin, this.h - margin) },
      { x: this.rnd(margin, this.w - margin), y: margin },
      { x: this.rnd(margin, this.w - margin), y: this.h - margin },
    ];
    return candidates.reduce((best, next) =>
      Math.hypot(next.x - this.p.x, next.y - this.p.y) >
      Math.hypot(best.x - this.p.x, best.y - this.p.y)
        ? next
        : best,
    );
  }

  updateSpiker(d: Drone, dt: number) {
    const tuning = GAME_CONFIG.enemies.spikers;
    d.flash = Math.max(0, d.flash - dt * 4);
    d.orbitTimer -= dt;
    if (d.orbitTimer <= 0) {
      const heading = Math.atan2(d.vy, d.vx) + this.rnd(-tuning.turnAngle, tuning.turnAngle);
      const speed = this.rnd(tuning.speedMin, tuning.speedMax);
      d.vx = Math.cos(heading) * speed;
      d.vy = Math.sin(heading) * speed;
      d.orbitTimer = this.rnd(tuning.turnIntervalMin, tuning.turnIntervalMax);
    }
    // No pursuit or evasion: momentum carries it around the arena like a rock.
    const speed = Math.hypot(d.vx, d.vy);
    if (speed > tuning.speedMax) {
      d.vx = (d.vx / speed) * tuning.speedMax;
      d.vy = (d.vy / speed) * tuning.speedMax;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    const margin = d.r + 6;
    if (d.x < margin || d.x > this.w - margin) {
      d.x = clamp(d.x, margin, this.w - margin);
      d.vx = d.x === margin ? Math.abs(d.vx) : -Math.abs(d.vx);
    }
    if (d.y < margin || d.y > this.h - margin) {
      d.y = clamp(d.y, margin, this.h - margin);
      d.vy = d.y === margin ? Math.abs(d.vy) : -Math.abs(d.vy);
    }
    // Lock the visible spike directions during the warning and fire them together.
    if (d.fire > tuning.fireWarning) d.angle += tuning.spinRate * d.orbitDir * dt;
    if (this.mode !== "playing") return;
    d.fire -= dt;
    if (d.fire > 0) return;
    const rift = d.coop?.kind === "riftSpiker";
    const shots = this.spikerShots();
    for (let i = 0; i < shots; i++) {
      const a = d.angle + (i * TAU) / shots + (rift ? this.frame * 0.018 : 0);
      this.addBullet({
        x: d.x + Math.cos(a) * (d.r + 6),
        y: d.y + Math.sin(a) * (d.r + 6),
        vx: Math.cos(a) * tuning.boltSpeed,
        vy: Math.sin(a) * tuning.boltSpeed,
        r: tuning.boltRadius,
        life: tuning.boltLifetime,
        dmg: tuning.boltDamage,
        kind: "enemy",
        damageCause: rift ? "Rift Spiker spiral volley" : "Spiker radial volley",
        pierce: 0,
        color: rift ? "#b68cff" : "#ff7aa0",
        hitIds: new Set(),
        turn: 0,
        bounces: 0,
        fuse: 0,
        extra: 0,
        extraDmg: 0,
      });
    }
    d.fire = shots === 8 ? tuning.lateFireInterval : tuning.fireInterval;
    this.rings.push({
      x: d.x,
      y: d.y,
      r: d.r * 0.5,
      max: d.r * 1.7,
      life: 0.3,
      color: MAGENTA,
      w: 2,
    });
    this.sound.play("pulse");
  }

  updateDrone(d: Drone, dt: number) {
    this.updateDroneSpecial(d, dt);
    if (d.kind === "spiker") {
      this.updateSpiker(d, dt);
      return;
    }
    const p = this.p;
    const warden = d.kind === "warden";
    const ang = Math.atan2(p.y - d.y, p.x - d.x);
    const dist = Math.hypot(p.x - d.x, p.y - d.y);
    // While aiming a sniper shot, face the LOCKED aim point (not the live
    // player) so the telegraph beam points exactly where the round will fire.
    d.angle =
      warden && d.pulseCharge !== undefined
        ? Math.atan2(d.sniperAimY - d.y, d.sniperAimX - d.x)
        : ang;
    d.flash = Math.max(0, d.flash - dt * 4);

    // orbit direction flips on a timer so they never trace a predictable circle
    d.orbitTimer -= dt;
    if (d.orbitTimer <= 0) {
      if (this.random() < 0.65) d.orbitDir *= -1;
      d.orbitTimer = this.rnd(2.2, 4.5);
    }

    const low = d.hp < d.maxHp * 0.35;
    // Wardens act as long-range snipers: they hold a large standoff range
    // (900px baseline, retreating past 830px if the player closes) but are
    // anchored to the playfield — they never wrap through the edges
    const want = low ? (warden ? 760 : 620) : warden ? 900 : 470;
    const radial = dist > want + 70 ? 1 : dist < want - 70 ? -1 : 0;
    const orbitSpeed = warden ? 150 : 200;
    let ax = Math.cos(ang) * radial * 260 + Math.cos(ang + Math.PI / 2) * d.orbitDir * orbitSpeed;
    let ay = Math.sin(ang) * radial * 260 + Math.sin(ang + Math.PI / 2) * d.orbitDir * orbitSpeed;

    // evasive burst when a shot is about to connect (wardens are clumsier)
    d.evadeCd -= dt;
    if (d.evadeCd <= 0) {
      for (const b of this.bullets) {
        if (b.kind === "enemy") continue;
        const bx = d.x - b.x,
          by = d.y - b.y;
        const bd = Math.hypot(bx, by);
        if (bd > (warden ? 110 : 130)) continue;
        const bs = Math.hypot(b.vx, b.vy) || 1;
        const closing = (bx * b.vx + by * b.vy) / (bs * bd);
        if (closing < 0.85) continue; // not heading at us
        const side = Math.sign(bx * b.vy - by * b.vx) || 1;
        const power = warden ? 1000 : 1900;
        ax += (-b.vy / bs) * side * power;
        ay += (b.vx / bs) * side * power;
        d.evadeCd = warden ? 1.4 : 0.85;
        this.burst(d.x, d.y, 3, MAGENTA);
        break;
      }
    }

    d.vx += ax * dt;
    d.vy += ay * dt;
    const cap = low ? (warden ? 200 : 235) : warden ? 165 : 200;
    const ds = Math.hypot(d.vx, d.vy);
    if (ds > cap) {
      d.vx = (d.vx / ds) * cap;
      d.vy = (d.vy / ds) * cap;
    }
    d.vx *= Math.pow(0.985, dt * 60);
    d.vy *= Math.pow(0.985, dt * 60);
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (warden) {
      // Wardens are anchored inside the sector — they press against the
      // boundary instead of wrapping through the edges
      d.x = clamp(d.x, d.r + 14, this.w - d.r - 14);
      d.y = clamp(d.y, d.r + 52, this.h - d.r - 14);
    } else {
      this.wrap(d);
    }

    // Warden miniboss ability: SPLITTER TURRETS.
    // The warden stays at a very large standoff range, cycles a slow deploy
    // cooldown, and deploys a smart turret at the midpoint between itself and
    // the player. That turret persists for ~10 seconds and continually spawns
    // seeking homing orbs that harass the player until it's destroyed (2 shots).
    if (warden && this.mode === "playing") {
      if (d.volleyCd === undefined) d.volleyCd = this.rnd(3, 6);
      d.volleyCd -= dt;
      if (d.volleyCd <= 0) {
        d.volleyCd = this.rnd(6, 11);
        // Limit to 3 concurrent turret nests at once
        const nestCount = this.bullets.filter((b) => b.kind === "wardenOrb").length;
        if (nestCount < 3) {
          const midX = (d.x + p.x) / 2;
          const midY = (d.y + p.y) / 2;
          this.addBullet({
            x: midX,
            y: midY,
            vx: 0,
            vy: 0,
            r: 12,
            life: 10.5,
            dmg: 0,
            kind: "wardenOrb",
            pierce: 0,
            color: "#ff7aa0",
            hitIds: new Set(),
            turn: 0,
            bounces: 0,
            fuse: 0,
            extra: 0,
            extraDmg: 0,
            hpNow: 2,
            nested: 0,
            spawnT: 0.5,
            target: d.id,
          });
          this.rings.push({ x: midX, y: midY, r: 12, max: 70, life: 0.45, color: "#ff7aa0", w: 2 });
          this.burst(midX, midY, 14, "#ff7aa0");
          this.sound.play("bossCharge");
        }
      }
    }

    // ---- WARDEN sniper AI --------------------------------------------------
    // The warden holds a long standoff and only takes shots it judges "fair":
    // the player must not be crossing the beam line too fast, and the range
    // must be comfortable. While aiming it telegraphs the exact line with an
    // orange warning beam for 0.6s; if the player strafes hard mid-aim the
    // warden cancels and re-solves instead of wasting the round. The round
    // itself fires at the player's CURRENT position with a small aim error —
    // it never leads velocity, so a well-timed dodge beats it.
    if (warden) {
      // perpendicular velocity of the player relative to the aim line — high
      // means the player is strafing straight across the beam (a sure miss)
      const perp = Math.abs(p.vx * Math.sin(ang) - p.vy * Math.cos(ang));
      if (d.pulseCharge !== undefined) {
        // Aiming: the aim is LOCKED at the player's position when it locked on,
        // so the shot never tracks the player (no homing). If the player strafes
        // off the locked aim point, the warden abandons the shot and re-solves.
        d.pulseCharge -= dt;
        if (Math.hypot(p.x - d.sniperAimX, p.y - d.sniperAimY) > 58) {
          d.pulseCharge = undefined;
          d.fire = 0.7; // player dodged the aim — re-evaluate after a beat
        } else if (perp > 520) {
          d.pulseCharge = undefined;
          d.fire = 0.7; // crossing the line too fast to land — hold
        } else if (d.pulseCharge <= 0) {
          // Trigger: fire at the LOCKED aim point (not the live player position)
          const bs = 860;
          const la = Math.atan2(d.sniperAimY - d.y, d.sniperAimX - d.x);
          this.addBullet({
            x: d.x + Math.cos(la) * 32,
            y: d.y + Math.sin(la) * 32,
            vx: Math.cos(la) * bs,
            vy: Math.sin(la) * bs,
            r: 13,
            life: 2.2,
            dmg: WARDEN_BOLT_DMG,
            kind: "enemy",
            damageCause: "Warden sniper shot",
            pierce: 99,
            color: "#ff8800",
            hitIds: new Set(),
            turn: 0,
            bounces: 0,
            fuse: 0,
            extra: 0,
            extraDmg: 0,
            blast: undefined,
          });
          this.sound.play("rail");
          d.pulseCharge = undefined;
          d.fire = this.rnd(2.4, 3.6);
        }
      } else {
        d.fire -= dt;
        if (d.fire <= 0 && this.mode === "playing") {
          // --- "when to fire" decision -----------------------------------
          // The warden solves the shot like a real sniper: it wants range in a
          // comfortable band, and it wants the player NOT strafing across the
          // beam. Each factor nudges a probability; a poor moment = it holds
          // fire and re-solves shortly rather than wasting the round. On fire
          // it LOCKS the player's current position as the aim point and does
          // NOT track them afterwards — a strafe dodges the shot.
          const playerSpeed = Math.hypot(p.vx, p.vy);
          let fireChance = 0.5;
          const inBand = dist >= 320 && dist <= 1350;
          if (!inBand) fireChance = 0; // out of range — never fires
          if (inBand) fireChance *= 0.55 + 0.45 * (1 - Math.abs(dist - 750) / 600); // sweet spot 520–980
          fireChance *= clamp(1.15 - perp / 320, 0.08, 1.1); // strafing = likely miss
          fireChance *= clamp(1.1 - playerSpeed / 640, 0.12, 1.1); // fleeing = rarely worth it
          if (this.random() < fireChance) {
            d.pulseCharge = 0.6;
            // Lock a SNAPSHOT aim point near the player with a deliberate
            // offset — the round fires at this fixed point and never tracks
            // the player afterwards, so strafing it off the point dodges the
            // shot (it is a telegraphed sniper shot, not a homing missile).
            d.sniperAimX = p.x + this.rnd(-24, 24);
            d.sniperAimY = p.y + this.rnd(-24, 24);
          } else {
            d.fire = 0.4; // hold fire, re-evaluate soon
          }
        }
      }
    }
    // ---- Sentinel fire (quick bolts with lead) -----------------------------
    if (!warden) {
      d.fire -= dt;
      const tuning = GAME_CONFIG.enemies.sentinels;
      // Movement/wrapping has already happened: solve from the actual muzzle
      // position, with a short bounded lead instead of projecting seconds away.
      const range = Math.hypot(p.x - d.x, p.y - d.y);
      if (d.fire <= 0 && this.mode === "playing" && range < tuning.boltRange) {
        const bs = tuning.boltSpeed;
        const speed = Math.hypot(p.vx, p.vy);
        const lead = Math.min((range / bs) * 0.8, 0.3, (range * 0.25) / Math.max(1, speed));
        const lx = clamp(p.x + p.vx * lead, 0, this.w),
          ly = clamp(p.y + p.vy * lead, 0, this.h);
        const la = Math.atan2(ly - d.y, lx - d.x);
        d.angle = la;
        this.addBullet({
          x: d.x + Math.cos(la) * 18,
          y: d.y + Math.sin(la) * 18,
          vx: Math.cos(la) * bs,
          vy: Math.sin(la) * bs,
          r: 5,
          life: 4.2,
          dmg: SENTINEL_BOLT_DMG,
          kind: "enemy",
          damageCause: "Sentinel projectile",
          pierce: 0,
          color: MAGENTA,
          hitIds: new Set(),
          turn: 0,
          bounces: 0,
          fuse: 0,
          extra: 0,
          extraDmg: 0,
          blast: undefined,
        });
        this.sound.play("ui");
        d.burst--;
        if (d.burst > 0) d.fire = 0.22;
        else {
          d.fire = this.rnd(3.0, 4.4) - Math.min(1.1, scaledWave(this.wave) * 0.03);
          d.burst = this.wave >= RUN_PACING.sentinelBurstsFromWave ? 2 : 1;
        }
      }
    }
  }

  /* ------------------------------------------------------------ collisions */

  shipCollisions(dt: number) {
    const p = this.p;
    p.invuln = Math.max(0, p.invuln - dt);
    const collision = GAME_CONFIG.asteroids.collision;
    const SHIP_R = collision.shipRadius;
    const stepLen = Math.hypot(p.vx, p.vy) * dt;
    const steps = stepLen > 12 ? Math.ceil(stepLen / 12) : 1;

    for (const r of this.rocks) {
      if (p.invuln > 0) break;
      const hitR = SHIP_R + r.r * collision.hitRadiusMultiplier;
      let hit = false;
      for (let s = 1; s <= steps && !hit; s++) {
        const f = (s - 1) / steps;
        if (Math.hypot(p.x - p.vx * dt * f - r.x, p.y - p.vy * dt * f - r.y) < hitR) hit = true;
      }
      if (!hit) {
        this.checkGraze(r, Math.hypot(p.x - r.x, p.y - r.y), r.r);
        continue;
      }
      this.spendGraze(r);

      const d = Math.hypot(p.x - r.x, p.y - r.y) || 1;
      const nx = (p.x - r.x) / d,
        ny = (p.y - r.y) / d;
      p.x = r.x + nx * (hitR + 1);
      p.y = r.y + ny * (hitR + 1);

      const rel = Math.hypot(p.vx - r.vx, p.vy - r.vy);
      // small rocks shove less and hurt less than large ones —
      // except meteors, which hit like the freight trains they are
      const meteor = r.trait === "meteor";
      const kick =
        (meteor ? 220 : r.size === 3 ? 130 : r.size === 2 ? 75 : 35) *
        (r.trait === "fast" ? GAME_CONFIG.asteroids.traits.fast.knockbackMultiplier : 1);
      const bounce = meteor ? 0.8 : r.size === 3 ? 0.62 : r.size === 2 ? 0.45 : 0.3;
      const dmg = meteor
        ? clamp(
            collision.meteorBaseDamage + rel * collision.meteorDamagePerRelativeSpeed,
            collision.meteorMinDamage,
            collision.meteorMaxDamage,
          )
        : r.trait === "meteorite"
          ? collision.meteoriteDamage
          : clamp(
              (r.size === 3
                ? collision.largeBase
                : r.size === 2
                  ? collision.mediumBase
                  : collision.smallBase) +
                rel * collision.damagePerRelativeSpeedPerSize * r.size,
              collision.minDamage,
              collision.maxDamage,
            );
      const vDotN = (p.vx - r.vx) * nx + (p.vy - r.vy) * ny;
      if (vDotN < 0) {
        p.vx -= (1 + bounce) * vDotN * nx;
        p.vy -= (1 + bounce) * vDotN * ny;
      }
      p.vx += nx * kick;
      p.vy += ny * kick;
      // a meteor is not deflected by a ship; everything else takes a nudge
      if (!meteor) {
        if (r.trait === "bounce") {
          // Bounces off the player and speeds up (capped at 30% above base)
          r.vx = (r.vx - nx * (110 / r.size)) * 1.05;
          r.vy = (r.vy - ny * (110 / r.size)) * 1.05;
          r.bounces = (r.bounces || 0) + 1;
          const maxSpeed = (r.size === 3 ? 120 : r.size === 2 ? 150 : 185) * 1.3;
          const sp = Math.hypot(r.vx, r.vy);
          if (sp > maxSpeed) {
            r.vx = (r.vx / sp) * maxSpeed;
            r.vy = (r.vy / sp) * maxSpeed;
          }
        } else {
          r.vx -= nx * (70 / r.size);
          r.vy -= ny * (70 / r.size);
        }
      }
      r.flash = 1;

      this.burst(
        p.x - nx * 10,
        p.y - ny * 10,
        meteor ? 22 : 10 + r.size * 2,
        meteor ? AMBER_HOT : AMBER,
      );
      this.rings.push({
        x: p.x,
        y: p.y,
        r: 8,
        max: meteor ? 70 : 40 + r.size * 8,
        life: 0.3,
        color: AMBER_HOT,
        w: 2,
      });
      this.damagePlayer(
        dmg * (r.trait === "fast" ? GAME_CONFIG.asteroids.traits.fast.damageMultiplier : 1),
        meteor
          ? "Meteor collision"
          : r.trait === "meteorite"
            ? "Meteorite collision"
            : `${r.trait === "none" ? "Asteroid" : `${r.trait} asteroid`} collision`,
      );
      p.invuln = collision.invulnerability;
      if (meteor) this.shake += 6;
      const idx = this.rocks.indexOf(r);
      // ramming chips a normal rock; meteors shrug it off, meteorites just pop
      if (idx >= 0 && !meteor)
        this.hitRock(
          idx,
          r.trait === "meteorite" ? collision.meteoriteRamDamage : collision.shipRamDamage,
          -nx * 60,
          -ny * 60,
          false,
        );
      break;
    }

    if (this.boss && p.invuln <= 0) {
      const b = this.boss;
      const hitR = SHIP_R + b.r * 0.92;
      const rel = Math.hypot(p.x - b.x, p.y - b.y);
      if (rel < hitR) {
        const nx = (p.x - b.x) / (rel || 1),
          ny = (p.y - b.y) / (rel || 1);
        p.x = b.x + nx * (hitR + 2);
        p.y = b.y + ny * (hitR + 2);
        p.vx += nx * 340;
        p.vy += ny * 340;
        b.flash = 1;
        this.burst(p.x - nx * 8, p.y - ny * 8, 16, MAGENTA);
        this.damagePlayer(GAME_CONFIG.bosses.contactDamage, `MK${b.mk} boss collision`);
        p.invuln = collision.invulnerability;
      }
    }

    for (const d of this.drones) {
      if (p.invuln > 0) break;
      if (Math.hypot(p.x - d.x, p.y - d.y) < SHIP_R + d.r) {
        const ang = Math.atan2(p.y - d.y, p.x - d.x);
        p.x = d.x + Math.cos(ang) * (SHIP_R + d.r + 1);
        p.y = d.y + Math.sin(ang) * (SHIP_R + d.r + 1);
        p.vx += Math.cos(ang) * 200;
        p.vy += Math.sin(ang) * 200;
        d.vx -= Math.cos(ang) * 160;
        d.vy -= Math.sin(ang) * 160;
        this.burst(p.x, p.y, 16, MAGENTA);
        this.damagePlayer(
          d.kind === "spiker"
            ? GAME_CONFIG.enemies.spikers.playerContactDamage
            : GAME_CONFIG.enemies.sentinels.playerContactDamage,
          d.kind === "spiker"
            ? "Spiker collision"
            : d.kind === "warden"
              ? "Warden collision"
              : "Sentinel collision",
        );
        p.invuln = collision.invulnerability;
        if (d.kind !== "spiker") {
          this.damageDrone(
            this.drones.indexOf(d),
            GAME_CONFIG.enemies.sentinels.contactDamageToEnemy,
            false,
          );
        }
        break;
      }
    }
  }

  /* ------------------------------------------------------------ bullets */

  guide(b: Bullet, dt: number) {
    const range =
      (b.kind === "missile" ? 900 : b.kind === "rail" ? 1500 : 520) * (this.p.rangeMul ?? 1);
    let target: Hostile | undefined;
    if (b.boomerang?.returning) return;
    if (b.kind === "seeker") target = this.nearestTarget(b.x, b.y, range);
    else {
      target = b.target != null ? this.findTarget(b.target) : undefined;
      // Boomerang spends a limited number of re-locks instead of retargeting freely
      if (!target && !b.boomerang) target = this.nearestTarget(b.x, b.y, range);
    }
    if (!target) return;
    if (b.kind === "rail") {
      const origin = (b.guidanceOrigin ??= Math.atan2(b.vy, b.vx));
      const angle = Math.atan2(target.y - b.y, target.x - b.x);
      if (
        Math.abs(wrapAngle(angle - origin)) >
        GAME_CONFIG.weaponProgression.weapons.rail.aimAssistCone
      )
        return;
    }
    b.target = target.id;
    const spd = Math.hypot(b.vx, b.vy) || 1;
    const dist = Math.hypot(target.x - b.x, target.y - b.y);
    // Rail guidance only engages at long distance; close shots stay skillful.
    if (b.kind === "rail" && dist < 600) return;
    // pure-pursuit with a lead on the target's own drift: direct, not faster
    const tt = clamp(dist / spd, 0, 1.2);
    const lx = target.x + target.vx * tt,
      ly = target.y + target.vy * tt;
    // Lead (Direct III) flies to the true intercept instead of a clamped lead
    const lead =
      b.kind === "missile" && b.warhead?.guidance === "direct" && (b.tiers?.guidance ?? 1) >= 3;
    const desired = lead ? this.interceptAngle(b, target) : Math.atan2(ly - b.y, lx - b.x);
    const cur = Math.atan2(b.vy, b.vx);
    let na = cur + clamp(wrapAngle(desired - cur), -b.turn * dt, b.turn * dt);
    if (b.kind === "rail") {
      const origin = b.guidanceOrigin!;
      const cap = GAME_CONFIG.weaponProgression.weapons.rail.maxAimCorrection;
      na = origin + clamp(wrapAngle(na - origin), -cap, cap);
    }
    b.vx = Math.cos(na) * spd;
    b.vy = Math.sin(na) * spd;
  }

  /** returns true if the projectile is consumed by this impact */
  impact(b: Bullet, kind: "rock" | "drone" | "boss", idx: number, id: number): boolean {
    const p = this.p;
    if (b.kind === "missile") return this.missileContact(b, id);
    if (b.kind === "bomblet") {
      this.detonateBomblet(b);
      return true;
    }
    const crit = this.random() < p.crit;
    const dmg = b.dmg * (crit ? p.critMult : 1);
    if (kind === "rock") this.hitRock(idx, dmg, b.vx, b.vy, crit);
    else if (kind === "drone") this.damageDrone(idx, dmg, crit);
    else {
      this.damageBoss(dmg, crit);
      this.addMissileCharge(GAME_CONFIG.salvo.bossHitCharge);
    }
    if (p.leech > 0) p.hull = Math.min(p.maxHull, p.hull + dmg * p.leech);
    if (b.kind === "flak") {
      this.detonateFlak(b);
      return true;
    }
    if (b.pierce > 0) {
      b.pierce--;
      b.hitIds.add(id);
      return false;
    }
    return true;
  }

  updateBullets(dt: number) {
    const { w, h } = this;

    // Splitter-turret interception: the player's shots can destroy a turret
    // with 2 hits. Destroying it stops the homing-orb pressure entirely and is
    // the clean counter-play to the warden's nest loops.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const pb = this.bullets[i];
      if (
        pb.kind === "enemy" ||
        pb.kind === "wardenOrb" ||
        pb.kind === "wardenShard" ||
        pb.kind === "missile"
      )
        continue;
      for (let j = this.bullets.length - 1; j >= 0; j--) {
        if (i === j) continue;
        const orb = this.bullets[j];
        if (orb.kind !== "wardenOrb") continue;
        if (Math.hypot(pb.x - orb.x, pb.y - orb.y) < pb.r + orb.r + 2) {
          orb.hpNow = (orb.hpNow ?? 2) - 1;
          this.burst(pb.x, pb.y, 4, "#ffb3d0");
          this.sound.play("hit");
          // consume the player bullet
          this.bullets.splice(i, 1);
          if (orb.hpNow <= 0) {
            this.burst(orb.x, orb.y, 22, "#ff7aa0");
            this.rings.push({
              x: orb.x,
              y: orb.y,
              r: 4,
              max: 55,
              life: 0.4,
              color: "#ff7aa0",
              w: 2,
            });
            this.sound.play("explodeSmall");
            const oj = j > i ? j - 1 : j; // index shifted after removing pb
            this.bullets.splice(oj, 1);
          }
          break; // this player bullet is spent
        }
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b) continue;
      this.selectBulletPilot(b);
      // kills from this projectile credit the warhead that made it (missiles, bomblets, shards)
      this.warheadCredit = b.kind === "missile" ? (b.warhead ?? null) : (b.sourceWarhead ?? null);
      this.warheadCreditTiers = b.tiers ?? null;
      const p = this.p;
      if (b.life <= 0 && ["enemy", "wardenOrb", "wardenShard"].includes(b.kind)) {
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.kind === "missile" && b.stuck) {
        // Delayed trigger: ride the target until the fuse runs out (or the target dies)
        const t = this.findTarget(b.stuck.id);
        if (t) {
          b.x = t.x + b.stuck.dx;
          b.y = t.y + b.stuck.dy;
        }
        b.stuck.t -= dt;
        if (!t || b.stuck.t <= 0) {
          b.missileDmg =
            (b.missileDmg ?? p.blastDmg) *
            this.tierValue(GAME_CONFIG.warheads.delayed.damageMultiplier, b.tiers?.trigger);
          this.detonateMissile(b);
          this.bullets.splice(i, 1);
        }
        continue;
      }
      if (b.kind === "missile" && b.orbit) {
        this.orbitMissile(b, dt);
        continue;
      }
      if (b.kind === "missile" && b.boomerang) {
        if (this.boomerangMissile(b)) {
          this.bullets.splice(i, 1);
          continue;
        }
      }
      if (b.kind === "bomblet") {
        b.fuse -= dt;
        const drag = Math.max(0, 1 - 2.4 * dt);
        b.vx *= drag;
        b.vy *= drag;
        if (b.fuse <= 0) {
          this.detonateBomblet(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      if (b.kind === "missile" || b.kind === "seeker" || b.kind === "rail") this.guide(b, dt);
      if (b.kind === "missile" && this.frame % 2 === 0) {
        this.particles.push({
          x: b.x,
          y: b.y,
          vx: this.rnd(-20, 20),
          vy: this.rnd(-20, 20),
          life: 0.5,
          max: 0.5,
          size: 3,
          color: MAGENTA,
          drag: 0.9,
        });
      }
      if (b.kind === "flak") {
        b.fuse -= dt;
        if (b.fuse <= 0) {
          this.detonateFlak(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      if (b.kind === "wardenOrb") {
        // Splitter turret: persistent nest that spawns seeking homing orbs
        b.spawnT = (b.spawnT ?? 0.5) - dt;
        if (b.spawnT <= 0 && (b.nested ?? 0) < 6) {
          b.spawnT = this.rnd(1.2, 2.2);
          b.nested = (b.nested ?? 0) + 1;
          // spawn seeking homing orb
          const a = Math.atan2(p.y - b.y, p.x - b.x) + this.rnd(-0.25, 0.25);
          this.addBullet({
            x: b.x,
            y: b.y,
            vx: Math.cos(a) * 240,
            vy: Math.sin(a) * 240,
            r: 4.5,
            life: 3.6,
            dmg: 9,
            kind: "wardenShard",
            pierce: 0,
            color: "#ffb3d0",
            hitIds: new Set(),
            turn: 3.4,
            bounces: 0,
            fuse: 0,
            extra: 0,
            extraDmg: 0,
          });
          this.rings.push({ x: b.x, y: b.y, r: 4, max: 42, life: 0.3, color: "#ff7aa0", w: 2 });
          this.sound.play("explodeSmall");
        }
      }
      if (b.kind === "wardenShard") {
        // shards home hard toward the player
        const desired = Math.atan2(p.y - b.y, p.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        const na = cur + clamp(wrapAngle(desired - cur), -b.turn * dt, b.turn * dt);
        const spd = Math.hypot(b.vx, b.vy) || 1;
        b.vx = Math.cos(na) * spd;
        b.vy = Math.sin(na) * spd;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.kind === "missile") {
        this.spiralMissile(b, dt);
        if (b.warhead?.trigger === "proximity" && this.missileProximity(b)) {
          this.detonateMissile(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      b.life -= dt;

      if (b.kind === "ricochet") {
        let bounced = false;
        if (b.x < 0) {
          b.x = 0;
          b.vx = Math.abs(b.vx);
          bounced = true;
        } else if (b.x > w) {
          b.x = w;
          b.vx = -Math.abs(b.vx);
          bounced = true;
        }
        if (b.y < 0) {
          b.y = 0;
          b.vy = Math.abs(b.vy);
          bounced = true;
        } else if (b.y > h) {
          b.y = h;
          b.vy = -Math.abs(b.vy);
          bounced = true;
        }
        if (bounced) {
          if (b.bounces <= 0) {
            this.bullets.splice(i, 1);
            continue;
          }
          b.bounces--;
          const previousBounces = b.wallBounces ?? 0;
          b.wallBounces = previousBounces + 1;
          const multiplier = (count: number) => [1, 2, 3.5, 5][Math.min(3, count)];
          b.dmg *= multiplier(b.wallBounces) / multiplier(previousBounces);
          b.hitIds.clear();
          this.burst(b.x, b.y, 5, ICE);
          this.sound.play("ricochet");
        }
      } else {
        const m = 60;
        if (b.x < -m || b.x > w + m || b.y < -m || b.y > h + m) {
          if (b.kind === "missile") this.detonateMissile(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      // Boomerang re-locks or turns home; Itano (Corkscrew III) loops back for one more pass
      if (b.life <= 0 && !(b.kind === "missile" && this.missileSecondChance(b))) {
        if (b.kind === "missile") this.detonateMissile(b);
        if (b.kind === "bomblet") this.detonateBomblet(b);
        if (b.kind === "flak") this.detonateFlak(b);
        // a warden shell that found nothing still goes off where it died
        if (b.blast) this.enemyBlast(b.x, b.y, b.blast, b.dmg * 0.6, b.damageCause);
        this.bullets.splice(i, 1);
        continue;
      }

      if (b.kind === "enemy" || b.kind === "wardenShard") {
        if (
          this.salvageDrone.active &&
          Math.hypot(b.x - this.salvageDrone.x, b.y - this.salvageDrone.y) < b.r + 12
        ) {
          this.damageSalvageDrone(b.dmg);
          this.bullets.splice(i, 1);
          continue;
        }
        let ateByClone = false;
        for (const c of this.salvageClones) {
          if (Math.hypot(b.x - c.x, b.y - c.y) < b.r + 12) {
            c.hp -=
              b.dmg *
              (1 -
                (this.salvageDrone.upgrades.armor >= 3
                  ? 0.6
                  : this.salvageDrone.upgrades.armor * 0.15));
            this.burst(c.x, c.y, 6, ICE);
            ateByClone = true;
            break;
          }
        }
        if (ateByClone) {
          this.bullets.splice(i, 1);
          continue;
        }
        // Permafrost (Cryo III): frozen rocks soak up enemy shots
        if (
          this.rocks.some(
            (r) =>
              r.permafrost && (r.frozen ?? 0) > 0 && Math.hypot(r.x - b.x, r.y - b.y) < r.r + b.r,
          )
        ) {
          this.burst(b.x, b.y, 4, WARHEAD_PARTS.cryo.color);
          this.bullets.splice(i, 1);
          continue;
        }
        const shotDistance = Math.hypot(b.x - p.x, b.y - p.y);
        if (shotDistance >= b.r + 15) this.checkGraze(b, shotDistance, b.r);
        else {
          this.damagePlayer(
            b.dmg,
            b.damageCause ??
              (b.kind === "wardenShard" ? "Warden homing shard" : "Hostile projectile"),
          );
          this.bullets.splice(i, 1);
        }
        continue;
      }

      // splitter-orbs are pure energy — they phase through rocks so the volley
      // always reaches the player (shards, below, still respect asteroid cover)
      if (b.kind === "wardenOrb") continue;

      let consumed = false;
      for (let j = this.rocks.length - 1; j >= 0; j--) {
        const r = this.rocks[j];
        if (b.hitIds.has(r.id)) continue;
        if (Math.hypot(b.x - r.x, b.y - r.y) < b.r + r.r) {
          if (this.impact(b, "rock", j, r.id)) {
            this.bullets.splice(i, 1);
            consumed = true;
          }
          break;
        }
      }
      if (consumed) continue;

      if (this.boss) {
        if (this.boss.hole && !b.hitIds.has(this.boss.hole.id)) {
          const h = this.boss.hole;
          if (Math.hypot(b.x - h.x, b.y - h.y) < b.r + h.r) {
            const crit = this.random() < p.crit;
            const dmg = b.dmg * (crit ? p.critMult : 1);
            this.damageHole(dmg, crit);
            if (b.kind === "missile") {
              if (this.missileContact(b, h.id)) this.bullets.splice(i, 1);
              continue;
            }
            if (b.kind === "bomblet") {
              this.detonateBomblet(b);
              this.bullets.splice(i, 1);
              continue;
            }
            if (b.kind === "flak") {
              this.detonateFlak(b);
              this.bullets.splice(i, 1);
              continue;
            }
            if (b.pierce > 0) {
              b.pierce--;
              b.hitIds.add(h.id);
            } else {
              this.bullets.splice(i, 1);
              continue;
            }
          }
        }
        if (!b.hitIds.has(this.boss.id)) {
          const bo = this.boss;
          if (Math.hypot(b.x - bo.x, b.y - bo.y) < b.r * 0.94 + bo.r) {
            if (this.impact(b, "boss", 0, bo.id)) {
              this.bullets.splice(i, 1);
            }
            continue;
          }
        }
      }

      for (let j = this.drones.length - 1; j >= 0; j--) {
        const d = this.drones[j];
        if (b.hitIds.has(d.id)) continue;
        if (Math.hypot(b.x - d.x, b.y - d.y) < b.r + d.r) {
          if (this.impact(b, "drone", j, d.id)) this.bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  detonateFlak(b: Bullet) {
    this.rings.push({ x: b.x, y: b.y, r: 4, max: 46, life: 0.3, color: AMBER, w: 2 });
    this.burst(b.x, b.y, 8, AMBER);
    this.sound.play("explodeSmall");
    const n = Math.max(4, Math.round(b.extra));
    const base = this.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU;
      this.addBullet({
        x: b.x,
        y: b.y,
        vx: Math.cos(a) * 360,
        vy: Math.sin(a) * 360,
        r: 2.5,
        life: 0.45,
        dmg: b.extraDmg,
        kind: "shrap",
        pierce: 0,
        color: AMBER_HOT,
        hitIds: new Set(),
        turn: 0,
        bounces: 0,
        fuse: 0,
        extra: 0,
        extraDmg: 0,
      });
    }
  }

  /* ------------------------------------------------------------ combat */

  hostiles(): Hostile[] {
    const out: Hostile[] = [];
    for (const r of this.rocks) out.push(r);
    for (const d of this.drones) out.push(d);
    if (this.boss) {
      out.push(this.boss);
      if (this.boss.hole) {
        out.push({
          id: this.boss.hole.id,
          x: this.boss.hole.x,
          y: this.boss.hole.y,
          r: this.boss.hole.r,
          vx: 0,
          vy: 0,
        });
      }
    }
    return out;
  }

  findTarget(id: number): Hostile | undefined {
    if (this.boss) {
      if (this.boss.id === id) return this.boss;
      if (this.boss.hole && this.boss.hole.id === id) {
        return {
          id: this.boss.hole.id,
          x: this.boss.hole.x,
          y: this.boss.hole.y,
          r: this.boss.hole.r,
          vx: 0,
          vy: 0,
        };
      }
    }
    return this.rocks.find((r) => r.id === id) ?? this.drones.find((d) => d.id === id);
  }

  nearestTarget(
    x: number,
    y: number,
    maxD: number,
    rockFilter?: (r: Rock) => boolean,
  ): Hostile | undefined {
    let best: Hostile | undefined;
    let bd = maxD;
    for (const r of this.rocks) {
      if (rockFilter && !rockFilter(r)) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    for (const dr of this.drones) {
      const d = Math.hypot(dr.x - x, dr.y - y) * 0.7;
      if (d < bd) {
        bd = d;
        best = dr;
      }
    }
    if (this.boss) {
      const d = Math.hypot(this.boss.x - x, this.boss.y - y) - this.boss.r;
      if (d < bd) {
        bd = d;
        best = this.boss;
      }
      if (this.boss.hole) {
        const hd = Math.hypot(this.boss.hole.x - x, this.boss.hole.y - y) - this.boss.hole.r;
        if (hd < bd) {
          bd = hd;
          best = {
            id: this.boss.hole.id,
            x: this.boss.hole.x,
            y: this.boss.hole.y,
            r: this.boss.hole.r,
            vx: 0,
            vy: 0,
          };
        }
      }
    }
    return best;
  }

  assistAngle(base: number, strength = 1): number {
    const CONE = 0.2 * strength,
      MAX_NUDGE = 0.085 * strength,
      RANGE = 920 * (this.p.rangeMul ?? 1);
    let bestDiff = CONE,
      bestAngle = base;
    const consider = (tx: number, ty: number, tvx: number, tvy: number, radius: number) => {
      const dist = Math.hypot(tx - this.p.x, ty - this.p.y);
      if (dist > RANGE || dist < 1) return;
      const t = dist / this.p.bulletSpeed;
      const desired = Math.atan2(ty + tvy * t - this.p.y, tx + tvx * t - this.p.x);
      let diff = Math.abs(wrapAngle(desired - base));
      diff -= Math.min(0.05, (radius / dist) * 0.5);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAngle = desired;
      }
    };
    for (const r of this.rocks) consider(r.x, r.y, r.vx, r.vy, r.r);
    for (const d of this.drones) consider(d.x, d.y, d.vx, d.vy, d.r * 1.6);
    if (this.boss) {
      consider(this.boss.x, this.boss.y, this.boss.vx, this.boss.vy, this.boss.r);
      if (this.boss.hole)
        consider(this.boss.hole.x, this.boss.hole.y, 0, 0, this.boss.hole.r * 1.5);
    }
    if (bestAngle === base) return base;
    return base + clamp(wrapAngle(bestAngle - base) * 0.6, -MAX_NUDGE, MAX_NUDGE);
  }

  fire() {
    const p = this.p;
    if (p.fireTimer > 0) return;
    const W = p.primary;
    const s = this.weaponStats(W, p.weapons[W] || 1);
    p.fireTimer = 1 / s.rate;
    const aim = this.assistAngle(p.angle, W === "rail" ? 0.3 : 1);
    this.sound.play(s.sfx);
    const mx = p.x + Math.cos(p.angle) * 22,
      my = p.y + Math.sin(p.angle) * 22;
    for (let i = 0; i < s.shots; i++) {
      const off = (i - (s.shots - 1) / 2) * s.arc + (this.random() - 0.5) * p.inaccuracy;
      const a = aim + off;
      this.addBullet({
        x: mx,
        y: my,
        vx: Math.cos(a) * s.speed + p.vx * 0.35,
        vy: Math.sin(a) * s.speed + p.vy * 0.35,
        r: s.r,
        life: s.life,
        dmg: s.dmg,
        kind: s.kind,
        pierce: s.pierce,
        color: s.color,
        hitIds: new Set(),
        turn: s.turn,
        bounces: s.bounces,
        fuse: s.fuse,
        extra: s.extra,
        extraDmg: s.extraDmg,
      });
    }
    const isRail = W === "rail";
    for (let i = 0; i < (isRail ? 10 : 4); i++) {
      const a = p.angle + this.rnd(-0.35, 0.35),
        sp = this.rnd(60, 220);
      this.particles.push({
        x: mx,
        y: my,
        vx: Math.cos(a) * sp + p.vx,
        vy: Math.sin(a) * sp + p.vy,
        life: isRail ? 0.34 : 0.2,
        max: isRail ? 0.34 : 0.2,
        size: isRail ? 3.2 : 2.2,
        color: isRail ? ICE : s.color,
        drag: 0.9,
      });
    }
    if (isRail) {
      this.shake += 5;
      this.rings.push({ x: mx, y: my, r: 4, max: 42, life: 0.28, color: ICE, w: 2 });
    }
    if (W === "flak") this.shake += 2;
  }

  beamDamage(dt: number, dps: number) {
    const p = this.p;
    this.beamAngle = p.angle;
    this.beamDamageDirection(dt, dps, p.angle);
    if (p.extraShots > 0) this.beamDamageDirection(dt, dps, p.angle + Math.PI);
  }

  beamDamageDirection(dt: number, dps: number, a: number) {
    const p = this.p;
    const dx = Math.cos(a),
      dy = Math.sin(a);
    const beam = this.laserStats(p.weapons.laser || 1);
    const range = beam.range,
      TOL = beam.width / 2;
    // A boom chain reaction may remove several rocks at once. Work from the
    // original targets, skipping removed ones and leaving new shards for the next tick.
    for (const r of [...this.rocks].reverse()) {
      const i = this.rocks.indexOf(r);
      if (i < 0) continue;
      const rx = r.x - p.x,
        ry = r.y - p.y;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(rx * dy - ry * dx) < r.r + TOL) {
        this.loseRockHp(r, dps * dt);
        r.flash = 1;
        if (this.frame % 3 === 0) this.burst(r.x, r.y, 1, ICE);
        if (r.hp <= 0) this.breakRock(i, dx * 120, dy * 120);
      }
    }
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      const rx = d.x - p.x,
        ry = d.y - p.y;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(rx * dy - ry * dx) < d.r + TOL) this.damageDrone(i, dps * dt, false, true);
    }
    if (this.boss) {
      const bo = this.boss;
      const rx = bo.x - p.x,
        ry = bo.y - p.y;
      const t = rx * dx + ry * dy;
      if (t > 0 && t < range && Math.abs(rx * dy - ry * dx) < bo.r + TOL) {
        this.loseBossHp(bo, dps * dt);
        bo.flash = 1;
        if (this.frame % 3 === 0) this.burst(bo.x - dx * bo.r, bo.y, 2, ICE);
        if (bo.hp <= 0) this.killBoss();
      }
      if (bo.hole) {
        const h = bo.hole;
        const hx = h.x - p.x,
          hy = h.y - p.y;
        const ht = hx * dx + hy * dy;
        if (ht > 0 && ht < range && Math.abs(hx * dy - hy * dx) < h.r + TOL) {
          this.damageHole(dps * dt, false);
          if (this.frame % 3 === 0) this.burst(h.x - dx * h.r, h.y - dy * h.r, 2, ICE);
        }
      }
    }
  }

  /**
   * Chain lightning from an origin. Shared by the player (origin = ship nose,
   * facing cone applied) and the salvage drone (origin = drone, no cone —
   * a turret picks whatever is in reach).
   *
   * Returns true if it found a target and discharged.
   */
  arcFrom(
    ox: number,
    oy: number,
    s: { range: number; chains: number; dmg: number },
    opts: { facing?: number; cone?: number; scale?: number } = {},
  ): boolean {
    const all = this.hostiles().filter(
      (hz) => !(this.rocks.find((r) => r.id === hz.id)?.trait === "meteor"),
    );
    let first: Hostile | undefined;
    let bd = s.range;
    for (const hz of all) {
      const d = Math.hypot(hz.x - ox, hz.y - oy) - hz.r;
      if (d > bd) continue;
      if (opts.facing != null) {
        const ang = Math.atan2(hz.y - oy, hz.x - ox);
        if (Math.abs(wrapAngle(ang - opts.facing)) > (opts.cone ?? 1.05)) continue;
      }
      bd = d;
      first = hz;
    }
    if (!first) return false;
    this.sound.play("arc");
    const hit = new Set<number>();
    let cx = ox,
      cy = oy;
    let cur: Hostile | undefined = first;
    let n = 0;
    const dmg = s.dmg * (opts.scale ?? 1);
    while (cur && n <= s.chains) {
      this.arcs.push({ x1: cx, y1: cy, x2: cur.x, y2: cur.y, life: 0.14 });
      hit.add(cur.id);
      cx = cur.x;
      cy = cur.y;
      this.arcDamage(cur.id, dmg);
      n++;
      let next: Hostile | undefined;
      let nd = 200;
      for (const hz of all) {
        if (hit.has(hz.id)) continue;
        const d = Math.hypot(hz.x - cx, hz.y - cy) - hz.r;
        if (d < nd) {
          nd = d;
          next = hz;
        }
      }
      cur = next;
    }
    return true;
  }

  doArc(s: { range: number; chains: number; dmg: number }) {
    const p = this.p;
    // The old cone was measured off the raw ship heading. With aim assist and a
    // 60° half-cone, a target sitting just outside the cone made the weapon
    // appear to "not shoot" even though the trigger was held. Use the assisted
    // heading and a generous 100° half-cone so the arc reliably discharges.
    const facing = this.assistAngle(p.angle);
    this.arcFrom(p.x + Math.cos(facing) * 20, p.y + Math.sin(facing) * 20, s, {
      facing,
      cone: 1.75,
    });
  }

  arcDamage(id: number, dmg: number) {
    const crit = this.random() < this.p.crit;
    const real = dmg * (crit ? this.p.critMult : 1);
    if (this.boss) {
      if (this.boss.id === id) {
        this.damageBoss(real, crit);
        this.addMissileCharge(GAME_CONFIG.salvo.bossHitCharge);
        return;
      }
      if (this.boss.hole && this.boss.hole.id === id) {
        this.damageHole(real, crit);
        return;
      }
    }
    const ri = this.rocks.findIndex((r) => r.id === id);
    if (ri >= 0) {
      this.hitRock(ri, real, 0, 0, crit);
      return;
    }
    const di = this.drones.findIndex((d) => d.id === id);
    if (di >= 0) this.damageDrone(di, real, crit);
    if (this.p.leech > 0) this.p.hull = Math.min(this.p.maxHull, this.p.hull + real * this.p.leech);
  }

  /* ------------------------------------------------------------ salvo lock */

  /** How many locks one target can carry: big rocks 2, bosses unlimited, everything else 1. */
  lockCapacity(t: Hostile): number {
    if (this.boss && (t.id === this.boss.id || t.id === this.boss.hole?.id)) return Infinity;
    const rock = this.rocks.find((r) => r.id === t.id);
    if (rock) return rock.size === 3 ? GAME_CONFIG.salvo.largeRockLocks : 1;
    return 1;
  }

  /** Is the target inside the bound pilot's lock cone? */
  inLockCone(t: Hostile): boolean {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d - t.r > cfg.coneRange * (p.rangeMul ?? 1)) return false;
    // A big target counts once its rim crosses the cone edge, not only its centre.
    const rim = d > t.r ? Math.asin(clamp(t.r / d, 0, 1)) * 0.5 : Math.PI;
    return (
      Math.abs(wrapAngle(Math.atan2(t.y - p.y, t.x - p.x) - p.angle)) <= cfg.coneHalfAngle + rim
    );
  }

  /** The next target to paint: fewest existing locks first, then the closest. */
  pickLockTarget(): Hostile | undefined {
    const p = this.p;
    let best: Hostile | undefined;
    let bestScore = Infinity;
    for (const t of this.hostiles()) {
      const held = p.missileLocks.filter((id) => id === t.id).length;
      if (held >= this.lockCapacity(t) || !this.inLockCone(t)) continue;
      const score = held * 10000 + Math.hypot(t.x - p.x, t.y - p.y) - t.r;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  /** Called every pilot update with whether E is currently down. */
  updateMissileLock(dt: number, key: boolean) {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const playing = this.mode === "playing";
    if (key && !p.missileHeld && playing) {
      p.missileHoldT = 0;
      p.missileLocks = [];
      p.missileLockT = cfg.lockInterval;
      p.fullLockAt = -1;
    }
    p.missileHeld = key;
    if (p.missileHoldT < 0) return;
    if (!playing) {
      this.clearMissileLock();
      return;
    }
    // Locks on dead targets drop; the rack (plus any Return Fire locks) is the ceiling.
    const rack = this.lockCeiling();
    p.missileLocks = p.missileLocks.filter((id) => this.findTarget(id)).slice(0, rack);
    if (key) {
      p.missileHoldT += dt;
      p.missileLockT -= dt;
      if (p.missileLockT <= 0 && p.missileLocks.length < rack) {
        const t = this.pickLockTarget();
        if (t) {
          p.missileLocks.push(t.id);
          p.missileLockT += cfg.lockInterval;
          if (p.missileLockT <= 0) p.missileLockT = cfg.lockInterval;
          this.sound.play("lock");
        } else p.missileLockT = 0;
      }
      const full = rack > 0 && p.missileLocks.length >= rack;
      if (full && p.fullLockAt < 0) {
        p.fullLockAt = p.missileHoldT;
        this.sound.play("fullLock");
      } else if (!full) p.fullLockAt = -1;
      return;
    }
    // released
    const held = p.missileHoldT;
    const locks = p.missileLocks.slice();
    const fullLock =
      locks.length > 0 && p.fullLockAt >= 0 && held - p.fullLockAt <= cfg.fullLockWindow;
    this.clearMissileLock();
    const tap = held < cfg.tapWindow && locks.length <= 1;
    // Delayed Detonator (III): a tap sets off every stuck charge early instead of firing
    if (tap && this.detonateStuckCharges()) return;
    if (this.lockCeiling() <= 0 || p.missileTimer > 0) return;
    if ((tap || locks.length === 0) && p.missiles > 0) this.fireMissile();
    else if (locks.length) this.releaseSalvo(locks, fullLock);
  }

  /** Locks a salvo may hold: missiles in the rack plus Boomerang Return Fire bonus locks. */
  lockCeiling() {
    return this.p.missiles + (this.p.bonusLocks ?? 0);
  }

  clearMissileLock() {
    const p = this.p;
    p.missileHoldT = -1;
    p.missileLocks = [];
    p.missileLockT = 0;
    p.fullLockAt = -1;
  }

  /** Add a fraction of one missile's charge; overflow carries into the next slot. */
  addMissileCharge(fraction: number) {
    const p = this.p;
    if (p.missiles >= p.maxMissiles || !(fraction > 0)) return;
    p.missileCharge += fraction * p.missileRegen;
    while (p.missileCharge >= p.missileRegen && p.missiles < p.maxMissiles) {
      p.missileCharge -= p.missileRegen;
      p.missiles++;
      this.sound.play("pickup");
      this.floatText(p.x, p.y - 34, "MISSILE READY", this.pilotAccent(), 12);
    }
    if (p.missiles >= p.maxMissiles) p.missileCharge = 0;
  }

  /** Graze: an obstacle that enters the band around the ship and leaves without a hit. */
  checkGraze(obj: { grazeArm?: number; grazed?: number }, distance: number, radius: number) {
    const bit = this.specialPilotId() === "p2" ? 2 : 1;
    if ((obj.grazed ?? 0) & bit) return;
    const cfg = GAME_CONFIG.salvo;
    if (distance < radius + cfg.grazeShipRadius + cfg.grazeMargin) {
      obj.grazeArm = (obj.grazeArm ?? 0) | bit;
      return;
    }
    if (!((obj.grazeArm ?? 0) & bit)) return;
    obj.grazed = (obj.grazed ?? 0) | bit;
    if (this.p.hull <= 0) return;
    this.addMissileCharge(cfg.grazeCharge);
    this.sound.play("graze");
    this.floatText(this.p.x, this.p.y + 30, "GRAZE", this.pilotAccent(), 10);
  }

  /** A collision spends the graze: the obstacle hit the pilot, so it never pays out. */
  spendGraze(obj: { grazed?: number }) {
    obj.grazed = (obj.grazed ?? 0) | (this.specialPilotId() === "p2" ? 2 : 1);
  }

  /** The value for a part at a tier from a [I, II, III] table. */
  tierValue<T>(table: readonly T[], tier: WarheadTier | undefined): T {
    return table[Math.min(table.length, Math.max(1, tier ?? 1)) - 1];
  }

  /** Spawn one missile with the pilot's fitted warhead (or an explicit one for follow-ups). */
  launchMissile(opts: {
    angle: number;
    target?: number;
    phase?: number;
    flight?: number;
    fullLock?: boolean;
    speedMul?: number;
    dmgMul?: number;
    offset?: number;
    /** spawn point for follow-ups (Relay hops, Chain minis); defaults to the ship */
    x?: number;
    y?: number;
    /** absolute payload damage / radius for follow-ups */
    dmg?: number;
    radius?: number;
    warhead?: MissileBuild;
    tiers?: BuildTiers;
    mini?: boolean;
    chainDepth?: number;
    hops?: number;
    relayTargets?: number[];
    orbitAngle?: number;
    salvo?: number;
  }) {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const W = GAME_CONFIG.warheads;
    const forge = this.forgeOf();
    const build = normalizeMissileBuild(opts.warhead ?? buildOf(forge));
    const tiers: BuildTiers = { ...(opts.tiers ?? tiersOf(forge)) };
    const followUp = opts.x !== undefined;
    const guidanceSpeed =
      build.guidance === "corkscrew"
        ? this.tierValue(W.corkscrew.speedMultiplier, tiers.guidance)
        : build.guidance === "direct"
          ? this.tierValue(W.direct.speedMultiplier, tiers.guidance)
          : 1;
    const speed =
      (opts.mini ? W.chain.speed : cfg.launchSpeed) * (opts.speedMul ?? 1) * guidanceSpeed;
    // Blast's own tiers raise the warhead's base damage and radius
    const blastDmgMul =
      build.payload === "blast"
        ? this.tierValue(W.blast.damage, tiers.payload) / W.blast.damage[0]
        : 1;
    const blastRMul =
      build.payload === "blast"
        ? this.tierValue(W.blast.radius, tiers.payload) / W.blast.radius[0]
        : 1;
    const o = opts.offset ?? 0;
    const ox = opts.x ?? p.x,
      oy = opts.y ?? p.y;
    const missile: Bullet = {
      x: ox + Math.cos(opts.angle) * o,
      y: oy + Math.sin(opts.angle) * o,
      vx: Math.cos(opts.angle) * speed,
      vy: Math.sin(opts.angle) * speed,
      r: opts.mini ? 5 : 7,
      life: (opts.mini ? 2.5 : 4.5) * (p.rangeMul ?? 1),
      dmg: 0,
      kind: "missile",
      pierce: 0,
      // co-op keeps pilot identity on the airframe; solo wears the payload's colour
      color: this.cooperative ? this.pilotAccent() : WARHEAD_PARTS[build.payload].color,
      hitIds: new Set(),
      target: opts.target,
      turn: cfg.turn,
      bounces: 0,
      fuse: 0,
      extra: 0,
      extraDmg: 0,
      missileDmg: opts.dmg ?? p.blastDmg * blastDmgMul * (opts.dmgMul ?? 1),
      missileR: opts.radius ?? p.blastR * blastRMul,
      warhead: build,
      tiers,
    };
    if (opts.salvo !== undefined) missile.salvo = opts.salvo;
    if (opts.mini) missile.mini = true;
    if (opts.chainDepth) missile.chainDepth = opts.chainDepth;
    if (opts.hops) missile.hops = opts.hops;
    if (opts.relayTargets?.length) missile.relayTargets = opts.relayTargets.slice();
    if (build.guidance === "boomerang")
      missile.boomerang = {
        relocks: this.tierValue(W.boomerang.relocks, tiers.guidance),
        returning: false,
      };
    if (build.guidance === "direct" && tiers.guidance >= 3)
      missile.turn = cfg.turn * W.direct.leadTurnMultiplier;
    const amp =
      build.guidance === "corkscrew"
        ? this.tierValue(W.corkscrew.spiralMultiplier, tiers.guidance)
        : 1;
    if (build.guidance === "orbit" && !followUp) {
      missile.orbit = {
        t: this.tierValue(W.orbit.duration, tiers.guidance),
        angle: opts.orbitAngle ?? opts.angle,
        blocks: this.tierValue(W.orbit.blocks, tiers.guidance),
      };
    } else if (opts.phase !== undefined || (build.guidance === "corkscrew" && !opts.mini)) {
      const phase = opts.phase ?? 0;
      const t = opts.target != null ? this.findTarget(opts.target) : undefined;
      const flight = Math.max(
        cfg.spiralMinFlight,
        opts.flight ?? (t ? Math.hypot(t.x - ox, t.y - oy) / speed + 0.25 : 1),
      );
      missile.spiral = {
        phase,
        flight,
        age: 0,
        offset: Math.sin(phase) * cfg.spiralAmplitude * amp,
        amp,
      };
    }
    if (opts.fullLock) missile.fullLock = true;
    this.addBullet(missile);
    return missile;
  }

  /** Release: one missile per lock, launched broadside and alternating sides. */
  releaseSalvo(locks: number[], fullLock: boolean) {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const n = Math.min(locks.length, this.lockCeiling());
    const speedMul = fullLock ? cfg.fullLockSpeedMultiplier : 1;
    const salvo = ++this.salvoSeq;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const t = this.findTarget(locks[i]);
      const speed = cfg.launchSpeed * speedMul;
      const flight = t ? Math.hypot(t.x - p.x, t.y - p.y) / speed + 0.25 : 1;
      this.launchMissile({
        angle: p.angle + (side * Math.PI) / 2,
        target: locks[i],
        // pairs leave together; each pair's corkscrew is a quarter turn behind the last
        phase: (side > 0 ? 0 : Math.PI) + Math.floor(i / 2) * (Math.PI / 2),
        flight,
        fullLock,
        speedMul,
        dmgMul: fullLock ? cfg.fullLockDamageMultiplier : 1,
        // later pairs launch a little further out so they never stack on the first pair
        offset: 10 + Math.floor(i / 2) * 9,
        relayTargets: locks,
        // Orbit guidance spreads the salvo evenly around the ship
        orbitAngle: p.angle + (i / n) * TAU,
        salvo,
      });
    }
    // the rack pays first; Return Fire bonus locks cover the rest for free
    const fromRack = Math.min(n, p.missiles);
    p.missiles -= fromRack;
    p.bonusLocks = Math.max(0, (p.bonusLocks ?? 0) - (n - fromRack));
    p.missileTimer = cfg.releaseCooldown;
    this.shake += 3 + n * 1.5;
    this.sound.play("missile");
    if (fullLock) {
      this.salvoFlash = Math.max(this.salvoFlash, 0.55);
      this.floatText(p.x, p.y - 40, "FULL LOCK", "#ffffff", 14);
      this.rings.push({ x: p.x, y: p.y, r: 18, max: 90, life: 0.35, color: "#ffffff", w: 2 });
      // Siphon Feedback (III): a Full Lock salvo refunds one whole missile
      const trigger = this.forgeOf().fitted.trigger;
      if (trigger.id === "siphon" && trigger.tier >= 3) {
        this.addMissileCharge(1);
        this.floatText(p.x, p.y + 34, "FEEDBACK", WARHEAD_PARTS.siphon.color, 11);
      }
    }
  }

  /** Tap: one missile at the nearest target, launched along the nose as before. */
  fireMissile() {
    const p = this.p;
    p.missiles--;
    p.missileTimer = GAME_CONFIG.salvo.releaseCooldown;
    const lock = this.nearestTarget(p.x, p.y, 900 * (p.rangeMul ?? 1));
    const a = lock ? Math.atan2(lock.y - p.y, lock.x - p.x) : this.assistAngle(p.angle);
    // launch along the ship's nose but bend hard toward the lock straight away
    const la = p.angle + clamp(wrapAngle(a - p.angle), -0.6, 0.6);
    this.launchMissile({ angle: la, target: lock?.id, salvo: ++this.salvoSeq });
    this.shake += 4;
    this.sound.play("missile");
  }

  /** Delayed Detonator (III): set off this pilot's stuck charges at 2×. True if any went off. */
  detonateStuckCharges(): boolean {
    const trigger = this.forgeOf().fitted.trigger;
    if (trigger.id !== "delayed" || trigger.tier < 3) return false;
    const me = this.specialPilotId();
    let any = false;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.kind !== "missile" || !b.stuck) continue;
      if (this.cooperative && (b.ownerId ?? "p1") !== me) continue;
      b.missileDmg =
        (b.missileDmg ?? this.p.blastDmg) * GAME_CONFIG.warheads.delayed.detonatorMultiplier;
      this.warheadCredit = b.warhead ?? null;
      this.detonateMissile(b);
      this.warheadCredit = null;
      this.bullets.splice(this.bullets.indexOf(b), 1);
      any = true;
    }
    if (any) this.floatText(this.p.x, this.p.y - 36, "DETONATE", WARHEAD_PARTS.delayed.color, 12);
    return any;
  }

  /** Corkscrew: a decaying sine offset perpendicular to the guided velocity. */
  spiralMissile(b: Bullet, dt: number) {
    const s = b.spiral;
    if (!s) return;
    const cfg = GAME_CONFIG.salvo;
    s.age += dt;
    const t = clamp(s.age / s.flight, 0, 1);
    const offset =
      Math.sin(t * cfg.spiralFrequency + s.phase) * cfg.spiralAmplitude * (s.amp ?? 1) * (1 - t);
    const delta = offset - s.offset;
    s.offset = offset;
    const spd = Math.hypot(b.vx, b.vy) || 1;
    b.x += (-b.vy / spd) * delta;
    b.y += (b.vx / spd) * delta;
  }

  /**
   * A missile touched a hostile. Delayed triggers stick and start their fuse;
   * everything else detonates. Returns true when the missile is consumed.
   */
  missileContact(b: Bullet, id: number): boolean {
    if (b.warhead?.trigger === "delayed" && !b.stuck) {
      const t = this.findTarget(id);
      if (t) {
        b.stuck = {
          id,
          dx: b.x - t.x,
          dy: b.y - t.y,
          t: this.tierValue(GAME_CONFIG.warheads.delayed.fuse, b.tiers?.trigger),
        };
        b.target = id;
        this.sound.play("lock");
        this.rings.push({ x: b.x, y: b.y, r: 4, max: 22, life: 0.25, color: b.color, w: 2 });
        return false;
      }
    }
    this.detonateMissile(b);
    return true;
  }

  /** Orbit guidance: circle the owner, eat enemy shots, then break off and strike. */
  orbitMissile(b: Bullet, dt: number) {
    const o = b.orbit!;
    const W = GAME_CONFIG.warheads.orbit;
    const p = this.p;
    o.t -= dt;
    o.angle += W.angularSpeed * dt;
    b.x = p.x + Math.cos(o.angle) * W.radius;
    b.y = p.y + Math.sin(o.angle) * W.radius;
    const spd = GAME_CONFIG.salvo.launchSpeed;
    b.vx = -Math.sin(o.angle) * spd;
    b.vy = Math.cos(o.angle) * spd;
    if (o.blocks > 0) {
      for (const s of this.bullets) {
        if ((s.kind !== "enemy" && s.kind !== "wardenShard") || s.life <= 0) continue;
        if (Math.hypot(s.x - b.x, s.y - b.y) > s.r + b.r + 6) continue;
        s.life = 0;
        o.blocks--;
        this.rings.push({ x: s.x, y: s.y, r: 3, max: 26, life: 0.25, color: b.color, w: 2 });
        this.burst(s.x, s.y, 6, "#ffffff");
        this.sound.play("hit");
        if (o.blocks <= 0) break;
      }
    }
    // Halo (III): the orbiting ring grinds any rock it touches
    if ((b.tiers?.guidance ?? 1) >= 3) {
      for (const r of [...this.rocks])
        if (Math.hypot(r.x - b.x, r.y - b.y) < r.r + b.r) this.zoneDamage(r.id, W.haloDps * dt);
    }
    if (o.t > 0 && p.hull > 0) return;
    delete b.orbit;
    let t = b.target != null ? this.findTarget(b.target) : undefined;
    t ??= this.nearestTarget(b.x, b.y, 900 * (p.rangeMul ?? 1));
    const a = t ? Math.atan2(t.y - b.y, t.x - b.x) : o.angle;
    b.target = t?.id;
    b.vx = Math.cos(a) * spd;
    b.vy = Math.sin(a) * spd;
    b.life = Math.max(b.life, 3);
  }

  /**
   * Boomerang guidance: a lost target spends a re-lock on the nearest hostile;
   * with none left the missile turns for home. Returns true when it was caught.
   */
  boomerangMissile(b: Bullet): boolean {
    const bm = b.boomerang!;
    const W = GAME_CONFIG.warheads.boomerang;
    const p = this.p;
    if (!bm.returning) {
      if (b.target != null && this.findTarget(b.target)) return false;
      const next = this.nearestTarget(b.x, b.y, 900 * (p.rangeMul ?? 1));
      if (bm.relocks > 0 && next) {
        bm.relocks--;
        b.target = next.id;
        this.rings.push({
          x: b.x,
          y: b.y,
          r: 3,
          max: 18,
          life: 0.2,
          color: WARHEAD_PARTS.boomerang.color,
          w: 1.5,
        });
        return false;
      }
      bm.returning = true;
      b.target = undefined;
      b.life = Math.max(b.life, W.returnLife);
    }
    // fly home
    const spd = Math.hypot(b.vx, b.vy) || GAME_CONFIG.salvo.launchSpeed;
    const desired = Math.atan2(p.y - b.y, p.x - b.x);
    const cur = Math.atan2(b.vy, b.vx);
    const na =
      cur + clamp(wrapAngle(desired - cur), -b.turn * 1.4 * (1 / 60), b.turn * 1.4 * (1 / 60));
    b.vx = Math.cos(na) * spd;
    b.vy = Math.sin(na) * spd;
    if (p.hull <= 0 || Math.hypot(p.x - b.x, p.y - b.y) > W.catchRadius) return false;
    // caught unused: refund part of a missile, and Return Fire banks an extra lock
    const tier = b.tiers?.guidance ?? 1;
    this.addMissileCharge(this.tierValue(W.refund, tier));
    if (tier >= 3) p.bonusLocks = (p.bonusLocks ?? 0) + 1;
    this.floatText(
      p.x,
      p.y - 30,
      tier >= 3 ? "CAUGHT · +1 LOCK" : "CAUGHT",
      WARHEAD_PARTS.boomerang.color,
      11,
    );
    this.rings.push({
      x: p.x,
      y: p.y,
      r: 10,
      max: 40,
      life: 0.3,
      color: WARHEAD_PARTS.boomerang.color,
      w: 2,
    });
    this.sound.play("pickup");
    return true;
  }

  /** Lead (Direct III): aim at the true intercept point of a moving target. */
  interceptAngle(b: Bullet, t: Hostile): number {
    const dx = t.x - b.x,
      dy = t.y - b.y;
    const s = Math.hypot(b.vx, b.vy) || 1;
    const a = t.vx * t.vx + t.vy * t.vy - s * s;
    const bq = 2 * (dx * t.vx + dy * t.vy);
    const c = dx * dx + dy * dy;
    let time = 0;
    if (Math.abs(a) < 1e-6) time = bq !== 0 ? -c / bq : 0;
    else {
      const disc = bq * bq - 4 * a * c;
      if (disc >= 0) {
        const r1 = (-bq - Math.sqrt(disc)) / (2 * a),
          r2 = (-bq + Math.sqrt(disc)) / (2 * a);
        time = Math.min(...[r1, r2].filter((v) => v > 0), 3);
      }
    }
    time = clamp(Number.isFinite(time) ? time : 0, 0, 3);
    return Math.atan2(dy + t.vy * time, dx + t.vx * time);
  }

  /** A missile out of fuel gets one more go: Boomerang re-locks or flies home, Itano loops back. */
  missileSecondChance(b: Bullet): boolean {
    const W = GAME_CONFIG.warheads;
    const p = this.p;
    if (b.boomerang) {
      const bm = b.boomerang;
      if (bm.returning) return false;
      const next = this.nearestTarget(b.x, b.y, 900 * (p.rangeMul ?? 1));
      if (bm.relocks > 0 && next) {
        bm.relocks--;
        b.target = next.id;
        b.life = 1.6;
        return true;
      }
      bm.returning = true;
      b.target = undefined;
      b.life = W.boomerang.returnLife;
      return true;
    }
    if (
      b.warhead?.guidance === "corkscrew" &&
      (b.tiers?.guidance ?? 1) >= 3 &&
      !b.itano &&
      !b.mini
    ) {
      b.itano = true;
      b.life = 1.6;
      if (b.target == null || !this.findTarget(b.target))
        b.target = this.nearestTarget(b.x, b.y, 900 * (p.rangeMul ?? 1))?.id;
      const amp = this.tierValue(W.corkscrew.spiralMultiplier, b.tiers?.guidance);
      b.spiral = {
        phase: Math.PI / 2,
        flight: 1.2,
        age: 0,
        offset: GAME_CONFIG.salvo.spiralAmplitude * amp,
        amp,
      };
      this.floatText(b.x, b.y - 14, "ITANO", WARHEAD_PARTS.corkscrew.color, 10);
      return true;
    }
    return false;
  }

  /** Proximity trigger: is any hostile within the early-detonation distance? */
  missileProximity(b: Bullet): boolean {
    const reach = GAME_CONFIG.warheads.proximity.distance + b.r;
    for (const t of this.hostiles())
      if (Math.hypot(t.x - b.x, t.y - b.y) - t.r <= reach) return true;
    return false;
  }

  /** Every missile detonation goes through here: Crossfire, payload, then Relay / Chain. */
  detonateMissile(b: Bullet) {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const W = GAME_CONFIG.warheads;
    const build = b.warhead ?? DEFAULT_MISSILE_BUILD;
    const tiers = b.tiers ?? { payload: 1, guidance: 1, trigger: 1 };
    const baseDmg = b.missileDmg ?? p.blastDmg;
    let dmg = baseDmg;
    let radius = b.missileR ?? p.blastR;
    if (build.trigger === "proximity")
      radius *= this.tierValue(W.proximity.radiusMultiplier, tiers.trigger);
    if (build.trigger === "impact") dmg *= this.tierValue(W.impact.damageMultiplier, tiers.trigger);
    let crossfire = false;
    if (this.cooperative && b.target != null) {
      const owner = b.ownerId ?? this.specialPilotId();
      const t = this.findTarget(b.target);
      if (t && Math.hypot(t.x - b.x, t.y - b.y) < radius + t.r) {
        const mark = this.missileMarks[b.target];
        if (mark && mark.owner !== owner && this.missileClock - mark.at <= cfg.crossfireWindow) {
          crossfire = true;
          dmg *= cfg.crossfireDamageMultiplier;
          this.crossfireBonus();
          this.floatText(b.x, b.y - 24, "CROSSFIRE", "#ffffff", 14);
        }
        this.missileMarks[b.target] = { owner, at: this.missileClock };
      }
      for (const id of Object.keys(this.missileMarks))
        if (this.missileClock - this.missileMarks[+id].at > cfg.crossfireWindow)
          delete this.missileMarks[+id];
    }
    const previousCredit = this.warheadCredit;
    this.warheadCredit = build;
    this.warheadCreditTiers = tiers;
    const targetAlive = b.target != null && !!this.findTarget(b.target);
    // Siphon counts every hostile the blast reaches, before the payload changes the field
    const touched =
      build.trigger === "siphon"
        ? this.hostiles().filter((t) => Math.hypot(t.x - b.x, t.y - b.y) < radius + t.r).length
        : 0;
    // Breach (Impact III): +40% against boss hulls
    this.blastBossMul =
      build.trigger === "impact" && tiers.trigger >= 3 ? W.impact.breachMultiplier : 1;
    this.applyPayload(b, build, tiers, dmg, radius, crossfire);
    this.blastBossMul = 1;

    if (touched) this.siphonRefund(b, touched, tiers.trigger);
    // Airburst (Proximity III): the blast deletes enemy shots in range
    if (build.trigger === "proximity" && tiers.trigger >= 3) {
      for (const s of this.bullets)
        if (
          (s.kind === "enemy" || s.kind === "wardenShard") &&
          Math.hypot(s.x - b.x, s.y - b.y) < radius
        )
          s.life = 0;
      this.rings.push({
        x: b.x,
        y: b.y,
        r: radius * 0.9,
        max: radius * 1.05,
        life: 0.25,
        color: WARHEAD_PARTS.proximity.color,
        w: 1.5,
      });
    }

    // Relay: a kill by this blast sends the warhead on to another of the salvo's locks
    if (
      build.guidance === "relay" &&
      targetAlive &&
      !this.findTarget(b.target!) &&
      (b.hops ?? 0) < this.tierValue(W.relay.hops, tiers.guidance)
    ) {
      const next =
        (b.relayTargets ?? [])
          .filter((id) => id !== b.target)
          .map((id) => this.findTarget(id))
          .find((t) => t) ?? this.nearestTarget(b.x, b.y, W.relay.searchRange * (p.rangeMul ?? 1));
      if (next) {
        this.arcs.push({ x1: b.x, y1: b.y, x2: next.x, y2: next.y, life: 0.18 });
        this.launchMissile({
          angle: Math.atan2(next.y - b.y, next.x - b.x),
          x: b.x,
          y: b.y,
          target: next.id,
          // Chainbreaker (III): each hop gains instead of losing damage
          dmg: baseDmg * this.tierValue(W.relay.damageMultiplier, tiers.guidance),
          radius: b.missileR,
          warhead: build,
          tiers,
          hops: (b.hops ?? 0) + 1,
          relayTargets: b.relayTargets,
          mini: b.mini,
          chainDepth: b.chainDepth,
          fullLock: b.fullLock,
          salvo: b.salvo,
        });
        this.floatText(b.x, b.y - 20, "RELAY", WARHEAD_PARTS.relay.color, 11);
      }
    }

    // Chain: every full-size blast launches one mini missile; Cascade lets minis chain once more
    if (build.trigger === "chain" && (!b.mini || (b.chainDepth ?? 0) > 0)) {
      let best: Hostile | undefined;
      let bd = 900 * (p.rangeMul ?? 1);
      for (const t of this.hostiles()) {
        if (t.id === b.target) continue;
        const d = Math.hypot(t.x - b.x, t.y - b.y) - t.r;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      this.launchMissile({
        angle: best ? Math.atan2(best.y - b.y, best.x - b.x) : this.random() * TAU,
        x: b.x,
        y: b.y,
        offset: 6,
        target: best?.id,
        dmg: baseDmg * this.tierValue(W.chain.damageMultiplier, tiers.trigger),
        radius: (b.missileR ?? p.blastR) * W.chain.radiusMultiplier,
        warhead: build,
        tiers,
        mini: true,
        chainDepth: b.mini
          ? (b.chainDepth ?? 0) - 1
          : tiers.trigger >= 3
            ? W.chain.cascadeDepth
            : 0,
        salvo: b.salvo,
      });
    }
    this.warheadCredit = previousCredit;
  }

  /** Siphon: each hostile hit refunds charge, never more than one missile per salvo. */
  siphonRefund(b: Bullet, hits: number, tier: WarheadTier) {
    const W = GAME_CONFIG.warheads.siphon;
    const key = b.salvo ?? -1;
    const used = this.siphonSalvos[key] ?? 0;
    const amount = Math.min(W.salvoCap - used, hits * this.tierValue(W.refund, tier));
    if (amount <= 0) return;
    this.siphonSalvos[key] = used + amount;
    this.addMissileCharge(amount);
    this.siphonTotal += amount;
    this.particles.push({
      x: b.x,
      y: b.y,
      vx: (this.p.x - b.x) * 2,
      vy: (this.p.y - b.y) * 2,
      life: 0.45,
      max: 0.45,
      size: 3,
      color: WARHEAD_PARTS.siphon.color,
      drag: 0.98,
    });
  }

  /** The payload decides what a detonation actually does. */
  applyPayload(
    b: Bullet,
    build: MissileBuild,
    tiers: BuildTiers,
    dmg: number,
    radius: number,
    crossfire: boolean,
  ) {
    const p = this.p;
    const W = GAME_CONFIG.warheads;
    const t = tiers.payload;
    const perk = t >= 3;
    const color = WARHEAD_PARTS[build.payload].color;
    const style = { color: b.color, fullLock: b.fullLock, crossfire, payload: build.payload };
    // control and damage values scale with the shot's power (Full Lock, Relay, Chain, Delayed)
    const baseDmg =
      build.payload === "blast"
        ? p.blastDmg * (this.tierValue(W.blast.damage, t) / W.blast.damage[0])
        : p.blastDmg;
    const power = dmg / (baseDmg || GAME_CONFIG.player.blastDamage);
    const reach = radius / (p.blastR || GAME_CONFIG.player.blastRadius);
    const control = b.mini ? W.miniControlDuration : 1;
    const x = b.x,
      y = b.y;
    const hostilesIn = (r: number) =>
      this.hostiles().filter((h) => Math.hypot(h.x - x, h.y - y) <= r + h.r);
    switch (build.payload) {
      case "blast":
        this.explode(x, y, radius, dmg, "Missile blast", undefined, style);
        // Aftershock (III): a second blast 0.4 s later at 40%
        if (perk)
          this.pendingBlasts.push({
            x,
            y,
            r: radius,
            dmg: dmg * W.blast.aftershockShare,
            t: W.blast.aftershockDelay,
            color: b.color,
            ownerId: b.ownerId,
            build,
            tiers,
          });
        return;
      case "cluster": {
        this.missileBlastFx(x, y, radius * 0.45, { ...style, small: true });
        this.sound.play("flak");
        const n = this.tierValue(W.cluster.bomblets, t);
        const sp = Math.hypot(b.vx, b.vy) || 1;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.rnd(-0.3, 0.3);
          const v = W.cluster.scatterSpeed * this.rnd(0.65, 1.1) * Math.sqrt(reach);
          // Carpet (III): bomblets keep rolling along the missile's path and go off in a line
          const carry = perk ? W.cluster.carpetCarry : 0.15;
          const scatter = perk ? 0.35 : 1;
          this.addBullet({
            x,
            y,
            vx: Math.cos(a) * v * scatter + b.vx * carry,
            vy: Math.sin(a) * v * scatter + b.vy * carry,
            r: 4,
            life: 1.8,
            dmg: 0,
            kind: "bomblet",
            pierce: 0,
            color,
            hitIds: new Set(),
            turn: 0,
            bounces: 0,
            fuse: perk
              ? W.cluster.fuseMin + (i / n) * (0.4 + 60 / sp)
              : this.rnd(W.cluster.fuseMin, W.cluster.fuseMax),
            extra: 0,
            extraDmg: this.tierValue(W.cluster.bombletDamage, t) * power,
            blastR: W.cluster.bombletRadius * reach,
            sourceWarhead: build,
          });
        }
        return;
      }
      case "gravity": {
        const dur = this.tierValue(W.gravity.duration, t) * control;
        const r = this.tierValue(W.gravity.radius, t) * reach;
        this.missileZones.push({
          kind: "gravity",
          x,
          y,
          r,
          life: dur,
          max: dur,
          dps: perk ? W.gravity.crushDps * power : 0,
          tick: W.incendiary.tick,
          ticksLeft: perk ? Math.round(dur / W.incendiary.tick) : 0,
          ownerId: b.ownerId,
          seed: this.random() * TAU,
          perk,
          build,
        });
        this.rings.push({ x, y, r, max: 6, life: 0.45, color, w: 3 });
        this.sound.play("bossCharge");
        return;
      }
      case "emp": {
        const r = W.emp.radius * reach;
        const duration = this.tierValue(W.emp.duration, t) * control;
        for (const d of this.drones) {
          if (Math.hypot(d.x - x, d.y - y) > r + d.r) continue;
          d.emp = Math.max(d.emp ?? 0, duration);
          if (perk) d.overload = true;
          delete d.supportShield;
        }
        for (let i = this.rocks.length - 1; i >= 0; i--) {
          const rock = this.rocks[i];
          if (Math.hypot(rock.x - x, rock.y - y) > r + rock.r) continue;
          if (rock.supportShield) delete rock.supportShield;
          // Tier II+: Warden mines fizzle out harmlessly
          if (t >= 2 && rock.coopMine) {
            this.rocks.splice(i, 1);
            this.burst(rock.x, rock.y, 8, color);
            this.floatText(rock.x, rock.y - 12, "FIZZLE", color, 10);
          }
        }
        this.missileBlastFx(x, y, r, { ...style, color });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + this.random();
          this.arcs.push({
            x1: x,
            y1: y,
            x2: x + Math.cos(a) * r,
            y2: y + Math.sin(a) * r,
            life: 0.16,
          });
        }
        this.sound.play("arc");
        return;
      }
      case "incendiary": {
        const dur = this.tierValue(W.incendiary.duration, t);
        this.missileZones.push({
          kind: "fire",
          x,
          y,
          r: radius,
          life: dur,
          max: dur,
          dps: this.tierValue(W.incendiary.dps, t) * power,
          // the first tick lands a quarter-second in: 20 dps over 2 s is 8 ticks of 5
          tick: W.incendiary.tick,
          ticksLeft: Math.round(dur / W.incendiary.tick),
          ownerId: b.ownerId,
          seed: this.random() * TAU,
          perk,
          build,
        });
        this.missileBlastFx(x, y, radius * 0.6, { ...style, color, small: true });
        this.sound.play("flak");
        return;
      }
      case "solarFlare": {
        const bonus = this.tierValue(W.solarFlare.bonus, t);
        const dur = this.tierValue(W.solarFlare.duration, t) * control;
        const silence = this.tierValue(W.solarFlare.sentinelSilence, t);
        for (const h of hostilesIn(radius)) {
          this.markSunburn(h.id, dur, bonus, perk);
          const d = silence > 0 ? this.drones.find((dr) => dr.id === h.id) : undefined;
          if (d && d.kind === "sentinel" && !d.coop) d.fire = Math.max(d.fire, silence);
        }
        this.missileBlastFx(x, y, radius, { ...style, color });
        this.rings.push({
          x,
          y,
          r: radius * 0.3,
          max: radius * 1.4,
          life: 0.55,
          color: "#fff4c2",
          w: 2,
        });
        this.sound.play("crit");
        return;
      }
      case "cryo": {
        const dur = this.tierValue(W.cryo.duration, t) * control;
        for (const r of this.rocks) {
          if (Math.hypot(r.x - x, r.y - y) > radius + r.r || r.trait === "meteor") continue;
          if (!((r.frozen ?? 0) > 0)) r.frozenV = { vx: r.vx, vy: r.vy };
          r.frozen = Math.max(r.frozen ?? 0, dur);
          r.vx = 0;
          r.vy = 0;
          r.permafrost = perk;
          r.cryo = {
            shards: this.tierValue(W.cryo.shards, t),
            dmg: this.tierValue(W.cryo.shardDamage, t) * power,
            build,
          };
        }
        for (const d of this.drones)
          if (Math.hypot(d.x - x, d.y - y) <= radius + d.r) d.frozen = Math.max(d.frozen ?? 0, dur);
        const bo = this.boss;
        if (bo && Math.hypot(bo.x - x, bo.y - y) <= radius + bo.r)
          bo.chill = Math.max(bo.chill ?? 0, dur);
        this.missileBlastFx(x, y, radius, { ...style, color });
        this.sound.play("ricochet");
        return;
      }
    }
  }

  /** Solar Flare: mark a target so every source deals bonus damage to it. */
  markSunburn(id: number, t: number, bonus: number, prominence: boolean) {
    const target: { sunburn?: Rock["sunburn"] } | undefined =
      this.boss?.id === id
        ? this.boss
        : (this.rocks.find((r) => r.id === id) ?? this.drones.find((d) => d.id === id));
    if (!target) return;
    const cur = target.sunburn;
    target.sunburn = {
      t: Math.max(t, cur?.t ?? 0),
      bonus: Math.max(bonus, cur?.bonus ?? 0),
      prominence: prominence || Boolean(cur?.prominence),
    };
  }

  /** Damage multiplier from Solar Flare sunburn (and EMP Overload on specialists). */
  markMultiplier(target: { sunburn?: Rock["sunburn"]; emp?: number; overload?: boolean }) {
    let mul = target.sunburn && target.sunburn.t > 0 ? 1 + target.sunburn.bonus : 1;
    if (target.overload && (target.emp ?? 0) > 0)
      mul *= GAME_CONFIG.warheads.emp.overloadMultiplier;
    return mul;
  }

  /** Prominence (Solar Flare III): a marked kill releases a mini flare that marks neighbours. */
  prominenceFlare(x: number, y: number, mark: NonNullable<Rock["sunburn"]>) {
    if (!mark.prominence || mark.t <= 0) return;
    const r = GAME_CONFIG.warheads.solarFlare.prominenceRadius;
    for (const h of this.hostiles())
      if (Math.hypot(h.x - x, h.y - y) <= r + h.r) this.markSunburn(h.id, mark.t, mark.bonus, true);
    this.rings.push({ x, y, r: 6, max: r, life: 0.4, color: WARHEAD_PARTS.solarFlare.color, w: 2 });
  }

  /** Cryo: a hit on a frozen rock shatters it into shards instead of splitting. */
  shatterRock(index: number) {
    const r = this.rocks[index];
    if (!r || !r.cryo) return;
    const { shards, dmg, build } = r.cryo;
    r.shatter = true;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * TAU + this.random() * 0.4;
      this.addBullet({
        x: r.x + Math.cos(a) * r.r * 0.6,
        y: r.y + Math.sin(a) * r.r * 0.6,
        vx: Math.cos(a) * GAME_CONFIG.warheads.cryo.shardSpeed,
        vy: Math.sin(a) * GAME_CONFIG.warheads.cryo.shardSpeed,
        r: 4,
        life: 0.6,
        dmg,
        kind: "shrap",
        pierce: 0,
        color: WARHEAD_PARTS.cryo.color,
        hitIds: new Set([r.id]),
        turn: 0,
        bounces: 0,
        fuse: 0,
        extra: 0,
        extraDmg: 0,
        sourceWarhead: build,
      });
    }
    this.rings.push({
      x: r.x,
      y: r.y,
      r: r.r * 0.6,
      max: r.r * 1.6,
      life: 0.3,
      color: WARHEAD_PARTS.cryo.color,
      w: 2,
    });
    this.sound.play("ricochet");
    r.hp = 0;
    this.breakRock(index, 0, 0);
  }

  /** Cluster bomblet: a small blast that cannot hurt the pilot. */
  detonateBomblet(b: Bullet) {
    const previous = this.warheadCredit;
    this.warheadCredit = b.sourceWarhead ?? previous;
    this.explode(b.x, b.y, b.blastR ?? 30, b.extraDmg, "Cluster bomblet", 0, {
      color: b.color,
      small: true,
    });
    this.warheadCredit = previous;
  }

  /** Aftershock blasts waiting to go off. */
  updatePendingBlasts(dt: number) {
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const pb = this.pendingBlasts[i];
      pb.t -= dt;
      if (pb.t > 0) continue;
      this.pendingBlasts.splice(i, 1);
      this.selectBulletPilot({ kind: "missile", ownerId: pb.ownerId } as Bullet);
      this.warheadCredit = pb.build;
      this.warheadCreditTiers = pb.tiers;
      this.explode(pb.x, pb.y, pb.r, pb.dmg, "Aftershock", 0, {
        color: pb.color,
        payload: "blast",
      });
      this.warheadCredit = null;
    }
  }

  /** Gravity wells pull small and medium rocks; Incendiary patches burn whatever stands in them. */
  updateMissileZones(dt: number) {
    const W = GAME_CONFIG.warheads;
    for (let i = this.missileZones.length - 1; i >= 0; i--) {
      const z = this.missileZones[i];
      z.life -= dt;
      this.selectBulletPilot({ kind: "missile", ownerId: z.ownerId } as Bullet);
      this.warheadCredit = z.build ?? null;
      if (z.kind === "gravity") {
        const pulled: Rock[] = [];
        for (const r of this.rocks) {
          if (r.size > W.gravity.maxRockSize || r.trait === "meteor") continue;
          const dx = z.x - r.x,
            dy = z.y - r.y;
          const d = Math.hypot(dx, dy);
          if (d > z.r + r.r) continue;
          pulled.push(r);
          if (d < 2) continue;
          const pull = W.gravity.pull * (0.35 + 0.65 * (1 - d / (z.r + r.r)));
          r.vx += (dx / d) * pull * dt;
          r.vy += (dy / d) * pull * dt;
          // damp the orbit so pulled rocks settle into the well instead of slingshotting
          const damp = Math.max(0, 1 - 2.2 * dt);
          r.vx *= damp;
          r.vy *= damp;
        }
        // Crush (III): pulled rocks take damage over time and grind against each other
        if (z.perk) {
          z.tick -= dt;
          while (z.tick <= 1e-6 && (z.ticksLeft ?? 0) > 0) {
            z.tick += W.incendiary.tick;
            z.ticksLeft = (z.ticksLeft ?? 1) - 1;
            const ids = pulled.map((r) => r.id);
            const contacts = new Set<number>();
            for (let a = 0; a < pulled.length; a++)
              for (let c = a + 1; c < pulled.length; c++) {
                const ra = pulled[a],
                  rc = pulled[c];
                if (Math.hypot(ra.x - rc.x, ra.y - rc.y) < ra.r + rc.r) {
                  contacts.add(ra.id);
                  contacts.add(rc.id);
                }
              }
            for (const id of ids) {
              const extra = contacts.has(id) ? W.gravity.crushContactDamage : 0;
              this.zoneDamage(id, z.dps * W.incendiary.tick + extra);
            }
          }
        }
      } else {
        z.tick -= dt;
        while (z.tick <= 1e-6 && (z.ticksLeft ?? 0) > 0) {
          z.tick += W.incendiary.tick;
          z.ticksLeft = (z.ticksLeft ?? 1) - 1;
          const amount = z.dps * W.incendiary.tick;
          for (const t of this.hostiles())
            if (Math.hypot(t.x - z.x, t.y - z.y) <= z.r + t.r) this.zoneDamage(t.id, amount);
          if (z.perk) this.spreadWildfire(z);
        }
      }
      this.warheadCredit = null;
      if (z.life <= 1e-6 && !(z.ticksLeft ?? 0)) this.missileZones.splice(i, 1);
    }
  }

  /** Wildfire (Incendiary III): rocks touching a burning rock catch fire themselves. */
  spreadWildfire(z: MissileZone) {
    const W = GAME_CONFIG.warheads.incendiary;
    const burning = this.rocks.filter((r) => Math.hypot(r.x - z.x, r.y - z.y) <= z.r + r.r);
    for (const src of burning) {
      src.ignited = true;
      for (const r of this.rocks) {
        if (r.ignited || this.missileZones.filter((m) => m.kind === "fire").length >= W.wildfireCap)
          continue;
        if (Math.hypot(r.x - src.x, r.y - src.y) > r.r + src.r + W.wildfireReach) continue;
        r.ignited = true;
        this.missileZones.push({
          kind: "fire",
          x: r.x,
          y: r.y,
          r: r.r + 14,
          life: W.wildfireDuration,
          max: W.wildfireDuration,
          dps: z.dps,
          tick: W.tick,
          ticksLeft: Math.round(W.wildfireDuration / W.tick),
          ownerId: z.ownerId,
          seed: this.random() * TAU,
          perk: true,
          build: z.build,
        });
      }
    }
  }

  /** Damage over time from a zone: no crits, no leech, quiet hits. */
  zoneDamage(id: number, amount: number) {
    if (this.boss) {
      if (this.boss.id === id) {
        const bo = this.boss;
        this.loseBossHp(bo, amount);
        bo.flash = Math.max(bo.flash, 0.5);
        if (bo.hp <= 0) this.killBoss();
        return;
      }
      if (this.boss.hole?.id === id) {
        this.damageHole(amount, false);
        return;
      }
    }
    const ri = this.rocks.findIndex((r) => r.id === id);
    if (ri >= 0) {
      const r = this.rocks[ri];
      this.loseRockHp(r, amount);
      r.flash = Math.max(r.flash, 0.6);
      if (r.hp <= 0) this.breakRock(ri, 0, 0);
      return;
    }
    const di = this.drones.findIndex((d) => d.id === id);
    if (di >= 0) this.damageDrone(di, amount, false, true);
  }

  /** EMP / Cryo: an offline specialist drifts to a stop and does nothing else. */
  driftDisabledDrone(d: Drone, dt: number) {
    d.emp = Math.max(0, (d.emp ?? 0) - dt);
    d.frozen = Math.max(0, (d.frozen ?? 0) - dt);
    if (!d.emp) d.overload = false;
    const damp = Math.max(0, 1 - 1.8 * dt);
    d.vx *= d.frozen ? 0 : damp;
    d.vy *= d.frozen ? 0 : damp;
    d.x = clamp(d.x + d.vx * dt, d.r, this.w - d.r);
    d.y = clamp(d.y + d.vy * dt, d.r, this.h - d.r);
    d.flash = Math.max(0, d.flash - dt * 4);
    if (d.coop) d.coop.warning = 0;
    d.pulseCharge = undefined;
  }

  /** Count down sunburn marks on everything that can carry one. */
  updateWarheadMarks(dt: number) {
    const tick = (o: { sunburn?: Rock["sunburn"] }) => {
      if (!o.sunburn) return;
      o.sunburn.t -= dt;
      if (o.sunburn.t <= 0) delete o.sunburn;
    };
    for (const r of this.rocks) tick(r);
    for (const d of this.drones) tick(d);
    if (this.boss) {
      tick(this.boss);
      if (this.boss.chill) this.boss.chill = Math.max(0, this.boss.chill - dt);
    }
  }

  /**
   * A kill landed by a warhead (missile blast, bomblet, shard, burn or aftershock)
   * counts toward the mastery of every part of that warhead still fitted.
   */
  creditWarheadKill(mark?: Rock["sunburn"], x = 0, y = 0) {
    if (mark) this.prominenceFlare(x, y, mark);
    const build = this.warheadCredit;
    if (!build) return;
    const forge = this.forgeOf();
    for (const slot of WARHEAD_SLOTS) {
      const part = forge.fitted[slot];
      if (part.id !== build[slot]) continue;
      part.kills++;
      if (part.tier === 2 && part.kills === masteryKills(part.id)) this.announceMastery(part.id);
    }
    // Siphon Tier II+: +1 hull per kill
    const trigger = forge.fitted.trigger;
    if (build.trigger === "siphon" && trigger.id === "siphon" && trigger.tier >= 2) {
      const heal = this.tierValue(GAME_CONFIG.warheads.siphon.hullPerKill, trigger.tier);
      this.p.hull = Math.min(this.p.maxHull, this.p.hull + heal);
    }
  }

  announceMastery(id: WarheadPartId) {
    this.floatText(this.p.x, this.p.y - 46, "MASTERY READY", WARHEAD_PARTS[id].color, 13);
    this.sound.play("levelup");
  }

  hitRock(index: number, dmg: number, vx: number, vy: number, crit: boolean) {
    const r = this.rocks[index];
    if (!r) return;
    if ((r.frozen ?? 0) > 0 && r.cryo) {
      this.shatterRock(index);
      return;
    }
    this.loseRockHp(r, dmg);
    r.flash = 1;
    r.vx += vx * 0.012;
    r.vy += vy * 0.012;
    this.burst(r.x, r.y, crit ? 9 : 5, crit ? AMBER_HOT : AMBER);
    this.sound.play(crit ? "crit" : "hit");
    if (crit) this.floatText(r.x, r.y - r.r, "CRIT", AMBER_HOT, 12);
    if (r.hp <= 0) this.breakRock(index, vx, vy);
    else this.score += 4;
  }

  damageDrone(index: number, dmg: number, crit: boolean, quiet = false) {
    const d = this.drones[index];
    if (!d) return;
    d.hp -= this.absorbSupportShield(d, dmg * this.markMultiplier(d));
    d.flash = 1;
    if (!quiet) {
      this.burst(d.x, d.y, crit ? 10 : 6, crit ? AMBER_HOT : ICE);
      this.sound.play(crit ? "crit" : "hit");
      if (crit) this.floatText(d.x, d.y - d.r, "CRIT", AMBER_HOT, 12);
    }
    if (d.hp <= 0) this.killDrone(index);
  }

  /**
   * Every point of boss hull damage lands here. THE METEOR's hull is held at
   * exactly 50% from the moment it gets there until its phase-shift raid
   * (the vanish, the two ambushes and the return) has finished.
   */
  loseBossHp(bo: Boss, amount: number) {
    bo.hp -= amount * this.markMultiplier(bo);
    if (!bo.mk6 || bo.movement.mk6RaidDone) return;
    const floor = bo.maxHp * 0.5;
    if (bo.hp >= floor) return;
    bo.hp = floor;
    const m = bo.movement;
    if (this.frame - (m.mk6LockFrame ?? -999) > 50 && bo.x > 0 && bo.x < this.w) {
      m.mk6LockFrame = this.frame;
      this.floatText(bo.x, bo.y - bo.r - 16, "HEALTH LOCKED", ICE, 14);
      this.rings.push({
        x: bo.x,
        y: bo.y,
        r: bo.r * 0.8,
        max: bo.r * 1.3,
        life: 0.35,
        color: ICE,
        w: 2,
      });
    }
  }

  damageBoss(dmg: number, crit: boolean) {
    const bo = this.boss;
    if (!bo) return;
    // the regenesis shield soaks damage before the hull does
    if (bo.shieldHp > 0) {
      const absorbed = Math.min(bo.shieldHp, dmg);
      bo.shieldHp -= absorbed;
      dmg -= absorbed;
      this.burst(bo.x + this.rnd(-bo.r, bo.r) * 0.5, bo.y + this.rnd(-bo.r, bo.r) * 0.5, 6, ICE);
      if (dmg <= 0) {
        this.sound.play("hit");
        return;
      }
      if (bo.shieldHp <= 0) {
        this.floatText(bo.x, bo.y - bo.r - 20, "SINGULARITY SHIELD DOWN", ICE, 14);
        this.rings.push({
          x: bo.x,
          y: bo.y,
          r: bo.r * 0.7,
          max: bo.r * 1.5,
          life: 0.5,
          color: ICE,
          w: 3,
        });
      }
    }
    this.loseBossHp(bo, dmg);
    bo.flash = 1;
    this.burst(
      bo.x + this.rnd(-bo.r, bo.r) * 0.6,
      bo.y + this.rnd(-bo.r, bo.r) * 0.6,
      crit ? 8 : 4,
      crit ? AMBER_HOT : MAGENTA,
    );
    this.sound.play(crit ? "crit" : "hit");
    if (bo.hp <= 0) this.killBoss();
  }

  breakRock(index: number, vx: number, vy: number) {
    const r = this.rocks[index];
    if (!r) return;
    this.rocks.splice(index, 1);
    this.combo++;
    this.comboTimer = 4;
    this.addMissileCharge(GAME_CONFIG.salvo.killCharge);
    this.creditWarheadKill(r.sunburn, r.x, r.y);

    // meteorites: cheap to kill, rich to salvage, never split
    if (r.trait === "meteorite") {
      const payout = Math.round(this.rnd(10, 20));
      this.credits += payout;
      this.score += 60 * (1 + Math.floor(this.combo / 4) * 0.5);
      this.floatText(r.x, r.y, `+${payout} CR`, AMBER_HOT, 15);
      this.burst(r.x, r.y, 18, AMBER_HOT);
      this.burst(r.x, r.y, 8, "#ffd27a");
      this.rings.push({ x: r.x, y: r.y, r: 4, max: 44, life: 0.36, color: AMBER, w: 2 });
      this.sound.play("creditDrop");
      this.sound.play("explodeSmall");
      this.gainXp(8 * this.xpScale());
      return;
    }
    if (r.trait === "meteor") {
      // a killed meteor bursts into a cluster of salvageable meteorites
      // — except during MK6 (The Meteor) fight, where meteors do NOT break into meteorites
      const bonus = 120 * (1 + Math.floor(this.combo / 4) * 0.5);
      this.score += bonus;
      this.floatText(r.x, r.y, "METEOR BROKEN", AMBER_HOT, 15);
      if (!this.boss || this.boss.mk !== 6) {
        this.shatterMeteor(r.x, r.y, r.vx, r.vy);
      } else {
        // MK6: meteor just explodes without spawning meteorites
        this.rings.push({ x: r.x, y: r.y, r: 8, max: 70, life: 0.45, color: AMBER_HOT, w: 3 });
        this.burst(r.x, r.y, 30, AMBER_HOT);
        this.burst(r.x, r.y, 18, "#ffd27a");
        this.shake += 5;
        this.sound.play("explodeBig");
      }
      this.gainXp(22);
      return;
    }
    const mult = 1 + Math.floor(this.combo / 4) * 0.5;
    const base = (r.size === 3 ? 120 : r.size === 2 ? 70 : 40) * (r.trait === "none" ? 1 : 1.5);
    this.score += base * mult;
    this.floatText(r.x, r.y, `+${Math.round(base * mult)}`, AMBER, r.size === 3 ? 18 : 13);
    this.burst(r.x, r.y, r.size * 12, r.trait === "none" ? AMBER : TRAIT_COLOR[r.trait]);
    this.rings.push({
      x: r.x,
      y: r.y,
      r: r.r * 0.5,
      max: r.r * 2.6,
      life: 0.4,
      color: AMBER,
      w: 2,
    });
    this.sound.play(r.size === 3 ? "explodeBig" : "explodeSmall");
    if (r.trait !== "boom") this.shake += r.size * 3.2;
    if (r.size === 3) this.timeScale = 0.72;

    if (this.random() < this.p.creditChance + r.size * 0.07) {
      const n = r.size === 3 ? 3 : r.size === 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        this.pickups.push({
          x: r.x,
          y: r.y,
          vx: this.rnd(-60, 60),
          vy: this.rnd(-60, 60),
          kind: this.random() < 0.12 ? "repair" : "credit",
          value: Math.round((r.size === 3 ? 12 : r.size === 2 ? 7 : 4) * this.p.creditValue),
          life: 20,
          pulse: this.random() * TAU,
        });
      }
      this.rings.push({
        x: r.x,
        y: r.y,
        r: 5,
        max: 28 + r.size * 10,
        life: 0.35,
        color: AMBER,
        w: 2,
      });
      this.burst(r.x, r.y, 8 + r.size * 3, AMBER_HOT);
      this.sound.play("creditDrop");
    }

    // Large explosive asteroids detonate without producing descendants.
    if (r.trait === "boom") this.rockBoom(r);

    // a Cryo-shattered rock is gone: its shards replace the usual split
    if (r.size > 1 && !r.shatter && !(r.trait === "boom" && r.size === 3)) {
      for (let i = 0; i < 2; i++) {
        const a = this.random() * TAU;
        const child = this.makeRock(
          r.x,
          r.y,
          (r.size - 1) as 1 | 2,
          Math.cos(a) * 90 + r.vx + vx * 0.04,
          Math.sin(a) * 90 + r.vy + vy * 0.04,
          r.trait,
        );
        if (r.keep && r.life != null) {
          child.life = r.life;
          child.keep = true;
        }
        this.addRocks(child);
      }
    }
    this.gainXp(
      (r.size === 3 ? 32 : r.size === 2 ? 18 : 11) *
        (r.trait === "none" ? 1 : 1.3) *
        this.xpScale(),
    );
  }

  /** explosive rocks: slightly larger blast radius, can detonate when player is in proximity */
  boomRadius(size: 1 | 2 | 3) {
    return (size === 3 ? 178 : size === 2 ? 108 : 66) * BOOM.blastMul;
  }

  rockBoom(r: Rock) {
    if (r.coopMine) return this.mineBoom(r);
    const radius = this.boomRadius(r.size);
    const pdmg = r.size === 3 ? 32 : r.size === 2 ? 16 : 8;
    const rdmg = r.size === 3 ? 42 : r.size === 2 ? 22 : 11;
    this.rings.push({ x: r.x, y: r.y, r: 6, max: radius * 1.5, life: 0.5, color: ORANGE, w: 3 });
    this.burst(r.x, r.y, 12 + r.size * 8, ORANGE);
    this.shake += r.size * GAME_CONFIG.asteroids.traits.boom.shakePerSize;
    this.sound.play(r.size === 3 ? "explodeBig" : "flak");
    this.forEachPilot(() => {
      const p = this.p;
      if (Math.hypot(p.x - r.x, p.y - r.y) < radius + 14)
        this.damagePlayer(pdmg, "Explosive asteroid blast", 0.3);
    });
    const rockIds = this.rocks
      .filter((o) => o.id !== r.id && Math.hypot(o.x - r.x, o.y - r.y) < radius + o.r)
      .map((o) => o.id);
    for (const id of rockIds) {
      const i = this.rocks.findIndex((o) => o.id === id);
      if (i >= 0) this.hitRock(i, rdmg, this.rocks[i].x - r.x, this.rocks[i].y - r.y, false);
    }
    const droneIds = this.drones
      .filter((o) => Math.hypot(o.x - r.x, o.y - r.y) < radius + o.r)
      .map((o) => o.id);
    for (const id of droneIds) {
      const i = this.drones.findIndex((o) => o.id === id);
      if (i >= 0) this.damageDrone(i, rdmg, false);
    }
    this.forEachPilot(() => {
      if (
        this.salvageDrone.active &&
        Math.hypot(this.salvageDrone.x - r.x, this.salvageDrone.y - r.y) < radius + 14
      ) {
        this.damageSalvageDrone(pdmg);
      }
    });
  }

  killDrone(index: number) {
    const d = this.drones[index];
    if (!d) return;
    this.drones.splice(index, 1);
    this.creditWarheadKill(d.sunburn, d.x, d.y);
    const warden = d.kind === "warden";
    const heavy = warden || d.kind === "spiker";
    if (warden) {
      // Despawn every splitter nest + seeking orbs owned by this warden
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const bb = this.bullets[i];
        if (bb.kind === "wardenOrb" || bb.kind === "wardenShard") this.bullets.splice(i, 1);
      }
    }
    this.burst(d.x, d.y, heavy ? 40 : 26, MAGENTA);
    this.rings.push({
      x: d.x,
      y: d.y,
      r: 8,
      max: heavy ? 130 : 90,
      life: 0.5,
      color: MAGENTA,
      w: heavy ? 4 : 3,
    });
    this.sound.play(heavy ? "bossDeath" : "explodeBig");
    this.shake += heavy ? 13 : 9;
    this.flashAlpha = heavy ? 0.45 : 0.35;
    const base = heavy ? 700 : 360;
    this.score += base * (1 + Math.floor(this.combo / 4) * 0.5);
    this.floatText(d.x, d.y, `+${base}`, MAGENTA, heavy ? 18 : 16);
    const shards = heavy ? 4 : 3;
    for (let i = 0; i < shards; i++) {
      this.pickups.push({
        x: d.x,
        y: d.y,
        vx: this.rnd(-70, 70),
        vy: this.rnd(-70, 70),
        kind: "credit",
        value: Math.round((heavy ? 20 : 14) * this.p.creditValue),
        life: GAME_CONFIG.pickups.lifetime,
        pulse: this.random() * TAU,
      });
    }
    this.gainXp((heavy ? 120 : 60) * this.xpScale());
    this.combo++;
    this.comboTimer = 4;
    this.addMissileCharge(GAME_CONFIG.salvo.killCharge);
  }

  /**
   * XP awards ramp with the sector so the late run pays out far more per kill
   * than the opening waves — that is what lets a player chain many more
   * upgrades once they are into sectors 3–5.
   */
  xpScale() {
    return 1 + scaledWave(this.wave) * 0.024;
  }

  gainXp(n: number) {
    this.xp += n;
    // Terminal screens are sacred: bank the XP but never yank the player off
    // the victory / game-over screen with an upgrade rack (rocks, meteorites
    // and in-flight projectiles can still bank kills during the death slow-mo)
    if (this.mode === "victory" || this.mode === "gameover") return;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(
        GAME_CONFIG.progression.nextLevelXpBase *
          Math.pow(this.level, GAME_CONFIG.progression.nextLevelXpExponent),
      );
      this.triggerLevelUp();
    }
  }

  triggerLevelUp() {
    this.rerollCost = GAME_CONFIG.progression.levelUpRerollStartingCost;
    this.choices = this.rollChoices();
    // nothing left to offer: every upgrade is maxed. Keep the hull patch and
    // the level, but let the run flow on instead of showing an empty rack.
    if (this.choices.length === 0) {
      if (this.p.hull < this.p.maxHull) {
        const healed = Math.min(
          GAME_CONFIG.progression.levelUpHullHeal,
          this.p.maxHull - this.p.hull,
        );
        this.p.hull += healed;
        this.floatText(this.p.x, this.p.y - 52, `+${Math.round(healed)} HEALTH`, ICE, 14);
      }
      this.floatText(this.p.x, this.p.y - 74, "ALL UPGRADES MAXED", AMBER_HOT, 13);
      return;
    }
    // every level patches the hull a little — a breather, not a full reset
    if (this.p.hull < this.p.maxHull) {
      const healed = Math.min(
        GAME_CONFIG.progression.levelUpHullHeal,
        this.p.maxHull - this.p.hull,
      );
      this.p.hull += healed;
      this.floatText(this.p.x, this.p.y - 52, `+${Math.round(healed)} HEALTH`, ICE, 14);
      this.rings.push({ x: this.p.x, y: this.p.y, r: 12, max: 74, life: 0.5, color: ICE, w: 2 });
    }
    this.sound.silence();
    this.sound.play("levelup");
    this.setMode("levelup");
    this.flashAlpha = 0.55;
    this.rings.push({ x: this.p.x, y: this.p.y, r: 10, max: 320, life: 0.7, color: AMBER, w: 3 });
  }

  rollChoices(): UpgradeCard[] {
    type Entry = { card: UpgradeCard; weight: number };
    const statPool: Entry[] = [];
    for (const u of STAT_UPGRADES) {
      const lvl = this.stacks[u.id] ?? 0;
      if (lvl >= u.max) continue;
      statPool.push({
        card: {
          id: u.id,
          name: u.name,
          desc: u.desc,
          tag: u.tag,
          rarity: u.rarity,
          level: lvl,
          kind: "stat",
        },
        weight: u.weight,
      });
    }

    const pick = (pool: Entry[]): UpgradeCard | null => {
      if (!pool.length) return null;
      const total = pool.reduce((s, e) => s + e.weight, 0);
      let roll = this.random() * total;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) {
          idx = i;
          break;
        }
      }
      return pool.splice(idx, 1)[0].card;
    };

    const picked: UpgradeCard[] = [];
    while (picked.length < 3 && statPool.length) {
      const c = pick(statPool);
      if (!c) break;
      picked.push(c);
    }
    // shuffle so the guaranteed weapon doesn't always sit in the same slot
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    return picked;
  }

  /**
   * Spend credits to reroll: the level-up rack (if one is waiting) and this
   * wave's blueprint offers refresh together. The price rises every time.
   */
  rerollChoices(): number | null {
    if (this.credits < this.rerollCost) return null;
    const paid = this.rerollCost;
    this.credits -= this.rerollCost;
    this.rerollCost = Math.round(this.rerollCost * 1.8);
    if (this.choices.length) this.choices = this.rollChoices();
    this.forgeOf().offerRolls++;
    this.ensureBlueprintOffers(true);
    this.sound.play("buy");
    return paid;
  }

  chooseUpgrade(id: string) {
    this.choices = [];
    const def = STAT_UPGRADES.find((u) => u.id === id);
    if (def) {
      def.apply(this);
      this.stacks[id] = (this.stacks[id] ?? 0) + 1;
      this.floatText(this.p.x, this.p.y - 30, def.name.toUpperCase(), AMBER_HOT, 16);
    }
    this.sound.play("buy");
    this.flashAlpha = 0.4;
    this.setMode("playing");
  }

  damagePlayer(dmg: number, cause = "Unknown damage", feedback = 1) {
    const p = this.p;
    if (this.god || p.invuln > 0) return;
    this.quietTime = 0;
    this.salvageDrone.pulseTimer = this.repairInterval();
    const incoming = dmg * (1 - p.armor);
    const d = this.salvageDrone;
    const shield =
      d.purchased &&
      d.active &&
      d.upgrades.shield > 0 &&
      Math.hypot(d.x - p.x, d.y - p.y) <= this.salvageSupportRange()
        ? Math.min(d.hp, incoming * (GAME_CONFIG.salvage.shieldShares[d.upgrades.shield - 1] ?? 0))
        : 0;
    if (shield > 0) this.damageSalvageDrone(shield, true);
    p.hull -= incoming - shield;
    if (p.hull <= 0 && this.mode === "playing" && this.leaderboardRun)
      this.leaderboardRun.deathCause = cause;
    if (p.hull <= 0) {
      if (!this.headless) this.runSave.end();
    } else this.saveRun();
    this.burst(p.x, p.y, 10, p.armor > 0 ? ICE : AMBER);
    this.rings.push({
      x: p.x,
      y: p.y,
      r: 16,
      max: 60,
      life: 0.35,
      color: p.armor > 0 ? ICE : AMBER_HOT,
      w: 2,
    });
    this.sound.play("hurt");
    this.shake += 11 * feedback;
    this.flashAlpha = Math.max(this.flashAlpha, 0.55 * feedback);
    this.combo = 0;
    this.comboTimer = 0;
    if (p.hull <= 0 && this.mode === "playing") this.gameOver();
  }

  gameOver() {
    if (!this.headless) this.runSave.end();
    this.p.hull = 0;
    this.sound.silence();
    this.sound.play("death");
    this.burst(this.p.x, this.p.y, 90, AMBER);
    this.rings.push({ x: this.p.x, y: this.p.y, r: 10, max: 300, life: 1, color: AMBER_HOT, w: 4 });
    this.shake = 32;
    this.flashAlpha = 1;
    this.timeScale = 0.35;
    this.setMode("gameover");
  }

  explode(
    x: number,
    y: number,
    radius: number,
    dmg: number,
    cause = "Missile blast",
    playerDamage: number = GAME_CONFIG.asteroids.genericExplosionPlayerDamage,
    style?: MissileBlastStyle,
  ) {
    if (style) this.missileBlastFx(x, y, radius, style);
    else {
      this.rings.push({ x, y, r: 8, max: radius * 1.6, life: 0.55, color: MAGENTA, w: 3 });
      this.burst(x, y, 26, MAGENTA);
      this.shake += 10;
    }
    this.sound.play(style?.small ? "explodeSmall" : "explodeBig");
    const rockIds = this.rocks
      .filter((r) => Math.hypot(r.x - x, r.y - y) < radius + r.r)
      .map((r) => r.id);
    for (const id of rockIds) {
      const i = this.rocks.findIndex((r) => r.id === id);
      if (i < 0) continue;
      const r = this.rocks[i];
      const d = Math.hypot(r.x - x, r.y - y);
      const falloff = 1 - clamp((d - r.r) / radius, 0, 1) * 0.65;
      this.hitRock(i, dmg * falloff, r.x - x, r.y - y, false);
    }
    const droneIds = this.drones
      .filter((d) => Math.hypot(d.x - x, d.y - y) < radius + d.r)
      .map((d) => d.id);
    for (const id of droneIds) {
      const i = this.drones.findIndex((d) => d.id === id);
      if (i >= 0) this.damageDrone(i, dmg, false);
    }
    if (this.boss) {
      const bo = this.boss;
      const bd = Math.hypot(bo.x - x, bo.y - y);
      if (bd < radius + bo.r) {
        this.loseBossHp(
          bo,
          dmg * this.blastBossMul * (1 - clamp((bd - bo.r) / radius, 0, 1) * 0.6),
        );
        bo.flash = 1;
        if (bo.hp <= 0) this.killBoss();
      }
      if (bo.hole) {
        const h = bo.hole;
        const hd = Math.hypot(h.x - x, h.y - y);
        if (hd < radius + h.r) {
          const falloff = 1 - clamp((hd - h.r) / radius, 0, 1) * 0.6;
          this.damageHole(dmg * falloff, false);
        }
      }
    }
    this.forEachPilot(() => {
      if (playerDamage > 0 && Math.hypot(this.p.x - x, this.p.y - y) < radius * 0.6)
        this.damagePlayer(playerDamage, cause);
      if (!style?.small) this.timeScale = GAME_CONFIG.simulation.explosionTimeScale;
    });
  }

  /**
   * Missile detonation: a white-hot core flash, the airframe-coloured shockwave,
   * a thin trailing pressure ring and sparks in the payload's colour. Full Lock
   * blasts add a white halo; Crossfire adds a second, counter-coloured ring.
   * Small blasts (bomblets, payload pops) use a lighter, quicker version.
   */
  missileBlastFx(x: number, y: number, radius: number, style: MissileBlastStyle) {
    const color = style.color ?? MAGENTA;
    const hot = style.payload ? WARHEAD_PARTS[style.payload].color : color;
    if (style.small) {
      this.rings.push({ x, y, r: 2, max: radius * 0.6, life: 0.12, color: "#ffffff", w: 3 });
      this.rings.push({ x, y, r: 3, max: radius * 1.2, life: 0.3, color, w: 2 });
      for (let i = 0; i < 5 && this.particles.length < 700; i++) {
        const a = this.random() * TAU;
        const v = this.rnd(140, 300);
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: this.rnd(0.15, 0.3),
          max: 0.3,
          size: this.rnd(1.2, 2),
          color: i % 2 ? "#ffffff" : hot,
          drag: 0.88,
        });
      }
      this.shake += 1.5;
      return;
    }
    this.rings.push({ x, y, r: 2, max: radius * 0.55, life: 0.16, color: "#ffffff", w: 6 });
    this.rings.push({ x, y, r: 6, max: radius * 1.35, life: 0.42, color, w: 3.5 });
    this.rings.push({ x, y, r: 4, max: radius * 1.85, life: 0.6, color: hot, w: 1 });
    if (style.fullLock)
      this.rings.push({ x, y, r: 10, max: radius * 1.15, life: 0.3, color: "#ffffff", w: 1.2 });
    if (style.crossfire) {
      this.rings.push({ x, y, r: 10, max: radius * 2.2, life: 0.7, color: "#ffffff", w: 2.5 });
      this.rings.push({ x, y, r: 6, max: radius * 1.9, life: 0.6, color: AMBER_HOT, w: 2 });
    }
    // streaking sparks: fast, low-drag, flung radially
    for (let i = 0; i < 14 && this.particles.length < 700; i++) {
      const a = this.random() * TAU;
      const v = this.rnd(220, 480);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: this.rnd(0.22, 0.4),
        max: 0.4,
        size: this.rnd(1.6, 2.6),
        color: i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? hot : color,
        drag: 0.9,
      });
    }
    this.burst(x, y, 12, color);
    this.shake += 6;
  }

  /* ------------------------------------------------------------ waves */

  rollTrait(forceMutation = false): RockTrait {
    const w = this.wave;
    const roll = this.random();
    const gates = RUN_PACING.traitWaves;
    // Homing mutations unlock after the MK1 encounter, on wave 6.
    if (w < gates.homing) return "none";
    const pool: RockTrait[] = ["homing"];
    if (w >= gates.bounce) pool.push("bounce");
    if (w >= gates.boom && this.boomRoom() > 0) pool.push("boom");
    if (w >= gates.fast) pool.push("fast");
    // Mutations ramp up in each unlocked band; late waves use an exact normal quota.
    const chance = Math.min(0.95, 0.15 + (w - 1) * 0.04);
    if (!forceMutation && roll > chance) return "none";
    // the newest trait for this band shows up a little more often
    if (this.random() < 0.4) return pool[pool.length - 1];
    return pool[Math.floor(this.random() * pool.length)];
  }

  boomRoom() {
    return Math.max(
      0,
      GAME_CONFIG.asteroids.traits.boom.maxAlive -
        this.rocks.filter((rock) => rock.trait === "boom" && !rock.coopMine).length,
    );
  }

  addRocks(...rocks: Rock[]) {
    for (const rock of rocks) {
      if (rock.trait === "boom" && !rock.coopMine && this.boomRoom() === 0) continue;
      this.rocks.push(rock);
    }
  }

  rollRockSize(): 1 | 2 | 3 {
    return (1 + Math.floor(this.random() * 3)) as 1 | 2 | 3;
  }

  spawnBossAbilityRock(b: Boss) {
    if (
      this.random() >= GAME_CONFIG.bosses.abilityRockChance ||
      this.rocks.filter((rock) => !isEventRock(rock.trait)).length >= BOSS_ROCK_CAP ||
      (b.spawnTrait === "boom" && this.boomRoom() === 0)
    )
      return;
    const a = this.random() * TAU;
    const rock = this.makeRock(
      b.x + Math.cos(a) * (b.r + 70),
      b.y + Math.sin(a) * (b.r + 70),
      this.rollRockSize(),
      Math.cos(a) * 120,
      Math.sin(a) * 120,
      b.mk === 6 ? this.rollTrait(true) : b.spawnTrait,
    );
    rock.life = BOSS_ROCK_LIFESPAN;
    rock.keep = true;
    this.addRocks(rock);
  }

  makeCracks(r: number, count: number, inner = 0.55): Crack[] {
    const cracks: Crack[] = [];
    for (let c = 0; c < count; c++) {
      const a0 = this.random() * TAU;
      const startR = r * this.rnd(inner, 0.95);
      let px = Math.cos(a0) * startR,
        py = Math.sin(a0) * startR;
      let dir = a0 + Math.PI + this.rnd(-0.7, 0.7);
      const segs = Math.floor(this.rnd(3, 6));
      const step = (startR * this.rnd(0.9, 1.6)) / segs;
      const line = [{ x: px, y: py }];
      for (let s = 0; s < segs; s++) {
        dir += this.rnd(-0.75, 0.75);
        px += Math.cos(dir) * step;
        py += Math.sin(dir) * step;
        const d = Math.hypot(px, py);
        if (d > r * 0.94) {
          px *= (r * 0.94) / d;
          py *= (r * 0.94) / d;
        }
        line.push({ x: px, y: py });
      }
      cracks.push({ pts: line, at: (c + 1) / (count + 0.6) });
    }
    return cracks;
  }

  updateFastRockSpeed(r: Rock) {
    const speeds = GAME_CONFIG.asteroids.traits.fast.speeds;
    const base = r.size === 3 ? speeds.large : r.size === 2 ? speeds.medium : speeds.small;
    const speed = base * (1 + 0.5 * (1 - clamp(r.hp / r.maxHp, 0, 1)));
    const angle = Math.atan2(r.vy, r.vx);
    r.vx = Math.cos(angle) * speed;
    r.vy = Math.sin(angle) * speed;
  }

  makeRock(
    x: number,
    y: number,
    size: 1 | 2 | 3,
    vx?: number,
    vy?: number,
    trait: RockTrait = "none",
  ): Rock {
    const sizeConfig =
      size === 3
        ? GAME_CONFIG.asteroids.sizes.large
        : size === 2
          ? GAME_CONFIG.asteroids.sizes.medium
          : GAME_CONFIG.asteroids.sizes.small;
    const r =
      sizeConfig.radius *
      this.rnd(GAME_CONFIG.asteroids.radiusRandomMin, GAME_CONFIG.asteroids.radiusRandomMax);
    const n = Math.floor(this.rnd(8, 12));
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(this.rnd(0.72, 1.18));
    let vX = vx ?? this.rnd(-70, 70),
      vY = vy ?? this.rnd(-70, 70);
    if (trait === "fast") {
      // fixed pace per size so speed never compounds through generations
      const speeds = GAME_CONFIG.asteroids.traits.fast.speeds;
      const target = size === 3 ? speeds.large : size === 2 ? speeds.medium : speeds.small;
      const a = Math.atan2(vY, vX) + this.rnd(-0.2, 0.2);
      vX = Math.cos(a) * target;
      vY = Math.sin(a) * target;
    } else if (trait === "boom") {
      // boom rocks lumber: a fixed, slow pace per size so splits never speed them up
      const target = BOOM.speed[size];
      const a = Math.atan2(vY, vX);
      vX = Math.cos(a) * target;
      vY = Math.sin(a) * target;
    } else if (trait === "bounce") {
      // Bounce asteroids are slightly faster, and smaller ones are noticeably quicker
      const target = size === 3 ? 120 : size === 2 ? 150 : 185;
      const a = Math.atan2(vY, vX);
      vX = Math.cos(a) * target;
      vY = Math.sin(a) * target;
    }
    const hp =
      sizeConfig.hp *
      (1 + scaledWave(this.wave) * GAME_CONFIG.asteroids.hpPerScaledWave) *
      (trait === "fast"
        ? GAME_CONFIG.asteroids.traits.fast.hpMultiplier
        : trait === "none" || isEventRock(trait)
          ? 1
          : GAME_CONFIG.asteroids.specialHpMultiplier);
    return {
      id: this.nextId++,
      x,
      y,
      vx: vX,
      vy: vY,
      r,
      size,
      hp,
      maxHp: hp,
      rot: this.random() * TAU,
      rotSpeed: this.rnd(-1.1, 1.1),
      pts,
      flash: 0,
      cracks: this.makeCracks(r, size === 3 ? 4 : size === 2 ? 3 : 2),
      trait,
    };
  }

  spawnDrone(x: number, y: number, hp: number, kind: Drone["kind"] = "sentinel"): Drone {
    const drone: Drone = {
      id: this.nextId++,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      r: kind === "warden" ? 30 : 21,
      hp,
      maxHp: hp,
      angle: 0,
      fire: kind === "warden" ? this.rnd(4.5, 6.5) : this.rnd(2, 3.5),
      flash: 0,
      orbitDir: this.random() < 0.5 ? 1 : -1,
      orbitTimer: this.rnd(1, 3),
      evadeCd: 0,
      burst: 1,
      sniperAimX: x,
      sniperAimY: y,
    };
    if (kind === "spiker") {
      const tuning = GAME_CONFIG.enemies.spikers;
      const heading = this.random() * TAU;
      const speed = this.rnd(tuning.speedMin, tuning.speedMax);
      drone.r = tuning.radius;
      drone.vx = Math.cos(heading) * speed;
      drone.vy = Math.sin(heading) * speed;
      drone.angle = this.random() * TAU;
      drone.fire = tuning.fireInterval;
    }
    return drone;
  }

  nextWave() {
    // a shower during the previous wave pays a completion bonus
    if (this.shower.occurredThisWave && this.wave > 0) {
      this.credits += GAME_CONFIG.waves.showerCompletionBonus;
      this.floatText(this.p.x, this.p.y - 44, "SHOWER SALVAGE +100 CR", AMBER_HOT, 15);
      this.rings.push({ x: this.p.x, y: this.p.y, r: 10, max: 90, life: 0.5, color: AMBER, w: 2 });
      this.sound.play("buy");
      this.shower.cooldownWaves = GAME_CONFIG.waves.showerCooldownWaves;
    } else if (this.shower.cooldownWaves > 0) {
      this.shower.cooldownWaves--;
    }
    this.shower.active = false;
    this.shower.occurredThisWave = false;
    // any leftover event debris is swept when the sector advances
    this.rocks = this.rocks.filter((r) => !isEventRock(r.trait));

    this.wave++;

    const idx = sectorForWave(this.wave);
    if (idx !== this.themeIdx) {
      this.themeIdx = idx;
      this.theme = THEMES[idx];
      this.flashAlpha = 0.6;
      this.shake += 6;
      this.banner = `SECTOR ${this.theme.numeral}`;
      this.bannerSub = this.theme.name;
      this.bannerT = 2.6;
      this.sound.play("levelup");
    }

    const bossWave = isBossWave(this.wave);
    const isFinal = this.wave === RUN_PACING.finalWave;
    const tuningWave = scaledWave(this.wave);
    const droneHp =
      GAME_CONFIG.enemies.sentinels.hpBase + tuningWave * GAME_CONFIG.waves.bossEscortHpPerWave;

    if (bossWave) {
      // the field already carries the mark of the dreadnought that owns it
      const mkForField = bossMkForWave(this.wave);
      const fieldTrait = BOSS_SPECS[mkForField].trait;
      // one trait rock marks the field — boss battles stay lean, the dreadnought fills in
      this.addRocks(
        this.makeRock(
          this.w * 0.6 + this.random() * this.w * 0.4,
          this.random() * this.h,
          2,
          undefined,
          undefined,
          fieldTrait,
        ),
      );
      // every dreadnought escorts sentinels; the late MKs bring wardens too
      const sentinelHp = isFinal ? droneHp * 1.4 : droneHp;
      this.drones.push(this.spawnDrone(60, this.h - 80, sentinelHp));
      this.drones.push(this.spawnDrone(this.w - 60, this.h - 80, sentinelHp));
      const wardenCount = mkForField >= 4 ? (isFinal ? 2 : 1) : 0;
      for (let i = 0; i < wardenCount; i++) {
        this.drones.push(
          this.spawnDrone(
            i === 0 ? this.w * 0.22 : this.w * 0.78,
            this.h * 0.55,
            GAME_CONFIG.waves.wardenEscortHpBase +
              tuningWave * GAME_CONFIG.waves.wardenEscortHpPerWave,
            "warden",
          ),
        );
      }
      this.boss = this.makeBoss(isFinal, mkForField);
      this.banner = isFinal
        ? "FINAL THREAT"
        : `${this.boss.name} ${this.boss.suffix.split(" ")[0]}`;
      this.bannerSub =
        (isFinal
          ? "MK5 · STURMZELL — SOUL OF THE BELT"
          : BOSS_SPECS[mkForField].suffix + " · HEAVY SIGNATURE") +
        (wardenCount ? ` · +${wardenCount} WARDEN` : "");
      this.bannerT = 2.8;
      this.sound.play("bossCharge");
    } else {
      // Sector 5 combat waves (21-24): occasional warden spawns.
      const isLateWave =
        this.wave >= RUN_PACING.lateWardenFromWave && this.wave <= RUN_PACING.lateWardenToWave;
      const spawnWardenInLate = isLateWave && this.random() < (this.wave % 2 === 0 ? 0.5 : 0.3);

      // If a warden spawns, reduce the asteroid count so the fight is readable
      const baseRockCount = Math.min(
        GAME_CONFIG.waves.regularRockCountCap,
        GAME_CONFIG.waves.regularRockBaseCount +
          Math.ceil(tuningWave * GAME_CONFIG.waves.regularRockCountScale),
      );
      const count = spawnWardenInLate
        ? Math.max(
            GAME_CONFIG.waves.minimumRockCountWithWarden,
            Math.round(baseRockCount * GAME_CONFIG.waves.wardenRockCountMultiplier),
          )
        : baseRockCount;

      const normalQuota = isLateWave ? 1 + Math.floor(this.random() * 2) : 0;
      for (let i = 0; i < count; i++) {
        let x = 0,
          y = 0,
          tries = 0;
        do {
          x = this.random() * this.w;
          y = this.random() * this.h;
          tries++;
        } while (
          this.spawnClearance(x, y) < GAME_CONFIG.waves.shipSpawnRockClearance &&
          tries < 20
        );
        this.addRocks(
          this.makeRock(
            x,
            y,
            this.random() < 0.45 ? 3 : 2,
            undefined,
            undefined,
            isLateWave && i < normalQuota ? "none" : this.rollTrait(isLateWave),
          ),
        );
      }
      // Sentinels are capped concurrently and trickle in: the opening sector
      // sees 1–2 at most, later sectors ramp up to the sector cap.
      const sentinelRoom =
        maxSentinels(this.wave) - this.drones.filter((dd) => dd.kind === "sentinel").length;
      const dn = Math.max(0, Math.min(sentinelWaveCount(this.wave), sentinelRoom));
      for (let i = 0; i < dn; i++) {
        const edge = this.random() * 4;
        const x = edge < 2 ? (edge < 1 ? 40 : this.w - 40) : this.random() * this.w;
        const y = edge >= 2 ? (edge < 3 ? 40 : this.h - 40) : this.random() * this.h;
        this.drones.push(this.spawnDrone(x, y, droneHp));
      }
      if (spawnWardenInLate) {
        // Spawn 1 warden in the late wave
        const wardenEdge = this.random() * 4;
        const wx = wardenEdge < 2 ? (wardenEdge < 1 ? 50 : this.w - 50) : this.random() * this.w;
        const wy = wardenEdge >= 2 ? (wardenEdge < 3 ? 50 : this.h - 50) : this.random() * this.h;
        this.drones.push(
          this.spawnDrone(
            wx,
            wy,
            GAME_CONFIG.waves.lateWardenHpBase + tuningWave * GAME_CONFIG.waves.lateWardenHpPerWave,
            "warden",
          ),
        );
      }

      const hasWarden = this.drones.some((d) => d.kind === "warden");
      this.banner = `WAVE ${String(this.wave).padStart(2, "0")}`;
      this.bannerSub = hasWarden
        ? "WARDEN SIEGE DETECTED"
        : this.drones.length
          ? "SENTINEL DRONES INBOUND"
          : "SECTOR CLEAR — ADVANCING";
      this.bannerT = 2.2;
    }

    if (this.wave >= GAME_CONFIG.enemies.spikers.unlockWave) {
      const tuning = GAME_CONFIG.enemies.spikers;
      const second = this.spikerCap() === 2 && this.random() < tuning.secondSpawnChance;
      const target = second ? 2 : 1;
      const live = this.drones.filter((d) => d.kind === "spiker").length;
      const spawned = this.spawnSpikers(Math.max(0, target - live));
      if (spawned) this.bannerSub += ` · +${spawned} SPIKER${spawned > 1 ? "S" : ""}`;
    }
    this.p.missiles = Math.min(this.p.maxMissiles, this.p.missiles + 1);
    // every pilot gets this wave's blueprint offers from the seeded shop stream
    this.forEachPilot(() => this.ensureBlueprintOffers());
    this.sound.play("wave");
    // Between-wave salvage is generous enough that a player can afford the
    // armory early: by the MK1 boss (wave 5) this alone totals ~760 CR.
    this.credits += RUN_PACING.creditsPerWaveBase + this.wave * RUN_PACING.creditsPerWaveStep;
    this.startDroneRebuild();
  }

  makeBoss(final: boolean, mk = 0): Boss {
    if (mk < 1 || mk > 6) mk = final ? 5 : bossMkForWave(this.wave);
    const spec = BOSS_SPECS[mk];
    const bonus = mk === 6;
    const isMk3 = mk === 3;
    // ~10% smaller across the board so bosses read as less screen-dominant
    const r = bonus
      ? GAME_CONFIG.bosses.bonusRadius
      : final
        ? GAME_CONFIG.bosses.finalRadius
        : GAME_CONFIG.bosses.baseRadius;
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) pts.push(this.rnd(0.88, 1.06));
    let hp = bonus
      ? GAME_CONFIG.bosses.bonusHp
      : (final
          ? GAME_CONFIG.bosses.finalHp
          : GAME_CONFIG.bosses.waveBaseHp +
            scaledWave(this.wave) * GAME_CONFIG.bosses.hpPerScaledWave) * spec.hpMul;
    if (mk <= 2) hp = Math.min(hp, EARLY_BOSS_HP_CEILING);
    if (mk === 3) hp = GAME_CONFIG.bosses.mk3Hp;
    if (mk === 4) hp = GAME_CONFIG.bosses.mk4Hp;
    if (mk === 5) hp = GAME_CONFIG.bosses.finalHp;

    // MK3 starts with a brisk, non-zero diagonal velocity so it immediately glides and bounces
    const baseSpeed = isMk3
      ? GAME_CONFIG.waves.bossMk3Speed
      : bonus
        ? GAME_CONFIG.waves.bossMk6Speed
        : GAME_CONFIG.waves.bossBaseSpeed;
    let initVx = this.rnd(-28, 28) + spec.driftX;
    let initVy = this.rnd(-14, 14);
    if (isMk3) {
      const dirX = this.random() < 0.5 ? 1 : -1;
      const dirY = this.random() < 0.5 ? 1 : -1;
      initVx = dirX * 78;
      initVy = dirY * 78;
    }

    return {
      id: this.nextId++,
      name: spec.name,
      suffix: spec.suffix,
      mk,
      spawnTrait: spec.trait,
      edgeColor: spec.edge,
      spawnWeight: spec.spawnWeight,
      hpMul: spec.hpMul,
      timerMul: spec.timerMul,
      bulletMul: spec.bulletMul,
      rocksPer: spec.rocksPer,
      final,
      x: this.w / 2,
      y: this.h * 0.28,
      vx: initVx,
      vy: initVy,
      r,
      hp,
      maxHp: hp,
      rot: 0,
      rotSpeed: this.rnd(0.25, 0.4) * (this.random() < 0.5 ? -1 : 1),
      pts,
      cracks: this.makeCracks(r, 7, 0.4),
      flash: 0,
      t: 0,
      attackTimer: GAME_CONFIG.waves.bossAttackTimer,
      phase: 0,
      rainT: 0,
      rainN: 0,
      flankT: 0,
      flankSide: 1,
      strikes: [],
      boomDrops: [],
      wallT: 0,
      wallN: 0,
      wallSide: 1,
      cascadeN: 0,
      cascadeT: 0,
      cascadeCharge: 0,
      ricochetRing: 0,
      ricochetPhase: 0,
      ricochetFired: 0,
      ricochetT: 0,
      shockT: 0,
      shockDur: 0,
      shockRadius: 250,
      hole: null,
      shieldHp: 0,
      shieldT: 0,
      movement: {
        mode: "drift",
        timer: this.rnd(3.2, 5.6),
        targetX: this.w / 2,
        targetY: this.h * 0.28,
        baseSpeed,
        bounceBoost: 1,
        mk4StrikeCd: 2.8,
        mk6RaidPending: false,
        mk6RaidDone: false,
        raidMeteorT: 0,
      },
      mk6: bonus
        ? {
            slots: [
              {
                attack: "idle",
                label: "",
                t: 1.6,
                spawnT: 0,
                beamA: 0,
                strikes: [],
                healBlasts: [],
              },
            ],
            fieldIds: [],
            beamCd: 0,
            reinforced: [],
            lastAttack: null,
            enraged: false,
          }
        : null,
    };
  }

  /** a hostile shell detonating on its own — hurts the player and the drone,
   *  but never the fleet that fired it */
  enemyBlast(x: number, y: number, radius: number, dmg: number, cause = "Hostile shell explosion") {
    this.rings.push({ x, y, r: 6, max: radius * 1.4, life: 0.34, color: "#ff7aa0", w: 2 });
    this.burst(x, y, 14, "#ff7aa0");
    this.sound.play("explodeSmall");
    this.shake += 2.5;
    this.forEachPilot(() => {
      if (Math.hypot(this.p.x - x, this.p.y - y) < radius) this.damagePlayer(dmg, cause);
      if (
        this.salvageDrone.active &&
        Math.hypot(this.salvageDrone.x - x, this.salvageDrone.y - y) < radius
      ) {
        this.damageSalvageDrone(dmg);
      }
    });
  }

  enemyBullet(x: number, y: number, a: number, sp: number, dmg: number, r = 5) {
    this.addBullet({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r,
      life: 5,
      dmg,
      kind: "enemy",
      damageCause: this.boss ? `MK${this.boss.mk} boss projectile` : "Hostile projectile",
      pierce: 0,
      color: MAGENTA,
      hitIds: new Set(),
      turn: 0,
      bounces: 0,
      fuse: 0,
      extra: 0,
      extraDmg: 0,
    });
  }

  /** summon a singularity themed after the active boss.
   *  Singularities can be destroyed by shooting at them (scaling from sentinel HP
   *  at MK3 up to warden HP at MK6). */
  mkHole(b: Boss, pull: number, dur: number, radius: number) {
    const mk = b.mk || 3;
    let color = "#b06bff";
    let coreColor = "#d9b3ff";
    let ringColor = "#7a3bd6";
    let hp = 90;
    let r = 24;

    if (mk === 3) {
      // Ice / crystal theme
      color = "#6fe7ff";
      coreColor = "#d9f4ff";
      ringColor = "#2f8fa8";
      hp = 90;
      r = 24;
    } else if (mk === 4) {
      // Boom / volcanic theme
      color = "#ff7a2a";
      coreColor = "#ffe0a3";
      ringColor = "#ff3d6e";
      hp = 160;
      r = 28;
    } else if (mk === 5) {
      // Core / electric white-violet storm theme
      color = "#f4f7ff";
      coreColor = "#ffffff";
      ringColor = "#b06bff";
      hp = 240;
      r = 32;
    } else if (mk === 6) {
      // THE METEOR / warm radiant solar gold theme
      color = "#ffd27a";
      coreColor = "#fff3b0";
      ringColor = "#ffaa33";
      hp = 330;
      r = 36;
    }

    const x = this.rnd(0.25, 0.75) * this.w;
    const y = this.rnd(0.25, 0.75) * this.h;
    b.hole = {
      id: this.nextId++,
      x,
      y,
      t: dur,
      maxT: dur,
      pull,
      radius,
      hp,
      maxHp: hp,
      flash: 0,
      r,
      color,
      coreColor,
      ringColor,
      mk,
    };
    this.rings.push({ x, y, r: 10, max: 130, life: 0.6, color, w: 3 });
    this.burst(x, y, 18, color);
    this.banner = "SINGULARITY";
    this.bannerSub =
      mk === 6
        ? "PRIMORDIAL GRAVITY · SHOOT TO COLLAPSE"
        : "GRAVITATIONAL ANOMALY · SHOOT TO COLLAPSE";
    this.bannerT = 1.6;
    this.shake += 6;
    this.sound.play("bossCharge");
  }

  damageHole(dmg: number, crit: boolean) {
    const b = this.boss;
    if (!b || !b.hole) return;
    const h = b.hole;
    h.hp -= dmg;
    h.flash = 1;
    this.burst(
      h.x + this.rnd(-h.r, h.r) * 0.4,
      h.y + this.rnd(-h.r, h.r) * 0.4,
      crit ? 8 : 4,
      crit ? AMBER_HOT : h.color,
    );
    this.sound.play(crit ? "crit" : "hit");
    if (crit) this.floatText(h.x, h.y - h.r - 12, "CRIT", AMBER_HOT, 12);
    if (this.p.leech > 0) this.p.hull = Math.min(this.p.maxHull, this.p.hull + dmg * this.p.leech);
    if (h.hp <= 0) {
      this.collapseHole(b);
    }
  }

  collapseHole(b: Boss) {
    const h = b.hole;
    if (!h) return;
    this.rings.push({ x: h.x, y: h.y, r: 8, max: h.r * 3.5, life: 0.45, color: h.color, w: 4 });
    this.rings.push({ x: h.x, y: h.y, r: 16, max: h.r * 6, life: 0.7, color: AMBER_HOT, w: 2 });
    this.burst(h.x, h.y, 40, h.color);
    this.burst(h.x, h.y, 25, AMBER_HOT);
    this.shake += 10;
    this.flashAlpha = 0.4;
    this.floatText(h.x, h.y - h.r - 16, "SINGULARITY COLLAPSED", AMBER_HOT, 15);
    this.sound.play("explodeBig");
    this.score += (200 + h.mk * 100) * (1 + Math.floor(this.combo / 4) * 0.5);
    this.gainXp(30 * this.xpScale());
    b.hole = null;
  }

  updateHole(b: Boss, dt: number) {
    const h = b.hole;
    if (!h) return;
    h.t -= dt;
    h.flash = Math.max(0, h.flash - dt * 4);
    this.forEachPilot(() => {
      const hx = h.x - this.p.x,
        hy = h.y - this.p.y;
      const hd = Math.hypot(hx, hy) || 1;
      // Pulls from anywhere across the sector, accelerating as you get sucked closer
      const pullFalloff = clamp(1 - hd / (Math.max(this.w, this.h) * 1.5), 0.5, 1);
      const strength = h.pull * 1.6 * pullFalloff;
      this.p.vx += (hx / hd) * strength * dt;
      this.p.vy += (hy / hd) * strength * dt;

      const anomaly = GAME_CONFIG.bosses.anomaly;
      if (hd < h.r * anomaly.damageRadiusFraction && h.t > 0) {
        h.damageTimer = (h.damageTimer ?? 0) + dt;
        if (h.damageTimer >= anomaly.damageInterval) {
          h.damageTimer -= anomaly.damageInterval;
          this.damagePlayer(anomaly.damage, "Anomaly core", 0.1);
        }
      } else {
        h.damageTimer = 0;
      }
    });
    // Singularities at higher strengths look cooler: e.g. at MK6 dense golden particles fly rapidly into it
    const pFreq = h.mk === 6 ? 1 : h.mk === 5 ? 1 : 2;
    if (this.frame % pFreq === 0 && this.particles.length < 650) {
      const pCount = h.mk === 6 ? 3 : h.mk === 5 ? 2 : 1;
      for (let i = 0; i < pCount; i++) {
        const a = this.random() * TAU;
        const rr = (h.mk === 6 ? 120 : 70) + this.rnd(20, 120 + h.mk * 25);
        const px = h.x + Math.cos(a) * rr,
          py = h.y + Math.sin(a) * rr;
        const inward = Math.atan2(h.y - py, h.x - px);
        const inSpeed = (h.mk === 6 ? 340 : 180 + h.mk * 30) + this.rnd(-30, 30);
        const pColor =
          h.mk === 6
            ? this.random() < 0.6
              ? "#ffd27a"
              : this.random() < 0.5
                ? "#ffaa33"
                : "#ffe0a3"
            : this.random() < 0.5
              ? h.color
              : h.coreColor;
        this.particles.push({
          x: px,
          y: py,
          vx: Math.cos(inward) * inSpeed,
          vy: Math.sin(inward) * inSpeed,
          life: 0.38,
          max: 0.38,
          size: this.rnd(1.8, 3.2),
          color: pColor,
          drag: 0.98,
        });
      }
    }
    if (h.t <= 0) b.hole = null;
  }

  /** MK6 reinforcement waves, fired once as its health crosses each mark */
  mk6Reinforce(b: Boss, wardens: number, sentinels: number, label: string) {
    // escorts respect the concurrent sentinel cap too
    const room = Math.max(
      0,
      maxSentinels(this.wave) - this.drones.filter((dd) => dd.kind === "sentinel").length,
    );
    sentinels = Math.min(sentinels, room);
    for (let i = 0; i < wardens; i++) {
      const a = (i / Math.max(1, wardens)) * TAU + this.rnd(-0.3, 0.3);
      this.drones.push(
        this.spawnDrone(
          clamp(b.x + Math.cos(a) * 240, 40, this.w - 40),
          clamp(b.y + Math.sin(a) * 200, 40, this.h - 40),
          190 + scaledWave(this.wave) * 22,
          "warden",
        ),
      );
    }
    for (let i = 0; i < sentinels; i++) {
      const a = (i / Math.max(1, sentinels)) * TAU + this.rnd(-0.4, 0.4);
      this.drones.push(
        this.spawnDrone(
          clamp(b.x + Math.cos(a) * 320, 40, this.w - 40),
          clamp(b.y + Math.sin(a) * 270, 40, this.h - 40),
          70 + scaledWave(this.wave) * 11,
        ),
      );
    }
    // MK6 keeps at most one radial heavy alive across reinforcement calls.
    const hasSpiker = this.drones.some((d) => d.kind === "spiker");
    const spikers = hasSpiker ? 0 : this.spawnSpikers(1);
    this.banner = label + (spikers ? " + SPIKER" : "");
    this.bannerSub = "THE METEOR CALLS ITS ESCORT";
    this.bannerT = 2.2;
    this.flashAlpha = 0.45;
    this.shake += 10;
    this.sound.play("bossCharge");
  }

  /**
   * Stage change: the dreadnought detonates every rock on the field, then
   * opens its new attack set. Each MK has its own signature —
   *  MK1 rain from above · MK2 a converging homing swarm (centre lethal,
   *  edges safe) · MK3 one edge blasted while the other is safe ·
   *  MK4 telegraphed ignition strikes near the player · MK5 a meteor wall
   *  sweeping in from one side.
   */
  startSignature(b: Boss, phase: number) {
    let purged = 0;
    for (const r of this.rocks) {
      if (isEventRock(r.trait) || r.keep) continue; // shower debris is not the boss's to claim; timed ability rocks run out their own clock
      this.burst(r.x, r.y, 5, TRAIT_COLOR[r.trait]);
      purged++;
    }
    if (purged) {
      this.rocks = this.rocks.filter((r) => isEventRock(r.trait) || r.keep);
      this.score += purged * 10;
      this.rings.push({
        x: this.w / 2,
        y: this.h / 2,
        r: 40,
        max: Math.max(this.w, this.h) * 0.7,
        life: 0.7,
        color: b.edgeColor,
        w: 3,
      });
    }
    this.shake += 12;
    this.flashAlpha = 0.45;
    this.sound.play("bossCharge");
    const names: Record<number, string> = {
      1: "BARRAGE SWEEP",
      2: "CONVERGENCE",
      3: "PINBALL CASCADE",
      4: "IGNITION STRIKES",
      5: "METEOR WALL",
    };
    this.banner = names[b.mk];
    this.bannerSub = `${b.name} ${b.suffix.split(" ")[0]} · NEW ATTACK SET`;
    this.bannerT = 1.9;

    this.spawnBossAbilityRock(b);
    switch (b.mk) {
      case 1:
        b.rainN = 9 + phase * 3;
        b.rainT = 0.3;
        break;
      case 2: {
        // a ring of homing shards around the hull — they all come for the player
        const n = 6 + phase * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          this.addRocks(
            this.makeRock(
              clamp(b.x + Math.cos(a) * 250, 40, this.w - 40),
              clamp(b.y + Math.sin(a) * 250, 40, this.h - 40),
              this.rollRockSize(),
              Math.cos(a) * 40,
              Math.sin(a) * 40,
              "homing",
            ),
          );
        }
        break;
      }
      case 3: {
        // PINBALL CASCADE — the boss charges, then volleys bounce rocks that
        // ricochet off every wall. Rocks arrive from randomized launch points
        // at randomized angles, so each wave of the fight plays out differently.
        // The field is capped hard so this never becomes a rock blizzard.
        b.cascadeN = 4 + phase;
        b.cascadeT = 0.55;
        b.cascadeCharge = 0.85;
        break;
      }
      case 4: {
        // one strike locks near the player, the rest are random field points
        const n = phase >= 2 ? 4 : 3;
        b.strikes = [];
        // More frequent strikes leave enough warning to escape their smaller blast.
        for (let i = 0; i < n; i++) {
          const near = i === 0;
          const countdown = GAME_CONFIG.bosses.mk4.strikeWarning + i * 0.3;
          b.strikes.push({
            x: clamp(
              near ? this.p.x + this.rnd(-1, 1) * 140 : this.rnd(80, this.w - 80),
              60,
              this.w - 60,
            ),
            y: clamp(
              near ? this.p.y + this.rnd(-1, 1) * 140 : this.rnd(80, this.h - 80),
              60,
              this.h - 60,
            ),
            t: countdown,
            t0: countdown,
          });
        }
        break;
      }
      case 5:
        b.wallT = 3.6;
        b.wallN = 9 + phase * 3;
        b.wallSide = phase === 1 ? -1 : 1;
        break;
    }
  }

  /* ------------------------------------------------------------ MK6: THE METEOR */

  /** clear any leftover transient field rocks from the previous attack set */
  clearMk6Field(b: Boss) {
    const m = b.mk6;
    if (!m || !m.fieldIds.length) return;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      if (m.fieldIds.includes(this.rocks[i].id)) {
        this.burst(this.rocks[i].x, this.rocks[i].y, 7, "#ffd27a");
        this.rocks.splice(i, 1);
      }
    }
    m.fieldIds = [];
  }

  /** build a fresh attack set into the given slot */
  mk6Begin(b: Boss, attack: Exclude<Mk6Attack, "idle">, slotIndex = 0) {
    const m = b.mk6;
    if (!m) return;
    const slot = m.slots[slotIndex];
    if (!slot) return;
    slot.attack = attack;
    m.lastAttack = attack;
    slot.spawnT = 0;
    slot.strikes = [];
    slot.healBlasts = [];
    const labels: Record<Exclude<Mk6Attack, "idle">, string> = {
      shower: "METEOR SHOWER",
      barrage: "METEOR BARRAGE",
      beam: "METEOR BEAM",
      strikes: "METEOR STRIKES",
      field: "ASTEROID FIELD",
      hole: "SINGULARITY",
      heal: "REGENESIS",
    };
    slot.label = labels[attack];
    this.banner =
      m.slots
        .filter((s) => s.attack !== "idle")
        .map((s) => s.label || labels[attack])
        .join(" + ") || labels[attack];
    this.bannerSub = m.enraged ? "THE METEOR MK6 · ENRAGED" : "THE METEOR MK6";
    this.bannerT = 1.7;
    this.shake += 8;
    this.flashAlpha = 0.35;

    this.spawnBossAbilityRock(b);
    switch (attack) {
      case "shower":
        slot.t = 6.2;
        break;
      case "barrage":
        slot.t = 6.2;
        break;
      case "beam":
        slot.t = 8.5;
        slot.beamA = this.random() * TAU;
        this.sound.play("bossCharge");
        break;
      case "strikes": {
        slot.t = 5.4;
        const n = 5;
        for (let i = 0; i < n; i++) {
          const near = i % 2 === 0;
          const countdown = 2.4 + i * 0.5;
          slot.strikes.push({
            x: clamp(
              near ? this.p.x + this.rnd(-1, 1) * 190 : this.rnd(90, this.w - 90),
              70,
              this.w - 70,
            ),
            y: clamp(
              near ? this.p.y + this.rnd(-1, 1) * 190 : this.rnd(90, this.h - 90),
              70,
              this.h - 70,
            ),
            t: countdown,
            t0: countdown,
            r: this.rnd(150, 215),
          });
        }
        this.sound.play("bossCharge");
        break;
      }
      case "field": {
        slot.t = 7.5;
        const traits: RockTrait[] = ["none", "homing", "bounce", "boom", "fast"];
        for (let i = 0; i < 12; i++) {
          let x = 0,
            y = 0,
            tries = 0;
          do {
            x = this.rnd(50, this.w - 50);
            y = this.rnd(50, this.h - 50);
            tries++;
          } while (Math.hypot(x - this.p.x, y - this.p.y) < 220 && tries < 12);
          const size = this.rollRockSize();
          const availableTraits =
            this.boomRoom() === 0 ? traits.filter((trait) => trait !== "boom") : traits;
          const rock = this.makeRock(
            x,
            y,
            size,
            this.rnd(-120, 120),
            this.rnd(-120, 120),
            availableTraits[Math.floor(this.random() * availableTraits.length)],
          );
          rock.hp = rock.maxHp = rock.maxHp * 0.6; // transient, meant to be cleared
          m.fieldIds.push(rock.id);
          this.addRocks(rock);
        }
        this.sound.play("explodeSmall");
        break;
      }
      case "hole":
        // MK6 singularity: pulls from anywhere across the sector, longest duration
        slot.t = 7.5;
        this.mkHole(b, 420, 7.5, Math.max(this.w, this.h) * 1.5);
        break;
      case "heal":
        // three blasts: two close together, the third lands late as a trap
        slot.t = 6.4;
        slot.healBlasts = [
          { t: 1.1, fired: false },
          { t: 2.1, fired: false },
          { t: 4.4, fired: false, silent: true },
        ];
        this.sound.play("bossCharge");
        break;
    }
  }

  /** run one active attack set */
  runMk6Slot(b: Boss, slot: Mk6Slot, dt: number) {
    const m = b.mk6!;
    switch (slot.attack) {
      case "shower":
        slot.spawnT -= dt;
        if (slot.spawnT <= 0) {
          slot.spawnT = 0.34;
          this.spawnMeteor(-1);
        }
        break;
      case "barrage":
        slot.spawnT -= dt;
        if (slot.spawnT <= 0) {
          slot.spawnT = 0.34;
          // straight down the sector, top to bottom
          const x = this.rnd(50, this.w - 50);
          const rock = this.makeRock(
            x,
            -50,
            this.rollRockSize(),
            this.rnd(-40, 40),
            this.rnd(520, 660),
            "meteor",
          );
          rock.r *= 1.35;
          rock.hp = rock.maxHp = 120 + scaledWave(this.wave) * 4;
          rock.rotSpeed = this.rnd(4, 8);
          this.addRocks(rock);
        }
        break;
      case "beam": {
        // deliberately gentle: a slow sweep you can walk out of, and light
        // contact ticks on a long immunity window so it can never stack
        slot.beamA += dt * 0.24;
        // enraged: eight arms at 45°; otherwise four at 90°, sweeping
        const arms = m.enraged ? 8 : 4;
        const len = Math.max(this.w, this.h) * 1.2;
        for (let i = 0; i < arms; i++) {
          const a = slot.beamA + i * (TAU / arms);
          const dx = Math.cos(a),
            dy = Math.sin(a);
          this.forEachPilot(() => {
            const rx = this.p.x - b.x,
              ry = this.p.y - b.y;
            const t = rx * dx + ry * dy;
            if (t > 0 && t < len && Math.abs(rx * dy - ry * dx) < 16 && m.beamCd <= 0) {
              this.damagePlayer(9, "MK6 solar beam");
              m.beamCd = 0.6;
            }
          });
          if (this.frame % 3 === 0) {
            const d = this.rnd(b.r, len * 0.5);
            this.particles.push({
              x: b.x + dx * d,
              y: b.y + dy * d,
              vx: this.rnd(-20, 20),
              vy: this.rnd(-20, 20),
              life: 0.3,
              max: 0.3,
              size: 2,
              color: "#ffd27a",
              drag: 0.9,
            });
          }
        }
        break;
      }
      case "strikes":
        for (let i = slot.strikes.length - 1; i >= 0; i--) {
          const s = slot.strikes[i];
          s.t -= dt;
          if (s.t <= 0) {
            slot.strikes.splice(i, 1);
            this.explode(s.x, s.y, s.r, 74, "MK6 meteor strike");
            this.shatterMeteor(s.x, s.y, 0, 0);
            this.forEachPilot(() => {
              if (Math.hypot(this.p.x - s.x, this.p.y - s.y) < s.r)
                this.damagePlayer(30, "MK6 meteor strike");
            });
          }
        }
        break;
      case "heal":
        for (const hb of slot.healBlasts) {
          if (hb.fired) continue;
          hb.t -= dt;
          if (hb.t <= 0) {
            hb.fired = true;
            // regenesis: the blasts grant a +10% shield buffer, never more
            const hadShield = b.shieldHp > 0;
            b.shieldHp = Math.max(b.shieldHp, 0.1 * b.maxHp);
            b.shieldT = 30;
            if (!hadShield) this.floatText(b.x, b.y - b.r - 20, "SINGULARITY SHIELD +10%", ICE, 15);
            const radius = 390;
            // Larger red blast with an orange warning aura
            this.rings.push({
              x: b.x,
              y: b.y,
              r: 25,
              max: radius * 1.6,
              life: 0.85,
              color: "#ff2244",
              w: 6,
            });
            this.rings.push({
              x: b.x,
              y: b.y,
              r: 10,
              max: radius * 1.25,
              life: 0.65,
              color: "#ff8800",
              w: 3,
            });
            this.burst(b.x, b.y, 55, "#ff2244");
            this.burst(b.x, b.y, 35, "#ff8800");
            this.shake += 14;
            this.sound.play("explodeBig");
            this.forEachPilot(() => {
              if (Math.hypot(this.p.x - b.x, this.p.y - b.y) < radius)
                this.damagePlayer(28, "MK6 regenesis blast");
            });
          }
        }
        break;
      case "hole":
        // the singularity persists for the whole set; pull handled in updateHole
        if (!b.hole) this.mkHole(b, 420, slot.t, Math.max(this.w, this.h) * 1.5);
        break;
    }
  }

  updateMk6(b: Boss, dt: number) {
    const m = b.mk6;
    if (!m) return;
    const ratio = b.hp / b.maxHp;

    // At 50% THE METEOR prepares its side-raid, but never interrupts an
    // already-running ability. Finished slots go idle until movement sees the
    // entire board is clear and begins the disappearance sequence.
    if (ratio <= 0.5 && !b.movement.mk6RaidDone) b.movement.mk6RaidPending = true;

    // ---- escort reinforcement marks, each fired exactly once ----
    const marks: { at: number; wardens: number; sentinels: number; label: string }[] = [
      { at: 0.8, wardens: 2, sentinels: 0, label: "ESCORT · 2 WARDENS" },
      { at: 0.5, wardens: 2, sentinels: 4, label: "ESCORT · 2 WARDENS + 4 SENTINELS" },
      { at: 0.3, wardens: 3, sentinels: 0, label: "ESCORT · 3 WARDENS" },
    ];
    for (const mark of marks) {
      if (ratio <= mark.at && !m.reinforced.includes(mark.at)) {
        m.reinforced.push(mark.at);
        this.mk6Reinforce(b, mark.wardens, mark.sentinels, mark.label);
      }
    }

    // ---- phase 2: once the 50% hull lock ends (the raid is over) it runs two attack sets at once ----
    if (!m.enraged && b.movement.mk6RaidDone) {
      m.enraged = true;
      m.slots.push({
        attack: "idle",
        label: "",
        t: 0.4,
        spawnT: 0,
        beamA: 0,
        strikes: [],
        healBlasts: [],
      });
      this.banner = "THE METEOR ENRAGED";
      this.bannerSub = "TWO ATTACK SETS AT ONCE";
      this.bannerT = 2.4;
      this.flashAlpha = 0.6;
      this.shake += 16;
      this.sound.play("bossCharge");
    }

    // the singularity and the beam immunity window advance with the boss
    if (b.hole) this.updateHole(b, dt);
    if (b.shieldT > 0) {
      b.shieldT -= dt;
      if (b.shieldT <= 0) b.shieldHp = 0;
    }
    this.updateBossContactCooldown(b, dt);

    const active = () => m.slots.filter((s) => s.attack !== "idle").map((s) => s.attack);
    for (let i = 0; i < m.slots.length; i++) {
      const slot = m.slots[i];
      slot.t -= dt;
      if (slot.attack !== "idle") this.runMk6Slot(b, slot, dt);
      if (slot.t > 0) continue;

      // This set is finished. If the phase-shift is pending, let it go idle
      // instead of starting another ability; movement will wait for every slot.
      if (slot.attack === "field") this.clearMk6Field(b);
      if (slot.attack === "hole") b.hole = null;
      slot.attack = "idle";
      if (b.movement.mk6RaidPending && !b.movement.mk6RaidDone) continue;
      const running = active();
      const pool: Exclude<Mk6Attack, "idle">[] = [
        "shower",
        "barrage",
        "beam",
        "strikes",
        "field",
        "hole",
      ];
      // the meteor beam is its signature: weighted to roughly half of all picks
      for (let i = 0; i < 5; i++) pool.push("beam");
      // regenesis is common: a doubled weight while the shield isn't up yet
      if (ratio < 0.85 && b.shieldHp <= 0) {
        pool.push("heal");
        pool.push("heal");
      }
      // Never repeat the ability that just finished, and never overlap the same
      // ability across the currently active sets.
      const choices = pool.filter((a) => a !== m.lastAttack && !running.includes(a));
      const fallback = pool.filter((a) => a !== m.lastAttack);
      const source = choices.length ? choices : fallback.length ? fallback : pool;
      const next = source[Math.floor(this.random() * source.length)];
      this.mk6Begin(b, next, i);
    }
  }

  /* ------------------------------------------------------------ boss movement */

  bossBounds(b: Boss) {
    return {
      minX: b.r + 30,
      maxX: this.w - b.r - 30,
      minY: b.r * 0.5 + 70,
      maxY: this.h - b.r - 40,
    };
  }

  clampBossToArena(b: Boss) {
    const bounds = this.bossBounds(b);
    b.x = clamp(b.x, bounds.minX, bounds.maxX);
    b.y = clamp(b.y, bounds.minY, bounds.maxY);
  }

  mk6AbilitiesClear(b: Boss) {
    const m = b.mk6;
    return (
      !!m && m.slots.every((slot) => slot.attack === "idle") && !b.hole && m.fieldIds.length === 0
    );
  }

  spawnMk6RaidMeteors(b: Boss, side: -1 | 1) {
    // side < 0 is LEFT edge of screen -> launches into arena towards +X (inward = 1).
    // side > 0 is RIGHT edge of screen -> launches into arena towards -X (inward = -1).
    const inward = side < 0 ? 1 : -1;
    // A broad shower: medium meteors traverse separate screen-height lanes.
    const count = 3;
    for (let i = 0; i < count; i++) {
      const startX = side < 0 ? -60 : this.w + 60;
      const startY = ((i + this.rnd(0.1, 0.9)) / count) * this.h;
      const rock = this.makeRock(startX, startY, 2, 300 * inward, 0, "meteor");
      rock.hp = rock.maxHp = 120 + scaledWave(this.wave) * 4;
      rock.rotSpeed = this.rnd(5, 9) * inward;
      this.addRocks(rock);
    }
    this.rings.push({
      x: b.x + inward * b.r * 0.5,
      y: b.y,
      r: 12,
      max: 68,
      life: 0.28,
      color: "#ffd27a",
      w: 2.5,
    });
    this.sound.play("bossCharge");
  }

  triggerMk4ProximityStrikes(b: Boss) {
    this.spawnBossAbilityRock(b);
    const n = b.hp / b.maxHp < 0.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = this.random() * TAU;
      const radius = this.rnd(b.r * 1.5, b.r * 2.7);
      const countdown = GAME_CONFIG.bosses.mk4.strikeWarning + i * 0.3;
      b.strikes.push({
        x: clamp(b.x + Math.cos(a) * radius, 60, this.w - 60),
        y: clamp(b.y + Math.sin(a) * radius, 60, this.h - 60),
        t: countdown,
        t0: countdown,
      });
    }
    this.rings.push({ x: b.x, y: b.y, r: 8, max: b.r * 2.9, life: 0.42, color: ORANGE, w: 2 });
    this.sound.play("bossCharge");
  }

  /** Returns true only while MK6 is in an exclusive side-raid movement sequence. */
  updateBossMovement(b: Boss, dt: number) {
    const p = this.p;
    const m = b.movement;
    const bounds = this.bossBounds(b);

    if (b.mk === 6) {
      const ratio = b.hp / b.maxHp;
      if (
        m.mode === "drift" &&
        !m.mk6RaidDone &&
        ratio <= 0.5 &&
        m.mk6RaidPending &&
        this.mk6AbilitiesClear(b)
      ) {
        m.mode = "mk6Vanish";
        m.timer = 1.45;
        // When MK6 returns, it returns directly to the center of the map
        m.targetX = this.w / 2;
        m.targetY = this.h / 2;
        m.raidMeteorT = 0;
        this.banner = "METEOR PHASE SHIFT";
        this.bannerSub = "THE METEOR LEAVES THE SECTOR";
        this.bannerT = 2;
        this.flashAlpha = 0.45;
        this.sound.play("bossCharge");
      }

      if (m.mode === "mk6Vanish") {
        m.timer -= dt;
        b.x = -b.r * 3;
        b.y = -b.r * 3;
        if (m.timer <= 0) {
          m.mode = "mk6Left";
          m.timer = 2.2;
          m.raidMeteorT = 0;
          b.x = bounds.minX;
          b.y = clamp(this.h * this.rnd(0.35, 0.65), bounds.minY, bounds.maxY);
          b.rot = 0; // Face inwards towards right into the arena
          b.rotSpeed = 0;
          this.banner = "METEOR AMBUSH · LEFT";
          this.bannerSub = "INCOMING METEOR SALVO";
          this.bannerT = 1.2;
        }
        return true;
      }

      if (m.mode === "mk6Left" || m.mode === "mk6Right") {
        const side: -1 | 1 = m.mode === "mk6Left" ? -1 : 1;
        b.x = side < 0 ? bounds.minX : bounds.maxX;
        // Lock rotation to face inward towards the arena
        b.rot = side < 0 ? 0 : Math.PI;
        b.rotSpeed = 0;
        m.timer -= dt;
        m.raidMeteorT -= dt;
        if (m.raidMeteorT <= 0) {
          m.raidMeteorT = 0.22;
          this.spawnMk6RaidMeteors(b, side);
        }
        if (m.timer <= 0) {
          if (m.mode === "mk6Left") {
            m.mode = "mk6Right";
            m.timer = 2.2;
            m.raidMeteorT = 0;
            b.x = bounds.maxX;
            b.y = clamp(this.h * this.rnd(0.35, 0.65), bounds.minY, bounds.maxY);
            b.rot = Math.PI; // Face inwards towards left into the arena
            b.rotSpeed = 0;
            this.banner = "METEOR AMBUSH · RIGHT";
            this.bannerSub = "INCOMING METEOR SALVO";
            this.bannerT = 1.2;
          } else {
            m.mode = "mk6ReturnTelegraph";
            m.timer = 1.3;
            m.targetX = this.w / 2;
            m.targetY = this.h / 2;
            this.banner = "METEOR RETURN VECTOR";
            this.bannerSub = "CORE SIGNATURE RE-ENTERING CENTER";
            this.bannerT = 1.3;
          }
        }
        return true;
      }

      if (m.mode === "mk6ReturnTelegraph") {
        m.timer -= dt;
        if (m.timer <= 0) m.mode = "mk6Return";
        return true;
      }

      if (m.mode === "mk6Return") {
        const dx = m.targetX - b.x;
        const dy = m.targetY - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 1050;
        b.x += (dx / dist) * speed * dt;
        b.y += (dy / dist) * speed * dt;
        b.rot = Math.atan2(dy, dx);
        if (dist < 28) {
          // Re-center in the exact center of the map
          b.x = this.w / 2;
          b.y = this.h / 2;
          b.vx = 0;
          b.vy = 0;
          b.rotSpeed = this.rnd(0.25, 0.4) * (this.random() < 0.5 ? -1 : 1);
          m.mode = "drift";
          m.mk6RaidDone = true;
          m.mk6RaidPending = false;
          this.banner = "THE METEOR RETURNS";
          this.bannerSub = "PRIMORDIAL CATACLYSM RESUMES";
          this.bannerT = 1.6;
          this.flashAlpha = 0.55;
          this.shake += 12;
        }
        return true;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.clampBossToArena(b);
      return false;
    }

    if (b.mk === 1) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < bounds.minX) {
        b.x = bounds.minX;
        b.vx = Math.abs(b.vx);
      }
      if (b.x > bounds.maxX) {
        b.x = bounds.maxX;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < bounds.minY) {
        b.y = bounds.minY;
        b.vy = Math.abs(b.vy);
      }
      if (b.y > bounds.maxY) {
        b.y = bounds.maxY;
        b.vy = -Math.abs(b.vy);
      }
      return false;
    }

    if (b.mk === 2) {
      const a = Math.atan2(p.y - b.y, p.x - b.x);
      b.vx += Math.cos(a) * 26 * dt;
      b.vy += Math.sin(a) * 26 * dt;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 58) {
        b.vx = (b.vx / speed) * 58;
        b.vy = (b.vy / speed) * 58;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.clampBossToArena(b);
      return false;
    }

    if (b.mk === 3) {
      const base = m.baseSpeed || 110;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let hit = false;
      if (b.x <= bounds.minX) {
        b.x = bounds.minX;
        b.vx = Math.abs(b.vx);
        hit = true;
      } else if (b.x >= bounds.maxX) {
        b.x = bounds.maxX;
        b.vx = -Math.abs(b.vx);
        hit = true;
      }
      if (b.y <= bounds.minY) {
        b.y = bounds.minY;
        b.vy = Math.abs(b.vy);
        hit = true;
      } else if (b.y >= bounds.maxY) {
        b.y = bounds.maxY;
        b.vy = -Math.abs(b.vy);
        hit = true;
      }
      if (hit) {
        m.bounceBoost = Math.min(1.15, m.bounceBoost * 1.03);
        const speed = base * m.bounceBoost;
        const curSpd = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / curSpd) * speed;
        b.vy = (b.vy / curSpd) * speed;
        b.rotSpeed = -b.rotSpeed; // Reverse spin on wall impact
        this.rings.push({ x: b.x, y: b.y, r: 16, max: 74, life: 0.35, color: ICE, w: 3 });
        this.burst(b.x, b.y, 14, ICE);
        this.shake += 3;
        this.sound.play("ricochet");
      }
      return false;
    }

    if (b.mk === 4) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const away = Math.atan2(dy, dx);
      const radial = dist < 520 ? 105 : dist > 760 ? -28 : 0;
      const strafe = Math.sin(b.t * 0.7 + b.id) * 46;
      b.vx += (Math.cos(away) * radial + Math.cos(away + Math.PI / 2) * strafe) * dt;
      b.vy += (Math.sin(away) * radial + Math.sin(away + Math.PI / 2) * strafe) * dt;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 78) {
        b.vx = (b.vx / speed) * 78;
        b.vy = (b.vy / speed) * 78;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.clampBossToArena(b);
      m.mk4StrikeCd -= dt;
      if (m.mk4StrikeCd <= 0 && this.mode === "playing") {
        m.mk4StrikeCd = b.hp / b.maxHp < 0.5 ? 2.7 : 3.6;
        this.triggerMk4ProximityStrikes(b);
      }
      return false;
    }

    if (b.mk === 5) {
      if (m.mode === "drift") {
        m.timer -= dt;
        if (m.timer <= 0) {
          let attempts = 0;
          do {
            m.targetX = this.rnd(bounds.minX, bounds.maxX);
            m.targetY = this.rnd(bounds.minY, bounds.maxY);
            attempts++;
          } while (Math.hypot(m.targetX - b.x, m.targetY - b.y) < 280 && attempts < 12);
          m.startX = b.x;
          m.startY = b.y;
          m.mode = "mk5Telegraph";
          m.timer = 2.4;
          m.timerTotal = 2.4;
          this.banner = "CORE VECTOR LOCK";
          this.bannerSub = "DASH TRAJECTORY MARKED";
          this.bannerT = 2.4;
          this.sound.play("bossCharge");
        }
      } else if (m.mode === "mk5Telegraph") {
        m.timer -= dt;
        if (m.timer <= 0) m.mode = "mk5Dash";
      } else if (m.mode === "mk5Dash") {
        const dx = m.targetX - b.x;
        const dy = m.targetY - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 1250;
        b.x += (dx / dist) * speed * dt;
        b.y += (dy / dist) * speed * dt;
        if (dist < 34) {
          b.x = m.targetX;
          b.y = m.targetY;
          b.vx = 0;
          b.vy = 0;
          m.mode = "drift";
          m.timer = this.rnd(2.6, 4.6);
          this.rings.push({ x: b.x, y: b.y, r: 8, max: 96, life: 0.35, color: b.edgeColor, w: 3 });
          this.shake += 6;
        }
      }
      this.clampBossToArena(b);
    }

    return false;
  }

  updateBoss(b: Boss, dt: number) {
    b.t += dt;
    b.rot += b.rotSpeed * dt;
    b.flash = Math.max(0, b.flash - dt * 3);
    // Movement is independent from normal boss attacks. Only the MK6 side-raid
    // is exclusive, and it returns true to pause ability scheduling.
    const movementExclusive = this.updateBossMovement(b, dt);
    if (movementExclusive) return;

    const ratio = b.hp / b.maxHp;
    const phase = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;

    // the harbinger runs an entirely separate, meteor-themed rotation
    if (b.mk6) {
      this.updateMk6(b, dt);
      return;
    }

    // stage change: purge the field and start the MK's new signature set
    if (phase > b.phase) {
      b.phase = phase;
      this.startSignature(b, phase);
    }

    // shockwave blast telegraphed around the boss; detonates when the clock hits zero
    if (b.shockT > 0) {
      b.shockT -= dt;
      if (b.shockT <= 0) {
        const radius = b.shockRadius || 250;
        for (let i = 0; i < 3; i++) {
          this.rings.push({
            x: b.x,
            y: b.y,
            r: 10 + i * 16,
            max: radius * (1.1 + i * 0.14),
            life: 0.5 + i * 0.14,
            color: ORANGE,
            w: 3,
          });
        }
        this.burst(b.x, b.y, 40, ORANGE);
        this.shake += 12;
        this.sound.play("explodeBig");
        this.forEachPilot(() => {
          if (Math.hypot(this.p.x - b.x, this.p.y - b.y) < radius + 18)
            this.damagePlayer(22, `MK${b.mk} boss shockwave`);
        });
        if (
          this.salvageDrone.active &&
          Math.hypot(this.salvageDrone.x - b.x, this.salvageDrone.y - b.y) < radius + 18
        ) {
          this.damageSalvageDrone(22);
        }
      }
    }

    // the singularity drags the player while it exists
    if (b.hole) this.updateHole(b, dt);

    // ---- signature attack sets ------------------------------------------
    // MK1 · Barrage Sweep — rocks rain from the top of the sector
    if (b.rainN > 0) {
      b.rainT -= dt;
      if (b.rainT <= 0) {
        if (this.rocks.filter((r) => !isEventRock(r.trait)).length < BOSS_ROCK_CAP) {
          const x = this.rnd(50, this.w - 50);
          this.addRocks(
            this.makeRock(
              x,
              -30,
              this.rollRockSize(),
              this.rnd(-30, 30),
              this.rnd(130, 200),
              this.random() < 0.5 && b.spawnTrait !== "none" ? b.spawnTrait : "none",
            ),
          );
          b.rainN--;
        }
        b.rainT = 0.34;
      }
    }
    // ---- MK3 · PINBALL CASCADE -------------------------------------------
    // A telegraphed charge, then a short volley of bounce rocks launched from
    // randomized edge points at randomized angles. Every rock ricochets off the
    // arena walls, gaining speed as it goes, so the arena keeps changing shape
    // and no two attempts feel the same. Launches are strictly capped.
    if (b.cascadeCharge > 0) {
      b.cascadeCharge -= dt;
      // charge telegraph: a tightening ring around the boss
      if (this.frame % 2 === 0) {
        this.particles.push({
          x: b.x + this.rnd(-b.r, b.r) * 1.4,
          y: b.y + this.rnd(-b.r, b.r) * 1.4,
          vx: this.rnd(-40, 40),
          vy: this.rnd(-40, 40),
          life: 0.3,
          max: 0.3,
          size: 2.4,
          color: ICE,
          drag: 0.92,
        });
      }
    }
    if (b.cascadeN > 0) {
      b.cascadeT -= dt;
      if (b.cascadeT <= 0) {
        b.cascadeT = 0.55;
        // Count only non-event rocks so this never stacks into a blizzard.
        const live = this.rocks.filter((r) => !isEventRock(r.trait)).length;
        if (live < BOSS_ROCK_CAP) {
          // Randomized spawn edge + randomized inward angle = a different
          // pattern every single time the ability fires.
          const edge = Math.floor(this.random() * 4);
          let x = 0,
            y = 0,
            baseA = 0;
          if (edge === 0) {
            x = this.rnd(60, this.w - 60);
            y = -24;
            baseA = Math.PI / 2;
          } else if (edge === 1) {
            x = this.w + 24;
            y = this.rnd(60, this.h - 60);
            baseA = Math.PI;
          } else if (edge === 2) {
            x = this.rnd(60, this.w - 60);
            y = this.h + 24;
            baseA = -Math.PI / 2;
          } else {
            x = -24;
            y = this.rnd(60, this.h - 60);
            baseA = 0;
          }
          const a = baseA + this.rnd(-0.55, 0.55);
          const speed = this.rnd(215, 275);
          const cascadeRock = this.makeRock(
            x,
            y,
            this.rollRockSize(),
            Math.cos(a) * speed,
            Math.sin(a) * speed,
            "bounce",
          );
          cascadeRock.life = BOSS_ROCK_LIFESPAN;
          cascadeRock.keep = true;
          this.addRocks(cascadeRock);
          this.rings.push({ x, y, r: 6, max: 40, life: 0.28, color: ICE, w: 2 });
          this.sound.play("ricochet");
          b.cascadeN--;
        } else {
          // field is full — hold the remaining launches rather than flooding
          b.cascadeT = 0.9;
        }
      }
    }

    // ---- MK3 · RICOCHET RING ---------------------------------------------
    // The boss forms a ring of bounce rocks that orbit it, then fires them
    // outward one at a time with each rock mirror-aimed at the player's current
    // position. Because the ring rotates while it forms and the player keeps
    // moving, every launch angle is different.
    if (b.ricochetRing > 0) {
      b.ricochetPhase += dt * 0.85;
      b.ricochetT -= dt;
      if (b.ricochetT <= 0 && b.ricochetFired < b.ricochetRing) {
        b.ricochetT = 0.34;
        b.ricochetFired++;
        // Aim from the current orbital position of the next rock in the ring
        const slot = b.ricochetFired - 1;
        const ringA = b.ricochetPhase + (slot / b.ricochetRing) * TAU;
        const ox = b.x + Math.cos(ringA) * (b.r + 58);
        const oy = b.y + Math.sin(ringA) * (b.r + 58);
        // Mirror-aim: fire toward the player, but the launch point varies
        const aimA = Math.atan2(this.p.y - oy, this.p.x - ox) + this.rnd(-0.12, 0.12);
        const speed = this.rnd(235, 285);
        const ringRock = this.makeRock(
          clamp(ox, 24, this.w - 24),
          clamp(oy, 24, this.h - 24),
          this.rollRockSize(),
          Math.cos(aimA) * speed,
          Math.sin(aimA) * speed,
          "bounce",
        );
        ringRock.life = BOSS_ROCK_LIFESPAN;
        ringRock.keep = true;
        this.addRocks(ringRock);
        this.rings.push({ x: ox, y: oy, r: 5, max: 36, life: 0.26, color: ICE, w: 2 });
        this.sound.play("ricochet");
        b.ricochetRing--;
      }
    }
    // MK5 · Meteor Wall — a fast-rock wall sweeps across from one edge.
    // Wall rocks carry a ~20s lifetime so a big wall can never clog the arena.
    if (b.wallT > 0 && b.wallN > 0) {
      b.wallT -= dt;
      if (this.frame % 9 === 0) {
        const fromLeft = b.wallSide === -1;
        const y = this.random() * this.h;
        const rock = this.makeRock(
          fromLeft ? -30 : this.w + 30,
          y,
          this.rollRockSize(),
          (fromLeft ? 1 : -1) * this.rnd(240, 320),
          this.rnd(-40, 40),
          "fast",
        );
        rock.life = 20;
        this.addRocks(rock);
        b.wallN--;
      }
    }
    // MK4 · Boom Launch — each marked point turns into a boom rock when its warning ends
    for (let i = b.boomDrops.length - 1; i >= 0; i--) {
      const d = b.boomDrops[i];
      d.t -= dt;
      if (d.t > 0) continue;
      b.boomDrops.splice(i, 1);
      if (this.boomRoom() <= 0) continue;
      // never materialise on top of the ship
      let x = d.x,
        y = d.y;
      const dist = Math.hypot(x - this.p.x, y - this.p.y) || 1;
      if (dist < 170) {
        x = clamp(this.p.x + ((x - this.p.x) / dist) * 170, 40, this.w - 40);
        y = clamp(this.p.y + ((y - this.p.y) / dist) * 170, 40, this.h - 40);
      }
      const a = this.random() * TAU;
      const size = (1 + Math.floor(this.random() * 3)) as 1 | 2 | 3;
      const rock = this.makeRock(x, y, size, Math.cos(a) * 60, Math.sin(a) * 60, "boom");
      rock.life = BOSS_ROCK_LIFESPAN;
      rock.keep = true;
      this.addRocks(rock);
      this.rings.push({ x, y, r: 6, max: 70, life: 0.35, color: ORANGE, w: 2.5 });
      this.burst(x, y, 10, ORANGE);
    }
    // MK4 · Ignition Strikes — telegraphed impact points detonate in sequence
    for (let i = b.strikes.length - 1; i >= 0; i--) {
      const s = b.strikes[i];
      s.t -= dt;
      if (s.t <= 0) {
        b.strikes.splice(i, 1);
        this.explode(
          s.x,
          s.y,
          GAME_CONFIG.bosses.mk4.strikeRadius,
          62,
          `MK${b.mk} ignition strike`,
          0,
        );
        this.forEachPilot(() => {
          if (Math.hypot(this.p.x - s.x, this.p.y - s.y) < GAME_CONFIG.bosses.mk4.strikeRadius)
            this.damagePlayer(GAME_CONFIG.bosses.mk4.strikeDamage, `MK${b.mk} ignition strike`);
        });
      }
    }

    b.attackTimer -= dt;
    if (b.attackTimer > 0 || this.mode !== "playing") return;
    // each MK keeps its own tempo
    b.attackTimer = ((b.final ? 1.9 : 2.6) - phase * 0.55) * b.timerMul;

    const pool: ("ring" | "fan" | "shock" | "hole" | "spawn" | "ricochet" | "boom" | "ignition")[] =
      ["ring", "fan", "shock"];
    if (b.mk >= 3) pool.push("hole");
    // MK4's new signature: it sheds slow boom asteroids toward the player
    if (b.mk === 4) {
      pool.push("boom", "ignition", "ignition", "ignition");
    }
    // MK3's second signature: the ricochet ring. Weighted so it shows up often
    // but never dominates the rotation.
    if (b.mk === 3) {
      pool.push("ricochet");
      pool.push("ricochet");
    }
    if (phase >= 2) for (let i = 0; i < b.spawnWeight * 2; i++) pool.push("spawn");
    if (b.final) pool.push("spawn");
    const pick = pool[Math.floor(this.random() * pool.length)];

    if (pick === "ignition") {
      this.triggerMk4ProximityStrikes(b);
      return;
    }
    this.spawnBossAbilityRock(b);

    if (pick === "ring") {
      // MK4/MK5 pack every pattern with extra projectiles
      const n = Math.max(10, Math.round((14 + phase * 4 + (b.final ? 4 : 0)) * b.bulletMul));
      const base = this.random() * TAU;
      const sp = (b.final ? 190 : 165) + phase * 15;
      for (let i = 0; i < n; i++) {
        const a = base + (i / n) * TAU;
        this.enemyBullet(b.x + Math.cos(a) * b.r * 0.92, b.y + Math.sin(a) * b.r * 0.92, a, sp, 8);
      }
      this.shake += 4;
      this.sound.play("rail");
    } else if (pick === "fan") {
      const ang = Math.atan2(this.p.y - b.y, this.p.x - b.x);
      const n = Math.max(3, Math.round((3 + phase + (b.final ? 1 : 0)) * b.bulletMul));
      for (let i = 0; i < n; i++) {
        const a = ang + (i - (n - 1) / 2) * 0.22;
        this.enemyBullet(
          b.x + Math.cos(a) * b.r * 0.92,
          b.y + Math.sin(a) * b.r * 0.92,
          a,
          b.final ? 280 : 240,
          9,
          5.5,
        );
      }
      this.sound.play("ui");
    } else if (pick === "shock") {
      // MK1 gets a long warning; MK5 barely any time at all
      b.shockDur = Math.max(0.5, 2.6 - (b.mk - 1) * 0.5);
      b.shockT = b.shockDur;
      // Radius scales with boss strength and missing HP (e.g. MK5 with low HP = massive circle)
      const baseR = 190 + b.mk * 35;
      const missingHpFactor = 1 + (1 - clamp(b.hp / b.maxHp, 0, 1)) * 0.75;
      b.shockRadius = baseR * missingHpFactor;
      this.sound.play("bossCharge");
    } else if (pick === "hole") {
      // easy to outrun on MK3, pulls harder and lasts longer at MK4 and MK5
      const pull = b.mk === 3 ? 160 : b.mk === 4 ? 260 : 370;
      const dur = b.mk === 3 ? 3.8 : b.mk === 4 ? 5.2 : 6.8;
      const radius = Math.max(this.w, this.h) * 1.5;
      this.mkHole(b, pull, dur, radius);
    } else if (pick === "boom") {
      // MK4 · BOOM LAUNCH: marked drop points are scattered across the whole map.
      // After a short warning each one becomes a slow boom rock with a 30 s lifespan.
      // Reserve pending drops as well as live rocks against the hard cap.
      const n = Math.min(3, Math.max(0, this.boomRoom() - b.boomDrops.length));
      const chosen: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        // best-of-N sampling keeps the drops spread out instead of clumped
        let best = { x: this.w / 2, y: this.h / 2 },
          bestScore = -1;
        for (let tries = 0; tries < 14; tries++) {
          const x = this.rnd(70, this.w - 70),
            y = this.rnd(90, this.h - 70);
          if (Math.hypot(x - this.p.x, y - this.p.y) < 240) continue;
          if (Math.hypot(x - b.x, y - b.y) < b.r + 60) continue;
          const spread = chosen.reduce((m, c) => Math.min(m, Math.hypot(x - c.x, y - c.y)), 9999);
          if (spread > bestScore) {
            bestScore = spread;
            best = { x, y };
          }
        }
        chosen.push(best);
        const warn = 1.1;
        b.boomDrops.push({ x: best.x, y: best.y, t: warn, t0: warn });
      }
      this.rings.push({
        x: b.x,
        y: b.y,
        r: b.r * 0.6,
        max: b.r * 1.9,
        life: 0.45,
        color: ORANGE,
        w: 3,
      });
      this.shake += 3;
      this.banner = "BOOM LAUNCH";
      this.bannerSub = "WATCH THE MARKERS · FUSED ROCKS INBOUND";
      this.bannerT = 1.5;
      this.sound.play("bossCharge");
    } else if (pick === "ricochet") {
      // MK3 · RICOCHET RING — form a ring of bounce rocks around the boss, then
      // fire them outward one by one, each mirror-aimed at the player.
      const live = this.rocks.filter((r) => !isEventRock(r.trait)).length;
      const room = Math.max(0, BOSS_ROCK_CAP - live);
      b.ricochetRing = Math.min(4 + phase, room);
      b.ricochetFired = 0;
      b.ricochetT = 0.3;
      b.ricochetPhase = this.random() * TAU;
      this.banner = "RICOCHET RING";
      this.bannerSub = "MIRROR-AIMED · WATCH THE BOUNCE";
      this.bannerT = 1.5;
      this.sound.play("bossCharge");
    } else {
      // Offspring are capped by how cluttered the field already is, so a
      // dreadnought can never bury the player under its own spawn loop.
      const live = this.rocks.filter((r) => !isEventRock(r.trait)).length;
      const room = Math.max(0, BOSS_ROCK_CAP - live);
      const n = Math.min(b.rocksPer, room);
      for (let i = 0; i < n; i++) {
        const a = this.random() * TAU;
        this.addRocks(
          this.makeRock(
            b.x + Math.cos(a) * b.r,
            b.y + Math.sin(a) * b.r,
            this.rollRockSize(),
            Math.cos(a) * 120 + b.vx,
            Math.sin(a) * 120 + b.vy,
            i === 0 ? "none" : b.spawnTrait,
          ),
        );
      }
      // and the dreadnought calls its own kind to join it — MK5 is the final
      // fight and stays focused, so its warden odds are far lower than MK4's
      const sentinels = this.drones.filter((d) => d.kind === "sentinel").length;
      const wardens = this.drones.filter((d) => d.kind === "warden").length;
      if (sentinels < 3 && this.random() < 0.45) {
        this.drones.push(
          this.spawnDrone(b.x + this.rnd(-80, 80), b.y - b.r - 30, 55 + scaledWave(this.wave) * 11),
        );
      }
      if (b.mk >= 4 && wardens < 1 && this.random() < (b.mk === 5 ? 0.12 : 0.5)) {
        this.drones.push(
          this.spawnDrone(
            b.x + this.rnd(-80, 80),
            b.y + b.r + 40,
            210 + scaledWave(this.wave) * 28,
            "warden",
          ),
        );
      }
      this.burst(b.x, b.y, 16, b.spawnTrait === "none" ? MAGENTA : b.edgeColor);
      this.sound.play("explodeSmall");
    }
  }

  /** dev console: remove every hostile on the field and clear the hit */
  clearAllArt() {
    for (const r of this.rocks) this.burst(r.x, r.y, 8, TRAIT_COLOR[r.trait]);
    for (const d of this.drones) this.burst(d.x, d.y, 14, MAGENTA);
    if (this.boss) this.burst(this.boss.x, this.boss.y, 40, MAGENTA);
    this.rocks = [];
    this.drones = [];
    this.boss = null;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (this.bullets[i].kind === "enemy") this.bullets.splice(i, 1);
    }
    this.shake += 14;
    this.flashAlpha = 0.4;
    this.sound.play("explodeBig");
  }

  /** Bounded batch sizes keep accidental console input from freezing the arena. */
  devSpawnCount(count: number) {
    return Number.isFinite(count) ? clamp(Math.floor(count), 1, 50) : 1;
  }

  /** Dev console: spawn a batch of asteroids, respecting the global boom cap. */
  devSpawnRock(size: 1 | 2 | 3, trait: RockTrait, count = 1) {
    for (let i = 0; i < this.devSpawnCount(count); i++) {
      if (trait === "boom" && this.boomRoom() === 0) break;
      let x = 0,
        y = 0,
        tries = 0;
      do {
        x = this.random() * this.w;
        y = this.random() * this.h;
        tries++;
      } while (Math.hypot(x - this.p.x, y - this.p.y) < 240 && tries < 15);
      this.addRocks(this.makeRock(x, y, size, undefined, undefined, trait));
    }
  }

  /** Medium enemies retain their normal size and health. */
  devSpawnMob(kind: DeveloperEnemy, count = 1, size: 1 | 2 | 3 = 2) {
    const tuningWave = scaledWave(this.wave);
    const hpScale = size === 1 ? 0.65 : size === 3 ? 1.6 : 1;
    const radiusScale = size === 1 ? 0.75 : size === 3 ? 1.35 : 1;
    for (let i = 0; i < this.devSpawnCount(count); i++) {
      const a = this.random() * TAU;
      const x = clamp(this.p.x + Math.cos(a) * 520, 50, this.w - 50);
      const y = clamp(this.p.y + Math.sin(a) * 520, 50, this.h - 50);
      const special =
        kind === "tetherSentinel" || kind === "mineWarden" || kind === "riftSpiker" ? kind : null;
      const baseKind =
        kind === "tetherSentinel"
          ? "sentinel"
          : kind === "mineWarden"
            ? "warden"
            : kind === "riftSpiker"
              ? "spiker"
              : kind;
      const mob = this.spawnDrone(
        x,
        y,
        (special
          ? COOP_CONFIG[special].baseHp + this.wave * COOP_CONFIG[special].hpPerWave
          : kind === "spiker"
            ? this.spikerHp()
            : kind === "warden"
              ? 210 + tuningWave * 28
              : 55 + tuningWave * 11) * hpScale,
        baseKind,
      );
      if (special) {
        mob.r = COOP_CONFIG[special].radius;
        mob.coop = {
          kind: special,
          timer:
            special === "mineWarden"
              ? COOP_CONFIG.mineWarden.deploymentMin
              : special === "riftSpiker"
                ? COOP_CONFIG.riftSpiker.cooldownSeconds
                : COOP_CONFIG.tetherSentinel.cooldownSeconds,
          warning: 0,
          target: null,
        };
      }
      mob.r *= radiusScale;
      this.drones.push(mob);
    }
  }

  /**
   * Reapply every stat upgrade from the stack counts.
   * Stat upgrades mutate live fields (fireRateMul *= 1.09, maxHull += 18…), so
   * a dev edit can't just add or subtract on top of them — the derived values
   * are reset to their base and rebuilt from scratch.
   */
  rebuildStatUpgrades() {
    const p = this.p;
    const base = freshPlayer();
    const keepHull = p.hull;
    const keepMissiles = p.missiles;
    p.fireRateMul = base.fireRateMul;
    p.damageMul = base.damageMul;
    p.rangeMul = base.rangeMul;
    p.thrust = base.thrust;
    p.maxSpeed = base.maxSpeed;
    p.turn = base.turn;
    p.maxHull = base.maxHull;
    p.armor = base.armor;
    p.extraShots = base.extraShots;
    p.pierce = base.pierce;
    p.crit = base.crit;
    p.critMult = base.critMult;
    p.maxMissiles = base.maxMissiles;
    p.missiles = base.missiles;
    p.blastDmg = base.blastDmg;
    p.blastR = base.blastR;
    p.missileRegen = base.missileRegen;
    for (const u of STAT_UPGRADES) {
      const n = clamp(this.stacks[u.id] ?? 0, 0, u.max);
      this.stacks[u.id] = n;
      for (let i = 0; i < n; i++) u.apply(this);
    }
    // restore the hull we came in with — the upgrades' one-shot heals are part
    // of the rebuild, so don't let them stack on the player for free
    p.hull = clamp(keepHull, 1, p.maxHull);
    p.missiles = Math.min(keepMissiles, p.maxMissiles);
  }

  /** dev console: set a stat upgrade to an exact stack count */
  devSetStack(id: string, level: number) {
    const def = STAT_UPGRADES.find((u) => u.id === id);
    if (!def) return;
    this.stacks[id] = clamp(Math.round(level), 0, def.max);
    this.rebuildStatUpgrades();
  }

  /** dev console: set every stat upgrade at once (clamped to each cap) */
  devSetAllStacks(level: number) {
    for (const u of STAT_UPGRADES) {
      this.stacks[u.id] = clamp(Math.round(level), 0, u.max);
    }
    this.rebuildStatUpgrades();
  }

  devSetSalvageUpgrade(id: SalvageUpgradeId, level: number) {
    const d = this.salvageDrone;
    d.purchased = true;
    d.active = true;
    d.upgrades[id] = clamp(Math.round(level), 0, SALVAGE_UPGRADES[id].max);
    d.maxHp = 24 + d.upgrades.armor * 12;
    d.hp = Math.min(d.maxHp, Math.max(d.hp, d.maxHp));
  }

  devSetSalvageHp(value: number) {
    this.salvageDrone.purchased = true;
    this.salvageDrone.active = true;
    this.salvageDrone.hp = clamp(value, 0, this.salvageDrone.maxHp);
  }

  devEquipSalvageWeapon(w: WeaponId | null) {
    this.salvageDrone.purchased = true;
    this.salvageDrone.active = true;
    // Dev mode can mount the current player weapon for testing, while the shop
    // path still enforces the normal "not currently equipped" rule.
    this.salvageDrone.weapon = w;
  }

  /** dev console: set the squad size. Extra members are real, independent
   *  units — they fly their own orbit, take their own damage and fire. */
  devSpawnSalvage(count: number) {
    const d = this.salvageDrone;
    const n = clamp(Math.round(count), 1, 3);
    d.purchased = true;
    d.active = true;
    d.rebuilding = 0;
    d.hp = d.maxHp;
    d.devCount = n;
    if (d.x === 0 && d.y === 0) {
      d.x = this.p.x + 34;
      d.y = this.p.y + 14;
    }
    // resize the clone roster to n - 1 real units
    while (this.salvageClones.length > n - 1) this.salvageClones.pop();
    while (this.salvageClones.length < n - 1) {
      const i = this.salvageClones.length + 1;
      const a = i * (TAU / 3);
      this.salvageClones.push({
        x: this.p.x + Math.cos(a) * 60,
        y: this.p.y + Math.sin(a) * 40,
        vx: 0,
        vy: 0,
        angle: a,
        hp: d.maxHp,
        orbit: a,
        fireTimer: this.rnd(0, 0.6),
        hitTimer: 0,
        beamOn: false,
        beamAngle: 0,
        beamLen: 0,
      });
    }
    this.floatText(this.p.x, this.p.y - 30, `SALVAGE SQUAD ×${n}`, ICE, 13);
    this.burst(this.p.x, this.p.y, 12 + n * 5, ICE);
    this.sound.play("droneAssemble");
  }

  /** sweep every asteroid off the sector (shower debris included) */
  despawnAllRocks() {
    for (const r of this.rocks) {
      this.burst(r.x, r.y, 6, r.trait === "none" ? AMBER : TRAIT_COLOR[r.trait]);
      this.rings.push({
        x: r.x,
        y: r.y,
        r: r.r * 0.4,
        max: r.r * 2,
        life: 0.35,
        color: AMBER,
        w: 2,
      });
    }
    this.rocks = [];
  }

  killBoss() {
    const b = this.boss;
    if (!b) return;
    this.boss = null;
    this.creditWarheadKill();
    // Damage can arrive inside the bullet loop; do not shift its indices.
    for (const shot of this.bullets) {
      if (["enemy", "wardenOrb", "wardenShard"].includes(shot.kind)) {
        shot.life = 0;
        shot.dmg = 0;
        shot.blast = 0;
        shot.spawnT = 999999;
      }
    }
    this.shower.active = false;
    // Every dreadnought death clears the remaining hostile field so the
    // victory beat is readable and no escort can stall the next state.
    if (b.mk !== 1 || b.final) {
      this.despawnAllRocks();
      for (const d of this.drones) this.burst(d.x, d.y, 14, MAGENTA);
      this.drones = [];
    }
    // the first dreadnought takes the whole belt with it, so the sector can advance to wave 6
    if (b.mk === 1 && !b.final) {
      this.despawnAllRocks();
      // its escort goes down with it — a live sentinel would otherwise keep the sector from advancing
      for (const d of this.drones) {
        this.burst(d.x, d.y, 14, MAGENTA);
        this.rings.push({
          x: d.x,
          y: d.y,
          r: d.r * 0.5,
          max: d.r * 3,
          life: 0.4,
          color: MAGENTA,
          w: 2,
        });
      }
      this.drones = [];
      this.waveHold = 2.2;
      this.banner = "DREADNOUGHT DESTROYED";
      this.bannerSub = "BELT CLEARED · WAVE 06 INBOUND";
      this.bannerT = 2.4;
    }
    const mult = 1 + Math.floor(this.combo / 4) * 0.5;
    const base = b.mk === 6 ? 40000 : b.final ? 15000 : 2500 * b.mk;
    this.score += Math.round(base * mult);
    // terminal states are entered BEFORE the XP is banked — otherwise a
    // threshold crossing here would flash a level-up rack over the victory
    // screen and freeze the game mid-celebration
    if (b.mk === 6) {
      this.bonusDefeated = true;
      this.setMode("victory");
    } else if (b.final) {
      this.bonusAvailable = true;
      this.setMode("victory");
    }
    const xpGain = b.mk === 6 ? 400 : b.final ? 260 : 180;
    if (this.mode === "victory") this.xp += xpGain;
    else this.gainXp(xpGain);
    this.combo++;
    this.comboTimer = 4;
    this.addMissileCharge(GAME_CONFIG.salvo.killCharge);
    for (let i = 0; i < 5; i++) {
      this.rings.push({
        x: b.x + this.rnd(-b.r * 0.4, b.r * 0.4),
        y: b.y + this.rnd(-b.r * 0.4, b.r * 0.4),
        r: 10,
        max: b.r * (1.6 + i * 0.5),
        life: 0.9 - i * 0.1,
        color: i % 2 ? AMBER : MAGENTA,
        w: 3,
      });
    }
    this.burst(b.x, b.y, 110, MAGENTA);
    this.burst(b.x, b.y, 70, AMBER_HOT);
    this.shake += 30;
    this.flashAlpha = 0.9;
    this.timeScale = 0.35;
    this.sound.play("bossDeath");
    const n = b.final ? 12 : 8;
    for (let i = 0; i < n; i++) {
      this.pickups.push({
        x: b.x,
        y: b.y,
        vx: this.rnd(-140, 140),
        vy: this.rnd(-140, 140),
        kind: this.random() < 0.2 ? "repair" : "credit",
        value: b.final ? 60 : 36,
        life: 22,
        pulse: this.random() * TAU,
      });
    }
    this.floatText(b.x, b.y, `+${Math.round(base * mult)}`, AMBER_HOT, 22);
  }

  /** accept the optional MK6 encounter from the victory screen */
  startBonusBoss() {
    this.bonusAvailable = false;
    this.bonusActive = true;
    this.rocks = [];
    this.drones = [];
    this.bullets = [];
    this.boss = this.makeBoss(false, 6);
    this.p.hull = this.p.maxHull;
    this.p.missiles = this.p.maxMissiles;
    this.themeIdx = 6;
    this.theme = THEMES[6];
    this.banner = "THE METEOR";
    this.bannerSub = "MK6 · OMEGAZELL — PRIMORDIAL CATACLYSM";
    this.bannerT = 3;
    this.flashAlpha = 0.7;
    this.shake += 18;
    this.sound.play("bossCharge");
    this.setMode("playing");
  }

  /* ------------------------------------------------------------ fx helpers */

  burst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 700) break;
      const a = this.random() * TAU,
        s = this.rnd(40, 320),
        life = this.rnd(0.3, 0.9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: this.rnd(1.6, 3.6),
        color,
        drag: 0.93,
      });
    }
  }

  thrustParticle() {
    const p = this.p;
    const a = p.angle + Math.PI + this.rnd(-0.3, 0.3),
      s = this.rnd(120, 260);
    this.particles.push({
      x: p.x + Math.cos(p.angle + Math.PI) * 16,
      y: p.y + Math.sin(p.angle + Math.PI) * 16,
      vx: Math.cos(a) * s + p.vx * 0.3,
      vy: Math.sin(a) * s + p.vy * 0.3,
      life: 0.3,
      max: 0.3,
      size: this.rnd(2, 3.5),
      color: AMBER,
      drag: 0.9,
    });
  }

  floatText(x: number, y: number, text: string, color: string, size: number) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, vy: -46, life: 1, text, color, size });
  }

  /* ------------------------------------------------------------ render */

  drawCracks(
    ctx: CanvasRenderingContext2D,
    cracks: Crack[],
    dmg: number,
    flash: number,
    glow: string,
    scale = 1,
  ) {
    if (dmg <= 0.08) return;
    for (const c of cracks) {
      if (dmg < c.at) continue;
      const open = clamp((dmg - c.at) / 0.34, 0, 1);
      ctx.beginPath();
      ctx.moveTo(c.pts[0].x, c.pts[0].y);
      for (let i = 1; i < c.pts.length; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
      ctx.strokeStyle = "rgba(6,7,12,0.92)";
      ctx.lineWidth = (1.2 + open * 2.6) * scale;
      ctx.stroke();
      if (open > 0.05) {
        ctx.strokeStyle =
          flash > 0 ? AMBER_HOT : `rgba(255,${120 + open * 90},58,${0.25 + open * 0.6})`;
        ctx.lineWidth = (0.6 + open * 1.5) * scale;
        ctx.shadowBlur = 8 + open * 14;
        ctx.shadowColor = glow;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  renderSalvageDrone(ctx: CanvasRenderingContext2D, drone = this.salvageDrone) {
    const d = drone;
    if (!d.purchased) return;
    const rebuilding = !d.active;
    const armor = d.upgrades.armor;
    const magnet = d.upgrades.magnet;
    const scan = d.upgrades.scan;
    const twin = d.upgrades.twinCannons;
    const total = SALVAGE_UPGRADE_ORDER.reduce((sum, id) => sum + d.upgrades[id], 0);
    const scale = 1 + Math.min(0.34, total * 0.035);
    const pulse = 1 + Math.sin(this.frame * 0.09) * 0.08;

    ctx.save();
    if (
      d === this.salvageDrone &&
      d.active &&
      d.upgrades.shield > 0 &&
      Math.hypot(d.x - this.p.x, d.y - this.p.y) <= this.salvageSupportRange()
    ) {
      ctx.strokeStyle = "rgba(111,231,255,0.3)";
      ctx.lineWidth = 1 + d.upgrades.shield * 0.4;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(this.p.x, this.p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.p.x, this.p.y, 25, 0, TAU);
      ctx.stroke();
    }
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle || 0);
    ctx.scale(scale, scale);
    ctx.globalAlpha = rebuilding ? 0.32 + Math.sin(this.frame * 0.16) * 0.12 : 1;

    if (scan > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, (34 + scan * 12) * pulse, -Math.PI * 0.7, Math.PI * 0.7);
      ctx.strokeStyle = "rgba(111,231,255,0.36)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (magnet > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, 18 + magnet * 4, 0, TAU);
      ctx.strokeStyle = "rgba(255,176,58,0.7)";
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 12;
      ctx.shadowColor = AMBER;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // base companion chassis: a different, compact diamond than the player ship
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(0, -10);
    ctx.lineTo(-13, -7);
    ctx.lineTo(-17, 0);
    ctx.lineTo(-13, 7);
    ctx.lineTo(0, 10);
    ctx.closePath();
    ctx.fillStyle = "rgba(12,42,28,0.92)";
    ctx.fill();
    ctx.strokeStyle = "#72ef9c";
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#72ef9c";
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (armor > 0) {
      ctx.strokeStyle = "rgba(255,176,58,0.86)";
      ctx.lineWidth = 2;
      for (const y of [-7, 7]) {
        ctx.beginPath();
        ctx.moveTo(-11, y);
        ctx.lineTo(-5, y * 1.45);
        ctx.lineTo(2, y);
        ctx.stroke();
      }
    }
    if (twin > 0) {
      ctx.fillStyle = AMBER_HOT;
      ctx.shadowBlur = 10;
      ctx.shadowColor = AMBER;
      for (const y of [-6, 6]) {
        ctx.fillRect(5, y - 1.5, 10, 3);
      }
      ctx.shadowBlur = 0;
      if (twin >= 3) {
        ctx.strokeStyle = AMBER_HOT;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(11, -2);
        ctx.lineTo(25, -2);
        ctx.moveTo(11, 2);
        ctx.lineTo(25, 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(25, 0, 4 + Math.sin(this.frame * 0.2), 0, TAU);
        ctx.stroke();
      }
    }
    if (d.weapon) {
      const weaponColor =
        d.weapon === "laser" || d.weapon === "arc"
          ? ICE
          : d.weapon === "rail"
            ? AMBER_HOT
            : MAGENTA;
      ctx.strokeStyle = weaponColor;
      ctx.fillStyle = weaponColor;
      ctx.lineWidth = 1.8;
      if (d.weapon === "laser") {
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(27, 0);
        ctx.stroke();
      } else if (d.weapon === "rail") {
        ctx.fillRect(8, -2, 20, 4);
      } else if (d.weapon === "flak") {
        ctx.beginPath();
        ctx.arc(13, 0, 5, 0, TAU);
        ctx.stroke();
      } else if (d.weapon === "arc") {
        ctx.beginPath();
        ctx.arc(1, 0, 8, -0.8, 0.8);
        ctx.stroke();
      } else {
        ctx.fillRect(8, -1.5, 14, 3);
      }
    } else {
      // level-zero chassis has a weak, visible starter cannon
      ctx.fillStyle = "#8d93ad";
      ctx.fillRect(7, -1, 12, 2);
    }
    if (d.upgrades.overcharge > 0) {
      ctx.beginPath();
      ctx.arc(-2, 0, 4 + d.upgrades.overcharge, 0, TAU);
      ctx.fillStyle = MAGENTA;
      ctx.shadowBlur = 14;
      ctx.shadowColor = MAGENTA;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath();
      ctx.arc(-2, 0, 2.5, 0, TAU);
      ctx.fillStyle = "#72ef9c";
      ctx.fill();
    }
    if (d.assembly > 0) {
      const build = clamp(d.assembly / 1.8, 0, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(this.frame * 0.18) * 3, -Math.PI * build, Math.PI * build);
      ctx.strokeStyle = "#72ef9c";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + (1 - build) * 0.6;
      ctx.shadowBlur = 16;
      ctx.shadowColor = "#72ef9c";
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // continuous beam mount — a real beam of light out of the turret
    if (!rebuilding && d.beamOn && d.beamLen > 0) {
      const bx = d.x + Math.cos(d.beamAngle) * 12,
        by = d.y + Math.sin(d.beamAngle) * 12;
      const ex = d.x + Math.cos(d.beamAngle) * d.beamLen,
        ey = d.y + Math.sin(d.beamAngle) * d.beamLen;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = ICE;
      ctx.lineWidth =
        this.laserStats(this.p.weapons.laser || 1, true).width * 0.55 + (this.random() - 0.5);
      ctx.shadowBlur = 18;
      ctx.shadowColor = ICE;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      // hot spot where it lands
      ctx.beginPath();
      ctx.arc(ex, ey, 3 + this.random() * 2, 0, TAU);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }

    if (rebuilding) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.fillStyle = ICE;
      ctx.globalAlpha = 0.65 + Math.sin(this.frame * 0.14) * 0.2;
      ctx.fillText(
        d.rebuilding > 0 ? `REBUILDING ${d.rebuilding.toFixed(1)}` : "DRONE OFFLINE",
        d.x,
        d.y - 22,
      );
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 22, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(d.hp / d.maxHp, 0, 1));
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.65;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  renderSpiker(ctx: CanvasRenderingContext2D, d: Drone) {
    const spikes = this.spikerShots();
    const warning = clamp(1 - d.fire / GAME_CONFIG.enemies.spikers.fireWarning, 0, 1);
    const edge = d.flash > 0 ? "#fff0f4" : "#ff7aa0";
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);

    // Four long gun-spines unfold into an eight-point crown in the late waves.
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * Math.PI) / spikes;
      const radius = d.r * (i % 2 === 0 ? 1.18 : spikes === 8 ? 0.58 : 0.48);
      const x = Math.cos(a) * radius,
        y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = d.flash > 0 ? "rgba(255,61,110,0.55)" : "rgba(35,9,25,0.94)";
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = MAGENTA;
    ctx.shadowBlur = 14 + warning * 12;
    ctx.stroke();

    // Armored ribs lead to each muzzle, so the silhouette advertises the volley.
    for (let i = 0; i < spikes; i++) {
      const a = (i * TAU) / spikes;
      const dx = Math.cos(a),
        dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(dx * d.r * 0.3, dy * d.r * 0.3);
      ctx.lineTo(dx * d.r * 0.87, dy * d.r * 0.87);
      ctx.strokeStyle = warning > 0 ? AMBER_HOT : "#8e1438";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dx * d.r * 1.05, dy * d.r * 1.05, 2 + warning * 1.5, 0, TAU);
      ctx.fillStyle = warning > 0 ? AMBER_HOT : edge;
      ctx.fill();
      if (warning > 0) {
        ctx.save();
        ctx.globalAlpha = 0.2 + warning * 0.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(dx * (d.r + 8), dy * (d.r + 8));
        ctx.lineTo(dx * (d.r + 65), dy * (d.r + 65));
        ctx.strokeStyle = AMBER_HOT;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.beginPath();
    ctx.arc(0, 0, d.r * 0.34, 0, TAU);
    ctx.fillStyle = "#170a18";
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, d.r * (0.13 + warning * 0.05), 0, TAU);
    ctx.fillStyle = warning > 0 ? AMBER_HOT : "#fff0f4";
    ctx.fill();
    ctx.restore();

    // Keep its health readable while the hull rotates.
    ctx.save();
    const barW = d.r * 1.7,
      barY = d.y - d.r * 1.18 - 10;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(d.x - barW / 2 - 1, barY - 1, barW + 2, 5);
    ctx.fillStyle = "rgba(255,61,110,0.25)";
    ctx.fillRect(d.x - barW / 2, barY, barW, 3);
    ctx.fillStyle = edge;
    ctx.fillRect(d.x - barW / 2, barY, barW * clamp(d.hp / d.maxHp, 0, 1), 3);
    ctx.restore();
  }

  renderSupportShields(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "#6fe7ff";
    ctx.lineWidth = 1.5;
    let links = 0;
    for (const target of [...this.rocks, ...this.drones]) {
      const shield = target.supportShield;
      if (!shield || shield.hp <= 0) continue;
      const source = this.drones.find((d) => d.id === shield.sourceId);
      if (
        !source ||
        Math.hypot(source.x - target.x, source.y - target.y) >
          COOP_CONFIG.tetherSentinel.shieldRange
      )
        continue;
      ctx.globalAlpha = 0.25 + 0.4 * (shield.hp / shield.maxHp);
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.r + 5, 0, TAU);
      ctx.stroke();
      if (links++ < 24) {
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ salvo lock render */

  /**
   * Segmented charge ring around the ship: one arc per rack slot. Loaded slots
   * glow in the pilot's accent, the charging slot fills clockwise, empty slots
   * are ghosted. The ring brightens while painting so the lock budget is legible.
   */
  renderMissileRing(ctx: CanvasRenderingContext2D, color: string) {
    const p = this.p;
    const slots = Math.max(1, p.maxMissiles);
    const painting = p.missileHoldT >= 0;
    const full = p.missiles >= p.maxMissiles;
    const radius = 31;
    const gap = 0.16;
    const span = TAU / slots;
    const charge = full ? 0 : clamp(p.missileCharge / p.missileRegen, 0, 1);
    // the ring starts at the stern and runs clockwise so it never hides the nose
    const base = p.angle + Math.PI - span * slots * 0.5;
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = painting ? 1 : full ? 0.32 : 0.6;
    for (let i = 0; i < slots; i++) {
      const a0 = base + i * span + gap * 0.5;
      const a1 = base + (i + 1) * span - gap * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, a0, a1);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.stroke();
      const fill = i < p.missiles ? 1 : i === p.missiles ? charge : 0;
      if (fill <= 0) continue;
      const locked = painting && i < p.missileLocks.length;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, a0, a0 + (a1 - a0) * fill);
      ctx.lineWidth = locked ? 3.4 : 2.4;
      ctx.strokeStyle = locked ? "#ffffff" : color;
      ctx.shadowBlur = fill >= 1 ? 10 : 0;
      ctx.shadowColor = color;
      ctx.globalAlpha = (painting ? 1 : full ? 0.32 : 0.6) * (fill >= 1 ? 1 : 0.55);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = painting ? 1 : full ? 0.32 : 0.6;
    }
    ctx.restore();
  }

  /**
   * The lock cone: a soft fan from the nose with a scan line sweeping across it,
   * range ticks, and, at Full Lock, a white arc that drains over the release window.
   */
  renderLockCone(ctx: CanvasRenderingContext2D, color: string) {
    const p = this.p;
    const cfg = GAME_CONFIG.salvo;
    const range = cfg.coneRange * (p.rangeMul ?? 1);
    const half = cfg.coneHalfAngle;
    const grow = clamp(p.missileHoldT / 0.12, 0, 1);
    const r = range * (0.35 + 0.65 * grow);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const fan = ctx.createRadialGradient(0, 0, 18, 0, 0, r);
    fan.addColorStop(0, `${color}00`);
    fan.addColorStop(0.25, `${color}22`);
    fan.addColorStop(1, `${color}05`);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -half, half);
    ctx.closePath();
    ctx.fillStyle = fan;
    ctx.fill();
    // edges
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(half * s) * 26, Math.sin(half * s) * 26);
      ctx.lineTo(Math.cos(half * s) * r, Math.sin(half * s) * r);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // range ticks every third of the cone
    ctx.globalAlpha = 0.28;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, (r * k) / 3, -half, half);
      ctx.stroke();
    }
    // sweeping scan line, ping-ponging across the cone
    const sweep = Math.sin(p.missileHoldT * 7) * half;
    const scan = ctx.createLinearGradient(0, 0, Math.cos(sweep) * r, Math.sin(sweep) * r);
    scan.addColorStop(0, `${color}00`);
    scan.addColorStop(1, color);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = scan;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sweep) * r, Math.sin(sweep) * r);
    ctx.stroke();
    ctx.restore();

    // Full Lock window: a bright arc around the ship that drains as the bonus expires
    if (p.fullLockAt >= 0) {
      const left = 1 - clamp((p.missileHoldT - p.fullLockAt) / cfg.fullLockWindow, 0, 1);
      ctx.save();
      ctx.lineCap = "round";
      if (left > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40, p.angle - Math.PI * left, p.angle + Math.PI * left);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 16;
        ctx.shadowColor = "#ffffff";
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * Lock reticles: four rotating chevrons that close in on the target, one pip
   * per lock it holds, and (for your own ship) a faint tether back to the nose.
   * Full Lock turns every reticle white and makes it pulse.
   */
  renderLockReticles(ctx: CanvasRenderingContext2D, color: string, own: boolean) {
    const p = this.p;
    if (!p.missileLocks.length) return;
    const counts = new Map<number, number>();
    for (const id of p.missileLocks) counts.set(id, (counts.get(id) ?? 0) + 1);
    const full = p.fullLockAt >= 0;
    const tint = full ? "#ffffff" : color;
    const pulse = full ? 1 + Math.sin(this.frame * 0.6) * 0.12 : 1;
    ctx.save();
    for (const [id, n] of counts) {
      const t = this.findTarget(id);
      if (!t) continue;
      const rr = (Math.min(t.r, 90) + 12) * pulse;
      ctx.save();
      if (own) {
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.95;
      ctx.translate(t.x, t.y);
      ctx.rotate(this.frame * 0.05 + id);
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = tint;
      for (let q = 0; q < 4; q++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(rr - 7, -6);
        ctx.lineTo(rr, 0);
        ctx.lineTo(rr - 7, 6);
        ctx.stroke();
      }
      ctx.restore();
      // lock pips under the reticle
      ctx.fillStyle = tint;
      ctx.shadowBlur = 6;
      ctx.shadowColor = tint;
      const shown = Math.min(n, 8);
      for (let k = 0; k < shown; k++) {
        const px = t.x + (k - (shown - 1) / 2) * 7;
        ctx.beginPath();
        ctx.moveTo(px, t.y + rr + 4);
        ctx.lineTo(px + 2.6, t.y + rr + 8);
        ctx.lineTo(px, t.y + rr + 12);
        ctx.lineTo(px - 2.6, t.y + rr + 8);
        ctx.closePath();
        ctx.fill();
      }
      if (n > 8) {
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`×${n}`, t.x, t.y + rr + 24);
      }
    }
    ctx.restore();
  }

  /** Remember recent missile positions so the corkscrew draws as a ribbon. */
  trackMissileTrails() {
    const live = new Set<unknown>();
    for (const b of this.bullets) {
      if (b.kind !== "missile") continue;
      const key = b.id ?? b;
      live.add(key);
      let trail = this.missileTrails.get(key);
      if (!trail) {
        trail = [];
        this.missileTrails.set(key, trail);
      }
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last.x - b.x, last.y - b.y) > 4) trail.push({ x: b.x, y: b.y });
      if (trail.length > 22) trail.shift();
    }
    for (const key of this.missileTrails.keys()) if (!live.has(key)) this.missileTrails.delete(key);
  }

  /**
   * Salvo Lock missile, nicknamed the "Heliodart": a ribbon trail that shows the
   * corkscrew, a flickering two-stage plume, a gunmetal fuselage with swept tail
   * fins and canards, a pulsing accent band and a white-hot seeker cap.
   */
  renderMissile(ctx: CanvasRenderingContext2D, b: Bullet) {
    const color = b.color || MAGENTA;
    const hot = b.fullLock ? "#ffffff" : color;
    const trail = this.missileTrails.get(b.id ?? b);
    ctx.save();
    if (trail && trail.length > 1) {
      // tapered ribbon: a filled strip that widens toward the missile, then a hot core line
      const pts = [...trail, { x: b.x, y: b.y }];
      const n = pts.length;
      const left: { x: number; y: number }[] = [];
      const right: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)],
          c = pts[Math.min(n - 1, i + 1)];
        const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
        const nx = -(c.y - a.y) / len,
          ny = (c.x - a.x) / len;
        const w = 0.4 + (i / (n - 1)) * 3.6;
        left.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w });
        right.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w });
      }
      ctx.globalCompositeOperation = "lighter";
      const fade = ctx.createLinearGradient(pts[0].x, pts[0].y, b.x, b.y);
      fade.addColorStop(0, `${color}00`);
      fade.addColorStop(1, `${color}99`);
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (const q of left) ctx.lineTo(q.x, q.y);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
      ctx.closePath();
      ctx.fillStyle = fade;
      ctx.fill();
      const core = ctx.createLinearGradient(pts[0].x, pts[0].y, b.x, b.y);
      core.addColorStop(0, "rgba(255,255,255,0)");
      core.addColorStop(1, "rgba(255,255,255,0.7)");
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = core;
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    const scale = b.mini ? 0.95 : 1.35;
    ctx.scale(scale, scale);
    const w = b.warhead ?? DEFAULT_MISSILE_BUILD;
    const tint = WARHEAD_PARTS[w.payload].color;
    const seed = (b.id ?? 0) * 1.7;
    const flick =
      1 + Math.sin(this.frame * 0.9 + seed) * 0.18 + Math.sin(this.frame * 2.3 + seed) * 0.1;
    const lit = !b.stuck && !b.orbit;
    // plume: outer airframe flame, payload-tinted middle, white core
    ctx.globalCompositeOperation = "lighter";
    if (lit || b.orbit) {
      ctx.beginPath();
      ctx.moveTo(-8, -3.4);
      ctx.quadraticCurveTo(-16 - 10 * flick, 0, -8, 3.4);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.shadowBlur = 16;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-8, -2.4);
      ctx.quadraticCurveTo(-14 - 7 * flick, 0, -8, 2.4);
      ctx.closePath();
      ctx.fillStyle = tint;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(-8, -1.4);
      ctx.quadraticCurveTo(-12 - 5 * flick, 0, -8, 1.4);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      // Incendiary sheds embers; EMP crackles
      if (w.payload === "incendiary" && this.frame % 2 === 0) {
        ctx.fillStyle = tint;
        for (let k = 0; k < 3; k++) {
          const ex = -14 - ((this.frame * 3 + k * 7 + seed * 9) % 14);
          const ey = Math.sin(this.frame * 0.7 + k * 2.1 + seed) * 4;
          ctx.fillRect(ex, ey, 1.4, 1.4);
        }
      }
    }
    if (w.payload === "emp" && (this.frame + Math.floor(seed)) % 5 < 2) {
      ctx.strokeStyle = tint;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-6, -3);
      ctx.lineTo(-2, -7);
      ctx.lineTo(1, -4);
      ctx.lineTo(5, -8);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;

    // ---- guidance: the airframe ----
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    for (const s of [-1, 1]) {
      if (w.guidance === "corkscrew") {
        // long raked fins for the high-speed spiral
        ctx.beginPath();
        ctx.moveTo(-1, 2.2 * s);
        ctx.lineTo(-10.5, 8.5 * s);
        ctx.lineTo(-8.5, 8.5 * s);
        ctx.lineTo(-6.5, 2 * s);
        ctx.closePath();
        ctx.fill();
      } else if (w.guidance === "relay") {
        // forward-swept wings and twin relay prongs at the nose
        ctx.beginPath();
        ctx.moveTo(-6, 2.2 * s);
        ctx.lineTo(-1, 7.5 * s);
        ctx.lineTo(-3, 2 * s);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(5, 2.4 * s);
        ctx.lineTo(12, 4.2 * s);
        ctx.stroke();
      } else if (w.guidance === "boomerang") {
        // crescent wings that curl back toward the tail
        ctx.beginPath();
        ctx.moveTo(1, 2.2 * s);
        ctx.quadraticCurveTo(-3, 8 * s, -11, 7.5 * s);
        ctx.quadraticCurveTo(-5, 5 * s, -6, 2 * s);
        ctx.closePath();
        ctx.fill();
      } else if (w.guidance !== "orbit") {
        ctx.beginPath();
        ctx.moveTo(-3, 2.2 * s);
        ctx.lineTo(-9.5, 7 * s);
        ctx.lineTo(-7.5, 2 * s);
        ctx.closePath();
        ctx.fill();
      }
      if (w.guidance !== "orbit" && w.guidance !== "relay") {
        // canards
        ctx.beginPath();
        ctx.moveTo(5, 2 * s);
        ctx.lineTo(2, 4.6 * s);
        ctx.lineTo(1.5, 2 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // fuselage: elongated hexagon, dark core with a lit edge
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(6, -2.6);
    ctx.lineTo(-8, -2.6);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-8, 2.6);
    ctx.lineTo(6, 2.6);
    ctx.closePath();
    ctx.fillStyle = "#15121f";
    ctx.fill();
    ctx.strokeStyle = hot;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (w.guidance === "corkscrew") {
      // rifling stripes
      ctx.strokeStyle = tint;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.8;
      for (const x of [-6, -3, 0]) {
        ctx.beginPath();
        ctx.moveTo(x, 2.4);
        ctx.lineTo(x + 2.4, -2.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (w.guidance === "orbit") {
      // ring-wing around the mid-body
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(-3, 0, 2.2, 7.2, 0, 0, TAU);
      ctx.stroke();
    }
    if (w.guidance === "relay" && this.frame % 20 < 10) {
      ctx.fillStyle = WARHEAD_PARTS.relay.color;
      ctx.fillRect(-1.5, -4.4, 1.6, 1.6);
    }

    // ---- payload: the chamber window ----
    const beacon = 0.55 + 0.45 * Math.sin(this.frame * 0.5 + seed);
    ctx.fillStyle = b.fullLock ? "#ffffff" : tint;
    ctx.strokeStyle = b.fullLock ? "#ffffff" : tint;
    ctx.globalAlpha = beacon;
    if (w.payload === "cluster") {
      for (const x of [-5.5, -2.5, 0.5]) ctx.fillRect(x, -1, 1.8, 2);
    } else if (w.payload === "gravity") {
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(-1.5, 0, 1.6, 0, TAU);
      ctx.stroke();
      // a mote orbiting the nose
      const a = this.frame * 0.35 + seed;
      ctx.globalAlpha = 1;
      ctx.fillRect(9 + Math.cos(a) * 5 - 0.8, Math.sin(a) * 5 - 0.8, 1.6, 1.6);
    } else if (w.payload === "emp") {
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-4.5, -1.6);
      ctx.lineTo(-3, 1.6);
      ctx.lineTo(-1.5, -1.6);
      ctx.lineTo(0, 1.6);
      ctx.lineTo(1.5, 0);
      ctx.stroke();
    } else if (w.payload === "incendiary") {
      ctx.beginPath();
      ctx.moveTo(-4, 1.8);
      ctx.quadraticCurveTo(-5.5, -0.5, -2.5, -2);
      ctx.quadraticCurveTo(-1, 0.5, -1.5, 1.8);
      ctx.closePath();
      ctx.fill();
    } else if (w.payload === "solarFlare") {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(-1.5, 0, 1.4, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 0.7;
      const spin = this.frame * 0.15 + seed;
      for (let k = 0; k < 4; k++) {
        const a = spin + (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(-1.5 + Math.cos(a) * 2, Math.sin(a) * 2);
        ctx.lineTo(-1.5 + Math.cos(a) * 3.2, Math.sin(a) * 3.2);
        ctx.stroke();
      }
    } else if (w.payload === "cryo") {
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        const px = -1.5 + Math.cos(a) * 2,
          py = Math.sin(a) * 2;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    } else ctx.fillRect(-2.5, -2.6, 2.2, 5.2);
    ctx.globalAlpha = 1;

    // ---- trigger: the nose ----
    if (w.trigger === "delayed") {
      ctx.strokeStyle = WARHEAD_PARTS.delayed.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 1.5);
      ctx.lineTo(12, 4);
      ctx.moveTo(8, -1.5);
      ctx.lineTo(12, -4);
      ctx.stroke();
    }
    if (w.trigger === "siphon") {
      // intake vanes splayed back from the nose
      ctx.strokeStyle = WARHEAD_PARTS.siphon.color;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(9, 2);
      ctx.lineTo(5, 4.6);
      ctx.moveTo(9, -2);
      ctx.lineTo(5, -4.6);
      ctx.stroke();
    }
    // Forge tiers: one tail chevron per Tier II+ part, and a gold rim once any part is mastered
    const t = b.tiers;
    if (t) {
      const upgraded = [t.payload, t.guidance, t.trigger].filter((v) => v >= 2).length;
      const mastered = t.payload === 3 || t.guidance === 3 || t.trigger === 3;
      if (mastered) {
        ctx.strokeStyle = "#ffcf6a";
        ctx.lineWidth = 0.7;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#ffcf6a";
        ctx.beginPath();
        ctx.moveTo(9.8, 0);
        ctx.lineTo(6.4, -3.3);
        ctx.lineTo(-8.4, -3.3);
        ctx.lineTo(-9.8, 0);
        ctx.lineTo(-8.4, 3.3);
        ctx.lineTo(6.4, 3.3);
        ctx.closePath();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = mastered ? "#ffcf6a" : hot;
      ctx.lineWidth = 0.8;
      for (let k = 0; k < upgraded; k++) {
        const x = -5 - k * 1.8;
        ctx.beginPath();
        ctx.moveTo(x + 1, -1.6);
        ctx.lineTo(x, 0);
        ctx.lineTo(x + 1, 1.6);
        ctx.stroke();
      }
    }
    if (w.trigger === "chain" && !b.mini) {
      // a mini missile docked under the belly
      ctx.fillStyle = "#15121f";
      ctx.strokeStyle = WARHEAD_PARTS.chain.color;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(4, 4.3);
      ctx.lineTo(-4, 3.3);
      ctx.lineTo(-4, 5.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const cap = ctx.createRadialGradient(8, 0, 0, 8, 0, 4.5);
    cap.addColorStop(0, "#ffffff");
    cap.addColorStop(0.5, b.fullLock ? "#ffffff" : tint);
    cap.addColorStop(1, `${tint}00`);
    ctx.beginPath();
    ctx.arc(8, 0, w.trigger === "proximity" ? 5.2 : 4.5, 0, TAU);
    ctx.fillStyle = cap;
    ctx.fill();
    ctx.restore();

    // world-space trigger telegraphs
    if (w.trigger === "proximity" && lit) {
      const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.4 + seed);
      ctx.save();
      ctx.strokeStyle = WARHEAD_PARTS.proximity.color;
      ctx.globalAlpha = 0.1 + pulse * 0.12;
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, GAME_CONFIG.warheads.proximity.distance + b.r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (b.stuck) {
      // Delayed fuse: a ring that fills as the charge counts down, blinking faster at the end
      const fuse = this.tierValue(GAME_CONFIG.warheads.delayed.fuse, b.tiers?.trigger);
      const left = clamp(b.stuck.t / fuse, 0, 1);
      const blink = Math.sin((1 - left) * (1 - left) * 60) > 0;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 13, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = WARHEAD_PARTS.delayed.color;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 10;
      ctx.shadowColor = WARHEAD_PARTS.delayed.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 13, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - left));
      ctx.stroke();
      if (blink) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Cluster bomblet: a blinking pellet with a short hot streak. */
  renderBomblet(ctx: CanvasRenderingContext2D, b: Bullet) {
    const blink = b.fuse < 0.18 ? (this.frame % 4 < 2 ? 1 : 0.4) : 0.85;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
    ctx.stroke();
    ctx.globalAlpha = blink;
    ctx.fillStyle = b.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Gravity wells: a dark lensing core with spiral arms winding inward and
   * rings that contract toward the centre. Incendiary patches: a molten rim,
   * licking flame tongues and rising embers that fade with the fire.
   */
  renderMissileZones(ctx: CanvasRenderingContext2D) {
    for (const z of this.missileZones) {
      const fade = clamp(z.life / Math.min(0.35, z.max), 0, 1);
      const age = z.max - z.life;
      ctx.save();
      ctx.translate(z.x, z.y);
      if (z.kind === "gravity") {
        const color = WARHEAD_PARTS.gravity.color;
        const grow = clamp(age / 0.2, 0, 1);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, z.r * grow);
        glow.addColorStop(0, "rgba(3,1,7,0.9)");
        glow.addColorStop(0.18, `${color}55`);
        glow.addColorStop(0.6, `${color}14`);
        glow.addColorStop(1, `${color}00`);
        ctx.globalAlpha = fade;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, z.r * grow, 0, TAU);
        ctx.fill();
        // contracting rings
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const t = (age * 0.9 + k / 3) % 1;
          ctx.globalAlpha = fade * t * 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, z.r * (1 - t) * grow, 0, TAU);
          ctx.stroke();
        }
        // spiral arms
        ctx.rotate(z.seed + age * 3.2);
        ctx.globalAlpha = fade * 0.42;
        ctx.lineWidth = 1.1;
        for (let arm = 0; arm < 3; arm++) {
          ctx.rotate(TAU / 3);
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const f = i / 24;
            const rr = z.r * 0.85 * grow * (1 - f) + 6;
            const a = f * 3.4;
            if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#030107";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, TAU);
        ctx.fill();
        ctx.stroke();
      } else {
        const color = WARHEAD_PARTS.incendiary.color;
        const heat = ctx.createRadialGradient(0, 0, 0, 0, 0, z.r);
        heat.addColorStop(0, "rgba(255,230,160,0.32)");
        heat.addColorStop(0.55, `${color}30`);
        heat.addColorStop(1, `${color}00`);
        ctx.globalAlpha = fade;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = heat;
        ctx.beginPath();
        ctx.arc(0, 0, z.r, 0, TAU);
        ctx.fill();
        // molten rim
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -age * 30;
        ctx.globalAlpha = fade * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, z.r * 0.92, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        // flame tongues
        for (let k = 0; k < 9; k++) {
          const a = z.seed + (k / 9) * TAU;
          const dist = z.r * (0.25 + ((k * 37) % 60) / 100);
          const fx = Math.cos(a) * dist,
            fy = Math.sin(a) * dist;
          const hgt = 9 + 6 * Math.sin(this.frame * 0.35 + k * 1.7);
          ctx.globalAlpha = fade * 0.85;
          ctx.fillStyle = k % 3 === 0 ? "#ffe0a3" : color;
          ctx.beginPath();
          ctx.moveTo(fx - 4, fy + 2);
          ctx.quadraticCurveTo(fx - 3, fy - hgt * 0.6, fx, fy - hgt);
          ctx.quadraticCurveTo(fx + 3, fy - hgt * 0.6, fx + 4, fy + 2);
          ctx.closePath();
          ctx.fill();
        }
        // embers rising out of the patch
        ctx.fillStyle = "#ffd166";
        for (let k = 0; k < 10; k++) {
          const t = (age * 0.8 + k * 0.137) % 1;
          const a = z.seed * 3 + k * 2.39;
          const ex = Math.cos(a) * z.r * 0.7 * ((k % 5) / 5 + 0.2);
          const ey = Math.sin(a) * z.r * 0.5 - t * 34;
          ctx.globalAlpha = fade * (1 - t);
          ctx.fillRect(ex, ey, 1.6, 1.6);
        }
      }
      ctx.restore();
    }
  }

  /**
   * Warhead status marks: frozen rocks wear a frost shell with crystal spines,
   * sunburned targets a slowly turning gold corona, and a chilled boss a frost ring.
   */
  renderWarheadStatus(ctx: CanvasRenderingContext2D) {
    const ice = WARHEAD_PARTS.cryo.color;
    const sun = WARHEAD_PARTS.solarFlare.color;
    const corona = (x: number, y: number, r: number, t: number, id: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.frame * 0.02 + id);
      ctx.globalAlpha = Math.min(1, t * 2) * 0.8;
      ctx.strokeStyle = sun;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 10;
      ctx.shadowColor = sun;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
        ctx.lineTo(Math.cos(a) * (r + 12), Math.sin(a) * (r + 12));
        ctx.stroke();
      }
      ctx.restore();
    };
    for (const r of this.rocks) {
      if ((r.frozen ?? 0) > 0) {
        ctx.save();
        ctx.translate(r.x, r.y);
        const fade = Math.min(1, (r.frozen ?? 0) * 3);
        const shell = ctx.createRadialGradient(0, 0, r.r * 0.3, 0, 0, r.r + 6);
        shell.addColorStop(0, "rgba(159,216,255,0.05)");
        shell.addColorStop(1, "rgba(159,216,255,0.32)");
        ctx.globalAlpha = fade;
        ctx.fillStyle = shell;
        ctx.beginPath();
        ctx.arc(0, 0, r.r + 6, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = r.permafrost ? "#ffffff" : ice;
        ctx.lineWidth = r.permafrost ? 1.6 : 1.1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = ice;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + r.id;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r.r * 0.75, Math.sin(a) * r.r * 0.75);
          ctx.lineTo(Math.cos(a) * (r.r + 7), Math.sin(a) * (r.r + 7));
          ctx.stroke();
        }
        ctx.restore();
      }
      if (r.sunburn) corona(r.x, r.y, r.r, r.sunburn.t, r.id);
    }
    for (const d of this.drones) if (d.sunburn) corona(d.x, d.y, d.r, d.sunburn.t, d.id);
    const bo = this.boss;
    if (bo) {
      if (bo.sunburn) corona(bo.x, bo.y, bo.r, bo.sunburn.t, bo.id);
      if ((bo.chill ?? 0) > 0) {
        ctx.save();
        ctx.strokeStyle = ice;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = this.frame * 0.4;
        ctx.beginPath();
        ctx.arc(bo.x, bo.y, bo.r + 14, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** EMP: offline specialists flicker grey with arcs crawling over the hull. */
  renderEmpOverlay(ctx: CanvasRenderingContext2D) {
    for (const d of this.drones) {
      const frozen = (d.frozen ?? 0) > 0 && !((d.emp ?? 0) > 0);
      if (!((d.emp ?? 0) > 0) && !frozen) continue;
      const color = frozen ? WARHEAD_PARTS.cryo.color : WARHEAD_PARTS.emp.color;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.frame * 0.9 + d.id);
      ctx.fillStyle = "rgba(20,24,34,0.55)";
      ctx.beginPath();
      ctx.arc(0, 0, d.r + 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      for (let k = 0; k < 2; k++) {
        const a = this.frame * 0.21 + k * Math.PI + d.id;
        ctx.beginPath();
        for (let i = 0; i <= 5; i++) {
          const t = a + i * 0.3;
          const rr = d.r + 3 + (i % 2 ? 4 : -1);
          if (i === 0) ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
          else ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      ctx.globalAlpha = this.frame % 30 < 20 ? 0.9 : 0.3;
      ctx.fillText(
        frozen ? `FROZEN ${Math.ceil(d.frozen ?? 0)}` : `OFFLINE ${Math.ceil(d.emp ?? 0)}`,
        0,
        -d.r - 8,
      );
      ctx.restore();
    }
  }

  renderPilot(ctx: CanvasRenderingContext2D) {
    // salvage companion sits between the hostile field and the player
    this.renderSalvageDrone(ctx);
    // dev squad members are real units: render them from their own state
    if (this.salvageDrone.active) {
      for (const c of this.salvageClones) {
        const unit: SalvageDrone = {
          ...this.salvageDrone,
          x: c.x,
          y: c.y,
          vx: c.vx,
          vy: c.vy,
          angle: c.angle,
          hp: c.hp,
          beamOn: c.beamOn,
          beamAngle: c.beamAngle,
          beamLen: c.beamLen,
          assembly: 0,
        };
        this.renderSalvageDrone(ctx, unit);
      }
    }

    // player
    if (this.mode !== "gameover" && this.p.hull > 0) {
      const p = this.p;
      // Salvo Lock: your cone and charge ring; every pilot's reticles (Crossfire reads)
      const accent = this.pilotAccent();
      const own = this.isLocalPilot();
      if (own && p.missileHoldT >= 0) this.renderLockCone(ctx, accent);
      this.renderLockReticles(ctx, accent, own);
      if (own) this.renderMissileRing(ctx, accent);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.invuln > 0 && Math.floor(this.frame / 3) % 2 === 0) ctx.globalAlpha = 0.55;
      if (p.thrusting) {
        const flick = 1 + this.random() * 0.5;
        ctx.beginPath();
        ctx.moveTo(-12, -7);
        ctx.lineTo(-12 - 16 * flick, 0);
        ctx.lineTo(-12, 7);
        ctx.closePath();
        ctx.fillStyle = AMBER;
        ctx.shadowBlur = 22;
        ctx.shadowColor = AMBER;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-13, -13);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-13, 13);
      ctx.closePath();
      const visibility = clamp(this.settings.shipVisibility ?? 0, 0, 1);
      ctx.fillStyle = visibility > 0 ? `rgba(255,224,163,${visibility})` : "rgba(12,14,22,0.85)";
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = this.god ? MAGENTA : AMBER_HOT;
      ctx.shadowBlur = 16 + visibility * 30;
      ctx.shadowColor = AMBER;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  renderBeam(ctx: CanvasRenderingContext2D) {
    // beam
    if (this.p.primary === "laser" && this.p.beamOn && this.mode === "playing") {
      const p = this.p,
        ba = this.beamAngle;
      const beam = this.laserStats(p.weapons.laser || 1);
      for (const angle of p.extraShots > 0 ? [ba, ba + Math.PI] : [ba]) {
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(angle) * 22, p.y + Math.sin(angle) * 22);
        ctx.lineTo(p.x + Math.cos(angle) * beam.range, p.y + Math.sin(angle) * beam.range);
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = beam.width + (this.random() - 0.5) * 2;
        ctx.shadowBlur = 26;
        ctx.shadowColor = beam.color;
        ctx.globalAlpha = 0.95;
        ctx.stroke();
        ctx.lineWidth = Math.max(1.2, beam.width * 0.18);
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    }
  }

  prepareFrame(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
  }

  render() {
    const ctx = this.ctx;
    const { w, h } = this;
    this.prepareFrame(ctx);

    const shakeAmt = this.screenShakeAmount();
    ctx.save();
    ctx.translate((this.random() - 0.5) * shakeAmt * 2, (this.random() - 0.5) * shakeAmt * 2);

    ctx.fillStyle = this.theme.tint;
    ctx.fillRect(-60, -60, w + 120, h + 120);
    const [starA, starB] = this.theme.stars;
    for (const s of this.stars) {
      const x = ((((s.x - this.p.x * 0.06 * s.z) % (w + 40)) + w + 40) % (w + 40)) - 20;
      const y = ((((s.y - this.p.y * 0.06 * s.z) % (h + 40)) + h + 40) % (h + 40)) - 20;
      ctx.globalAlpha = 0.18 + s.z * 0.5;
      ctx.fillStyle = s.z > 0.85 ? starA : starB;
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // pickups
    for (const u of this.pickups) {
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(this.frame * 0.03);
      const col = u.kind === "credit" ? AMBER : ICE;
      const pulse = u.pulse == null ? 0 : Math.sin(this.frame * 0.12 + u.pulse) * 1.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = u.kind === "credit" ? 2.3 : 2;
      ctx.shadowBlur = 12 + pulse;
      ctx.shadowColor = col;
      ctx.beginPath();
      if (u.kind === "credit") {
        ctx.moveTo(0, -8 - pulse);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 8 + pulse);
        ctx.lineTo(-7, 0);
        ctx.closePath();
      } else ctx.rect(-6, -6, 12, 12);
      ctx.stroke();
      if (u.kind === "credit") {
        ctx.beginPath();
        ctx.arc(0, 0, 2.5 + pulse * 0.25, 0, TAU);
        ctx.fillStyle = AMBER_HOT;
        ctx.fill();
        for (let n = 0; n < 4; n++) {
          const a = this.frame * 0.06 + (n * Math.PI) / 2;
          ctx.fillRect(Math.cos(a) * 10 - 1, Math.sin(a) * 10 - 1, 2, 2);
        }
      }
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // lingering warhead effects sit under the rocks they act on
    this.renderMissileZones(ctx);

    // rocks
    for (const r of this.rocks) {
      if (r.coopMine) {
        const triggered = r.coopMine.triggerTimer >= 0;
        const pulse = 0.5 + 0.5 * Math.sin(this.frame * (triggered ? 0.4 : 0.12));
        const radius = Math.max(25, r.r * 1.9);
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.strokeStyle = "#ff263d";
        ctx.fillStyle = "#7d1023";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#ff263d";
        ctx.shadowBlur = 16 + pulse * 10;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const angle = (i * TAU) / 16;
          const size = radius * (i % 2 ? 0.7 : 1);
          if (i === 0) ctx.moveTo(Math.cos(angle) * size, Math.sin(angle) * size);
          else ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.4 + pulse * 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, radius + 7 + pulse * 4, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff1ed";
        ctx.font = "bold 24px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", 0, 1);
        ctx.font = "bold 9px monospace";
        ctx.fillStyle = "#ff6675";
        ctx.fillText(triggered ? "DETONATING" : "MINE", 0, radius + 23);
        ctx.restore();
        continue;
      }
      const dmg = 1 - clamp(r.hp / r.maxHp, 0, 1);
      const special = r.trait !== "none";
      const col = TRAIT_COLOR[r.trait];
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.beginPath();
      for (let i = 0; i < r.pts.length; i++) {
        const a = (i / r.pts.length) * TAU,
          rad = r.r * r.pts[i];
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fillStyle =
        r.flash > 0
          ? "rgba(255,224,163,0.6)"
          : special
            ? "rgba(20,18,32,0.7)"
            : "rgba(26,29,43,0.62)";
      ctx.fill();
      ctx.lineWidth = r.flash > 0 ? 2.6 : special ? 2 : 1.6;
      ctx.strokeStyle =
        r.flash > 0 ? AMBER_HOT : special ? col : dmg > 0.45 ? "#c9762c" : "#8d6a3d";
      ctx.shadowBlur = r.flash > 0 ? 18 : special ? 14 : 8;
      ctx.shadowColor = r.flash > 0 ? AMBER : special ? col : "rgba(255,176,58,0.35)";
      ctx.stroke();
      ctx.shadowBlur = 0;
      this.drawCracks(ctx, r.cracks, dmg, r.flash, AMBER);
      ctx.restore();

      // trait glyphs (world space, un-rotated)
      if (r.trait === "homing") {
        const a = Math.atan2(this.p.y - r.y, this.p.x - r.x);
        const pulse = 0.6 + Math.sin(this.frame * 0.2) * 0.4;
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(r.r * 0.45, 0);
        ctx.lineTo(r.r * 0.1, -r.r * 0.25);
        ctx.lineTo(r.r * 0.1, r.r * 0.25);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.globalAlpha = pulse;
        ctx.shadowBlur = 10;
        ctx.shadowColor = col;
        ctx.fill();
        ctx.restore();
      } else if (r.trait === "bounce") {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * 0.42, 0, TAU);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
      } else if (r.trait === "boom") {
        const pulse = 1 + Math.sin(this.frame * (0.12 + dmg * 0.25)) * 0.35;
        // Flashing fuse: alternates between original orange and white when close to player
        const flashing = r.fuse !== undefined && r.fuse > 0;
        const flashColor = flashing && Math.floor(this.frame / 6) % 2 === 0 ? "#ffffff" : col;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * 0.22 * pulse, 0, TAU);
        ctx.fillStyle = flashColor;
        ctx.shadowBlur = flashing ? 24 : 16;
        ctx.shadowColor = flashing ? "#ffffff" : col;
        ctx.fill();
        if (flashing) {
          // the wider blast is telegraphed once the fuse is lit
          ctx.beginPath();
          ctx.arc(r.x, r.y, this.boomRadius(r.size), 0, TAU);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.28;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      } else if (r.trait === "fast") {
        const sp = Math.hypot(r.vx, r.vy) || 1;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - (r.vx / sp) * r.r * 1.6, r.y - (r.vy / sp) * r.r * 1.6);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
      } else if (r.trait === "meteor") {
        // long incandescent tail behind a streaking meteor
        const sp = Math.hypot(r.vx, r.vy) || 1;
        const tx = -(r.vx / sp),
          ty = -(r.vy / sp);
        const grad = ctx.createLinearGradient(r.x, r.y, r.x + tx * r.r * 7, r.y + ty * r.r * 7);
        grad.addColorStop(0, "rgba(255,224,163,0.9)");
        grad.addColorStop(0.35, "rgba(255,176,58,0.5)");
        grad.addColorStop(1, "rgba(255,122,42,0)");
        ctx.beginPath();
        ctx.moveTo(r.x + ty * r.r * 0.5, r.y - tx * r.r * 0.5);
        ctx.lineTo(r.x + tx * r.r * 7, r.y + ty * r.r * 7);
        ctx.lineTo(r.x - ty * r.r * 0.5, r.y + tx * r.r * 0.5);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.shadowBlur = 18;
        ctx.shadowColor = AMBER;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * 0.4, 0, TAU);
        ctx.fillStyle = "#fff4d6";
        ctx.fill();
      } else if (r.trait === "meteorite") {
        const pulse = 0.55 + Math.sin(this.frame * 0.25 + r.id) * 0.3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * 0.45, 0, TAU);
        ctx.fillStyle = "#ffd27a";
        ctx.globalAlpha = pulse;
        ctx.shadowBlur = 14;
        ctx.shadowColor = AMBER_HOT;
        ctx.fill();
        // tiny ember trail so the drift direction reads
        const sp = Math.hypot(r.vx, r.vy) || 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - (r.vx / sp) * r.r * 2, r.y - (r.vy / sp) * r.r * 2);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    this.renderSupportShields(ctx);

    // Enemy silhouettes share the same magenta vector armor language.
    for (const d of this.drones) {
      if (renderSpecialist(ctx, d, this.frame, this.spikerShots())) continue;
      if (d.kind === "spiker") {
        this.renderSpiker(ctx, d);
        continue;
      }
      const warden = d.kind === "warden";
      const s = d.r / 21;

      // wardens trail a low dread halo that pulses out from the hull
      if (warden) {
        const halo = 1 + Math.sin(this.frame * 0.05) * 0.12;
        ctx.save();
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 1.7 * halo, 0, TAU);
        ctx.fillStyle = "rgba(255,61,110,0.055)";
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);

      if (!warden) {
        // ---- sentinel: unchanged ----
        ctx.beginPath();
        ctx.moveTo(22 * s, 0);
        ctx.lineTo(6 * s, -13 * s);
        ctx.lineTo(-16 * s, -11 * s);
        ctx.lineTo(-10 * s, 0);
        ctx.lineTo(-16 * s, 11 * s);
        ctx.lineTo(6 * s, 13 * s);
        ctx.closePath();
        ctx.fillStyle = d.flash > 0 ? "rgba(255,61,110,0.55)" : "rgba(43,18,32,0.8)";
        ctx.fill();
        ctx.strokeStyle = d.flash > 0 ? "#fff" : MAGENTA;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = MAGENTA;
        ctx.stroke();
      } else {
        // ---- warden: a hunched, horned siege hull ----
        // swept outer mandibles
        ctx.beginPath();
        ctx.moveTo(30 * s, 0);
        ctx.lineTo(10 * s, -8 * s);
        ctx.lineTo(14 * s, -19 * s);
        ctx.lineTo(-4 * s, -16 * s);
        ctx.lineTo(-14 * s, -20 * s);
        ctx.lineTo(-20 * s, -9 * s);
        ctx.lineTo(-13 * s, 0);
        ctx.lineTo(-20 * s, 9 * s);
        ctx.lineTo(-14 * s, 20 * s);
        ctx.lineTo(-4 * s, 16 * s);
        ctx.lineTo(14 * s, 19 * s);
        ctx.lineTo(10 * s, 8 * s);
        ctx.closePath();
        ctx.fillStyle = d.flash > 0 ? "rgba(255,61,110,0.5)" : "rgba(26,6,18,0.92)";
        ctx.fill();
        ctx.strokeStyle = d.flash > 0 ? "#fff" : "#8e1438";
        ctx.lineWidth = 3 * s;
        ctx.shadowBlur = 26;
        ctx.shadowColor = MAGENTA;
        ctx.stroke();

        // ribbed spine plates
        ctx.strokeStyle = "rgba(255,61,110,0.34)";
        ctx.lineWidth = 1.2;
        for (const rib of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(-10 * s, rib * 7 * s);
          ctx.lineTo(8 * s, rib * 4.5 * s);
          ctx.stroke();
        }

        // a single slow-blinking cyclops eye — the ominous focal point
        const blink = Math.pow(Math.max(0, Math.sin(this.frame * 0.022 + d.id)), 0.35);
        const eyeR = (3.4 + blink * 2.6) * s;
        ctx.beginPath();
        ctx.ellipse(6 * s, 0, eyeR * 1.7, eyeR, 0, 0, TAU);
        ctx.fillStyle = "#ff3d6e";
        ctx.shadowBlur = 24 + blink * 18;
        ctx.shadowColor = MAGENTA;
        ctx.globalAlpha = 0.45 + blink * 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(6 * s, 0, eyeR * 0.6, eyeR * 0.34, 0, 0, TAU);
        ctx.fillStyle = "#fff0f4";
        ctx.fill();
        ctx.shadowBlur = 0;

        // forward horns framing the muzzle
        ctx.strokeStyle = "#8e1438";
        ctx.lineWidth = 2.4 * s;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(12 * s, side * 9 * s);
          ctx.quadraticCurveTo(26 * s, side * 12 * s, 33 * s, side * 5 * s);
          ctx.stroke();
        }
      }

      // Warden sniper telegraph: a long, bright orange warning beam that tracks
      // the player, plus a shrinking impact reticle at the aim point. The beam
      // brightens and tightens as the 0.6s fuse runs out.
      if (warden && d.pulseCharge !== undefined) {
        const frac = clamp(d.pulseCharge / 0.6, 0, 1); // 1 -> 0 as it fires
        const heat = 1 - frac;
        const flash = Math.floor(this.frame / 3) % 2 === 0 ? 1 : 0.45;
        // Distance along the (locked-aim) +x axis to the locked aim point
        const aimDist = Math.hypot(d.sniperAimX - d.x, d.sniperAimY - d.y);
        const muzzle = 30 * s;
        const beamEnd = Math.max(muzzle + 1500, aimDist + 20);
        ctx.save();
        // warning beam from the muzzle out past the locked aim point
        ctx.beginPath();
        ctx.moveTo(muzzle, 0);
        ctx.lineTo(beamEnd, 0);
        ctx.strokeStyle = `rgba(255,140,20,${(0.2 + heat * 0.55) * flash})`;
        ctx.lineWidth = 3 + heat * 4;
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -this.frame * 0.9;
        ctx.stroke();
        ctx.setLineDash([]);
        // shrinking impact reticle exactly on the locked aim point
        const ret = 14 + frac * 22;
        ctx.beginPath();
        ctx.arc(aimDist, 0, ret, 0, TAU);
        ctx.strokeStyle = `rgba(255,140,20,${0.35 + heat * 0.55})`;
        ctx.lineWidth = 2 + heat * 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(aimDist - ret - 6, 0);
        ctx.lineTo(aimDist - ret + 4, 0);
        ctx.moveTo(aimDist + ret - 4, 0);
        ctx.lineTo(aimDist + ret + 6, 0);
        ctx.moveTo(aimDist, -ret - 6);
        ctx.lineTo(aimDist, -ret + 4);
        ctx.moveTo(aimDist, ret - 4);
        ctx.lineTo(aimDist, ret + 6);
        ctx.stroke();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,61,110,0.25)";
      ctx.fillRect(-18 * s, -26 * s, 36 * s, 3);
      ctx.fillStyle = warden ? "#ff7aa0" : MAGENTA;
      ctx.fillRect(-18 * s, -26 * s, 36 * s * clamp(d.hp / d.maxHp, 0, 1), 3);
      // Warden miniboss: prominent floating health bar
      if (warden) {
        const barW = 58 * s,
          barH = 5 * s;
        const barX = -barW / 2,
          barY = -40 * s;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
        ctx.fillStyle = "rgba(255,61,110,0.2)";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = "#ff7aa0";
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#ff7aa0";
        ctx.fillRect(barX, barY, barW * clamp(d.hp / d.maxHp, 0, 1), barH);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,122,160,0.7)";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
      }
      ctx.restore();
    }

    // boss
    if (this.boss) {
      const b = this.boss;
      const dmg = 1 - clamp(b.hp / b.maxHp, 0, 1);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.beginPath();
      for (let i = 0; i < b.pts.length; i++) {
        const a = (i / b.pts.length) * TAU,
          rad = b.r * b.pts[i];
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      const isMk6 = b.mk === 6;
      ctx.fillStyle =
        b.flash > 0
          ? "rgba(255,224,163,0.6)"
          : isMk6
            ? "rgba(42,24,10,0.92)"
            : "rgba(30,16,26,0.82)";
      ctx.fill();
      ctx.lineWidth = isMk6 ? 3.8 : 3;
      ctx.strokeStyle = b.flash > 0 ? "#fff" : isMk6 ? "#ffaa33" : b.edgeColor;
      ctx.shadowBlur = isMk6 ? 32 : 22;
      ctx.shadowColor = isMk6 ? "#ff8800" : b.edgeColor;
      ctx.stroke();
      ctx.shadowBlur = 0;
      this.drawCracks(ctx, b.cracks, dmg, b.flash, isMk6 ? "#ffa020" : b.edgeColor, 1.7);

      // MK6 has molten golden-orange outer magma rings
      if (isMk6) {
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 1.12, 0, TAU);
        ctx.strokeStyle = "rgba(255,140,20,0.45)";
        ctx.lineWidth = 2.4;
        ctx.setLineDash([12, 14]);
        ctx.lineDashOffset = this.frame * 0.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const pulse = 1 + Math.sin(b.t * 3.2) * 0.12;
      const coreR = b.r * (isMk6 ? 0.42 : 0.34) * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, TAU);
      ctx.fillStyle = isMk6
        ? "#ffcc44"
        : b.final
          ? "rgba(255,224,163,0.9)"
          : "rgba(255,61,110,0.85)";
      ctx.shadowBlur = isMk6 ? 50 : 40;
      ctx.shadowColor = isMk6 ? "#ff7700" : b.final ? AMBER_HOT : b.edgeColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, coreR * 0.55, 0, TAU);
      ctx.fillStyle = "#120700";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, coreR * 0.7, -b.t * 1.4, -b.t * 1.4 + 4.4);
      ctx.strokeStyle = isMk6 ? "#ffe066" : b.final ? AMBER : b.edgeColor;
      ctx.lineWidth = isMk6 ? 2.8 : 2;
      ctx.stroke();
      ctx.restore();

      // MK5 destination marker & highlighted trajectory corridor
      if (b.mk === 5 && b.movement.mode === "mk5Telegraph") {
        const m = b.movement;
        const pulse = 1 + Math.sin(this.frame * 0.18) * 0.12;
        const size = b.r * 1.35 * pulse;

        // 1. Highlight the COMPLETE trajectory path from boss to destination
        const startX = m.startX ?? b.x;
        const startY = m.startY ?? b.y;
        const dx = m.targetX - startX;
        const dy = m.targetY - startY;
        const pathLen = Math.hypot(dx, dy) || 1;
        const nx = -dy / pathLen;
        const ny = dx / pathLen;
        const corridorW = b.r * 1.1;

        ctx.save();
        // Danger zone corridor fill
        ctx.beginPath();
        ctx.moveTo(startX + nx * corridorW, startY + ny * corridorW);
        ctx.lineTo(m.targetX + nx * corridorW, m.targetY + ny * corridorW);
        ctx.lineTo(m.targetX - nx * corridorW, m.targetY - ny * corridorW);
        ctx.lineTo(startX - nx * corridorW, startY - ny * corridorW);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 122, 20, 0.18)";
        ctx.fill();

        // Pulsating outer dashed guide rails
        ctx.strokeStyle = "#ff7a2a";
        ctx.lineWidth = 3;
        ctx.shadowBlur = 18;
        ctx.shadowColor = "#ff7a2a";
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -this.frame * 1.2;
        ctx.beginPath();
        ctx.moveTo(startX + nx * corridorW, startY + ny * corridorW);
        ctx.lineTo(m.targetX + nx * corridorW, m.targetY + ny * corridorW);
        ctx.moveTo(startX - nx * corridorW, startY - ny * corridorW);
        ctx.lineTo(m.targetX - nx * corridorW, m.targetY - ny * corridorW);
        ctx.stroke();

        // Center trajectory line
        ctx.strokeStyle = "rgba(255, 224, 163, 0.85)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(m.targetX, m.targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Animated warning chevrons running toward target
        const chevronSpacing = 68;
        const chevronCount = Math.floor(pathLen / chevronSpacing);
        const flow = (this.frame * 3.2) % chevronSpacing;
        const a = Math.atan2(dy, dx);
        ctx.strokeStyle = "#ffcc44";
        ctx.lineWidth = 3.5;
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#ffaa00";
        for (let i = 0; i <= chevronCount; i++) {
          const distAlong = i * chevronSpacing + flow;
          if (distAlong > 40 && distAlong < pathLen - 40) {
            const cx = startX + (dx / pathLen) * distAlong;
            const cy = startY + (dy / pathLen) * distAlong;
            const arm = 22;
            ctx.beginPath();
            ctx.moveTo(cx - Math.cos(a - 0.65) * arm, cy - Math.sin(a - 0.65) * arm);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx - Math.cos(a + 0.65) * arm, cy - Math.sin(a + 0.65) * arm);
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;
        ctx.restore();

        // 2. Large obvious target box at destination
        ctx.save();
        ctx.translate(m.targetX, m.targetY);
        ctx.rotate(this.frame * 0.025);
        ctx.strokeStyle = "#ff7700";
        ctx.lineWidth = 4;
        ctx.shadowBlur = 28;
        ctx.shadowColor = "#ff7a2a";
        ctx.strokeRect(-size, -size, size * 2, size * 2);
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -this.frame * 0.9;
        ctx.strokeStyle = "#ffe0a3";
        ctx.lineWidth = 2;
        ctx.strokeRect(-size * 1.28, -size * 1.28, size * 2.56, size * 2.56);
        ctx.setLineDash([]);
        // Crosshairs extending outward
        ctx.beginPath();
        ctx.moveTo(-size * 1.6, 0);
        ctx.lineTo(size * 1.6, 0);
        ctx.moveTo(0, -size * 1.6);
        ctx.lineTo(0, size * 1.6);
        ctx.strokeStyle = "#ffaa22";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Warning text & countdown
        ctx.font = '700 13px "IBM Plex Mono", monospace';
        ctx.fillStyle = "#ffbb33";
        ctx.textAlign = "center";
        ctx.fillText(`IMPACT IN ${m.timer.toFixed(1)}s`, 0, -size - 18);
        ctx.restore();
      }

      // MK6 return marker: the original arena position is shown before re-entry.
      if (b.mk === 6 && b.movement.mode === "mk6ReturnTelegraph") {
        const m = b.movement;
        const size = b.r * (1.35 + Math.sin(this.frame * 0.14) * 0.08);
        ctx.save();
        ctx.translate(m.targetX, m.targetY);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 3.5;
        ctx.shadowBlur = 28;
        ctx.shadowColor = "#ff8800";
        ctx.strokeRect(-size, -size, size * 2, size * 2);
        ctx.beginPath();
        ctx.moveTo(-size * 1.5, 0);
        ctx.lineTo(size * 1.5, 0);
        ctx.moveTo(0, -size * 1.5);
        ctx.lineTo(0, size * 1.5);
        ctx.strokeStyle = "#fff3b0";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // ---- MK6 apocalyptic overlays ----
      if (b.mk6) {
        const m = b.mk6;
        // Orange warning aura around boss before regenesis blasts
        for (const slot of m.slots) {
          if (slot.attack === "heal") {
            for (const hb of slot.healBlasts) {
              if (!hb.fired && !hb.silent && hb.t < 1.0) {
                const auraProg = 1 - hb.t / 1.0;
                ctx.save();
                ctx.beginPath();
                ctx.arc(b.x, b.y, 390 * (0.4 + auraProg * 0.6), 0, TAU);
                ctx.strokeStyle = "rgba(255,140,0,0.85)";
                ctx.lineWidth = 4 + auraProg * 5;
                ctx.shadowBlur = 30;
                ctx.shadowColor = "#ff7a2a";
                ctx.stroke();
                ctx.fillStyle = "rgba(255,80,0,0.12)";
                ctx.fill();
                ctx.restore();
              }
            }
          }
        }
        for (const slot of m.slots) {
          if (slot.attack === "beam") {
            const len = Math.max(w, h) * 1.2;
            const arms = m.enraged ? 8 : 4;
            for (let i = 0; i < arms; i++) {
              const a = slot.beamA + i * (TAU / arms);
              const ex = b.x + Math.cos(a) * len,
                ey = b.y + Math.sin(a) * len;
              ctx.save();
              const grad = ctx.createLinearGradient(b.x, b.y, ex, ey);
              grad.addColorStop(0, "rgba(255,224,163,0.95)");
              grad.addColorStop(0.4, "rgba(255,176,58,0.55)");
              grad.addColorStop(1, "rgba(255,122,42,0.05)");
              ctx.beginPath();
              ctx.moveTo(b.x, b.y);
              ctx.lineTo(ex, ey);
              ctx.strokeStyle = grad;
              ctx.lineWidth = 15 + Math.sin(this.frame * 0.3 + i) * 3;
              ctx.shadowBlur = 30;
              ctx.shadowColor = AMBER;
              ctx.stroke();
              ctx.lineWidth = 3;
              ctx.strokeStyle = "#fff6e0";
              ctx.stroke();
              ctx.restore();
            }
          }
          // meteor strike telegraphs — wide impact rings
          for (const s of slot.strikes) {
            const prog = 1 - clamp(s.t / s.t0, 0, 1);
            ctx.save();
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * (0.35 + prog * 0.65), 0, TAU);
            ctx.strokeStyle = "#ffd27a";
            ctx.lineWidth = 2 + prog * 3;
            ctx.globalAlpha = 0.3 + prog * 0.6;
            ctx.setLineDash([9, 7]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, TAU);
            ctx.globalAlpha = 0.16 + prog * 0.2;
            ctx.fillStyle = ORANGE;
            ctx.fill();
            ctx.restore();
          }
        }
        if (b.shieldHp > 0) {
          const pulse = 1 + Math.sin(this.frame * 0.12) * 0.05;
          ctx.save();
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * 1.32 * pulse, 0, TAU);
          ctx.strokeStyle = ICE;
          ctx.lineWidth = 3.5;
          ctx.globalAlpha = 0.55 + Math.sin(this.frame * 0.2) * 0.15;
          ctx.shadowBlur = 26;
          ctx.shadowColor = ICE;
          ctx.stroke();
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = ICE;
          ctx.fill();
          ctx.restore();
        }
      }

      // shockwave telegraph — a ring that tightens around the boss until detonation
      if (b.shockT > 0) {
        const urgency = 1 - clamp(b.shockT / b.shockDur, 0, 1);
        const R = b.shockRadius || 250;
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, R, 0, TAU);
        ctx.fillStyle = ORANGE;
        ctx.globalAlpha = 0.05 + urgency * 0.2;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, R, 0, TAU);
        ctx.strokeStyle = "#ff7a2a";
        ctx.lineWidth = 3 + urgency * 4;
        ctx.globalAlpha = 0.35 + urgency * 0.55;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -this.frame * 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // singularity — themed event horizon, gravitational lensing, accretion particles, and health meter
      if (b.hole) {
        const h = b.hole;
        const spin = this.frame * (0.06 + h.mk * 0.025);
        ctx.save();
        ctx.translate(h.x, h.y);

        // Flash on damage
        const col = h.flash > 0 ? AMBER_HOT : h.color;
        const coreCol = h.flash > 0 ? "#ffffff" : h.coreColor;

        // Outer gravitational distortion field (dashed concentric orbiting rings)
        const distR = h.r * 2.2 + Math.sin(this.frame * 0.08) * 4;
        ctx.beginPath();
        ctx.arc(0, 0, distR, 0, TAU);
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = 0.22 + h.mk * 0.04;
        ctx.setLineDash([8, 12]);
        ctx.lineDashOffset = -this.frame * (0.4 + h.mk * 0.2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Radiative accretion corona (especially intense on MK5/MK6)
        if (h.mk >= 4) {
          ctx.beginPath();
          ctx.arc(0, 0, h.r * (1.3 + Math.sin(this.frame * 0.15) * 0.1), 0, TAU);
          ctx.fillStyle = h.ringColor;
          ctx.globalAlpha = 0.18 + (h.mk === 6 ? 0.22 : 0.08);
          ctx.shadowBlur = 25 + h.mk * 8;
          ctx.shadowColor = h.color;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }

        // Swirling spiral arms (higher count & speed at higher MK)
        const armCount = h.mk === 6 ? 6 : h.mk === 5 ? 5 : h.mk === 4 ? 4 : 3;
        for (let i = 0; i < armCount; i++) {
          const dir = i % 2 ? -1 : 1;
          const a0 = spin * dir + i * (TAU / armCount);
          ctx.beginPath();
          const armRadius = h.r * 0.65 + i * (h.r * 0.35);
          ctx.arc(0, 0, armRadius, a0, a0 + 2.2);
          ctx.strokeStyle = i % 2 === 0 ? col : h.ringColor;
          ctx.lineWidth = 2.2 + (h.mk >= 5 ? 1 : 0);
          ctx.shadowBlur = 12 + h.mk * 4;
          ctx.shadowColor = h.color;
          ctx.globalAlpha = 0.75 + Math.sin(this.frame * 0.2 + i) * 0.25;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;

        // Dark event horizon with intense glowing photon ring
        const corePulse = 1 + Math.sin(this.frame * (0.12 + h.mk * 0.04)) * 0.08;
        ctx.beginPath();
        ctx.arc(0, 0, h.r * 0.52 * corePulse, 0, TAU);
        ctx.fillStyle = "#030107";
        ctx.fill();
        ctx.strokeStyle = coreCol;
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 18 + h.mk * 6;
        ctx.shadowColor = h.color;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Circular health meter showing vulnerability to player fire
        const hpFrac = clamp(h.hp / h.maxHp, 0, 1);
        ctx.beginPath();
        ctx.arc(0, 0, h.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * hpFrac);
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 8;
        ctx.shadowColor = h.color;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Health background ring
        ctx.beginPath();
        ctx.arc(0, 0, h.r + 8, 0, TAU);
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label with remaining HP percentage
        ctx.font = '600 8.5px "IBM Plex Mono", monospace';
        ctx.fillStyle = coreCol;
        ctx.textAlign = "center";
        ctx.fillText(`ANOMALY ${Math.round(hpFrac * 100)}%`, 0, -h.r - 14);

        ctx.restore();
      }

      // ---- MK3 · PINBALL CASCADE charge telegraph ---------------------------
      if (b.cascadeCharge > 0) {
        const prog = 1 - clamp(b.cascadeCharge / 0.85, 0, 1);
        ctx.save();
        // tightening dashed ring around the boss
        const cr = b.r * (2.4 - prog * 1.1);
        ctx.beginPath();
        ctx.arc(b.x, b.y, cr, 0, TAU);
        ctx.strokeStyle = `rgba(111,231,255,${0.3 + prog * 0.6})`;
        ctx.lineWidth = 2 + prog * 3;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -this.frame * 1.1;
        ctx.stroke();
        ctx.setLineDash([]);
        // bouncing tick marks previewing the ricochet direction
        for (let i = 0; i < 4; i++) {
          const a = this.frame * 0.05 + i * (TAU / 4);
          const tx = b.x + Math.cos(a) * cr;
          const ty = b.y + Math.sin(a) * cr;
          ctx.beginPath();
          ctx.moveTo(tx - 5, ty);
          ctx.lineTo(tx + 5, ty);
          ctx.moveTo(tx, ty - 5);
          ctx.lineTo(tx, ty + 5);
          ctx.strokeStyle = `rgba(111,231,255,${0.4 + prog * 0.5})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- MK3 · RICOCHET RING forming telegraph ---------------------------
      if (b.ricochetRing > 0 && b.ricochetFired < b.ricochetRing + b.ricochetFired) {
        const total = b.ricochetRing + b.ricochetFired;
        ctx.save();
        // ghost orbit showing where each remaining rock sits
        for (let i = 0; i < b.ricochetRing; i++) {
          const slot = b.ricochetFired + i;
          const a = b.ricochetPhase + (slot / Math.max(1, total)) * TAU;
          const ox = b.x + Math.cos(a) * (b.r + 58);
          const oy = b.y + Math.sin(a) * (b.r + 58);
          ctx.beginPath();
          ctx.arc(ox, oy, 9, 0, TAU);
          ctx.strokeStyle = "rgba(111,231,255,0.75)";
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = ICE;
          ctx.stroke();
          ctx.shadowBlur = 0;
          // small inner dot marks it as a live round
          ctx.beginPath();
          ctx.arc(ox, oy, 2.4, 0, TAU);
          ctx.fillStyle = ICE;
          ctx.fill();
        }
        // faint orbit path
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 58, 0, TAU);
        ctx.strokeStyle = "rgba(111,231,255,0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // boom-launch drop markers — a pulsing ring that closes in before the rock appears
      for (const d of b.boomDrops) {
        const prog = 1 - clamp(d.t / d.t0, 0, 1);
        ctx.save();
        ctx.strokeStyle = ORANGE;
        ctx.globalAlpha = 0.3 + prog * 0.6;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 18 + (1 - prog) * 46, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 6 + prog * 4, 0, TAU);
        ctx.fillStyle = ORANGE;
        ctx.globalAlpha = 0.25 + prog * 0.5;
        ctx.fill();
        ctx.restore();
      }

      // ignition-strike telegraphs — shrinking crosshairs before detonation
      for (const s of b.strikes) {
        const prog = 1 - clamp(s.t / s.t0, 0, 1);
        const rr = 20 + (1 - prog) * (GAME_CONFIG.bosses.mk4.strikeRadius - 20);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, TAU);
        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.35 + prog * 0.65;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 9, s.y);
        ctx.lineTo(s.x + 9, s.y);
        ctx.moveTo(s.x, s.y - 9);
        ctx.lineTo(s.x, s.y + 9);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const bw = Math.min(540, w * 0.62),
        bx = w / 2 - bw / 2;
      ctx.textAlign = "center";
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = b.final ? AMBER_HOT : b.edgeColor;
      ctx.fillText(
        `${b.name} ${b.suffix} · ${Math.max(1, Math.ceil((b.hp / b.maxHp) * 100))}%`,
        w / 2,
        20,
      );
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(bx, 26, bw, 8);
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (b.final) {
        grad.addColorStop(0, "#ff3d6e");
        grad.addColorStop(1, "#ffe0a3");
      } else {
        grad.addColorStop(0, "#a8233f");
        grad.addColorStop(1, MAGENTA);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(bx, 26, bw * clamp(b.hp / b.maxHp, 0, 1), 8);
      // the regenesis shield reads as a distinct segment beyond the hull
      if (b.shieldHp > 0) {
        const hpFrac = clamp(b.hp / b.maxHp, 0, 1);
        const shFrac = clamp(b.shieldHp / b.maxHp, 0, 0.15);
        const shGrad = ctx.createLinearGradient(
          bx + bw * hpFrac,
          0,
          bx + bw * (hpFrac + shFrac),
          0,
        );
        shGrad.addColorStop(0, "rgba(111,231,255,0.95)");
        shGrad.addColorStop(1, "rgba(217,179,255,0.95)");
        ctx.fillStyle = shGrad;
        ctx.fillRect(bx + bw * hpFrac, 26, bw * shFrac, 8);
      }
      ctx.strokeStyle = "rgba(255,61,110,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, 26.5, bw - 1, 7);
    }

    this.renderEmpOverlay(ctx);
    this.renderWarheadStatus(ctx);
    this.forEachPilot(() => this.renderPilot(ctx));

    // bullets
    this.trackMissileTrails();
    for (const b of this.bullets) {
      const a = Math.atan2(b.vy, b.vx);
      if (b.kind === "missile") {
        this.renderMissile(ctx, b);
        continue;
      }
      if (b.kind === "bomblet") {
        this.renderBomblet(ctx, b);
        continue;
      }
      if (b.kind === "flak") {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4.5, 0, TAU);
        ctx.fillStyle = AMBER;
        ctx.shadowBlur = 14;
        ctx.shadowColor = AMBER;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4.5 + Math.max(0, 0.45 - b.fuse) * 30, 0, TAU);
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      if (b.kind === "wardenOrb") {
        // Smart nest node that spawns up to 6 seeking orbs, can be shot down with 2 shots
        const fusionPulse = clamp((b.life || 0) / 10.5, 0, 1);
        const nodePulse = 1 + Math.sin(this.frame * 0.28) * 0.08;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * nodePulse, 0, TAU);
        ctx.fillStyle = "rgba(255,122,160,0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * nodePulse, 0, TAU);
        ctx.strokeStyle = "#ff7aa0";
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 20;
        ctx.shadowColor = "#ff7aa0";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU);
        ctx.fillStyle = "#ffb3d0";
        ctx.fill();
        // Fusion timer ring
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * fusionPulse);
        ctx.strokeStyle = "#ffd9e8";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Six small turret speakers for active orb count
        ctx.fillStyle = "#ffe0a0";
        for (let k = 0; k < 6; k++) {
          const a = this.frame * 0.08 + k * (TAU / 6);
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * (b.r * 1.8), b.y + Math.sin(a) * (b.r * 1.8), 2, 0, TAU);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        continue;
      }
      if (b.kind === "wardenShard") {
        // small homing teardrop
        const a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-4, -3.4);
        ctx.lineTo(-4, 3.4);
        ctx.closePath();
        ctx.fillStyle = "#ffb3d0";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#ff7aa0";
        ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;
        continue;
      }
      const len =
        b.kind === "rail"
          ? 26
          : b.kind === "enemy"
            ? 12
            : b.kind === "shrap"
              ? 7
              : b.kind === "seeker"
                ? 10
                : 15;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(a) * len, b.y - Math.sin(a) * len);
      ctx.lineTo(b.x + Math.cos(a) * len * 0.4, b.y + Math.sin(a) * len * 0.4);
      ctx.strokeStyle = b.color;
      ctx.lineWidth =
        b.kind === "rail"
          ? 5
          : b.kind === "ricochet"
            ? 3.5
            : b.kind === "enemy"
              ? 3
              : b.kind === "shrap"
                ? 1.8
                : 2.6;
      ctx.shadowBlur = 12;
      ctx.shadowColor = b.color;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    this.forEachPilot(() => this.renderBeam(ctx));

    // arcs
    for (const arc of this.arcs) {
      const alpha = clamp(arc.life / 0.14, 0, 1);
      const dx = arc.x2 - arc.x1,
        dy = arc.y2 - arc.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len,
        ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      const segs = 7;
      for (let i = 1; i < segs; i++) {
        const t = i / segs,
          off = (this.random() - 0.5) * 18;
        ctx.lineTo(arc.x1 + dx * t + nx * off, arc.y1 + dy * t + ny * off);
      }
      ctx.lineTo(arc.x2, arc.y2);
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 18;
      ctx.shadowColor = ICE;
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // rings
    for (const r of this.rings) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0, r.r), 0, TAU);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = clamp(r.life, 0, 1) * 0.85;
      ctx.lineWidth = r.w;
      ctx.shadowBlur = 18;
      ctx.shadowColor = r.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.globalCompositeOperation = "lighter";
    for (const q of this.particles) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.9;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      ctx.fillStyle = t.color;
      ctx.font = `600 ${t.size}px "IBM Plex Mono", monospace`;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    if (this.mode === "levelup") {
      ctx.fillStyle = "rgba(255,176,58,0.07)";
      ctx.fillRect(-40, -40, w + 80, h + 80);
    }
    if (this.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,224,163,${this.flashAlpha * 0.28})`;
      ctx.fillRect(-40, -40, w + 80, h + 80);
    }
    if (this.salvoFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.salvoFlash * 0.32})`;
      ctx.fillRect(-40, -40, w + 80, h + 80);
    }

    ctx.restore();
  }
}

/* ------------------------------------------------------------ high scores */

const KEY = "helios-drift-scores-v1";

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function saveScore(e: ScoreEntry): ScoreEntry[] {
  const list = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

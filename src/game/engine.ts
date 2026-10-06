/* HELIOS DRIFT — hand-written canvas vector-arcade engine.
   File map:
   - types.ts    shared interfaces and unions (pure types)
   - math.ts     small math helpers
   - balance.ts  tuning tables: weapons, upgrades, bosses, sectors + factories
   - audio.ts    procedural WebAudio synth
   The Game class below is the simulation. New content should land in the
   tables first, with the class consuming them. */

import { audio, type Sfx } from "./audio";
import { TAU, rnd, clamp, wrapAngle } from "./math";
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
  WEAPON_DEFS,
  WEAPON_BASE_PRICE,
  STAT_UPGRADES,
  SALVAGE_BASE_PRICE,
  SALVAGE_UPGRADES,
  SALVAGE_UPGRADE_ORDER,
  SENTINEL_BOLT_DMG,
  WARDEN_BOLT_DMG,
  freshPlayer,
  freshSalvageDrone,
} from "./balance";
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
} from "./types";
import { GAME_CONFIG } from "./game-config";

/* The React shell imports everything from "./engine" — keep that surface
   stable by re-exporting the extracted modules. */
export * from "./types";
export * from "./math";
export * from "./balance";

/* ------------------------------------------------------------ game */

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 1000;
  h = 700;
  dpr = 1;
  mode: Mode = "menu";
  raf = 0;
  last = 0;
  frame = 0;

  onHud: (h: Hud) => void;
  onMode: (m: Mode) => void;

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
  xpNext = GAME_CONFIG.progression.startingXpNext;
  combo = 0;
  comboTimer = 0;
  shake = 0;
  timeScale = 1;
  flashAlpha = 0;
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
  settings = {
    autoFire: false,
    mouseControl: false,
    hybridAim: true,
    legacyMovement: false,
    shake: true,
  };
  mouse = { x: 0, y: 0 };
  mouseDown = false;

  keys: Record<string, boolean> = {};
  stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  touchFire = false;
  private ro: ResizeObserver | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    cb: { onHud: (h: Hud) => void; onMode: (m: Mode) => void },
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    this.onHud = cb.onHud;
    this.onMode = cb.onMode;
    this.resize();
    this.reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.makeStars();
    this.resetRun();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    // the playfield now fills whatever the HUD leaves free, so follow its box, not just the window
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
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
        x: Math.random() * 2000,
        y: Math.random() * 1400,
        z: rnd(0.25, 1),
        s: rnd(0.5, 1.9),
      });
    }
  }

  resetRun() {
    this.p = freshPlayer();
    this.salvageDrone = freshSalvageDrone();
    this.salvageClones = [];
    this.p.x = this.w / 2;
    this.p.y = this.h / 2;
    this.stacks = {};
    this.rocks = [];
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
    audio.unlock();
    this.resetRun();
    this.setMode("playing");
    this.nextWave();
  }

  setMode(m: Mode) {
    this.mode = m;
    if (m !== "playing") {
      audio.silence();
      this.p.beamOn = false;
    }
    this.onMode(m);
  }

  /* ------------------------------------------------------------ input */

  onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "tab"].includes(k))
      e.preventDefault();
    this.keys[k] = true;
    if (k === "p" || k === "escape") {
      if (this.mode === "playing") this.setMode("paused");
      else if (this.mode === "paused") this.setMode("playing");
    }
    if (
      k === "r" &&
      (this.mode === "gameover" || this.mode === "paused" || this.mode === "victory")
    )
      this.startGame();
    if (
      (k === "enter" || k === " ") &&
      (this.mode === "menu" || this.mode === "gameover" || this.mode === "victory")
    )
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
    audio.unlock();
    this.updateMouse(e);
    if (this.mode !== "playing") return;
    if (this.settings.mouseControl && e.pointerType === "mouse") {
      this.mouseDown = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    // hybrid aim steers with the keyboard, so a mouse click is a trigger and
    // must never spawn the virtual thumbstick
    if (this.settings.hybridAim && e.pointerType === "mouse") {
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
      if (this.settings.hybridAim) this.touchFire = false;
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
      audio.play("beamStop");
      this.p.beamOn = false;
    }
    this.p.fireTimer = Math.max(this.p.fireTimer, 0.12);
    audio.play("cycle");
    this.floatText(this.p.x, this.p.y - 30, WEAPON_DEFS[w].short, AMBER_HOT, 12);
  }

  cycleWeapon(dir: 1 | -1) {
    const owned = this.ownedWeapons();
    if (owned.length < 2) return;
    const i = owned.indexOf(this.p.primary);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  weaponStats(W: WeaponId, L: number) {
    const p = this.p;
    const lv = Math.max(0, L - 1);
    const weapon = GAME_CONFIG.weaponProgression.weapons[W];
    const s = {
      rate: weapon.baseRate,
      dmg: "baseDamage" in weapon ? weapon.baseDamage : 16,
      shots: "baseShots" in weapon ? weapon.baseShots : 1,
      arc: 0.026,
      speed: 720,
      life: 1.15,
      r: 3.6,
      pierce: p.pierce,
      bounces: 0,
      fuse: 0,
      turn: 0,
      extra: 0,
      extraDmg: 0,
      kind: "plasma" as Bullet["kind"],
      color: AMBER_HOT,
      sfx: "pulse" as Sfx,
    };
    switch (W) {
      case "pulse":
        s.rate *= 1 + weapon.ratePerLevel * lv;
        s.dmg *= 1 + weapon.damagePerLevel * lv;
        s.shots += Math.floor(lv / weapon.shotsEveryLevels);
        break;
      case "spread":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.baseDamage * (1 + weapon.damagePerLevel * lv);
        s.shots = weapon.baseShots + Math.floor(lv * weapon.shotsPerLevel);
        s.arc = weapon.arc;
        s.sfx = "spread";
        break;
      case "seeker":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.baseDamage * (1 + weapon.damagePerLevel * lv);
        s.shots = weapon.baseShots + Math.floor(lv / weapon.shotsEveryLevels);
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.arc = weapon.arc;
        s.turn = weapon.turn;
        s.kind = "seeker";
        s.color = "#ff8fb0";
        s.sfx = "seeker";
        break;
      case "ricochet":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.baseDamage * (1 + weapon.damagePerLevel * lv);
        s.shots = weapon.baseShots + Math.floor(lv / weapon.shotsEveryLevels);
        s.bounces = weapon.baseBounces + Math.floor(lv / weapon.bouncesEveryLevels);
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.kind = "ricochet";
        s.color = ICE;
        s.sfx = "ricochet";
        break;
      case "flak":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.baseDamage;
        s.shots = weapon.baseShots + Math.floor(lv / weapon.shotsEveryLevels);
        s.fuse = weapon.fuse;
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.kind = "flak";
        s.color = AMBER;
        s.sfx = "flak";
        s.extra = weapon.baseShrapnel + weapon.shrapnelPerLevel * lv;
        s.extraDmg = weapon.shrapnelDamage * (1 + weapon.shrapnelDamagePerLevel * lv);
        break;
      case "rail":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg =
          weapon.baseDamage *
          weapon.damageScale *
          (1 + weapon.damagePerLevel * lv) *
          (lv >= 5 ? weapon.maxLevelDamageBonus : 1);
        s.pierce = weapon.basePierce + Math.floor(lv / weapon.pierceEveryLevels) + p.pierce;
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.turn = weapon.turn;
        s.kind = "rail";
        s.color = ICE;
        s.sfx = "rail";
        break;
      case "laser":
        // the player fires a raycast beam; a drone mount fires coherent bolts
        // that still read unmistakably as beam energy
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.damage * (1 + weapon.damagePerLevel * lv);
        // never "beamStart" here: that opens the persistent beam voice, which
        // only closes on beamStop and would leave a stuck drone whine
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.pierce = 1 + p.pierce;
        s.color = ICE;
        s.sfx = "arc";
        break;
      case "arc":
        s.rate = weapon.baseRate * (1 + weapon.ratePerLevel * lv);
        s.dmg = weapon.baseDamage * (1 + weapon.damagePerLevel * lv);
        s.speed = weapon.speed;
        s.life = weapon.life;
        s.r = weapon.radius;
        s.color = "#bff3ff";
        s.sfx = "arc";
        break;
      default:
        break;
    }
    s.rate *= p.fireRateMul;
    s.dmg *= p.damageMul;
    s.extraDmg *= p.damageMul;
    s.shots += p.extraShots;
    return s;
  }

  weaponPrice(w: WeaponId): number | null {
    const level = this.p.weapons[w];
    if (level >= MAX_WEAPON_LEVEL) return null;
    const base = WEAPON_BASE_PRICE[WEAPON_DEFS[w].rarity];
    return (
      Math.round(
        (base * Math.pow(GAME_CONFIG.weaponProgression.priceMultiplier, level)) /
          GAME_CONFIG.weaponProgression.priceRounding,
      ) * GAME_CONFIG.weaponProgression.priceRounding
    );
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
    audio.play("buy");
    return true;
  }

  weaponRows(w: WeaponId, level: number): WeaponStatRow[] {
    if (level <= 0) return [];
    if (w === "laser") {
      const s = this.laserStats(level);
      return [
        { label: "Beam DPS", value: Math.round(s.dps).toString() },
        { label: "Heat / sec", value: s.heatRate.toFixed(2) },
        { label: "Range", value: "1100" },
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
    if (w === "rail") rows.push({ label: "Effective range", value: "2112" });
    return rows;
  }

  weaponShopInfo(w: WeaponId): WeaponShopInfo {
    const level = this.p.weapons[w];
    const nextLevel = Math.min(MAX_WEAPON_LEVEL, Math.max(1, level + 1));
    return {
      id: w,
      level,
      maxLevel: MAX_WEAPON_LEVEL,
      price: this.weaponPrice(w),
      rarity: WEAPON_DEFS[w].rarity,
      owned: level > 0,
      current: this.weaponRows(w, level),
      next: level < MAX_WEAPON_LEVEL ? this.weaponRows(w, nextLevel) : [],
    };
  }

  buyWeapon(w: WeaponId): boolean {
    const price = this.weaponPrice(w);
    if (price == null || this.credits < price) return false;
    const wasLocked = this.p.weapons[w] === 0;
    this.credits -= price;
    this.p.weapons[w] = Math.min(MAX_WEAPON_LEVEL, this.p.weapons[w] + 1);
    if (wasLocked) this.selectWeapon(w);
    audio.play("buy");
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
    const def = SALVAGE_UPGRADES[id];
    const level = this.salvageDrone.upgrades[id];
    if (level >= def.max) return null;
    const nextIsFinal = level + 1 === def.max;
    const finalMultiplier = nextIsFinal ? GAME_CONFIG.salvage.finalUpgradePriceMultiplier : 1;
    return (
      Math.round(
        (def.base * Math.pow(GAME_CONFIG.salvage.upgradePriceMultiplier, level) * finalMultiplier) /
          GAME_CONFIG.weaponProgression.priceRounding,
      ) * GAME_CONFIG.weaponProgression.priceRounding
    );
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
    audio.play("droneAssemble");
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
    if (id === "repairPulse") d.pulseTimer = 0.2;
    this.floatText(d.x, d.y - 26, `${def.name.toUpperCase()} LV ${d.upgrades[id]}`, ICE, 12);
    this.burst(d.x, d.y, 8, ICE);
    audio.play("buy");
    return true;
  }

  arcStats(L: number) {
    const lv = Math.max(0, L - 1);
    return {
      range:
        GAME_CONFIG.weaponProgression.weapons.arc.baseRange +
        GAME_CONFIG.weaponProgression.weapons.arc.rangePerLevel * lv,
      chains:
        GAME_CONFIG.weaponProgression.weapons.arc.baseChains +
        Math.floor(lv / GAME_CONFIG.weaponProgression.weapons.arc.chainsEveryLevels),
      dmg:
        GAME_CONFIG.weaponProgression.weapons.arc.baseDamage *
        (1 + GAME_CONFIG.weaponProgression.weapons.arc.damagePerLevel * lv) *
        this.p.damageMul,
      tick: GAME_CONFIG.simulation.arcTick / this.p.fireRateMul,
    };
  }

  laserStats(L: number) {
    const lv = Math.max(0, L - 1);
    return {
      dps:
        GAME_CONFIG.weaponProgression.weapons.laser.baseDps *
        (1 + GAME_CONFIG.weaponProgression.weapons.laser.dpsPerLevel * lv) *
        this.p.damageMul,
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
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > GAME_CONFIG.simulation.frameDeltaCap) dt = GAME_CONFIG.simulation.frameDeltaCap;
    this.frame++;

    if (
      this.mode === "playing" ||
      this.mode === "levelup" ||
      this.mode === "gameover" ||
      this.mode === "victory"
    ) {
      const target =
        this.mode === "levelup"
          ? 0.16
          : this.mode === "gameover" || this.mode === "victory"
            ? 0.3
            : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, dt * 7);
      this.update(dt * this.timeScale);
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
    const p = this.p;
    const base = freshPlayer();
    const taken = STAT_UPGRADES.filter((u) => (this.stacks[u.id] ?? 0) > 0).map((u) => ({
      id: u.id,
      name: u.name,
      tag: u.tag,
      level: this.stacks[u.id] ?? 0,
      max: u.max,
    }));
    const pct = (mul: number) => `${mul >= 1 ? "+" : ""}${Math.round((mul - 1) * 100)}%`;
    const totals: { label: string; value: string }[] = [];
    if (p.fireRateMul !== 1) totals.push({ label: "Fire rate", value: pct(p.fireRateMul) });
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
        label: "Max hull",
        value: `${Math.round(p.maxHull)} (+${Math.round(p.maxHull - base.maxHull)})`,
      });
    if (p.armor > 0)
      totals.push({ label: "Damage taken", value: `−${Math.round(p.armor * 100)}%` });
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

  /* ------------------------------------------------------------ update */

  update(dt: number) {
    const p = this.p;
    const k = this.keys;

    // ---- flight ----
    p.thrusting = false;
    if (this.stick.on) {
      const dx = this.stick.x - this.stick.ox,
        dy = this.stick.y - this.stick.oy;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        const desired = Math.atan2(dy, dx);
        p.angle += clamp(wrapAngle(desired - p.angle), -p.turn * 1.9 * dt, p.turn * 1.9 * dt);
        const mag = clamp(dist / 90, 0, 1);
        p.vx += Math.cos(p.angle) * p.thrust * mag * dt * 1.15;
        p.vy += Math.sin(p.angle) * p.thrust * mag * dt * 1.15;
        p.thrusting = true;
      }
    } else if (
      this.settings.legacyMovement ||
      (!this.settings.hybridAim && !this.settings.mouseControl)
    ) {
      // Legacy Movement: the classic cabinet scheme. Rotate with A/D or the
      // arrows, thrust with W. No mouse aiming whatsoever.
      const turn = (k["arrowleft"] || k["a"] ? -1 : 0) + (k["arrowright"] || k["d"] ? 1 : 0);
      p.angle += turn * p.turn * dt;
      if (k["arrowup"] || k["w"]) {
        p.vx += Math.cos(p.angle) * p.thrust * dt;
        p.vy += Math.sin(p.angle) * p.thrust * dt;
        p.thrusting = true;
      }
    } else if (this.settings.hybridAim) {
      // twin-stick hybrid: the hull always tracks the cursor while WASD /
      // arrows push the ship in world space, decoupling aim from movement
      const desired = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      p.angle += clamp(wrapAngle(desired - p.angle), -p.turn * 3.2 * dt, p.turn * 3.2 * dt);
      const mx = (k["arrowleft"] || k["a"] ? -1 : 0) + (k["arrowright"] || k["d"] ? 1 : 0);
      const my = (k["arrowup"] || k["w"] ? -1 : 0) + (k["arrowdown"] || k["s"] ? 1 : 0);
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my) || 1;
        p.vx += (mx / len) * p.thrust * dt;
        p.vy += (my / len) * p.thrust * dt;
        p.thrusting = true;
      }
    } else {
      // Mouse Control: the veteran scheme. The ship faces the cursor and holds
      // the left button to thrust.
      const desired = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      p.angle += clamp(wrapAngle(desired - p.angle), -p.turn * 1.9 * dt, p.turn * 1.9 * dt);
      if (this.mouseDown) {
        p.vx += Math.cos(p.angle) * p.thrust * dt;
        p.vy += Math.sin(p.angle) * p.thrust * dt;
        p.thrusting = true;
      }
    }
    if (p.thrusting && this.frame % 3 === 0) this.thrustParticle();

    const drag = Math.pow(GAME_CONFIG.player.movementDragPerFrame, dt * 60);
    p.vx *= drag;
    p.vy *= drag;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > p.maxSpeed) {
      p.vx = (p.vx / sp) * p.maxSpeed;
      p.vy = (p.vy / sp) * p.maxSpeed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.wrap(p);

    // ---- firing ----
    p.fireTimer -= dt;
    p.missileTimer -= dt;
    const firing = this.settings.autoFire || !!k[" "] || this.touchFire || !!k["control"];
    const L = p.weapons[p.primary] || 1;

    if (p.primary === "laser") {
      const ls = this.laserStats(L);
      const unlimited = L >= MAX_WEAPON_LEVEL;
      if (firing && (unlimited || !p.overheated) && this.mode === "playing") {
        if (!p.beamOn) {
          audio.play("beamStart");
          p.beamOn = true;
        }
        p.heat = unlimited ? 0 : Math.min(1, p.heat + dt * ls.heatRate);
        audio.beamHeat(p.heat);
        if (!unlimited && p.heat >= 1) {
          p.overheated = true;
          audio.play("beamStop");
          p.beamOn = false;
          audio.play("overheat");
        }
        this.beamDamage(dt, ls.dps);
      } else {
        if (p.beamOn) {
          audio.play("beamStop");
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

    // missiles: edge-triggered, regenerating
    const missileKey = !!k["e"];
    if (
      missileKey &&
      !p.missileHeld &&
      p.missiles > 0 &&
      p.missileTimer <= 0 &&
      this.mode === "playing"
    )
      this.fireMissile();
    p.missileHeld = missileKey;
    if (p.missiles < p.maxMissiles) {
      p.missileCharge += dt;
      if (p.missileCharge >= p.missileRegen) {
        p.missileCharge = 0;
        p.missiles++;
        audio.play("pickup");
        this.floatText(p.x, p.y - 34, "MISSILE READY", MAGENTA, 12);
      }
    } else p.missileCharge = 0;

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    if (this.bannerT > 0) this.bannerT -= dt;

    // ---- meteor shower event ----
    this.updateShower(dt);

    // ---- rocks ----
    for (let ri = this.rocks.length - 1; ri >= 0; ri--) {
      const r = this.rocks[ri];
      // a boom chain-reaction can remove several rocks mid-pass, so the slot may already be gone
      if (!r) continue;
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
            vx: -r.vx * 0.12 + rnd(-15, 15),
            vy: -r.vy * 0.12 + rnd(-15, 15),
            life: 0.42,
            max: 0.42,
            size: rnd(1.6, 3),
            color: Math.random() < 0.5 ? AMBER_HOT : "#ffd27a",
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
        const spd = r.size === 3 ? 95 : r.size === 2 ? 88 : 78;
        const turn = r.size === 3 ? 2.4 : r.size === 2 ? 1.8 : 1.3;
        const desired = Math.atan2(p.y - r.y, p.x - r.x);
        const cur = Math.atan2(r.vy, r.vx);
        const a = cur + clamp(wrapAngle(desired - cur), -turn * dt, turn * dt);
        r.vx = Math.cos(a) * spd;
        r.vy = Math.sin(a) * spd;
      }
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
              x: r.x + rnd(-8, 8),
              y: r.y + rnd(-8, 8),
              vx: rnd(-30, 30),
              vy: rnd(-30, 30),
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
    for (const d of this.drones) this.updateDrone(d, dt);

    // ---- salvage drone ----
    this.updateSalvageDrone(dt);

    // ---- boss ----
    if (this.boss) this.updateBoss(this.boss, dt);

    // ---- ship collisions ----
    this.shipCollisions(dt);

    // ---- bullets ----
    this.updateBullets(dt);

    // ---- pickups ----
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const u = this.pickups[i];
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
          audio.play("pickup");
        } else {
          p.hull = Math.min(p.maxHull, p.hull + u.value);
          this.floatText(u.x, u.y, `+${Math.round(u.value)} HULL`, ICE, 13);
        }
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

    this.shake *= Math.pow(0.88, dt * 60);
    if (this.shake < 0.1) this.shake = 0;
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
        if (Math.random() < dt * 0.09) this.startShower();
      }
      return;
    }
    s.t -= dt;
    s.spawnT -= dt;
    if (s.spawnT <= 0) {
      s.spawnT = rnd(0.28, 0.5);
      this.spawnMeteor(s.side);
      if (Math.random() < 0.55) this.spawnMeteorite();
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
    s.side = Math.random() < 0.5 ? -1 : 1;
    s.occurredThisWave = true;
    this.banner = "METEOR SHOWER";
    this.bannerSub = "STREAKS CROSS THE SECTOR · METEORITES PAY 10–20 CR";
    this.bannerT = 2.6;
    this.flashAlpha = 0.35;
    this.shake += 5;
    audio.play("bossCharge");
  }

  /** a fast streak that enters one side and leaves the other */
  spawnMeteor(side: number) {
    const fromLeft = side < 0;
    const y = rnd(40, this.h - 40);
    const x = fromLeft ? -50 : this.w + 50;
    const speed = rnd(520, 700);
    const drift = rnd(-0.32, 0.32);
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
    rock.rotSpeed = rnd(4, 8) * (fromLeft ? 1 : -1);
    this.rocks.push(rock);
  }

  /** a meteor breaking apart showers the impact point with salvageable debris */
  shatterMeteor(x: number, y: number, vx: number, vy: number) {
    const meteor = GAME_CONFIG.asteroids.traits.meteor;
    const shards = Math.floor(rnd(meteor.shardCountMin, meteor.shardCountMax));
    for (let i = 0; i < shards; i++) {
      const a = Math.random() * TAU;
      const sp = rnd(60, 150);
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
      this.rocks.push(rock);
    }
    this.rings.push({ x, y, r: 8, max: 110, life: 0.5, color: AMBER_HOT, w: 3 });
    this.burst(x, y, 34, AMBER_HOT);
    this.burst(x, y, 18, "#ffd27a");
    this.shake += 7;
    audio.play("explodeBig");
  }

  /** a small slow meteorite that falls in from the top and disperses */
  spawnMeteorite() {
    const x = rnd(40, this.w - 40);
    const rock = this.makeRock(x, -30, 1, rnd(-70, 70), rnd(45, 90), "meteorite");
    rock.r *= 0.8;
    rock.hp = rock.maxHp =
      GAME_CONFIG.asteroids.traits.meteorite.hpBase +
      scaledWave(this.wave) * GAME_CONFIG.asteroids.traits.meteorite.hpPerScaledWave; // pops in one or two shots
    this.rocks.push(rock);
  }

  /** dev helper: drop a handful of meteorites right now */
  devSpawnMeteorites(n = 6) {
    for (let i = 0; i < n; i++) {
      const x = rnd(40, this.w - 40);
      const rock = this.makeRock(x, rnd(-60, -20), 1, rnd(-70, 70), rnd(45, 90), "meteorite");
      rock.r *= 0.8;
      rock.hp = rock.maxHp =
        GAME_CONFIG.asteroids.traits.meteorite.hpBase +
        scaledWave(this.wave) * GAME_CONFIG.asteroids.traits.meteorite.hpPerScaledWave;
      this.rocks.push(rock);
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
            x: d.x + rnd(-10, 10),
            y: d.y + rnd(-10, 10),
            vx: rnd(-20, 20),
            vy: rnd(-20, 20),
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
          audio.play("droneRebuild");
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
        audio.play("droneDestroyed");
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

    if (!isPrimary) {
      this.salvageMagnet(u);
      this.salvageFire(u, dt);
      return;
    }

    this.salvageMagnet(u);

    d.pulseTimer -= dt;
    if (d.upgrades.repairPulse > 0 && d.pulseTimer <= 0) {
      const range = 150 + d.upgrades.scan * 35 + (d.upgrades.scan >= 3 ? 80 : 0);
      if (Math.hypot(d.x - this.p.x, d.y - this.p.y) < range) {
        const amount = d.upgrades.repairPulse === 3 ? 4.2 : 0.9 * d.upgrades.repairPulse;
        this.p.hull = Math.min(this.p.maxHull, this.p.hull + amount);
        this.rings.push({
          x: this.p.x,
          y: this.p.y,
          r: 8,
          max: 28,
          life: 0.28,
          color: ICE,
          w: 1.5,
        });
      }
      d.pulseTimer = Math.max(3.4, 7.5 - d.upgrades.repairPulse * 0.9);
    }
    this.salvageFire(u, dt);
  }

  /** credit magnet + collection for any squad unit */
  salvageMagnet(u: SalvageDrone | SalvageClone) {
    const d = this.salvageDrone;
    const magnet =
      76 + d.upgrades.magnet * 48 + d.upgrades.scan * 42 + (d.upgrades.magnet >= 3 ? 90 : 0);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (pk.kind !== "credit") continue;
      const distance = Math.hypot(u.x - pk.x, u.y - pk.y);
      if (distance < magnet) {
        const a = Math.atan2(u.y - pk.y, u.x - pk.x);
        const pull = clamp((1 - distance / magnet) * 920 + 160, 160, 920);
        pk.vx += Math.cos(a) * pull * 0.025;
        pk.vy += Math.sin(a) * pull * 0.025;
      }
      if (distance < 22) {
        this.credits += pk.value;
        this.score += pk.value * 4;
        this.floatText(pk.x, pk.y, `DRONE +${Math.round(pk.value)} CR`, ICE, 11);
        this.burst(pk.x, pk.y, 5, ICE);
        audio.play("pickup");
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
   * Volume rule: only pulse / ricochet / scatter may fire more than one
   * projectile per volley. Everything else is capped to a single shot no
   * matter how many Twin Cannons are installed — twin levels instead speed
   * the cadence for those weapons so the upgrade still means something.
   */
  salvageFire(u: SalvageDrone | SalvageClone, dt: number) {
    const d = this.salvageDrone;
    const twin = d.upgrades.twinCannons;
    const over = d.upgrades.overcharge;
    const attached = d.weapon;
    const attachedLevel = attached ? this.p.weapons[attached] : 0;
    const range =
      310 + d.upgrades.scan * 90 + (d.upgrades.scan >= 3 ? 150 : 0) + (attached ? 120 : 0);
    const finalSurge = over === 3 ? 1.65 : 1;
    const overMul = (1 + over * 0.28) * (1 - Math.max(0, over - 1) * 0.08) * finalSurge;

    // ---- continuous beam mount ----
    if (attached === "laser") {
      u.fireTimer = 0;
      const target = this.nearestTarget(u.x, u.y, range + 200, (r) => r.trait !== "meteor");
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
      const dps = this.laserStats(attachedLevel).dps * 0.18 * overMul;
      u.beamLen = this.droneBeamDamage(u.x, u.y, u.beamAngle, range + 200, dps * dt);
      if (this.frame % 6 === 0) audio.play("arc");
      return;
    }
    u.beamOn = false;

    u.fireTimer -= dt;
    if (u.fireTimer > 0) return;

    // ---- chain lightning mount ----
    if (attached === "arc") {
      const as = this.arcStats(attachedLevel);
      const fired = this.arcFrom(
        u.x,
        u.y,
        { range: Math.min(as.range, range), chains: Math.max(1, as.chains - 1), dmg: as.dmg },
        { scale: 0.45 * overMul },
      );
      u.fireTimer = fired ? Math.max(0.28, as.tick * 2.4 - twin * 0.06) : 0.1;
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
    const shots = multiShotAllowed
      ? attached
        ? Math.min(4, Math.max(1, weaponStats?.shots ?? 1)) + Math.max(0, twin - 1)
        : 1 + twin
      : 1;
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
      this.bullets.push({
        x: u.x + Math.cos(a) * 13,
        y: u.y + Math.sin(a) * 13,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: weaponStats ? weaponStats.r : 3,
        life: weaponStats ? weaponStats.life : 1.4,
        dmg: damage,
        kind: shotKind,
        pierce: (weaponStats ? weaponStats.pierce : 0) + d.upgrades.piercing,
        color: shotColor,
        hitIds: new Set(),
        turn: weaponStats?.turn ?? 0,
        bounces: weaponStats?.bounces ?? 0,
        fuse: weaponStats?.fuse ?? 0,
        extra: weaponStats?.extra ?? 0,
        extraDmg: (weaponStats?.extraDmg ?? 0) * 0.5,
      });
    }
    // single-shot weapons convert twin levels into cadence instead of volume
    const twinCadence = multiShotAllowed ? 0 : twin * 0.14;
    u.fireTimer = Math.max(0.4, (attached ? 1.45 : 1.65) - over * 0.18 - twinCadence);
    audio.play(weaponStats ? weaponStats.sfx : "seeker");
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
            r.hp -= dmg;
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

  damageSalvageDrone(amount: number) {
    const d = this.salvageDrone;
    if (!d.purchased || !d.active || d.hitTimer > 0) return;
    const armor = d.upgrades.armor >= 3 ? 0.6 : d.upgrades.armor * 0.15;
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
      audio.play("droneDestroyed");
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
    audio.play("droneRebuild");
  }

  updateDrone(d: Drone, dt: number) {
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
      if (Math.random() < 0.65) d.orbitDir *= -1;
      d.orbitTimer = rnd(2.2, 4.5);
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
      if (d.volleyCd === undefined) d.volleyCd = rnd(3, 6);
      d.volleyCd -= dt;
      if (d.volleyCd <= 0) {
        d.volleyCd = rnd(6, 11);
        // Limit to 3 concurrent turret nests at once
        const nestCount = this.bullets.filter((b) => b.kind === "wardenOrb").length;
        if (nestCount < 3) {
          const midX = (d.x + p.x) / 2;
          const midY = (d.y + p.y) / 2;
          this.bullets.push({
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
          audio.play("bossCharge");
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
          this.bullets.push({
            x: d.x + Math.cos(la) * 32,
            y: d.y + Math.sin(la) * 32,
            vx: Math.cos(la) * bs,
            vy: Math.sin(la) * bs,
            r: 13,
            life: 2.2,
            dmg: WARDEN_BOLT_DMG,
            kind: "enemy",
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
          audio.play("rail");
          d.pulseCharge = undefined;
          d.fire = rnd(2.4, 3.6);
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
          if (Math.random() < fireChance) {
            d.pulseCharge = 0.6;
            // Lock a SNAPSHOT aim point near the player with a deliberate
            // offset — the round fires at this fixed point and never tracks
            // the player afterwards, so strafing it off the point dodges the
            // shot (it is a telegraphed sniper shot, not a homing missile).
            d.sniperAimX = p.x + rnd(-24, 24);
            d.sniperAimY = p.y + rnd(-24, 24);
          } else {
            d.fire = 0.4; // hold fire, re-evaluate soon
          }
        }
      }
    }
    // ---- Sentinel fire (quick bolts with lead) -----------------------------
    if (!warden) {
      d.fire -= dt;
      if (d.fire <= 0 && this.mode === "playing" && dist < 720) {
        const bs = 250;
        const tt = dist / bs;
        const lx = p.x + p.vx * tt * 0.8,
          ly = p.y + p.vy * tt * 0.8;
        const la = Math.atan2(ly - d.y, lx - d.x);
        this.bullets.push({
          x: d.x + Math.cos(la) * 18,
          y: d.y + Math.sin(la) * 18,
          vx: Math.cos(la) * bs,
          vy: Math.sin(la) * bs,
          r: 5,
          life: 4.2,
          dmg: SENTINEL_BOLT_DMG,
          kind: "enemy",
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
        audio.play("ui");
        d.burst--;
        if (d.burst > 0) d.fire = 0.22;
        else {
          d.fire = rnd(3.0, 4.4) - Math.min(1.1, scaledWave(this.wave) * 0.03);
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
      if (!hit) continue;

      const d = Math.hypot(p.x - r.x, p.y - r.y) || 1;
      const nx = (p.x - r.x) / d,
        ny = (p.y - r.y) / d;
      p.x = r.x + nx * (hitR + 1);
      p.y = r.y + ny * (hitR + 1);

      const rel = Math.hypot(p.vx - r.vx, p.vy - r.vy);
      // small rocks shove less and hurt less than large ones —
      // except meteors, which hit like the freight trains they are
      const meteor = r.trait === "meteor";
      const kick = meteor ? 220 : r.size === 3 ? 130 : r.size === 2 ? 75 : 35;
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
      this.damagePlayer(dmg);
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
        this.damagePlayer(GAME_CONFIG.bosses.contactDamage);
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
        this.damagePlayer(GAME_CONFIG.enemies.sentinels.playerContactDamage);
        p.invuln = collision.invulnerability;
        this.damageDrone(
          this.drones.indexOf(d),
          GAME_CONFIG.enemies.sentinels.contactDamageToEnemy,
          false,
        );
        break;
      }
    }
  }

  /* ------------------------------------------------------------ bullets */

  guide(b: Bullet, dt: number) {
    const range = b.kind === "missile" ? 900 : b.kind === "rail" ? 1500 : 520;
    let target: Hostile | undefined;
    if (b.kind === "seeker") target = this.nearestTarget(b.x, b.y, range);
    else {
      target = b.target != null ? this.findTarget(b.target) : undefined;
      if (!target) target = this.nearestTarget(b.x, b.y, range);
    }
    if (!target) return;
    b.target = target.id;
    const spd = Math.hypot(b.vx, b.vy) || 1;
    const dist = Math.hypot(target.x - b.x, target.y - b.y);
    // Rail guidance only engages at long distance; close shots stay skillful.
    if (b.kind === "rail" && dist < 600) return;
    // pure-pursuit with a lead on the target's own drift: direct, not faster
    const tt = clamp(dist / spd, 0, 1.2);
    const lx = target.x + target.vx * tt,
      ly = target.y + target.vy * tt;
    const desired = Math.atan2(ly - b.y, lx - b.x);
    const cur = Math.atan2(b.vy, b.vx);
    const na = cur + clamp(wrapAngle(desired - cur), -b.turn * dt, b.turn * dt);
    b.vx = Math.cos(na) * spd;
    b.vy = Math.sin(na) * spd;
  }

  /** returns true if the projectile is consumed by this impact */
  impact(b: Bullet, kind: "rock" | "drone" | "boss", idx: number, id: number): boolean {
    const p = this.p;
    if (b.kind === "missile") {
      this.explode(b.x, b.y, p.blastR, p.blastDmg);
      return true;
    }
    const crit = Math.random() < p.crit;
    const dmg = b.dmg * (crit ? p.critMult : 1);
    if (kind === "rock") this.hitRock(idx, dmg, b.vx, b.vy, crit);
    else if (kind === "drone") this.damageDrone(idx, dmg, crit);
    else this.damageBoss(dmg, crit);
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
    const p = this.p;
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
          audio.play("hit");
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
            audio.play("explodeSmall");
            const oj = j > i ? j - 1 : j; // index shifted after removing pb
            this.bullets.splice(oj, 1);
          }
          break; // this player bullet is spent
        }
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.kind === "missile" || b.kind === "seeker" || b.kind === "rail") this.guide(b, dt);
      if (b.kind === "missile" && this.frame % 2 === 0) {
        this.particles.push({
          x: b.x,
          y: b.y,
          vx: rnd(-20, 20),
          vy: rnd(-20, 20),
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
          b.spawnT = rnd(1.2, 2.2);
          b.nested = (b.nested ?? 0) + 1;
          // spawn seeking homing orb
          const a = Math.atan2(p.y - b.y, p.x - b.x) + rnd(-0.25, 0.25);
          this.bullets.push({
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
          audio.play("explodeSmall");
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
          b.hitIds.clear();
          this.burst(b.x, b.y, 5, ICE);
          audio.play("ricochet");
        }
      } else {
        const m = 60;
        if (b.x < -m || b.x > w + m || b.y < -m || b.y > h + m) {
          if (b.kind === "missile") this.explode(b.x, b.y, p.blastR, p.blastDmg);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      if (b.life <= 0) {
        if (b.kind === "missile") this.explode(b.x, b.y, p.blastR, p.blastDmg);
        if (b.kind === "flak") this.detonateFlak(b);
        // a warden shell that found nothing still goes off where it died
        if (b.blast) this.enemyBlast(b.x, b.y, b.blast, b.dmg * 0.6);
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
        if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + 15) {
          this.damagePlayer(b.dmg);
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
            const crit = Math.random() < p.crit;
            const dmg = b.dmg * (crit ? p.critMult : 1);
            this.damageHole(dmg, crit);
            if (b.kind === "missile") {
              this.explode(b.x, b.y, p.blastR, p.blastDmg);
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
    audio.play("explodeSmall");
    const n = Math.max(4, Math.round(b.extra));
    const base = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU;
      this.bullets.push({
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

  assistAngle(base: number): number {
    const CONE = 0.2,
      MAX_NUDGE = 0.085,
      RANGE = 920;
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
    const aim = this.assistAngle(p.angle);
    audio.play(s.sfx);
    const mx = p.x + Math.cos(p.angle) * 22,
      my = p.y + Math.sin(p.angle) * 22;
    for (let i = 0; i < s.shots; i++) {
      const off = (i - (s.shots - 1) / 2) * s.arc + (Math.random() - 0.5) * p.inaccuracy;
      const a = aim + off;
      this.bullets.push({
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
      const a = p.angle + rnd(-0.35, 0.35),
        sp = rnd(60, 220);
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
    const a = this.assistAngle(p.angle);
    this.beamAngle = a;
    const dx = Math.cos(a),
      dy = Math.sin(a);
    const range = 1100,
      TOL = 7;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      const rx = r.x - p.x,
        ry = r.y - p.y;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(rx * dy - ry * dx) < r.r + TOL) {
        r.hp -= dps * dt;
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
    audio.play("arc");
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
    const crit = Math.random() < this.p.crit;
    const real = dmg * (crit ? this.p.critMult : 1);
    if (this.boss) {
      if (this.boss.id === id) {
        this.damageBoss(real, crit);
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

  fireMissile() {
    const p = this.p;
    p.missiles--;
    p.missileTimer = 0.35;
    const lock = this.nearestTarget(p.x, p.y, 900);
    const a = lock ? Math.atan2(lock.y - p.y, lock.x - p.x) : this.assistAngle(p.angle);
    // launch along the ship's nose but bend hard toward the lock straight away
    const la = p.angle + clamp(wrapAngle(a - p.angle), -0.6, 0.6);
    this.bullets.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(la) * 380,
      vy: Math.sin(la) * 380,
      r: 7,
      life: 4.5,
      dmg: 0,
      kind: "missile",
      pierce: 0,
      color: MAGENTA,
      hitIds: new Set(),
      target: lock?.id,
      turn: 6.5,
      bounces: 0,
      fuse: 0,
      extra: 0,
      extraDmg: 0,
    });
    this.shake += 4;
    audio.play("missile");
  }

  hitRock(index: number, dmg: number, vx: number, vy: number, crit: boolean) {
    const r = this.rocks[index];
    if (!r) return;
    r.hp -= dmg;
    r.flash = 1;
    r.vx += vx * 0.012;
    r.vy += vy * 0.012;
    this.burst(r.x, r.y, crit ? 9 : 5, crit ? AMBER_HOT : AMBER);
    audio.play(crit ? "crit" : "hit");
    if (crit) this.floatText(r.x, r.y - r.r, "CRIT", AMBER_HOT, 12);
    if (r.hp <= 0) this.breakRock(index, vx, vy);
    else this.score += 4;
  }

  damageDrone(index: number, dmg: number, crit: boolean, quiet = false) {
    const d = this.drones[index];
    if (!d) return;
    d.hp -= dmg;
    d.flash = 1;
    if (!quiet) {
      this.burst(d.x, d.y, crit ? 10 : 6, crit ? AMBER_HOT : ICE);
      audio.play(crit ? "crit" : "hit");
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
    bo.hp -= amount;
    if (!bo.mk6 || bo.movement.mk6RaidDone) return;
    const floor = bo.maxHp * 0.5;
    if (bo.hp >= floor) return;
    bo.hp = floor;
    const m = bo.movement;
    if (this.frame - (m.mk6LockFrame ?? -999) > 50 && bo.x > 0 && bo.x < this.w) {
      m.mk6LockFrame = this.frame;
      this.floatText(bo.x, bo.y - bo.r - 16, "HULL LOCKED", ICE, 14);
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
      this.burst(bo.x + rnd(-bo.r, bo.r) * 0.5, bo.y + rnd(-bo.r, bo.r) * 0.5, 6, ICE);
      if (dmg <= 0) {
        audio.play("hit");
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
      bo.x + rnd(-bo.r, bo.r) * 0.6,
      bo.y + rnd(-bo.r, bo.r) * 0.6,
      crit ? 8 : 4,
      crit ? AMBER_HOT : MAGENTA,
    );
    audio.play(crit ? "crit" : "hit");
    if (bo.hp <= 0) this.killBoss();
  }

  breakRock(index: number, vx: number, vy: number) {
    const r = this.rocks[index];
    if (!r) return;
    this.rocks.splice(index, 1);
    this.combo++;
    this.comboTimer = 4;

    // meteorites: cheap to kill, rich to salvage, never split
    if (r.trait === "meteorite") {
      const payout = Math.round(rnd(10, 20));
      this.credits += payout;
      this.score += 60 * (1 + Math.floor(this.combo / 4) * 0.5);
      this.floatText(r.x, r.y, `+${payout} CR`, AMBER_HOT, 15);
      this.burst(r.x, r.y, 18, AMBER_HOT);
      this.burst(r.x, r.y, 8, "#ffd27a");
      this.rings.push({ x: r.x, y: r.y, r: 4, max: 44, life: 0.36, color: AMBER, w: 2 });
      audio.play("creditDrop");
      audio.play("explodeSmall");
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
        audio.play("explodeBig");
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
    audio.play(r.size === 3 ? "explodeBig" : "explodeSmall");
    this.shake += r.size * 3.2;
    if (r.size === 3) this.timeScale = 0.72;

    if (Math.random() < this.p.creditChance + r.size * 0.07) {
      const n = r.size === 3 ? 3 : r.size === 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        this.pickups.push({
          x: r.x,
          y: r.y,
          vx: rnd(-60, 60),
          vy: rnd(-60, 60),
          kind: Math.random() < 0.12 ? "repair" : "credit",
          value: Math.round((r.size === 3 ? 12 : r.size === 2 ? 7 : 4) * this.p.creditValue),
          life: 20,
          pulse: Math.random() * TAU,
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
      audio.play("creditDrop");
    }

    // boom detonates before the children exist so it can't kill its own shards
    if (r.trait === "boom") this.rockBoom(r);

    if (r.size > 1) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * TAU;
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
        this.rocks.push(child);
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
    const radius = this.boomRadius(r.size);
    const pdmg = r.size === 3 ? 32 : r.size === 2 ? 16 : 8;
    const rdmg = r.size === 3 ? 42 : r.size === 2 ? 22 : 11;
    this.rings.push({ x: r.x, y: r.y, r: 6, max: radius * 1.5, life: 0.5, color: ORANGE, w: 3 });
    this.burst(r.x, r.y, 12 + r.size * 8, ORANGE);
    this.shake += 5 + r.size * 3;
    audio.play(r.size === 3 ? "explodeBig" : "flak");
    const p = this.p;
    if (Math.hypot(p.x - r.x, p.y - r.y) < radius + 14) this.damagePlayer(pdmg);
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
    if (
      this.salvageDrone.active &&
      Math.hypot(this.salvageDrone.x - r.x, this.salvageDrone.y - r.y) < radius + 14
    ) {
      this.damageSalvageDrone(pdmg);
    }
  }

  killDrone(index: number) {
    const d = this.drones[index];
    if (!d) return;
    this.drones.splice(index, 1);
    const warden = d.kind === "warden";
    if (warden) {
      // Despawn every splitter nest + seeking orbs owned by this warden
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const bb = this.bullets[i];
        if (bb.kind === "wardenOrb" || bb.kind === "wardenShard") this.bullets.splice(i, 1);
      }
    }
    this.burst(d.x, d.y, warden ? 40 : 26, MAGENTA);
    this.rings.push({
      x: d.x,
      y: d.y,
      r: 8,
      max: warden ? 130 : 90,
      life: 0.5,
      color: MAGENTA,
      w: warden ? 4 : 3,
    });
    audio.play(warden ? "bossDeath" : "explodeBig");
    this.shake += warden ? 13 : 9;
    this.flashAlpha = warden ? 0.45 : 0.35;
    const base = warden ? 700 : 360;
    this.score += base * (1 + Math.floor(this.combo / 4) * 0.5);
    this.floatText(d.x, d.y, `+${base}`, MAGENTA, warden ? 18 : 16);
    const shards = warden ? 4 : 3;
    for (let i = 0; i < shards; i++) {
      this.pickups.push({
        x: d.x,
        y: d.y,
        vx: rnd(-70, 70),
        vy: rnd(-70, 70),
        kind: "credit",
        value: Math.round((warden ? 20 : 14) * this.p.creditValue),
        life: GAME_CONFIG.pickups.lifetime,
        pulse: Math.random() * TAU,
      });
    }
    this.gainXp((warden ? 120 : 60) * this.xpScale());
    this.combo++;
    this.comboTimer = 4;
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
        this.floatText(this.p.x, this.p.y - 52, `+${Math.round(healed)} HULL`, ICE, 14);
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
      this.floatText(this.p.x, this.p.y - 52, `+${Math.round(healed)} HULL`, ICE, 14);
      this.rings.push({ x: this.p.x, y: this.p.y, r: 12, max: 74, life: 0.5, color: ICE, w: 2 });
    }
    audio.silence();
    audio.play("levelup");
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
      let roll = Math.random() * total;
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
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    return picked;
  }

  /** spend credits to reroll the rack — the price doubles every time */
  rerollChoices(): number | null {
    if (this.credits < this.rerollCost) return null;
    const paid = this.rerollCost;
    this.credits -= this.rerollCost;
    this.rerollCost = Math.round(this.rerollCost * 1.8);
    this.choices = this.rollChoices();
    audio.play("buy");
    return paid;
  }

  chooseUpgrade(id: string) {
    const def = STAT_UPGRADES.find((u) => u.id === id);
    if (def) {
      def.apply(this);
      this.stacks[id] = (this.stacks[id] ?? 0) + 1;
      this.floatText(this.p.x, this.p.y - 30, def.name.toUpperCase(), AMBER_HOT, 16);
    }
    audio.play("buy");
    this.flashAlpha = 0.4;
    this.setMode("playing");
  }

  damagePlayer(dmg: number) {
    const p = this.p;
    if (this.god || p.invuln > 0) return;
    p.hull -= dmg * (1 - p.armor);
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
    audio.play("hurt");
    this.shake += 11;
    this.flashAlpha = 0.55;
    this.combo = 0;
    this.comboTimer = 0;
    if (p.hull <= 0 && this.mode === "playing") this.gameOver();
  }

  gameOver() {
    this.p.hull = 0;
    audio.silence();
    audio.play("death");
    this.burst(this.p.x, this.p.y, 90, AMBER);
    this.rings.push({ x: this.p.x, y: this.p.y, r: 10, max: 300, life: 1, color: AMBER_HOT, w: 4 });
    this.shake = 32;
    this.flashAlpha = 1;
    this.timeScale = 0.35;
    this.setMode("gameover");
  }

  explode(x: number, y: number, radius: number, dmg: number) {
    this.rings.push({ x, y, r: 8, max: radius * 1.6, life: 0.55, color: MAGENTA, w: 3 });
    this.burst(x, y, 26, MAGENTA);
    audio.play("explodeBig");
    this.shake += 10;
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
        this.loseBossHp(bo, dmg * (1 - clamp((bd - bo.r) / radius, 0, 1) * 0.6));
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
    if (Math.hypot(this.p.x - x, this.p.y - y) < radius * 0.6)
      this.damagePlayer(GAME_CONFIG.asteroids.genericExplosionPlayerDamage);
    this.timeScale = GAME_CONFIG.simulation.explosionTimeScale;
  }

  /* ------------------------------------------------------------ waves */

  rollTrait(): RockTrait {
    const w = this.wave;
    const roll = Math.random();
    const gates = RUN_PACING.traitWaves;
    // Nothing homing until the MK1 boss fight is behind the player.
    if (w < gates.homing) return "none";
    const pool: RockTrait[] = ["homing"];
    if (w >= gates.bounce) pool.push("bounce");
    if (w >= gates.boom) pool.push("boom");
    if (w >= gates.fast) pool.push("fast");
    // Same chance curve as the old run, compressed onto half as many waves.
    const chance = 0.12 + (scaledWave(w) - 11) * 0.008;
    if (roll > chance) return "none";
    // the newest trait for this band shows up a little more often
    if (Math.random() < 0.4) return pool[pool.length - 1];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  makeCracks(r: number, count: number, inner = 0.55): Crack[] {
    const cracks: Crack[] = [];
    for (let c = 0; c < count; c++) {
      const a0 = Math.random() * TAU;
      const startR = r * rnd(inner, 0.95);
      let px = Math.cos(a0) * startR,
        py = Math.sin(a0) * startR;
      let dir = a0 + Math.PI + rnd(-0.7, 0.7);
      const segs = Math.floor(rnd(3, 6));
      const step = (startR * rnd(0.9, 1.6)) / segs;
      const line = [{ x: px, y: py }];
      for (let s = 0; s < segs; s++) {
        dir += rnd(-0.75, 0.75);
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
      rnd(GAME_CONFIG.asteroids.radiusRandomMin, GAME_CONFIG.asteroids.radiusRandomMax);
    const n = Math.floor(rnd(8, 12));
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(rnd(0.72, 1.18));
    let vX = vx ?? rnd(-70, 70),
      vY = vy ?? rnd(-70, 70);
    if (trait === "fast") {
      // fixed pace per size so speed never compounds through generations
      const target = size === 3 ? 290 : size === 2 ? 265 : 235;
      const a = Math.atan2(vY, vX) + rnd(-0.2, 0.2);
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
      (trait === "none" || isEventRock(trait) ? 1 : GAME_CONFIG.asteroids.specialHpMultiplier);
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
      rot: Math.random() * TAU,
      rotSpeed: rnd(-1.1, 1.1),
      pts,
      flash: 0,
      cracks: this.makeCracks(r, size === 3 ? 4 : size === 2 ? 3 : 2),
      trait,
    };
  }

  spawnDrone(x: number, y: number, hp: number, kind: "sentinel" | "warden" = "sentinel"): Drone {
    return {
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
      fire: kind === "warden" ? rnd(4.5, 6.5) : rnd(2, 3.5),
      flash: 0,
      orbitDir: Math.random() < 0.5 ? 1 : -1,
      orbitTimer: rnd(1, 3),
      evadeCd: 0,
      burst: 1,
      sniperAimX: x,
      sniperAimY: y,
    };
  }

  nextWave() {
    // a shower during the previous wave pays a completion bonus
    if (this.shower.occurredThisWave && this.wave > 0) {
      this.credits += GAME_CONFIG.waves.showerCompletionBonus;
      this.floatText(this.p.x, this.p.y - 44, "SHOWER SALVAGE +100 CR", AMBER_HOT, 15);
      this.rings.push({ x: this.p.x, y: this.p.y, r: 10, max: 90, life: 0.5, color: AMBER, w: 2 });
      audio.play("buy");
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
      audio.play("levelup");
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
      this.rocks.push(
        this.makeRock(
          this.w * 0.6 + Math.random() * this.w * 0.4,
          Math.random() * this.h,
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
      audio.play("bossCharge");
    } else {
      // Sector 5 combat waves (21-24): occasional warden spawns.
      const isLateWave =
        this.wave >= RUN_PACING.lateWardenFromWave && this.wave <= RUN_PACING.lateWardenToWave;
      const spawnWardenInLate = isLateWave && Math.random() < (this.wave % 2 === 0 ? 0.5 : 0.3);

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

      for (let i = 0; i < count; i++) {
        let x = 0,
          y = 0,
          tries = 0;
        do {
          x = Math.random() * this.w;
          y = Math.random() * this.h;
          tries++;
        } while (
          Math.hypot(x - this.p.x, y - this.p.y) < GAME_CONFIG.waves.shipSpawnRockClearance &&
          tries < 20
        );
        this.rocks.push(
          this.makeRock(x, y, Math.random() < 0.45 ? 3 : 2, undefined, undefined, this.rollTrait()),
        );
      }
      // Sentinels are capped concurrently and trickle in: the opening sector
      // sees 1–2 at most, later sectors ramp up to the sector cap.
      const sentinelRoom =
        maxSentinels(this.wave) - this.drones.filter((dd) => dd.kind === "sentinel").length;
      const dn = Math.max(0, Math.min(sentinelWaveCount(this.wave), sentinelRoom));
      for (let i = 0; i < dn; i++) {
        const edge = Math.random() * 4;
        const x = edge < 2 ? (edge < 1 ? 40 : this.w - 40) : Math.random() * this.w;
        const y = edge >= 2 ? (edge < 3 ? 40 : this.h - 40) : Math.random() * this.h;
        this.drones.push(this.spawnDrone(x, y, droneHp));
      }
      if (spawnWardenInLate) {
        // Spawn 1 warden in the late wave
        const wardenEdge = Math.random() * 4;
        const wx = wardenEdge < 2 ? (wardenEdge < 1 ? 50 : this.w - 50) : Math.random() * this.w;
        const wy = wardenEdge >= 2 ? (wardenEdge < 3 ? 50 : this.h - 50) : Math.random() * this.h;
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

    this.p.missiles = Math.min(this.p.maxMissiles, this.p.missiles + 1);
    audio.play("wave");
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
    for (let i = 0; i < 16; i++) pts.push(rnd(0.88, 1.06));
    let hp = bonus
      ? GAME_CONFIG.bosses.bonusHp
      : (final
          ? GAME_CONFIG.bosses.finalHp
          : GAME_CONFIG.bosses.waveBaseHp +
            scaledWave(this.wave) * GAME_CONFIG.bosses.hpPerScaledWave) * spec.hpMul;
    if (mk <= 3) hp = Math.min(hp, EARLY_BOSS_HP_CEILING);

    // MK3 starts with a brisk, non-zero diagonal velocity so it immediately glides and bounces
    const baseSpeed = isMk3
      ? GAME_CONFIG.waves.bossMk3Speed
      : bonus
        ? GAME_CONFIG.waves.bossMk6Speed
        : GAME_CONFIG.waves.bossBaseSpeed;
    let initVx = rnd(-28, 28) + spec.driftX;
    let initVy = rnd(-14, 14);
    if (isMk3) {
      const dirX = Math.random() < 0.5 ? 1 : -1;
      const dirY = Math.random() < 0.5 ? 1 : -1;
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
      rotSpeed: rnd(0.25, 0.4) * (Math.random() < 0.5 ? -1 : 1),
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
        timer: rnd(3.2, 5.6),
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
  enemyBlast(x: number, y: number, radius: number, dmg: number) {
    this.rings.push({ x, y, r: 6, max: radius * 1.4, life: 0.34, color: "#ff7aa0", w: 2 });
    this.burst(x, y, 14, "#ff7aa0");
    audio.play("explodeSmall");
    this.shake += 2.5;
    if (Math.hypot(this.p.x - x, this.p.y - y) < radius) this.damagePlayer(dmg);
    if (
      this.salvageDrone.active &&
      Math.hypot(this.salvageDrone.x - x, this.salvageDrone.y - y) < radius
    ) {
      this.damageSalvageDrone(dmg);
    }
  }

  enemyBullet(x: number, y: number, a: number, sp: number, dmg: number, r = 5) {
    this.bullets.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r,
      life: 5,
      dmg,
      kind: "enemy",
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

    const x = rnd(0.25, 0.75) * this.w;
    const y = rnd(0.25, 0.75) * this.h;
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
    audio.play("bossCharge");
  }

  damageHole(dmg: number, crit: boolean) {
    const b = this.boss;
    if (!b || !b.hole) return;
    const h = b.hole;
    h.hp -= dmg;
    h.flash = 1;
    this.burst(
      h.x + rnd(-h.r, h.r) * 0.4,
      h.y + rnd(-h.r, h.r) * 0.4,
      crit ? 8 : 4,
      crit ? AMBER_HOT : h.color,
    );
    audio.play(crit ? "crit" : "hit");
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
    audio.play("explodeBig");
    this.score += (200 + h.mk * 100) * (1 + Math.floor(this.combo / 4) * 0.5);
    this.gainXp(30 * this.xpScale());
    b.hole = null;
  }

  updateHole(b: Boss, dt: number) {
    const h = b.hole;
    if (!h) return;
    h.t -= dt;
    h.flash = Math.max(0, h.flash - dt * 4);
    const hx = h.x - this.p.x,
      hy = h.y - this.p.y;
    const hd = Math.hypot(hx, hy) || 1;
    // Pulls from anywhere across the sector, accelerating as you get sucked closer
    const pullFalloff = clamp(1 - hd / (Math.max(this.w, this.h) * 1.5), 0.5, 1);
    const strength = h.pull * 1.6 * pullFalloff;
    this.p.vx += (hx / hd) * strength * dt;
    this.p.vy += (hy / hd) * strength * dt;

    // Singularities at higher strengths look cooler: e.g. at MK6 dense golden particles fly rapidly into it
    const pFreq = h.mk === 6 ? 1 : h.mk === 5 ? 1 : 2;
    if (this.frame % pFreq === 0 && this.particles.length < 650) {
      const pCount = h.mk === 6 ? 3 : h.mk === 5 ? 2 : 1;
      for (let i = 0; i < pCount; i++) {
        const a = Math.random() * TAU;
        const rr = (h.mk === 6 ? 120 : 70) + rnd(20, 120 + h.mk * 25);
        const px = h.x + Math.cos(a) * rr,
          py = h.y + Math.sin(a) * rr;
        const inward = Math.atan2(h.y - py, h.x - px);
        const inSpeed = (h.mk === 6 ? 340 : 180 + h.mk * 30) + rnd(-30, 30);
        const pColor =
          h.mk === 6
            ? Math.random() < 0.6
              ? "#ffd27a"
              : Math.random() < 0.5
                ? "#ffaa33"
                : "#ffe0a3"
            : Math.random() < 0.5
              ? h.color
              : h.coreColor;
        this.particles.push({
          x: px,
          y: py,
          vx: Math.cos(inward) * inSpeed,
          vy: Math.sin(inward) * inSpeed,
          life: 0.38,
          max: 0.38,
          size: rnd(1.8, 3.2),
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
      const a = (i / Math.max(1, wardens)) * TAU + rnd(-0.3, 0.3);
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
      const a = (i / Math.max(1, sentinels)) * TAU + rnd(-0.4, 0.4);
      this.drones.push(
        this.spawnDrone(
          clamp(b.x + Math.cos(a) * 320, 40, this.w - 40),
          clamp(b.y + Math.sin(a) * 270, 40, this.h - 40),
          70 + scaledWave(this.wave) * 11,
        ),
      );
    }
    this.banner = label;
    this.bannerSub = "THE METEOR CALLS ITS ESCORT";
    this.bannerT = 2.2;
    this.flashAlpha = 0.45;
    this.shake += 10;
    audio.play("bossCharge");
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
    audio.play("bossCharge");
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
          this.rocks.push(
            this.makeRock(
              clamp(b.x + Math.cos(a) * 250, 40, this.w - 40),
              clamp(b.y + Math.sin(a) * 250, 40, this.h - 40),
              2,
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
        const n = phase >= 2 ? 6 : 5;
        b.strikes = [];
        // MK4: sudden ignition strikes — first hits in under a second, leaving very little time to react
        for (let i = 0; i < n; i++) {
          const near = i === 0;
          const countdown = 0.95 + i * 0.22;
          b.strikes.push({
            x: clamp(near ? this.p.x + rnd(-1, 1) * 140 : rnd(80, this.w - 80), 60, this.w - 60),
            y: clamp(near ? this.p.y + rnd(-1, 1) * 140 : rnd(80, this.h - 80), 60, this.h - 60),
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

    switch (attack) {
      case "shower":
        slot.t = 6.2;
        break;
      case "barrage":
        slot.t = 6.2;
        break;
      case "beam":
        slot.t = 8.5;
        slot.beamA = Math.random() * TAU;
        audio.play("bossCharge");
        break;
      case "strikes": {
        slot.t = 5.4;
        const n = 5;
        for (let i = 0; i < n; i++) {
          const near = i % 2 === 0;
          const countdown = 2.4 + i * 0.5;
          slot.strikes.push({
            x: clamp(near ? this.p.x + rnd(-1, 1) * 190 : rnd(90, this.w - 90), 70, this.w - 70),
            y: clamp(near ? this.p.y + rnd(-1, 1) * 190 : rnd(90, this.h - 90), 70, this.h - 70),
            t: countdown,
            t0: countdown,
            r: rnd(150, 215),
          });
        }
        audio.play("bossCharge");
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
            x = rnd(50, this.w - 50);
            y = rnd(50, this.h - 50);
            tries++;
          } while (Math.hypot(x - this.p.x, y - this.p.y) < 220 && tries < 12);
          const size = (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3;
          const rock = this.makeRock(
            x,
            y,
            size,
            rnd(-120, 120),
            rnd(-120, 120),
            traits[Math.floor(Math.random() * traits.length)],
          );
          rock.hp = rock.maxHp = rock.maxHp * 0.6; // transient, meant to be cleared
          m.fieldIds.push(rock.id);
          this.rocks.push(rock);
        }
        audio.play("explodeSmall");
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
        audio.play("bossCharge");
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
          const x = rnd(50, this.w - 50);
          const rock = this.makeRock(x, -50, 1, rnd(-40, 40), rnd(520, 660), "meteor");
          rock.r *= 1.35;
          rock.hp = rock.maxHp = 120 + scaledWave(this.wave) * 4;
          rock.rotSpeed = rnd(4, 8);
          this.rocks.push(rock);
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
          const rx = this.p.x - b.x,
            ry = this.p.y - b.y;
          const t = rx * dx + ry * dy;
          if (t > 0 && t < len && Math.abs(rx * dy - ry * dx) < 16 && m.beamCd <= 0) {
            this.damagePlayer(9);
            m.beamCd = 0.6;
          }
          if (this.frame % 3 === 0) {
            const d = rnd(b.r, len * 0.5);
            this.particles.push({
              x: b.x + dx * d,
              y: b.y + dy * d,
              vx: rnd(-20, 20),
              vy: rnd(-20, 20),
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
            this.explode(s.x, s.y, s.r, 74);
            this.shatterMeteor(s.x, s.y, 0, 0);
            if (Math.hypot(this.p.x - s.x, this.p.y - s.y) < s.r) this.damagePlayer(30);
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
            audio.play("explodeBig");
            if (Math.hypot(this.p.x - b.x, this.p.y - b.y) < radius) this.damagePlayer(28);
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
      audio.play("bossCharge");
    }

    // the singularity and the beam immunity window advance with the boss
    if (b.hole) this.updateHole(b, dt);
    if (b.shieldT > 0) {
      b.shieldT -= dt;
      if (b.shieldT <= 0) b.shieldHp = 0;
    }
    m.beamCd -= dt;

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
      const next = source[Math.floor(Math.random() * source.length)];
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
    // Launch a dense fan salvo of 3 meteors across the arena
    const count = 3;
    const baseSpread = 0.26;
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * baseSpread + rnd(-0.06, 0.06);
      const speed = rnd(640, 840);
      const startX = b.x + inward * b.r * 0.6;
      const startY = b.y + (i - 1) * 28 + rnd(-10, 10);
      const vx = Math.cos(spread) * speed * inward;
      const vy = Math.sin(spread) * speed;
      const rock = this.makeRock(startX, startY, 1, vx, vy, "meteor");
      rock.r *= 1.25;
      rock.hp = rock.maxHp = 120 + scaledWave(this.wave) * 4;
      rock.rotSpeed = rnd(5, 9) * inward;
      this.rocks.push(rock);
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
    audio.play("bossCharge");
  }

  triggerMk4ProximityStrikes(b: Boss) {
    const n = b.hp / b.maxHp < 0.5 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const radius = rnd(b.r * 1.5, b.r * 2.7);
      const countdown = 1.0 + i * 0.22;
      b.strikes.push({
        x: clamp(b.x + Math.cos(a) * radius, 60, this.w - 60),
        y: clamp(b.y + Math.sin(a) * radius, 60, this.h - 60),
        t: countdown,
        t0: countdown,
      });
    }
    this.rings.push({ x: b.x, y: b.y, r: 8, max: b.r * 2.9, life: 0.42, color: ORANGE, w: 2 });
    audio.play("bossCharge");
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
        audio.play("bossCharge");
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
          b.y = clamp(this.h * rnd(0.35, 0.65), bounds.minY, bounds.maxY);
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
            b.y = clamp(this.h * rnd(0.35, 0.65), bounds.minY, bounds.maxY);
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
          b.rotSpeed = rnd(0.25, 0.4) * (Math.random() < 0.5 ? -1 : 1);
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
        audio.play("ricochet");
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
            m.targetX = rnd(bounds.minX, bounds.maxX);
            m.targetY = rnd(bounds.minY, bounds.maxY);
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
          audio.play("bossCharge");
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
          m.timer = rnd(2.6, 4.6);
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
        audio.play("explodeBig");
        if (Math.hypot(this.p.x - b.x, this.p.y - b.y) < radius + 18) this.damagePlayer(22);
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
          const x = rnd(50, this.w - 50);
          this.rocks.push(
            this.makeRock(
              x,
              -30,
              2,
              rnd(-30, 30),
              rnd(130, 200),
              Math.random() < 0.5 && b.spawnTrait !== "none" ? b.spawnTrait : "none",
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
          x: b.x + rnd(-b.r, b.r) * 1.4,
          y: b.y + rnd(-b.r, b.r) * 1.4,
          vx: rnd(-40, 40),
          vy: rnd(-40, 40),
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
          const edge = Math.floor(Math.random() * 4);
          let x = 0,
            y = 0,
            baseA = 0;
          if (edge === 0) {
            x = rnd(60, this.w - 60);
            y = -24;
            baseA = Math.PI / 2;
          } else if (edge === 1) {
            x = this.w + 24;
            y = rnd(60, this.h - 60);
            baseA = Math.PI;
          } else if (edge === 2) {
            x = rnd(60, this.w - 60);
            y = this.h + 24;
            baseA = -Math.PI / 2;
          } else {
            x = -24;
            y = rnd(60, this.h - 60);
            baseA = 0;
          }
          const a = baseA + rnd(-0.55, 0.55);
          const speed = rnd(215, 275);
          const cascadeRock = this.makeRock(
            x,
            y,
            2,
            Math.cos(a) * speed,
            Math.sin(a) * speed,
            "bounce",
          );
          cascadeRock.life = BOSS_ROCK_LIFESPAN;
          cascadeRock.keep = true;
          this.rocks.push(cascadeRock);
          this.rings.push({ x, y, r: 6, max: 40, life: 0.28, color: ICE, w: 2 });
          audio.play("ricochet");
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
        const aimA = Math.atan2(this.p.y - oy, this.p.x - ox) + rnd(-0.12, 0.12);
        const speed = rnd(235, 285);
        const ringRock = this.makeRock(
          clamp(ox, 24, this.w - 24),
          clamp(oy, 24, this.h - 24),
          2,
          Math.cos(aimA) * speed,
          Math.sin(aimA) * speed,
          "bounce",
        );
        ringRock.life = BOSS_ROCK_LIFESPAN;
        ringRock.keep = true;
        this.rocks.push(ringRock);
        this.rings.push({ x: ox, y: oy, r: 5, max: 36, life: 0.26, color: ICE, w: 2 });
        audio.play("ricochet");
        b.ricochetRing--;
      }
    }
    // MK5 · Meteor Wall — a fast-rock wall sweeps across from one edge.
    // Wall rocks carry a ~20s lifetime so a big wall can never clog the arena.
    if (b.wallT > 0 && b.wallN > 0) {
      b.wallT -= dt;
      if (this.frame % 9 === 0) {
        const fromLeft = b.wallSide === -1;
        const y = Math.random() * this.h;
        const rock = this.makeRock(
          fromLeft ? -30 : this.w + 30,
          y,
          2,
          (fromLeft ? 1 : -1) * rnd(240, 320),
          rnd(-40, 40),
          "fast",
        );
        rock.life = 20;
        this.rocks.push(rock);
        b.wallN--;
      }
    }
    // MK4 · Boom Launch — each marked point turns into a boom rock when its warning ends
    for (let i = b.boomDrops.length - 1; i >= 0; i--) {
      const d = b.boomDrops[i];
      d.t -= dt;
      if (d.t > 0) continue;
      b.boomDrops.splice(i, 1);
      // never materialise on top of the ship
      let x = d.x,
        y = d.y;
      const dist = Math.hypot(x - this.p.x, y - this.p.y) || 1;
      if (dist < 170) {
        x = clamp(this.p.x + ((x - this.p.x) / dist) * 170, 40, this.w - 40);
        y = clamp(this.p.y + ((y - this.p.y) / dist) * 170, 40, this.h - 40);
      }
      const a = Math.random() * TAU;
      const size = (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3;
      const rock = this.makeRock(x, y, size, Math.cos(a) * 60, Math.sin(a) * 60, "boom");
      rock.life = BOSS_ROCK_LIFESPAN;
      rock.keep = true;
      this.rocks.push(rock);
      this.rings.push({ x, y, r: 6, max: 70, life: 0.35, color: ORANGE, w: 2.5 });
      this.burst(x, y, 10, ORANGE);
    }
    // MK4 · Ignition Strikes — telegraphed impact points detonate in sequence
    for (let i = b.strikes.length - 1; i >= 0; i--) {
      const s = b.strikes[i];
      s.t -= dt;
      if (s.t <= 0) {
        b.strikes.splice(i, 1);
        this.explode(s.x, s.y, 175, 62);
        if (Math.hypot(this.p.x - s.x, this.p.y - s.y) < 150) this.damagePlayer(24);
      }
    }

    b.attackTimer -= dt;
    if (b.attackTimer > 0 || this.mode !== "playing") return;
    // each MK keeps its own tempo
    b.attackTimer = ((b.final ? 1.9 : 2.6) - phase * 0.55) * b.timerMul;

    const pool: ("ring" | "fan" | "shock" | "hole" | "spawn" | "ricochet" | "boom")[] = [
      "ring",
      "fan",
      "shock",
    ];
    if (b.mk >= 3) pool.push("hole");
    // MK4's new signature: it sheds slow boom asteroids toward the player
    if (b.mk === 4) {
      pool.push("boom");
      pool.push("boom");
    }
    // MK3's second signature: the ricochet ring. Weighted so it shows up often
    // but never dominates the rotation.
    if (b.mk === 3) {
      pool.push("ricochet");
      pool.push("ricochet");
    }
    if (phase >= 2) for (let i = 0; i < b.spawnWeight * 2; i++) pool.push("spawn");
    if (b.final) pool.push("spawn");
    const pick = pool[Math.floor(Math.random() * pool.length)];

    if (pick === "ring") {
      // MK4/MK5 pack every pattern with extra projectiles
      const n = Math.max(10, Math.round((14 + phase * 4 + (b.final ? 4 : 0)) * b.bulletMul));
      const base = Math.random() * TAU;
      const sp = (b.final ? 190 : 165) + phase * 15;
      for (let i = 0; i < n; i++) {
        const a = base + (i / n) * TAU;
        this.enemyBullet(b.x + Math.cos(a) * b.r * 0.92, b.y + Math.sin(a) * b.r * 0.92, a, sp, 8);
      }
      this.shake += 4;
      audio.play("rail");
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
      audio.play("ui");
    } else if (pick === "shock") {
      // MK1 gets a long warning; MK5 barely any time at all
      b.shockDur = Math.max(0.5, 2.6 - (b.mk - 1) * 0.5);
      b.shockT = b.shockDur;
      // Radius scales with boss strength and missing HP (e.g. MK5 with low HP = massive circle)
      const baseR = 190 + b.mk * 35;
      const missingHpFactor = 1 + (1 - clamp(b.hp / b.maxHp, 0, 1)) * 0.75;
      b.shockRadius = baseR * missingHpFactor;
      audio.play("bossCharge");
    } else if (pick === "hole") {
      // easy to outrun on MK3, pulls harder and lasts longer at MK4 and MK5
      const pull = b.mk === 3 ? 160 : b.mk === 4 ? 260 : 370;
      const dur = b.mk === 3 ? 3.8 : b.mk === 4 ? 5.2 : 6.8;
      const radius = Math.max(this.w, this.h) * 1.5;
      this.mkHole(b, pull, dur, radius);
    } else if (pick === "boom") {
      // MK4 · BOOM LAUNCH: marked drop points are scattered across the whole map.
      // After a short warning each one becomes a slow boom rock with a 30 s lifespan.
      // Launch 3 boom asteroids normally. Once the map already has 15+
      // asteroids, only add 1 so the arena does not become overwhelmed.
      const live = this.rocks.length;
      const n = live >= 15 ? 1 : 3;
      const chosen: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        // best-of-N sampling keeps the drops spread out instead of clumped
        let best = { x: this.w / 2, y: this.h / 2 },
          bestScore = -1;
        for (let tries = 0; tries < 14; tries++) {
          const x = rnd(70, this.w - 70),
            y = rnd(90, this.h - 70);
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
      audio.play("bossCharge");
    } else if (pick === "ricochet") {
      // MK3 · RICOCHET RING — form a ring of bounce rocks around the boss, then
      // fire them outward one by one, each mirror-aimed at the player.
      const live = this.rocks.filter((r) => !isEventRock(r.trait)).length;
      const room = Math.max(0, BOSS_ROCK_CAP - live);
      b.ricochetRing = Math.min(4 + phase, room);
      b.ricochetFired = 0;
      b.ricochetT = 0.3;
      b.ricochetPhase = Math.random() * TAU;
      this.banner = "RICOCHET RING";
      this.bannerSub = "MIRROR-AIMED · WATCH THE BOUNCE";
      this.bannerT = 1.5;
      audio.play("bossCharge");
    } else {
      // Offspring are capped by how cluttered the field already is, so a
      // dreadnought can never bury the player under its own spawn loop.
      const live = this.rocks.filter((r) => !isEventRock(r.trait)).length;
      const room = Math.max(0, BOSS_ROCK_CAP - live);
      const n = Math.min(b.rocksPer, room);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        this.rocks.push(
          this.makeRock(
            b.x + Math.cos(a) * b.r,
            b.y + Math.sin(a) * b.r,
            2,
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
      if (sentinels < 3 && Math.random() < 0.45) {
        this.drones.push(
          this.spawnDrone(b.x + rnd(-80, 80), b.y - b.r - 30, 55 + scaledWave(this.wave) * 11),
        );
      }
      if (b.mk >= 4 && wardens < 1 && Math.random() < (b.mk === 5 ? 0.12 : 0.5)) {
        this.drones.push(
          this.spawnDrone(
            b.x + rnd(-80, 80),
            b.y + b.r + 40,
            210 + scaledWave(this.wave) * 28,
            "warden",
          ),
        );
      }
      this.burst(b.x, b.y, 16, b.spawnTrait === "none" ? MAGENTA : b.edgeColor);
      audio.play("explodeSmall");
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
    audio.play("explodeBig");
  }

  /** dev console: spawn a rock of a given trait near the player */
  devSpawnRock(size: 1 | 2 | 3, trait: RockTrait) {
    let x = 0,
      y = 0,
      tries = 0;
    do {
      x = Math.random() * this.w;
      y = Math.random() * this.h;
      tries++;
    } while (Math.hypot(x - this.p.x, y - this.p.y) < 240 && tries < 15);
    this.rocks.push(this.makeRock(x, y, size, undefined, undefined, trait));
  }

  /** dev console: spawn a sentinel or warden close to the player's slice of space */
  devSpawnMob(kind: "sentinel" | "warden") {
    const a = Math.random() * TAU;
    const x = this.p.x + Math.cos(a) * 520;
    const y = this.p.y + Math.sin(a) * 520;
    const tuningWave = scaledWave(this.wave);
    this.drones.push(
      this.spawnDrone(x, y, kind === "warden" ? 210 + tuningWave * 28 : 55 + tuningWave * 11, kind),
    );
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
    p.fireRateMul = base.fireRateMul;
    p.damageMul = base.damageMul;
    p.thrust = base.thrust;
    p.maxSpeed = base.maxSpeed;
    p.turn = base.turn;
    p.maxHull = base.maxHull;
    p.armor = base.armor;
    p.extraShots = base.extraShots;
    p.pierce = base.pierce;
    p.crit = base.crit;
    p.maxMissiles = base.maxMissiles;
    p.missiles = base.missiles;
    p.blastDmg = base.blastDmg;
    p.blastR = base.blastR;
    p.missileRegen = base.missileRegen;
    for (const u of STAT_UPGRADES) {
      const n = this.stacks[u.id] ?? 0;
      for (let i = 0; i < n; i++) u.apply(this);
    }
    // restore the hull we came in with — the upgrades' one-shot heals are part
    // of the rebuild, so don't let them stack on the player for free
    p.hull = clamp(keepHull, 1, p.maxHull);
    p.missiles = Math.min(p.missiles, p.maxMissiles);
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
        fireTimer: rnd(0, 0.6),
        hitTimer: 0,
        beamOn: false,
        beamAngle: 0,
        beamLen: 0,
      });
    }
    this.floatText(this.p.x, this.p.y - 30, `SALVAGE SQUAD ×${n}`, ICE, 13);
    this.burst(this.p.x, this.p.y, 12 + n * 5, ICE);
    audio.play("droneAssemble");
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
    for (let i = 0; i < 5; i++) {
      this.rings.push({
        x: b.x + rnd(-b.r * 0.4, b.r * 0.4),
        y: b.y + rnd(-b.r * 0.4, b.r * 0.4),
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
    audio.play("bossDeath");
    const n = b.final ? 12 : 8;
    for (let i = 0; i < n; i++) {
      this.pickups.push({
        x: b.x,
        y: b.y,
        vx: rnd(-140, 140),
        vy: rnd(-140, 140),
        kind: Math.random() < 0.2 ? "repair" : "credit",
        value: b.final ? 60 : 36,
        life: 22,
        pulse: Math.random() * TAU,
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
    audio.play("bossCharge");
    this.setMode("playing");
  }

  /* ------------------------------------------------------------ fx helpers */

  burst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 700) break;
      const a = Math.random() * TAU,
        s = rnd(40, 320),
        life = rnd(0.3, 0.9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: rnd(1.6, 3.6),
        color,
        drag: 0.93,
      });
    }
  }

  thrustParticle() {
    const p = this.p;
    const a = p.angle + Math.PI + rnd(-0.3, 0.3),
      s = rnd(120, 260);
    this.particles.push({
      x: p.x + Math.cos(p.angle + Math.PI) * 16,
      y: p.y + Math.sin(p.angle + Math.PI) * 16,
      vx: Math.cos(a) * s + p.vx * 0.3,
      vy: Math.sin(a) * s + p.vy * 0.3,
      life: 0.3,
      max: 0.3,
      size: rnd(2, 3.5),
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
    ctx.fillStyle = "rgba(20,35,48,0.92)";
    ctx.fill();
    ctx.strokeStyle = ICE;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 14;
    ctx.shadowColor = ICE;
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
      ctx.fillStyle = ICE;
      ctx.fill();
    }
    if (d.assembly > 0) {
      const build = clamp(d.assembly / 1.8, 0, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(this.frame * 0.18) * 3, -Math.PI * build, Math.PI * build);
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + (1 - build) * 0.6;
      ctx.shadowBlur = 16;
      ctx.shadowColor = ICE;
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
      ctx.lineWidth = 2.6 + (Math.random() - 0.5) * 1.6;
      ctx.shadowBlur = 18;
      ctx.shadowColor = ICE;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      // hot spot where it lands
      ctx.beginPath();
      ctx.arc(ex, ey, 3 + Math.random() * 2, 0, TAU);
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

  render() {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shakeAmt = this.shake * (this.reduced ? 0.15 : this.settings.shake ? 1 : 0.05);
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shakeAmt * 2, (Math.random() - 0.5) * shakeAmt * 2);

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

    // rocks
    for (const r of this.rocks) {
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

    // sentinels and wardens
    for (const d of this.drones) {
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
        const rr = 20 + (1 - prog) * 150;
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
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.invuln > 0 && Math.floor(this.frame / 3) % 2 === 0) ctx.globalAlpha = 0.55;
      if (p.thrusting) {
        const flick = 1 + Math.random() * 0.5;
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
      ctx.fillStyle = "rgba(12,14,22,0.85)";
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = this.god ? MAGENTA : AMBER_HOT;
      ctx.shadowBlur = 16;
      ctx.shadowColor = AMBER;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // bullets
    for (const b of this.bullets) {
      const a = Math.atan2(b.vy, b.vx);
      if (b.kind === "missile") {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-8, -5);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 5);
        ctx.closePath();
        ctx.fillStyle = MAGENTA;
        ctx.shadowBlur = 14;
        ctx.shadowColor = MAGENTA;
        ctx.fill();
        ctx.restore();
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
        ctx.arc(b.x, b.y, 4.5 + (0.45 - b.fuse) * 30, 0, TAU);
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

    // beam
    if (this.p.primary === "laser" && this.p.beamOn && this.mode === "playing") {
      const p = this.p,
        ba = this.beamAngle;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(ba) * 22, p.y + Math.sin(ba) * 22);
      ctx.lineTo(p.x + Math.cos(ba) * 1100, p.y + Math.sin(ba) * 1100);
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 4 + (Math.random() - 0.5) * 3;
      ctx.shadowBlur = 26;
      ctx.shadowColor = ICE;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

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
          off = (Math.random() - 0.5) * 18;
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
      ctx.arc(r.x, r.y, r.r, 0, TAU);
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

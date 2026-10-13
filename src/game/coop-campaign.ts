import { Game, SILENT_GAME_SOUND } from "./engine";
import { COOP_CONFIG } from "./simulation/coop-config";
import { RUN_PACING } from "./simulation/campaign";
import { GAME_CONFIG } from "./game-config";
import type { CoopEvent, CoopMatchState, CoopPlayerId } from "./simulation/coop-types";
import type { Boss, Bullet, Mode, WeaponId, Drone, Rock, Pickup } from "./types";

export const PILOTS = ["p1", "p2"] as const;
export const isHostileShot = (b: Bullet) => ["enemy", "wardenOrb", "wardenShard"].includes(b.kind);
export const freshPilotCampaign = () => ({
  choices: [] as Game["choices"],
  queuedChoices: [] as Game["choices"][],
  rerollCost: 0,
  combo: 0,
  comboTimer: 0,
  quietTime: 0,
  beamAngle: 0,
  anomalyTimer: 0,
  beamCooldown: 0,
});

/** Only multiplayer context, ownership and team rules live here. Combat stays in Game. */
export class CoopCampaign extends Game {
  activeId: CoopPlayerId = "p1";
  private bound = false;
  constructor(
    readonly match: CoopMatchState,
    random: () => number,
    readonly emit: (event: CoopEvent) => void,
    width: number,
    height: number,
  ) {
    super(
      null,
      { onHud() {}, onMode() {} },
      {
        headless: true,
        width,
        height,
        random,
        sound: {
          ...SILENT_GAME_SOUND,
          play: (name) => emit({ type: "sound", tick: match.tick, name }),
        },
      },
    );
    this.bindPilot("p1");
    this.mode = "playing";
  }

  flushPilot() {
    if (!this.bound) return;
    const pilot = this.match.players[this.activeId];
    pilot.ship = this.p;
    pilot.drone = this.salvageDrone;
    pilot.credits = this.credits;
    pilot.level = this.level;
    pilot.xp = this.xp;
    pilot.xpNext = this.xpNext;
    pilot.upgrades = this.stacks;
    const own = pilot.campaign!;
    Object.assign(own, {
      choices: this.choices,
      rerollCost: this.rerollCost,
      combo: this.combo,
      comboTimer: this.comboTimer,
      quietTime: this.quietTime,
      beamAngle: this.beamAngle,
      anomalyTimer: this.boss?.hole?.damageTimer ?? 0,
      beamCooldown: this.boss?.mk6?.beamCd ?? 0,
    });
    pilot.upgradePoints = (own.choices.length ? 1 : 0) + own.queuedChoices.length;
  }

  override addBullet(...bullets: Bullet[]) {
    for (const b of bullets) {
      b.id ??= this.nextId++;
      if (!isHostileShot(b)) {
        b.ownerId ??= this.activeId;
        b.weapon ??= this.p.primary;
      }
    }
    super.addBullet(...bullets);
  }

  releasePilot() {
    this.flushPilot();
    this.bound = false;
  }
  restorePilotContext() {
    this.bound = false;
    this.bindPilot("p1");
  }

  bindPilot(id: CoopPlayerId) {
    if (this.bound && this.activeId === id) return;
    this.flushPilot();
    this.activeId = id;
    const pilot = this.match.players[id];
    pilot.campaign ??= freshPilotCampaign();
    this.p = pilot.ship;
    this.salvageDrone = pilot.drone;
    this.credits = pilot.credits;
    this.level = pilot.level;
    this.xp = pilot.xp;
    this.xpNext = pilot.xpNext;
    this.stacks = pilot.upgrades;
    const own = pilot.campaign;
    this.choices = own.choices;
    this.rerollCost = own.rerollCost;
    this.combo = own.combo;
    this.comboTimer = own.comboTimer;
    this.quietTime = own.quietTime;
    this.beamAngle = own.beamAngle;
    if (this.boss?.hole) this.boss.hole.damageTimer = own.anomalyTimer;
    if (this.boss?.mk6) this.boss.mk6.beamCd = own.beamCooldown;
    this.flightIntent = pilot.input;
    this.keys = { " ": pilot.input.fire, e: pilot.input.missile };
    this.bound = true;
  }

  override forEachPilot(action: () => void) {
    const previous = this.activeId;
    for (const id of PILOTS) {
      if (this.match.players[id].disabled) continue;
      this.bindPilot(id);
      action();
    }
    this.bindPilot(previous);
  }

  override selectTarget(x: number, y: number) {
    const nearest = PILOTS.filter((id) => !this.match.players[id].disabled).sort((a, b) => {
      const p = this.match.players[a].ship,
        q = this.match.players[b].ship;
      return Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y);
    })[0];
    if (nearest) this.bindPilot(nearest);
  }

  override spawnClearance(x: number, y: number) {
    return Math.min(
      ...PILOTS.map((id) => {
        const p = this.match.players[id].ship;
        return Math.hypot(x - p.x, y - p.y);
      }),
    );
  }

  override selectBulletPilot(b: Bullet) {
    this.flushPilot();
    if (!isHostileShot(b)) this.bindPilot(b.ownerId ?? "p1");
    else {
      // Collision candidate uses the upcoming position, including both companions.
      const x = b.x + b.vx / 60,
        y = b.y + b.vy / 60;
      const candidates = PILOTS.filter((id) => !this.match.players[id].disabled);
      const distance = (id: CoopPlayerId) => {
        const { ship, drone } = this.match.players[id];
        return Math.min(
          Math.hypot(x - ship.x, y - ship.y) - 15,
          drone.active ? Math.hypot(x - drone.x, y - drone.y) - 12 : Infinity,
        );
      };
      candidates.sort((a, c) => distance(a) - distance(c));
      if (candidates[0]) this.bindPilot(candidates[0]);
    }
  }

  override setMode(mode: Mode) {
    if (mode === "levelup") return; // One pilot's upgrade rack must not pause the room.
    this.mode = mode;
    if (mode === "playing") this.timeScale = 1;
  }

  override triggerLevelUp() {
    const previous = this.choices;
    super.triggerLevelUp();
    if (previous.length) {
      if (this.choices.length)
        this.match.players[this.activeId].campaign!.queuedChoices.push(this.choices);
      this.choices = previous;
    }
  }

  override gameOver() {
    const pilot = this.match.players[this.activeId];
    pilot.disabled = true;
    pilot.ship.hull = 0;
    pilot.ship.beamOn = false;
    pilot.reviveProgress = 0;
    this.burst(this.p.x, this.p.y, 40, "#ffb03a");
    this.emit({ type: "playerDisabled", tick: this.match.tick, playerId: pilot.id });
    if (PILOTS.every((id) => this.match.players[id].disabled)) {
      this.match.phase = "defeat";
      this.mode = "gameover";
      this.emit({ type: "matchEnded", tick: this.match.tick, outcome: "defeat" });
    }
  }

  override damagePlayer(amount: number, cause?: string, feedback = 1) {
    if (this.match.players[this.activeId].disabled) return;
    const before = this.p.hull;
    super.damagePlayer(amount, cause, feedback);
    if (this.p.hull < before) {
      const pilot = this.match.players[this.activeId];
      pilot.reviveLockout = COOP_CONFIG.revive.interruptionSeconds;
      pilot.reviveProgress = 0;
      this.emit({
        type: "playerDamaged",
        tick: this.match.tick,
        playerId: pilot.id,
        amount: before - this.p.hull,
      });
    }
  }

  override updateBossContactCooldown(boss: Boss, dt: number) {
    this.forEachPilot(() => super.updateBossContactCooldown(boss, dt));
  }

  recordDamage(amount: number, boss = false) {
    const pilot = this.match.players[this.activeId];
    pilot.stats.damage += amount;
    if (boss) pilot.stats.bossDamage += amount;
    if (this.match.team.overdriveRemaining <= 0)
      this.match.team.overdrive = Math.min(
        COOP_CONFIG.overdrive.maximum,
        this.match.team.overdrive + amount * COOP_CONFIG.overdrive.damageChargeScale,
      );
  }
  override loseRockHp(r: Rock, amount: number) {
    this.recordDamage(Math.max(0, Math.min(r.hp, amount)));
    super.loseRockHp(r, amount);
  }
  override pickupCollected(pickup: Pickup) {
    if (pickup.kind === "credit")
      this.match.players[this.activeId].stats.creditsCollected += pickup.value;
    this.emit({
      type: "pickupCollected",
      tick: this.match.tick,
      playerId: this.activeId,
      kind: pickup.kind,
    });
  }
  override damageDrone(...args: Parameters<Game["damageDrone"]>) {
    const d = this.drones[args[0]];
    if (d) this.recordDamage(Math.min(d.hp, args[1]));
    super.damageDrone(...args);
  }
  override loseBossHp(boss: Boss, amount: number) {
    const before = boss.hp;
    super.loseBossHp(boss, amount);
    this.recordDamage(Math.max(0, before - boss.hp), true);
  }
  override breakRock(...args: Parameters<Game["breakRock"]>) {
    const rock = this.rocks[args[0]];
    if (rock) {
      const stats = this.match.players[this.activeId].stats;
      stats.kills++;
      stats.asteroidKills++;
      this.emit({
        type: "asteroidDestroyed",
        tick: this.match.tick,
        playerId: this.activeId,
        entityId: rock.id,
      });
    }
    super.breakRock(...args);
  }
  override killDrone(index: number) {
    const d = this.drones[index];
    if (d) {
      this.match.players[this.activeId].stats.kills++;
      this.emit({
        type: "enemyDestroyed",
        tick: this.match.tick,
        playerId: this.activeId,
        entityId: d.id,
      });
    }
    super.killDrone(index);
  }
  override killBoss() {
    const b = this.boss;
    if (!b) return;
    super.killBoss();
    this.match.tethers = [];
    this.match.team.bossesDefeated++;
    this.match.players[this.activeId].stats.kills++;
    this.emit({ type: "bossDefeated", tick: this.match.tick, playerId: this.activeId, mk: b.mk });
    if (this.bonusAvailable) this.emit({ type: "bonusBossOffered", tick: this.match.tick });
    if (this.bonusDefeated)
      this.emit({ type: "matchEnded", tick: this.match.tick, outcome: "victory" });
  }

  override nextWave() {
    const recipient = this.activeId;
    const sector = Math.floor(this.wave / 5) + 1;
    if (this.wave % 5 === 0) {
      const choices = (["asteroidSurge", "elitePatrol", "volatileSpace"] as const).filter(
        (d) => d !== this.match.team.directive,
      );
      this.match.team.directive = choices[Math.floor(this.random() * choices.length)];
      this.emit({
        type: "directiveSelected",
        tick: this.match.tick,
        sector,
        directive: this.match.team.directive,
      });
    }
    const showerBonus =
      this.shower.occurredThisWave && this.wave > 0 ? GAME_CONFIG.waves.showerCompletionBonus : 0;
    super.nextWave();
    this.flushPilot();
    const award = RUN_PACING.creditsPerWaveBase + this.wave * RUN_PACING.creditsPerWaveStep;
    for (const id of PILOTS)
      if (id !== recipient) {
        this.bindPilot(id);
        this.credits += award + showerBonus;
        this.p.missiles = Math.min(this.p.maxMissiles, this.p.missiles + 1);
        this.startDroneRebuild();
      }
    this.bindPilot(recipient);
    if (!this.boss && this.match.team.directive === "asteroidSurge") {
      for (let i = 0; i < COOP_CONFIG.directives.asteroidSurgeExtraRocks; i++)
        this.addRocks(
          this.makeRock(this.rnd(0, this.w), 30, 2, undefined, undefined, this.rollTrait()),
        );
    }
    this.spawnCoopEscorts();
    this.emit({
      type: "waveStarted",
      tick: this.match.tick,
      wave: this.wave,
      sector: this.themeIdx + 1,
    });
  }

  override makeBoss(final: boolean, mkOverride?: number) {
    const b = super.makeBoss(final, mkOverride);
    b.hp = b.maxHp *= COOP_CONFIG.difficulty.bossHealth;
    return b;
  }

  override spawnDrone(...args: Parameters<Game["spawnDrone"]>) {
    const d = super.spawnDrone(...args);
    if (this.match?.team.directive === "elitePatrol")
      d.hp = d.maxHp *= COOP_CONFIG.directives.elitePatrolHealthMultiplier;
    return d;
  }

  override rollTrait(force = false) {
    return super.rollTrait(
      force ||
        (this.wave >= 6 &&
          this.match?.team.directive === "volatileSpace" &&
          this.random() < COOP_CONFIG.directives.volatileMutationBonus),
    );
  }

  override boomRoom() {
    // Mine Warden mines have their own cap; they must not suppress native boss boom attacks.
    return Math.max(
      0,
      GAME_CONFIG.asteroids.traits.boom.maxAlive -
        this.rocks.filter((r) => r.trait === "boom" && !r.coopMine).length,
    );
  }

  spawnCoopEscorts() {
    for (const kind of ["tetherSentinel", "mineWarden"] as const) {
      const config = COOP_CONFIG[kind];
      const unlock = this.boss ? config.bossEscortFromWave : config.unlockWave;
      if (this.wave < unlock) continue;
      if (this.drones.filter((d) => d.coop?.kind === kind).length >= config.cap) continue;
      const d = this.spawnDrone(
        this.w * 0.8,
        this.h * 0.2,
        config.baseHp + this.wave * config.hpPerWave,
        kind === "mineWarden" ? "warden" : "sentinel",
      );
      d.coop = {
        kind,
        timer:
          kind === "mineWarden"
            ? COOP_CONFIG.mineWarden.deploymentMin
            : COOP_CONFIG.tetherSentinel.cooldownSeconds,
        warning: 0,
        target: null,
      };
      this.drones.push(d);
      this.emit({ type: "enemySpawned", tick: this.match.tick, entityId: d.id, kind });
    }
  }

  override startBonusBoss() {
    super.startBonusBoss();
    this.spawnCoopEscorts();
  }

  override updateDrone(d: Drone, dt: number) {
    super.updateDrone(d, dt);
    const extra = d.coop;
    if (!extra) return;
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
        this.emit({ type: "mineDeployed", tick: this.match.tick, entityId: mine.id });
        extra.timer = this.rnd(c.deploymentMin, c.deploymentMax);
      }
      return;
    }
    const config = COOP_CONFIG.tetherSentinel;
    if (extra.warning > 0) {
      extra.warning -= dt;
      if (extra.warning <= 0 && extra.target && !this.match.players[extra.target].disabled) {
        this.match.tethers.push({
          id: this.nextId++,
          sourceId: d.id,
          targetPlayerId: extra.target,
          strength: config.strength,
          minimumDistance: config.minimumDistance,
          maximumDistance: config.maximumDistance,
        });
        this.emit({
          type: "tetherStarted",
          tick: this.match.tick,
          entityId: d.id,
          playerId: extra.target,
        });
        extra.timer = config.cooldownSeconds;
      }
    } else if (extra.timer <= 0 && !this.match.tethers.some((t) => t.sourceId === d.id)) {
      extra.target = this.activeId;
      extra.warning = config.telegraphSeconds;
      this.rings.push({
        x: d.x,
        y: d.y,
        r: d.r,
        max: d.r * 2,
        life: config.telegraphSeconds,
        color: "#6fe7ff",
        w: 2,
      });
    }
  }

  override updateRockSpecial(r: Rock, dt: number) {
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
      PILOTS.some((id) => {
        const p = this.match.players[id];
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

  override rockBoom(r: Rock) {
    if (!r.coopMine) return super.rockBoom(r);
    this.enemyBlast(
      r.x,
      r.y,
      COOP_CONFIG.mineWarden.mineBlastRadius,
      COOP_CONFIG.mineWarden.mineDamage,
      "Mine Warden mine",
    );
    this.emit({
      type: "mineDestroyed",
      tick: this.match.tick,
      entityId: r.id,
      playerId: this.activeId,
    });
  }

  updateTethers(dt: number) {
    this.match.tethers = this.match.tethers.filter((t) => {
      const source = this.drones.find((d) => d.id === t.sourceId),
        p = this.match.players[t.targetPlayerId];
      const distance = source ? Math.hypot(source.x - p.ship.x, source.y - p.ship.y) : Infinity;
      if (!source || p.disabled || distance > t.maximumDistance) {
        this.emit({
          type: "tetherBroken",
          tick: this.match.tick,
          entityId: t.sourceId,
          playerId: p.id,
        });
        return false;
      }
      if (distance > t.minimumDistance) {
        p.ship.vx += ((source.x - p.ship.x) / distance) * t.strength * dt;
        p.ship.vy += ((source.y - p.ship.y) / distance) * t.strength * dt;
      }
      return true;
    });
  }

  override weaponStats(w: WeaponId, level: number) {
    const result = super.weaponStats(w, level);
    if (this.match?.team.overdriveRemaining > 0) {
      result.dmg *= COOP_CONFIG.overdrive.damageMultiplier;
      result.rate *= COOP_CONFIG.overdrive.fireRateMultiplier;
    }
    return result;
  }
  override arcStats(level: number, drone = false) {
    const result = super.arcStats(level, drone);
    if (this.match.team.overdriveRemaining > 0) {
      result.dmg *= COOP_CONFIG.overdrive.damageMultiplier;
      result.tick /= COOP_CONFIG.overdrive.fireRateMultiplier;
    }
    return result;
  }
  override laserStats(level: number, drone = false) {
    const result = super.laserStats(level, drone);
    if (this.match.team.overdriveRemaining > 0)
      result.dps *= COOP_CONFIG.overdrive.damageMultiplier;
    return result;
  }
}

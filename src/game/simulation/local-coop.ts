import { GAME_CONFIG } from "../game-config";
import { TAU, clamp, wrapAngle } from "../math";
import type { RockTrait, WeaponId } from "../types";
import {
  BOSS_SPECS,
  EARLY_BOSS_HP_CEILING,
  SALVAGE_BASE_PRICE,
  STAT_UPGRADES,
  freshPlayer,
  freshSalvageDrone,
  weaponMaxLevel,
} from "../balance";
import {
  bossMkForWave,
  isBossWave,
  maxSentinels,
  RUN_PACING,
  scaledWave,
  sentinelWaveCount,
  sectorForWave,
} from "./campaign";
import { COOP_CONFIG, COOP_FIXED_DT } from "./coop-config";
import type {
  CoopBossState,
  CoopCommand,
  CoopEvent,
  CoopEnemyKind,
  CoopEnemyState,
  CoopMatchState,
  CoopPlayerId,
  CoopPlayerState,
  CoopProjectileState,
  CoopRockState,
} from "./coop-types";
import { FixedStepRunner } from "./fixed-step";
import { stepPlayerMovement } from "./movement";
import { randomBetween, randomChance, randomInteger, SeededRandom } from "./random";
import { salvageUpgradePrice, weaponPrice, weaponSimulationStats } from "./weapons";

const PLAYER_IDS: readonly CoopPlayerId[] = ["p1", "p2"];

export interface LocalCoopOptions {
  seed: number;
  callsigns?: readonly [string, string];
  width?: number;
  height?: number;
}

/**
 * Headless two-player simulation used to establish the authoritative state and command boundary.
 * It intentionally has no room, WebSocket, DOM, audio, rendering or persistence dependency.
 */
export class LocalCoopSimulation {
  state: CoopMatchState;
  readonly width: number;
  readonly height: number;
  private readonly random: SeededRandom;
  private readonly runner = new FixedStepRunner();
  private commands: CoopCommand[] = [];
  private events: CoopEvent[] = [];

  constructor(options: LocalCoopOptions) {
    this.width = options.width ?? COOP_CONFIG.arena.width;
    this.height = options.height ?? COOP_CONFIG.arena.height;
    this.random = new SeededRandom(options.seed);
    this.state = {
      version: 1,
      seed: options.seed >>> 0,
      randomState: this.random.snapshot(),
      tick: 0,
      clockAccumulator: 0,
      phase: "running",
      nextEntityId: 1,
      players: {
        p1: this.makePlayer("p1", options.callsigns?.[0] ?? "Pilot One", this.width * 0.36),
        p2: this.makePlayer("p2", options.callsigns?.[1] ?? "Pilot Two", this.width * 0.64),
      },
      team: {
        score: 0,
        wave: 0,
        sector: 0,
        bossesDefeated: 0,
        overdrive: 0,
        overdriveRemaining: 0,
        elapsedSeconds: 0,
      },
      rocks: [],
      enemies: [],
      projectiles: [],
      hostileProjectiles: [],
      hazards: [],
      pickups: [],
      boss: null,
    };
    this.startNextWave();
  }

  static restore(
    snapshot: CoopMatchState,
    width = COOP_CONFIG.arena.width,
    height = COOP_CONFIG.arena.height,
  ) {
    const simulation = new LocalCoopSimulation({ seed: snapshot.seed, width, height });
    simulation.state = structuredClone(snapshot);
    simulation.state.enemies ??= [];
    simulation.state.hostileProjectiles ??= [];
    simulation.state.hazards ??= [];
    for (const player of Object.values(simulation.state.players)) player.input.missile ??= false;
    for (const player of Object.values(simulation.state.players)) player.supportQuietTimer ??= 0;
    for (const player of Object.values(simulation.state.players)) player.lastCommandSequence ??= -1;
    for (const rock of simulation.state.rocks) rock.fuse ??= -1;
    for (const projectile of simulation.state.projectiles) {
      projectile.kind ??= "shot";
      projectile.fuse ??= 0;
      projectile.blastRadius ??= 0;
      projectile.blastDamage ??= 0;
      projectile.extra ??= 0;
      projectile.extraDamage ??= 0;
    }
    if (simulation.state.boss) {
      simulation.state.boss.vx ??= 0;
      simulation.state.boss.vy ??= 0;
      simulation.state.boss.phase ??= 1;
      simulation.state.boss.attackTimer ??= GAME_CONFIG.bosses.baseAttackTimer;
      simulation.state.boss.abilityTimer ??= GAME_CONFIG.bosses.baseAttackTimer * 2;
    }
    simulation.random.restore(snapshot.randomState);
    simulation.runner.restore({ tick: snapshot.tick, accumulator: snapshot.clockAccumulator });
    simulation.events = [];
    simulation.commands = [];
    return simulation;
  }

  private makePlayer(id: CoopPlayerId, callsign: string, x: number): CoopPlayerState {
    const ship = freshPlayer();
    ship.x = x;
    ship.y = this.height * 0.72;
    return {
      id,
      callsign: callsign.trim().slice(0, 24) || (id === "p1" ? "Pilot One" : "Pilot Two"),
      ship,
      credits: 0,
      level: 1,
      xp: 0,
      xpNext: GAME_CONFIG.progression.startingXpNext,
      upgrades: {},
      upgradePoints: 0,
      drone: freshSalvageDrone(),
      disabled: false,
      reviveProgress: 0,
      reviveCooldown: 0,
      supportQuietTimer: 0,
      lastInputSequence: -1,
      lastCommandSequence: -1,
      input: {
        moveX: 0,
        moveY: 0,
        aimAngle: ship.angle,
        fire: false,
        missile: false,
        interact: false,
      },
      stats: {
        damage: 0,
        kills: 0,
        asteroidKills: 0,
        bossDamage: 0,
        revives: 0,
        creditsCollected: 0,
      },
    };
  }

  submit(command: CoopCommand) {
    const player = this.state.players[command.playerId];
    if (
      !player ||
      this.state.phase !== "running" ||
      !Number.isSafeInteger(command.sequence) ||
      command.sequence <=
        (command.type === "input" ? player.lastInputSequence : player.lastCommandSequence)
    )
      return false;
    if (command.type === "input") {
      if (![command.moveX, command.moveY, command.aimAngle].every(Number.isFinite)) return false;
      command = {
        ...command,
        moveX: clamp(command.moveX, -1, 1),
        moveY: clamp(command.moveY, -1, 1),
        aimAngle: wrapAngle(command.aimAngle),
        fire: Boolean(command.fire),
        missile: Boolean(command.missile),
        interact: Boolean(command.interact),
      };
    }
    if (
      command.type === "buyWeapon" &&
      !Object.prototype.hasOwnProperty.call(player.ship.weapons, command.weapon)
    )
      return false;
    if (
      command.type === "buyDroneUpgrade" &&
      !Object.prototype.hasOwnProperty.call(player.drone.upgrades, command.upgrade)
    )
      return false;
    if (
      ![
        "input",
        "buyWeapon",
        "selectWeapon",
        "buyDrone",
        "buyDroneUpgrade",
        "chooseUpgrade",
        "equipDroneWeapon",
        "activateOverdrive",
      ].includes(command.type)
    )
      return false;
    if (command.type === "input") player.lastInputSequence = command.sequence;
    else player.lastCommandSequence = command.sequence;
    this.commands.push(command);
    return true;
  }

  advance(elapsedSeconds: number) {
    const steps = this.runner.advance(elapsedSeconds, (dt, tick) => this.fixedStep(dt, tick));
    const clock = this.runner.snapshot();
    this.state.tick = clock.tick;
    this.state.clockAccumulator = clock.accumulator;
    return steps;
  }

  stepTicks(ticks = 1) {
    for (let index = 0; index < Math.max(0, Math.floor(ticks)); index++)
      this.advance(COOP_FIXED_DT);
  }

  snapshot(): CoopMatchState {
    const clock = this.runner.snapshot();
    this.state.tick = clock.tick;
    this.state.clockAccumulator = clock.accumulator;
    this.state.randomState = this.random.snapshot();
    return structuredClone(this.state);
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return structuredClone(events);
  }

  private fixedStep(dt: number, tick: number) {
    this.state.tick = tick;
    this.applyCommands();
    if (this.state.phase !== "running") return;
    this.state.team.elapsedSeconds += dt;
    this.state.team.overdriveRemaining = Math.max(0, this.state.team.overdriveRemaining - dt);

    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      player.ship.invuln = Math.max(0, player.ship.invuln - dt);
      player.reviveCooldown = Math.max(0, player.reviveCooldown - dt);
      player.supportQuietTimer = Math.max(0, player.supportQuietTimer - dt);
      if (player.disabled) continue;
      stepPlayerMovement(player.ship, player.input, dt, { width: this.width, height: this.height });
      player.ship.fireTimer -= dt;
      player.ship.missileTimer = Math.max(0, player.ship.missileTimer - dt);
      player.ship.missileCharge += dt;
      if (
        player.ship.missiles < player.ship.maxMissiles &&
        player.ship.missileCharge >= player.ship.missileRegen
      ) {
        player.ship.missiles++;
        player.ship.missileCharge -= player.ship.missileRegen;
      }
      if (player.input.fire && player.ship.fireTimer <= 0) this.fire(player);
      if (player.input.missile && !player.ship.missileHeld) this.fireMissile(player);
      player.ship.missileHeld = player.input.missile;
      this.updateDrone(player, dt);
    }

    this.updateRocks(dt);
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateHostileProjectiles(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.updatePlayerCollisions();
    this.updateRevives(dt);
    if (this.state.phase !== "running") return;

    if (!this.state.boss && this.state.rocks.length === 0 && this.state.enemies.length === 0)
      this.startNextWave();
    this.state.randomState = this.random.snapshot();
  }

  private applyCommands() {
    const commands = this.commands;
    this.commands = [];
    for (const command of commands) {
      const player = this.state.players[command.playerId];
      switch (command.type) {
        case "input":
          player.input = {
            moveX: command.moveX,
            moveY: command.moveY,
            aimAngle: command.aimAngle,
            aimTurnMultiplier: 3.2,
            fire: command.fire,
            missile: command.missile,
            interact: command.interact,
          };
          break;
        case "buyWeapon":
          this.buyWeapon(player, command.weapon);
          break;
        case "selectWeapon":
          if (player.ship.weapons[command.weapon] > 0) player.ship.primary = command.weapon;
          else this.reject(player, command.weapon);
          break;
        case "buyDrone":
          this.buyDrone(player);
          break;
        case "buyDroneUpgrade":
          this.buyDroneUpgrade(player, command.upgrade);
          break;
        case "chooseUpgrade":
          this.chooseUpgrade(player, command.upgrade);
          break;
        case "equipDroneWeapon":
          if (
            player.drone.purchased &&
            (command.weapon === null ||
              (player.ship.weapons[command.weapon] > 0 && command.weapon !== player.ship.primary))
          )
            player.drone.weapon = command.weapon;
          else this.reject(player, command.weapon ?? "droneWeapon");
          break;
        case "activateOverdrive":
          if (
            this.state.team.overdrive >= COOP_CONFIG.overdrive.maximum &&
            this.state.team.overdriveRemaining <= 0
          ) {
            this.state.team.overdrive = 0;
            this.state.team.overdriveRemaining = COOP_CONFIG.overdrive.durationSeconds;
            this.events.push({
              type: "overdriveActivated",
              tick: this.state.tick,
              playerId: player.id,
            });
          }
          break;
      }
    }
  }

  private buyWeapon(player: CoopPlayerState, weapon: WeaponId) {
    const price = weaponPrice(player.ship, weapon);
    if (price == null || player.credits < price) return this.reject(player, weapon);
    const locked = player.ship.weapons[weapon] === 0;
    player.credits -= price;
    player.ship.weapons[weapon] = Math.min(weaponMaxLevel(weapon), player.ship.weapons[weapon] + 1);
    if (locked) player.ship.primary = weapon;
    this.events.push({
      type: "purchaseAccepted",
      tick: this.state.tick,
      playerId: player.id,
      item: weapon,
      cost: price,
    });
  }

  private buyDrone(player: CoopPlayerState) {
    if (player.drone.purchased || player.credits < SALVAGE_BASE_PRICE)
      return this.reject(player, "drone");
    player.credits -= SALVAGE_BASE_PRICE;
    player.drone.purchased = true;
    player.drone.active = true;
    player.drone.hp = player.drone.maxHp;
    player.drone.x = player.ship.x + 30;
    player.drone.y = player.ship.y + 15;
    this.events.push({
      type: "purchaseAccepted",
      tick: this.state.tick,
      playerId: player.id,
      item: "drone",
      cost: SALVAGE_BASE_PRICE,
    });
  }

  private buyDroneUpgrade(player: CoopPlayerState, id: keyof CoopPlayerState["drone"]["upgrades"]) {
    const price = salvageUpgradePrice(player.drone, id);
    if (!player.drone.purchased || price == null || player.credits < price)
      return this.reject(player, id);
    player.credits -= price;
    player.drone.upgrades[id]++;
    if (id === "armor") {
      player.drone.maxHp += GAME_CONFIG.salvage.armorHpPerLevel;
      player.drone.hp = Math.min(
        player.drone.maxHp,
        player.drone.hp + GAME_CONFIG.salvage.armorHpPerLevel,
      );
    }
    this.events.push({
      type: "purchaseAccepted",
      tick: this.state.tick,
      playerId: player.id,
      item: id,
      cost: price,
    });
  }

  private chooseUpgrade(player: CoopPlayerState, id: string) {
    const upgrade = STAT_UPGRADES.find((entry) => entry.id === id);
    const level = player.upgrades[id] ?? 0;
    if (!upgrade || player.upgradePoints < 1 || level >= upgrade.max)
      return this.reject(player, id);
    player.upgradePoints--;
    upgrade.apply({ p: player.ship });
    player.upgrades[id] = level + 1;
    this.events.push({
      type: "purchaseAccepted",
      tick: this.state.tick,
      playerId: player.id,
      item: id,
      cost: 0,
    });
  }

  private reject(player: CoopPlayerState, item: string) {
    this.events.push({
      type: "purchaseRejected",
      tick: this.state.tick,
      playerId: player.id,
      item,
    });
  }

  private fire(player: CoopPlayerState) {
    const weapon = player.ship.primary;
    if (player.ship.weapons[weapon] <= 0) return;
    const stats = weaponSimulationStats(player.ship, player.drone, weapon);
    const overdrive =
      this.state.team.overdriveRemaining > 0 ? COOP_CONFIG.overdrive.fireRateMultiplier : 1;
    player.ship.fireTimer = 1 / (stats.rate * overdrive);
    if (weapon === "laser" || weapon === "arc") {
      this.fireInstantWeapon(
        player,
        stats.damage,
        weapon === "arc" ? 2 + player.ship.weapons.arc : 1,
      );
      this.events.push({ type: "weaponFired", tick: this.state.tick, playerId: player.id, weapon });
      return;
    }
    const startX = player.ship.x + Math.cos(player.ship.angle) * 18;
    const startY = player.ship.y + Math.sin(player.ship.angle) * 18;
    for (let shot = 0; shot < stats.shots; shot++) {
      const spread = (shot - (stats.shots - 1) / 2) * stats.arc;
      const angle =
        player.ship.angle + spread + randomBetween(this.random, -0.5, 0.5) * player.ship.inaccuracy;
      const critical = randomChance(this.random, player.ship.crit);
      const damage =
        stats.damage *
        (critical ? player.ship.critMult : 1) *
        (this.state.team.overdriveRemaining > 0 ? COOP_CONFIG.overdrive.damageMultiplier : 1);
      this.state.projectiles.push({
        id: this.nextId(),
        ownerId: player.id,
        x: startX,
        y: startY,
        vx: Math.cos(angle) * stats.speed + player.ship.vx * 0.35,
        vy: Math.sin(angle) * stats.speed + player.ship.vy * 0.35,
        radius: stats.radius,
        damage,
        life: stats.life,
        pierce: stats.pierce,
        bounces: stats.bounces,
        homing: stats.homing,
        hitIds: [],
        weapon,
        kind: "shot",
        fuse: stats.fuse,
        blastRadius: 0,
        blastDamage: 0,
        extra: stats.extra,
        extraDamage: stats.extraDamage,
      });
    }
    this.events.push({ type: "weaponFired", tick: this.state.tick, playerId: player.id, weapon });
  }

  private fireInstantWeapon(player: CoopPlayerState, damage: number, maximumTargets: number) {
    const candidates = [
      ...this.state.enemies.map((entity) => ({ entity, type: "enemy" as const })),
      ...this.state.rocks.map((entity) => ({ entity, type: "rock" as const })),
      ...(this.state.boss ? [{ entity: this.state.boss, type: "boss" as const }] : []),
    ]
      .map((entry) => ({
        ...entry,
        distance: Math.hypot(entry.entity.x - player.ship.x, entry.entity.y - player.ship.y),
        angle: Math.abs(
          wrapAngle(
            Math.atan2(entry.entity.y - player.ship.y, entry.entity.x - player.ship.x) -
              player.ship.angle,
          ),
        ),
      }))
      .filter((entry) => entry.distance <= 760 && entry.angle <= 0.16)
      .sort((left, right) => left.distance - right.distance || left.entity.id - right.entity.id)
      .slice(0, maximumTargets);
    for (const target of candidates) {
      if (target.type === "boss") this.damageBoss(damage, player);
      else if (target.type === "enemy") this.damageEnemy(target.entity, damage, player);
      else this.damageRock(target.entity, damage, player);
    }
  }

  private fireMissile(player: CoopPlayerState) {
    if (player.ship.missiles <= 0 || player.ship.missileTimer > 0) return;
    player.ship.missiles--;
    player.ship.missileTimer = 0.45;
    player.ship.missileCharge = 0;
    const angle = player.ship.angle;
    this.state.projectiles.push({
      id: this.nextId(),
      ownerId: player.id,
      x: player.ship.x + Math.cos(angle) * 20,
      y: player.ship.y + Math.sin(angle) * 20,
      vx: Math.cos(angle) * GAME_CONFIG.simulation.missileSpeed,
      vy: Math.sin(angle) * GAME_CONFIG.simulation.missileSpeed,
      radius: 7,
      damage: player.ship.blastDmg,
      life: 3.2,
      pierce: 0,
      bounces: 0,
      homing: 3.5,
      hitIds: [],
      weapon: player.ship.primary,
      kind: "missile",
      fuse: 0,
      blastRadius: player.ship.blastR,
      blastDamage: player.ship.blastDmg,
      extra: 0,
      extraDamage: 0,
    });
    this.events.push({ type: "missileFired", tick: this.state.tick, playerId: player.id });
  }

  private updateDrone(player: CoopPlayerState, dt: number) {
    const drone = player.drone;
    if (!drone.purchased || !drone.active) return;
    const targetX = player.ship.x + (player.id === "p1" ? -34 : 34);
    const targetY = player.ship.y + 24;
    drone.x += (targetX - drone.x) * Math.min(1, dt * 5);
    drone.y += (targetY - drone.y) * Math.min(1, dt * 5);
    drone.fireTimer -= dt;
    drone.pulseTimer -= dt;
    const repairLevel = drone.upgrades.repairPulse;
    const supportRange =
      GAME_CONFIG.salvage.repairPulseRange +
      drone.upgrades.scan * GAME_CONFIG.salvage.repairPulseRangePerScan;
    if (
      repairLevel > 0 &&
      player.supportQuietTimer <= 0 &&
      Math.hypot(drone.x - player.ship.x, drone.y - player.ship.y) <= supportRange &&
      drone.pulseTimer <= 0
    ) {
      player.ship.hull = Math.min(
        player.ship.maxHull,
        player.ship.hull +
          (repairLevel >= 3
            ? GAME_CONFIG.salvage.repairPulseLevel3Heal
            : GAME_CONFIG.salvage.repairPulseHeal),
      );
      drone.pulseTimer =
        GAME_CONFIG.salvage.repairPulseIntervals[
          Math.min(repairLevel, GAME_CONFIG.salvage.repairPulseIntervals.length) - 1
        ];
    }
    const target = this.nearestTarget(drone.x, drone.y);
    if (!target || drone.fireTimer > 0) return;
    const mounted = drone.weapon
      ? weaponSimulationStats(player.ship, drone, drone.weapon, player.ship.weapons[drone.weapon])
      : null;
    const damage =
      GAME_CONFIG.salvage.baseShotDamage +
      drone.upgrades.overcharge * GAME_CONFIG.salvage.overchargeDamagePerLevel +
      (mounted?.damage ?? 0) * GAME_CONFIG.salvage.weaponDamageScale;
    if (target.type === "boss") this.damageBoss(damage, player);
    else if (target.type === "enemy") this.damageEnemy(target.entity, damage, player);
    else this.damageRock(target.entity, damage, player);
    drone.fireTimer = Math.max(
      GAME_CONFIG.salvage.minFireInterval,
      (mounted
        ? GAME_CONFIG.salvage.attachedFireInterval
        : GAME_CONFIG.salvage.starterFireInterval) -
        drone.upgrades.overcharge * GAME_CONFIG.salvage.overchargeFireReduction -
        drone.upgrades.twinCannons * GAME_CONFIG.salvage.twinCadenceReduction,
    );
  }

  private updateProjectiles(dt: number) {
    for (let index = this.state.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.state.projectiles[index];
      projectile.life -= dt;
      projectile.fuse -= dt;
      if (projectile.homing > 0) this.guideProjectile(projectile, dt);
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      if (projectile.bounces > 0) {
        if (projectile.x < 0 || projectile.x > this.width) {
          projectile.vx *= -1;
          projectile.x = clamp(projectile.x, 0, this.width);
          projectile.bounces--;
        }
        if (projectile.y < 0 || projectile.y > this.height) {
          projectile.vy *= -1;
          projectile.y = clamp(projectile.y, 0, this.height);
          projectile.bounces--;
        }
      }

      let consumed =
        projectile.life <= 0 ||
        projectile.x < -80 ||
        projectile.x > this.width + 80 ||
        projectile.y < -80 ||
        projectile.y > this.height + 80;
      if (projectile.kind === "shot" && projectile.extra > 0 && projectile.fuse <= 0) {
        this.spawnShrapnel(projectile);
        consumed = true;
      }
      if (!consumed) {
        for (const enemy of [...this.state.enemies]) {
          if (projectile.hitIds.includes(enemy.id)) continue;
          if (
            Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) >
            projectile.radius + enemy.radius
          )
            continue;
          projectile.hitIds.push(enemy.id);
          this.damageEnemy(enemy, projectile.damage, this.state.players[projectile.ownerId]);
          consumed = projectile.kind === "missile" || projectile.pierce-- <= 0;
          if (consumed) break;
        }
      }
      if (!consumed && this.state.boss && !projectile.hitIds.includes(this.state.boss.id)) {
        if (
          Math.hypot(projectile.x - this.state.boss.x, projectile.y - this.state.boss.y) <=
          projectile.radius + this.state.boss.radius
        ) {
          projectile.hitIds.push(this.state.boss.id);
          this.damageBoss(projectile.damage, this.state.players[projectile.ownerId]);
          consumed = projectile.kind === "missile" || projectile.pierce-- <= 0;
        }
      }
      if (!consumed) {
        for (const rock of [...this.state.rocks]) {
          if (projectile.hitIds.includes(rock.id)) continue;
          if (
            Math.hypot(projectile.x - rock.x, projectile.y - rock.y) >
            projectile.radius + rock.radius
          )
            continue;
          projectile.hitIds.push(rock.id);
          this.damageRock(rock, projectile.damage, this.state.players[projectile.ownerId]);
          consumed = projectile.kind === "missile" || projectile.pierce-- <= 0;
          if (consumed) break;
        }
      }
      if (consumed) {
        if (projectile.kind === "missile") this.explodeMissile(projectile);
        this.state.projectiles.splice(index, 1);
      }
    }
  }

  private spawnShrapnel(projectile: CoopProjectileState) {
    for (let index = 0; index < projectile.extra; index++) {
      const angle = (index / projectile.extra) * TAU + this.random.next() * 0.2;
      this.state.projectiles.push({
        id: this.nextId(),
        ownerId: projectile.ownerId,
        x: projectile.x,
        y: projectile.y,
        vx: Math.cos(angle) * 520,
        vy: Math.sin(angle) * 520,
        radius: 2.8,
        damage: projectile.extraDamage,
        life: 0.55,
        pierce: 0,
        bounces: 0,
        homing: 0,
        hitIds: [],
        weapon: "flak",
        kind: "shrapnel",
        fuse: 0,
        blastRadius: 0,
        blastDamage: 0,
        extra: 0,
        extraDamage: 0,
      });
    }
  }

  private explodeMissile(projectile: CoopProjectileState) {
    const player = this.state.players[projectile.ownerId];
    for (const enemy of [...this.state.enemies])
      if (Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y) <= projectile.blastRadius)
        this.damageEnemy(enemy, projectile.blastDamage, player);
    for (const rock of [...this.state.rocks])
      if (Math.hypot(rock.x - projectile.x, rock.y - projectile.y) <= projectile.blastRadius)
        this.damageRock(rock, projectile.blastDamage, player);
    if (
      this.state.boss &&
      Math.hypot(this.state.boss.x - projectile.x, this.state.boss.y - projectile.y) <=
        projectile.blastRadius + this.state.boss.radius
    )
      this.damageBoss(projectile.blastDamage, player);
  }

  private guideProjectile(projectile: CoopProjectileState, dt: number) {
    const target = this.nearestTarget(projectile.x, projectile.y)?.entity;
    if (!target) return;
    const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
    const current = Math.atan2(projectile.vy, projectile.vx);
    const desired = Math.atan2(target.y - projectile.y, target.x - projectile.x);
    const angle =
      current +
      clamp(wrapAngle(desired - current), -projectile.homing * dt, projectile.homing * dt);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.state.enemies) {
      const target = this.nearestPlayer(enemy.x, enemy.y);
      if (!target) continue;
      enemy.targetPlayerId = target.id;
      enemy.fireTimer -= dt;
      enemy.behaviorTimer -= dt;
      if (enemy.warningTimer > 0) {
        enemy.warningTimer -= dt;
        if (enemy.warningTimer <= 0) this.completeEnemyAttack(enemy);
      }

      if (enemy.kind === "spiker") {
        if (enemy.behaviorTimer <= 0) {
          const turn = randomBetween(
            this.random,
            -GAME_CONFIG.enemies.spikers.turnAngle,
            GAME_CONFIG.enemies.spikers.turnAngle,
          );
          const speed = Math.hypot(enemy.vx, enemy.vy);
          const angle = Math.atan2(enemy.vy, enemy.vx) + turn;
          enemy.vx = Math.cos(angle) * speed;
          enemy.vy = Math.sin(angle) * speed;
          enemy.behaviorTimer = randomBetween(
            this.random,
            GAME_CONFIG.enemies.spikers.turnIntervalMin,
            GAME_CONFIG.enemies.spikers.turnIntervalMax,
          );
        }
        enemy.angle += GAME_CONFIG.enemies.spikers.spinRate * dt;
        if (enemy.fireTimer <= 0 && enemy.warningTimer <= 0) {
          enemy.warningTimer = GAME_CONFIG.enemies.spikers.fireWarning;
          enemy.aimX = target.ship.x;
          enemy.aimY = target.ship.y;
        }
      } else if (enemy.kind === "wardenTurret") {
        enemy.vx = 0;
        enemy.vy = 0;
        if (enemy.fireTimer <= 0 && enemy.warningTimer <= 0) {
          enemy.warningTimer = 0.35;
          enemy.aimX = target.ship.x;
          enemy.aimY = target.ship.y;
        }
      } else {
        const preferred =
          enemy.kind === "warden"
            ? GAME_CONFIG.enemies.wardens.preferredDistance
            : GAME_CONFIG.enemies.sentinels.preferredDistance;
        const speed =
          enemy.kind === "warden"
            ? GAME_CONFIG.enemies.wardens.speed
            : GAME_CONFIG.enemies.sentinels.speed;
        const dx = target.ship.x - enemy.x;
        const dy = target.ship.y - enemy.y;
        const distance = Math.hypot(dx, dy) || 1;
        const direction = distance > preferred + 80 ? 1 : distance < preferred - 80 ? -1 : 0;
        enemy.vx = (dx / distance) * speed * direction + (-dy / distance) * speed * 0.18;
        enemy.vy = (dy / distance) * speed * direction + (dx / distance) * speed * 0.18;
        enemy.angle = Math.atan2(dy, dx);
        if (
          enemy.kind === "warden" &&
          enemy.behaviorTimer <= 0 &&
          this.state.enemies.filter((candidate) => candidate.kind === "wardenTurret").length <
            GAME_CONFIG.enemies.wardens.turretCap
        ) {
          const turret = this.spawnEnemy("wardenTurret");
          turret.x = clamp(
            enemy.x + randomBetween(this.random, -90, 90),
            turret.radius,
            this.width - turret.radius,
          );
          turret.y = clamp(
            enemy.y + randomBetween(this.random, -90, 90),
            turret.radius,
            this.height - turret.radius,
          );
          enemy.behaviorTimer = randomBetween(
            this.random,
            GAME_CONFIG.enemies.wardens.turretIntervalMin,
            GAME_CONFIG.enemies.wardens.turretIntervalMax,
          );
        }
        if (enemy.fireTimer <= 0 && enemy.warningTimer <= 0) {
          if (enemy.kind === "warden") {
            enemy.warningTimer = GAME_CONFIG.enemies.wardens.aimWarning;
            enemy.aimX = target.ship.x + target.ship.vx * 0.45;
            enemy.aimY = target.ship.y + target.ship.vy * 0.45;
          } else {
            this.fireEnemyShot(enemy, target.ship.x, target.ship.y);
            enemy.fireTimer = randomBetween(
              this.random,
              GAME_CONFIG.enemies.sentinels.fireIntervalMin,
              GAME_CONFIG.enemies.sentinels.fireIntervalMax,
            );
            if (this.state.team.wave >= GAME_CONFIG.enemies.sentinels.burstFromWave)
              enemy.burst = 1;
          }
        } else if (enemy.kind === "sentinel" && enemy.burst > 0 && enemy.fireTimer <= -0.22) {
          this.fireEnemyShot(enemy, target.ship.x, target.ship.y);
          enemy.burst = 0;
        }
      }

      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      if (enemy.kind === "spiker") {
        if (enemy.x < enemy.radius || enemy.x > this.width - enemy.radius) enemy.vx *= -1;
        if (enemy.y < enemy.radius || enemy.y > this.height - enemy.radius) enemy.vy *= -1;
      }
      enemy.x = clamp(enemy.x, enemy.radius, this.width - enemy.radius);
      enemy.y = clamp(enemy.y, enemy.radius, this.height - enemy.radius);
    }
  }

  private completeEnemyAttack(enemy: CoopEnemyState) {
    if (enemy.kind === "spiker") {
      const count = this.state.team.wave >= GAME_CONFIG.enemies.spikers.eightShotWave ? 8 : 4;
      for (let shot = 0; shot < count; shot++) {
        const angle = (shot / count) * TAU;
        this.spawnHostile(
          enemy,
          angle,
          GAME_CONFIG.enemies.spikers.boltSpeed,
          GAME_CONFIG.enemies.spikers.boltDamage,
          GAME_CONFIG.enemies.spikers.boltRadius,
          GAME_CONFIG.enemies.spikers.boltLifetime,
        );
      }
      enemy.fireTimer =
        this.state.team.wave >= GAME_CONFIG.enemies.spikers.eightShotWave
          ? GAME_CONFIG.enemies.spikers.lateFireInterval
          : GAME_CONFIG.enemies.spikers.fireInterval;
      return;
    }
    this.fireEnemyShot(enemy, enemy.aimX, enemy.aimY);
    enemy.fireTimer =
      enemy.kind === "warden"
        ? randomBetween(
            this.random,
            GAME_CONFIG.enemies.wardens.shotDelayMin,
            GAME_CONFIG.enemies.wardens.shotDelayMax,
          )
        : 2.2;
  }

  private fireEnemyShot(enemy: CoopEnemyState, targetX: number, targetY: number) {
    const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
    if (enemy.kind === "warden" || enemy.kind === "wardenTurret")
      this.spawnHostile(
        enemy,
        angle,
        GAME_CONFIG.enemies.wardens.boltSpeed,
        GAME_CONFIG.enemies.wardens.boltDamage,
        GAME_CONFIG.enemies.wardens.boltRadius,
        GAME_CONFIG.enemies.wardens.boltLifetime,
      );
    else
      this.spawnHostile(
        enemy,
        angle,
        GAME_CONFIG.enemies.sentinels.boltSpeed,
        GAME_CONFIG.enemies.sentinels.boltDamage,
        GAME_CONFIG.enemies.sentinels.boltRadius,
        GAME_CONFIG.enemies.sentinels.boltLifetime,
      );
  }

  private spawnHostile(
    source: CoopEnemyState | CoopBossState,
    angle: number,
    speed: number,
    damage: number,
    radius: number,
    life: number,
  ) {
    this.state.hostileProjectiles.push({
      id: this.nextId(),
      sourceId: source.id,
      source: "kind" in source ? source.kind : "boss",
      x: source.x + Math.cos(angle) * source.radius,
      y: source.y + Math.sin(angle) * source.radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      life,
      hitPlayerIds: [],
    });
  }

  private updateBoss(dt: number) {
    const boss = this.state.boss;
    if (!boss) return;
    const fraction = boss.hp / boss.maxHp;
    boss.phase =
      fraction <= GAME_CONFIG.bosses.attackPhaseThresholds[1]
        ? 3
        : fraction <= GAME_CONFIG.bosses.attackPhaseThresholds[0]
          ? 2
          : 1;
    boss.attackTimer -= dt;
    boss.abilityTimer -= dt;
    const targetX =
      this.width / 2 +
      Math.sin(this.state.team.elapsedSeconds * 0.45 + boss.mk) * this.width * 0.28;
    const targetY = this.height * (0.2 + 0.08 * Math.cos(this.state.team.elapsedSeconds * 0.3));
    boss.vx = (targetX - boss.x) * 0.7;
    boss.vy = (targetY - boss.y) * 0.7;
    boss.x = clamp(boss.x + boss.vx * dt, boss.radius, this.width - boss.radius);
    boss.y = clamp(boss.y + boss.vy * dt, boss.radius, this.height * 0.55);
    if (boss.attackTimer <= 0) {
      const shots = 4 + boss.mk + boss.phase * 2;
      const offset = this.random.next() * TAU;
      for (let shot = 0; shot < shots; shot++)
        this.spawnHostile(
          boss,
          offset + (shot / shots) * TAU,
          180 + boss.mk * 22,
          6 + boss.mk * 1.4,
          6,
          5,
        );
      boss.attackTimer = Math.max(0.65, GAME_CONFIG.bosses.baseAttackTimer - boss.phase * 0.35);
    }
    if (boss.abilityTimer <= 0) {
      this.triggerBossAbility(boss);
      boss.abilityTimer = Math.max(2.4, 6.2 - boss.phase * 0.7 - boss.mk * 0.2);
    }
  }

  private triggerBossAbility(boss: CoopBossState) {
    const target = this.nearestPlayer(boss.x, boss.y);
    if (!target) return;
    if (boss.mk === 4) {
      this.state.hazards.push({
        id: this.nextId(),
        sourceId: boss.id,
        kind: "strike",
        x: target.ship.x,
        y: target.ship.y,
        radius: GAME_CONFIG.bosses.mk4.strikeRadius,
        timer: GAME_CONFIG.bosses.mk4.strikeWarning,
        damage: GAME_CONFIG.bosses.mk4.strikeDamage,
      });
      this.events.push({
        type: "bossAbility",
        tick: this.state.tick,
        mk: boss.mk,
        ability: "ignitionStrike",
      });
    } else if (boss.mk === 5) {
      this.state.hazards.push({
        id: this.nextId(),
        sourceId: boss.id,
        kind: "shockwave",
        x: boss.x,
        y: boss.y,
        radius: 190 + boss.phase * 45,
        timer: 0.8,
        damage: 15 + boss.phase * 3,
      });
      this.events.push({
        type: "bossAbility",
        tick: this.state.tick,
        mk: boss.mk,
        ability: "shockwave",
      });
    } else {
      const trait: RockTrait = boss.mk === 1 ? "none" : boss.mk === 2 ? "homing" : "bounce";
      const count = boss.mk === 3 ? 3 : 2;
      for (let index = 0; index < count; index++)
        this.state.rocks.push(
          this.makeRock(
            randomBetween(this.random, 40, this.width - 40),
            -30,
            2,
            trait,
            randomBetween(this.random, -30, 30),
            randomBetween(this.random, 100, 180),
          ),
        );
      this.events.push({
        type: "bossAbility",
        tick: this.state.tick,
        mk: boss.mk,
        ability: "meteorCall",
      });
    }
    if (randomChance(this.random, GAME_CONFIG.bosses.abilityRockChance)) {
      const trait = BOSS_SPECS[boss.mk].trait;
      this.state.rocks.push(
        this.makeRock(boss.x, boss.y, randomInteger(this.random, 1, 3) as 1 | 2 | 3, trait),
      );
    }
  }

  private updateHostileProjectiles(dt: number) {
    for (let index = this.state.hostileProjectiles.length - 1; index >= 0; index--) {
      const shot = this.state.hostileProjectiles[index];
      shot.life -= dt;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      let consumed =
        shot.life <= 0 ||
        shot.x < -50 ||
        shot.x > this.width + 50 ||
        shot.y < -50 ||
        shot.y > this.height + 50;
      if (!consumed)
        for (const id of PLAYER_IDS) {
          const player = this.state.players[id];
          if (player.disabled || shot.hitPlayerIds.includes(id)) continue;
          if (
            Math.hypot(player.ship.x - shot.x, player.ship.y - shot.y) >
            GAME_CONFIG.player.shipRadius + shot.radius
          )
            continue;
          shot.hitPlayerIds.push(id);
          this.damagePlayer(player, shot.damage * COOP_CONFIG.difficulty.enemyDamage);
          player.ship.invuln = 0.18;
          consumed = true;
          break;
        }
      if (consumed) this.state.hostileProjectiles.splice(index, 1);
    }
  }

  private updateHazards(dt: number) {
    for (let index = this.state.hazards.length - 1; index >= 0; index--) {
      const hazard = this.state.hazards[index];
      hazard.timer -= dt;
      if (hazard.timer > 0) continue;
      for (const id of PLAYER_IDS) {
        const player = this.state.players[id];
        if (
          !player.disabled &&
          Math.hypot(player.ship.x - hazard.x, player.ship.y - hazard.y) <= hazard.radius
        )
          this.damagePlayer(player, hazard.damage * COOP_CONFIG.difficulty.enemyDamage);
      }
      this.state.hazards.splice(index, 1);
    }
  }

  private updateRocks(dt: number) {
    for (const rock of [...this.state.rocks]) {
      const target = this.nearestPlayer(rock.x, rock.y);
      const sizeName = rock.size === 3 ? "large" : rock.size === 2 ? "medium" : "small";
      if (target && rock.trait === "homing") {
        const speed =
          rock.size === 1
            ? GAME_CONFIG.asteroids.traits.homing.smallSpeed
            : rock.size === 2
              ? 88
              : 95;
        const turn = GAME_CONFIG.asteroids.traits.homing.turnRates[sizeName];
        const current = Math.atan2(rock.vy, rock.vx);
        const desired = Math.atan2(target.ship.y - rock.y, target.ship.x - rock.x);
        const angle = current + clamp(wrapAngle(desired - current), -turn * dt, turn * dt);
        rock.vx = Math.cos(angle) * speed;
        rock.vy = Math.sin(angle) * speed;
      } else if (target && rock.trait === "boom") {
        const distance = Math.hypot(target.ship.x - rock.x, target.ship.y - rock.y);
        if (distance <= GAME_CONFIG.asteroids.traits.boom.homeRange) {
          const current = Math.atan2(rock.vy, rock.vx);
          const desired = Math.atan2(target.ship.y - rock.y, target.ship.x - rock.x);
          const angle =
            current +
            clamp(
              wrapAngle(desired - current),
              -GAME_CONFIG.asteroids.traits.boom.homeTurn * dt,
              GAME_CONFIG.asteroids.traits.boom.homeTurn * dt,
            );
          const speed = Math.hypot(rock.vx, rock.vy);
          rock.vx = Math.cos(angle) * speed;
          rock.vy = Math.sin(angle) * speed;
        }
        const trigger = Math.max(
          rock.radius + GAME_CONFIG.asteroids.traits.boom.triggerPad,
          GAME_CONFIG.asteroids.traits.boom.blastRadii[sizeName] *
            GAME_CONFIG.asteroids.traits.boom.triggerRadiusFraction,
        );
        if (distance < trigger) {
          if (rock.fuse < 0) rock.fuse = GAME_CONFIG.asteroids.traits.boom.fuse;
          rock.fuse -= dt;
          if (rock.fuse <= 0) {
            this.explodeBoomRock(rock);
            continue;
          }
        } else if (rock.fuse >= 0) {
          rock.fuse = Math.min(GAME_CONFIG.asteroids.traits.boom.fuse, rock.fuse + dt * 0.5);
        }
      } else if (rock.trait === "fast") {
        const healthLost = 1 - clamp(rock.hp / rock.maxHp, 0, 1);
        const speed = GAME_CONFIG.asteroids.traits.fast.speeds[sizeName] * (1 + healthLost * 0.5);
        const angle = Math.atan2(rock.vy, rock.vx);
        rock.vx = Math.cos(angle) * speed;
        rock.vy = Math.sin(angle) * speed;
      }
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      const margin = rock.radius;
      if (rock.trait === "bounce") {
        if (rock.x < margin || rock.x > this.width - margin) rock.vx *= -1.05;
        if (rock.y < margin || rock.y > this.height - margin) rock.vy *= -1.05;
        rock.x = clamp(rock.x, margin, this.width - margin);
        rock.y = clamp(rock.y, margin, this.height - margin);
      } else {
        if (rock.x < -margin) rock.x += this.width + margin * 2;
        if (rock.x > this.width + margin) rock.x -= this.width + margin * 2;
        if (rock.y < -margin) rock.y += this.height + margin * 2;
        if (rock.y > this.height + margin) rock.y -= this.height + margin * 2;
      }
    }
  }

  private explodeBoomRock(rock: CoopRockState) {
    const index = this.state.rocks.findIndex((candidate) => candidate.id === rock.id);
    if (index < 0) return;
    this.state.rocks.splice(index, 1);
    this.damageBoomArea(rock);
  }

  private damageBoomArea(rock: CoopRockState) {
    const sizeName = rock.size === 3 ? "large" : rock.size === 2 ? "medium" : "small";
    const radius = GAME_CONFIG.asteroids.traits.boom.blastRadii[sizeName];
    const damage = GAME_CONFIG.asteroids.traits.boom.playerDamage[sizeName];
    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      if (!player.disabled && Math.hypot(player.ship.x - rock.x, player.ship.y - rock.y) <= radius)
        this.damagePlayer(player, damage * COOP_CONFIG.difficulty.enemyDamage);
    }
  }

  private updatePlayerCollisions() {
    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      if (player.disabled || player.ship.invuln > 0) continue;
      const enemy = this.state.enemies.find(
        (candidate) =>
          Math.hypot(candidate.x - player.ship.x, candidate.y - player.ship.y) <
          candidate.radius + GAME_CONFIG.player.shipRadius,
      );
      if (enemy) {
        const damage =
          enemy.kind === "spiker"
            ? GAME_CONFIG.enemies.spikers.playerContactDamage
            : enemy.kind === "warden" || enemy.kind === "wardenTurret"
              ? GAME_CONFIG.enemies.wardens.playerContactDamage
              : GAME_CONFIG.enemies.sentinels.playerContactDamage;
        this.damagePlayer(player, damage * COOP_CONFIG.difficulty.enemyDamage);
        player.ship.invuln = GAME_CONFIG.player.collisionInvulnerability;
        continue;
      }
      if (
        this.state.boss &&
        Math.hypot(this.state.boss.x - player.ship.x, this.state.boss.y - player.ship.y) <
          this.state.boss.radius + GAME_CONFIG.player.shipRadius
      ) {
        this.damagePlayer(
          player,
          GAME_CONFIG.bosses.contactDamage * COOP_CONFIG.difficulty.enemyDamage,
        );
        player.ship.invuln = GAME_CONFIG.player.collisionInvulnerability;
        continue;
      }
      const rock = this.state.rocks.find(
        (candidate) =>
          Math.hypot(candidate.x - player.ship.x, candidate.y - player.ship.y) <
          candidate.radius + GAME_CONFIG.player.shipRadius,
      );
      if (!rock) continue;
      const base = rock.size === 3 ? 14 : rock.size === 2 ? 9 : 5;
      const trait = rock.trait === "fast" ? GAME_CONFIG.asteroids.traits.fast.damageMultiplier : 1;
      this.damagePlayer(player, base * trait * COOP_CONFIG.difficulty.enemyDamage);
      if (rock.trait === "fast") {
        const distance = Math.hypot(player.ship.x - rock.x, player.ship.y - rock.y) || 1;
        const knockback = 150 * GAME_CONFIG.asteroids.traits.fast.knockbackMultiplier;
        player.ship.vx += ((player.ship.x - rock.x) / distance) * knockback;
        player.ship.vy += ((player.ship.y - rock.y) / distance) * knockback;
      }
      player.ship.invuln = GAME_CONFIG.asteroids.collision.invulnerability;
    }
  }

  private damagePlayer(player: CoopPlayerState, rawDamage: number) {
    if (player.disabled || player.ship.invuln > 0) return;
    const incoming = rawDamage * (1 - player.ship.armor);
    const drone = player.drone;
    const share =
      drone.purchased && drone.active
        ? (GAME_CONFIG.salvage.shieldShares[Math.max(0, drone.upgrades.shield - 1)] ?? 0)
        : 0;
    const redirected = Math.min(drone.hp, incoming * share);
    if (redirected > 0) {
      drone.hp -= redirected;
      if (drone.hp <= 0) drone.active = false;
    }
    player.ship.hull -= incoming - redirected;
    player.supportQuietTimer = GAME_CONFIG.salvage.repairQuietSeconds;
    player.drone.hitTimer = GAME_CONFIG.salvage.repairQuietSeconds;
    this.events.push({
      type: "playerDamaged",
      tick: this.state.tick,
      playerId: player.id,
      amount: incoming - redirected,
    });
    if (player.ship.hull > 0) return;
    player.ship.hull = 0;
    player.disabled = true;
    player.input.fire = false;
    this.events.push({ type: "playerDisabled", tick: this.state.tick, playerId: player.id });
    if (PLAYER_IDS.every((id) => this.state.players[id].disabled)) this.endMatch("defeat");
  }

  private updateRevives(dt: number) {
    for (const targetId of PLAYER_IDS) {
      const target = this.state.players[targetId];
      if (!target.disabled) continue;
      const reviverId = targetId === "p1" ? "p2" : "p1";
      const reviver = this.state.players[reviverId];
      const close =
        Math.hypot(target.ship.x - reviver.ship.x, target.ship.y - reviver.ship.y) <=
        COOP_CONFIG.revive.range;
      if (reviver.disabled || !reviver.input.interact || !close || target.reviveCooldown > 0) {
        target.reviveProgress = 0;
        continue;
      }
      target.reviveProgress += dt;
      if (target.reviveProgress + 1e-9 < COOP_CONFIG.revive.holdSeconds) continue;
      target.disabled = false;
      target.ship.hull = target.ship.maxHull * COOP_CONFIG.revive.healthFraction;
      target.ship.invuln = 1;
      target.reviveProgress = 0;
      target.reviveCooldown = COOP_CONFIG.revive.cooldownSeconds;
      reviver.stats.revives++;
      this.events.push({
        type: "playerRevived",
        tick: this.state.tick,
        playerId: target.id,
        by: reviver.id,
      });
    }
  }

  private damageEnemy(enemy: CoopEnemyState, amount: number, player: CoopPlayerState) {
    const dealt = Math.min(enemy.hp, amount);
    enemy.hp -= amount;
    player.stats.damage += dealt;
    this.chargeOverdrive(dealt);
    if (enemy.hp > 0) return;
    const index = this.state.enemies.findIndex((candidate) => candidate.id === enemy.id);
    if (index < 0) return;
    this.state.enemies.splice(index, 1);
    player.stats.kills++;
    const reward = enemy.kind === "warden" ? 260 : enemy.kind === "spiker" ? 220 : 130;
    this.state.team.score += reward;
    this.gainXp(player, reward * 0.22);
    this.state.pickups.push({
      id: this.nextId(),
      x: enemy.x,
      y: enemy.y,
      vx: randomBetween(this.random, -35, 35),
      vy: randomBetween(this.random, -35, 35),
      kind: "credit",
      value: Math.round(reward * 0.18 * player.ship.creditValue),
      life: GAME_CONFIG.pickups.lifetime,
    });
    this.events.push({
      type: "enemyDestroyed",
      tick: this.state.tick,
      playerId: player.id,
      entityId: enemy.id,
    });
  }

  private damageRock(rock: CoopRockState, amount: number, player: CoopPlayerState) {
    const dealt = Math.min(rock.hp, amount);
    rock.hp -= amount;
    player.stats.damage += dealt;
    this.chargeOverdrive(dealt);
    if (rock.hp <= 0) {
      this.destroyRock(rock, player);
      if (rock.trait === "boom") this.damageBoomArea(rock);
    }
  }

  private destroyRock(rock: CoopRockState, player: CoopPlayerState) {
    const index = this.state.rocks.findIndex((candidate) => candidate.id === rock.id);
    if (index < 0) return;
    this.state.rocks.splice(index, 1);
    player.stats.kills++;
    player.stats.asteroidKills++;
    const base = rock.size === 3 ? 120 : rock.size === 2 ? 70 : 40;
    this.state.team.score += Math.round(base * (rock.trait === "none" ? 1 : 1.5));
    this.gainXp(
      player,
      (rock.size === 3 ? 32 : rock.size === 2 ? 18 : 11) * (rock.trait === "none" ? 1 : 1.3),
    );
    this.events.push({
      type: "asteroidDestroyed",
      tick: this.state.tick,
      playerId: player.id,
      entityId: rock.id,
    });

    if (
      randomChance(
        this.random,
        player.ship.creditChance + rock.size * GAME_CONFIG.player.creditChancePerRockSize,
      )
    ) {
      const count =
        GAME_CONFIG.pickups.rockDropCount[
          rock.size === 3 ? "large" : rock.size === 2 ? "medium" : "small"
        ];
      const value =
        GAME_CONFIG.pickups.rockCreditValue[
          rock.size === 3 ? "large" : rock.size === 2 ? "medium" : "small"
        ];
      for (let drop = 0; drop < count; drop++) {
        this.state.pickups.push({
          id: this.nextId(),
          x: rock.x,
          y: rock.y,
          vx: randomBetween(this.random, -60, 60),
          vy: randomBetween(this.random, -60, 60),
          kind: randomChance(this.random, GAME_CONFIG.pickups.repairChance) ? "repair" : "credit",
          value: Math.round(value * player.ship.creditValue),
          life: GAME_CONFIG.pickups.lifetime,
        });
      }
    }

    if (rock.size > 1 && !(rock.trait === "boom" && rock.size === 3)) {
      for (let child = 0; child < 2; child++) {
        const angle = this.random.next() * TAU;
        this.state.rocks.push(
          this.makeRock(
            rock.x,
            rock.y,
            (rock.size - 1) as 1 | 2,
            rock.trait,
            Math.cos(angle) * 90 + rock.vx,
            Math.sin(angle) * 90 + rock.vy,
          ),
        );
      }
    }
  }

  private updatePickups(dt: number) {
    for (let index = this.state.pickups.length - 1; index >= 0; index--) {
      const pickup = this.state.pickups[index];
      pickup.x += pickup.vx * dt;
      pickup.y += pickup.vy * dt;
      pickup.vx *= Math.pow(GAME_CONFIG.simulation.pickupDragPerFrame, dt * 60);
      pickup.vy *= Math.pow(GAME_CONFIG.simulation.pickupDragPerFrame, dt * 60);
      pickup.life -= dt;
      const collector = PLAYER_IDS.map((id) => this.state.players[id])
        .filter((player) => !player.disabled)
        .map((player) => ({
          player,
          distance: Math.hypot(player.ship.x - pickup.x, player.ship.y - pickup.y),
        }))
        .sort(
          (left, right) =>
            left.distance - right.distance || left.player.id.localeCompare(right.player.id),
        )[0];
      if (collector && collector.distance < GAME_CONFIG.pickups.pickupDistance) {
        if (pickup.kind === "credit") {
          collector.player.credits += pickup.value;
          collector.player.stats.creditsCollected += pickup.value;
          this.state.team.score += pickup.value * GAME_CONFIG.pickups.playerCreditScoreMultiplier;
        } else {
          collector.player.ship.hull = Math.min(
            collector.player.ship.maxHull,
            collector.player.ship.hull + pickup.value,
          );
        }
        this.state.pickups.splice(index, 1);
        this.events.push({
          type: "pickupCollected",
          tick: this.state.tick,
          playerId: collector.player.id,
          kind: pickup.kind,
        });
      } else if (pickup.life <= 0) {
        this.state.pickups.splice(index, 1);
      }
    }
  }

  private damageBoss(amount: number, player: CoopPlayerState) {
    const boss = this.state.boss;
    if (!boss) return;
    const dealt = Math.min(boss.hp, amount);
    boss.hp -= amount;
    player.stats.damage += dealt;
    player.stats.bossDamage += dealt;
    this.chargeOverdrive(dealt);
    this.events.push({
      type: "bossDamaged",
      tick: this.state.tick,
      playerId: player.id,
      amount: dealt,
    });
    if (boss.hp > 0) return;
    player.stats.kills++;
    this.state.team.bossesDefeated++;
    this.state.team.score += boss.mk === 5 ? 15000 : 2500 * boss.mk;
    this.events.push({
      type: "bossDefeated",
      tick: this.state.tick,
      playerId: player.id,
      mk: boss.mk,
    });
    this.state.boss = null;
    this.state.rocks = [];
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.hostileProjectiles = [];
    this.state.hazards = [];
    if (this.state.team.wave >= RUN_PACING.finalWave) this.endMatch("victory");
  }

  private chargeOverdrive(damage: number) {
    if (this.state.team.overdriveRemaining > 0) return;
    const [first, second] = PLAYER_IDS.map((id) => this.state.players[id]);
    const nearby =
      Math.hypot(first.ship.x - second.ship.x, first.ship.y - second.ship.y) <=
      COOP_CONFIG.overdrive.nearbyRange;
    const multiplier = nearby ? COOP_CONFIG.overdrive.nearbyChargeMultiplier : 1;
    this.state.team.overdrive = Math.min(
      COOP_CONFIG.overdrive.maximum,
      this.state.team.overdrive + damage * COOP_CONFIG.overdrive.damageChargeScale * multiplier,
    );
  }

  private gainXp(player: CoopPlayerState, amount: number) {
    player.xp +=
      amount * (1 + scaledWave(this.state.team.wave) * GAME_CONFIG.progression.xpPerScaledWave);
    while (player.xp >= player.xpNext) {
      player.xp -= player.xpNext;
      player.level++;
      player.upgradePoints++;
      player.xpNext = Math.round(
        GAME_CONFIG.progression.nextLevelXpBase *
          Math.pow(player.level, GAME_CONFIG.progression.nextLevelXpExponent),
      );
    }
  }

  private startNextWave() {
    if (this.state.phase !== "running" || this.state.team.wave >= RUN_PACING.finalWave) return;
    this.state.team.wave++;
    this.state.team.sector = sectorForWave(this.state.team.wave) + 1;
    this.state.projectiles = [];
    this.state.hostileProjectiles = [];
    this.state.hazards = [];
    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      player.credits +=
        RUN_PACING.creditsPerWaveBase + this.state.team.wave * RUN_PACING.creditsPerWaveStep;
      player.ship.missiles = Math.min(player.ship.maxMissiles, player.ship.missiles + 1);
    }

    if (isBossWave(this.state.team.wave)) {
      this.state.boss = this.makeBoss(this.state.team.wave);
      this.spawnEnemy("sentinel");
      this.spawnEnemy("sentinel");
      if (this.state.team.wave >= 20) this.spawnEnemy("warden");
      if (this.state.team.wave >= GAME_CONFIG.enemies.spikers.unlockWave) this.spawnEnemy("spiker");
      this.state.rocks.push(
        this.makeRock(
          randomBetween(this.random, 80, this.width - 80),
          randomBetween(this.random, 80, this.height * 0.4),
          2,
          BOSS_SPECS[bossMkForWave(this.state.team.wave)].trait,
        ),
      );
    } else {
      const tuningWave = scaledWave(this.state.team.wave);
      const base = Math.min(
        GAME_CONFIG.waves.regularRockCountCap,
        GAME_CONFIG.waves.regularRockBaseCount +
          Math.ceil(tuningWave * GAME_CONFIG.waves.regularRockCountScale),
      );
      const count = Math.min(
        GAME_CONFIG.waves.regularRockCountCap,
        Math.ceil(base * COOP_CONFIG.difficulty.enemyPressure),
      );
      for (let index = 0; index < count; index++) {
        const size = randomChance(this.random, 0.45) ? 3 : 2;
        this.state.rocks.push(
          this.makeRock(
            randomBetween(this.random, 50, this.width - 50),
            randomBetween(this.random, 50, this.height * 0.45),
            size,
            this.rollTrait(),
          ),
        );
      }
      const sentinels = Math.min(
        maxSentinels(this.state.team.wave),
        sentinelWaveCount(this.state.team.wave),
      );
      for (let index = 0; index < sentinels; index++) this.spawnEnemy("sentinel");
      if (
        this.state.team.wave >= RUN_PACING.lateWardenFromWave &&
        this.state.team.wave <= RUN_PACING.lateWardenToWave &&
        randomChance(this.random, 0.55)
      )
        this.spawnEnemy("warden");
      if (this.state.team.wave >= GAME_CONFIG.enemies.spikers.unlockWave) {
        this.spawnEnemy("spiker");
        if (
          this.state.team.wave >= GAME_CONFIG.enemies.spikers.latePairFromWave &&
          this.state.team.wave <= GAME_CONFIG.enemies.spikers.latePairToWave &&
          randomChance(this.random, GAME_CONFIG.enemies.spikers.secondSpawnChance)
        )
          this.spawnEnemy("spiker");
      }
    }
    this.events.push({
      type: "waveStarted",
      tick: this.state.tick,
      wave: this.state.team.wave,
      sector: this.state.team.sector,
    });
  }

  private makeBoss(wave: number): CoopBossState {
    const mk = bossMkForWave(wave);
    let hp =
      (GAME_CONFIG.bosses.waveBaseHp + scaledWave(wave) * GAME_CONFIG.bosses.hpPerScaledWave) *
      BOSS_SPECS[mk].hpMul;
    if (mk <= 2) hp = Math.min(hp, EARLY_BOSS_HP_CEILING);
    if (mk === 3) hp = GAME_CONFIG.bosses.mk3Hp;
    if (mk === 4) hp = GAME_CONFIG.bosses.mk4Hp;
    if (mk === 5) hp = GAME_CONFIG.bosses.finalHp;
    hp *= COOP_CONFIG.difficulty.bossHealth;
    return {
      id: this.nextId(),
      mk,
      x: this.width / 2,
      y: this.height * 0.28,
      radius: mk === 5 ? GAME_CONFIG.bosses.finalRadius : GAME_CONFIG.bosses.baseRadius,
      hp,
      maxHp: hp,
      vx: 0,
      vy: 0,
      phase: 1,
      attackTimer: GAME_CONFIG.bosses.baseAttackTimer,
      abilityTimer: GAME_CONFIG.bosses.baseAttackTimer * 2,
    };
  }

  private spawnEnemy(kind: CoopEnemyKind) {
    const wave = this.state.team.wave;
    const tuningWave = scaledWave(wave);
    let hp: number;
    let radius: number;
    let fireTimer: number;
    if (kind === "spiker") {
      hp = GAME_CONFIG.enemies.spikers.hpBase + wave * GAME_CONFIG.enemies.spikers.hpPerWave;
      radius = GAME_CONFIG.enemies.spikers.radius;
      fireTimer = GAME_CONFIG.enemies.spikers.fireInterval;
    } else if (kind === "warden" || kind === "wardenTurret") {
      hp =
        kind === "wardenTurret"
          ? GAME_CONFIG.enemies.wardens.turretHp
          : GAME_CONFIG.enemies.wardens.ordinaryHpBase +
            tuningWave * GAME_CONFIG.enemies.wardens.ordinaryHpPerWave;
      radius = kind === "wardenTurret" ? 16 : GAME_CONFIG.enemies.wardens.radius;
      fireTimer = randomBetween(
        this.random,
        GAME_CONFIG.enemies.wardens.shotDelayMin,
        GAME_CONFIG.enemies.wardens.shotDelayMax,
      );
    } else {
      hp =
        GAME_CONFIG.enemies.sentinels.hpBase + tuningWave * GAME_CONFIG.enemies.sentinels.hpPerWave;
      radius = GAME_CONFIG.enemies.sentinels.radius;
      fireTimer = randomBetween(
        this.random,
        GAME_CONFIG.enemies.sentinels.fireIntervalMin,
        GAME_CONFIG.enemies.sentinels.fireIntervalMax,
      );
    }
    const angle = this.random.next() * TAU;
    const speed =
      kind === "spiker"
        ? randomBetween(
            this.random,
            GAME_CONFIG.enemies.spikers.speedMin,
            GAME_CONFIG.enemies.spikers.speedMax,
          )
        : 0;
    const enemy: CoopEnemyState = {
      id: this.nextId(),
      kind,
      x: randomBetween(this.random, radius + 20, this.width - radius - 20),
      y: randomBetween(this.random, radius + 20, this.height * 0.42),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      radius,
      hp,
      maxHp: hp,
      fireTimer,
      behaviorTimer: randomBetween(this.random, 1.5, 3.5),
      warningTimer: 0,
      burst: 0,
      targetPlayerId: null,
      aimX: 0,
      aimY: 0,
    };
    this.state.enemies.push(enemy);
    this.events.push({ type: "enemySpawned", tick: this.state.tick, entityId: enemy.id, kind });
    return enemy;
  }

  private makeRock(
    x: number,
    y: number,
    size: 1 | 2 | 3,
    trait: RockTrait,
    vx = randomBetween(this.random, -70, 70),
    vy = randomBetween(this.random, -70, 70),
  ): CoopRockState {
    const sizeName = size === 3 ? "large" : size === 2 ? "medium" : "small";
    const tuning = GAME_CONFIG.asteroids.sizes[sizeName];
    const radius =
      tuning.radius *
      randomBetween(
        this.random,
        GAME_CONFIG.asteroids.radiusRandomMin,
        GAME_CONFIG.asteroids.radiusRandomMax,
      );
    const hp =
      tuning.hp *
      (1 + scaledWave(this.state.team.wave) * GAME_CONFIG.asteroids.hpPerScaledWave) *
      (trait === "fast"
        ? GAME_CONFIG.asteroids.traits.fast.hpMultiplier
        : trait === "none"
          ? 1
          : GAME_CONFIG.asteroids.specialHpMultiplier);
    if (trait === "fast") {
      const speed = GAME_CONFIG.asteroids.traits.fast.speeds[sizeName];
      const angle = Math.atan2(vy, vx) + randomBetween(this.random, -0.2, 0.2);
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    } else if (trait === "boom" || trait === "bounce") {
      const speed =
        trait === "boom"
          ? GAME_CONFIG.asteroids.traits.boom.speeds[sizeName]
          : GAME_CONFIG.asteroids.traits.bounce.speeds[sizeName];
      const angle = Math.atan2(vy, vx);
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    }
    return { id: this.nextId(), x, y, vx, vy, radius, size, hp, maxHp: hp, trait, fuse: -1 };
  }

  private rollTrait(): RockTrait {
    const wave = this.state.team.wave;
    if (wave < RUN_PACING.traitWaves.homing) return "none";
    const pool: RockTrait[] = ["homing"];
    if (wave >= RUN_PACING.traitWaves.bounce) pool.push("bounce");
    if (
      wave >= RUN_PACING.traitWaves.boom &&
      this.state.rocks.filter((rock) => rock.trait === "boom").length <
        GAME_CONFIG.asteroids.traits.boom.maxAlive
    )
      pool.push("boom");
    if (wave >= RUN_PACING.traitWaves.fast) pool.push("fast");
    const chance = Math.min(0.95, 0.15 + (wave - 1) * 0.04);
    if (!randomChance(this.random, chance)) return "none";
    return randomChance(this.random, 0.4)
      ? pool[pool.length - 1]
      : pool[randomInteger(this.random, 0, pool.length - 1)];
  }

  private nearestPlayer(x: number, y: number) {
    return PLAYER_IDS.map((id) => this.state.players[id])
      .filter((player) => !player.disabled)
      .map((player) => ({ player, distance: Math.hypot(player.ship.x - x, player.ship.y - y) }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.player.id.localeCompare(right.player.id),
      )[0]?.player;
  }

  private nearestTarget(x: number, y: number) {
    const targets = [
      ...this.state.enemies.map((entity) => ({ entity, type: "enemy" as const })),
      ...this.state.rocks.map((entity) => ({ entity, type: "rock" as const })),
      ...(this.state.boss ? [{ entity: this.state.boss, type: "boss" as const }] : []),
    ];
    return targets
      .map((target) => ({
        ...target,
        distance: Math.hypot(target.entity.x - x, target.entity.y - y),
      }))
      .sort((left, right) => left.distance - right.distance || left.entity.id - right.entity.id)[0];
  }

  private nextId() {
    return this.state.nextEntityId++;
  }

  private endMatch(outcome: "victory" | "defeat") {
    this.state.phase = outcome;
    this.events.push({ type: "matchEnded", tick: this.state.tick, outcome });
  }
}

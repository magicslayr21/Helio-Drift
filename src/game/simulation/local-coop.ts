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
import { bossMkForWave, isBossWave, RUN_PACING, scaledWave, sectorForWave } from "./campaign";
import { COOP_CONFIG, COOP_FIXED_DT } from "./coop-config";
import type {
  CoopBossState,
  CoopCommand,
  CoopEvent,
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
      projectiles: [],
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
      lastInputSequence: -1,
      input: { moveX: 0, moveY: 0, aimAngle: ship.angle, fire: false, interact: false },
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
      command.sequence <= player.lastInputSequence
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
        "buyDrone",
        "buyDroneUpgrade",
        "chooseUpgrade",
        "activateOverdrive",
      ].includes(command.type)
    )
      return false;
    player.lastInputSequence = command.sequence;
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
      if (player.disabled) continue;
      stepPlayerMovement(player.ship, player.input, dt, { width: this.width, height: this.height });
      player.ship.fireTimer -= dt;
      if (player.input.fire && player.ship.fireTimer <= 0) this.fire(player);
      this.updateDrone(player, dt);
    }

    this.updateRocks(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updatePlayerCollisions();
    this.updateRevives(dt);
    if (this.state.phase !== "running") return;

    if (!this.state.boss && this.state.rocks.length === 0) this.startNextWave();
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
            interact: command.interact,
          };
          break;
        case "buyWeapon":
          this.buyWeapon(player, command.weapon);
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
      });
    }
    this.events.push({ type: "weaponFired", tick: this.state.tick, playerId: player.id, weapon });
  }

  private updateDrone(player: CoopPlayerState, dt: number) {
    const drone = player.drone;
    if (!drone.purchased || !drone.active) return;
    const targetX = player.ship.x + (player.id === "p1" ? -34 : 34);
    const targetY = player.ship.y + 24;
    drone.x += (targetX - drone.x) * Math.min(1, dt * 5);
    drone.y += (targetY - drone.y) * Math.min(1, dt * 5);
    drone.fireTimer -= dt;
    const rock = this.nearestRock(drone.x, drone.y);
    if (!rock || drone.fireTimer > 0) return;
    const damage =
      GAME_CONFIG.salvage.baseShotDamage +
      drone.upgrades.overcharge * GAME_CONFIG.salvage.overchargeDamagePerLevel;
    this.damageRock(rock, damage, player);
    drone.fireTimer = Math.max(
      GAME_CONFIG.salvage.minFireInterval,
      GAME_CONFIG.salvage.starterFireInterval -
        drone.upgrades.overcharge * GAME_CONFIG.salvage.overchargeFireReduction -
        drone.upgrades.twinCannons * GAME_CONFIG.salvage.twinCadenceReduction,
    );
  }

  private updateProjectiles(dt: number) {
    for (let index = this.state.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.state.projectiles[index];
      projectile.life -= dt;
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
      if (!consumed && this.state.boss && !projectile.hitIds.includes(this.state.boss.id)) {
        if (
          Math.hypot(projectile.x - this.state.boss.x, projectile.y - this.state.boss.y) <=
          projectile.radius + this.state.boss.radius
        ) {
          projectile.hitIds.push(this.state.boss.id);
          this.damageBoss(projectile.damage, this.state.players[projectile.ownerId]);
          consumed = projectile.pierce-- <= 0;
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
          consumed = projectile.pierce-- <= 0;
          if (consumed) break;
        }
      }
      if (consumed) this.state.projectiles.splice(index, 1);
    }
  }

  private guideProjectile(projectile: CoopProjectileState, dt: number) {
    const target = this.state.boss ?? this.nearestRock(projectile.x, projectile.y);
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

  private updateRocks(dt: number) {
    for (const rock of this.state.rocks) {
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      const margin = rock.radius;
      if (rock.x < -margin) rock.x += this.width + margin * 2;
      if (rock.x > this.width + margin) rock.x -= this.width + margin * 2;
      if (rock.y < -margin) rock.y += this.height + margin * 2;
      if (rock.y > this.height + margin) rock.y -= this.height + margin * 2;
    }
  }

  private updatePlayerCollisions() {
    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      if (player.disabled || player.ship.invuln > 0) continue;
      const rock = this.state.rocks.find(
        (candidate) =>
          Math.hypot(candidate.x - player.ship.x, candidate.y - player.ship.y) <
          candidate.radius + GAME_CONFIG.player.shipRadius,
      );
      if (!rock) continue;
      const base = rock.size === 3 ? 14 : rock.size === 2 ? 9 : 5;
      const trait = rock.trait === "fast" ? GAME_CONFIG.asteroids.traits.fast.damageMultiplier : 1;
      this.damagePlayer(player, base * trait * COOP_CONFIG.difficulty.enemyDamage);
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

  private damageRock(rock: CoopRockState, amount: number, player: CoopPlayerState) {
    const dealt = Math.min(rock.hp, amount);
    rock.hp -= amount;
    player.stats.damage += dealt;
    this.chargeOverdrive(dealt);
    if (rock.hp <= 0) this.destroyRock(rock, player);
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
    this.state.projectiles = [];
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
    for (const id of PLAYER_IDS) {
      const player = this.state.players[id];
      player.credits +=
        RUN_PACING.creditsPerWaveBase + this.state.team.wave * RUN_PACING.creditsPerWaveStep;
      player.ship.missiles = Math.min(player.ship.maxMissiles, player.ship.missiles + 1);
    }

    if (isBossWave(this.state.team.wave)) {
      this.state.boss = this.makeBoss(this.state.team.wave);
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
    };
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
    }
    return { id: this.nextId(), x, y, vx, vy, radius, size, hp, maxHp: hp, trait };
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

  private nearestRock(x: number, y: number) {
    let nearest: CoopRockState | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const rock of this.state.rocks) {
      const candidate = Math.hypot(rock.x - x, rock.y - y);
      if (candidate < distance) {
        nearest = rock;
        distance = candidate;
      }
    }
    return nearest;
  }

  private nextId() {
    return this.state.nextEntityId++;
  }

  private endMatch(outcome: "victory" | "defeat") {
    this.state.phase = outcome;
    this.events.push({ type: "matchEnded", tick: this.state.tick, outcome });
  }
}

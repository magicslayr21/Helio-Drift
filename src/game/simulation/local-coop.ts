import { CoopCampaign, PILOTS, freshPilotCampaign, isHostileShot } from "../coop-campaign";
import { captureCampaignWorld, restoreCampaignWorld } from "../campaign-state";
import { freshPlayer, freshSalvageDrone, THEMES, STAT_UPGRADES } from "../balance";
import {
  applyDeveloperCommand,
  validDeveloperCommand,
  type DeveloperCommand,
} from "../developer-command";
import { GAME_CONFIG } from "../game-config";
import { clamp, wrapAngle } from "../math";
import { COOP_CONFIG, COOP_FIXED_DT } from "./coop-config";
import type {
  CoopCommand,
  CoopEvent,
  CoopMatchState,
  CoopPlayerId,
  CoopPlayerState,
} from "./coop-types";
import { FixedStepRunner } from "./fixed-step";
import { SeededRandom } from "./random";

export interface LocalCoopOptions {
  seed: number;
  callsigns?: readonly [string, string];
  width?: number;
  height?: number;
}

/** Room clock and commands around the ORIGINAL campaign, not a second combat engine. */
export class LocalCoopSimulation {
  state: CoopMatchState;
  readonly width: number;
  readonly height: number;
  game: CoopCampaign;
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
        p1: this.makePlayer("p1", options.callsigns?.[0] ?? "Pilot One", 0.36),
        p2: this.makePlayer("p2", options.callsigns?.[1] ?? "Pilot Two", 0.64),
      },
      team: {
        score: 0,
        wave: 0,
        sector: 0,
        bossesDefeated: 0,
        overdrive: 0,
        overdriveRemaining: 0,
        elapsedSeconds: 0,
        directive: null,
        bonusAvailable: false,
        bonusActive: false,
        bonusDefeated: false,
      },
      rocks: [],
      enemies: [],
      projectiles: [],
      hostileProjectiles: [],
      hazards: [],
      tethers: [],
      mines: [],
      pickups: [],
      boss: null,
    };
    this.game = this.createGame();
    this.game.nextWave();
    this.sync();
  }

  private createGame() {
    return new CoopCampaign(
      this.state,
      () => this.random.next(),
      (event) => {
        if (event.type !== "sound" || this.events.filter((e) => e.type === "sound").length < 32)
          this.events.push(event);
      },
      this.width,
      this.height,
    );
  }

  static restore(
    snapshot: CoopMatchState,
    width = snapshot.campaign?.w ?? 1000,
    height = snapshot.campaign?.h ?? 700,
  ) {
    const sim = new LocalCoopSimulation({ seed: snapshot.seed, width, height });
    sim.state = structuredClone(snapshot);
    for (const p of Object.values(sim.state.players)) {
      p.ship.rangeMul ??= 1;
      p.campaign ??= freshPilotCampaign();
      p.input.missile ??= false;
      p.supportQuietTimer ??= 0;
      p.lastCommandSequence ??= -1;
      p.reviveLockout ??= 0;
    }
    sim.game = sim.createGame();
    if (snapshot.campaign) restoreCampaignWorld(sim.game, snapshot.campaign);
    else sim.migrateLegacyWorld(snapshot);
    sim.game.restorePilotContext();
    sim.random.restore(snapshot.randomState);
    sim.runner.restore({ tick: snapshot.tick, accumulator: snapshot.clockAccumulator });
    sim.events = [];
    sim.enforceEntityCaps();
    sim.sync();
    return sim;
  }

  private migrateLegacyWorld(saved: CoopMatchState) {
    const g = this.game;
    g.wave = saved.team.wave;
    g.score = saved.team.score;
    g.themeIdx = Math.max(0, saved.team.sector - 1);
    g.theme = THEMES[g.themeIdx] ?? THEMES[0];
    g.nextId = saved.nextEntityId;
    g.rocks = saved.rocks.map((r) =>
      Object.assign(g.makeRock(r.x, r.y, r.size, undefined, undefined, r.trait), {
        id: r.id,
        hp: r.hp,
        maxHp: r.maxHp,
        r: r.radius,
        vx: r.vx,
        vy: r.vy,
        fuse: r.fuse ?? -1,
      }),
    );
    g.drones = [];
    for (const d of saved.enemies ?? []) {
      g.drones.push(
        g.spawnDrone(
          d.x,
          d.y,
          d.maxHp,
          d.kind === "warden" || d.kind === "mineWarden"
            ? "warden"
            : d.kind === "spiker" || d.kind === "riftSpiker"
              ? "spiker"
              : "sentinel",
        ),
      );
      Object.assign(g.drones[g.drones.length - 1], {
        id: d.id,
        hp: d.hp,
        maxHp: d.maxHp,
        vx: d.vx,
        vy: d.vy,
        angle: d.angle,
      });
      if (d.kind === "tetherSentinel" || d.kind === "mineWarden" || d.kind === "riftSpiker")
        g.drones[g.drones.length - 1].coop = {
          kind: d.kind,
          timer: d.fireTimer,
          warning: d.warningTimer,
          target: d.targetPlayerId,
        };
    }
    if (saved.boss) {
      g.boss = g.makeBoss(saved.boss.mk === 5, saved.boss.mk);
      Object.assign(g.boss, {
        id: saved.boss.id,
        x: saved.boss.x,
        y: saved.boss.y,
        hp: saved.boss.hp,
        maxHp: saved.boss.maxHp,
      });
      if (g.boss.mk6 && g.boss.hp < g.boss.maxHp * 0.5) g.boss.movement.mk6RaidDone = true;
    }
    g.pickups = saved.pickups.map((p) => ({ ...p, pulse: 0 }));
    g.bullets = (saved.projectiles ?? []).map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      weapon: b.weapon,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      r: b.radius,
      dmg: b.damage,
      life: b.life,
      pierce: b.pierce,
      bounces: b.bounces,
      turn: b.homing,
      hitIds: new Set(b.hitIds),
      color: "#ffe0a3",
      fuse: b.fuse ?? 0,
      extra: b.extra ?? 0,
      extraDmg: b.extraDamage ?? 0,
      kind:
        b.kind === "missile"
          ? "missile"
          : b.kind === "shrapnel"
            ? "shrap"
            : b.weapon === "rail"
              ? "rail"
              : b.weapon === "seeker"
                ? "seeker"
                : b.weapon === "ricochet"
                  ? "ricochet"
                  : b.weapon === "flak"
                    ? "flak"
                    : "plasma",
    }));
    for (const b of saved.hostileProjectiles ?? []) {
      g.enemyBullet(b.x, b.y, Math.atan2(b.vy, b.vx), Math.hypot(b.vx, b.vy), b.damage, b.radius);
      Object.assign(g.bullets[g.bullets.length - 1], { id: b.id, life: b.life });
    }
    for (const mine of saved.mines ?? []) {
      const r = g.makeRock(mine.x, mine.y, 1, 0, 0, "boom");
      Object.assign(r, {
        id: mine.id,
        r: mine.radius,
        hp: mine.hp,
        maxHp: mine.maxHp,
        coopMine: {
          ownerId: mine.ownerId,
          armTimer: mine.armTimer,
          triggerTimer: mine.triggerTimer,
          life: mine.life,
        },
      });
      g.rocks.push(r);
    }
    for (const hazard of saved.hazards ?? []) {
      if (!g.boss) break;
      if (hazard.kind === "strike")
        g.boss.strikes.push({ x: hazard.x, y: hazard.y, t: hazard.timer, t0: hazard.timer });
      else if (hazard.kind === "shockwave") {
        g.boss.shockT = hazard.timer;
        g.boss.shockDur = hazard.timer;
        g.boss.shockRadius = hazard.radius;
      } else {
        g.mkHole(g.boss, 200, hazard.timer, hazard.radius);
        if (g.boss.hole) Object.assign(g.boss.hole, { x: hazard.x, y: hazard.y });
      }
    }
    g.bonusAvailable = saved.team.bonusAvailable ?? false;
    g.bonusActive = saved.team.bonusActive ?? false;
    g.bonusDefeated = saved.team.bonusDefeated ?? false;
    for (const id of PILOTS) {
      const points = saved.players[id].upgradePoints;
      g.bindPilot(id);
      for (let i = 0; i < points; i++) {
        const choices = g.rollChoices();
        if (i === 0) g.choices = choices;
        else this.state.players[id].campaign?.queuedChoices.push(choices);
      }
    }
    g.releasePilot();
  }

  private makePlayer(id: CoopPlayerId, callsign: string, fraction: number): CoopPlayerState {
    const ship = freshPlayer();
    ship.x = this.width * fraction;
    ship.y = this.height * 0.72;
    return {
      id,
      callsign: callsign.trim().slice(0, 24) || id,
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
      reviveLockout: 0,
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
      campaign: freshPilotCampaign(),
    };
  }

  submit(command: CoopCommand) {
    const p = this.state.players[command.playerId];
    const bonus = command.type === "startBonusBoss" || command.type === "declineBonusBoss";
    if (
      !p ||
      (bonus && this.state.phase !== "bonusOffer") ||
      (this.state.phase !== "running" && !(this.state.phase === "bonusOffer" && bonus)) ||
      !Number.isSafeInteger(command.sequence) ||
      command.sequence <= (command.type === "input" ? p.lastInputSequence : p.lastCommandSequence)
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
      (command.type === "buyWeapon" || command.type === "selectWeapon") &&
      !Object.prototype.hasOwnProperty.call(p.ship.weapons, command.weapon)
    )
      return false;
    if (
      command.type === "buyDroneUpgrade" &&
      !Object.prototype.hasOwnProperty.call(p.drone.upgrades, command.upgrade)
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
        "startBonusBoss",
        "declineBonusBoss",
        "rerollUpgrades",
      ].includes(command.type)
    )
      return false;
    if (command.type === "input") p.lastInputSequence = command.sequence;
    else p.lastCommandSequence = command.sequence;
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
  /** Loadout transactions can run during a shared pause without advancing combat. */
  pausedCommand(command: CoopCommand) {
    const allowed = (c: CoopCommand) =>
      [
        "buyWeapon",
        "selectWeapon",
        "buyDrone",
        "buyDroneUpgrade",
        "equipDroneWeapon",
        "chooseUpgrade",
        "rerollUpgrades",
      ].includes(c.type);
    if (!allowed(command) || !this.submit(command)) return false;
    const deferred = this.commands.filter((c) => !allowed(c));
    this.commands = this.commands.filter(allowed);
    this.applyCommands();
    this.commands = deferred;
    this.sync();
    return true;
  }
  clearControls() {
    this.commands = this.commands.filter((command) => command.type !== "input");
    for (const p of Object.values(this.state.players)) {
      Object.assign(p.input, { moveX: 0, moveY: 0, fire: false, missile: false, interact: false });
      p.ship.beamOn = false;
      p.ship.thrusting = false;
    }
  }
  /** Invoked only after Worker authorization; reuses campaign console operations. */
  developer(playerId: CoopPlayerId, command: DeveloperCommand) {
    if (!validDeveloperCommand(command) || this.state.phase !== "running") return false;
    if (command.action === "restart") {
      const previous = this.state;
      const fresh = new LocalCoopSimulation({
        seed: previous.seed,
        width: this.width,
        height: this.height,
        callsigns: [previous.players.p1.callsign, previous.players.p2.callsign],
      }).snapshot();
      fresh.tick = previous.tick;
      fresh.clockAccumulator = previous.clockAccumulator;
      for (const id of PILOTS) {
        fresh.players[id].lastInputSequence = previous.players[id].lastInputSequence;
        fresh.players[id].lastCommandSequence = previous.players[id].lastCommandSequence;
      }
      this.state = fresh;
      this.game = this.createGame();
      restoreCampaignWorld(this.game, fresh.campaign!);
      this.game.restorePilotContext();
      this.random.restore(fresh.randomState);
      this.commands = [];
      this.events = [];
      this.sync();
      return true;
    }
    const g = this.game;
    g.bindPilot(playerId);
    applyDeveloperCommand(g, command);
    g.releasePilot();
    this.enforceEntityCaps();
    this.sync();
    return true;
  }
  stepTicks(ticks = 1) {
    for (let i = 0; i < Math.max(0, Math.floor(ticks)); i++) this.advance(COOP_FIXED_DT);
  }
  snapshot(includeLegacy = true): CoopMatchState {
    this.sync();
    const { campaign: _previous, ...state } = this.state;
    if (!includeLegacy)
      Object.assign(state, {
        rocks: [],
        enemies: [],
        projectiles: [],
        hostileProjectiles: [],
        hazards: [],
        mines: [],
        pickups: [],
      });
    return { ...structuredClone(state), campaign: captureCampaignWorld(this.game) };
  }
  drainEvents() {
    const events = this.events;
    this.events = [];
    return structuredClone(events);
  }

  private fixedStep(dt: number, tick: number) {
    this.state.tick = tick;
    this.applyCommands();
    if (this.state.phase !== "running") {
      this.sync();
      return;
    }
    this.state.team.elapsedSeconds += dt;
    this.state.team.overdriveRemaining = Math.max(0, this.state.team.overdriveRemaining - dt);
    for (const p of Object.values(this.state.players)) {
      p.reviveCooldown = Math.max(0, p.reviveCooldown - dt);
      p.reviveLockout = Math.max(0, p.reviveLockout - dt);
    }
    const active = PILOTS.find((id) => !this.state.players[id].disabled);
    if (active) this.game.bindPilot(active);
    // The campaign's original effects/movement run at their usual 60 Hz.
    for (let i = 0; i < 2 && this.state.phase === "running"; i++) {
      this.game.frame++;
      this.game.decayShake(dt / 2);
      this.game.timeScale += (1 - this.game.timeScale) * Math.min(1, (dt / 2) * 7);
      this.game.update((dt / 2) * this.game.timeScale);
      if (this.game.mode === "victory")
        this.state.phase = this.game.bonusAvailable ? "bonusOffer" : "victory";
    }
    this.game.releasePilot();
    this.updateRevives(dt);
    this.enforceEntityCaps();
    this.sync();
  }

  private applyCommands() {
    const commands = this.commands;
    this.commands = [];
    for (const c of commands) {
      const p = this.state.players[c.playerId],
        g = this.game;
      if (c.type === "input") {
        p.input = {
          moveX: c.moveX,
          moveY: c.moveY,
          aimAngle: c.aimAngle,
          aimTurnMultiplier: 3.2,
          fire: c.fire,
          missile: c.missile,
          interact: c.interact,
        };
        continue;
      }
      if (p.disabled && c.type !== "startBonusBoss" && c.type !== "declineBonusBoss") continue;
      g.bindPilot(p.id);
      const before = g.credits;
      let accepted = false;
      let item: string = c.type;
      switch (c.type) {
        case "buyWeapon":
          item = c.weapon;
          accepted = g.buyWeapon(c.weapon);
          break;
        case "selectWeapon":
          item = c.weapon;
          accepted = p.ship.weapons[c.weapon] > 0;
          if (accepted) g.selectWeapon(c.weapon);
          break;
        case "buyDrone":
          accepted = g.buySalvageDrone();
          break;
        case "buyDroneUpgrade":
          item = c.upgrade;
          accepted = g.buySalvageUpgrade(c.upgrade);
          break;
        case "equipDroneWeapon":
          accepted = g.equipSalvageWeapon(c.weapon);
          break;
        case "chooseUpgrade":
          item = c.upgrade;
          accepted =
            g.choices.some((card) => card.id === c.upgrade) &&
            (p.upgrades[c.upgrade] ?? 0) <
              (STAT_UPGRADES.find((u) => u.id === c.upgrade)?.max ?? 0);
          if (accepted) {
            g.chooseUpgrade(c.upgrade);
            const next = p.campaign!.queuedChoices.shift();
            g.choices = next ? g.rollChoices() : [];
            g.rerollCost = GAME_CONFIG.progression.levelUpRerollStartingCost;
          }
          break;
        case "rerollUpgrades":
          accepted = g.choices.length > 0 && g.rerollChoices() !== null;
          break;
        case "activateOverdrive":
          if (
            this.state.team.overdrive >= COOP_CONFIG.overdrive.maximum &&
            this.state.team.overdriveRemaining <= 0
          ) {
            this.state.team.overdrive = 0;
            this.state.team.overdriveRemaining = COOP_CONFIG.overdrive.durationSeconds;
            this.events.push({ type: "overdriveActivated", tick: this.state.tick, playerId: p.id });
            accepted = true;
          }
          break;
        case "startBonusBoss":
          if (this.state.phase === "bonusOffer" && g.bonusAvailable) {
            g.startBonusBoss();
            this.state.phase = "running";
            for (const id of PILOTS) {
              const pilot = this.state.players[id];
              pilot.disabled = false;
              pilot.ship.hull = pilot.ship.maxHull;
              pilot.ship.missiles = pilot.ship.maxMissiles;
            }
            this.events.push({ type: "bonusBossStarted", tick: this.state.tick, playerId: p.id });
            accepted = true;
          }
          break;
        case "declineBonusBoss":
          if (this.state.phase === "bonusOffer") {
            this.state.phase = "victory";
            g.bonusAvailable = false;
            accepted = true;
          }
          break;
      }
      this.events.push(
        accepted
          ? {
              type: "purchaseAccepted",
              tick: this.state.tick,
              playerId: p.id,
              item,
              cost: before - g.credits,
            }
          : { type: "purchaseRejected", tick: this.state.tick, playerId: p.id, item },
      );
      g.releasePilot();
    }
  }

  private enforceEntityCaps() {
    const g = this.game,
      caps = COOP_CONFIG.entityCaps;
    g.rocks.length = Math.min(g.rocks.length, caps.rocks);
    g.drones.length = Math.min(g.drones.length, caps.enemies);
    let friendly = 0,
      hostile = 0;
    g.bullets = g.bullets.filter((b) =>
      isHostileShot(b) ? ++hostile <= caps.hostileProjectiles : ++friendly <= caps.projectiles,
    );
    g.pickups.length = Math.min(g.pickups.length, caps.pickups);
    g.particles.length = Math.min(g.particles.length, 180);
    this.state.tethers.length = Math.min(this.state.tethers.length, caps.tethers);
  }

  private sync() {
    const g = this.game,
      s = this.state;
    g.releasePilot();
    for (const p of g.pickups) p.id ??= g.nextId++;
    s.randomState = this.random.snapshot();
    s.nextEntityId = g.nextId;
    Object.assign(s.team, {
      score: g.score,
      wave: g.wave,
      sector: g.themeIdx + 1,
      bonusAvailable: g.bonusAvailable,
      bonusActive: g.bonusActive,
      bonusDefeated: g.bonusDefeated,
    });
    s.rocks = g.rocks.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      vx: r.vx,
      vy: r.vy,
      radius: r.r,
      size: r.size,
      hp: r.hp,
      maxHp: r.maxHp,
      trait: r.trait,
      fuse: r.fuse ?? -1,
    }));
    s.enemies = g.drones.map((d) => ({
      id: d.id,
      kind: d.coop?.kind ?? d.kind,
      x: d.x,
      y: d.y,
      vx: d.vx,
      vy: d.vy,
      angle: d.angle,
      radius: d.r,
      hp: d.hp,
      maxHp: d.maxHp,
      fireTimer: d.fire,
      behaviorTimer: 0,
      warningTimer: d.pulseCharge ?? 0,
      burst: 0,
      targetPlayerId: null,
      aimX: d.sniperAimX ?? d.x,
      aimY: d.sniperAimY ?? d.y,
    }));
    s.projectiles = g.bullets
      .filter((b) => !isHostileShot(b))
      .map((b) => ({
        id: b.id!,
        ownerId: b.ownerId ?? "p1",
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        radius: b.r,
        damage: b.dmg,
        life: b.life,
        pierce: b.pierce,
        bounces: b.bounces,
        homing: b.turn,
        hitIds: [...b.hitIds],
        weapon: b.weapon ?? "pulse",
        kind: b.kind === "missile" ? "missile" : "shot",
        fuse: b.fuse ?? 0,
        blastRadius: b.blast ?? 0,
        blastDamage: b.dmg,
        extra: b.extra ?? 0,
        extraDamage: b.extraDmg ?? 0,
      }));
    s.hostileProjectiles = g.bullets.filter(isHostileShot).map((b) => ({
      id: b.id!,
      sourceId: 0,
      source: "boss",
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      radius: b.r,
      damage: b.dmg,
      life: b.life,
      hitPlayerIds: [],
    }));
    s.pickups = g.pickups.map((p) => ({ ...p, id: p.id! }));
    s.hazards = [];
    s.mines = g.rocks
      .filter((r) => r.coopMine)
      .map((r) => ({
        id: r.id,
        ownerId: r.coopMine!.ownerId,
        x: r.x,
        y: r.y,
        radius: r.r,
        hp: r.hp,
        maxHp: r.maxHp,
        armTimer: r.coopMine!.armTimer,
        triggerTimer: r.coopMine!.triggerTimer,
        blastRadius: COOP_CONFIG.mineWarden.mineBlastRadius,
        damage: COOP_CONFIG.mineWarden.mineDamage,
        life: r.coopMine!.life,
      }));
    s.boss = g.boss
      ? {
          id: g.boss.id,
          mk: g.boss.mk,
          x: g.boss.x,
          y: g.boss.y,
          radius: g.boss.r,
          hp: g.boss.hp,
          maxHp: g.boss.maxHp,
          vx: g.boss.vx,
          vy: g.boss.vy,
          phase: g.boss.phase as 1 | 2 | 3,
          attackTimer: g.boss.attackTimer,
          abilityTimer: g.boss.attackTimer,
        }
      : null;
  }

  private updateRevives(dt: number) {
    for (const id of PILOTS) {
      const target = this.state.players[id],
        reviver = this.state.players[id === "p1" ? "p2" : "p1"];
      if (!target.disabled) continue;
      const close =
        Math.hypot(target.ship.x - reviver.ship.x, target.ship.y - reviver.ship.y) <=
        COOP_CONFIG.revive.range;
      if (
        reviver.disabled ||
        reviver.reviveLockout > 0 ||
        !reviver.input.interact ||
        !close ||
        target.reviveCooldown > 0
      ) {
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
}

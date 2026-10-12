import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});

const { COOP_CONFIG, COOP_FIXED_DT } = await import("../src/game/simulation/coop-config.ts");
const { FixedStepRunner } = await import("../src/game/simulation/fixed-step.ts");
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");
const { createWireState } = await import("../src/game/network/wire-state.ts");

const input = (playerId, sequence, values = {}) => ({
  type: "input",
  playerId,
  sequence,
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  fire: false,
  interact: false,
  ...values,
});

function stationaryRock(simulation, overrides = {}) {
  return {
    id: simulation.state.nextEntityId++,
    x: 170,
    y: 350,
    vx: 0,
    vy: 0,
    radius: 18,
    size: 1,
    hp: 10,
    maxHp: 10,
    trait: "none",
    fuse: -1,
    ...overrides,
  };
}

function combatFixture(seed = 41) {
  const simulation = new LocalCoopSimulation({ seed, callsigns: ["Alpha", "Bravo"] });
  simulation.drainEvents();
  simulation.state.rocks = [];
  simulation.state.projectiles = [];
  simulation.state.pickups = [];
  simulation.state.boss = null;
  const first = simulation.state.players.p1;
  const second = simulation.state.players.p2;
  first.ship.x = 100;
  first.ship.y = 350;
  first.ship.angle = 0;
  first.ship.vx = first.ship.vy = 0;
  second.ship.x = 800;
  second.ship.y = 500;
  second.ship.vx = second.ship.vy = 0;
  return simulation;
}

test("fixed-step runner advances at 30 Hz independent of render chunking", () => {
  const whole = new FixedStepRunner();
  const fragmented = new FixedStepRunner();
  let wholeSteps = 0;
  let fragmentedSteps = 0;
  whole.advance(1, () => wholeSteps++);
  for (let frame = 0; frame < 60; frame++) fragmented.advance(1 / 60, () => fragmentedSteps++);
  // A single call is deliberately capped to avoid a spiral of death.
  assert.equal(wholeSteps, Math.floor(COOP_CONFIG.maximumCatchUpSeconds * COOP_CONFIG.tickRate));
  assert.equal(fragmentedSteps, 30);
  assert.equal(fragmented.snapshot().tick, 30);
});

test("two players move independently and reject stale or malformed inputs", () => {
  const simulation = combatFixture();
  const firstStart = simulation.state.players.p1.ship.y;
  const secondStart = simulation.state.players.p2.ship.x;
  assert.equal(simulation.submit(input("p1", 1, { moveY: -1, aimAngle: -Math.PI / 2 })), true);
  assert.equal(simulation.submit(input("p2", 1, { moveX: 1, aimAngle: 0 })), true);
  assert.equal(simulation.submit(input("p1", 1, { moveY: 1 })), false);
  assert.equal(simulation.submit(input("p1", 2, { moveX: Number.NaN })), false);
  assert.equal(simulation.submit(input("p1", 2, { moveY: -1, aimAngle: -Math.PI / 2 })), true);
  simulation.stepTicks(30);
  assert.ok(simulation.state.players.p1.ship.y < firstStart);
  assert.ok(simulation.state.players.p2.ship.x > secondStart);
  assert.equal(simulation.state.players.p1.credits, simulation.state.players.p2.credits);
});

test("seeded command replay and snapshot restoration are deterministic", () => {
  const first = new LocalCoopSimulation({ seed: 0xdecafbad });
  const second = new LocalCoopSimulation({ seed: 0xdecafbad });
  for (const simulation of [first, second]) {
    simulation.submit(input("p1", 1, { moveX: 1, moveY: -1, aimAngle: -0.5, fire: true }));
    simulation.submit(input("p2", 1, { moveX: -1, aimAngle: 2.8, fire: true }));
  }
  for (let frame = 0; frame < 120; frame++) first.advance(1 / 60);
  second.stepTicks(60);
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(first.drainEvents(), second.drainEvents());

  const restored = LocalCoopSimulation.restore(first.snapshot());
  first.submit(input("p1", 2, { moveY: 1, aimAngle: 1.2 }));
  restored.submit(input("p1", 2, { moveY: 1, aimAngle: 1.2 }));
  first.stepTicks(45);
  restored.stepTicks(45);
  assert.deepEqual(restored.snapshot(), first.snapshot());
});

test("combat attributes damage and kills to the authoritative projectile owner", () => {
  const simulation = combatFixture();
  simulation.state.rocks.push(stationaryRock(simulation, { hp: 5, maxHp: 5 }));
  simulation.submit(input("p1", 1, { fire: true }));
  simulation.stepTicks(5);
  const destroyed = simulation.drainEvents().find((event) => event.type === "asteroidDestroyed");
  assert.equal(destroyed?.playerId, "p1");
  assert.equal(simulation.state.players.p1.stats.asteroidKills, 1);
  assert.ok(simulation.state.players.p1.stats.damage >= 5);
  assert.equal(simulation.state.players.p2.stats.damage, 0);
  assert.ok(simulation.state.team.score >= 40);
});

test("large asteroids split deterministically while large boom asteroids do not", () => {
  const normal = combatFixture(72);
  normal.state.rocks.push(
    stationaryRock(normal, { size: 3, radius: 58, hp: 1, maxHp: 1 }),
    stationaryRock(normal, { x: 900, y: 80, hp: 999, maxHp: 999 }),
  );
  normal.submit(input("p1", 1, { fire: true }));
  normal.stepTicks(5);
  assert.equal(normal.state.rocks.filter((rock) => rock.size === 2).length, 2);

  const boom = combatFixture(72);
  boom.state.rocks.push(
    stationaryRock(boom, { size: 3, radius: 58, hp: 1, maxHp: 1, trait: "boom" }),
    stationaryRock(boom, { x: 900, y: 80, hp: 999, maxHp: 999 }),
  );
  boom.submit(input("p1", 1, { fire: true }));
  boom.stepTicks(5);
  assert.equal(boom.state.rocks.filter((rock) => rock.trait === "boom").length, 0);
});

test("credits, weapons, upgrades and drones remain independently owned", () => {
  const simulation = combatFixture();
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999, maxHp: 999 }));
  const first = simulation.state.players.p1;
  const second = simulation.state.players.p2;
  first.credits = 2000;
  second.credits = 0;
  first.upgradePoints = 1;
  assert.equal(
    simulation.submit({ type: "buyWeapon", playerId: "p1", sequence: 1, weapon: "spread" }),
    true,
  );
  assert.equal(
    simulation.submit({ type: "buyWeapon", playerId: "p2", sequence: 1, weapon: "spread" }),
    true,
  );
  assert.equal(
    simulation.submit({ type: "chooseUpgrade", playerId: "p1", sequence: 2, upgrade: "hollow" }),
    true,
  );
  assert.equal(simulation.submit({ type: "buyDrone", playerId: "p1", sequence: 3 }), true);
  assert.equal(
    simulation.submit({ type: "buyDroneUpgrade", playerId: "p1", sequence: 4, upgrade: "armor" }),
    true,
  );
  simulation.stepTicks();
  assert.equal(first.ship.weapons.spread, 1);
  assert.equal(first.ship.primary, "spread");
  assert.equal(second.ship.weapons.spread, 0);
  assert.equal(first.upgrades.hollow, 1);
  assert.equal(second.upgrades.hollow, undefined);
  assert.equal(first.drone.purchased, true);
  assert.equal(first.drone.upgrades.armor, 1);
  assert.equal(second.drone.purchased, false);
  assert.ok(first.credits < 2000);
  assert.equal(second.credits, 0);
  const events = simulation.drainEvents();
  assert.equal(events.filter((event) => event.type === "purchaseAccepted").length, 4);
  assert.equal(events.filter((event) => event.type === "purchaseRejected").length, 1);
});

test("a nearby teammate revives a disabled player after a three-second hold", () => {
  const simulation = combatFixture();
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999, maxHp: 999 }));
  const first = simulation.state.players.p1;
  const second = simulation.state.players.p2;
  second.disabled = true;
  second.ship.hull = 0;
  second.ship.x = first.ship.x + 40;
  second.ship.y = first.ship.y;
  simulation.submit(input("p1", 1, { interact: true }));
  simulation.stepTicks(Math.ceil(COOP_CONFIG.revive.holdSeconds / COOP_FIXED_DT));
  assert.equal(second.disabled, false);
  assert.equal(second.ship.hull, second.ship.maxHull * COOP_CONFIG.revive.healthFraction);
  assert.equal(first.stats.revives, 1);
  assert.ok(second.reviveCooldown > 0);
});

test("shared Overdrive is server-tracked and can be activated by either player", () => {
  const simulation = combatFixture();
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999, maxHp: 999 }));
  simulation.state.team.overdrive = COOP_CONFIG.overdrive.maximum;
  simulation.submit({ type: "activateOverdrive", playerId: "p2", sequence: 1 });
  simulation.stepTicks();
  assert.equal(simulation.state.team.overdrive, 0);
  assert.ok(simulation.state.team.overdriveRemaining > 0);
  assert.equal(simulation.drainEvents().at(-1)?.type, "overdriveActivated");
});

test("wave 25 offers the scaled MK6 challenge before final victory", () => {
  const simulation = combatFixture();
  simulation.state.team.wave = 24;
  simulation.state.rocks = [];
  simulation.stepTicks();
  assert.equal(simulation.state.team.wave, 25);
  assert.equal(simulation.state.boss?.mk, 5);
  assert.equal(simulation.state.boss?.maxHp, 28000 * COOP_CONFIG.difficulty.bossHealth);
  simulation.state.boss.hp = 1;
  simulation.state.boss.x = 150;
  simulation.state.boss.y = 350;
  simulation.state.players.p1.ship.fireTimer = 0;
  simulation.submit(input("p1", 1, { fire: true }));
  simulation.stepTicks(5);
  assert.equal(simulation.state.phase, "bonusOffer");
  assert.equal(simulation.state.team.bonusAvailable, true);
  assert.equal(simulation.state.team.bossesDefeated, 1);
  assert.equal(simulation.drainEvents().at(-1)?.type, "bonusBossOffered");

  simulation.submit({ type: "startBonusBoss", playerId: "p2", sequence: 1 });
  simulation.stepTicks();
  assert.equal(simulation.state.phase, "running");
  assert.equal(simulation.state.boss?.mk, 6);
  assert.equal(simulation.state.boss?.maxHp, 37000 * COOP_CONFIG.difficulty.bossHealth);
  assert.equal(simulation.state.team.bonusActive, true);
  assert.ok(simulation.state.enemies.some((enemy) => enemy.kind === "tetherSentinel"));
  assert.ok(simulation.state.enemies.some((enemy) => enemy.kind === "mineWarden"));

  simulation.state.enemies = [];
  simulation.state.mines = [];
  simulation.state.boss.hp = 1;
  simulation.state.boss.x = 150;
  simulation.state.boss.y = 350;
  simulation.state.players.p1.ship.fireTimer = 0;
  simulation.submit(input("p1", 2, { fire: true }));
  simulation.stepTicks(5);
  assert.equal(simulation.state.phase, "victory");
  assert.equal(simulation.state.team.bonusDefeated, true);
  assert.equal(simulation.state.team.bossesDefeated, 2);
  assert.equal(simulation.drainEvents().at(-1)?.type, "matchEnded");
});

test("snapshots are JSON-safe and preserve all authoritative fields", () => {
  const simulation = new LocalCoopSimulation({ seed: 1234 });
  simulation.stepTicks(10);
  const snapshot = simulation.snapshot();
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /\[object Set\]/);
  assert.deepEqual(JSON.parse(encoded), snapshot);
  assert.equal(snapshot.players.p1.ship.weapons.pulse, 1);
  assert.equal(snapshot.players.p2.ship.weapons.pulse, 1);
  assert.equal(snapshot.tick, 10);
});

test("enemy AI targets the nearest active player and owns hostile fire", () => {
  const simulation = combatFixture(991);
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  simulation.state.players.p1.ship.x = 80;
  simulation.state.players.p2.ship.x = 700;
  simulation.state.players.p2.ship.y = 300;
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "sentinel",
    x: 650,
    y: 300,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 21,
    hp: 100,
    maxHp: 100,
    fireTimer: 0,
    behaviorTimer: 1,
    warningTimer: 0,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  });
  simulation.stepTicks();
  assert.equal(simulation.state.enemies[0].targetPlayerId, "p2");
  assert.equal(simulation.state.hostileProjectiles.length, 1);
  assert.equal(simulation.state.hostileProjectiles[0].source, "sentinel");
});

test("late Spikers create one authoritative eight-way radial volley", () => {
  const simulation = combatFixture(992);
  simulation.state.team.wave = 20;
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "spiker",
    x: 500,
    y: 250,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 31,
    hp: 100,
    maxHp: 100,
    fireTimer: 2,
    behaviorTimer: 2,
    warningTimer: 0.001,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  });
  simulation.stepTicks();
  assert.equal(simulation.state.hostileProjectiles.length, 8);
  assert.equal(
    new Set(
      simulation.state.hostileProjectiles.map(
        (shot) => `${Math.sign(shot.vx)},${Math.sign(shot.vy)}`,
      ),
    ).size >= 4,
    true,
  );
});

test("missiles, enemy damage and rewards are server-owned", () => {
  const simulation = combatFixture(993);
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  const player = simulation.state.players.p1;
  const missiles = player.ship.missiles;
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "sentinel",
    x: 170,
    y: 350,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 21,
    hp: 20,
    maxHp: 20,
    fireTimer: 99,
    behaviorTimer: 99,
    warningTimer: 0,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  });
  simulation.submit(input("p1", 1, { missile: true }));
  simulation.stepTicks(20);
  assert.equal(player.ship.missiles, missiles - 1);
  assert.equal(simulation.state.enemies.length, 0);
  assert.equal(player.stats.kills, 1);
  assert.ok(simulation.drainEvents().some((event) => event.type === "missileFired"));
});

test("boss phases, hazards and battlefield cleanup stay authoritative", () => {
  const simulation = combatFixture(994);
  simulation.state.team.wave = 25;
  simulation.state.boss = {
    id: simulation.state.nextEntityId++,
    mk: 4,
    x: 500,
    y: 180,
    radius: 104,
    hp: 100,
    maxHp: 1000,
    vx: 0,
    vy: 0,
    phase: 1,
    attackTimer: 99,
    abilityTimer: 0,
  };
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "sentinel",
    x: 800,
    y: 200,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 21,
    hp: 100,
    maxHp: 100,
    fireTimer: 99,
    behaviorTimer: 99,
    warningTimer: 0,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  });
  simulation.stepTicks();
  assert.equal(simulation.state.boss.phase, 3);
  assert.equal(simulation.state.hazards[0]?.kind, "strike");
  simulation.state.boss.hp = 1;
  simulation.state.boss.x = 150;
  simulation.state.boss.y = 350;
  simulation.submit(input("p1", 1, { fire: true }));
  simulation.stepTicks(5);
  assert.equal(simulation.state.boss, null);
  assert.equal(simulation.state.enemies.length, 0);
  assert.equal(simulation.state.hostileProjectiles.length, 0);
  assert.equal(simulation.state.hazards.length, 0);
});

test("wire snapshots omit deterministic persistence internals", () => {
  const simulation = new LocalCoopSimulation({ seed: 995 });
  simulation.stepTicks(2);
  const wire = createWireState(simulation.snapshot());
  assert.equal("seed" in wire, false);
  assert.equal("randomState" in wire, false);
  assert.equal("clockAccumulator" in wire, false);
  assert.equal("nextEntityId" in wire, false);
  assert.equal(wire.players.p1.ship.x, simulation.state.players.p1.ship.x);
  assert.ok(Buffer.byteLength(JSON.stringify(wire)) < 65_536);
});

test("mutated asteroids steer, accelerate, bounce and detonate on the server", () => {
  const simulation = combatFixture(996);
  const first = simulation.state.players.p1;
  const second = simulation.state.players.p2;
  first.ship.x = 80;
  first.ship.y = 650;
  second.ship.x = 550;
  second.ship.y = 200;
  const homing = stationaryRock(simulation, {
    x: 500,
    y: 200,
    vx: 0,
    vy: -95,
    trait: "homing",
  });
  const fast = stationaryRock(simulation, {
    x: 800,
    y: 500,
    vx: 1,
    vy: 0,
    trait: "fast",
    hp: 5,
    maxHp: 10,
  });
  const bounce = stationaryRock(simulation, {
    x: 995,
    y: 100,
    vx: 185,
    vy: 0,
    trait: "bounce",
  });
  simulation.state.rocks.push(homing, fast, bounce);
  simulation.stepTicks();
  assert.ok(homing.vx > 0);
  assert.ok(Math.hypot(fast.vx, fast.vy) > 260);
  assert.ok(bounce.vx < 0);

  first.ship.x = 300;
  first.ship.y = 300;
  const before = first.ship.hull;
  simulation.state.rocks.push(
    stationaryRock(simulation, {
      x: 350,
      y: 300,
      vx: 0,
      vy: 0,
      trait: "boom",
      size: 1,
    }),
  );
  simulation.stepTicks(14);
  assert.ok(first.ship.hull < before);
  assert.equal(
    simulation.state.rocks.some((rock) => rock.trait === "boom"),
    false,
  );
});

test("sector directives are seeded, rotate between sectors, and preserve co-op tuning", () => {
  const first = new LocalCoopSimulation({ seed: 4001 });
  const second = new LocalCoopSimulation({ seed: 4001 });
  assert.equal(first.state.team.directive, second.state.team.directive);
  const opening = first.state.team.directive;
  for (const simulation of [first, second]) {
    simulation.state.team.wave = 5;
    simulation.state.rocks = [];
    simulation.state.enemies = [];
    simulation.state.boss = null;
    simulation.stepTicks();
  }
  assert.equal(first.state.team.wave, 6);
  assert.equal(first.state.team.directive, second.state.team.directive);
  assert.notEqual(first.state.team.directive, opening);
  assert.deepEqual(COOP_CONFIG.difficulty, {
    enemyPressure: 1.5,
    bossHealth: 1.2,
    enemyDamage: 1.15,
  });
});

test("Tether Sentinels and Mine Wardens unlock on schedule and escort bosses", () => {
  const waveEight = combatFixture(4002);
  waveEight.state.team.wave = 7;
  waveEight.state.rocks = [];
  waveEight.stepTicks();
  assert.ok(waveEight.state.enemies.some((enemy) => enemy.kind === "tetherSentinel"));
  assert.equal(
    waveEight.state.enemies.some((enemy) => enemy.kind === "mineWarden"),
    false,
  );

  const waveThirteen = combatFixture(4003);
  waveThirteen.state.team.wave = 12;
  waveThirteen.state.rocks = [];
  waveThirteen.stepTicks();
  assert.ok(waveThirteen.state.enemies.some((enemy) => enemy.kind === "mineWarden"));

  const bossWave = combatFixture(4004);
  bossWave.state.team.wave = 14;
  bossWave.state.rocks = [];
  bossWave.stepTicks();
  assert.equal(bossWave.state.boss?.mk, 3);
  assert.ok(bossWave.state.enemies.some((enemy) => enemy.kind === "tetherSentinel"));
  assert.ok(bossWave.state.enemies.some((enemy) => enemy.kind === "mineWarden"));
});

test("Tether Sentinel telegraphs, pulls its target, and breaks beyond its cap", () => {
  const simulation = combatFixture(4005);
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  const player = simulation.state.players.p1;
  player.ship.x = 300;
  player.ship.y = 300;
  simulation.state.players.p2.disabled = true;
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "tetherSentinel",
    x: 600,
    y: 300,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    radius: COOP_CONFIG.tetherSentinel.radius,
    hp: 500,
    maxHp: 500,
    fireTimer: 2,
    behaviorTimer: 2,
    warningTimer: 0.001,
    burst: 0,
    targetPlayerId: "p1",
    aimX: player.ship.x,
    aimY: player.ship.y,
  });
  simulation.stepTicks();
  assert.equal(simulation.state.tethers[0]?.targetPlayerId, "p1");
  const velocity = player.ship.vx;
  simulation.stepTicks();
  assert.ok(player.ship.vx > velocity);
  player.ship.x = 0;
  simulation.state.enemies[0].x = 900;
  simulation.stepTicks();
  assert.equal(simulation.state.tethers.length, 0);
  assert.ok(simulation.drainEvents().some((event) => event.type === "tetherBroken"));
});

test("Mine Wardens deploy capped, telegraphed, destructible mines", () => {
  const simulation = combatFixture(4006);
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  const player = simulation.state.players.p1;
  player.ship.x = 300;
  player.ship.y = 300;
  simulation.state.enemies.push({
    id: simulation.state.nextEntityId++,
    kind: "mineWarden",
    x: 430,
    y: 300,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    radius: COOP_CONFIG.mineWarden.radius,
    hp: 500,
    maxHp: 500,
    fireTimer: 0,
    behaviorTimer: 2,
    warningTimer: 0,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  });
  simulation.stepTicks();
  assert.equal(simulation.state.mines.length, 1);
  assert.ok(simulation.drainEvents().some((event) => event.type === "mineDeployed"));
  const mine = simulation.state.mines[0];
  mine.hp = 1;
  mine.x = 170;
  mine.y = 350;
  player.ship.x = 100;
  player.ship.y = 350;
  player.ship.angle = 0;
  simulation.submit(input("p1", 1, { fire: true }));
  simulation.stepTicks(5);
  assert.equal(simulation.state.mines.length, 0);
  assert.ok(simulation.drainEvents().some((event) => event.type === "mineDestroyed"));

  for (let index = 0; index < COOP_CONFIG.mineWarden.mineCap + 3; index++) {
    simulation.state.enemies[0].fireTimer = 0;
    simulation.stepTicks();
  }
  assert.ok(simulation.state.mines.length <= COOP_CONFIG.mineWarden.mineCap);
});

test("taking damage interrupts an active revive before it can resume", () => {
  const simulation = combatFixture(4007);
  simulation.state.rocks.push(stationaryRock(simulation, { x: 950, y: 50, hp: 999 }));
  const reviver = simulation.state.players.p1;
  const target = simulation.state.players.p2;
  target.disabled = true;
  target.ship.hull = 0;
  target.ship.x = reviver.ship.x + 30;
  target.ship.y = reviver.ship.y;
  simulation.submit(input("p1", 1, { interact: true }));
  simulation.stepTicks(30);
  assert.ok(target.reviveProgress > 0);
  simulation.state.hostileProjectiles.push({
    id: simulation.state.nextEntityId++,
    sourceId: 999,
    source: "boss",
    x: reviver.ship.x,
    y: reviver.ship.y,
    vx: 0,
    vy: 0,
    radius: 8,
    damage: 1,
    life: 1,
    hitPlayerIds: [],
  });
  simulation.stepTicks();
  assert.equal(target.reviveProgress, 0);
  assert.ok(reviver.reviveLockout > 0);
  simulation.stepTicks(Math.floor(COOP_CONFIG.revive.interruptionSeconds * 15));
  assert.equal(target.disabled, true);
});

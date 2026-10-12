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

test("boss waves use co-op health scaling and wave 25 ends in victory", () => {
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
  simulation.submit(input("p1", 1, { fire: true }));
  simulation.stepTicks(5);
  assert.equal(simulation.state.phase, "victory");
  assert.equal(simulation.state.team.bossesDefeated, 1);
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

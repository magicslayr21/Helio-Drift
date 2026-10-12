import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import test from "node:test";
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

const { COOP_CONFIG } = await import("../src/game/simulation/coop-config.ts");
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");
const { createWireState } = await import("../src/game/network/wire-state.ts");

const input = (playerId, sequence, values = {}) => ({
  type: "input",
  playerId,
  sequence,
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  fire: true,
  missile: false,
  interact: false,
  ...values,
});

function targetFor(simulation) {
  return (
    simulation.state.boss ??
    simulation.state.enemies[0] ??
    simulation.state.rocks[0] ??
    simulation.state.mines[0]
  );
}

function keepPilotsEngaged(simulation, sequence, weakened = false) {
  const target = targetFor(simulation);
  for (const id of ["p1", "p2"]) {
    const player = simulation.state.players[id];
    player.disabled = false;
    player.ship.hull = player.ship.maxHull;
    player.ship.invuln = 1;
    if (!target) continue;
    const side = id === "p1" ? -1 : 1;
    player.ship.x = target.x + side * Math.max(75, target.radius + 24);
    player.ship.y = target.y;
    player.ship.vx = 0;
    player.ship.vy = 0;
    const aimAngle = Math.atan2(target.y - player.ship.y, target.x - player.ship.x);
    player.ship.angle = aimAngle;
    simulation.submit(input(id, sequence, { aimAngle }));
  }
  if (weakened && target) target.hp = Math.min(target.hp, 1);
}

function assertCaps(state) {
  for (const [key, maximum] of Object.entries(COOP_CONFIG.entityCaps))
    assert.ok(state[key].length <= maximum, `${key} exceeded ${maximum}`);
}

test("two authoritative pilots traverse all 25 waves and both MK5/MK6 endings", () => {
  const simulation = new LocalCoopSimulation({ seed: 0x8a11ce, callsigns: ["Alpha", "Bravo"] });
  for (const player of Object.values(simulation.state.players)) {
    player.ship.weapons.laser = 1;
    player.ship.primary = "laser";
  }
  const waves = new Set([simulation.state.team.wave]);
  const bosses = new Set();
  let sequence = 0;

  for (let guard = 0; guard < 20_000 && simulation.state.phase === "running"; guard++) {
    if (simulation.state.boss) bosses.add(simulation.state.boss.mk);
    keepPilotsEngaged(simulation, ++sequence, true);
    simulation.stepTicks(8);
    waves.add(simulation.state.team.wave);
    assertCaps(simulation.state);
  }

  assert.equal(
    simulation.state.phase,
    "bonusOffer",
    `stalled at wave ${simulation.state.team.wave} with ${simulation.state.rocks.length} rocks, ${simulation.state.enemies.length} enemies and boss ${simulation.state.boss?.mk ?? "none"}`,
  );
  assert.deepEqual(
    [...waves],
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
  assert.deepEqual([...bosses], [1, 2, 3, 4, 5]);
  assert.equal(
    simulation.submit({ type: "startBonusBoss", playerId: "p2", sequence: ++sequence }),
    true,
  );
  simulation.stepTicks();
  assert.equal(simulation.state.boss?.mk, 6);

  for (let guard = 0; guard < 2_000 && simulation.state.phase === "running"; guard++) {
    keepPilotsEngaged(simulation, ++sequence, true);
    simulation.stepTicks(8);
  }
  assert.equal(simulation.state.phase, "victory");
  assert.equal(simulation.state.team.bonusDefeated, true);

  const declined = LocalCoopSimulation.restore(simulation.snapshot());
  declined.state.phase = "bonusOffer";
  declined.state.team.bonusAvailable = true;
  declined.state.team.bonusActive = false;
  assert.equal(
    declined.submit({ type: "declineBonusBoss", playerId: "p1", sequence: ++sequence }),
    true,
  );
  declined.stepTicks();
  assert.equal(declined.state.phase, "victory");
});

test("simultaneous projectiles can finish a boss without invalidating the update loop", () => {
  const simulation = new LocalCoopSimulation({ seed: 0xb055 });
  simulation.state.team.wave = 5;
  simulation.state.rocks = [];
  simulation.state.enemies = [];
  simulation.state.boss = {
    id: simulation.state.nextEntityId++,
    mk: 1,
    x: 500,
    y: 350,
    radius: 70,
    hp: 1,
    maxHp: 100,
    vx: 0,
    vy: 0,
    phase: 1,
    attackTimer: 999,
    abilityTimer: 999,
  };
  let sequence = 0;
  keepPilotsEngaged(simulation, ++sequence);
  assert.doesNotThrow(() => simulation.stepTicks(10));
  assert.equal(simulation.state.boss, null);
});

test("reference two-pilot campaign pacing remains in the 25–35 minute target", () => {
  const simulation = new LocalCoopSimulation({ seed: 0x25_35, callsigns: ["Pace A", "Pace B"] });
  for (const player of Object.values(simulation.state.players)) {
    // Level-one Beam Emitters provide a stable 135.2 combined DPS reference, close to the
    // stock Pulse pair but without projectile misses making the benchmark machine-dependent.
    player.ship.weapons.laser = 1;
    player.ship.primary = "laser";
  }
  let sequence = 0;
  const maximumTicks = COOP_CONFIG.pacing.targetMinutesMax * 60 * COOP_CONFIG.tickRate;
  for (let tick = 0; tick < maximumTicks && simulation.state.phase === "running"; tick++) {
    const referenceLevel = Math.min(4, 1 + Math.floor((simulation.state.team.wave - 1) / 8));
    for (const player of Object.values(simulation.state.players))
      player.ship.weapons.laser = referenceLevel;
    // A deterministic high-accuracy baseline: two level-one Beam Emitters that gain one level
    // every eight waves, continuous engagement, and no time lost to a test pilot being disabled.
    keepPilotsEngaged(simulation, ++sequence);
    simulation.stepTicks();
  }
  const minutes = simulation.state.team.elapsedSeconds / 60;
  assert.equal(
    simulation.state.phase,
    "bonusOffer",
    `campaign was still running at ${minutes} min (wave ${simulation.state.team.wave}, ${simulation.state.rocks.length} rocks, ${simulation.state.enemies.length} enemies, boss ${simulation.state.boss?.mk ?? "none"})`,
  );
  assert.ok(
    minutes >= COOP_CONFIG.pacing.targetMinutesMin,
    `reference clear was only ${minutes.toFixed(2)} min`,
  );
  assert.ok(
    minutes <= COOP_CONFIG.pacing.targetMinutesMax,
    `reference clear took ${minutes.toFixed(2)} min`,
  );
  console.info(`[coop readiness] reference campaign ${minutes.toFixed(2)} min`);
});

test("a ten-minute two-player soak remains finite and inside every entity ceiling", () => {
  const simulation = new LocalCoopSimulation({ seed: 0x50a8, callsigns: ["Soak A", "Soak B"] });
  let sequence = 0;
  const started = performance.now();
  const ticks = COOP_CONFIG.tickRate * 60 * 10;
  for (let tick = 0; tick < ticks && simulation.state.phase === "running"; tick++) {
    if (tick % COOP_CONFIG.tickRate === 0) {
      keepPilotsEngaged(simulation, ++sequence);
      assertCaps(simulation.state);
    }
    for (const player of Object.values(simulation.state.players)) {
      player.disabled = false;
      player.ship.hull = player.ship.maxHull;
      player.ship.invuln = 1;
    }
    simulation.stepTicks();
  }
  const cpuMs = performance.now() - started;
  const encoded = JSON.stringify(simulation.snapshot());
  assert.doesNotMatch(encoded, /(?:NaN|Infinity)/);
  assert.ok(simulation.state.team.elapsedSeconds >= 599.9);
  assertCaps(simulation.state);
  assert.ok(cpuMs < 15_000, `ten simulated minutes took ${cpuMs.toFixed(1)} ms`);
});

test("maximum-pressure snapshots stay bounded and simulate within the release budget", () => {
  const simulation = new LocalCoopSimulation({ seed: 0xcafef00d });
  const rock = simulation.state.rocks[0];
  const enemy = {
    id: 0,
    kind: "sentinel",
    x: 900,
    y: 60,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 21,
    hp: 1_000_000,
    maxHp: 1_000_000,
    fireTimer: 999,
    behaviorTimer: 999,
    warningTimer: 0,
    burst: 0,
    targetPlayerId: null,
    aimX: 0,
    aimY: 0,
  };
  const projectile = {
    id: 0,
    ownerId: "p1",
    x: 10,
    y: 10,
    vx: 0,
    vy: 0,
    radius: 2,
    damage: 1,
    life: 999,
    pierce: 0,
    bounces: 0,
    homing: 0,
    hitIds: [],
    weapon: "pulse",
    kind: "shot",
    fuse: 0,
    blastRadius: 0,
    blastDamage: 0,
    extra: 0,
    extraDamage: 0,
  };
  const hostile = {
    id: 0,
    sourceId: 1,
    source: "sentinel",
    x: 980,
    y: 20,
    vx: 0,
    vy: 0,
    radius: 3,
    damage: 1,
    life: 999,
    hitPlayerIds: [],
  };
  const hazard = {
    id: 0,
    sourceId: 1,
    kind: "strike",
    x: 980,
    y: 20,
    radius: 5,
    timer: 999,
    damage: 1,
  };
  const pickup = {
    id: 0,
    x: 980,
    y: 20,
    vx: 0,
    vy: 0,
    kind: "credit",
    value: 1,
    life: 999,
  };
  const fill = (count, value) =>
    Array.from({ length: count }, (_, index) => ({ ...structuredClone(value), id: index + 1 }));
  const over = 40;
  simulation.state.rocks = fill(COOP_CONFIG.entityCaps.rocks + over, {
    ...rock,
    x: 980,
    y: 20,
    hp: 1_000_000,
    maxHp: 1_000_000,
  });
  simulation.state.enemies = fill(COOP_CONFIG.entityCaps.enemies + over, enemy);
  simulation.state.projectiles = fill(COOP_CONFIG.entityCaps.projectiles + over, projectile);
  simulation.state.hostileProjectiles = fill(
    COOP_CONFIG.entityCaps.hostileProjectiles + over,
    hostile,
  );
  simulation.state.hazards = fill(COOP_CONFIG.entityCaps.hazards + over, hazard);
  simulation.state.pickups = fill(COOP_CONFIG.entityCaps.pickups + over, pickup);

  const restored = LocalCoopSimulation.restore(simulation.snapshot());
  assertCaps(restored.state);
  const started = performance.now();
  restored.stepTicks(300);
  const simulationMs = performance.now() - started;
  const snapshotStarted = performance.now();
  const sizes = Array.from({ length: 100 }, () =>
    Buffer.byteLength(JSON.stringify(createWireState(restored.snapshot()))),
  );
  const serializationMs = performance.now() - snapshotStarted;
  const maximumBytes = Math.max(...sizes);
  assertCaps(restored.state);
  assert.ok(maximumBytes < 196_608, `wire snapshot reached ${maximumBytes} bytes`);
  assert.ok(simulationMs < 5_000, `300 pressure ticks took ${simulationMs.toFixed(1)} ms`);
  assert.ok(serializationMs < 2_000, `100 snapshots took ${serializationMs.toFixed(1)} ms`);
  console.info(
    `[coop readiness] pressure snapshot ${maximumBytes} B; 300 ticks ${simulationMs.toFixed(1)} ms; 100 serializations ${serializationMs.toFixed(1)} ms`,
  );
});

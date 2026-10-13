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

const { ClientPrediction, SnapshotInterpolator } = await import(
  "../src/game/network/client-sync.ts"
);
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");

function snapshot(simulation) {
  const state = simulation.snapshot();
  return {
    type: "snapshot",
    serverTime: 1000 + state.tick * (1000 / 30),
    serverTick: state.tick,
    acknowledgements: {
      p1: state.players.p1.lastInputSequence,
      p2: state.players.p2.lastInputSequence,
    },
    state,
    events: [],
  };
}

test("client prediction replays only inputs newer than the server acknowledgement", () => {
  const simulation = new LocalCoopSimulation({ seed: 13 });
  const prediction = new ClientPrediction("p1", 1000, 700);
  prediction.reconcile(snapshot(simulation));
  const start = prediction.ship.x;
  const first = prediction.sample({ moveX: 1, moveY: 0, aimAngle: 0 });
  const second = prediction.sample({ moveX: 1, moveY: 0, aimAngle: 0 });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.ok(prediction.ship.x > start);
  assert.equal(prediction.pendingCount, 2);

  simulation.submit({ ...first, playerId: "p1" });
  simulation.stepTicks();
  const authoritativeX = simulation.state.players.p1.ship.x;
  prediction.reconcile(snapshot(simulation));
  assert.equal(prediction.pendingCount, 1);
  assert.ok(prediction.ship.x > authoritativeX);
});

test("snapshot interpolation orders out-of-order frames and blends entity positions", () => {
  const simulation = new LocalCoopSimulation({ seed: 21 });
  const first = snapshot(simulation);
  simulation.state.players.p1.ship.x += 100;
  simulation.game.rocks[0].x += 40;
  simulation.stepTicks(2);
  const second = snapshot(simulation);
  const buffer = new SnapshotInterpolator(2);
  buffer.push(second);
  buffer.push(first);
  assert.equal(buffer.size, 2);
  const middle = buffer.sample((first.serverTick + second.serverTick) / 2);
  assert.ok(middle);
  assert.equal(
    middle.players.p1.ship.x,
    (first.state.players.p1.ship.x + second.state.players.p1.ship.x) / 2,
  );
  assert.equal(middle.rocks[0].x, (first.state.rocks[0].x + second.state.rocks[0].x) / 2);
  assert.equal(
    middle.campaign.rocks[0].x,
    (first.state.campaign.rocks[0].x + second.state.campaign.rocks[0].x) / 2,
  );

  simulation.stepTicks(2);
  buffer.push(snapshot(simulation));
  assert.equal(buffer.size, 2);
  assert.equal(buffer.sample(-10).tick, second.state.tick);
});

test("prediction matches the campaign substeps during slow motion and stops when disabled", () => {
  const simulation = new LocalCoopSimulation({ seed: 77 });
  simulation.game.rocks = [];
  simulation.game.drones = [];
  simulation.game.waveHold = 100;
  simulation.game.timeScale = 0.35;
  const prediction = new ClientPrediction("p1", 1000, 700);
  prediction.reconcile(snapshot(simulation));
  const command = prediction.sample({ moveX: 1, moveY: -1, aimAngle: 0.5 });
  simulation.submit({ ...command, playerId: "p1" });
  simulation.stepTicks();
  for (const key of ["x", "y", "vx", "vy", "angle"])
    assert.ok(Math.abs(prediction.ship[key] - simulation.state.players.p1.ship[key]) < 1e-9, key);
  simulation.state.players.p1.disabled = true;
  prediction.reconcile(snapshot(simulation));
  const before = prediction.ship;
  prediction.sample({ moveX: 1, moveY: 0, aimAngle: 1 });
  assert.deepEqual(prediction.ship, before);
});

test("invalid local samples are normalized before they reach the network", () => {
  const prediction = new ClientPrediction("p2", 1000, 700);
  const message = prediction.sample({ moveX: 90, moveY: Number.NaN, aimAngle: 20 * Math.PI });
  assert.equal(message.moveX, 1);
  assert.equal(message.moveY, 0);
  assert.ok(message.aimAngle >= -Math.PI && message.aimAngle <= Math.PI);
});

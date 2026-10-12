import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const campaign = await import("../src/game/simulation/campaign.ts");
const { stepPlayerMovement } = await import("../src/game/simulation/movement.ts");
const { SeededRandom, randomBetween, randomChance, randomInteger } = await import(
  "../src/game/simulation/random.ts"
);
const { freshPlayer } = await import("../src/game/balance.ts");

test("shared campaign schedule preserves five sectors and five bosses", () => {
  assert.equal(campaign.RUN_PACING.finalWave, 25);
  assert.deepEqual(
    Array.from({ length: 25 }, (_, index) => campaign.sectorForWave(index + 1)),
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4],
  );
  assert.deepEqual(
    Array.from({ length: 30 }, (_, index) => index + 1).filter(campaign.isBossWave),
    [5, 10, 15, 20, 25],
  );
  assert.deepEqual([5, 10, 15, 20, 25].map(campaign.bossMkForWave), [1, 2, 3, 4, 5]);
  assert.equal(campaign.scaledWave(25), 50);
});

test("seeded random streams replay exactly and restore from snapshots", () => {
  const first = new SeededRandom(0xc0ffee);
  const second = new SeededRandom(0xc0ffee);
  const sequence = Array.from({ length: 20 }, () => first.next());
  assert.deepEqual(
    sequence,
    Array.from({ length: 20 }, () => second.next()),
  );
  assert.ok(sequence.every((value) => value >= 0 && value < 1));

  const checkpoint = first.snapshot();
  const afterCheckpoint = Array.from({ length: 8 }, () => first.next());
  first.restore(checkpoint);
  assert.deepEqual(
    Array.from({ length: 8 }, () => first.next()),
    afterCheckpoint,
  );

  const helpers = new SeededRandom(77);
  assert.ok(randomBetween(helpers, -4, 9) >= -4);
  assert.ok(randomInteger(helpers, 2, 5) >= 2);
  assert.equal(randomChance(helpers, 0), false);
  assert.equal(randomChance(helpers, 1), true);
});

test("shared movement advances two ships independently with campaign physics", () => {
  const first = freshPlayer();
  const second = freshPlayer();
  first.x = second.x = 500;
  first.y = second.y = 350;

  stepPlayerMovement(first, { turn: 1, forward: 1 }, 1 / 30, { width: 1000, height: 700 });
  stepPlayerMovement(second, { aimAngle: 0, aimTurnMultiplier: 3.2, moveY: -1 }, 1 / 30, {
    width: 1000,
    height: 700,
  });

  assert.notDeepEqual(
    { x: first.x, y: first.y, vx: first.vx, vy: first.vy, angle: first.angle },
    { x: second.x, y: second.y, vx: second.vx, vy: second.vy, angle: second.angle },
  );
  assert.equal(first.thrusting, true);
  assert.equal(second.thrusting, true);
  assert.ok(Math.hypot(first.vx, first.vy) <= first.maxSpeed);
  assert.ok(Math.hypot(second.vx, second.vy) <= second.maxSpeed);

  first.x = 1045;
  stepPlayerMovement(first, {}, 0, { width: 1000, height: 700 });
  assert.equal(first.x, -43);
});

test("shared movement is numerically identical to the previous campaign movement", () => {
  const cases = [
    { turn: -1, forward: 1 },
    { aimAngle: 1.2, aimTurnMultiplier: 1.9, forward: 0.63, thrustMultiplier: 1.15 },
    { aimAngle: -0.8, aimTurnMultiplier: 3.2, moveX: 1, moveY: -1 },
    { aimAngle: 2.7, aimTurnMultiplier: 1.9, forward: 0 },
  ];
  for (const intent of cases) {
    const actual = freshPlayer();
    actual.x = 1039;
    actual.y = 701;
    actual.vx = 510;
    actual.vy = -83;
    actual.angle = -1.4;
    const expected = structuredClone(actual);
    const dt = 1 / 30;

    if (intent.aimAngle !== undefined) {
      const difference =
        ((intent.aimAngle - expected.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const limit = expected.turn * (intent.aimTurnMultiplier ?? 1) * dt;
      expected.angle += Math.max(-limit, Math.min(limit, difference));
    } else {
      expected.angle += (intent.turn ?? 0) * expected.turn * dt;
    }
    if ((intent.moveX ?? 0) !== 0 || (intent.moveY ?? 0) !== 0) {
      const length = Math.hypot(intent.moveX ?? 0, intent.moveY ?? 0) || 1;
      expected.vx += ((intent.moveX ?? 0) / length) * expected.thrust * dt;
      expected.vy += ((intent.moveY ?? 0) / length) * expected.thrust * dt;
      expected.thrusting = true;
    } else if ((intent.forward ?? 0) > 0) {
      const thrust = (intent.forward ?? 0) * (intent.thrustMultiplier ?? 1);
      expected.vx += Math.cos(expected.angle) * expected.thrust * thrust * dt;
      expected.vy += Math.sin(expected.angle) * expected.thrust * thrust * dt;
      expected.thrusting = true;
    }
    const drag = Math.pow(0.986, dt * 60);
    expected.vx *= drag;
    expected.vy *= drag;
    const speed = Math.hypot(expected.vx, expected.vy);
    if (speed > expected.maxSpeed) {
      expected.vx = (expected.vx / speed) * expected.maxSpeed;
      expected.vy = (expected.vy / speed) * expected.maxSpeed;
    }
    expected.x += expected.vx * dt;
    expected.y += expected.vy * dt;
    if (expected.x < -44) expected.x += 1088;
    if (expected.x > 1044) expected.x -= 1088;
    if (expected.y < -44) expected.y += 788;
    if (expected.y > 744) expected.y -= 788;

    stepPlayerMovement(actual, intent, dt, { width: 1000, height: 700 });
    for (const key of ["x", "y", "vx", "vy", "angle"]) {
      assert.ok(
        Math.abs(actual[key] - expected[key]) < 1e-12,
        `${key} changed for ${JSON.stringify(intent)}`,
      );
    }
    assert.equal(actual.thrusting, expected.thrusting);
  }
});

test("shared simulation modules remain free of browser and engine dependencies", () => {
  const simulationDirectory = new URL("../src/game/simulation/", import.meta.url);
  const files = readdirSync(simulationDirectory).filter((file) => file.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(new URL(file, simulationDirectory), "utf8");
    assert.doesNotMatch(source, /from ["']\.\.\/engine["']/);
    assert.doesNotMatch(
      source,
      /\b(document|window|localStorage|AudioContext|CanvasRenderingContext2D)\b/,
    );
  }
  const sharedTypes = readFileSync(new URL("../src/game/types.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sharedTypes, /from ["']\.\/engine["']/);
});

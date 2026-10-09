import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

// Use the project's TypeScript compiler without adding a second test toolchain.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
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

const noop = () => {};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.window = { devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop };
globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
const { Game } = await import("../src/game/engine.ts");

function game() {
  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ width: 1400, height: 900 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  const g = new Game(canvas, { onHud: noop, onMode: noop });
  g.mode = "playing";
  g.wave = 21;
  g.saveRun = noop;
  g.gainXp = noop;
  return g;
}

function seeded(t, seed = 42) {
  t.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
}

test("beam follows ship heading and does not bend toward an off-axis target", () => {
  const g = game();
  g.p.x = 0;
  g.p.y = 0;
  g.p.angle = 0;
  const target = g.makeRock(700, 40, 1);
  target.r = 5;
  g.addRocks(target);
  const hp = target.hp;
  assert.notEqual(g.assistAngle(0), 0, "target would attract the ordinary assist");
  g.beamDamage(0.1, 10);
  assert.equal(g.beamAngle, 0);
  assert.equal(target.hp, hp);
  target.y = 0;
  g.beamDamage(0.1, 10);
  assert.equal(target.hp, hp - 1);
});

test("fast rocks have 1.5x normal HP and increased speed at every size and wave", () => {
  const g = game();
  for (const wave of [1, 21, 24]) {
    g.wave = wave;
    for (const size of [1, 2, 3]) {
      const normal = g.makeRock(0, 0, size);
      const fast = g.makeRock(0, 0, size, 1, 0, "fast");
      assert.equal(fast.hp, normal.hp * 1.5);
      assert.ok(Math.hypot(fast.vx, fast.vy) > [0, 235, 265, 290][size]);
    }
  }
});

test("fast-rock collisions deal more damage and knockback at matched speed", () => {
  function impact(trait) {
    const g = game();
    g.p.x = 110;
    g.p.y = 100;
    g.p.vx = 0;
    g.p.vy = 0;
    const rock = g.makeRock(100, 100, 2, 0, 0, trait);
    rock.vx = rock.vy = 0;
    rock.r = 33;
    g.addRocks(rock);
    g.shipCollisions(0.016);
    return { damage: 100 - g.p.hull, vx: g.p.vx };
  }
  const normal = impact("none"),
    fast = impact("fast");
  assert.ok(Math.abs(fast.damage / normal.damage - 1.15) < 1e-10);
  assert.ok(Math.abs(fast.vx / normal.vx - 1.3) < 1e-10);
});

test("large boom explosions have no descendants and little shake", () => {
  const g = game();
  g.p.x = 1300;
  g.p.y = 800;
  g.addRocks(g.makeRock(100, 100, 3, 0, 0, "boom"));
  g.breakRock(0, 0, 0);
  assert.equal(g.rocks.length, 0);
  assert.ok(g.shake < 2);
  g.addRocks(g.makeRock(100, 100, 3));
  g.breakRock(0, 0, 0);
  assert.equal(g.rocks.length, 2, "ordinary large rocks still split");
});

test("boom cap holds across dev batches, direct insertion and medium splits", () => {
  const g = game();
  g.devSpawnRock(2, "boom", 50);
  assert.equal(g.rocks.length, 6);
  g.addRocks(g.makeRock(0, 0, 1, 0, 0, "boom"));
  assert.equal(g.rocks.length, 6);
  g.rocks.forEach((r, i) => {
    r.x = i * 2000;
    r.y = 0;
  });
  g.breakRock(0, 0, 0);
  assert.equal(g.rocks.length, 6);
});

test("anomaly deals one damage per second only inside its tiny core", () => {
  const g = game();
  const b = g.makeBoss(false, 4);
  g.mkHole(b, 260, 20, 2000);
  const h = b.hole;
  g.p.x = h.x + h.r;
  g.p.y = h.y;
  for (let i = 0; i < 20; i++) g.updateHole(b, 0.1);
  assert.equal(g.p.hull, 100);
  g.p.x = h.x;
  for (let i = 0; i < 3; i++) g.updateHole(b, 0.25);
  assert.equal(g.p.hull, 100);
  g.updateHole(b, 0.25);
  assert.equal(g.p.hull, 99);
  for (let i = 0; i < 4; i++) g.updateHole(b, 0.25);
  assert.equal(g.p.hull, 98);
  g.updateHole(b, 0.5);
  g.p.x = h.x + h.r;
  g.updateHole(b, 0.1);
  g.p.x = h.x;
  g.updateHole(b, 0.5);
  assert.equal(g.p.hull, 98, "leaving the core resets partial exposure");
});

test("shake stays bounded, decays during slow-motion, and fully disables", () => {
  const g = game();
  for (let i = 0; i < 1000; i++) g.shake += 10;
  assert.equal(g.shake, 12);
  g.timeScale = 0.1;
  g.decayShake(0.5);
  assert.ok(g.shake < 0.2);
  g.settings.shake = false;
  assert.equal(g.screenShakeAmount(), 0);
  g.reduced = true;
  assert.equal(g.screenShakeAmount(), 0);
});

test("every late combat wave starts with only one or two normal rocks", (t) => {
  seeded(t);
  for (const wave of [21, 22, 23, 24]) {
    for (let trial = 0; trial < 20; trial++) {
      const g = game();
      g.wave = wave - 1;
      g.nextWave();
      assert.equal(g.wave, wave);
      const normal = g.rocks.filter((r) => r.trait === "none").length;
      assert.ok(normal === 1 || normal === 2);
      assert.ok(g.rocks.filter((r) => r.trait !== "none").length > normal);
      assert.ok(g.rocks.filter((r) => r.trait === "boom").length <= 6);
    }
  }
});

test("mutations occur in early waves and grow more frequent through the run", (t) => {
  seeded(t);
  const g = game();
  const rates = [1, 6, 11, 16].map((wave) => {
    g.wave = wave;
    let count = 0;
    for (let i = 0; i < 2000; i++) if (g.rollTrait() !== "none") count++;
    return count / 2000;
  });
  assert.ok(rates[0] > 0.1);
  assert.ok(rates[1] > 0.3);
  assert.ok(rates[2] > 0.5);
  assert.ok(rates[3] > 0.7);
});

test("dev spawns respect count and all asteroid/enemy sizes", () => {
  for (const size of [1, 2, 3]) {
    const g = game();
    g.devSpawnRock(size, "fast", 7);
    assert.equal(g.rocks.length, 7);
    assert.ok(g.rocks.every((r) => r.size === size));
    for (const kind of ["sentinel", "warden"]) {
      g.drones = [];
      g.devSpawnMob(kind, 4, size);
      assert.equal(g.drones.length, 4);
      assert.ok(g.drones.every((d) => d.kind === kind));
      const standard = kind === "warden" ? 30 : 21;
      assert.equal(g.drones[0].r, standard * (size === 1 ? 0.75 : size === 3 ? 1.35 : 1));
    }
  }
});

test("all six bosses can shed every asteroid size, within field limits", (t) => {
  seeded(t);
  for (let mk = 1; mk <= 6; mk++) {
    const g = game();
    const b = g.makeBoss(mk === 5, mk);
    const sizes = new Set();
    for (let i = 0; i < 150; i++) {
      g.rocks = [];
      g.spawnBossAbilityRock(b);
      for (const rock of g.rocks) sizes.add(rock.size);
    }
    assert.deepEqual([...sizes].sort(), [1, 2, 3], `MK${mk}`);
    g.rocks = [];
    g.devSpawnRock(1, "none", 10);
    for (let i = 0; i < 100; i++) g.spawnBossAbilityRock(b);
    assert.equal(g.rocks.length, 10);
  }
});

test("MK4 has lower HP, faster attacks, fewer bullets and weighted ignition", (t) => {
  seeded(t);
  const g = game();
  g.wave = 20;
  const b = g.makeBoss(false, 4);
  const baseHp = 1800 + 40 * 140;
  assert.equal(b.hp, baseHp * 2.4);
  assert.equal(b.timerMul, 0.7);
  assert.equal(b.bulletMul, 1.1);
  g.boss = b;
  g.updateBossMovement = () => false;
  let ignition = 0,
    spawns = 0;
  g.spawnBossAbilityRock = () => {
    spawns++;
  };
  g.triggerMk4ProximityStrikes = () => {
    ignition++;
  };
  for (let i = 0; i < 400; i++) {
    b.attackTimer = 0;
    b.hole = null;
    b.boomDrops = [];
    b.shockT = 0;
    g.updateBoss(b, 0);
  }
  assert.ok(ignition > 100 && ignition < 200);
  assert.ok(Math.abs(b.attackTimer - 1.82) < 1e-10);
  assert.equal(spawns + ignition, 400);
});

test("MK4 pending drops cannot breach six live boom rocks", () => {
  const g = game();
  const b = g.makeBoss(false, 4);
  g.boss = b;
  g.updateBossMovement = () => false;
  b.attackTimer = 100;
  g.devSpawnRock(1, "boom", 5);
  b.boomDrops = Array.from({ length: 5 }, () => ({ x: 50, y: 50, t: 0, t0: 1 }));
  g.updateBoss(b, 0.01);
  assert.equal(g.rocks.filter((r) => r.trait === "boom").length, 6);
  assert.equal(b.boomDrops.length, 0);
});

test("ignition strike damage is reduced and is not applied twice", () => {
  const g = game();
  const b = g.makeBoss(false, 4);
  g.boss = b;
  g.updateBossMovement = () => false;
  b.attackTimer = 100;
  b.strikes = [{ x: g.p.x, y: g.p.y, t: 0, t0: 1.35 }];
  g.updateBoss(b, 0.01);
  assert.equal(g.p.hull, 84);
});

test("beam survives boom chain reactions without hitting removed asteroids", () => {
  const g = game();
  g.p.x = 0;
  g.p.y = 0;
  g.p.angle = 0;
  for (const x of [700, 710, 720]) {
    const rock = g.makeRock(x, 0, 3, 0, 0, "boom");
    rock.hp = 1;
    g.addRocks(rock);
  }
  g.beamDamage(0.1, 20);
  assert.equal(g.rocks.length, 0);
  assert.ok(g.shake <= 12);
});

test("restoring an old run enforces the new boom cap and keeps other rocks", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  for (let i = 0; i < 15; i++) g.rocks.push(g.makeRock(i * 100, 0, 2, 0, 0, "boom"));
  g.devSpawnRock(2, "fast", 3);
  const save = new RunSave();
  save.begin(g);
  const restored = game();
  assert.equal(save.restore(restored), true);
  assert.equal(restored.rocks.filter((r) => r.trait === "boom").length, 6);
  assert.equal(restored.rocks.filter((r) => r.trait === "fast").length, 3);
});

test("every MK6 attack gets an asteroid spawn opportunity", (t) => {
  const g = game();
  const b = g.makeBoss(false, 6);
  let casts = 0;
  t.mock.method(g, "spawnBossAbilityRock", () => {
    casts++;
  });
  for (const attack of ["shower", "barrage", "beam", "strikes", "field", "hole", "heal"]) {
    g.mk6Begin(b, attack);
  }
  assert.equal(casts, 7);
});

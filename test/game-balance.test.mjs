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

test("mutations unlock on wave 6 and retain their later-wave frequencies", (t) => {
  seeded(t);
  const g = game();
  const rates = [1, 6, 11, 16].map((wave) => {
    g.wave = wave;
    let count = 0;
    for (let i = 0; i < 2000; i++) if (g.rollTrait() !== "none") count++;
    return count / 2000;
  });
  assert.equal(rates[0], 0);
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

test("homing asteroids never spawn naturally before wave 6", (t) => {
  seeded(t);
  for (let wave = 1; wave <= 5; wave++) {
    const g = game();
    g.wave = wave - 1;
    g.nextWave();
    assert.ok(
      g.rocks.every((rock) => rock.trait === "none"),
      `wave ${wave}`,
    );
    for (let i = 0; i < 100; i++) {
      assert.equal(g.rollTrait(), "none");
      assert.equal(g.rollTrait(true), "none");
    }
    if (g.boss) {
      g.startSignature(g.boss, 1);
      for (let i = 0; i < 20; i++) g.updateBoss(g.boss, 0.35);
      assert.ok(
        g.rocks.every((rock) => rock.trait === "none"),
        "MK1 abilities",
      );
    }
  }
});

test("wave-6 unlock preserves the existing later mutation probabilities", (t) => {
  const g = game();
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  for (const [wave, probability] of [
    [6, 0.35],
    [11, 0.55],
    [16, 0.75],
  ]) {
    g.wave = wave;
    roll = probability - 0.001;
    assert.notEqual(g.rollTrait(), "none", `wave ${wave} below threshold`);
    roll = probability + 0.001;
    assert.equal(g.rollTrait(), "none", `wave ${wave} above threshold`);
  }
});

test("Spiker volleys fire four or eight simultaneous, equally spaced shots", () => {
  for (const [wave, count] of [
    [11, 4],
    [19, 4],
    [20, 8],
    [25, 8],
  ]) {
    const g = game();
    g.wave = wave;
    const d = g.spawnDrone(700, 450, g.spikerHp(), "spiker");
    d.angle = 0.37;
    d.fire = 0;
    g.updateDrone(d, 0);
    assert.equal(g.bullets.length, count);
    g.bullets.forEach((bullet, i) => {
      const expected = d.angle + (i * Math.PI * 2) / count;
      assert.ok(Math.abs(bullet.vx - Math.cos(expected) * 225) < 1e-9);
      assert.ok(Math.abs(bullet.vy - Math.sin(expected) * 225) < 1e-9);
      assert.equal(bullet.kind, "enemy");
      assert.equal(bullet.damageCause, "Spiker radial volley");
      assert.equal(bullet.dmg, 7);
      assert.equal(bullet.life, 4.2);
    });
    g.updateDrone(d, 0.1);
    assert.equal(g.bullets.length, count, "the volley does not become a sequential burst");
  }
});

test("Spiker warning locks its firing directions, and paused enemies cannot shoot", () => {
  const g = game();
  const d = g.spawnDrone(700, 450, g.spikerHp(), "spiker");
  d.fire = 0.5;
  const angle = d.angle;
  g.updateDrone(d, 0.2);
  assert.equal(d.angle, angle);
  assert.equal(g.bullets.length, 0);
  g.updateDrone(d, 0.31);
  assert.equal(d.angle, angle);
  assert.equal(g.bullets.length, 8);
  g.bullets = [];
  g.mode = "paused";
  d.fire = 0;
  g.updateDrone(d, 1);
  assert.equal(g.bullets.length, 0);
});

test("Spikers drift independently of the player and bounce back inside the arena", () => {
  const a = game(),
    b = game();
  const d = a.spawnDrone(400, 400, a.spikerHp(), "spiker");
  d.orbitTimer = 100;
  d.vx = 100;
  d.vy = 80;
  const other = structuredClone(d);
  a.p.x = 0;
  a.p.y = 0;
  b.p.x = 1400;
  b.p.y = 900;
  a.updateDrone(d, 0.1);
  b.updateDrone(other, 0.1);
  assert.deepEqual(d, other);
  assert.equal(d.x, 410);
  assert.equal(d.y, 408);
  d.x = a.w - d.r - 6;
  d.y = a.h - d.r - 6;
  a.updateDrone(d, 0.1);
  assert.ok(d.vx < 0 && d.vy < 0);
  assert.ok(d.x <= a.w - d.r - 6 && d.y <= a.h - d.r - 6);
});

test("Spikers change drift direction on a timer without speeding up indefinitely", (t) => {
  const g = game();
  const d = g.spawnDrone(500, 500, g.spikerHp(), "spiker");
  d.vx = 140;
  d.vy = 0;
  d.orbitTimer = 0;
  t.mock.method(Math, "random", () => 0.9);
  g.updateDrone(d, 0.01);
  assert.ok(d.vy > 0);
  assert.ok(d.orbitTimer > 2);
  d.vx = 1000;
  g.updateDrone(d, 0.01);
  assert.ok(Math.hypot(d.vx, d.vy) <= 145 + 1e-9);
});

test("Spiker hull matches ordinary Warden health and resists player ramming only", () => {
  const g = game();
  g.wave = 21;
  assert.equal(g.spikerHp(), 1139);
  const d = g.spawnDrone(500, 500, g.spikerHp(), "spiker");
  g.drones.push(d);
  g.p.x = 505;
  g.p.y = 500;
  g.shipCollisions(0.016);
  assert.equal(d.hp, d.maxHp);
  assert.equal(g.p.hull, 86);
  g.damageDrone(0, 100, false, true);
  assert.equal(d.hp, d.maxHp - 100, "weapons still damage the hull");
});

test("Spikers appear from wave 11, including one with the wave-15 boss", (t) => {
  seeded(t);
  for (let wave = 1; wave <= 19; wave++) {
    const g = game();
    g.wave = wave - 1;
    g.nextWave();
    const spikers = g.drones.filter((d) => d.kind === "spiker");
    assert.equal(spikers.length, wave >= 11 ? 1 : 0, `wave ${wave}`);
    if (wave === 15) assert.equal(g.boss.mk, 3);
    for (const d of spikers) {
      assert.ok(Math.hypot(d.x - g.p.x, d.y - g.p.y) > 240);
      assert.equal(d.maxHp, 215 + wave * 44);
    }
  }
});

test("late waves sometimes spawn a second Spiker and natural spawns obey the cap", (t) => {
  let roll = 0.1;
  t.mock.method(Math, "random", () => roll);
  for (const wave of [20, 21, 22, 23, 24, 25]) {
    for (const [random, expected] of [
      [0.1, 2],
      [0.9, 1],
    ]) {
      roll = random;
      const g = game();
      g.wave = wave - 1;
      g.nextWave();
      assert.equal(g.drones.filter((d) => d.kind === "spiker").length, expected);
      g.spawnSpikers(50);
      assert.equal(g.drones.filter((d) => d.kind === "spiker").length, 2);
    }
  }
  const g = game();
  g.wave = 11;
  g.spawnSpikers(50);
  assert.equal(g.drones.length, 1);
  g.wave = 10;
  g.drones = [];
  assert.equal(g.spawnSpikers(1), 0);
});

test("MK6 escorts include one Spiker, replace a defeated one, and never accumulate them", () => {
  const g = game();
  g.wave = 25;
  const b = g.makeBoss(false, 6);
  for (const [wardens, sentinels] of [
    [2, 0],
    [2, 4],
    [3, 0],
  ]) {
    g.mk6Reinforce(b, wardens, sentinels, "ESCORT");
    assert.equal(g.drones.filter((d) => d.kind === "spiker").length, 1);
  }
  g.drones = g.drones.filter((d) => d.kind !== "spiker");
  g.mk6Reinforce(b, 1, 1, "ESCORT");
  assert.equal(g.drones.filter((d) => d.kind === "spiker").length, 1);
});

test("Spikers survive save/restore with their drift and volley timers intact", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  g.spawnSpikers(1);
  g.drones[0].fire = 0.4;
  const expected = structuredClone(g.drones[0]);
  const save = new RunSave();
  save.begin(g);
  const restored = game();
  assert.equal(save.restore(restored), true);
  assert.deepEqual(restored.drones[0], expected);
  restored.mode = "playing";
  restored.updateDrone(restored.drones[0], 0.41);
  assert.equal(restored.bullets.length, 8);
});

test("dev console can spawn Spikers in the chosen count and size", () => {
  const g = game();
  g.devSpawnMob("spiker", 3, 3);
  assert.equal(g.drones.length, 3);
  for (const d of g.drones) {
    assert.equal(d.kind, "spiker");
    assert.equal(d.r, 31 * 1.35);
    assert.equal(d.hp, g.spikerHp() * 1.6);
  }
});

test("killing a Spiker awards heavy rewards without removing Warden nests", () => {
  const g = game();
  g.drones.push(g.spawnDrone(500, 500, g.spikerHp(), "spiker"));
  g.bullets.push({ kind: "wardenOrb" });
  g.killDrone(0);
  assert.equal(g.drones.length, 0);
  assert.equal(g.score, 700);
  assert.equal(g.pickups.length, 4);
  assert.equal(g.bullets.length, 1);
});

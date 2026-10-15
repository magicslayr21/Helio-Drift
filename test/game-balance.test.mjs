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
        source: ts.transpileModule(
          readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", "({ DEV: true })"),
          {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          },
        ).outputText,
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

test("meteor showers ease in early and reach original speed at wave 21", () => {
  const g = game();
  g.rnd = (min, max) => (min + max) / 2;
  const speedAt = (wave) => {
    g.wave = wave;
    g.spawnMeteor(-1);
    const rock = g.rocks.at(-1);
    return Math.hypot(rock.vx, rock.vy);
  };
  const early = speedAt(6),
    middle = speedAt(13),
    late = speedAt(21);
  assert.ok(early < middle && middle < late);
  assert.ok(Math.abs(early / late - 0.55) < 0.001);
  assert.equal(late, 610);
  assert.equal(speedAt(25), late);
});

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

test("fast rocks have 1.8x normal HP and increased speed at every size and wave", () => {
  const g = game();
  for (const wave of [1, 21, 24]) {
    g.wave = wave;
    for (const size of [1, 2, 3]) {
      const normal = g.makeRock(0, 0, size);
      const fast = g.makeRock(0, 0, size, 1, 0, "fast");
      assert.equal(fast.hp, normal.hp * 1.8);
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

test("MK4 has 22k HP while retaining faster attacks and weighted ignition", (t) => {
  seeded(t);
  const g = game();
  g.wave = 20;
  const b = g.makeBoss(false, 4);
  assert.equal(b.hp, 22000);
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
    assert.equal(d.fire, (count === 8 ? 3.2 : 4) / 1.2);
    g.bullets.forEach((bullet, i) => {
      const expected = d.angle + (i * Math.PI * 2) / count;
      assert.ok(Math.abs(bullet.vx - Math.cos(expected) * 337.5) < 1e-9);
      assert.ok(Math.abs(bullet.vy - Math.sin(expected) * 337.5) < 1e-9);
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

test("Sentinels aim near moving players and re-evaluate range after wrapping", () => {
  for (const [px, py, vx, vy] of [
    [800, 450, 0, 540],
    [800, 5, 0, -540],
    [400, 450, -540, 0],
    [600, 450, 0, 0],
  ]) {
    const g = game();
    Object.assign(g.p, { x: px, y: py, vx, vy });
    const d = g.spawnDrone(500, 450, 100);
    d.fire = 0;
    g.updateDrone(d, 0);
    assert.equal(g.bullets.length, 1);
    const b = g.bullets[0];
    const angle = Math.atan2(b.vy, b.vx);
    const direct = Math.atan2(py - d.y, px - d.x);
    const delta = Math.atan2(Math.sin(angle - direct), Math.cos(angle - direct));
    assert.ok(Math.abs(delta) <= Math.asin(0.25) + 1e-9, "bounded lead stays near the player");
    assert.equal(d.angle, angle, "hull faces the fired shot");
    assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 250) < 1e-8);
  }
  const g = game();
  Object.assign(g.p, { x: 100, y: 450, vx: 0, vy: 0 });
  const d = g.spawnDrone(-100, 450, 100);
  d.fire = 0;
  g.updateDrone(d, 0);
  assert.equal(
    g.bullets.length,
    0,
    "a sentinel that wrapped out of range must not fire using stale distance",
  );
  g.mode = "paused";
  d.x = 300;
  g.updateDrone(d, 0);
  assert.equal(g.bullets.length, 0, "paused sentinels cannot shoot");
});

test("saved runs open at the menu and Continue preserves gameplay, upgrades and victory", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  for (const pending of ["playing", "levelup", "victory"]) {
    const original = game();
    original.score = 9876;
    original.wave = 15;
    if (pending === "levelup") original.choices = [{ id: "armor", kind: "stat", name: "Armor" }];
    if (pending === "victory") original.bonusAvailable = true;
    new RunSave().begin(original);
    const before = data;
    const restored = game();
    assert.equal(restored.restoreRun(true), true);
    assert.equal(restored.mode, "menu");
    assert.equal(restored.score, 9876);
    assert.equal(restored.wave, 15);
    restored.onKeyDown({ key: "Enter", target: null, preventDefault: noop });
    assert.equal(restored.mode, "menu", "Enter cannot bypass the saved-run choice");
    assert.equal(data, before, "visiting the menu does not overwrite the save");
    restored.continueRun();
    assert.equal(restored.mode, pending);
    assert.equal(restored.score, 9876);
  }
  data = "invalid json";
  assert.equal(game().restoreRun(true), false);
});

test("focused controls retain keyboard activation without blocking flight keys", () => {
  const g = game();
  const target = { tagName: "BUTTON", isContentEditable: false };
  let prevented = false;
  g.onKeyDown({
    key: " ",
    target,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(g.keys[" "], undefined);
  g.onKeyDown({ key: "w", target, preventDefault: noop });
  assert.equal(g.keys.w, true);
});

test("weapon purchases, shop previews, and stats obey rarity caps", async () => {
  const { weaponMaxLevel, WEAPON_ORDER } = await import("../src/game/balance.ts");
  const g = game();
  g.credits = 1000000;
  for (const id of WEAPON_ORDER) {
    const max = weaponMaxLevel(id);
    assert.equal(max, id === "pulse" ? 3 : ["arc", "laser", "rail"].includes(id) ? 6 : 4);
    for (let i = 0; i < 8; i++) g.buyWeapon(id);
    assert.equal(g.p.weapons[id], max);
    assert.equal(g.weaponPrice(id), null);
    assert.deepEqual(g.weaponShopInfo(id).next, []);
    assert.equal(g.weaponShopInfo(id).maxLevel, max);
    assert.equal(g.buyWeapon(id), false);
  }
  assert.deepEqual(g.weaponStats("pulse", 6), g.weaponStats("pulse", 3));
});

test("Pulse growth is gently nerfed and every rare/epic damage source is buffed", () => {
  const g = game();
  assert.equal(g.weaponStats("pulse", 1).dmg, 16);
  assert.equal(g.weaponStats("pulse", 3).dmg, 16 * 1.24);
  for (const [id, previous] of [
    ["spread", 11.5],
    ["seeker", 6.5],
    ["ricochet", 19],
    ["flak", 9.2],
    ["rail", 16 * 2.6],
  ])
    assert.ok(g.weaponStats(id, 1).dmg > previous, id);
  assert.ok(g.weaponStats("flak", 1).extraDmg > 8.4);
  assert.ok(g.arcStats(1).dmg > 9);
  assert.ok(g.laserStats(1).dps > 125);
});

test("critical optics caps at three rare upgrades and rebuilds without stacking damage", async () => {
  const { STAT_UPGRADES } = await import("../src/game/balance.ts");
  const g = game();
  const crit = STAT_UPGRADES.find((u) => u.id === "crit");
  assert.equal(crit.rarity, "rare");
  assert.equal(crit.max, 3);
  g.p.missiles = 1;
  g.devSetStack("crit", 9);
  assert.ok(Math.abs(g.p.crit - 0.66) < 1e-9);
  assert.equal(g.p.critMult, 2.5);
  g.rebuildStatUpgrades();
  assert.equal(g.p.critMult, 2.5);
  assert.equal(g.p.missiles, 1);
  g.devSetStack("crit", 0);
  assert.equal(g.p.critMult, 2.2);
  for (const u of STAT_UPGRADES.filter((u) => u.rarity === "common")) assert.equal(u.max, 3);
});

function companion(g) {
  const d = g.salvageDrone;
  d.purchased = d.active = true;
  d.x = g.p.x;
  d.y = g.p.y;
  return d;
}

test("Guardian Link absorbs exact post-armor damage and cannot hide damage behind drone armor or i-frames", () => {
  for (const [level, share] of [
    [1, 0.2],
    [2, 0.35],
    [3, 0.5],
  ]) {
    const g = game();
    const d = companion(g);
    d.upgrades.shield = level;
    d.upgrades.armor = 3;
    d.hitTimer = 1;
    g.p.armor = 0.25;
    g.damagePlayer(20);
    assert.equal(g.p.hull, 100 - 15 * (1 - share));
    assert.equal(d.hp, 24 - 15 * share);
    assert.equal(g.quietTime, 0);
  }
});

test("shield overflow reaches the player and protection stops on death or leaving range", () => {
  const g = game();
  const d = companion(g);
  d.upgrades.shield = 3;
  d.hp = 3;
  g.damagePlayer(20);
  assert.equal(g.p.hull, 83);
  assert.equal(d.hp, 0);
  assert.equal(d.active, false);
  g.damagePlayer(10);
  assert.equal(g.p.hull, 73);
  d.active = true;
  d.hp = 24;
  d.x = g.p.x + 151;
  g.damagePlayer(10);
  assert.equal(g.p.hull, 63);
  assert.equal(d.hp, 24);
  d.upgrades.scan = 1;
  g.damagePlayer(10);
  assert.equal(g.p.hull, 58);
  assert.equal(d.hp, 19);
});

test("Repair Pulse requires five quiet seconds then heals at exact level cadence", () => {
  for (const [level, interval, heal] of [
    [1, 1, 1],
    [2, 0.75, 1],
    [3, 0.5, 2],
  ]) {
    const g = game();
    const d = companion(g);
    d.upgrades.repairPulse = level;
    g.p.hull = 50;
    const tick = (seconds) => {
      for (let i = 0; i < Math.round(seconds * 100); i++) {
        g.quietTime += 0.01;
        g.repairSalvage(0.01);
      }
    };
    tick(5);
    assert.equal(g.p.hull, 50);
    tick(interval);
    assert.equal(g.p.hull, 50 + heal);
    tick(interval);
    assert.equal(g.p.hull, 50 + heal * 2);
    g.damageSalvageDrone(1);
    assert.equal(g.quietTime, 0);
    tick(5);
    assert.equal(g.p.hull, 50 + heal * 2);
    tick(interval);
    assert.equal(g.p.hull, 50 + heal * 3);
  }
});

test("Repair Pulse resets on player damage, distance, and destroyed drone", () => {
  const g = game();
  const d = companion(g);
  d.upgrades.repairPulse = 3;
  g.p.hull = 50;
  g.quietTime = 10;
  d.pulseTimer = 0.1;
  d.x += 1000;
  g.repairSalvage(1);
  assert.equal(g.p.hull, 50);
  assert.equal(d.pulseTimer, 0.5);
  d.x = g.p.x;
  g.repairSalvage(0.25);
  assert.equal(g.p.hull, 50);
  g.damagePlayer(1);
  assert.equal(g.quietTime, 0);
  assert.equal(d.pulseTimer, 0.5);
  d.active = false;
  g.quietTime = 10;
  g.repairSalvage(1);
  assert.equal(g.p.hull, 49);
});

test("Synchronized Feeders provides +5% pilot and +10% drone attack speed per stack", () => {
  const g = game();
  const d = companion(g);
  g.nearestTarget = () => ({ x: d.x + 100, y: d.y, vx: 0, vy: 0 });
  const rate = g.weaponStats("pulse", 1).rate;
  const arc = g.arcStats(1).tick;
  const beam = g.laserStats(1).dps;
  g.salvageFire(d, 0);
  const droneInterval = d.fireTimer;
  d.upgrades.piercing = 2;
  d.fireTimer = 0;
  g.salvageFire(d, 0);
  assert.equal(g.weaponStats("pulse", 1).rate, rate * 1.1);
  assert.equal(g.arcStats(1).tick, arc / 1.1);
  assert.equal(g.arcStats(1, true).tick, arc / 1.2);
  assert.equal(g.laserStats(1).dps, beam * 1.1);
  assert.equal(g.laserStats(1, true).dps, beam * 1.2);
  assert.equal(d.fireTimer, droneInterval / 1.2);
  assert.equal(g.bullets.at(-1).pierce, 0);
});

test("Adaptive Arsenal benefits every mount, including rail, seeker, flak, arc, and beam", () => {
  const g = game();
  const d = companion(g);
  g.nearestTarget = () => ({ x: d.x + 100, y: d.y, vx: 0, vy: 0 });
  for (const weapon of [null, "pulse", "spread", "seeker", "ricochet", "flak", "rail"]) {
    d.weapon = weapon;
    if (weapon) g.p.weapons[weapon] = 1;
    d.upgrades.twinCannons = 0;
    d.fireTimer = 0;
    g.bullets = [];
    g.salvageFire(d, 0);
    const count = g.bullets.length;
    d.upgrades.twinCannons = 3;
    d.fireTimer = 0;
    g.bullets = [];
    g.salvageFire(d, 0);
    assert.equal(g.bullets.length, count + 3, weapon);
  }
  d.weapon = "arc";
  g.p.weapons.arc = 1;
  let chains = 0;
  g.arcFrom = (_x, _y, stats) => {
    chains = stats.chains;
    return true;
  };
  d.fireTimer = 0;
  g.salvageFire(d, 0);
  assert.equal(chains, Math.max(1, g.arcStats(1).chains - 1) + 3);
  d.weapon = "laser";
  g.p.weapons.laser = 1;
  let damage = 0;
  g.droneBeamDamage = (_x, _y, _a, _r, dmg) => {
    damage = dmg;
    return 100;
  };
  g.salvageFire(d, 1);
  assert.equal(damage, g.laserStats(1, true).dps * 0.18 * 1.6);
});

test("Magnet Coil collects repair kits and credits, Wide Scan expands weapon and support ranges", () => {
  const g = game();
  const d = companion(g);
  g.p.hull = 50;
  g.pickups = [{ x: d.x, y: d.y, kind: "repair", value: 8 }];
  g.salvageMagnet(d);
  assert.equal(g.p.hull, 50);
  d.upgrades.magnet = 1;
  g.salvageMagnet(d);
  assert.equal(g.p.hull, 58);
  assert.equal(g.pickups.length, 0);
  let range = 0;
  g.nearestTarget = (_x, _y, value) => {
    range = value;
    return null;
  };
  g.salvageFire(d, 0);
  const base = range;
  d.upgrades.scan = 1;
  g.salvageFire(d, 0);
  assert.equal(range, base + 150);
  assert.equal(g.salvageSupportRange(), 200);
});

test("fast asteroid speed scales with lost HP without compounding", () => {
  const g = game();
  for (const size of [1, 2, 3]) {
    const r = g.makeRock(0, 0, size, 1, 0, "fast");
    const base = Math.hypot(r.vx, r.vy);
    for (const fraction of [1, 0.5, 0, 1]) {
      r.hp = r.maxHp * fraction;
      for (let i = 0; i < 100; i++) g.updateFastRockSpeed(r);
      assert.ok(Math.abs(Math.hypot(r.vx, r.vy) - base * (1 + 0.5 * (1 - fraction))) < 1e-9);
    }
  }
});

test("only small homing asteroids gain movement speed", () => {
  for (const [size, speed] of [
    [1, 117],
    [2, 88],
    [3, 95],
  ]) {
    const g = game();
    g.p.x = 700;
    g.p.y = 500;
    const r = g.makeRock(100, 100, size, 1, 0, "homing");
    g.rocks = [r];
    g.update(0.01);
    assert.ok(Math.abs(Math.hypot(r.vx, r.vy) - speed) < 1e-9);
  }
});

test("later boss HP scales to 14k / 22k / 28k / 37k", () => {
  const g = game();
  for (const [mk, hp] of [
    [3, 14000],
    [4, 22000],
    [5, 28000],
    [6, 37000],
  ]) {
    g.wave = Math.min(mk * 5, 25);
    assert.equal(g.makeBoss(mk === 5, mk).hp, hp);
  }
});

test("every boss death clears escorts, asteroids, showers, and hostile projectiles", () => {
  for (let mk = 1; mk <= 6; mk++) {
    const g = game();
    g.boss = g.makeBoss(mk === 5, mk);
    g.rocks = [g.makeRock(20, 20, 2)];
    g.drones = [g.spawnDrone(30, 30, 100, "spiker")];
    g.shower.active = true;
    g.bullets = ["enemy", "wardenOrb", "wardenShard"].map((kind) => ({
      kind,
      life: 5,
      dmg: 30,
      blast: 80,
      spawnT: 0,
    }));
    g.killBoss();
    assert.equal(g.boss, null);
    assert.equal(g.rocks.length, 0);
    assert.equal(g.drones.length, 0);
    assert.equal(g.shower.active, false);
    assert.ok(g.bullets.every((b) => b.life === 0 && b.dmg === 0 && b.blast === 0));
    g.updateBullets(0.01);
    assert.equal(g.bullets.length, 0);
  }
});

test("MK6 half-health raid spans the screen in medium-only 300-speed lanes", (t) => {
  seeded(t);
  const g = game();
  const boss = g.makeBoss(false, 6);
  for (const side of [-1, 1]) {
    g.rocks = [];
    g.spawnMk6RaidMeteors(boss, side);
    assert.equal(g.rocks.length, 3);
    for (const [i, rock] of g.rocks.entries()) {
      assert.equal(rock.size, 2);
      assert.equal(rock.trait, "meteor");
      assert.equal(rock.vx, side * -300);
      assert.equal(rock.vy, 0);
      assert.ok(rock.y > (i * g.h) / 3 && rock.y < ((i + 1) * g.h) / 3);
      assert.ok(side < 0 ? rock.x < 0 : rock.x > g.w);
    }
  }
});

test("pre-update saves migrate shield, caps, derived stats and health fractions only once", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data;
  t.mock.method(localStorage, "getItem", () => data ?? null);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  g.p.weapons.pulse = 6;
  g.p.weapons.seeker = 6;
  g.stacks = { crit: 5, hollow: 6 };
  g.boss = g.makeBoss(false, 4);
  g.boss.hp = 8880;
  g.boss.maxHp = 17760;
  g.rocks = [g.makeRock(20, 20, 1, 1, 0, "fast")];
  g.rocks[0].maxHp = 100;
  g.rocks[0].hp = 40;
  const save = new RunSave();
  save.begin(g);
  const old = JSON.parse(data);
  delete old.balanceVersion;
  delete old.state.campaignTethers;
  delete old.state.p.rangeMul;
  delete old.state.salvageDrone.upgrades.shield;
  data = JSON.stringify(old);
  const restored = game();
  assert.equal(save.restore(restored), true);
  assert.equal(restored.salvageDrone.upgrades.shield, 0);
  assert.deepEqual(restored.campaignTethers, []);
  assert.equal(restored.p.rangeMul, 1);
  assert.equal(restored.p.weapons.pulse, 3);
  assert.equal(restored.p.weapons.seeker, 4);
  assert.equal(restored.stacks.crit, 3);
  assert.equal(restored.stacks.hollow, 3);
  assert.equal(restored.p.critMult, 2.5);
  assert.equal(restored.boss.hp, 11000);
  assert.equal(restored.rocks[0].maxHp, 120);
  assert.equal(restored.rocks[0].hp, 48);
  save.write(restored);
  const again = game();
  assert.equal(save.restore(again), true);
  assert.equal(again.rocks[0].maxHp, 120);
  assert.equal(again.boss.hp, 11000);
});

test("paused R cannot destroy the saved run", () => {
  const g = game();
  g.mode = "paused";
  g.startGame = () => {
    throw Error("unexpected restart");
  };
  g.onKeyDown({ key: "r", target: null, preventDefault: noop });
  assert.equal(g.mode, "paused");
});

test("release archive matches both package versions and has three distinct original scores", async () => {
  const { UPDATE_LOG } = await import("../src/game/update-log.ts");
  const { SCORES } = await import("../src/game/music.ts");
  for (const path of ["../package.json", "../package-lock.json"])
    assert.equal(
      JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")).version,
      UPDATE_LOG[0].version,
    );
  assert.equal(Object.keys(SCORES).length, 3);
  assert.equal(new Set(Object.values(SCORES).map((score) => score.title)).size, 3);
  assert.equal(new Set(Object.values(SCORES).map((score) => score.melody.join(","))).size, 3);
});

test("music follows live boss state and silences on pause, menu, hidden tabs and destruction", async (t) => {
  const { audio } = await import("../src/game/audio.ts");
  const themes = [];
  let stops = 0;
  t.mock.method(audio, "setMusic", (theme) => themes.push(theme));
  t.mock.method(audio, "stopMusic", () => {
    stops++;
  });
  const g = game();
  g.update = noop;
  g.render = noop;
  for (const mk of [0, 1, 2, 3, 4, 5, 6, 0]) {
    g.boss = mk ? g.makeBoss(mk === 5, mk) : null;
    g.loop(performance.now());
  }
  assert.deepEqual(themes, ["flight", "boss", "boss", "boss", "boss", "boss", "mk6", "flight"]);
  g.boss = g.makeBoss(false, 6);
  g.boss.hp = g.boss.maxHp / 2;
  g.loop(performance.now());
  assert.equal(themes.at(-1), "mk6", "the half-health raid is still phase one");
  g.boss.movement.mk6RaidDone = true;
  g.updateMk6(g.boss, 0.01);
  g.loop(performance.now());
  assert.equal(themes.at(-1), "mk6Phase2", "the actual enraged phase changes the music");
  for (const mode of ["paused", "menu", "levelup", "gameover", "victory"]) {
    g.mode = mode;
    g.loop(performance.now());
  }
  assert.equal(stops, 5);
  document.hidden = true;
  try {
    g.loop(performance.now());
  } finally {
    document.hidden = false;
  }
  assert.equal(stops, 6);
  g.destroy();
  assert.equal(stops, 7);
});

test("mixed late-boss combat survives upgraded drone attacks and mid-frame boss cleanup", (t) => {
  seeded(t);
  for (const mk of [3, 4, 5, 6]) {
    const g = game();
    g.god = true;
    g.settings.autoFire = true;
    g.wave = Math.min(25, mk * 5);
    g.p.x = 700;
    g.p.y = 500;
    g.boss = g.makeBoss(mk === 5, mk);
    const d = companion(g);
    for (const key of Object.keys(d.upgrades)) d.upgrades[key] = key === "piercing" ? 2 : 3;
    for (const id of Object.keys(g.p.weapons)) g.p.weapons[id] = 3;
    for (const trait of ["fast", "homing", "boom", "bounce"]) g.devSpawnRock(2, trait, 3);
    for (let frame = 0; frame < 400; frame++) {
      d.weapon = ["laser", "arc", "rail", "flak"][Math.floor(frame / 100)];
      g.frame++;
      if (frame === 200 && g.boss) g.boss.hp = 1;
      g.update(1 / 60);
      if (frame === 300 && g.boss) g.killBoss();
      assert.ok(Number.isFinite(g.p.hull));
      assert.ok(g.rocks.every((rock) => Number.isFinite(rock.x) && Number.isFinite(rock.hp)));
    }
    assert.equal(g.boss, null);
  }
});

test("failed initial saves retry without overwriting a newer run or tombstone", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let stored = null;
  let blocked = true;
  t.mock.method(localStorage, "getItem", () => stored);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    if (blocked) throw new Error("Quota exceeded");
    stored = value;
  });
  const save = new RunSave();
  const g = game();
  save.begin(g);
  assert.equal(stored, null);
  blocked = false;
  assert.equal(save.write(g), true);
  assert.equal(save.restore(game()), true);
  g.wave = 25;
  save.write(g);
  g.wave = 20;
  assert.equal(save.write(g), false, "stale tab cannot replace a wave 25 checkpoint");
  assert.equal(JSON.parse(stored).state.wave, 25);
  save.end();
  const tombstone = stored;
  save.write(g);
  assert.equal(stored, tombstone);
  const replacement = new RunSave();
  blocked = true;
  replacement.begin(g);
  blocked = false;
  assert.equal(replacement.write(g), true, "retry replacing an old run");
  stored = JSON.stringify({ version: 1, id: "other-tab-run", state: {} });
  assert.equal(replacement.write(g), false);
  assert.equal(JSON.parse(stored).id, "other-tab-run");
});

test("late-wave boss saves restore progress and leaderboard metadata", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let stored = null;
  t.mock.method(localStorage, "getItem", () => stored);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    stored = value;
  });
  for (const wave of [20, 21, 24, 25]) {
    const g = game();
    g.wave = wave;
    g.score = wave * 1000;
    g.boss = g.makeBoss(false, 5);
    g.salvageDrone.upgrades.shield = 3;
    g.leaderboardRun = {
      runId: crypto.randomUUID(),
      revision: 90,
      durationSeconds: 800,
      deathCause: null,
      assisted: false,
      finalReport: null,
    };
    const save = new RunSave();
    save.begin(g);
    const restored = game();
    assert.equal(save.restore(restored), true);
    assert.equal(restored.wave, wave);
    assert.equal(restored.score, g.score);
    assert.equal(restored.leaderboardRun.revision, 90);
    assert.equal(restored.salvageDrone.upgrades.shield, 3);
  }
});

test("leaderboard retries old Worker shield rejection and retains failed reports", async (t) => {
  const store = new Map();
  t.mock.method(localStorage, "getItem", (key) => store.get(key) ?? null);
  t.mock.method(localStorage, "setItem", (key, value) => store.set(key, value));
  store.set(
    "helios-leaderboard-player-v1",
    JSON.stringify({ playerId: "pilot", playerToken: "token", username: "TestPilot" }),
  );
  const client = await import("../src/leaderboard/client.ts");
  const g = game();
  g.wave = 25;
  g.salvageDrone.upgrades.shield = 3;
  g.leaderboardRun = {
    runId: crypto.randomUUID(),
    revision: 1,
    durationSeconds: 900,
    deathCause: null,
    assisted: false,
    finalReport: null,
  };
  const report = g.leaderboardReport();
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    return "shield" in body.drone.upgrades
      ? new Response(JSON.stringify({ error: "Unknown Drone upgrade ID." }), { status: 400 })
      : new Response(JSON.stringify({ accepted: true }));
  });
  // Preload persisted work to await the complete drain deterministically.
  store.set("helios-leaderboard-pending-v1", JSON.stringify([report]));
  await client.flushPendingRuns();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].wave, 25);
  assert.equal(sent[0].drone.upgrades.shield, 3);
  assert.equal("shield" in sent[1].drone.upgrades, false);
  assert.equal(client.getSyncStatus(), "saved");
  assert.deepEqual(JSON.parse(store.get("helios-leaderboard-pending-v1")), []);
  // A rejected wave 25 must remain available for retries, including after reload.
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ error: "Temporary rejection" }), { status: 400 }),
  );
  store.set("helios-leaderboard-pending-v1", JSON.stringify([report]));
  await client.flushPendingRuns();
  assert.equal(client.getSyncStatus(), "offline");
  assert.equal(JSON.parse(store.get("helios-leaderboard-pending-v1"))[0].wave, 25);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ accepted: true })));
  await client.flushPendingRuns();
  assert.equal(client.getSyncStatus(), "saved");
  // Reports queued during a slow upload survive removal of the older revision.
  let release;
  let started;
  const requestStarted = new Promise((resolve) => {
    started = resolve;
  });
  t.mock.method(globalThis, "fetch", async () => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return new Response(JSON.stringify({ accepted: true }));
  });
  store.set("helios-leaderboard-pending-v1", JSON.stringify([report]));
  const flushing = client.flushPendingRuns();
  await requestStarted;
  client.queueRun({ ...report, revision: report.revision + 1, status: "dead" });
  release();
  await flushing;
  assert.equal(JSON.parse(store.get("helios-leaderboard-pending-v1"))[0].status, "dead");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ accepted: true })));
  await client.flushPendingRuns();
  assert.deepEqual(JSON.parse(store.get("helios-leaderboard-pending-v1")), []);
});

test("campaign specialists, mines and allied shields survive save and continue", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  g.devSpawnMob("tetherSentinel", 1, 2);
  g.devSpawnMob("mineWarden", 1, 2);
  const [tether, warden] = g.drones;
  tether.x = 250;
  tether.y = g.p.y;
  tether.coop.timer = 0;
  g.updateDroneSpecial(tether, 0.01);
  g.updateDroneSpecial(tether, 1);
  warden.coop.timer = 0;
  g.updateDroneSpecial(warden, 0.01);
  for (let i = 0; i < 6; i++) g.addRocks(g.makeRock(50 + i * 50, 50, 1, 0, 0, "boom"));
  g.rocks[1].x = tether.x + 50;
  g.rocks[1].y = tether.y;
  g.updateTethers(0.1);
  assert.ok(g.rocks[1].supportShield?.hp > 0);
  assert.equal(g.rocks.length, 7);
  const expected = {
    drones: structuredClone(g.drones),
    rocks: structuredClone(g.rocks),
    tethers: structuredClone(g.campaignTethers),
  };
  const save = new RunSave();
  save.begin(g);
  const restored = game();
  assert.equal(save.restore(restored), true);
  assert.deepEqual(restored.drones, expected.drones);
  assert.deepEqual(restored.rocks, expected.rocks);
  assert.deepEqual(restored.campaignTethers, expected.tethers);
  assert.equal(restored.boomRoom(), 0);
  restored.mode = "playing";
  restored.updateTethers(0.1);
  assert.ok(restored.rocks[1].supportShield?.hp > 0);
  assert.equal(restored.campaignTethers.length, 0);
});

test("Range is a capped common upgrade that extends projectile, beam, arc and drone reach without changing damage", async () => {
  const { STAT_UPGRADES } = await import("../src/game/balance.ts");
  const { GAME_CONFIG } = await import("../src/game/game-config.ts");
  const g = game();
  const base = g.weaponStats("pulse", 1),
    beam = g.laserStats(1),
    arc = g.arcStats(1);
  const def = STAT_UPGRADES.find((u) => u.id === "range");
  assert.equal(def.rarity, "common");
  assert.equal(def.max, 3);
  g.devSetStack("range", 999);
  assert.equal(g.stacks.range, 3);
  assert.ok(Math.abs(g.p.rangeMul - 1.4) < 1e-8);
  assert.ok(Math.abs(g.weaponStats("pulse", 1).life / base.life - 1.4) < 1e-8);
  assert.equal(g.weaponStats("pulse", 1).dmg, base.dmg);
  assert.ok(Math.abs(g.laserStats(1).range / beam.range - 1.4) < 1e-8);
  assert.ok(Math.abs(g.arcStats(1).range / arc.range - 1.4) < 1e-8);
  const drone = g.salvageDrone;
  drone.purchased = true;
  drone.active = true;
  drone.fireTimer = 0;
  const range = GAME_CONFIG.salvage.targetRangeBase;
  g.rocks = [g.makeRock(drone.x + range * 1.2, drone.y, 1, 0, 0, "none")];
  g.salvageFire(drone, 0.01);
  assert.ok(g.bullets.length > 0, "range should extend the drone's target acquisition");
  g.devSetStack("range", 0);
  assert.equal(g.p.rangeMul, 1);
});

test("beam levels widen the actual hit corridor and redline heat boosts damage before overheat", () => {
  const g = game(),
    p = g.p;
  p.x = 100;
  p.y = 100;
  p.angle = 0;
  p.weapons.laser = 1;
  const r = g.makeRock(220, 111, 1, 0, 0, "none");
  r.r = 5;
  r.hp = r.maxHp = 100;
  g.rocks = [r];
  const cold = g.laserStats(1);
  g.beamDamage(0.1, 10);
  assert.equal(r.hp, 100);
  p.weapons.laser = 6;
  assert.ok(g.laserStats(6).width > cold.width);
  g.beamDamage(0.1, 10);
  assert.equal(r.hp, 99);
  p.weapons.laser = 1;
  p.heat = 0.8;
  const hot = g.laserStats(1);
  assert.equal(hot.redline, true);
  assert.equal(hot.color, "#ff3d45");
  assert.equal(hot.dps, cold.dps * 1.35);
  assert.equal(g.laserStats(1, true).redline, false, "drone beams do not inherit pilot overheat");
  p.heat = 0.2;
  assert.equal(g.laserStats(1).redline, false);
  assert.equal(g.laserStats(1).dps, cold.dps);
});

test("rail guidance retains a gentle forward assist with a strict total steering limit", () => {
  const g = game();
  g.rocks = [g.makeRock(900, 25, 1, 0, 0, "none")];
  g.drones = [];
  g.boss = null;
  const b = { x: 0, y: 0, vx: 960, vy: 0, kind: "rail", turn: g.weaponStats("rail", 1).turn };
  g.guide(b, 0.1);
  assert.ok(b.vy > 0);
  assert.ok(Math.atan2(b.vy, b.vx) <= 0.018 + 1e-8);
  g.rocks[0].y = 0;
  g.rocks[0].vy = 1000;
  for (let i = 0; i < 100; i++) g.guide(b, 0.1);
  assert.ok(Math.abs(Math.atan2(b.vy, b.vx)) <= 0.17 + 1e-8);
  const offAxis = { ...b, vx: 960, vy: 0, guidanceOrigin: 0, target: undefined };
  g.rocks[0].y = 400;
  g.guide(offAxis, 0.5);
  assert.equal(offAxis.vy, 0);
});

test("ship visibility reads old preferences safely and clamps its persisted slider value", async (t) => {
  const { readFlightSettings } = await import("../src/game/preferences.ts");
  let saved = { shake: false, autoFire: true };
  t.mock.method(localStorage, "getItem", () => JSON.stringify(saved));
  assert.equal(readFlightSettings().shipVisibility, 0);
  assert.equal(readFlightSettings().shake, false);
  saved.shipVisibility = 0.65;
  assert.equal(readFlightSettings().shipVisibility, 0.65);
  saved.shipVisibility = 100;
  assert.equal(readFlightSettings().shipVisibility, 1);
  saved.shipVisibility = "bright";
  assert.equal(readFlightSettings().shipVisibility, 0);
});

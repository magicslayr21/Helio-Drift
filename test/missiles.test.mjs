import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

// Salvo Lock (0.7.0): lock painting, salvo release, Full Lock, graze charge and Crossfire.
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
          { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
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
const { GAME_CONFIG } = await import("../src/game/game-config.ts");
const { STAT_UPGRADES } = await import("../src/game/balance.ts");
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");

const SALVO = GAME_CONFIG.salvo;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const missiles = (g) => g.bullets.filter((b) => b.kind === "missile");

/** A quiet arena: ship at (700, 600) facing up, nothing else alive. */
function game() {
  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ width: 1400, height: 900 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  const g = new Game(canvas, { onHud: noop, onMode: noop });
  g.mode = "playing";
  // wave 0: missile damage scale is exactly 1, so blast numbers read as configured
  g.wave = 0;
  g.saveRun = noop;
  g.gainXp = noop;
  g.rocks = [];
  g.drones = [];
  g.bullets = [];
  g.boss = null;
  Object.assign(g.p, { x: 700, y: 600, angle: -Math.PI / 2, vx: 0, vy: 0, invuln: 0 });
  return g;
}

/** Tough rocks straight ahead (inside the cone) so blasts never kill them mid-test. */
function rocksAhead(g, count, size = 1) {
  for (let i = 0; i < count; i++) {
    const rock = g.makeRock(640 + i * 40, 300, size, 0, 0, "none");
    rock.hp = rock.maxHp = 99999;
    g.rocks.push(rock);
  }
}

/** Hold E for `seconds` in fixed steps. */
function hold(g, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += dt) g.updateMissileLock(dt, true);
}
const release = (g) => g.updateMissileLock(1 / 60, false);

test("the baseline rack is 4 missiles, 12 s regen and 60 / 72 per-missile blasts", () => {
  const g = game();
  assert.equal(g.p.maxMissiles, 4);
  assert.equal(g.p.missiles, 4);
  assert.equal(g.p.missileRegen, 12);
  assert.equal(g.p.blastDmg, 60);
  assert.equal(g.p.blastR, 72);
});

test("locks never exceed the missiles in the rack", () => {
  const g = game();
  rocksAhead(g, 8);
  g.p.missiles = 3;
  hold(g, 2);
  assert.equal(g.p.missileLocks.length, 3);
  // regen during the hold raises the ceiling, a spent rack lowers it
  g.p.missiles = 4;
  hold(g, 0.5);
  assert.equal(g.p.missileLocks.length, 4);
  g.p.missiles = 2;
  hold(g, 0.1);
  assert.equal(g.p.missileLocks.length, 2);
});

test("locks arrive one per 0.11 s and only inside the 70° nose cone", () => {
  const g = game();
  rocksAhead(g, 4);
  // a rock directly behind the ship can never be painted
  const behind = g.makeRock(700, 900, 1, 0, 0, "none");
  g.rocks.push(behind);
  hold(g, 0.1);
  assert.equal(g.p.missileLocks.length, 0);
  hold(g, 0.02);
  assert.equal(g.p.missileLocks.length, 1);
  hold(g, 0.11);
  assert.equal(g.p.missileLocks.length, 2);
  hold(g, 1);
  assert.ok(!g.p.missileLocks.includes(behind.id));
});

test("large rocks take two locks and bosses take any number", () => {
  const g = game();
  rocksAhead(g, 1, 3);
  hold(g, 1);
  assert.equal(g.p.missileLocks.length, 2);
  release(g);
  const b = game();
  b.boss = b.makeBoss(false, 1);
  Object.assign(b.boss, { x: 700, y: 250, vx: 0, vy: 0 });
  hold(b, 1);
  assert.equal(b.p.missileLocks.length, 4);
  assert.ok(b.p.missileLocks.every((id) => id === b.boss.id));
});

test("a lock on a destroyed target is removed; one that leaves the cone is kept", () => {
  const g = game();
  rocksAhead(g, 2);
  hold(g, 0.3);
  assert.equal(g.p.missileLocks.length, 2);
  g.p.angle += Math.PI; // sweep the cone away: both locks persist
  hold(g, 0.2);
  assert.equal(g.p.missileLocks.length, 2);
  g.rocks.shift();
  hold(g, 1 / 60);
  assert.equal(g.p.missileLocks.length, 1);
});

test("releasing with 4 locks spawns 4 missile bullets aimed at their locks", () => {
  const g = game();
  rocksAhead(g, 4);
  hold(g, 0.6);
  assert.equal(g.p.missileLocks.length, 4);
  const locked = [...g.p.missileLocks].sort();
  release(g);
  const shots = missiles(g);
  assert.equal(shots.length, 4);
  assert.equal(g.p.missiles, 0);
  assert.deepEqual(shots.map((b) => b.target).sort(), locked);
  // broadside launch, alternating sides, each with its own corkscrew phase
  const side = (b) => Math.sign(Math.cos(Math.atan2(b.vy, b.vx)));
  assert.deepEqual(shots.map(side), [1, -1, 1, -1]);
  assert.equal(new Set(shots.map((b) => b.spiral.phase)).size, 4);
  assert.ok(g.p.missileTimer > 0.3);
});

test("a tap under 0.15 s spawns exactly 1 missile at the nearest target", () => {
  const g = game();
  rocksAhead(g, 4);
  hold(g, 0.13);
  assert.ok(g.p.missileLocks.length <= 1);
  release(g);
  assert.equal(missiles(g).length, 1);
  assert.equal(g.p.missiles, 3);
  assert.equal(missiles(g)[0].spiral, undefined);
});

test("separate releases keep the 0.35 s missile cooldown", () => {
  const g = game();
  rocksAhead(g, 2);
  hold(g, 0.05);
  release(g);
  hold(g, 0.05);
  release(g);
  assert.equal(missiles(g).length, 1);
});

test("releasing inside the Full Lock window applies ×1.25; outside it does not", () => {
  const inside = game();
  rocksAhead(inside, 4);
  hold(inside, 0.5);
  assert.ok(inside.p.fullLockAt >= 0);
  release(inside);
  assert.equal(missiles(inside).length, 4);
  for (const b of missiles(inside)) {
    assert.equal(b.missileDmg, 60 * 1.25);
    assert.equal(b.fullLock, true);
    assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - SALVO.launchSpeed * 1.2) < 1e-6);
  }
  assert.ok(inside.salvoFlash > 0);

  const late = game();
  rocksAhead(late, 4);
  hold(late, 0.5);
  hold(late, 0.4); // past the 0.3 s window
  release(late);
  assert.equal(missiles(late).length, 4);
  for (const b of missiles(late)) {
    assert.equal(b.missileDmg, 60);
    assert.equal(b.fullLock, undefined);
  }
  assert.equal(late.salvoFlash, 0);
});

test("a salvo missile detonates with its own payload and its corkscrew decays to zero", () => {
  const g = game();
  rocksAhead(g, 1);
  hold(g, 0.3);
  release(g);
  const [b] = missiles(g);
  const blasts = [];
  g.explode = (x, y, r, dmg) => blasts.push({ r, dmg });
  for (let i = 0; i < 600 && g.bullets.length; i++) g.updateBullets(1 / 60);
  assert.equal(blasts.length, 1);
  assert.deepEqual(blasts[0], { r: 72, dmg: 60 });
  assert.ok(Math.abs(b.spiral.offset) <= SALVO.spiralAmplitude);
  // the offset follows sin(t·4π + phase) · 38 · (1 − t) and is gone at t = 1
  const free = {
    x: 0,
    y: 0,
    vx: 380,
    vy: 0,
    spiral: { phase: 0.7, flight: 0.5, age: 0, offset: 0 },
  };
  free.spiral.offset = Math.sin(0.7) * SALVO.spiralAmplitude;
  let peak = 0;
  for (let i = 0; i < 45; i++) {
    g.spiralMissile(free, 1 / 60);
    peak = Math.max(peak, Math.abs(free.spiral.offset));
  }
  assert.ok(peak > 10, "the corkscrew is visible early in flight");
  assert.equal(free.spiral.offset, 0);
});

test("graze adds charge once per object, not every frame", () => {
  const g = game();
  g.p.missiles = 1;
  const rock = g.makeRock(700, 600, 1, 0, 0, "none");
  rock.x = 700 + rock.r + 30; // inside the r + 40 band, outside the hull hit radius
  g.rocks.push(rock);
  for (let i = 0; i < 30; i++) g.shipCollisions(1 / 60);
  assert.equal(g.p.missileCharge, 0, "no payout while still inside the band");
  rock.x = 700 + rock.r + 80;
  for (let i = 0; i < 30; i++) g.shipCollisions(1 / 60);
  assert.ok(Math.abs(g.p.missileCharge - 0.12 * g.p.missileRegen) < 1e-9);
  // passing again never pays twice
  rock.x = 700 + rock.r + 30;
  g.shipCollisions(1 / 60);
  rock.x = 700 + rock.r + 80;
  g.shipCollisions(1 / 60);
  assert.ok(Math.abs(g.p.missileCharge - 0.12 * g.p.missileRegen) < 1e-9);
});

test("enemy shots graze once, and a shot that hits never pays out", () => {
  const g = game();
  g.p.missiles = 1;
  const shot = (x, vx) => ({
    x,
    y: 600,
    vx,
    vy: 0,
    r: 5,
    life: 5,
    dmg: 1,
    kind: "enemy",
    pierce: 0,
    color: "#fff",
    hitIds: new Set(),
    turn: 0,
    bounces: 0,
    fuse: 0,
    extra: 0,
    extraDmg: 0,
  });
  // flies past 30 px above the ship
  const pass = shot(600, 300);
  pass.y = 570;
  g.bullets.push(pass);
  for (let i = 0; i < 60; i++) g.updateBullets(1 / 60);
  assert.ok(Math.abs(g.p.missileCharge - 0.12 * g.p.missileRegen) < 1e-9);
  // a shot straight into the hull is not a graze
  g.p.missileCharge = 0;
  g.bullets = [shot(600, 300)];
  for (let i = 0; i < 60; i++) g.updateBullets(1 / 60);
  assert.equal(g.p.missileCharge, 0);
});

test("kills add 3% charge and boss main-weapon hits add 0.5%", () => {
  const g = game();
  g.p.missiles = 1;
  const rock = g.makeRock(300, 300, 1, 0, 0, "none");
  g.rocks.push(rock);
  g.breakRock(0, 0, 0);
  assert.ok(Math.abs(g.p.missileCharge - 0.03 * 12) < 1e-9);
  g.p.missileCharge = 0;
  g.boss = g.makeBoss(false, 1);
  g.boss.hp = g.boss.maxHp = 1e9;
  const shot = { kind: "plasma", dmg: 1, vx: 0, vy: 0, pierce: 0, hitIds: new Set() };
  g.impact(shot, "boss", 0, g.boss.id);
  assert.ok(Math.abs(g.p.missileCharge - 0.005 * 12) < 1e-9);
});

test("charge overflow loads the next slot and passive regen takes 12 s", () => {
  const g = game();
  g.p.missiles = 2;
  g.addMissileCharge(2.5);
  assert.equal(g.p.missiles, 4);
  assert.equal(g.p.missileCharge, 0);
  g.p.missiles = 3;
  for (let i = 0; i < 11.9 * 60; i++) g.addMissileCharge(1 / 60 / g.p.missileRegen);
  assert.equal(g.p.missiles, 3);
  for (let i = 0; i < 0.2 * 60; i++) g.addMissileCharge(1 / 60 / g.p.missileRegen);
  assert.equal(g.p.missiles, 4);
});

test("Missile Rack: common, 2 stacks, +1 rack each to a maximum of 6", () => {
  const rack = STAT_UPGRADES.find((u) => u.id === "missileRack");
  assert.equal(rack.rarity, "common");
  assert.equal(rack.max, 2);
  const g = game();
  g.p.missiles = 1;
  g.devSetStack("missileRack", 9);
  assert.equal(g.stacks.missileRack, 2);
  assert.equal(g.p.maxMissiles, 6);
  // rebuilding keeps the live missile count rather than refilling the rack
  assert.equal(g.p.missiles, 1);
  rocksAhead(g, 8);
  g.p.missiles = 6;
  hold(g, 1.2);
  assert.equal(g.p.missileLocks.length, 6);
});

test("old saves load with a 4-missile rack, no locks and no errors", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  g.wave = 4;
  new RunSave().begin(g);
  // Rewrite the save as 0.6.7 wrote it: 3-missile rack, old blast and no Salvo fields.
  const saved = JSON.parse(data);
  saved.balanceVersion = 1;
  const p = saved.state.p;
  Object.assign(p, {
    missiles: 2,
    maxMissiles: 3,
    missileRegen: 6.5,
    blastDmg: 68,
    blastR: 96,
    missileCharge: 3,
  });
  for (const key of ["missileLocks", "missileHoldT", "missileLockT", "fullLockAt"]) delete p[key];
  data = JSON.stringify(saved);
  const restored = game();
  assert.equal(new RunSave().restore(restored), true);
  assert.equal(restored.p.maxMissiles, 4);
  assert.equal(restored.p.missiles, 4);
  assert.equal(restored.p.missileRegen, 12);
  assert.equal(restored.p.blastDmg, 60);
  assert.equal(restored.p.blastR, 72);
  assert.deepEqual(restored.p.missileLocks, []);
  assert.equal(restored.p.missileHoldT, -1);
  // and the restored run can paint and fire straight away
  restored.rocks = [];
  rocksAhead(restored, 4);
  hold(restored, 0.6);
  release(restored);
  assert.equal(missiles(restored).length, 4);
});

/* ------------------------------------------------------------ co-op */

function coop() {
  const sim = new LocalCoopSimulation({ seed: 7, callsigns: ["Alpha", "Bravo"] });
  const g = sim.game;
  g.rocks = [];
  g.drones = [];
  g.bullets = [];
  g.boss = null;
  g.waveHold = 999;
  sim.state.team.overdrive = 0;
  return sim;
}

test("co-op missiles carry their pilot's accent colour", () => {
  const sim = coop(),
    g = sim.game;
  for (const [id, color] of [
    ["p1", "#ffb03a"],
    ["p2", "#6fe7ff"],
  ]) {
    g.bindPilot(id);
    const b = g.launchMissile({ angle: 0 });
    assert.equal(b.color, color);
    assert.equal(b.ownerId, id);
  }
});

test("Crossfire: both pilots' missiles on one target within 1 s deal ×1.4 and feed Overdrive", (t) => {
  const sim = coop(),
    g = sim.game;
  const rock = g.makeRock(900, 400, 3, 0, 0, "none");
  rock.hp = rock.maxHp = 1e6;
  g.rocks.push(rock);
  const blasts = [];
  t.mock.method(g, "explode", (x, y, r, dmg) => blasts.push(dmg));
  const strike = (id) => {
    g.bindPilot(id);
    const b = g.launchMissile({ angle: 0, target: rock.id });
    Object.assign(b, { x: rock.x, y: rock.y });
    g.selectBulletPilot(b);
    g.detonateMissile(b);
  };
  strike("p1");
  g.missileClock += 0.6;
  strike("p2");
  // co-op waves scale missile damage; Crossfire is ×1.4 on top of whatever the blast is
  const base = blasts[0];
  close(blasts[1], base * 1.4);
  assert.equal(sim.state.team.overdrive, SALVO.crossfireOverdrive);
  // the same pilot twice is not Crossfire, nor is a hit outside the window
  strike("p2");
  g.missileClock += 1.5;
  strike("p1");
  assert.deepEqual(blasts.slice(2), [base, base]);
});

test("co-op holds E across input samples and fires the salvo on release", () => {
  const sim = coop(),
    g = sim.game;
  const p1 = sim.state.players.p1;
  Object.assign(p1.ship, { x: 400, y: 600, angle: -Math.PI / 2, vx: 0, vy: 0 });
  for (let i = 0; i < 4; i++) {
    const rock = g.makeRock(360 + i * 30, 250, 1, 0, 0, "none");
    rock.hp = rock.maxHp = 1e6;
    g.rocks.push(rock);
  }
  const input = (sequence, missile) => ({
    type: "input",
    playerId: "p1",
    sequence,
    moveX: 0,
    moveY: 0,
    aimAngle: -Math.PI / 2,
    fire: false,
    missile,
    interact: false,
  });
  sim.submit(input(1, true));
  sim.stepTicks(30); // one second of holding
  assert.equal(p1.ship.missileLocks.length, 4);
  assert.equal(g.bullets.filter((b) => b.kind === "missile").length, 0);
  sim.submit(input(2, false));
  sim.stepTicks(1);
  assert.equal(g.bullets.filter((b) => b.kind === "missile" && b.ownerId === "p1").length, 4);
});

test("rooms checkpointed before Salvo Lock restore with the new rack", () => {
  const sim = coop();
  const snapshot = sim.snapshot();
  const ship = snapshot.players.p1.ship;
  Object.assign(ship, { maxMissiles: 3, missiles: 1, missileRegen: 6.5, blastDmg: 68, blastR: 96 });
  for (const key of ["missileLocks", "missileHoldT", "missileLockT", "fullLockAt"])
    delete ship[key];
  const restored = LocalCoopSimulation.restore(snapshot);
  const p = restored.state.players.p1.ship;
  assert.equal(p.maxMissiles, 4);
  assert.equal(p.missiles, 4);
  assert.equal(p.blastDmg, 60);
  assert.deepEqual(p.missileLocks, []);
  restored.stepTicks(2);
});

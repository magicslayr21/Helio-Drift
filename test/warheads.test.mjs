import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

// Warhead Workshop (0.7.1): payload, guidance and trigger parts at Tier I.
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
const { WARHEAD_PARTS, normalizeMissileBuild } = await import("../src/game/balance.ts");
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");

const W = GAME_CONFIG.warheads;
const DT = 1 / 60;
const missiles = (g) => g.bullets.filter((b) => b.kind === "missile");
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function game() {
  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ width: 1400, height: 900 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  const g = new Game(canvas, { onHud: noop, onMode: noop });
  g.mode = "playing";
  g.wave = 3;
  g.saveRun = noop;
  g.gainXp = noop;
  g.rocks = [];
  g.drones = [];
  g.bullets = [];
  g.boss = null;
  g.waveHold = 999;
  Object.assign(g.p, { x: 700, y: 700, angle: -Math.PI / 2, vx: 0, vy: 0, invuln: 0 });
  return g;
}

function rock(g, x, y, size = 1, hp = 1e6) {
  const r = g.makeRock(x, y, size, 0, 0, "none");
  r.hp = r.maxHp = hp;
  g.rocks.push(r);
  return r;
}

/** Fit a full build and launch one missile at a target, parked right on it. */
function armed(g, build, target, at = target) {
  for (const id of Object.values(build)) g.fitWarheadPart(id);
  const b = g.launchMissile({ angle: 0, target: target?.id });
  if (at) Object.assign(b, { x: at.x, y: at.y });
  return b;
}
const build = (parts = {}) => ({
  payload: "blast",
  guidance: "direct",
  trigger: "impact",
  ...parts,
});
const captureBlasts = (g, t) => {
  const blasts = [];
  t.mock.method(g, "explode", (x, y, r, dmg, cause, playerDamage) =>
    blasts.push({ x, y, r, dmg, cause, playerDamage }),
  );
  return blasts;
};

/* ------------------------------------------------------------ table and fitting */

test("the Workshop has 13 parts with the spec's slots and rarities", () => {
  const bySlot = (slot) =>
    Object.keys(WARHEAD_PARTS).filter((id) => WARHEAD_PARTS[id].slot === slot);
  assert.deepEqual(bySlot("payload"), ["blast", "cluster", "gravity", "emp", "incendiary"]);
  assert.deepEqual(bySlot("guidance"), ["direct", "corkscrew", "relay", "orbit"]);
  assert.deepEqual(bySlot("trigger"), ["impact", "proximity", "chain", "delayed"]);
  const rarity = Object.fromEntries(Object.entries(WARHEAD_PARTS).map(([id, p]) => [id, p.rarity]));
  assert.deepEqual(rarity, {
    blast: "default",
    cluster: "rare",
    gravity: "rare",
    emp: "epic",
    incendiary: "common",
    direct: "default",
    corkscrew: "common",
    relay: "epic",
    orbit: "rare",
    impact: "default",
    proximity: "common",
    chain: "epic",
    delayed: "rare",
  });
});

test("new ships fit Blast, Direct and Impact; fitting swaps only its own slot", () => {
  const g = game();
  assert.deepEqual(g.p.missileBuild, build());
  assert.equal(g.fitWarheadPart("orbit"), true);
  assert.deepEqual(g.p.missileBuild, build({ guidance: "orbit" }));
  assert.equal(g.fitWarheadPart("orbit"), false, "already fitted");
  assert.equal(g.fitWarheadPart("plasma"), false, "unknown part");
  assert.equal(g.fitWarheadPart("__proto__"), false);
  assert.deepEqual(g.p.missileBuild, build({ guidance: "orbit" }));
});

test("a refit never changes a missile already in flight", () => {
  const g = game();
  const b = g.launchMissile({ angle: 0 });
  g.fitWarheadPart("cluster");
  assert.equal(b.warhead.payload, "blast");
  assert.equal(g.launchMissile({ angle: 0 }).warhead.payload, "cluster");
});

test("invalid or missing builds normalise to the default parts", () => {
  assert.deepEqual(normalizeMissileBuild(undefined), build());
  assert.deepEqual(
    normalizeMissileBuild({ payload: "relay", guidance: "orbit", trigger: "nope" }),
    build({ guidance: "orbit" }),
  );
});

test("old saves migrate to Blast, Direct and Impact", async (t) => {
  const { RunSave } = await import("../src/game/run-save.ts");
  let data = null;
  t.mock.method(localStorage, "getItem", () => data);
  t.mock.method(localStorage, "setItem", (_key, value) => {
    data = value;
  });
  const g = game();
  g.wave = 4;
  new RunSave().begin(g);
  const saved = JSON.parse(data);
  delete saved.state.p.missileBuild;
  data = JSON.stringify(saved);
  const restored = game();
  assert.equal(new RunSave().restore(restored), true);
  assert.deepEqual(restored.p.missileBuild, build());
  // and a fitted build survives a save round trip
  restored.fitWarheadPart("emp");
  restored.fitWarheadPart("delayed");
  new RunSave().begin(restored);
  const again = game();
  assert.equal(new RunSave().restore(again), true);
  assert.deepEqual(again.p.missileBuild, build({ payload: "emp", trigger: "delayed" }));
});

/* ------------------------------------------------------------ payloads */

test("Blast: 42 damage in a 72 radius", (t) => {
  const g = game();
  const target = rock(g, 400, 300);
  const blasts = captureBlasts(g, t);
  g.detonateMissile(armed(g, build(), target));
  assert.equal(blasts.length, 1);
  assert.equal(blasts[0].dmg, 42);
  assert.equal(blasts[0].r, 72);
});

test("Cluster: 6 bomblets × 16 damage that scatter and detonate without hurting the pilot", (t) => {
  const g = game();
  const target = rock(g, 400, 300);
  g.detonateMissile(armed(g, build({ payload: "cluster" }), target));
  const bomblets = g.bullets.filter((b) => b.kind === "bomblet");
  assert.equal(bomblets.length, W.cluster.bomblets);
  assert.ok(bomblets.every((b) => b.extraDmg === 16));
  // they scatter in every direction
  const angles = bomblets.map((b) => Math.atan2(b.vy, b.vx));
  assert.ok(Math.max(...angles) - Math.min(...angles) > Math.PI);
  g.rocks = [];
  const blasts = captureBlasts(g, t);
  for (let i = 0; i < 60; i++) g.updateBullets(DT);
  assert.equal(blasts.length, 6);
  assert.ok(blasts.every((b) => b.dmg === 16 && b.playerDamage === 0));
});

test("Gravity: pulls small and medium rocks for 1.5 s; large rocks and bosses do not move", () => {
  const g = game();
  const target = rock(g, 400, 300);
  g.detonateMissile(armed(g, build({ payload: "gravity" }), target));
  assert.equal(g.missileZones.length, 1);
  const zone = g.missileZones[0];
  assert.equal(zone.r, 160);
  assert.equal(zone.life, 1.5);
  g.rocks = [];
  const small = rock(g, 500, 300, 1);
  const medium = rock(g, 300, 300, 2);
  const large = rock(g, 400, 420, 3);
  g.boss = g.makeBoss(false, 1);
  Object.assign(g.boss, { x: 400, y: 180, vx: 0, vy: 0 });
  for (let i = 0; i < 30; i++) g.updateMissileZones(DT);
  assert.ok(small.vx < -20, "small rock pulled left toward the well");
  assert.ok(medium.vx > 20, "medium rock pulled right toward the well");
  assert.equal(large.vx, 0);
  assert.equal(large.vy, 0);
  assert.equal(g.boss.vx, 0);
  for (let i = 0; i < 70; i++) g.updateMissileZones(DT);
  assert.equal(g.missileZones.length, 0, "the well closes after 1.5 s");
});

test("EMP: specialists stay offline for 3 s and Tether Sentinel shields drop", () => {
  const g = game();
  const sentinel = g.spawnDrone(400, 400, 500);
  sentinel.fire = 0; // would fire on its very next update
  g.drones.push(sentinel);
  const tether = g.spawnDrone(460, 400, 500);
  tether.coop = { kind: "tetherSentinel", timer: 0, warning: 0, target: null };
  g.drones.push(tether);
  const shielded = rock(g, 420, 360);
  shielded.supportShield = { hp: 20, maxHp: 20, sourceId: tether.id };
  g.detonateMissile(armed(g, build({ payload: "emp" }), sentinel));
  assert.equal(sentinel.emp, 3);
  assert.equal(tether.emp, 3);
  assert.equal(shielded.supportShield, undefined);
  const enemyShots = () => g.bullets.filter((b) => b.kind === "enemy").length;
  for (let i = 0; i < 2.8 * 60; i++) g.update(DT);
  assert.equal(enemyShots(), 0, "an offline sentinel never fires");
  assert.equal(shielded.supportShield, undefined, "an offline tether cannot re-shield");
  for (let i = 0; i < 0.4 * 60; i++) g.update(DT);
  assert.equal(sentinel.emp, 0, "back online after 3 s");
});

test("EMP never touches a boss", () => {
  const g = game();
  g.boss = g.makeBoss(false, 1);
  Object.assign(g.boss, { x: 400, y: 300, vx: 15, vy: -5 });
  const hp = g.boss.hp;
  g.detonateMissile(armed(g, build({ payload: "emp" }), g.boss));
  assert.equal(g.boss.emp, undefined);
  assert.equal(g.boss.vx, 15);
  assert.equal(g.boss.hp, hp);
});

test("Incendiary: a burning patch for 2 s at 20 damage per second, bosses included", () => {
  const g = game();
  const target = rock(g, 400, 300, 2, 1000);
  g.boss = g.makeBoss(false, 1);
  Object.assign(g.boss, { x: 400 + g.boss.r + 30, y: 300, vx: 0, vy: 0 });
  g.boss.hp = g.boss.maxHp = 1e6;
  g.detonateMissile(armed(g, build({ payload: "incendiary" }), target));
  for (let i = 0; i < 2.5 * 60; i++) g.updateMissileZones(DT);
  close(1000 - target.hp, 40, 1e-6);
  close(1e6 - g.boss.hp, 40, 1e-6);
  assert.equal(g.missileZones.length, 0);
});

/* ------------------------------------------------------------ guidance */

test("Direct: turn rate 6.5 and no spiral on a tap", () => {
  const g = game();
  const b = g.launchMissile({ angle: 0 });
  assert.equal(b.turn, 6.5);
  assert.equal(b.spiral, undefined);
});

test("Corkscrew: +15% speed and a wider spiral, even on a tap", () => {
  const g = game();
  g.fitWarheadPart("corkscrew");
  const b = g.launchMissile({ angle: 0 });
  close(Math.hypot(b.vx, b.vy), GAME_CONFIG.salvo.launchSpeed * 1.15);
  assert.equal(b.spiral.amp, W.corkscrew.spiralMultiplier);
});

test("Relay: a kill flies on to another lock at 60% damage, up to 2 hops", () => {
  const g = game();
  const a = rock(g, 300, 300, 1, 1);
  const b = rock(g, 500, 300, 1, 1e6);
  const c = rock(g, 700, 300, 1, 1e6);
  g.fitWarheadPart("relay");
  const first = g.launchMissile({ angle: 0, target: a.id, relayTargets: [a.id, b.id, c.id] });
  Object.assign(first, { x: a.x, y: a.y });
  g.bullets = [];
  g.detonateMissile(first);
  const hop = missiles(g);
  assert.equal(hop.length, 1);
  assert.equal(hop[0].target, b.id);
  assert.equal(hop[0].hops, 1);
  close(hop[0].missileDmg, 42 * 0.6);
  // a hop that does not kill goes no further
  g.bullets = [];
  Object.assign(hop[0], { x: b.x, y: b.y });
  g.detonateMissile(hop[0]);
  assert.equal(missiles(g).length, 0);
  // the hop limit: a killing blast on hop 1 relays again, a killing blast on hop 2 does not
  const kill = (hops) => {
    const victim = rock(g, 900, 300, 1, 1);
    rock(g, 1100, 300);
    const m = g.launchMissile({ angle: 0, target: victim.id, hops });
    Object.assign(m, { x: victim.x, y: victim.y });
    g.bullets = [];
    g.detonateMissile(m);
    assert.ok(!g.rocks.includes(victim), "the blast killed its target");
    return missiles(g).length;
  };
  assert.equal(kill(1), 1, "second hop");
  assert.equal(kill(2), 0, "no third hop");
});

test("Orbit: circles the ship for 1.5 s, blocks 1 enemy shot, then strikes", () => {
  const g = game();
  const target = rock(g, 700, 200);
  g.fitWarheadPart("orbit");
  const m = g.launchMissile({ angle: 0, target: target.id });
  assert.equal(m.orbit.t, 1.5);
  const shot = (y) => ({
    x: 700 + 400,
    y,
    vx: 0,
    vy: 0,
    r: 5,
    life: 5,
    dmg: 10,
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
  const a = shot(700),
    b = shot(700);
  g.bullets.push(a, b);
  // drop both shots onto the orbit path, one after the other
  for (let i = 0; i < 80; i++) {
    if (i === 10) Object.assign(a, { x: m.x, y: m.y });
    if (i === 40) Object.assign(b, { x: m.x, y: m.y + 200 });
    g.updateBullets(DT);
    if (m.orbit) assert.ok(Math.abs(Math.hypot(m.x - 700, m.y - 700) - W.orbit.radius) < 1e-6);
  }
  assert.ok(!g.bullets.includes(a), "the first shot was blocked");
  assert.equal(m.orbit.blocks, 0);
  for (let i = 0; i < 30; i++) g.updateBullets(DT);
  assert.equal(m.orbit, undefined, "broke orbit after 1.5 s");
  assert.ok(m.vy < 0, "and strikes toward the target above");
});

/* ------------------------------------------------------------ triggers */

test("Impact: detonates on contact", (t) => {
  const g = game();
  const target = rock(g, 700, 400);
  const blasts = captureBlasts(g, t);
  const m = g.launchMissile({ angle: -Math.PI / 2, target: target.id });
  for (let i = 0; i < 120 && g.bullets.length; i++) g.updateBullets(DT);
  assert.equal(blasts.length, 1);
  assert.ok(Math.hypot(blasts[0].x - target.x, blasts[0].y - target.y) <= target.r + m.r + 8);
});

test("Proximity: detonates 40 px early with +20% radius", (t) => {
  const g = game();
  const target = rock(g, 700, 300);
  g.fitWarheadPart("proximity");
  const blasts = captureBlasts(g, t);
  const m = g.launchMissile({ angle: -Math.PI / 2, target: target.id });
  for (let i = 0; i < 120 && g.bullets.length; i++) g.updateBullets(DT);
  assert.equal(blasts.length, 1);
  const gap = Math.hypot(blasts[0].x - target.x, blasts[0].y - target.y) - target.r - m.r;
  assert.ok(gap > 25 && gap <= 40, `detonated ${gap.toFixed(1)} px from the hull`);
  close(blasts[0].r, 72 * 1.2);
});

test("Chain: each blast launches one mini missile at 30% damage; minis never chain", (t) => {
  const g = game();
  const target = rock(g, 400, 300);
  rock(g, 600, 300);
  captureBlasts(g, t);
  const m = armed(g, build({ trigger: "chain" }), target);
  g.bullets = [];
  g.detonateMissile(m);
  const minis = missiles(g);
  assert.equal(minis.length, 1);
  assert.equal(minis[0].mini, true);
  close(minis[0].missileDmg, 42 * 0.3);
  g.bullets = [];
  g.detonateMissile(minis[0]);
  assert.equal(missiles(g).length, 0);
});

test("Delayed: sticks to the target and detonates after 1 s for 1.6× damage", (t) => {
  const g = game();
  const target = rock(g, 700, 400);
  target.vx = 60;
  g.fitWarheadPart("delayed");
  const blasts = captureBlasts(g, t);
  const m = g.launchMissile({ angle: -Math.PI / 2, target: target.id });
  let stuckAt = -1;
  for (let i = 0; i < 300 && g.bullets.length; i++) {
    target.x += target.vx * DT; // rocks move on their own update
    g.updateBullets(DT);
    if (m.stuck && stuckAt < 0) stuckAt = i;
    if (m.stuck) {
      close(m.x - target.x, m.stuck.dx);
    }
  }
  assert.ok(stuckAt >= 0, "it stuck");
  assert.equal(blasts.length, 1);
  close(blasts[0].dmg, 42 * 1.6);
});

/* ------------------------------------------------------------ co-op */

test("co-op pilots fit their own warheads through the fitWarhead command", () => {
  const sim = new LocalCoopSimulation({ seed: 3, callsigns: ["Alpha", "Bravo"] });
  const command = (playerId, sequence, part) => ({ type: "fitWarhead", playerId, sequence, part });
  assert.equal(sim.submit(command("p1", 1, "cluster")), true);
  assert.equal(sim.submit(command("p2", 1, "orbit")), true);
  assert.equal(sim.submit(command("p2", 2, "warp-drive")), false);
  sim.stepTicks(1);
  assert.deepEqual(sim.state.players.p1.ship.missileBuild, build({ payload: "cluster" }));
  assert.deepEqual(sim.state.players.p2.ship.missileBuild, build({ guidance: "orbit" }));
  // a room checkpoint from before the Workshop restores with default parts
  const snapshot = sim.snapshot();
  delete snapshot.players.p1.ship.missileBuild;
  const restored = LocalCoopSimulation.restore(snapshot);
  assert.deepEqual(restored.state.players.p1.ship.missileBuild, build());
  assert.deepEqual(restored.state.players.p2.ship.missileBuild, build({ guidance: "orbit" }));
});

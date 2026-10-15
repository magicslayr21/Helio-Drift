import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(candidate)) return next(candidate.href);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    return next(url, context);
  },
});

const { Game } = await import("../src/game/engine.ts");
const { CoopRenderer } = await import("../src/game/coop-renderer.ts");
const { COOP_CONFIG, COOP_FIXED_DT } = await import("../src/game/simulation/coop-config.ts");
const { LocalCoopSimulation } = await import("../src/game/simulation/local-coop.ts");
const { FixedStepRunner } = await import("../src/game/simulation/fixed-step.ts");
const { createWireState } = await import("../src/game/network/wire-state.ts");
const { STAT_UPGRADES } = await import("../src/game/balance.ts");

const input = (playerId, sequence, values = {}) => ({
  type: "input",
  playerId,
  sequence,
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  fire: false,
  missile: false,
  interact: false,
  ...values,
});

function fixture(seed = 41) {
  const sim = new LocalCoopSimulation({ seed, callsigns: ["Alpha", "Bravo"] });
  const g = sim.game;
  g.rocks = [];
  g.drones = [];
  g.bullets = [];
  g.pickups = [];
  g.boss = null;
  g.waveHold = 999;
  for (const [id, x] of [
    ["p1", 100],
    ["p2", 800],
  ]) {
    Object.assign(sim.state.players[id].ship, { x, y: 350, angle: 0, vx: 0, vy: 0, invuln: 0 });
    sim.state.players[id].input.aimAngle = 0;
  }
  sim.drainEvents();
  return sim;
}
const rock = (sim, x = 200, y = 350, size = 1, trait = "none") =>
  sim.game.makeRock(x, y, size, 0, 0, trait);

test("co-op inherits the original campaign combat and renderer", () => {
  const g = fixture().game;
  for (const method of [
    "update",
    "updatePilot",
    "fire",
    "fireMissile",
    "updateBullets",
    "beamDamage",
    "doArc",
    "updateSalvageDrone",
    "updateBoss",
    "updateMk6",
    "bossAttack",
    "rollChoices",
    "buyWeapon",
    "buySalvageUpgrade",
  ])
    assert.equal(
      g[method],
      Game.prototype[method],
      method + " was replaced with alternate gameplay",
    );
  assert.equal(CoopRenderer.prototype.render, Game.prototype.render);
  assert.equal(CoopRenderer.prototype.renderBeam, Game.prototype.renderBeam);
});

test("fixed-step room clock stays at 30 Hz and bounds catch-up", () => {
  const whole = new FixedStepRunner(),
    fragmented = new FixedStepRunner();
  let count = 0;
  whole.advance(1, () => count++);
  assert.equal(count, Math.floor(COOP_CONFIG.maximumCatchUpSeconds * 30));
  for (let frame = 0; frame < 60; frame++) fragmented.advance(1 / 60, () => {});
  assert.equal(fragmented.snapshot().tick, 30);
});

test("every weapon uses the campaign's damage, cadence, effects and projectiles", () => {
  for (const weapon of ["pulse", "spread", "seeker", "ricochet", "flak", "arc", "laser", "rail"]) {
    const sim = fixture();
    const solo = new Game(null, { onHud() {}, onMode() {} }, { headless: true, random: () => 0.5 });
    const g = sim.game;
    g.random = () => 0.5;
    sim.state.players.p2.disabled = true;
    g.bindPilot("p1");
    solo.p = structuredClone(g.p);
    for (const game of [solo, g]) {
      game.mode = "playing";
      game.p.primary = weapon;
      game.p.weapons[weapon] = 3;
      game.keys = { " ": true };
      game.flightIntent = { aimAngle: 0, moveX: 0, moveY: 0 };
      game.rocks = [game.makeRock(240, 350, 3, 0, 0)];
      game.rocks[0].hp = game.rocks[0].maxHp = 10000;
      game.nextId = 100;
      game.frame = 1;
      game.wave = 1;
      for (let i = 0; i < 60; i++) game.updatePilot(1 / 60);
    }
    assert.deepEqual(g.p, solo.p, weapon + " pilot state");
    assert.equal(g.rocks[0].hp, solo.rocks[0].hp, weapon + " damage");
    const physics = (bullets) => bullets.map(({ id, ownerId, weapon, ...b }) => b);
    assert.deepEqual(physics(g.bullets), physics(solo.bullets), weapon + " projectile physics");
    assert.deepEqual(g.arcs, solo.arcs, weapon + " arc effects");
  }
});

test("two pilots move independently and stale or malformed inputs are rejected", () => {
  const sim = fixture(),
    a = sim.state.players.p1,
    b = sim.state.players.p2;
  assert.ok(sim.submit(input("p1", 1, { moveY: -1, aimAngle: -Math.PI / 2 })));
  assert.ok(sim.submit(input("p2", 1, { moveX: 1 })));
  assert.equal(sim.submit(input("p1", 1)), false);
  assert.equal(sim.submit(input("p1", 2, { moveX: NaN })), false);
  sim.stepTicks(30);
  assert.ok(a.ship.y < 350);
  assert.ok(b.ship.x > 800);
  assert.equal(a.credits, b.credits);
});

test("seeded inputs, JSON checkpoints and restoring mid-combat replay identically", () => {
  const a = new LocalCoopSimulation({ seed: 0xdecafbad }),
    b = new LocalCoopSimulation({ seed: 0xdecafbad });
  for (const sim of [a, b]) {
    sim.submit(input("p1", 1, { moveX: 1, moveY: -1, aimAngle: -0.5, fire: true }));
    sim.submit(input("p2", 1, { moveX: -1, aimAngle: 2.8, fire: true }));
  }
  for (let i = 0; i < 120; i++) a.advance(1 / 60);
  b.stepTicks(60);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.drainEvents(), b.drainEvents());
  const encoded = JSON.parse(JSON.stringify(a.snapshot()));
  assert.deepEqual(encoded, a.snapshot());
  const restored = LocalCoopSimulation.restore(encoded);
  for (const sim of [a, restored])
    sim.submit(input("p1", 2, { moveY: 1, aimAngle: 1.2, fire: true }));
  a.stepTicks(45);
  restored.stepTicks(45);
  assert.deepEqual(restored.snapshot(), a.snapshot());
});

test("native shots retain their owner even after enemy AI selects the other pilot", () => {
  const sim = fixture(),
    g = sim.game;
  sim.state.players.p2.ship.x = 100;
  sim.state.players.p1.ship.x = 800;
  const target = rock(sim);
  target.hp = target.maxHp = 1;
  g.rocks = [target];
  sim.submit(input("p2", 1, { fire: true }));
  sim.stepTicks(10);
  assert.equal(sim.state.players.p2.stats.asteroidKills, 1);
  assert.equal(sim.state.players.p1.stats.damage, 0);
  assert.equal(sim.drainEvents().find((e) => e.type === "asteroidDestroyed")?.playerId, "p2");
});

test("native fragmentation preserves normal fragments and boom cleanup", () => {
  for (const trait of ["none", "boom"]) {
    const sim = fixture(),
      g = sim.game;
    g.rocks = [rock(sim, 500, 300, 3, trait)];
    g.bindPilot("p1");
    g.breakRock(0, 0, 0);
    g.releasePilot();
    if (trait === "boom") assert.equal(g.rocks.length, 0);
    else {
      assert.ok(g.rocks.length > 0);
      assert.ok(g.rocks.every((r) => r.size === 2));
    }
  }
});

test("upgrades are rolled by the campaign and purchases remain independently owned", () => {
  const sim = fixture(),
    g = sim.game,
    a = sim.state.players.p1,
    b = sim.state.players.p2;
  a.credits = 3000;
  b.credits = 0;
  g.bindPilot("p1");
  g.triggerLevelUp();
  g.releasePilot();
  const offered = a.campaign.choices[0].id;
  const absent = STAT_UPGRADES.find((u) => !a.campaign.choices.some((c) => c.id === u.id)).id;
  for (const c of [
    { type: "buyWeapon", playerId: "p1", sequence: 1, weapon: "spread" },
    { type: "buyWeapon", playerId: "p2", sequence: 1, weapon: "spread" },
    { type: "chooseUpgrade", playerId: "p1", sequence: 2, upgrade: absent },
    { type: "chooseUpgrade", playerId: "p1", sequence: 3, upgrade: offered },
    { type: "buyDrone", playerId: "p1", sequence: 4 },
    { type: "buyDroneUpgrade", playerId: "p1", sequence: 5, upgrade: "armor" },
  ])
    assert.ok(sim.submit(c));
  sim.stepTicks();
  assert.equal(a.ship.weapons.spread, 1);
  assert.equal(b.ship.weapons.spread, 0);
  assert.equal(a.upgrades[offered], 1);
  assert.equal(a.upgrades[absent], undefined);
  assert.equal(a.drone.upgrades.armor, 1);
  assert.equal(b.drone.purchased, false);
  assert.equal(b.credits, 0);
  assert.equal(sim.drainEvents().filter((e) => e.type === "purchaseRejected").length, 2);
});

test("queued upgrade racks reroll safely and never grant more than the campaign cap", () => {
  const sim = fixture(),
    g = sim.game,
    a = sim.state.players.p1;
  g.bindPilot("p1");
  g.triggerLevelUp();
  g.triggerLevelUp();
  g.releasePilot();
  a.credits = 1000;
  assert.equal(a.upgradePoints, 2);
  const cost = a.campaign.rerollCost;
  sim.submit({ type: "rerollUpgrades", playerId: "p1", sequence: 1 });
  sim.stepTicks();
  assert.equal(a.credits, 1000 - cost);
  const id = a.campaign.choices[0].id,
    def = STAT_UPGRADES.find((u) => u.id === id);
  a.upgrades[id] = def.max;
  sim.submit({ type: "chooseUpgrade", playerId: "p1", sequence: 2, upgrade: id });
  sim.stepTicks();
  assert.equal(a.upgrades[id], def.max);
  const valid = a.campaign.choices.find((c) => c.id !== id).id;
  sim.submit({ type: "chooseUpgrade", playerId: "p1", sequence: 3, upgrade: valid });
  sim.stepTicks();
  assert.equal(a.upgradePoints, 1);
  assert.ok(
    a.campaign.choices.every(
      (c) => (a.upgrades[c.id] ?? 0) < STAT_UPGRADES.find((u) => u.id === c.id).max,
    ),
  );
});

test("native hostile projectiles can hit either pilot without friendly fire", () => {
  const sim = fixture(),
    g = sim.game,
    a = sim.state.players.p1,
    b = sim.state.players.p2;
  g.enemyBullet(b.ship.x, b.ship.y, 0, 0, 10);
  sim.stepTicks();
  assert.equal(a.ship.hull, a.ship.maxHull);
  assert.ok(b.ship.hull < b.ship.maxHull);
  const before = b.ship.hull;
  a.ship.x = b.ship.x - 35;
  sim.submit(input("p1", 1, { fire: true }));
  sim.stepTicks(10);
  assert.equal(b.ship.hull, before);
});

test("area blasts and anomaly exposure apply separately to both pilots", () => {
  const sim = fixture(),
    g = sim.game,
    a = sim.state.players.p1,
    b = sim.state.players.p2;
  a.ship.x = 490;
  b.ship.x = 510;
  g.bindPilot("p1");
  g.enemyBlast(500, 350, 100, 5);
  g.releasePilot();
  assert.equal(a.ship.hull, a.ship.maxHull - 5);
  assert.equal(b.ship.hull, b.ship.maxHull - 5);
  g.bindPilot("p1");
  g.boss = g.makeBoss(false, 3);
  g.mkHole(g.boss, 0, 10, 300);
  const hole = g.boss.hole;
  hole.x = a.ship.x;
  hole.y = a.ship.y;
  b.ship.x = 800;
  a.ship.invuln = b.ship.invuln = 0;
  const before = a.ship.hull,
    other = b.ship.hull;
  for (let i = 0; i < 61; i++) g.updateHole(g.boss, 1 / 60);
  g.releasePilot();
  assert.equal(a.ship.hull, before - 1);
  assert.equal(b.ship.hull, other);
});

test("revives require uninterrupted proximity and both deaths end the room", () => {
  const sim = fixture(),
    g = sim.game,
    a = sim.state.players.p1,
    b = sim.state.players.p2;
  b.disabled = true;
  b.ship.hull = 0;
  b.ship.x = a.ship.x + 40;
  sim.submit(input("p1", 1, { interact: true }));
  sim.stepTicks(30);
  assert.ok(b.reviveProgress > 0.9);
  g.bindPilot("p1");
  g.damagePlayer(1);
  g.releasePilot();
  sim.stepTicks();
  assert.equal(b.reviveProgress, 0);
  sim.stepTicks(120);
  assert.equal(b.disabled, false);
  assert.equal(b.ship.hull, b.ship.maxHull * COOP_CONFIG.revive.healthFraction);
  assert.equal(a.stats.revives, 1);
  for (const id of ["p1", "p2"]) {
    g.bindPilot(id);
    g.p.invuln = 0;
    g.damagePlayer(999);
    g.releasePilot();
  }
  assert.equal(sim.state.phase, "defeat");
});

test("Overdrive remains shared while using the campaign's weapon stats", () => {
  const sim = fixture(),
    g = sim.game;
  const normal = g.weaponStats("pulse", 1).dmg;
  sim.state.team.overdrive = 100;
  sim.submit({ type: "activateOverdrive", playerId: "p2", sequence: 1 });
  sim.stepTicks();
  assert.equal(sim.state.team.overdrive, 0);
  assert.equal(g.weaponStats("pulse", 1).dmg, normal * COOP_CONFIG.overdrive.damageMultiplier);
  assert.ok(sim.drainEvents().some((e) => e.type === "overdriveActivated"));
});

test("both pilots fire their own missiles and maintain independent drone repair cooldowns", () => {
  const sim = fixture(),
    g = sim.game;
  for (const id of ["p1", "p2"]) {
    const p = sim.state.players[id];
    p.credits = 2000;
    g.bindPilot(id);
    g.buySalvageDrone();
    g.buySalvageUpgrade("repairPulse");
    g.releasePilot();
    p.campaign.quietTime = 10;
    p.drone.pulseTimer = 0;
    p.ship.hull = p.ship.maxHull - 10;
    p.drone.x = p.ship.x + 20;
    p.drone.y = p.ship.y;
    sim.submit(input(id, 1, { missile: true }));
  }
  g.bindPilot("p1");
  g.damageSalvageDrone(1);
  g.releasePilot();
  sim.stepTicks();
  for (const id of ["p1", "p2"]) {
    assert.equal(sim.state.players[id].ship.missiles, sim.state.players[id].ship.maxMissiles - 1);
    assert.ok(g.bullets.some((b) => b.kind === "missile" && b.ownerId === id));
  }
  assert.equal(sim.state.players.p1.ship.hull, sim.state.players.p1.ship.maxHull - 10);
  assert.equal(sim.state.players.p2.ship.hull, sim.state.players.p2.ship.maxHull - 9);
  assert.ok(sim.state.players.p1.campaign.quietTime < 1);
  assert.ok(sim.state.players.p2.campaign.quietTime > 10);
});

test("enemy target selection follows the nearest living pilot; late Spikers retain radial volleys", () => {
  const sim = fixture(),
    g = sim.game;
  g.selectTarget(750, 350);
  assert.equal(g.activeId, "p2");
  sim.state.players.p2.disabled = true;
  g.selectTarget(750, 350);
  assert.equal(g.activeId, "p1");
  g.wave = 22;
  const spiker = g.spawnDrone(500, 100, 500, "spiker");
  spiker.fire = 0;
  g.drones = [spiker];
  g.releasePilot();
  for (let i = 0; i < 30 && !g.bullets.some((b) => b.kind === "enemy"); i++) sim.stepTicks();
  const shots = g.bullets.filter((b) => b.kind === "enemy");
  assert.equal(shots.length, 8);
  const angles = shots.map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++)
    assert.ok(Math.abs(angles[i] - angles[i - 1] - Math.PI / 4) < 1e-6);
});

test("co-op specialists use native chassis with allied shields and deployed mines", () => {
  const sim = fixture(),
    g = sim.game;
  g.wave = 14;
  g.spawnCoopEscorts();
  const tether = g.drones.find((d) => d.coop?.kind === "tetherSentinel");
  const warden = g.drones.find((d) => d.coop?.kind === "mineWarden");
  assert.equal(tether.kind, "sentinel");
  assert.equal(warden.kind, "warden");
  tether.coop.timer = 0;
  warden.coop.timer = 0;
  sim.stepTicks(30);
  assert.ok(g.rocks.some((r) => r.coopMine));
  assert.equal(sim.state.tethers.length, 0, "support Sentinels no longer tether players");
  const target = g.makeRock(tether.x + 50, tether.y, 2, 0, 0, "none");
  g.rocks.push(target);
  g.updateTethers(1 / 60);
  assert.ok(target.supportShield?.hp > 0);
  const hull = target.hp;
  g.loseRockHp(target, 3);
  assert.equal(target.hp, hull);
  target.x = tether.x + COOP_CONFIG.tetherSentinel.shieldRange + 1;
  g.updateTethers(1 / 60);
  assert.equal(target.supportShield, undefined);
  const mine = g.rocks.find((r) => r.coopMine);
  assert.equal(g.boomRoom(), 6, "mines should not consume the campaign boom-asteroid limit");
  g.bindPilot("p1");
  g.hitRock(g.rocks.indexOf(mine), 999, 0, 0, false);
  g.releasePilot();
  assert.ok(!g.rocks.includes(mine));
});

test("new checkpoints preserve the full boss script and older rooms migrate without resetting pilots", () => {
  const sim = fixture(),
    g = sim.game;
  g.bindPilot("p1");
  g.wave = 25;
  g.startBonusBoss();
  g.releasePilot();
  sim.stepTicks(20);
  const saved = sim.snapshot();
  const restored = LocalCoopSimulation.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
  const old = structuredClone(saved);
  delete old.campaign;
  for (const p of Object.values(old.players)) delete p.campaign;
  old.players.p1.credits = 1234;
  old.players.p1.upgradePoints = 2;
  const migrated = LocalCoopSimulation.restore(old).snapshot();
  assert.equal(migrated.players.p1.credits, 1234);
  assert.equal(migrated.players.p1.upgradePoints, 2);
  assert.equal(migrated.players.p1.campaign.choices.length, 3);
  assert.equal(migrated.players.p1.ship.hull, old.players.p1.ship.hull);
  assert.equal(migrated.team.wave, 25);
  assert.equal(migrated.campaign.boss.mk, 6);
  assert.equal(migrated.campaign.boss.hp, old.boss.hp);
});

test("wire snapshots include native visuals without duplicate worlds or private RNG state", () => {
  const sim = fixture();
  sim.game.rocks = [rock(sim)];
  const saved = sim.snapshot(),
    wire = createWireState(saved);
  for (const key of ["seed", "randomState", "clockAccumulator", "nextEntityId"])
    assert.ok(!(key in wire));
  assert.ok(wire.campaign.rocks[0].pts.length > 0);
  assert.deepEqual(wire.rocks, []);
  wire.campaign.rocks[0].hp = 0;
  assert.ok(saved.campaign.rocks[0].hp > 0);
});

test("restoring a room preserves each pilot's anomaly and MK6 contact timers", () => {
  const sim = fixture(),
    g = sim.game;
  g.bindPilot("p1");
  g.boss = g.makeBoss(false, 6);
  g.mkHole(g.boss, 0, 20, 500);
  g.boss.hole.x = sim.state.players.p1.ship.x;
  g.boss.hole.y = 350;
  for (let i = 0; i < 30; i++) g.updateHole(g.boss, 1 / 60);
  g.forEachPilot(() => {
    g.boss.mk6.beamCd = g.activeId === "p1" ? 0.4 : 0.2;
  });
  g.releasePilot();
  const saved = sim.snapshot();
  assert.ok(saved.players.p1.campaign.anomalyTimer > 0.49);
  assert.equal(saved.players.p2.campaign.anomalyTimer, 0);
  const restored = LocalCoopSimulation.restore(JSON.parse(JSON.stringify(saved)));
  sim.stepTicks(5);
  restored.stepTicks(5);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
});

test("campaign and co-op developer consoles share bounded field and loadout operations", async () => {
  const { applyDeveloperCommand, validDeveloperCommand } = await import(
    "../src/game/developer-command.ts"
  );
  const sim = fixture(),
    g = sim.game;
  const campaign = new Game(null, { onHud() {}, onMode() {} }, { headless: true });
  campaign.mode = "playing";
  campaign.wave = g.wave;
  campaign.credits = sim.state.players.p1.credits;
  const other = structuredClone(sim.state.players.p2);
  for (const command of [
    { action: "adjust", field: "credits", amount: 1000 },
    { action: "stack", id: "crit", level: 2 },
    { action: "weapons" },
    { action: "droneCount", count: 2 },
    { action: "droneUpgrade", id: "scan", level: 2 },
    { action: "droneWeapon", id: "laser" },
    { action: "heal" },
  ]) {
    assert.equal(validDeveloperCommand(command), true);
    assert.equal(applyDeveloperCommand(campaign, command), true);
    assert.equal(sim.developer("p1", command), true);
  }
  const pilot = sim.state.players.p1;
  assert.equal(pilot.credits, campaign.credits);
  assert.deepEqual(pilot.ship.weapons, campaign.p.weapons);
  assert.deepEqual(pilot.upgrades, campaign.stacks);
  assert.equal(pilot.drone.upgrades.scan, campaign.salvageDrone.upgrades.scan);
  assert.equal(pilot.drone.weapon, campaign.salvageDrone.weapon);
  assert.deepEqual(sim.state.players.p2, other);
  for (const command of [
    { action: "enemy", kind: "bogus", count: 1, size: 2 },
    { action: "enemy", kind: "mineWarden", count: 51, size: 2 },
    { action: "stack", id: "bogus", level: 1 },
    { action: "adjust", field: "credits", amount: Infinity },
    { action: "droneUpgrade", id: "scan", level: 100 },
  ]) {
    assert.equal(sim.developer("p1", command), false);
  }
  sim.stepTicks(3);
  const tick = sim.state.tick;
  assert.equal(sim.developer("p1", { action: "restart" }), true);
  assert.equal(sim.state.team.wave, 1);
  assert.equal(sim.state.team.score, 0);
  assert.equal(sim.state.players.p1.ship.weapons.laser, 0);
  assert.equal(sim.state.players.p1.callsign, "Alpha");
  assert.equal(sim.state.tick, tick);
  sim.stepTicks();
  assert.equal(sim.state.tick, tick + 1);
});

test("campaign developer spawns share allied shield and mine abilities", () => {
  const g = new Game(null, { onHud() {}, onMode() {} }, { headless: true, random: () => 0.5 });
  g.mode = "playing";
  g.wave = 15;
  g.waveHold = 999;
  g.devSpawnMob("tetherSentinel", 1, 2);
  g.devSpawnMob("mineWarden", 1, 3);
  const tether = g.drones.find((d) => d.coop?.kind === "tetherSentinel");
  const warden = g.drones.find((d) => d.coop?.kind === "mineWarden");
  assert.equal(tether.kind, "sentinel");
  assert.equal(warden.kind, "warden");
  const ally = g.makeRock(tether.x + 40, tether.y, 2, 0, 0, "none");
  g.rocks.push(ally);
  g.p.vx = 0;
  g.p.vy = 0;
  g.updateTethers(0.1);
  assert.ok(ally.supportShield?.hp > 0);
  assert.equal(g.campaignTethers.length, 0);
  assert.equal(g.p.vx, 0);
  assert.equal(g.p.vy, 0);
  warden.coop.timer = 0;
  g.updateDroneSpecial(warden, 0.01);
  const mine = g.rocks.find((r) => r.coopMine);
  assert.ok(mine);
  assert.equal(g.boomRoom(), 6, "mines do not use the normal boom limit");
  mine.coopMine.armTimer = 0;
  g.p.x = mine.x;
  g.p.y = mine.y;
  g.p.invuln = 0;
  g.updateRockSpecial(mine, 0.01);
  g.updateRockSpecial(mine, 1);
  assert.ok(!g.rocks.includes(mine));
  assert.ok(g.p.hull < g.p.maxHull);
  g.drones = [];
  g.updateTethers(0.1);
  assert.equal(g.campaignTethers.length, 0);
});

test("paused loadout transactions preserve combat time and reject stale or combat commands", () => {
  const sim = fixture();
  sim.developer("p1", { action: "credits" });
  const before = sim.snapshot();
  assert.equal(
    sim.pausedCommand({ type: "buyWeapon", playerId: "p1", sequence: 100, weapon: "spread" }),
    true,
  );
  assert.ok(sim.state.players.p1.ship.weapons.spread > 0);
  assert.equal(
    sim.pausedCommand({ type: "selectWeapon", playerId: "p1", sequence: 101, weapon: "spread" }),
    true,
  );
  assert.equal(sim.state.players.p1.ship.primary, "spread");
  assert.equal(
    sim.pausedCommand({ type: "selectWeapon", playerId: "p1", sequence: 100, weapon: "pulse" }),
    false,
  );
  assert.equal(
    sim.pausedCommand({ type: "activateOverdrive", playerId: "p1", sequence: 102 }),
    false,
  );
  assert.equal(sim.state.tick, before.tick);
  assert.equal(sim.state.team.elapsedSeconds, before.team.elapsedSeconds);
  assert.deepEqual(sim.state.players.p2, before.players.p2);
  assert.deepEqual(sim.game.rocks, before.campaign.rocks);
});

test("support shields absorb damage, recharge without stacking, exclude bosses and collapse with their source", () => {
  const sim = fixture(),
    g = sim.game;
  g.devSpawnMob("tetherSentinel", 2);
  const source = g.drones[0],
    second = g.drones[1];
  source.x = 400;
  source.y = 300;
  second.x = 420;
  second.y = 300;
  const rock = g.makeRock(450, 300, 2, 0, 0, "none");
  g.rocks.push(rock);
  g.devSpawnMob("warden");
  const enemy = g.drones.at(-1);
  enemy.x = 460;
  enemy.y = 300;
  g.boss = g.makeBoss(false, 3);
  g.boss.x = 450;
  g.boss.y = 300;
  g.updateTethers(0.1);
  const shield = rock.supportShield.hp,
    health = rock.hp;
  assert.equal(shield, Math.max(8, Math.min(28, rock.maxHp * 0.12)));
  assert.ok(enemy.supportShield.hp > 0);
  assert.equal(g.boss.supportShield, undefined);
  g.loseRockHp(rock, shield + 5);
  assert.equal(rock.hp, health - 5);
  assert.equal(rock.supportShield.hp, 0);
  g.updateTethers(1);
  assert.equal(rock.supportShield.hp, 4);
  g.drones = g.drones.filter((d) => d.coop?.kind !== "tetherSentinel");
  g.loseRockHp(rock, 3);
  assert.equal(rock.hp, health - 8);
  assert.equal(rock.supportShield, undefined);
  g.updateTethers(0.1);
  assert.equal(enemy.supportShield, undefined);
});

test("Rift Spikers unlock only in co-op, warn before gravity pulses and survive checkpoints", () => {
  const sim = fixture(),
    g = sim.game;
  g.wave = 15;
  g.spawnCoopEscorts();
  assert.ok(!g.drones.some((d) => d.coop?.kind === "riftSpiker"));
  g.wave = 16;
  g.spawnCoopEscorts();
  const rift = g.drones.find((d) => d.coop?.kind === "riftSpiker");
  assert.ok(rift);
  assert.equal(rift.kind, "spiker");
  g.spawnCoopEscorts();
  assert.equal(g.drones.filter((d) => d.coop?.kind === "riftSpiker").length, 1);
  rift.x = 400;
  rift.y = 300;
  rift.coop.timer = 0;
  for (const p of Object.values(sim.state.players)) {
    p.ship.x = 500;
    p.ship.y = 300;
    p.ship.vx = 0;
    p.ship.vy = 0;
    p.ship.invuln = 0;
  }
  const hull = sim.state.players.p1.ship.hull;
  g.updateDroneSpecial(rift, 0.01);
  assert.ok(rift.coop.warning > 1);
  assert.equal(sim.state.players.p1.ship.hull, hull);
  g.updateDroneSpecial(rift, 0.1);
  assert.ok(sim.state.players.p1.ship.vx < 0);
  const resumed = LocalCoopSimulation.restore(sim.snapshot());
  assert.ok(resumed.game.drones.find((d) => d.coop?.kind === "riftSpiker").coop.warning > 0);
  for (let i = 0; i < 80; i++) g.updateDroneSpecial(rift, 1 / 60);
  assert.ok(sim.state.players.p1.ship.hull < hull);
  assert.ok(sim.state.players.p1.ship.vx > 0);
  rift.fire = 0;
  g.updateSpiker(rift, 0.01);
  assert.equal(g.bullets.filter((b) => b.damageCause === "Rift Spiker spiral volley").length, 4);
  g.bullets = [];
  g.wave = 20;
  rift.fire = 0;
  g.updateSpiker(rift, 0.01);
  assert.equal(g.bullets.filter((b) => b.damageCause === "Rift Spiker spiral volley").length, 8);
  g.wave = 21;
  g.spawnCoopEscorts();
  assert.equal(g.drones.filter((d) => d.coop?.kind === "riftSpiker").length, 2);
  const campaign = new Game(null, { onHud() {}, onMode() {} }, { headless: true });
  campaign.devSpawnMob("riftSpiker");
  assert.equal(campaign.drones[0].coop.kind, "riftSpiker");
  campaign.mode = "playing";
  const devRift = campaign.drones[0];
  for (const [wave, shots] of [
    [19, 4],
    [20, 8],
  ]) {
    campaign.wave = wave;
    campaign.bullets = [];
    devRift.fire = 0;
    campaign.updateSpiker(devRift, 0.01);
    assert.equal(campaign.bullets.length, shots);
  }
  devRift.coop.timer = 0;
  campaign.updateDroneSpecial(devRift, 0.01);
  assert.ok(devRift.coop.warning > 0);
});

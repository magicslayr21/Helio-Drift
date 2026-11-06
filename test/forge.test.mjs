import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

// Warhead Forge (0.7.2): blueprints, merges, mastery, bench, scrap and the four new parts.
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
const { WARHEAD_PARTS, rollBlueprintOffers, partPrice, mergePrice, masteryPrice, masteryKills } =
  await import("../src/game/balance.ts");
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

/** Launch one missile at a target with the fitted (or given) build, parked right on it. */
function armed(g, build, target, at = target) {
  if (build) for (const id of Object.values(build)) g.devFitPart(id);
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

const F = GAME_CONFIG.forge;
/** Force a specific offer list for a test. */
function offer(g, ...ids) {
  const f = g.forgeOf();
  f.offerWave = g.wave;
  f.offers = ids.map((id) => ({ id, sold: false }));
}

/* ------------------------------------------------------------ prices and thresholds */

test("list prices, merge prices and Tier III prices follow the spec", () => {
  assert.equal(partPrice("incendiary"), 150);
  assert.equal(partPrice("cryo"), 320);
  assert.equal(partPrice("siphon"), 620);
  assert.equal(partPrice("blast"), 150, "default parts are priced as common");
  assert.equal(mergePrice("cryo"), 192);
  assert.deepEqual(
    ["blast", "corkscrew", "orbit", "relay"].map(masteryPrice),
    [360, 360, 770, 1490],
  );
  assert.deepEqual(["emp", "cryo", "proximity", "impact"].map(masteryKills), [90, 120, 150, 150]);
});

/* ------------------------------------------------------------ offers */

test("the same seed produces the same blueprint offers", () => {
  const roll = (seed, wave = 8, rolls = 0) =>
    rollBlueprintOffers({ seed, wave, rolls, owned: [] }).map((o) => o.id);
  assert.deepEqual(roll(1234), roll(1234));
  assert.deepEqual(roll(1234, 9, 2), roll(1234, 9, 2));
  assert.notDeepEqual(
    [roll(1), roll(2), roll(3), roll(4)].map(String),
    [roll(1), roll(1), roll(1), roll(1)].map(String),
  );
  // and through two separate games sharing a run seed
  const a = game(),
    b = game();
  a.runSeed = b.runSeed = 99;
  a.wave = b.wave = 7;
  a.ensureBlueprintOffers();
  b.ensureBlueprintOffers();
  assert.equal(a.forgeOf().offers.length, 3);
  assert.deepEqual(a.forgeOf().offers, b.forgeOf().offers);
});

test("epic blueprints appear only from wave 6, and defaults only as merges", () => {
  for (let seed = 0; seed < 200; seed++) {
    const early = rollBlueprintOffers({ seed, wave: 5, rolls: 0, owned: [] });
    assert.ok(early.every((o) => WARHEAD_PARTS[o.id].rarity !== "epic"));
    assert.ok(early.every((o) => WARHEAD_PARTS[o.id].rarity !== "default"));
    assert.equal(new Set(early.map((o) => o.id)).size, early.length, "offers are distinct");
  }
  let epics = 0;
  for (let seed = 0; seed < 200; seed++)
    epics += rollBlueprintOffers({ seed, wave: 6, rolls: 0, owned: [] }).filter(
      (o) => WARHEAD_PARTS[o.id].rarity === "epic",
    ).length;
  assert.ok(epics > 50);
});

test("Known blueprints appear twice as often; Daily Flare ignores them", () => {
  const count = (known) => {
    let n = 0;
    for (let seed = 0; seed < 3000; seed++)
      n += rollBlueprintOffers({ seed, wave: 3, rolls: 0, owned: [], known }).some(
        (o) => o.id === "cryo",
      )
        ? 1
        : 0;
    return n;
  };
  const base = count([]),
    known = count(["cryo"]);
  assert.ok(known > base * 1.3, `${known} vs ${base}`);
  const g = game();
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ version: 1, known: ["cryo"] }),
    setItem: noop,
    removeItem: noop,
  };
  assert.deepEqual(g.knownBlueprints(), ["cryo"]);
  g.dailyFlare = true;
  assert.deepEqual(g.knownBlueprints(), []);
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
});

test("the paid reroll refreshes the blueprint offers together with the upgrade rack", () => {
  const g = game();
  g.credits = 1000;
  g.rerollCost = 40;
  g.wave = 8;
  g.ensureBlueprintOffers();
  const before = g
    .forgeOf()
    .offers.map((o) => o.id)
    .join();
  g.choices = g.rollChoices();
  const choicesBefore = g.choices;
  assert.equal(g.rerollChoices(), 40);
  assert.equal(g.credits, 960);
  assert.notEqual(g.choices, choicesBefore);
  assert.equal(g.forgeOf().offerRolls, 1);
  // a reroll with no level-up waiting refreshes offers but never grants upgrade cards
  g.choices = [];
  g.rerollChoices();
  assert.deepEqual(g.choices, []);
  assert.equal(g.forgeOf().offerRolls, 2);
  assert.equal(typeof before, "string");
});

/* ------------------------------------------------------------ buying */

test("buying fits the part at once and the replaced part moves to the bench", () => {
  const g = game();
  g.credits = 2000;
  offer(g, "cryo", "corkscrew", "siphon");
  assert.equal(g.buyBlueprint(0), true);
  assert.equal(g.credits, 2000 - 320);
  assert.equal(g.forgeOf().fitted.payload.id, "cryo");
  assert.equal(g.p.missileBuild.payload, "cryo");
  // the stock Blast was untouched, so it is simply discarded (it can be refitted free)
  assert.deepEqual(g.forgeOf().bench, [null, null]);
  assert.equal(g.buyBlueprint(0), false, "sold");
  offer(g, "solarFlare");
  assert.equal(g.buyBlueprint(0), true);
  assert.equal(g.forgeOf().bench[0].id, "cryo", "a bought part goes to the bench");
  assert.equal(g.forgeOf().bench[0].spent, 320);
});

test("a full bench blocks buying a part that would need it", () => {
  const g = game();
  g.credits = 5000;
  const f = g.forgeOf();
  f.bench = [
    { id: "gravity", tier: 1, kills: 0, spent: 320 },
    { id: "emp", tier: 1, kills: 0, spent: 620 },
  ];
  g.devFitPart("cluster");
  g.forgeOf().fitted.payload.spent = 320;
  offer(g, "incendiary");
  assert.equal(g.blueprintBlocked(0), "BENCH FULL");
  assert.equal(g.buyBlueprint(0), false);
  assert.equal(g.credits, 5000);
});

/* ------------------------------------------------------------ merge, mastery, scrap */

test("a merge raises Tier I to II and charges 60% of list price", () => {
  const g = game();
  g.credits = 2000;
  offer(g, "cryo");
  g.buyBlueprint(0);
  offer(g, "cryo");
  const info = g.forgeShopInfo().offers[0];
  assert.equal(info.merge, true);
  assert.equal(info.price, Math.round(320 * 0.6));
  const credits = g.credits;
  assert.equal(g.buyBlueprint(0), true);
  assert.equal(g.credits, credits - 192);
  assert.equal(g.forgeOf().fitted.payload.tier, 2);
  assert.equal(g.forgeOf().fitted.payload.spent, 320 + 192);
  // Tier II parts are not offered again
  const owned = g.ownedParts();
  for (let seed = 0; seed < 100; seed++)
    assert.ok(
      !rollBlueprintOffers({ seed, wave: 9, rolls: 0, owned }).some((o) => o.id === "cryo"),
    );
});

test("stock parts merge too: a Blast offer appears only as a merge", () => {
  const owned = game().ownedParts();
  let seen = 0;
  for (let seed = 0; seed < 400; seed++)
    seen += rollBlueprintOffers({ seed, wave: 3, rolls: 0, owned }).some((o) => o.id === "blast")
      ? 1
      : 0;
  assert.ok(seen > 0);
  const g = game();
  g.credits = 500;
  offer(g, "blast");
  assert.equal(g.forgeShopInfo().offers[0].price, 90);
  assert.equal(g.buyBlueprint(0), true);
  assert.equal(g.forgeOf().fitted.payload.tier, 2);
});

test("Tier III stays unavailable until the kill threshold is reached", () => {
  const g = game();
  g.credits = 5000;
  g.devFitPart("cryo", 2, 0);
  const need = masteryKills("cryo");
  assert.equal(need, 120);
  assert.equal(g.buyMastery("cryo"), false);
  // kills only count when this part's warhead lands the final hit
  g.warheadCredit = { payload: "cryo", guidance: "direct", trigger: "impact" };
  for (let i = 0; i < need - 1; i++) g.creditWarheadKill();
  assert.equal(g.forgeShopInfo().fitted.payload.masteryReady, false);
  assert.equal(g.buyMastery("cryo"), false);
  g.creditWarheadKill();
  g.warheadCredit = null;
  assert.equal(g.forgeOf().fitted.payload.kills, need);
  assert.equal(g.forgeShopInfo().fitted.payload.masteryReady, true);
  assert.ok(g.texts.some((t) => t.text === "MASTERY READY"));
  assert.equal(g.buyMastery("cryo"), true);
  assert.equal(g.credits, 5000 - 770);
  assert.equal(g.forgeOf().fitted.payload.tier, 3);
});

test("kills by other weapons, or by a part that is not fitted, never count", () => {
  const g = game();
  g.devFitPart("cryo", 2);
  g.creditWarheadKill(); // a pulse-cannon kill: no warhead credit
  g.warheadCredit = { payload: "blast", guidance: "direct", trigger: "impact" };
  g.creditWarheadKill(); // an old Blast missile still in flight after the refit
  g.warheadCredit = null;
  assert.equal(g.forgeOf().fitted.payload.kills, 0);
  assert.equal(g.forgeOf().fitted.guidance.kills, 1, "Direct was fitted on that missile");
  // a real rock kill by a missile blast credits every fitted part of that warhead
  g.devFitPart("blast", 1);
  g.devFitPart("direct", 1);
  const r = rock(g, 300, 300, 1, 1);
  const m = g.launchMissile({ angle: 0, target: r.id });
  Object.assign(m, { x: r.x, y: r.y });
  g.detonateMissile(m);
  assert.ok(!g.rocks.includes(r), "the blast killed the rock");
  assert.equal(g.forgeOf().fitted.payload.kills, 1, "Blast got the kill");
  assert.equal(g.forgeOf().fitted.guidance.kills, 1, "and so did Direct");
  assert.equal(g.warheadCredit, null, "credit never leaks past the detonation");
});

test("a part taken to Tier III becomes a Known blueprint in the profile record", () => {
  const writes = {};
  globalThis.localStorage = {
    getItem: (k) => writes[k] ?? null,
    setItem: (k, v) => {
      writes[k] = v;
    },
    removeItem: noop,
  };
  const g = game();
  g.credits = 5000;
  g.devFitPart("orbit", 2, 120);
  assert.equal(g.buyMastery("orbit"), true);
  assert.deepEqual(JSON.parse(writes["helios-blueprints-v1"]).known, ["orbit"]);
  assert.equal(writes["helios-run-v1"], undefined, "kept apart from the run save");
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
});

test("scrapping refunds exactly 50% of total spent, including merges and mastery", () => {
  const g = game();
  g.credits = 0;
  g.forgeOf().bench = [
    { id: "relay", tier: 3, kills: 90, spent: 620 + 372 + 1490 },
    { id: "cryo", tier: 2, kills: 4, spent: 320 + 192 },
  ];
  assert.equal(g.forgeShopInfo().bench[0].scrap, 1241);
  assert.equal(g.scrapBench(0), true);
  assert.equal(g.credits, 1241);
  assert.equal(g.scrapBench(1), true);
  assert.equal(g.credits, 1241 + 256);
  assert.deepEqual(g.forgeOf().bench, [null, null]);
  assert.equal(g.scrapBench(0), false);
});

test("swapping between bench and Workshop is free and keeps tier and kills", () => {
  const g = game();
  g.credits = 100;
  g.devFitPart("cluster", 2, 33);
  g.forgeOf().fitted.payload.spent = 512;
  g.forgeOf().bench[1] = { id: "gravity", tier: 1, kills: 7, spent: 320 };
  assert.equal(g.swapBench(1), true);
  assert.equal(g.credits, 100);
  assert.deepEqual(g.forgeOf().fitted.payload, { id: "gravity", tier: 1, kills: 7, spent: 320 });
  assert.deepEqual(g.forgeOf().bench[1], { id: "cluster", tier: 2, kills: 33, spent: 512 });
  assert.equal(g.p.missileBuild.payload, "gravity");
  // and the stock part refits for free, benching the bought one
  assert.equal(g.fitWarheadPart("blast"), true);
  assert.equal(g.forgeOf().fitted.payload.id, "blast");
  assert.equal(g.forgeOf().bench[0].id, "gravity");
});

test("old saves migrate to three Tier I default parts with an empty bench", async (t) => {
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
  // a 0.7.1 save: a free-fitted Cluster and no forge, run seed or bonus locks
  saved.state.p.missileBuild = { payload: "cluster", guidance: "orbit", trigger: "delayed" };
  delete saved.state.p.forge;
  delete saved.state.p.bonusLocks;
  delete saved.state.runSeed;
  data = JSON.stringify(saved);
  const restored = game();
  assert.equal(new RunSave().restore(restored), true);
  const f = restored.forgeOf();
  assert.deepEqual(
    Object.values(f.fitted).map((p) => [p.id, p.tier, p.kills, p.spent]),
    [
      ["blast", 1, 0, 0],
      ["direct", 1, 0, 0],
      ["impact", 1, 0, 0],
    ],
  );
  assert.deepEqual(f.bench, [null, null]);
  assert.deepEqual(restored.p.missileBuild, build());
  assert.equal(restored.p.bonusLocks, 0);
  assert.equal(typeof restored.runSeed, "number");
  assert.equal(f.offers.length, 3, "the restored wave has its offers");
});

/* ------------------------------------------------------------ new parts */

test("Solar Flare: targets in the blast take +20% damage from all sources for 4 s", () => {
  const g = game();
  const target = rock(g, 400, 300, 2, 1000);
  g.devFitPart("solarFlare");
  g.detonateMissile(armed(g, null, target));
  assert.equal(target.sunburn.bonus, 0.2);
  assert.equal(target.sunburn.t, 4);
  g.hitRock(0, 50, 0, 0, false);
  close(1000 - target.hp, 60);
  for (let i = 0; i < 4.1 * 60; i++) g.updateWarheadMarks(DT);
  assert.equal(target.sunburn, undefined);
  g.hitRock(0, 50, 0, 0, false);
  close(1000 - target.hp, 110);
});

test("Solar Flare II: +30% for 5 s and Sentinels stop firing for 1.5 s", () => {
  const g = game();
  const s = g.spawnDrone(400, 300, 500);
  s.fire = 0.1;
  g.drones.push(s);
  g.devFitPart("solarFlare", 2);
  g.detonateMissile(armed(g, null, s));
  assert.equal(s.sunburn.bonus, 0.3);
  assert.equal(s.sunburn.t, 5);
  assert.ok(s.fire >= 1.5);
});

test("Prominence (III): a marked kill marks nearby targets", () => {
  const g = game();
  const a = rock(g, 400, 300, 1, 1);
  const b = rock(g, 470, 300, 1, 1e6);
  g.devFitPart("solarFlare", 3);
  g.markSunburn(a.id, 4, 0.3, true);
  g.hitRock(0, 10, 0, 0, false);
  assert.ok(!g.rocks.includes(a));
  assert.equal(b.sunburn.bonus, 0.3);
});

test("Cryo: freezes for 1.5 s; a hit shatters a frozen rock into 4 shards × 10", () => {
  const g = game();
  const target = rock(g, 400, 300, 3, 1e6);
  target.vx = 50;
  g.devFitPart("cryo");
  g.detonateMissile(armed(g, null, target));
  assert.equal(target.frozen, 1.5);
  assert.equal(target.vx, 0);
  const x = target.x;
  g.update(DT);
  assert.equal(target.x, x, "frozen rocks do not move");
  g.hitRock(g.rocks.indexOf(target), 1, 0, 0, false);
  assert.ok(!g.rocks.includes(target), "shattered");
  assert.equal(g.rocks.length, 0, "no split children");
  const shards = g.bullets.filter((b) => b.kind === "shrap");
  assert.equal(shards.length, 4);
  assert.ok(shards.every((b) => b.dmg === 10));
});

test("Cryo: a rock thaws back to its old velocity; bosses are slowed 40% instead", () => {
  const g = game();
  const r = rock(g, 400, 300, 2, 1e6);
  r.vx = 80;
  g.devFitPart("cryo");
  g.detonateMissile(armed(g, null, r));
  for (let i = 0; i < 1.6 * 60; i++) g.update(DT);
  assert.equal(r.frozen, 0);
  assert.equal(r.vx, 80);
  const b = game();
  b.boss = b.makeBoss(false, 1);
  b.boss.hp = b.boss.maxHp = 1e9;
  b.devFitPart("cryo");
  b.detonateMissile(armed(b, null, b.boss));
  assert.equal(b.boss.chill, 1.5);
  assert.equal(b.boss.frozen, undefined);
});

test("Permafrost (Cryo III): frozen rocks block enemy shots", () => {
  const g = game();
  const r = rock(g, 700, 500, 3, 1e6);
  g.devFitPart("cryo", 3);
  g.detonateMissile(armed(g, null, r));
  const shot = {
    x: 700,
    y: 400,
    vx: 0,
    vy: 300,
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
  };
  g.bullets.push(shot);
  const hull = g.p.hull;
  for (let i = 0; i < 90; i++) g.updateBullets(DT);
  assert.ok(!g.bullets.includes(shot));
  assert.equal(g.p.hull, hull);
});

test("Boomerang: a lost target re-locks the nearest once, then it flies home to be caught", () => {
  const g = game();
  g.p.missiles = 2;
  const a = rock(g, 700, 300);
  g.devFitPart("boomerang");
  const m = g.launchMissile({ angle: -Math.PI / 2, target: a.id });
  assert.equal(m.boomerang.relocks, 1);
  const b = rock(g, 900, 300);
  g.rocks = g.rocks.filter((r) => r !== a); // target dies
  g.updateBullets(DT);
  assert.equal(m.target, b.id, "re-locked the nearest");
  assert.equal(m.boomerang.relocks, 0);
  g.rocks = [];
  g.updateBullets(DT);
  assert.equal(m.boomerang.returning, true, "nothing left: it heads home");
  for (let i = 0; i < 400 && g.bullets.includes(m); i++) g.updateBullets(DT);
  assert.ok(!g.bullets.includes(m), "caught");
  close(g.p.missileCharge, 0.3 * g.p.missileRegen);
});

test("Return Fire (Boomerang III): a caught missile adds +1 lock to the next salvo", () => {
  const g = game();
  g.devFitPart("boomerang", 3);
  const m = g.launchMissile({ angle: 0 });
  m.boomerang.returning = true;
  Object.assign(m, { x: g.p.x + 5, y: g.p.y });
  g.updateBullets(DT);
  assert.equal(g.p.bonusLocks, 1);
  assert.equal(g.lockCeiling(), g.p.missiles + 1);
  // the bonus lock fires without spending a rack missile
  for (let i = 0; i < 5; i++) rock(g, 600 + i * 40, 300);
  for (let t = 0; t < 1; t += DT) g.updateMissileLock(DT, true);
  assert.equal(g.p.missileLocks.length, 5);
  g.bullets = [];
  g.updateMissileLock(DT, false);
  assert.equal(missiles(g).length, 5);
  assert.equal(g.p.missiles, 0);
  assert.equal(g.p.bonusLocks, 0);
});

test("Siphon refunds 8% per enemy hit and never more than 1 missile per salvo", () => {
  const g = game();
  g.p.missiles = 0;
  g.devFitPart("siphon");
  for (let i = 0; i < 4; i++) rock(g, 400 + i * 10, 300, 1, 1e6);
  const m = g.launchMissile({ angle: 0, salvo: 7 });
  Object.assign(m, { x: 410, y: 300 });
  g.detonateMissile(m);
  close(g.siphonSalvos[7], 0.32);
  close(g.p.missileCharge, 0.32 * g.p.missileRegen);
  // a dense field: 30 hostiles per blast, three blasts in the same salvo
  for (let i = 0; i < 30; i++) rock(g, 380 + (i % 6) * 8, 290 + Math.floor(i / 6) * 8, 1, 1e6);
  for (let k = 0; k < 3; k++) {
    const b = g.launchMissile({ angle: 0, salvo: 7 });
    Object.assign(b, { x: 400, y: 300 });
    g.detonateMissile(b);
  }
  close(g.siphonSalvos[7], 1);
  assert.ok(g.siphonSalvos[7] <= F.offers && g.siphonSalvos[7] <= 1 + 1e-9);
  // a new salvo has its own cap
  const c = g.launchMissile({ angle: 0, salvo: 8 });
  Object.assign(c, { x: 400, y: 300 });
  g.detonateMissile(c);
  close(g.siphonSalvos[8], 1);
});

test("Feedback (Siphon III): a Full Lock salvo refunds one whole missile", () => {
  const g = game();
  g.devFitPart("siphon", 3);
  for (let i = 0; i < 4; i++) rock(g, 640 + i * 40, 300);
  for (let t = 0; t < 0.5; t += DT) g.updateMissileLock(DT, true);
  assert.ok(g.p.fullLockAt >= 0);
  g.updateMissileLock(DT, false);
  assert.equal(missiles(g).length, 4);
  assert.equal(g.p.missiles, 1);
});

/* ------------------------------------------------------------ tier II and III for earlier parts */

test("Blast II deals 50 in an 80 radius; Aftershock (III) follows 0.4 s later at 40%", (t) => {
  const g = game();
  const target = rock(g, 400, 300, 3, 1e6);
  g.devFitPart("blast", 3);
  const blasts = captureBlasts(g, t);
  g.detonateMissile(armed(g, null, target));
  assert.deepEqual([blasts[0].dmg, blasts[0].r], [50, 80]);
  for (let i = 0; i < 0.45 * 60; i++) g.updatePendingBlasts(DT);
  assert.equal(blasts.length, 2);
  close(blasts[1].dmg, 20);
});

test("Impact II adds 10%; Breach (III) adds 40% against boss hulls", () => {
  const g = game();
  g.boss = g.makeBoss(false, 1);
  Object.assign(g.boss, { x: 400, y: 300 });
  g.boss.hp = g.boss.maxHp = 1e6;
  g.devFitPart("impact", 3);
  g.detonateMissile(armed(g, null, g.boss));
  close(1e6 - g.boss.hp, 42 * 1.1 * 1.4, 1e-6);
});

test("Relay II hops 3 times at 70%; Chainbreaker (III) gains 10% per hop", () => {
  const g = game();
  g.devFitPart("relay", 3);
  const a = rock(g, 300, 300, 1, 1);
  rock(g, 600, 300);
  const m = g.launchMissile({ angle: 0, target: a.id });
  Object.assign(m, { x: a.x, y: a.y });
  g.bullets = [];
  g.detonateMissile(m);
  close(missiles(g)[0].missileDmg, 42 * 1.1);
  const two = game();
  two.devFitPart("relay", 2);
  const v = rock(two, 300, 300, 1, 1);
  rock(two, 600, 300);
  const n = two.launchMissile({ angle: 0, target: v.id, hops: 2 });
  Object.assign(n, { x: v.x, y: v.y });
  two.bullets = [];
  two.detonateMissile(n);
  assert.equal(missiles(two).length, 1, "a third hop at Tier II");
});

test("Proximity Airburst (III) deletes enemy shots inside the blast", () => {
  const g = game();
  const target = rock(g, 400, 300);
  g.devFitPart("proximity", 3);
  const shot = { x: 430, y: 300, vx: 0, vy: 0, r: 5, life: 5, dmg: 1, kind: "enemy" };
  g.bullets.push(shot);
  g.detonateMissile(armed(g, null, target));
  assert.equal(shot.life, 0);
});

test("Chain II minis carry 40%; Cascade (III) lets a mini chain once more", (t) => {
  const g = game();
  captureBlasts(g, t);
  g.devFitPart("chain", 3);
  const target = rock(g, 400, 300);
  rock(g, 600, 300);
  rock(g, 800, 300);
  const m = armed(g, null, target);
  g.bullets = [];
  g.detonateMissile(m);
  const [mini] = missiles(g);
  close(mini.missileDmg, 42 * 0.4);
  assert.equal(mini.chainDepth, 1);
  g.bullets = [];
  g.detonateMissile(mini);
  const [second] = missiles(g);
  assert.ok(second, "the mini chained");
  g.bullets = [];
  g.detonateMissile(second);
  assert.equal(missiles(g).length, 0, "but only once");
});

test("Delayed II: 0.8 s fuse at 1.8×; Detonator (III): a tap sets every charge off at 2×", (t) => {
  const g = game();
  g.devFitPart("delayed", 3);
  const r = rock(g, 400, 300);
  const blasts = captureBlasts(g, t);
  const m = g.launchMissile({ angle: 0, target: r.id });
  g.missileContact(m, r.id);
  close(m.stuck.t, 0.8);
  g.p.missileTimer = 0;
  const rack = g.p.missiles;
  g.updateMissileLock(DT, true);
  g.updateMissileLock(DT, false);
  assert.equal(blasts.length, 1);
  close(blasts[0].dmg, 84);
  assert.equal(g.p.missiles, rack, "the tap detonated instead of firing");
});

test("EMP Overload (III): disabled enemies take +50% damage", () => {
  const g = game();
  const d = g.spawnDrone(400, 300, 1000);
  g.drones.push(d);
  g.devFitPart("emp", 3);
  g.detonateMissile(armed(g, null, d));
  g.damageDrone(0, 100, false, true);
  assert.equal(1000 - d.hp, 150);
});

test("Itano (Corkscrew III): a missile that runs out spirals back for one more pass", () => {
  const g = game();
  g.devFitPart("corkscrew", 3);
  const target = rock(g, 700, 100, 1, 1e6);
  const m = g.launchMissile({ angle: Math.PI / 2, target: target.id });
  m.life = DT / 2;
  g.updateBullets(DT);
  assert.ok(g.bullets.includes(m), "it looped back instead of detonating");
  assert.equal(m.itano, true);
  m.life = DT / 2;
  g.updateBullets(DT);
  assert.ok(!g.bullets.includes(m), "only one extra pass");
});

test("Orbit II circles 2.5 s and blocks 2 shots; Lead (Direct III) turns harder", () => {
  const g = game();
  g.devFitPart("orbit", 2);
  const m = g.launchMissile({ angle: 0 });
  assert.deepEqual([m.orbit.t, m.orbit.blocks], [2.5, 2]);
  const d = game();
  d.devFitPart("direct", 3);
  const lead = d.launchMissile({ angle: 0 });
  close(Math.hypot(lead.vx, lead.vy), GAME_CONFIG.salvo.launchSpeed * 1.2);
  assert.ok(lead.turn > GAME_CONFIG.salvo.turn);
});

test("Incendiary II burns 3 s at 28/s; Gravity II opens a 2 s, 200-radius well", () => {
  const g = game();
  const target = rock(g, 400, 300, 2, 1000);
  g.devFitPart("incendiary", 2);
  g.detonateMissile(armed(g, null, target));
  for (let i = 0; i < 3.5 * 60; i++) g.updateMissileZones(DT);
  close(1000 - target.hp, 84, 1e-6);
  const w = game();
  const r = rock(w, 400, 300);
  w.devFitPart("gravity", 2);
  w.detonateMissile(armed(w, null, r));
  assert.deepEqual([w.missileZones[0].r, w.missileZones[0].life], [200, 2]);
});

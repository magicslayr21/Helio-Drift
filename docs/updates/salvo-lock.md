# Salvo Lock — missile system redesign

Design spec for the next missile update to Helios Drift. Put this file in `docs/updates/` and
build it in the three phases below, in order. Each phase is a separate release and pull request.

Follow `AGENTS.md` for every phase: update `src/game/update-log.ts` and bump the version in
`package.json` and `package-lock.json`. Run `npm run typecheck`, `npm run game:test` and
`npm run build`, and test save migrations for any new persisted field. Campaign and co-op share
one implementation (see README, "Online co-op"), so put missile behaviour in the campaign engine
and balance tables only. Don't write a second co-op version.

Current version: `0.6.7-alpha.1`.

---

## How missiles work today (baseline)

- `GAME_CONFIG.player` in `src/game/game-config.ts`: `maxMissiles: 3`, `missileRegen: 6.5`,
  `blastDamage: 68`, `blastRadius: 96`.
- Player fields (`src/game/types.ts`, created in `src/game/balance.ts`): `missiles`,
  `maxMissiles`, `missileTimer`, `missileRegen`, `missileCharge`, `missileHeld`, `blastDmg`,
  `blastR`.
- Input in `engine.ts`: the `e` key is edge-triggered (search `// missiles: edge-triggered`).
  It calls `fireMissile()`, which spawns one `kind: "missile"` bullet aimed at
  `nearestTarget(p.x, p.y, 900 * rangeMul)` with `turn: 6.5`. `guide()` steers it, and
  `explode(x, y, p.blastR, p.blastDmg)` detonates it.
- Regen: `missileCharge += dt` gives one missile every `missileRegen` seconds, followed by a
  "MISSILE READY" float text.
- HUD: `PlayerStatus.tsx` shows rack pips and `missileCharge`.
- Shop: `ShopScreen.tsx` has a disabled `shop-tab--unreleased` Missiles tab ("In development").
- No upgrade currently changes `maxMissiles`. The stat reset near the `keepMissiles` block
  restores `maxMissiles` and `missileRegen` from base.

---

## Phase 1 — Lock, salvo and graze (`0.7.0-alpha.1`, "Salvo lock")

### Paint and release

- **Hold E** to open a lock cone from the ship's nose: 70° total width (±35°) and 700 px long,
  multiplied by `rangeMul`.
- While E is held, a target that is inside the cone gains a lock every **0.11 s**. Targets are
  rocks, specialists and bosses (anything `nearestTarget` can return). Large rocks (size 3) can
  take up to 2 locks; bosses can take any number. Locks must not exceed the number of missiles
  currently in the rack.
- Turning the ship while holding sweeps the cone. A locked target that leaves the cone keeps its
  lock. A lock is removed if its target dies.
- **Release E:** fire one missile per lock. Each launches at ±90° from the ship's nose
  (alternating sides), with a spiral phase offset per missile, then `guide()` steers it to its
  target. Add a decaying sine offset perpendicular to velocity for the corkscrew:
  `offset = sin(t * 4π + phase) * 38 * (1 - t)`, where `t` is normalised flight time.
- **Tap E** (released within 0.15 s, with 0 or 1 locks): fire one missile at the nearest target,
  as today.
- Keep the existing 0.35 s `missileTimer` between separate releases.
- **Full Lock:** when locks equal the missiles in the rack, flash the reticle ring and record
  `fullLockAt`. Releasing within **0.3 s** of `fullLockAt` gives the salvo ×1.25 damage, +20%
  missile speed and a short white screen flash. Holding longer cancels nothing; the bonus is just
  missed.

### Damage

- Per-missile blast is **42 damage, 72 radius** (a 4-missile salvo is 168 total, compared with 68
  today). Put these in `GAME_CONFIG.player` as new values; don't hard-code them.

### Graze charge

- Passive regen becomes one missile every **12 s**.
- **Graze:** a rock or enemy projectile that passes within `obstacleRadius + 14 + 26` px of the
  ship without colliding adds **+12%** of a missile's charge. Each object can graze once (store a
  flag on the object). Show a small "GRAZE" float text.
- **Kills** add +3% each. Main-weapon hits on bosses add +0.5% per hit.
- Starting rack becomes **4**. Add a new common upgrade, **Missile Rack**: 2 stacks, +1 rack each
  (maximum 6). Rack size is also the lock limit.
- HUD: a segmented charge ring around the ship, one segment per rack slot, drawn in the canvas
  renderer. Keep the `PlayerStatus.tsx` pips.

### Co-op: Crossfire

- Locks render in each pilot's accent colour. If both pilots' missiles hit the same target within
  1 s of each other, the hit counts as Crossfire: ×1.4 damage and a bonus to shared Overdrive.

### Tests (add to `test/game-balance.test.mjs` or a new `test/missiles.test.mjs`)

- Locks never exceed the missiles in the rack.
- Releasing with 4 locks spawns 4 missile bullets.
- A tap under 0.15 s spawns exactly 1 missile.
- Graze adds charge once per object, not every frame.
- Releasing inside the Full Lock window applies ×1.25; releasing outside it does not.
- Old saves load with a 4-missile rack and no errors.

---

## Phase 2 — Warhead Workshop (`0.7.1-alpha.1`, "Warhead workshop")

Enable the Missiles shop tab (remove `shop-tab--unreleased` and `disabled`). The tab shows three
slots, payload, guidance and trigger, with one part fitted in each. Add a `WARHEAD_PARTS` table in
`balance.ts` and `missileBuild: { payload, guidance, trigger }` on the player. Migrate old saves to
Blast, Direct and Impact.

| Slot     | Part       | Rarity  | Effect (Tier I)                                                     |
| -------- | ---------- | ------- | ------------------------------------------------------------------- |
| Payload  | Blast      | Default | 42 dmg, 72 radius                                                   |
| Payload  | Cluster    | Rare    | 6 bomblets × 16 dmg that scatter and detonate                       |
| Payload  | Gravity    | Rare    | 1.5 s pull, 160 radius, on small and medium rocks                   |
| Payload  | EMP        | Epic    | Disables specialists for 3 s; drops Tether Sentinel shields         |
| Payload  | Incendiary | Common  | Burning patch for 2 s, 20 dmg/s                                     |
| Guidance | Direct     | Default | Turn rate 6.5                                                       |
| Guidance | Corkscrew  | Common  | +15% speed, wider spiral                                            |
| Guidance | Relay      | Epic    | On a kill, flies on to another lock at 60% damage, up to 2 hops     |
| Guidance | Orbit      | Rare    | Circles the ship for 1.5 s blocking 1 enemy shot each, then strikes |
| Trigger  | Impact     | Default | Detonates on contact                                                |
| Trigger  | Proximity  | Common  | Detonates 40 px early, +20% radius                                  |
| Trigger  | Chain      | Epic    | Each blast spawns a mini missile at 30% damage                      |
| Trigger  | Delayed    | Rare    | Sticks, detonates after 1 s for 1.6× damage                         |

Bosses take full effect from damage parts. Control effects (Gravity pull, EMP disable) don't
affect boss movement.

---

## Phase 3 — Warhead Forge and four new parts (`0.7.2-alpha.1`, "Warhead forge")

### New parts

| Slot     | Part        | Rarity | Tier I effect                                                                                                                       |
| -------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Payload  | Solar Flare | Epic   | Sunburn: targets in the blast take +20% damage from all sources for 4 s                                                             |
| Payload  | Cryo        | Rare   | Freeze 1.5 s; a hit on a frozen rock shatters it into 4 shards × 10 dmg. Bosses are slowed 40% instead                              |
| Guidance | Boomerang   | Rare   | A missile that misses, or whose target dies, re-locks the nearest target once; catching it unused refunds 30% of a missile's charge |
| Trigger  | Siphon      | Epic   | Each enemy hit by a blast refunds 8% of a missile's charge, capped at 1 missile per salvo                                           |

The Workshop now has 17 parts (7 payloads, 5 guidance, 5 triggers).

### Buying

- The Missiles tab shows **3 blueprint offers** per shop visit. Epic parts can appear from wave 6.
  Use rarity weights in line with the weapon shop.
- Prices: common **150**, rare **320**, epic **620**. Default parts are free and fitted at Tier I.
- The existing paid reroll refreshes upgrade and blueprint offers together.
- Buying a part fits it immediately. The replaced part moves to the bench.
- Roll offers from the seeded shop stream so Daily Flare offers stay identical for every pilot.

### Upgrading

- **Tier I → II (merge):** an offer matching an owned part shows a "MERGE → II" ribbon and costs
  60% of list price. Buying it raises the owned part to Tier II.
- **Tier II → III (mastery):** each part counts kills made while equipped (a missile blast,
  bomblet, shard or burn landing the final hit). Thresholds are 90 kills for epic, 120 for rare
  and 150 for common and default parts. When the threshold is reached, a Tier III upgrade appears
  in the tab for `round5(price × 1.55²)`: 360 for common and default parts (priced as 150), 770
  for rare, 1,490 for epic.
- HUD: a thin mastery bar under the rack and a "MASTERY READY" float text.

### Bench and scrap

- 2 bench slots keep tier and kills. Swapping between bench and Workshop is free in any shop.
- Scrapping a part returns 50% of all credits spent on it, including merges.

### Between runs

- Parts reset each run. A part taken to Tier III becomes a **Known blueprint** (stored in a
  profile record separate from `run-save.ts`) and appears 2× as often in later runs. Daily Flare
  ignores Known blueprints.

### Co-op

- Each pilot has their own Forge and bench. During the shared shop, a pilot can send a bench part
  to their teammate's bench.

### Tier table

| Part        | Tier I                | Tier II                                | Tier III perk                                                           |
| ----------- | --------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Blast       | 42 dmg, 72 r          | 50 dmg, 80 r                           | Aftershock: a second blast 0.4 s later at 40%                           |
| Cluster     | 6 × 16                | 8 × 18                                 | Carpet: bomblets roll on along the missile's path                       |
| Gravity     | 1.5 s, 160 r          | 2 s, 200 r                             | Crush: pulled rocks take 30 dmg/s and collide with each other           |
| EMP         | 3 s disable           | 4 s; Warden mines fizzle               | Overload: disabled enemies take +50% damage                             |
| Incendiary  | 2 s, 20 dmg/s         | 3 s, 28 dmg/s                          | Wildfire: fire spreads to touching rocks                                |
| Solar Flare | +20%, 4 s             | +30%, 5 s; Sentinels stop firing 1.5 s | Prominence: marked kills release a mini flare that marks nearby targets |
| Cryo        | 1.5 s; 4 × 10 shards  | 2 s; 6 × 12 shards                     | Permafrost: frozen rocks block enemy shots                              |
| Direct      | Turn 6.5              | +20% speed                             | Lead: predicts target movement                                          |
| Corkscrew   | +15% speed            | +25% speed, wider                      | Itano: a missile that misses spirals back for one more pass             |
| Relay       | 2 hops at 60%         | 3 hops at 70%                          | Chainbreaker: each hop gains +10% instead of losing damage              |
| Orbit       | 1.5 s, blocks 1 shot  | 2.5 s, blocks 2                        | Halo: orbiting missiles damage rocks they touch                         |
| Boomerang   | 1 re-lock; 30% refund | 2 re-locks; 50% refund                 | Return Fire: each caught missile adds +1 lock to the next salvo         |
| Impact      | Contact               | +10% damage                            | Breach: +40% damage against boss hulls                                  |
| Proximity   | 40 px early, +20% r   | +30% r                                 | Airburst: blasts delete enemy shots in range                            |
| Chain       | Mini at 30%           | Mini at 40%                            | Cascade: mini missiles can chain once more                              |
| Delayed     | 1 s, 1.6×             | 0.8 s, 1.8×                            | Detonator: tap E to set off every stuck charge early at 2×              |
| Siphon      | 8% per hit            | 12%, +1 hull per kill                  | Feedback: Full Lock salvos refund one whole missile                     |

### Tests

- A merge raises Tier I to II and charges 60% of list price.
- Tier III stays unavailable until the kill threshold is reached.
- Scrapping refunds exactly 50% of total spent.
- Siphon refunds never exceed 1 missile per salvo.
- The same seed produces the same blueprint offers.
- Old saves migrate to three Tier I default parts with an empty bench.

---

## Open questions to decide during build

- Whether the lock cone should be drawn for the teammate in co-op, or only your own.
- Touch controls: the on-screen MISSILE button needs a press-and-hold to paint locks. Check
  `SpecSection.tsx` and the touch handlers.
- Whether `GAME_VALUES.md` should be updated in each phase (recommended).

---

## Phase 1 build notes (`0.7.0-alpha.1`)

Decisions taken while building Phase 1:

- **Teammate lock cone:** only your own cone is drawn. Your teammate's lock reticles and pips
  are drawn in their accent colour, so Crossfire targets stay readable without a second cone.
- **Touch controls:** the campaign MISSILE button and a new co-op Missile button are
  press-and-hold. Pointer capture keeps the hold alive when the thumb slides off the button.
  Online co-op now sends E as a held input instead of a one-sample pulse.
- **`GAME_VALUES.md`:** updated in this phase with a Salvo Lock section, and should be updated
  in each later phase too.
- **Release with no locks:** a release with 0 locks fires one missile at the nearest target,
  the same as a tap. A release with 1 lock after the tap window fires a 1-missile salvo at
  that lock.
- **Graze timing:** the graze charge is paid when the object leaves the band without having
  hit the ship. An object that hits the ship never pays out.
- **Crossfire Overdrive:** each Crossfire adds a flat 6 to the shared meter (maximum 100), and
  only while Overdrive is not already running.
- **Missile design ("Heliodart"):** a gunmetal fuselage with swept tail fins and canards, a
  pulsing accent lock beacon, a white-hot seeker cap and a flickering two-stage plume. A
  tapered ribbon trail shows the corkscrew. Full Lock missiles have white edges and beacons.
  Blasts have a white core flash, a shockwave in the pilot's colour, a trailing pressure ring
  and streaking sparks. Phase 2 payloads should keep this silhouette and change the warhead
  colour, plume and blast for each part.
- **Save migration:** the run save `balanceVersion` is now 2. Older saves rebuild stats from
  their upgrade stacks, which gives the 4-missile rack and the new blast values, and they load
  with a full rack. Co-op room checkpoints from before Salvo Lock get the same rack and blast
  values when restored.

## Phase 2 build notes (`0.7.1-alpha.1`)

- **How parts are obtained:** the spec gives Phase 2 no prices, and Phase 3 adds blueprint offers
  and buying. Until then every part can be fitted for free from the Missiles tab, with its rarity
  shown. Phase 3 replaces this with the blueprint offers.
- **Shots in flight:** each missile copies the build when it launches, so a refit never changes
  missiles already in the air, including Relay hops and Chain minis.
- **Payload scaling:** a shot's power (Full Lock ×1.25, Relay 60%, Chain 30%, Delayed ×1.6,
  Crossfire ×1.4) multiplies Cluster bomblet damage and Incendiary damage per second. Chain minis
  carry Gravity and EMP at 50% duration, so a mini EMP cannot match a full one.
- **Payload radii:** EMP uses its own 110 radius and Gravity uses 160. Incendiary uses the blast
  radius. Proximity's +20% applies to all of them.
- **Relay:** a missile relays only when its own blast killed its target. It flies to the next
  living lock from the same salvo, or to the nearest target within 700 if none is left.
- **Orbit:** salvo missiles spread evenly around the ship. Relay hops and Chain minis launch
  straight away and never orbit. An orbiting missile ignores rocks until it breaks orbit.
- **Delayed:** the charge rides its target at the point it hit. If the target dies first, the
  charge detonates at once, still at ×1.6.
- **Bosses:** damage parts (Blast, Cluster, Incendiary, Delayed's multiplier) hit bosses in
  full. Gravity never pulls a boss, and EMP never disables one.
- **Co-op:** a new `fitWarhead` command carries the part id. The Worker validates it against
  the 13 part ids and the simulation validates the slot. Room checkpoints from before the
  Workshop restore with Blast / Direct / Impact.
- **Missile designs per part:** the payload tints the warhead, the middle of the plume, the
  chamber window and the blast sparks. Solo missiles wear the payload colour and co-op missiles
  keep the pilot's colour. Guidance changes the airframe: raked fins with rifling stripes
  (Corkscrew), forward-swept wings with relay prongs (Relay), or a ring-wing (Orbit). Triggers
  change the nose: a pulsing 40 px sensor ring (Proximity), a docked mini missile (Chain), or
  grapple barbs plus a countdown ring once stuck (Delayed).

# Online co-op progress

Branch: `feature/online-coop`  
Current milestone: **5 — complete co-op campaign (awaiting approval)**
Production deployment: **not started**

This document is the implementation record for the two-player online survival expansion. Each
milestone ends with tests and an approval gate. Work does not move into the next milestone until
the current milestone is approved.

## Architecture audit

### Frontend and lifecycle

- React 19 and `GameShell.tsx` own the browser lifecycle, overlays, settings, menus, shops,
  leaderboard dialogs, and the canvas element.
- `GameShell` creates exactly one `Game`, translates engine callbacks into React state, saves on
  page lifecycle events, and queues a single-player leaderboard report every 15 seconds.
- `MainMenu` and `DeployMenu` are presentation and navigation. Multiplayer is currently a visual
  placeholder and cannot start a session.
- Vite builds one mostly self-contained page at the `/Helio-Drift/` GitHub Pages base path. The
  public frontend is static and cannot host authoritative matches itself.

### Current game engine

- `src/game/engine.ts` is a 7,600+ line mutable `Game` class. It owns input, simulation, spawning,
  collision, progression, browser lifecycle, audio calls, particles, canvas rendering, development
  controls, and persistence hooks.
- The browser drives the engine with `requestAnimationFrame`. Frame deltas are capped at 50 ms,
  but the campaign is variable-step rather than a fixed 30 Hz simulation.
- The engine has one `Player`, one credit balance, one upgrade stack, one salvage drone, and one
  input state. Adding a second player directly to this class would spread player-index conditionals
  throughout combat and rendering and would be difficult to secure.
- Entity state uses stable numeric IDs (`nextId`) for combat targets. This is useful for network
  snapshots, but effects and authoritative entities currently share several arrays and update paths.
- Simulation methods directly trigger audio and visual effects. A Worker cannot import the whole
  class because it depends on canvas, DOM lifecycle, Web Audio, and local storage.
- Random gameplay choices use ambient `Math.random()` throughout spawning, drops, attacks, and
  upgrade rolls. A server-controlled seed therefore could not previously be replayed or restored.

### Campaign and combat rules

- The campaign is already 25 waves in five sectors. Waves 5, 10, 15, 20, and 25 spawn MK1–MK5.
  Wave 25 ends the main campaign and offers MK6 as an optional bonus encounter.
- `game-config.ts` is the central numeric tuning source. `balance.ts` builds weapon, upgrade, boss,
  asteroid, enemy, and factory tables from it.
- The existing roster includes normal and mutated asteroids, Sentinels, Wardens, Spikers, salvage
  drones, MK1–MK6 bosses, meteor showers, singularities, and each boss's scripted abilities.
- Wave completion occurs only when all gating rocks, enemies, bosses, and showers are clear. Event
  rocks do not hold progression open.
- Weapon and salvage purchases currently mutate the local player immediately. There is no command
  validation boundary suitable for an authoritative server yet.
- Player movement was embedded in `Game.update`. This milestone extracts the exact campaign
  movement and wrapping math into a pure function that can advance either player independently.

### Saves and single-player leaderboard

- `RunSave` serializes a curated subset of the mutable `Game` state into `helios-run-v1` and
  validates the shape before restoring it. The single-player save must remain local and separate
  from co-op reconnect state.
- The leaderboard client stores a bearer identity and an offline report queue in local storage.
  Reports are treated as telemetry from the client and validated for shape and monotonic progress.
- The existing leaderboard Worker uses D1 tables for players, runs, admin sessions, metadata, and
  persisted rate-limit buckets. It has no WebSocket or Durable Object support.
- Existing leaderboard results are not authoritative combat results. Co-op results must originate
  from the match Durable Object and go to separate additive tables or a separate database.

### Audio and presentation

- `audio.ts` and `music.ts` generate sound in Web Audio and are browser-only. The server should
  emit compact semantic events; clients should produce sounds, particles, shake, and floating text.
- Canvas rendering already has sector themes, ship geometry, enemy silhouettes, telegraphs, boss
  presentation, and HUD data that can be reused. Player accent colour should be render-only state.

### Deployment

- GitHub Pages deploys `main` after type checks, gameplay tests, both leaderboard suites, and build.
- `wrangler.jsonc` deploys the existing `helio-drift-leaderboard` Worker with one D1 binding. Its
  name, binding, routes, migrations, and production data must not be reused for live match rooms.
- The safest target is a separate multiplayer Worker configuration, Durable Object namespace, and
  additive co-op leaderboard migration. No production infrastructure is created in Milestone 1.

## Risks found

1. **Mixed browser and simulation concerns.** The Worker cannot safely reuse `Game` yet. Extraction
   must proceed system by system while the single-player adapter keeps its current behaviour.
2. **Variable time step.** An authoritative 30 Hz server needs a fixed-step runner. Client rendering
   should interpolate independently at display refresh rate.
3. **Ambient randomness.** A seeded source now exists, but existing gameplay calls have not all been
   migrated. Gameplay and cosmetic random streams must remain separate so particles cannot alter a
   match outcome.
4. **Single-player-shaped state.** Player-owned credits, upgrades, weapons, drones, damage, and kills
   need an indexed player state. Shared score, wave, enemies, directive, and Overdrive need team
   state.
5. **Non-serializable fields.** Bullet hit sets and several rich mutable objects need explicit wire
   DTOs. Raw engine objects must never be sent directly over WebSockets.
6. **Immediate UI mutations.** Shops and upgrade choices currently call local engine mutations.
   Co-op UI must send commands and wait for authoritative acceptance.
7. **Trust boundary.** The current leaderboard accepts monotonic client reports. Co-op scores must be
   signed or written server-to-server from a completed authoritative room.
8. **Free-tier uncertainty.** A 30 Hz Durable Object running a 25–35 minute match consumes materially
   more compute than the leaderboard. Load measurements are required before making a cost promise.

## Milestone 1 implementation

The first shared boundary is `src/game/simulation/`. It has no DOM, React, canvas, audio, storage,
or `Game` dependency.

- `campaign.ts` now owns the existing 25-wave schedule, sector lookup, boss-wave lookup, legacy
  difficulty scale, and Sentinel pressure functions. `balance.ts` re-exports the same names, so all
  existing imports remain compatible.
- `movement.ts` now owns player turning, thrust, drag, speed limiting, integration, and arena wrap.
  `Game.update` gathers browser controls into a `FlightIntent` and calls this shared rule.
- `random.ts` introduces a deterministic, snapshot-capable seeded source plus range, integer, and
  chance helpers for later server-controlled directives, spawns, and attacks.
- `types.ts` no longer imports the browser `Game` class. Upgrade rules use a small structural target,
  making the current balance tables safe to import from a non-browser runtime.
- The gameplay test command now runs every test in `test/`, including shared simulation contract
  tests.

This is deliberately not a multiplayer prototype. There are no rooms, sockets, second ship, lobby
screens, or production changes in this milestone.

## Target architecture

```text
GitHub Pages client
  React menus / HUD
  input sampling + prediction
  snapshot interpolation
  canvas renderer + audio/effects
             │ WebSocket commands/snapshots
             ▼
Separate Cloudflare multiplayer Worker
  HTTP lobby routes + validation/rate limits
  Lobby index Durable Object
  one Match Durable Object per room code
    fixed 30 Hz authoritative simulation
    10–20 Hz compact snapshots
    reconnect/session ownership
    authoritative purchases, damage and results
             │ authoritative completed result
             ▼
Additive co-op leaderboard storage
  separate tables and API surface
  existing single-player tables unchanged
```

The room creator is not the host. A Match Durable Object owns the simulation and continues through
temporary client disconnects. The lobby index allocates unique six-character codes and lists only
public waiting rooms. Match objects reject third players and in-progress joins.

## Implementation plan

### Milestone 2 — two-player local simulation

- Define authoritative `MatchState`, indexed `PlayerState`, shared team state, serializable entity
  DTOs, normalized input commands, and semantic event types.
- Add a fixed-step runner and migrate gameplay randomness to separate seeded gameplay/effect streams.
- Extract player damage, firing, purchases, upgrades, pickups, kills, and drones behind player IDs.
- Run two players in one local simulation with independent health, credits, weapons, upgrades, and
  statistics. Keep the existing single-player adapter and save format working.
- Add deterministic replay, two-player movement/combat, split asteroid, purchase, boss, and wave
  regression tests.

### Milestone 3 — private room networking

- Add a separate Wrangler configuration and Match Durable Object.
- Implement create-private, join-code, ready, start, leave, heartbeat, room capacity, and secure
  reconnect tokens.
- Add a 30 Hz server clock, validated rate-limited inputs, 10–20 Hz snapshots, client prediction,
  reconciliation, interpolation, timeout handling, and inactive-room cleanup.
- Test two independent browser contexts, simultaneous joins, refresh/reconnect, invalid/full codes,
  and creator disconnects.

### Milestone 4 — authoritative multiplayer combat

- Move firing, projectiles, collisions, damage, enemy AI, drops, credits, shops, upgrade selection,
  boss state, and wave transitions into the room simulation.
- Synchronize state IDs and compact DTOs; emit cosmetic events without syncing particles.
- Validate ownership, cadence, weapon level, available credits, upgrade caps, sequence numbers, and
  impossible movement at the server boundary.

### Milestone 5 — complete co-op campaign

- Tune roughly 1.5× pressure, 1.2× boss health, and 1.15× enemy damage through measurable config.
- Add disable/revive with a three-second proximity hold, interruption, partial health, cooldowns,
  and both-disabled match failure.
- Add shared authoritative Overdrive, proximity charge bonus, synchronized activation, and expiry.
- Add seeded sector directives using existing mechanics.
- Add Tether Sentinel from approximately wave 8 and Mine Warden from approximately wave 13 with
  readable telegraphs, destructible mines, entity caps, and boss compatibility.
- Preserve campaign victory at wave 25 and offer the existing MK6 bonus challenge.

### Milestone 6 — public lobbies and matchmaking

- Add Lobby Index Durable Object coordination for public create/list/join and Quick Join.
- Show room name, player count, capacity, waiting status, and joinability; private rooms stay absent.
- Handle concurrent allocation and joins atomically across Worker instances.

### Milestone 7 — multiplayer UI and co-op leaderboard

- Enable the existing Multiplayer tile and add private/public/quick-join flows, ready room, room code,
  connection state, teammate health, revive prompts, Overdrive, directives, co-op shops, results,
  victory, failure, and match statistics.
- Add distinguishable ship accents and responsive accessible controls without changing ship identity.
- Add safe additive co-op leaderboard migrations and server-authored idempotent result submission.
- Keep the single-player board and production rows unchanged.

### Milestone 8 — integration, performance, and release readiness

- Run two-browser full campaigns, reconnect/refresh/leave cases, boss and MK6 paths, hostile-message
  fuzzing, soak tests, snapshot-size measurements, simulation timing, and Durable Object load tests.
- Tune pacing toward 25–35 minutes and verify entity caps under both player load.
- Document local setup, deployment, migrations, secrets, observability, security, rollback, custom
  domains, and measured cost expectations.
- Prepare a reviewable deployment plan. Production deployment remains a separate explicit approval.

## Milestone 2 implementation

The second milestone adds a headless, platform-neutral co-op match model under
`src/game/simulation/`. It does not add rooms, WebSockets, menus, or a production service.

- `CoopMatchState` is fully JSON-safe and separates two indexed player records from shared team,
  wave, boss, projectile, asteroid, pickup, score, and Overdrive state.
- `FixedStepRunner` advances authoritative rules at 30 Hz, bounds catch-up work, and snapshots its
  tick and accumulator for exact restoration.
- `LocalCoopSimulation` owns a server-seeded gameplay random stream, validates sequenced commands,
  and advances two ships with independent health, credits, XP, weapons, upgrades, salvage drones,
  inputs, and statistics.
- Projectiles carry an immutable player owner ID. Damage, kills, rewards, boss damage, pickup
  collection, purchases, and semantic events are attributed through that ID rather than ambient
  single-player state.
- The shared model includes deterministic wave spawning, asteroid mutation/splitting rules, boss
  health scaling, wave-25 victory, both-disabled defeat, three-second proximity revives, and shared
  Overdrive state. The revive and Overdrive foundations arrive here so their state and commands do
  not need a later wire-format migration; final tuning remains part of Milestone 5.
- Weapon prices, salvage-upgrade prices, and core weapon statistics now live in a shared module.
  The existing browser engine delegates to those rules, avoiding separate single-player and co-op
  balance tables.
- Ten tests cover fixed stepping, independent movement, malformed/stale commands, deterministic
  replay and restoration, combat ownership, normal and boom splitting, player-scoped economy,
  upgrades and drones, revive, Overdrive, boss scaling, victory, and JSON-safe snapshots.

The local match intentionally uses the common projectile subset for its combat proof. Specialized
beam, arc, flak, missile, enemy, and boss behaviours remain in the browser engine until the full
authoritative combat extraction in Milestone 4. Cosmetic randomness is absent from the headless
model; clients will generate effects from semantic events without consuming the gameplay stream.

## Milestone 3 implementation

The third milestone wraps the local co-op model in a separate Cloudflare Worker and SQLite-backed
Durable Object. It remains a private-room development service: no multiplayer menu is enabled and
nothing has been deployed.

- `wrangler.multiplayer.jsonc` defines a new `helio-drift-multiplayer` Worker and `MatchRoom`
  namespace. It does not reuse the leaderboard Worker, D1 binding, migrations, or production data.
- Private rooms use unambiguous six-character codes. Durable Object serialization makes competing
  joins atomic, limits rooms to two players, rejects late joins, and lets either ready player start;
  the creator has no host authority.
- Reconnect tokens are returned only at create/join time and stored as SHA-256 hashes. Browser
  sockets use short-lived, one-use tickets, and opening a replacement connection invalidates the
  previous session generation.
- Room state, player slots, ready state, simulation snapshots, and reconnect ownership persist in
  Durable Object storage. A temporarily disconnected running room advances through alarms and can
  be reclaimed within a 90-second grace period; inactive rooms are scheduled for cleanup.
- The room owns the 30 Hz simulation clock and emits JSON-safe authoritative snapshots every two
  ticks (15 Hz). Inputs are assigned to the authenticated player, sequence checked, normalized by
  the simulation, capped at 90 messages per second, and limited to 4 KiB.
- Heartbeats, stale/unknown message errors, oversized-message closure, CORS validation, connection
  replacement, leave/rejoin, and persisted refresh/reconnect paths are handled explicitly.
- `ClientPrediction` replays only unacknowledged local movement after reconciliation.
  `SnapshotInterpolator` orders server frames and interpolates player/entity positions without
  predicting combat.
- Ten Miniflare tests use two independent WebSockets and real Durable Object storage. Three client
  tests cover prediction, acknowledgement replay, interpolation, ordering, and input normalization.

Public room discovery, Quick Join, multiplayer menus, and production deployment remain reserved for
later milestones. Specialized authoritative combat remains Milestone 4 work.

## Milestone 4 implementation

The fourth milestone moves the campaign's multiplayer combat mutations into the persisted room
simulation. It does not enable the multiplayer menu, public rooms, matchmaking, co-op leaderboard,
or production deployment.

- Player firing now covers standard projectiles, direct laser/arc damage, flak shrapnel, homing
  missiles, critical damage, piercing, ricochets, and server-enforced cadence and ammunition.
- Sentinels, Wardens, Warden turrets, and Spikers select the nearest active player, move, telegraph,
  and produce authoritative hostile shots. Late Spikers use their eight-direction volley.
- MK1–MK5 bosses own movement, health phases, radial attacks, signature meteor, ignition-strike,
  and shockwave abilities. Boss defeat clears the authoritative battlefield before victory or the
  next wave.
- Enemy and asteroid damage, player damage, collision damage, kills, XP, drops, credits, pickups,
  salvage-drone fire/support, purchases, weapon selection, drone equipment, and upgrades are all
  applied by the room simulation and attributed to a stable player/entity ID.
- WebSocket economy and loadout commands are rebound to the authenticated socket player. The room
  rejects stale sequences, malformed IDs, unknown weapons/upgrades, impossible input values, and
  commands outside a running match; balance rules enforce credits, ownership, cadence, and caps.
- The public wire DTO excludes the seed, random state, clock accumulator, and entity allocator.
  Snapshots contain only render/gameplay state and semantic cosmetic events, while Durable Object
  storage retains the complete deterministic state for reconnects.
- Six additional local combat tests and expanded room integration assertions cover targeting,
  hostile fire, Spiker volleys, missiles, rewards, boss phases/cleanup, snapshot privacy and size,
  and socket ownership spoofing.

## Milestone 5 implementation

The fifth milestone completes the authoritative 25-wave co-op campaign and optional MK6 encounter.
It does not enable multiplayer UI, public matchmaking, or production deployment.

- The measurable co-op profile remains centralized at 1.5× enemy pressure, 1.2× boss health, and
  1.15× enemy damage.
- Each sector receives a deterministic seeded directive. Asteroid Surge increases field density,
  Elite Patrol increases enemy hull, and Volatile Space increases mutated-asteroid pressure. A new
  directive is chosen at each sector boundary without immediately repeating.
- Tether Sentinels unlock at wave 8. Their visible warning creates a capped link to the nearest
  active pilot, pulls beyond its safe distance, and breaks on range, disable, or source destruction.
- Mine Wardens unlock at wave 13. They deploy capped mines with arming and trigger warnings; mines
  can be destroyed by pilot weapons, missiles, or salvage drones before their blast resolves.
- Both enemy types follow the regular wave schedule, appear with eligible bosses, target either
  pilot, emit compact semantic events, and remain fully snapshot/restoration safe.
- Revive progress now resets and pauses briefly when the reviving pilot takes damage. The existing
  three-second proximity hold, partial-health return, cooldown, shared Overdrive, proximity charge
  bonus, expiry, and both-disabled failure remain server-owned.
- Defeating MK5 records campaign completion and enters an authoritative bonus offer. Either player
  may begin the scaled 37,000-HP MK6 encounter or finish the run; defeating MK6 records the bonus
  result and final victory. MK6 has synchronized escorts, solar strikes, and singularity pull.
- Five new deterministic tests cover directives/scaling, unlock and boss schedules, tether rules,
  destructible mine caps, revive interruption, and the full MK5-to-MK6 transition.

## Milestone status

| Milestone                               | Status                      | Merge gate  |
| --------------------------------------- | --------------------------- | ----------- |
| 1. Audit and shared simulation refactor | Complete and approved       | Passed      |
| 2. Two-player local simulation          | Complete and approved       | Passed      |
| 3. Private room networking              | Complete and approved       | Passed      |
| 4. Authoritative multiplayer combat     | Complete and approved       | Passed      |
| 5. Complete co-op campaign              | Complete; awaiting approval | Passed      |
| 6. Public lobbies and matchmaking       | Waiting                     | Not started |
| 7. Multiplayer UI and leaderboard       | Waiting                     | Not started |
| 8. Integration and release readiness    | Waiting                     | Not started |

## Milestone 1 verification

Milestone 1 passed on 12 October 2026:

- `npm run typecheck`
- `npm run game:test`: 61/61 tests, including all existing campaign checks and five shared
  simulation checks
- `npm run leaderboard:test`: 12/12 tests
- `npm run cf:test`: dry-run bundle plus 18/18 Worker/D1 tests
- `npm run build`: production Vite build
- `npm run format:check` and `git diff --check`
- Chromium smoke test: campaign start, live movement, save, reload, and continue with no page errors

Changed files:

- `docs/multiplayer-progress.md` — architecture audit, risks, target design, plan, and progress log
- `src/game/simulation/campaign.ts` — platform-neutral campaign schedule
- `src/game/simulation/movement.ts` — platform-neutral player movement
- `src/game/simulation/random.ts` — seeded replayable random source
- `src/game/simulation/index.ts` — shared simulation exports
- `src/game/balance.ts` — compatibility re-exports for the extracted schedule
- `src/game/engine.ts` — browser input adapter now calls shared movement
- `src/game/types.ts` — removes the browser-engine dependency from upgrade rules
- `test/shared-simulation.test.mjs` — schedule, RNG, two-player movement, exact movement parity,
  and runtime-boundary tests
- `package.json` — gameplay test command discovers all game tests

Milestone 1 is safe to merge: it does not add a network path, database migration, multiplayer UI,
or production deployment. The single-player save schema and leaderboard contracts are unchanged.

## Milestone 2 verification

Milestone 2 passed on 12 October 2026:

- `npm run typecheck`
- `npm run game:test`: 71/71 tests, including ten new local co-op simulation checks
- `npm run leaderboard:test`: 12/12 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m2-wrangler npm run cf:test`: dry-run bundle plus 18/18
  Worker/D1 tests
- `npm run build`
- `npm run format:check` and `git diff --check`
- Chromium smoke test: campaign start, live movement, save, reload, and continue with no page errors

Changed files:

- `src/game/simulation/coop-config.ts` — shared tick, arena, difficulty, revive, and Overdrive tuning
- `src/game/simulation/coop-types.ts` — serializable match, player, entity, command, and event contracts
- `src/game/simulation/fixed-step.ts` — snapshot-capable 30 Hz accumulator
- `src/game/simulation/local-coop.ts` — deterministic two-player headless match
- `src/game/simulation/weapons.ts` — shared weapon/economy simulation rules
- `src/game/simulation/index.ts` — exports the Milestone 2 simulation surface
- `src/game/engine.ts` — delegates existing weapon/economy calculations to the shared rules
- `test/local-coop.test.mjs` — deterministic two-player and ownership regression coverage
- `test/shared-simulation.test.mjs` — enforces the browser-free boundary for every shared module
- `docs/multiplayer-progress.md` — Milestone 2 scope, verification, and approval gate

Milestone 2 is safe to merge: it adds no network path, database migration, UI, or deployment. The
single-player engine, save schema, and leaderboard contracts remain compatible. Its approval gate
was cleared before Milestone 3 began.

## Milestone 3 verification

Milestone 3 passed on 12 October 2026:

- `npm run typecheck`
- `npm run game:test`: 74/74 tests, including three client synchronization checks
- `npm run leaderboard:test`: 12/12 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m3-wrangler npm run cf:test`: dry-run bundle plus 18/18
  Worker/D1 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m3-wrangler npm run multiplayer:test`: separate Worker dry-run
  bundle plus 10/10 Durable Object and WebSocket tests
- `npm run build`
- `npm run format:check`, explicit multiplayer/docs formatting, and `git diff --check`
- Local multiplayer smoke: port 8788 health check and private-room creation
- Chromium single-player smoke: campaign start, movement, save, reload, and continue

Changed files:

- `wrangler.multiplayer.jsonc` — isolated multiplayer Worker and Durable Object migration
- `multiplayer/config.mjs` — room, ticket, timeout, cadence, and input limits
- `multiplayer/worker.mjs` — private-room HTTP API, sessions, WebSockets, clock, persistence, and cleanup
- `multiplayer/test/fixture.mjs` and `rooms.test.mjs` — Miniflare room/network integration coverage
- `src/game/network/` — typed protocol, movement prediction, reconciliation, and interpolation
- `test/multiplayer-client.test.mjs` — pure client synchronization tests
- `package.json` and `package-lock.json` — `0.4.2-alpha.2` and multiplayer development/test commands
- `.github/workflows/deploy-pages.yml` — multiplayer dry-run and tests in the existing quality gate
- `.gitignore` — ignores the multiplayer dry-run bundle
- `src/game/update-log.ts` — concise alpha release entry
- `docs/multiplayer-progress.md` — Milestone 3 design, verification, and approval gate

Milestone 3 is safe to review without deployment: the configuration declares a new namespace but no
command in this milestone publishes it. The existing single-player game, save schema, leaderboard
Worker, D1 database, and production bindings remain unchanged. Milestone 4 must not begin until the
private-room boundary is approved.

## Milestone 4 verification

Milestone 4 passed on 12 October 2026:

- `npm run typecheck`
- `npm run game:test`: 80/80 tests, including six new authoritative combat/DTO checks
- `npm run leaderboard:test`: 12/12 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m4-wrangler npm run cf:test`: dry-run bundle plus 18/18
  Worker/D1 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m4-wrangler npm run multiplayer:test`: separate Worker dry-run
  bundle plus 10/10 Durable Object and WebSocket tests
- `npm run build`
- `npm run format:check`, explicit multiplayer/docs formatting, and `git diff --check`

Changed areas:

- `src/game/simulation/coop-types.ts` and `local-coop.ts` — authoritative combat entities, AI,
  attacks, damage, rewards, boss phases, economy, upgrades, missiles, and drones
- `src/game/network/` — compact public match DTO and expanded command protocol/interpolation
- `multiplayer/worker.mjs` — authenticated combat/economy command validation and compact snapshots
- `test/local-coop.test.mjs` and `multiplayer/test/rooms.test.mjs` — authority, privacy, combat, and
  hostile-command regression coverage
- `package.json`, `package-lock.json`, and `src/game/update-log.ts` — `0.4.2-alpha.3` release record

Milestone 4 is safe to review without deployment. It changes only the unshipped multiplayer room
path and shared headless modules; the single-player engine, local save schema, leaderboard Worker,
D1 data, and production bindings remain unchanged. Milestone 5 remains behind the next approval
gate.

## Milestone 5 verification

Milestone 5 passed on 12 October 2026:

- `npm run typecheck`
- `npm run game:test`: 85/85 tests, including five new complete-campaign checks
- `npm run leaderboard:test`: 12/12 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m5-wrangler npm run cf:test`: dry-run bundle plus 18/18
  Worker/D1 tests
- `XDG_CONFIG_HOME=/tmp/helio-coop-m5-wrangler npm run multiplayer:test`: separate Worker dry-run
  bundle plus 10/10 Durable Object and WebSocket tests
- `npm run build`
- `npm run format:check`, explicit multiplayer/docs formatting, and `git diff --check`

Changed areas:

- `src/game/simulation/coop-config.ts`, `coop-types.ts`, and `local-coop.ts` — directives, final
  scaling, revive interruption, Tether Sentinels, Mine Wardens/mines, and MK6 bonus flow
- `src/game/network/` and `multiplayer/worker.mjs` — new synchronized state and validated bonus
  commands
- `test/local-coop.test.mjs` — deterministic campaign-content and transition coverage
- `package.json`, `package-lock.json`, and `src/game/update-log.ts` — `0.4.2-alpha.4` release record

Milestone 5 is safe to review without deployment. Multiplayer UI and public lobby work remain in
later milestones; the single-player campaign, save schema, leaderboard Worker, D1 data, and
production bindings remain unchanged. Milestone 6 remains behind the next approval gate.

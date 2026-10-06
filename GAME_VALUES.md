# Helios Drift — gameplay values reference

This is a local reference compiled from `src/game/balance.ts` and
`src/game/engine.ts`. It describes the current source values. Values marked as
formulas change with wave, weapon level, upgrades, distance, or random rolls.
Distances, sizes, and speeds use canvas pixels and pixels per second unless
otherwise noted. Damage and health are game units.

## Global colors and sector palettes

| Palette role   | Value     |
| -------------- | --------- |
| Amber          | `#ffb03a` |
| Hot amber      | `#ffe0a3` |
| Ice blue       | `#6fe7ff` |
| Danger magenta | `#ff3d6e` |
| Orange         | `#ff7a2a` |
| Plain rock     | `#8d6a3d` |
| Homing rock    | `#ff6f9a` |
| Fast rock      | `#f4f7ff` |
| Meteor         | `#ffd27a` |
| Meteorite      | `#ffc36b` |

| Sector                | Waves         | Tint                  | Star colors          |
| --------------------- | ------------- | --------------------- | -------------------- |
| I · Deep Void         | 1–5           | `rgba(26,29,43,0.10)` | `#ffe0a3`, `#8d93ad` |
| II · Verdant Drift    | 6–10          | `rgba(20,48,34,0.13)` | `#c9ffd9`, `#79a98c` |
| III · Frozen Belt     | 11–15         | `rgba(18,42,60,0.15)` | `#d9f4ff`, `#7ba0bd` |
| IV · Violet Storm     | 16–20         | `rgba(44,24,58,0.15)` | `#f0d4ff`, `#a07bcd` |
| V · Ember Field       | 21–25         | `rgba(58,25,18,0.15)` | `#ffc9b0`, `#c08268` |
| VI · The Core         | Extra palette | `rgba(70,32,8,0.18)`  | `#ffffff`, `#ffd9a0` |
| VII · Solar Cataclysm | MK6 bonus     | `rgba(80,38,6,0.26)`  | `#ffea88`, `#ff9933` |

## Player: starting values

| Stat                          |                              Starting value |
| ----------------------------- | ------------------------------------------: |
| Hull / maximum hull           |                                   100 / 100 |
| Armor damage reduction        |                                          0% |
| Thrust                        |                                         460 |
| Maximum speed                 |                                         540 |
| Turn rate                     |                               4.4 radians/s |
| Fire-rate multiplier          |                                        1.0× |
| Weapon-damage multiplier      |                                        1.0× |
| Critical-hit chance           |                                          6% |
| Critical-hit damage           |                                        2.2× |
| Starting weapon               |                              Pulse, level 1 |
| Other starting weapons        |                            Locked (level 0) |
| Missiles / rack capacity      |                                       3 / 3 |
| Missile regeneration          |                       1 missile every 6.5 s |
| Missile blast damage / radius |                                     68 / 96 |
| Pickup magnet range           |                                         150 |
| Credit-drop chance base       | 72%, plus 7 percentage points per rock size |
| Credit value multiplier       |                                        1.0× |
| Life steal                    |                                          0% |
| Collision invulnerability     |                                      0.75 s |
| Ship collision radius         |                                          14 |
| Normal thrust direction       |    Input-dependent; hybrid controls default |
| Movement drag per 1/60 s      |                                       0.986 |

Upgrade-derived maximum hull is 208 after six Reinforced Hull stacks. Normal
armor tops out at 36% damage reduction after three Reactive Armor stacks. At
maximum stacks, Overclock multiplies fire rate by 1.6771×; Hollow-Point
multiplies weapon damage by 1.9738×; critical chance reaches 41%; and four
Thruster Kit stacks produce 649.3 thrust, 681.7 maximum speed, and 5.15 turn
rate. Twin-Linked Feeder adds 3 shots and Sabot Rounds add 3 pierce.

## Player weapons

All weapons cap at level 6. `n = level − 1`. Damage is multiplied by the
player's damage multiplier; firing rate is multiplied by the fire-rate
multiplier. A critical hit multiplies applicable damage by 2.2 at the starting
critical multiplier. Additional projectile and pierce upgrades also apply
where described below.

| Weapon               | Damage per hit / tick                                  | Shots or targets               | Rounds / ticks per second    | Shop rarity / roll weight | Other level values                                                                                           |
| -------------------- | ------------------------------------------------------ | ------------------------------ | ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pulse Cannon         | `16 × (1 + 0.15n)`                                     | `1 + floor(n/2)` shots         | `4.6 × (1 + 0.07n)`          | Common / 1.0              | Speed 720; projectile lifetime 1.15 s; radius 3.6                                                            |
| Scattershot Array    | `11.5 × (1 + 0.105n)` per pellet                       | `3 + floor(0.7n)` pellets      | `3.55 × (1 + 0.035n)`        | Rare / 0.7                | Spread arc 0.13 rad; speed 720; lifetime 1.15 s                                                              |
| Seeker Pulse         | `6.5 × (1 + 0.13n)`                                    | `1 + floor(n/3)` darts         | `6.6 × (1 + 0.065n)`         | Rare / 0.7                | Speed 520; lifetime 2.2 s; radius 3; homing turn 7.5 rad/s                                                   |
| Ricochet Blaster     | `19 × (1 + 0.13n)`                                     | `1 + floor(n/4)` slugs         | `3.05 × (1 + 0.04n)`         | Rare / 0.7                | Speed 640; lifetime 2.6 s; radius 4.5; bounces `1 + floor(n/2)`                                              |
| Flak Cannon          | 9.2 shell damage                                       | `1 + floor(n/3)` shells        | `1.48 × (1 + 0.05n)`         | Rare / 0.6                | Fuse 0.45 s; speed 560; lifetime 1.5 s; radius 6; shrapnel `7 + 2n`; each shard `8.4 × (1 + 0.13n)` damage   |
| Arc Coil             | `9 × (1 + 0.18n)` per tick                             | `2 + floor(n/2)` chain targets | Tick every `0.12 s` (8.33/s) | Epic / 0.4                | Acquisition range `250 + 18n`; chain jumps search up to 200 px                                               |
| Beam Emitter (Laser) | `125 × (1 + 0.25n)` damage/s                           | Continuous ray                 | Continuous while held        | Epic / 0.4                | Range 1100; heat/s `0.36 × (1 − 0.06n)` through level 5; level 6 has no heat or overheat lock                |
| Railgun              | `16 × 2.6 × (1 + 0.22n)`; multiply by 1.18 at levels 6 | 1 slug                         | `4.6 × 0.42 × (1 + 0.05n)`   | Epic / 0.4                | Speed 960; lifetime 2.2 s; radius 6; base pierce `3 + floor(n/2)` plus pierce upgrades; effective range 2112 |

Starting values at level 1, before upgrades: Pulse 16 damage at 4.6 shots/s;
Scatter 11.5 × 3 at 3.55/s; Seeker 6.5 at 6.6/s; Ricochet 19 at 3.05/s;
Flak 9.2 shell plus 7 shards × 8.4 at 1.48/s; Arc 9 damage/tick at 8.33
ticks/s, 2 chains, range 250; Beam 125 DPS; Rail 41.6 damage at 1.932/s.

### Weapon purchase prices

| Rarity | Starting price | Weapon(s)                       |
| ------ | -------------: | ------------------------------- |
| Common |    120 credits | Pulse                           |
| Rare   |    280 credits | Scatter, Seeker, Ricochet, Flak |
| Epic   |    560 credits | Arc, Beam, Rail                 |

Each next weapon level costs `round_to_nearest_5(base_price × 1.55^current_level)`.
The listed starting price buys/unlocks level 1. Level 6 is the maximum.

## Asteroids and meteors

### Regular asteroid health

Regular rock health is:

`base HP × (1 + scaled_wave × 0.13) × trait multiplier`

`scaled_wave = wave × 2`. Base health and radius ranges:

| Size       | Base HP | Base radius (randomly × 0.86–1.16) | Regular asteroid split       |
| ---------- | ------: | ---------------------------------: | ---------------------------- |
| Large (3)  |      82 |                              58 px | Splits into two medium rocks |
| Medium (2) |      42 |                              33 px | Splits into two small rocks  |
| Small (1)  |      20 |                              18 px | Does not split               |

Trait multiplier is 1.0× for plain rocks and meteor/meteorite event rocks; it is
1.15× for homing, bounce, boom, and fast rocks. Examples for plain rocks:

| Wave | Large HP | Medium HP | Small HP |
| ---: | -------: | --------: | -------: |
|    1 |   103.32 |     52.92 |     25.2 |
|    5 |    188.6 |      96.6 |       46 |
|   10 |    295.2 |     151.2 |       72 |
|   15 |    401.8 |     205.8 |       98 |
|   20 |    508.4 |     260.4 |      124 |
|   25 |      615 |       315 |      150 |

### Asteroid collision and explosion damage

| Contact/event                           |                  Player damage before armor |
| --------------------------------------- | ------------------------------------------: |
| Plain/special large rock                |  `clamp(14 + relative_speed × 0.09, 5, 42)` |
| Plain/special medium rock               |   `clamp(9 + relative_speed × 0.06, 5, 42)` |
| Plain/special small rock                |   `clamp(5 + relative_speed × 0.03, 5, 42)` |
| Fast meteor streak                      | `clamp(18 + relative_speed × 0.02, 18, 34)` |
| Meteorite contact                       |                                           4 |
| Boom-rock blast, large / medium / small |                                 32 / 16 / 8 |
| Generic explosion blast                 |             6 if within 60% of blast radius |
| Ship rams a regular asteroid            |                            Deals 22 to rock |
| Ship rams meteorite                     |                        Deals 999 (kills it) |
| Ship rams meteor streak                 |                      Does not damage meteor |

`relative_speed` is the distance per second between ship and rock. Each player
hit uses the 0.75-second collision invulnerability window. Player armor reduces
these damage amounts by up to 36%.

### Special rock values

| Trait         | Speed / behavior                                                                       | Extra values                                                                               |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Homing        | Turns toward the ship; size-based turn rate 1.3 / 1.8 / 2.4 rad/s (small/medium/large) | Trait unlocks wave 6                                                                       |
| Bounce        | Fixed speed: small 185, medium 150, large 120                                          | Wall/player bounce speed cap is 1.3× those speeds; unlock wave 11                          |
| Boom          | Fixed speed: small 36, medium 30, large 24                                             | Fuse 0.35 s; home range 260; turn 0.95 rad/s; blast-radius multiplier 1.7×; unlock wave 16 |
| Fast          | Fixed speed: small 235, medium 265, large 290                                          | Unlock wave 21                                                                             |
| Meteor streak | Speed 520–700; radius is 1.35× small rock radius                                       | HP `120 + scaled_wave × 4`; hits for 18–34                                                 |
| Meteorite     | Falls at x speed −70–70, y speed 45–90; radius 0.8× small rock radius                  | HP `6 + scaled_wave × 0.4`; player contact damage 4; pays 10–20 credits                    |

Boom blast radius before multiplier: large 178, medium 108, small 66. Multiply
each by 1.7. Boom damage to nearby other rocks and enemy drones is 42 / 22 / 11
for large / medium / small boom rocks.

## Enemies

### Sentinels

| Value                                                  |                                          Setting |
| ------------------------------------------------------ | -----------------------------------------------: |
| Health on wave `w`                                     |                                 `55 + (2w × 11)` |
| Radius                                                 |                                            21 px |
| Bolt damage                                            |                                                7 |
| Bolt speed / radius / lifetime                         |                               250 / 5 px / 4.2 s |
| Bolt target range                                      |                                           720 px |
| Firing interval                                        | 3.0–4.4 s, reduced by up to 1.1 s on later waves |
| Burst cadence                                          |         From wave 8, 2 bolts separated by 0.22 s |
| Normal / low-health preferred distance                 |                                     470 / 620 px |
| Maximum normal / low-health speed                      |                                        200 / 235 |
| Player collision damage                                |                         14; also takes 30 damage |
| Concurrent cap, waves 1–5 / 6–10 / 11–15 / 16–20 / 21+ |                                2 / 3 / 4 / 5 / 6 |

Sentinel health examples: wave 1 = 77; wave 5 = 165; wave 10 = 275; wave 15 =
385; wave 20 = 495; wave 25 = 605.

### Wardens

| Value                                   |                   Setting |
| --------------------------------------- | ------------------------: |
| Health on ordinary late wave `w`        |         `215 + (2w × 22)` |
| Health as a boss escort on wave `w`     |         `210 + (2w × 28)` |
| Radius                                  |                     30 px |
| Sniper bolt damage                      |                        12 |
| Sniper bolt speed / radius / lifetime   |       860 / 13 px / 2.2 s |
| Sniper range                            | Fires only at 320–1350 px |
| Aim warning / fixed aim offset          |            0.6 s / ±24 px |
| Post-shot delay                         |                 2.4–3.6 s |
| Splitter-turret lifetime / health       |           10.5 s / 2 hits |
| Turret deployment interval / active cap |     6–11 s / 3 concurrent |
| Turret seeking orb lifetime             |                    10.5 s |
| Normal / low-health preferred distance  |              900 / 760 px |
| Maximum normal / low-health speed       |                 165 / 200 |
| Player collision damage                 |       14; takes 30 damage |

Ordinary late-wave warden health: wave 21 = 1139; wave 24 = 1271. Boss escort
warden health: wave 20 = 1330; wave 25 = 1610.

## Bosses

Boss health is calculated from the encounter's wave and boss multiplier. For
MK1–MK3, health is capped at 13,000. MK5 is the final main campaign boss; MK6 is
an optional bonus boss.

| Boss                         |  Wave | Signature asteroid | HP calculation            | Actual HP | Radius | HP multiplier | Attack timer multiplier | Projectile multiplier | Spawn weight | Horizontal drift | Rocks per spawn |
| ---------------------------- | ----: | ------------------ | ------------------------- | --------: | -----: | ------------: | ----------------------: | --------------------: | -----------: | ---------------: | --------------: |
| MK1 · Kometenhülle           |     5 | Plain              | `(1800 + 10×140) × 1.2`   |     3,840 |    104 |          1.2× |                   1.00× |                 1.00× |         0.70 |                0 |               1 |
| MK2 · Jagdzell               |    10 | Homing             | `(1800 + 20×140) × 1.495` |     6,877 |    104 |        1.495× |                   0.92× |                 1.10× |         0.70 |               +6 |               1 |
| MK3 · Richtzell              |    15 | Bounce             | `(1800 + 30×140) × 1.89`  |    11,340 |    104 |         1.89× |                   1.05× |                 1.05× |         0.90 |              +10 |               2 |
| MK4 · Brandzell              |    20 | Boom               | `(1800 + 40×140) × 3`     |    22,200 |    104 |          3.0× |                   0.90× |                 1.35× |         0.70 |               −4 |               2 |
| MK5 · Sturmzell / The Core   |    25 | Fast               | `14,000 × 1`              |    14,000 |    135 |          1.0× |                   1.15× |                 1.35× |         0.55 |                0 |               2 |
| MK6 · Omegazell / The Meteor | Bonus | Meteorite          | Fixed                     |    30,000 |    151 |          1.0× |                    1.0× |                  1.0× |            0 |                0 |               0 |

Boss contact with the player deals 24. The MK6 hull cannot fall below 50% until
its phase-shift raid is complete. Its Regenesis attack can add a shield of 10%
of maximum boss HP for 30 seconds.

### Boss attack values

| Attack                          | Values in source                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Phase thresholds                | 66% and 33% boss HP for MK1–MK5                                                                                                           |
| MK1 barrage                     | `9 + 3 × phase` rocks                                                                                                                     |
| MK2 convergence                 | `6 + 2 × phase` homing rocks                                                                                                              |
| MK3 pinball cascade             | `4 + phase` bounce rocks; 0.85 s charge; 0.55 s launch cadence                                                                            |
| MK3 ricochet ring               | Up to `4 + phase` rocks, limited by 10-rock cap                                                                                           |
| MK4 ignition strikes            | 5 strikes, or 6 at phase 2; first warning 0.95 s, then +0.22 s each; explosion damage 62 and an additional 24 player damage within 150 px |
| MK4 boom launch                 | 1.1 s warning; launched boom rocks live up to 30 s                                                                                        |
| MK5 meteor wall                 | `9 + 3 × phase` streaks over 3.6 s                                                                                                        |
| MK6 shower / barrage duration   | 6.2 s each; meteors spawn every 0.34 s                                                                                                    |
| MK6 meteor beam                 | 4 arms, 8 while enraged; sweep 0.24 rad/s; 9 player damage per 0.6 s contact tick                                                         |
| MK6 strikes                     | 5; warnings 2.4 s then +0.5 s each; blast damage 74 and an additional 30 player damage in strike radius 150–215                           |
| MK6 asteroid field              | 12 rocks at 60% of normal health; lasts 7.5 s                                                                                             |
| MK6 singularity                 | Pull 420; lasts 7.5 s; radius `1.5 × larger playfield dimension`                                                                          |
| MK6 singularity health          | MK3 90; MK4 160; MK5 240; MK6 330                                                                                                         |
| MK6 singularity radius          | MK3 24; MK4 28; MK5 32; MK6 36                                                                                                            |
| MK6 Regenesis blasts            | 3 at 1.1, 2.1, and 4.4 s; each can damage player for 28 within 390 px                                                                     |
| MK6 beam sweep / player contact | 9 damage, then 0.6 s contact cooldown                                                                                                     |

## Stat upgrades

| Upgrade                | Max stacks | Rarity / roll weight | Effect per stack                                               |
| ---------------------- | ---------: | -------------------- | -------------------------------------------------------------- |
| Overclocked Barrels    |          6 | Common / 1.0         | Fire rate ×1.09                                                |
| Hollow-Point Payload   |          6 | Common / 1.0         | Weapon damage ×1.12                                            |
| Vector Thruster Kit    |          4 | Common / 1.0         | Thrust ×1.09; max speed ×1.06; turn rate ×1.04                 |
| Reinforced Hull        |          6 | Common / 1.0         | Maximum hull +18 and immediately repairs 18                    |
| Reactive Armor Plating |          3 | Rare / 0.7           | Incoming damage −12 percentage points; maximum 36% reduction   |
| Twin-Linked Feeder     |          3 | Rare / 0.7           | +1 projectile per projectile volley                            |
| Sabot Rounds           |          3 | Rare / 0.7           | +1 projectile pierce                                           |
| Targeting Optics       |          5 | Common / 1.0         | +7 percentage points critical chance; critical multiplier 2.2× |

## Salvage drone

| Value                                     |                                                   Setting |
| ----------------------------------------- | --------------------------------------------------------: |
| Purchase price                            |                                               260 credits |
| Starting / maximum health                 |                                                   24 / 24 |
| Health per Armor Plating level            |                                                       +12 |
| Damage reduction by armor level 1 / 2 / 3 |                                           15% / 30% / 60% |
| Rebuild time after destruction            |                        2.5 s (after the next wave starts) |
| Initial assembly animation                |                                                     1.8 s |
| Starter pulse timer                       |                                                       4 s |
| Twin Cannons maximum extra starter shots  |                        +1 per level (starter cannon only) |
| Non-starter multiple-volley cap           | 4 shots, with extra Twin Cannon shots for allowed weapons |
| Standard drone shot base damage           |                          3.5 before ×0.22 support scaling |
| Standard drone shot base speed            |                            430 before ×0.78 speed scaling |
| Drone mounted weapon damage scale         |         22% of installed weapon damage, before Overcharge |
| Drone attached Arc damage scale           |                                  45% of player Arc damage |
| Drone attached Beam damage scale          |                                    18% of player Beam DPS |
| Drone body growth                         |             +3.5% per total upgrade level, capped at +34% |

| Drone upgrade    | Base price | Maximum level | Final-level price multiplier |
| ---------------- | ---------: | ------------: | ---------------------------: |
| Twin Cannons     |         90 |             3 |                         2.5× |
| Overcharge Core  |        105 |             3 |                         2.5× |
| Piercing Rounds  |        120 |             2 |                         2.5× |
| Armor Plating    |         75 |             3 |                         2.5× |
| Repair Pulse     |         90 |             3 |                         2.5× |
| Magnet Coil      |         65 |             3 |                         2.5× |
| Wide Scan        |         70 |             3 |                         2.5× |
| Follow Thrusters |         75 |             3 |                         2.5× |

Next drone-upgrade price is `round_to_nearest_5(base × 1.45^current_level ×
final_multiplier)`. Armor plating also adds 12 health per level. Drone collisions
with rocks deal 14 for meteors, 4 for meteorites, or `8 + 4 × rock size` for
other rocks before drone armor.

Repair Pulse heals `0.9 × level` hull every `7.5 − 0.9 × level` seconds (minimum
3.4 s); at level 3 it heals 4.2 instead. Its reach is `150 + 35 × Scan level`,
plus 80 at Scan level 3. Drone pickup magnet reach is `76 + 48 × Magnet level +
42 × Scan level`, plus 90 at Magnet level 3. Drone targeting range is `310 +
90 × Scan level`, plus 150 at Scan level 3 and 120 when mounting a weapon.
Overcharge adds 1.8 support damage per level, then applies the multiplier
`(1 + 0.28 × level) × (1 − 0.08 × max(0, level−1))`; level 3 also multiplies by
1.65. Mounted weapons use reduced damage and fire cadence so their support
damage stays below the player's output.

## Wave progression, spawns, and economy

| Setting                                |                                                                        Value |
| -------------------------------------- | ---------------------------------------------------------------------------: |
| Main campaign                          |                                                25 waves; boss every 5th wave |
| Difficulty scale                       |                                                     `scaled_wave = wave × 2` |
| Sector changes                         | Waves 1, 6, 11, 16, 21; seven available visual themes including bonus sector |
| Rock count on regular wave             |                                       `min(9, 3 + ceil(scaled_wave × 0.85))` |
| Regular-wave rock size                 |                                                        45% large; 55% medium |
| Sentinel additions per wave            |            Wave 1: 0; waves 2–3: 1; waves 4–5: 2; wave 6+: 3, subject to cap |
| Late warden appearance                 |                                   Waves 21–24; 50% even waves, 30% odd waves |
| Warden wave rock reduction             |                                      `max(3, round(base rock count × 0.55))` |
| Wave completion credits                |                                                             `80 + 24 × wave` |
| Meteor shower eligibility              |                                 After wave 10; one per wave, no boss overlap |
| Meteor shower duration / spawn cadence |                                                    7.5 s / random 0.28–0.5 s |
| Meteorite chance per shower meteor     |                                                                          55% |
| Shower completion bonus                |                                               100 credits; one-wave cooldown |
| Boss field rock cap                    |                                                           10 non-event rocks |
| Boss-launched rock lifespan            |                                                                         30 s |
| Missiles replenished at wave start     |                                                       +1 up to rack capacity |

Plain asteroid score by size is 120 / 70 / 40 (large / medium / small); special
rock score is 1.5×. Every four combo kills adds 0.5× score multiplier. Rock XP is
32 / 18 / 11 by size, multiplied by 1.3× for special traits and by the current
wave XP scale. Meteor gives 22 XP; meteorite gives `8 × wave XP scale`.

Normal asteroid drops: chance is `0.72 + 0.07 × size`; drop count is 3 / 2 / 1
for large / medium / small. Each pickup is a repair with 12% chance, otherwise
credit. Credit pickup values are 12 / 7 / 4 times the credit-value multiplier.
Boss death drops 8 pickups (36 credits each) or, for the final boss, 12 pickups
(60 credits each); each has 20% repair chance.

## Other fixed combat and simulation values

| Item                                                 |                                                                         Value |
| ---------------------------------------------------- | ----------------------------------------------------------------------------: |
| Sentinel / warden projectile damage                  |                                                                        7 / 12 |
| Boss ring / fan projectile damage                    |                                                                         8 / 9 |
| MK1–MK5 shockwave                                    | Base radius `190 + boss MK × 35`, up to 1.75× at low health; 22 player damage |
| MK4 signature strikes                                |                     Explosion damage 62; extra 24 player damage within 150 px |
| MK6 strikes                                          |              Explosion damage 74; extra 30 player damage within strike radius |
| MK6 regenesis blast / meteor beam damage             |                                           28 within 390 px / 9 per 0.6 s tick |
| Boss explosion knockback blast default player damage |                                                  6 within 60% of blast radius |
| Boss hull contact / enemy drone contact              |                            24 / 14 to player; 30 to the colliding enemy drone |
| Level-up hull repair                                 |                                                            Up to 20 per level |
| XP required for next level                           |                                    `round(100 × level^1.26)` after each level |
| XP scaling                                           |                                                     `1 + scaled_wave × 0.024` |
| Sentinel / warden XP                                 |                                              60 / 120, multiplied by XP scale |
| Sentinel / warden kill credit drops                  |                                                       3 × 14 / 4 × 20 credits |
| Enemy projectile general default radius / lifetime   |                                                                    5 px / 5 s |
| Player fire assist acquisition range                 |                                               920 px; aim nudge cap 0.085 rad |
| Player missile target range / missile speed          |                                                                  900 px / 380 |
| Bullet guidance search range                         |                                Missile 900; rail 1500; other guided shots 520 |
| Player frame delta cap                               |                                                                        0.05 s |
| Initial star count                                   |                                                                           260 |
| Particle cap                                         |                                                                           700 |
| Normal explosion slowdown                            |                                                               time scale 0.62 |
| Boss rock field cap / boss rock lifetime             |                                                                     10 / 30 s |
| Boss starting attack timer                           |                                                                         2.2 s |
| Boss drift speed                                     |                                              MK1/2/4/5: 30; MK3: 110; MK6: 38 |

## Notes on interpreting this list

Health and damage values above are the source's configured values, not
promises that every encounter uses the same exact value: rock health scales
with wave; player damage scales with armor; weapon damage scales with weapon
upgrades, stat upgrades, and critical hits; boss explosions can apply distance
falloff; and some attack timings and spawn counts include random ranges. The
code may contain additional presentation-only numbers for colors, animation,
layout, and particles. This reference focuses on gameplay balance values.

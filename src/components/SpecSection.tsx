import { useState } from "react";
import panelImg from "../assets/panel.jpg";

const ARENA_PROMPT = `You are a senior gameplay engineer and arcade game designer. Build a complete, polished, browser-playable arcade game inspired by Atari's Asteroids, modernised for today's players. Deliver a single self-contained web app (React + Vite + Tailwind is available; a hand-written HTML5 canvas loop is preferred over a heavy engine).

CORE LOOP (must be fun inside 10 seconds)
- Player ship with true inertial flight: rotate, thrust, drift, drag; the ship wraps around screen edges.
- Solid collision between the ship and every hostile. Use a swept (multi-sample) test, because at top speed the ship can move further in one frame than a rock's diameter and will otherwise tunnel straight through it. On contact: separate the bodies, reflect velocity, damage both, and grant brief invulnerability frames.
- Homing missiles are a regenerating resource, not a finite pool of three: refill one round on a timer, top the rack up between waves, and edge-trigger the input so holding the key cannot dump the whole rack in a second.
- Procedurally generated asteroids with jagged silhouettes that split into smaller, faster fragments when destroyed.
- Two enemy roles with real AI. Sentinels are small single-shot hunters: they orbit the player at a long standoff range, flip orbit direction on a timer, lead their shots by the player's velocity, side-step incoming projectiles with an evasive burst, retreat further when low on health, and fire two-round bursts from wave 8. Wardens are larger heavies — much more HP, a long reload, but a genuinely fast sniper shell that pressures the player and drone. The two must be visually distinct at a glance: keep the sentinel a clean, light arrowhead, and give the warden a deliberately ominous silhouette — a hunched, horned siege hull with swept mandibles, ribbed spine plates, a dread halo and a single slow-blinking cyclops eye. Every shot is telegraphed.
- Special asteroid traits follow the compressed sectors: sector 1 (waves 1–4, MK1 on 5) is plain stone only — NO homing rocks at all until that boss is beaten. Homing rocks enter from wave 6, bouncing rocks from 11, explosive rocks from 16, and fast rocks from 21. Traits pass down to every fragment when a rock splits, but the fragments are weaker: an explosive small shard deals a quarter of the parent's blast damage over a much smaller radius, smaller homing shards turn slower, and so on. Colour-code each trait and give it a distinct glyph.
- Homing behaviour (missiles and homing rocks) must be direct, not fast: use a high turn rate with a short velocity lead on the target, never a speed increase.
- Collision knockback scales with asteroid size — a small shard shoves the ship far less than a large rock.
- The run has 25 waves: sectors 1–5 each contain four combat waves and a boss on the fifth. MK1 is wave 5, MK2 wave 10, MK3 wave 15, MK4 wave 20, and MK5 is the final boss on wave 25. Enemy HP, count, projectile cadence and rewards use the equivalent point on the former 50-wave curve so shortening the run does not flatten its difficulty.
- Every dreadnought is different: MK1 sheds normal rocks, MK2 homing rocks, MK3 bouncing rocks, MK4 explosives, and MK5 fast rocks. Each has its own name plate, colour, health, attack tempo and spawn weighting. Every boss arrives with sentinels; MK4 and MK5 also bring wardens.
- Boss battles are structured, not cluttered: passive asteroid spawn rates are reduced during boss waves, and at each stage change (66% and 33% HP) the dreadnought detonates every rock currently on the field, then opens a new attack set — MK1 barrage, MK2 converging homers, MK3 pinball cascade, MK4 ignition strikes, MK5 fast meteor wall.
- Bosses are roughly 10% smaller than the earlier cabinet build and each has a distinct in-bounds movement pattern: MK1 retains its original drift; MK2 slowly homes toward the player; MK3 actively glides around the arena and bounces off walls and corners, gaining 3% speed per bounce up to 15% max; MK4 maintains dangerous distance from the player while dropping local ignition strikes more often; MK5 clearly highlights its complete trajectory corridor and destination box for 2.4 seconds with glowing rails, animated chevrons, and countdown before dashing at extreme speed. All normal movement is clamped to the arena borders.
- MK6 movement is a scripted half-health phase shift that waits until every active MK6 ability has ended. At 50% it disappears offscreen, appears at the left and right arena edges facing inward while launching dense 3-meteor salvos across the screen, marks the exact center of the map with a return box, and re-enters to anchor itself in the center before abilities resume.
- MK3 (RICHTZELL) is built entirely around BOUNCING ASTEROIDS and never plays the same way twice. Two unique signature abilities: (1) PINBALL CASCADE — a telegraphed charge ring, then a short volley of bounce rocks launched from a RANDOMIZED screen edge at a RANDOMIZED inward angle, so the ricochet pattern is different every attempt; (2) RICOCHET RING — a rotating ring of ghost bounce rocks forms around the boss, then fires them outward one at a time, each mirror-aimed at the player's live position from its own orbital launch point. Both are strictly capped by the boss rock cap so the arena never floods, and the boss keeps its ice-cyan theme.
- Wave 25 is the mega final boss; defeating it opens the victory state and optional MK6 encounter.
- Meteor showers can occur past wave 10 (with a cooldown afterwards), preserving their former midpoint placement in the compressed run — but they must NEVER roll during any main-run dreadnought fight: both a live boss and the boss wave itself block the roll. MK6's own meteor abilities are a separate system and are unaffected. For roughly eight seconds, meteors cross the sector while salvageable meteorites rain in. Completing that wave awards 100 credits.
- Sentinels are capped concurrently so pressure stays readable: 2 in sector 1, 3 in sector 2, 4 in sector 3, 5 in sector 4, 6 thereafter. The opening waves introduce them sparingly — none on wave 1, one on waves 2–3, two on waves 4–5. Boss escorts and late-run warden reinforcements respect the same cap.
- Defeating the wave-25 boss offers the optional THE METEOR (MK6) encounter, with its existing meteor shower, barrage, beam, strikes, random field, singularity, regenesis, escorts and dual-ability enrage intact. The meteor beam is deliberately gentle — a slow sweep the player can walk out of, with light contact ticks on a long immunity window so overlapping arms can never stack into a burst kill.
- Wardens retain their anchored sniper and splitter-nest behavior. They can also appear during sector 5's combat waves 21–24; when one appears, asteroid density is reduced so the miniboss remains readable.
- Bouncing asteroids are noticeably faster (with smaller sizes moving even quicker), bouncing off arena boundaries, other asteroids, enemies, and the player while gaining speed on every bounce. Each bounce adds 5% speed, capping at 30% above the base speed.
- Boom asteroids feature a short proximity fuse that hisses and flashes before exploding automatically when the player gets too close. They have a larger blast radius than standard boom asteroids.
- All dreadnoughts (MK1–MK5, but not MK6) run a SHOCKWAVE blast that detonates a ring around the boss: MK1 telegraphs for ~2.6s (plenty of room), each subsequent MK shortens the warning until MK5 leaves little to no time. MK3, MK4, MK5 and MK6 additionally summon a SINGULARITY — a gravitational anomaly pulling the player from anywhere in the sector. Singularities can now be DESTROYED BY SHOOTING at them (scaling from sentinel HP on MK3 to full warden HP on MK6), with aim assist and weapon targeting locking onto them. Each singularity is visually themed after its summoning boss (MK3 ice cyan, MK4 volcanic fire orange, MK5 storm violet-white, MK6 radiant warm solar gold with dense particle accretion streaming rapidly into the event horizon). Collapsing a singularity awards score and XP.
- Dreadnoughts MK1–MK5 must never bury the arena in their own spawns: cap how many non-event asteroids can be on the field before spawn and rain patterns stop adding more, and space those patterns out. MK5's meteor wall is an exception — it can be large, but every wall rock carries a ~20s lifetime so it self-clears. This cap must not apply to MK6, whose asteroid field is a deliberate, self-clearing set piece.
- Sectors change after each boss: sector 1 waves 1–5, sector 2 waves 6–10, sector 3 waves 11–15, sector 4 waves 16–20, and sector 5 waves 21–25. The nebula, star palette and ambient tint change at waves 6, 11, 16 and 21.
- A combo multiplier (up to x8) that rewards continuous kills and decays after ~4 seconds without a kill.
- Score, credits and XP are three separate currencies so that kills feel rewarding in different ways.

PROGRESSION & ECONOMY
- XP from every kill. Levelling up freezes the action (time dilation, not a hard stop) and presents 3 randomly weighted upgrade cards — but if every stat upgrade is already at its cap, the rack is skipped entirely (the level and its +20 hull patch still apply) so a fully-built ship never stalls on an empty screen.
- Level-up loot contains stat abilities only — never weapons and never weapon levels. Stat upgrades stack and show their current count. There are no shields, no boost, no economy upgrades and no time-dilation ability. Credits can reroll the stat rack at an exponential cost (30 → 54 → 97), resetting at the next level-up.
- Stat upgrade pool: fire rate, damage, extra projectile per volley, projectile pierce, critical chance, thrust & top speed, max hull + repair, and stacking damage-reduction armor plating. Keep per-level gains deliberately modest (roughly 8-12% per stack) so power comes from accumulating many choices across a long run rather than from two or three purchases. There are no lifesteal, passive hull regeneration, or missile-rack upgrades. Base regenerating missiles, level-up healing, repair pickups, and the salvage drone's Repair Pulse remain available.
- Every level-up also repairs 20 hull, so pushing for XP is itself a small lifeline.
- Eight weapons with real mechanical differences: rapid pulse cannon, scattershot cone, a homing low-damage seeker pulse that hunts the nearest target, a ricochet blaster whose slugs bounce off the sector edges, a flak cannon whose timed shells burst into rings of shrapnel, an arc coil that chains short-range lightning between targets, a continuous raycast beam with an overheat gauge, and a slow high-damage piercing railgun. Plus regenerating homing missiles with AoE explosions on a separate key. Owned weapons can be cycled with Tab / Q or selected with 1–8.
- Credits have three uses: rerolling the stat rack, buying/leveling weapons, and building the salvage drone. Between-wave salvage income is sized so a player is guaranteed to be able to afford real shop choices early — clearing the four waves before the MK1 boss pays roughly 760 credits on its own. Credit drop chance and yields should feel generous enough that collecting shards is exciting, with a bright multi-particle burst, ring and distinct pickup sound whenever a credit cache is created.
- XP rewards ramp with the sector rather than staying flat, and the level curve is soft enough that a run reaching sectors 3–5 chains many more upgrades than the opening waves allow. The shop lists every weapon with rarity pricing (common affordable, rare mid-priced, epic expensive). A weapon must be bought before it can be upgraded, and every later level is bought with credits. Selecting a weapon opens a detail view with its description, current stats, next-level stats and changed values clearly marked. Opening the shop during play pauses the simulation; it can also be entered from the pause menu and level-up intermission, returning to the exact state it came from when closed.
- Add a permanent run purchase called "Deploy Salvage Drone" with a meaningful base price relative to early credit income. On purchase, play a short "Drone Assembled" flourish and spawn a small companion next to the player. It follows with lag and a gentle orbit, has a separate small hull pool, can be destroyed by asteroid collisions and enemy fire, explodes with its own sound, and respawns for free at the next wave after a short rebuilding delay. The purchase and every drone upgrade persist for the rest of the run; destruction never wipes the build.
- The drone is an undertuned chassis, not a second player. It starts with no weapon and only a small salvage field. Its shop has three mutually reinforcing paths with soft caps and escalating prices: Offense (Twin Cannons, Overcharge Core, Piercing Rounds), Defense/Support (Armor Plating, Repair Pulse — no shield system, no hull relay), and Utility (Magnet Coil, Wide Scan, Follow Thrusters). Upgrades must visibly change the modular sprite in real time: twin cannon mounts, armor plates, a glowing magnet ring, scan arc, overcharge core and other attachments. It can collect credit shards, fire weak support shots only after buying offense upgrades, and never approaches the player's damage ceiling.
- The drone has a level-0 starter cannon so the chassis is never a dead purchase. Any weapon already unlocked in the credit shop can be mounted on the drone from the Drone Hardpoint UI, except the weapon currently equipped by the player. The UI must show mounted weapon, available owned weapons, the player-current lockout, and a base-cannon detach option. A mounted weapon uses the player's installed weapon level but is heavily downscaled as support output.
- The last upgrade level in each drone path is intentionally expensive and substantially more transformative: Twin Cannons becomes a visible minigun, Armor Plating reaches a large damage reduction, Overcharge gets a major capacitor surge, and the final Utility levels create a much larger magnet/scan/follow envelope. The drone sprite grows slightly as total upgrades accumulate.

FEEL & JUICE (this is the priority, not the feature list)
- Screen shake scaled to the size of the event, hit-flash on damaged entities, additive-glow particles, debris trails, expanding shockwave rings, floating damage/score text, critical-hit callouts, muzzle flashes, engine exhaust particles, and brief slow-motion on large explosions.
- Asteroids visibly fracture as they take damage: pre-generate jagged crack seams per rock and reveal them progressively, with molten light bleeding through the widening seams so a rock reads as "nearly dead" before it splits.
- Procedural audio synthesised with WebAudio (no sample files): weapon reports per weapon type, a continuous filtered beam drone whose timbre tracks the overheat gauge, layered noise-burst explosions, hull impacts, pickup blips and a level-up arpeggio. Rate-limit and voice-cap every sound, route through a compressor, and ship a persisted mute toggle.
- Slight aim assist: search a narrow cone (~11 degrees) for the best target, lead it by its velocity, then nudge the shot only a fraction of the way there with a hard cap (~5 degrees) so the player still owns the aim. Give the beam a small edge tolerance so grazes connect.
- Consistent 60fps target on both desktop and mobile: cap and pool particles, avoid per-frame allocations, use devicePixelRatio-aware canvas scaling, and clamp delta time.

CONTROLS
- Keyboard: WASD / arrow keys to fly, Space to fire, Tab / Q to cycle weapons, 1–8 to select a weapon, E for missiles, P or Esc to pause, R to instant-restart from pause or game over.
- Touch: left half of the screen is a floating virtual stick for steer + thrust, right half holds to fire, plus dedicated on-screen Weapon and Missile buttons. All controls must be multi-touch aware.
- The pause screen is the hub: it shows the owned arsenal with level pips, and hosts the Weapon Shop, Settings panel and the Service Code panel. Settings (all persisted) include auto-fire; the flight scheme, which is a mutually exclusive three-way choice — Hybrid Aim (the default: twin-stick handling where the hull always tracks the cursor while WASD / arrows push the ship in world space and clicking fires), Mouse Control (the ship faces the cursor and holds the left button to thrust), and Legacy Movement (the opt-in classic scheme: rotate with A/D or the arrows, thrust with W, no mouse aiming); screen shake; and audio. Turning the active flight scheme off falls back to Legacy Movement.
- The service code gates a developer console split across two pages. Page one holds field controls: score, credits, hull, kill-all, wave progression, boss tier summons and mob/asteroid spawns. Page two holds loadout controls: a single "Max All" button that unlocks every weapon at max level, every stat upgrade at cap, the fully-upgraded drone, max hull, max HP, max credits and score; a per-upgrade stack picker that lets a developer choose exactly which stat upgrades are unlocked and how many times each is stacked (with +1 All / Max / Zero shortcuts, live counts and per-cap disable); plus level-ups, weapon selection, weapon levels and the full Salvage section for drone HP, path levels, mounted weapon and dev-only 1×/2×/3× drone spawns. Editing a stack count must rebuild the derived stats from their base values rather than compounding on live ones, so the numbers always match the ship.
- A mounted drone weapon must inherit the real projectile identity of that weapon — kind, colour, radius, lifetime, spread arc, pierce, bounces, fuse and shrapnel — not just a damage number. A mounted Beam must be a real continuous beam of light (a raycast that stops at the first target, drawn with a hot landing spot, on a smoothly tracking turret). A mounted Arc must chain as visible lightning from the drone with no facing cone. Only Pulse, Ricochet and Scatter may fire more than one projectile per volley from the drone regardless of Twin Cannon level; for every other weapon, Twin Cannons speed the cadence instead of adding volume. Only damage, fire rate and shrapnel output are scaled down so the drone stays support-tier. No mounted weapon may trigger a looping audio voice.
- Dev-spawned extra drones must be real units — each with its own orbit slot, position, health, collisions and fire state sharing the primary build — never decorative clones drawn around the first one.
- The pause screen lists every stat upgrade taken with its stack count, plus a "combined effect" ledger computed from live ship state (fire rate, damage, projectiles, pierce, crit, thrust, top speed, max hull, damage taken), so the player can read exactly what their boosts add up to.
- The player's Arc Coil must discharge reliably whenever a hostile is within range: measure the facing cone off the aim-assisted heading, not the raw hull angle, and keep the half-cone generous so a target just off-axis never makes the weapon appear to stall.
- Audio hygiene: no one-shot event may start a persistent looping voice (the classic bug is a boss attack triggering the player's beam drone and never stopping it). Bosses get their own charge and death sounds.

GAME STATES & UI
- Start screen with title, short pitch, control legend and the local top-scores table.
- Pause overlay (resumable), game-over overlay with final score, wave reached and instant restart, and a distinct victory overlay shown when the wave-25 final boss falls.
- Persistent local high-score table (localStorage, top 10, sorted, never crashes on corrupt data).
- HUD telemetry: score, wave, multiplier, credits, hull, sector, missiles, weapon name and level, XP progress toward the next upgrade, and a small salvage-drone status/hull signal when owned. Add a compact hotbar at the bottom of the playfield showing every unlocked weapon, its numeric keyboard slot and its current level; clicking a slot equips it.

ART DIRECTION
- Cohesive late-1970s vector-arcade look: dark indigo-black space, sodium-amber phosphor strokes, ice-blue for energy systems, signal magenta reserved for danger (missiles, enemy fire).
- Typography: a heavy display face for the title and score readouts, a monospaced face for all telemetry, with tracked uppercase "engraved legend" labels.
- Layout should not be a generic centred card: inset the playfield in a cabinet-style bezel with engraved rails, pin HUD data to the corners, and slide the upgrade rack in from the side.

QUALITY BAR
- Organise the simulation into small modules — pure types, math helpers, tuning tables (weapons, upgrades, boss tiers, sectors), procedural audio, and the game class itself. New content should land in the tables first so the class body rarely needs to change, and dead code (unused fields, superseded patterns, unplayed audio cues) should be removed rather than left in place.
- No dead states: every screen has considered empty, hover, focus and disabled states; respect prefers-reduced-motion.
- Accessible focus rings and aria labels on interactive controls.
- Verify the build compiles and the game runs at a stable frame rate before responding.`;

const MANUAL_ROWS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Inertia is the verb",
    body:
      "The ship never stops where you expect it to. Every decision — lining up a shot, dodging a drone bolt, drifting through a credit field — is really a decision about momentum. Thrust changes momentum; drag only softens it.",
  },
  {
    n: "02",
    title: "The armory owns weapon progression",
    body:
      "Level-up cards are stats only. Pulse, Scatter, Seeker, Ricochet, Flak, Arc, Beam and Rail live in the credit shop; buy a weapon to unlock it, then buy each of its six levels. The detail panel compares current and upgraded stats before you spend. Tab cycles, 1–8 selects, and the in-play hotbar shows every installed level.",
  },
  {
    n: "03",
    title: "Credits are a build language",
    body:
      "Credit shards arrive more often and in larger caches. Spend them on stat-rack rerolls, weapon purchases and weapon levels, or deploy the permanent Salvage Drone chassis. The base drone is intentionally weak; the real decision is whether to lean into red offense, ice support or amber utility attachments.",
  },
  {
    n: "04",
    title: "The drone has a hardpoint",
    body:
      "The chassis always has a tiny level-zero cannon. Once another weapon is bought, the Drone Hardpoint can mount any owned weapon the player is not currently using. The mounted armament changes the silhouette and stays attached through rebuilds; the drone's copy is intentionally weaker than the ship's.",
  },
  {
    n: "05",
    title: "Special rocks arrive on a schedule",
    body:
      "The five sectors compress the trait schedule: rare homers can tease from wave 3, homing enters at 6, bouncers at 11, explosives at 16 and fast rocks at 21. Traits still pass to every shard, with smaller effects on smaller fragments.",
  },
  {
    n: "06",
    title: "The beam has a cost",
    body:
      "The continuous beam emitter is the highest sustained damage in the game and the only weapon with an overheat gauge. Push it to 100% heat and it locks out until it cools to 15%.",
  },
  {
    n: "07",
    title: "Sentinels hunt, wardens punish",
    body:
      "Sentinels are the small fast ones — they orbit, flip direction unpredictably, lead your velocity, side-step shots and burst-fire mid-run. Wardens are the big silhouettes that only come with the late dreadnoughts: heavy bolts on a long cooldown, more hull, slower evasions. Both telegraph every shot with a charging muzzle glow.",
  },
  {
    n: "08",
    title: "Rocks tell you when they are dying",
    body:
      "Every asteroid carries pre-generated fracture seams. They open and glow molten as damage accumulates, so you can read a rock's remaining health from its surface instead of a health bar.",
  },
  {
    n: "09",
    title: "Assist, not autopilot",
    body:
      "Shots search a narrow cone, lead the target by its own velocity, then bend a fraction of the way toward the solution with a hard five-degree cap. Enough to reward a rough line; never enough to take the shot for you.",
  },
  {
    n: "10",
    title: "Death is a restart, not a menu",
    body:
      "R from the game-over screen (or a single tap on touch) drops you straight back into wave one with the run fully reset. High scores persist in localStorage, top ten, corrupt-data safe.",
  },
  {
    n: "11",
    title: "A dreadnought every five waves",
    body:
      "Bosses land on waves 5, 10, 15, 20 and 25. Each fifth wave replaces the field with its sector's dreadnought; phase changes still arrive at 66% and 33% HP, and MK5 on wave 25 remains the final main-run fight.",
  },
  {
    n: "12",
    title: "The map remembers where you are",
    body:
      "Each boss closes a five-wave sector. Waves 6, 11, 16 and 21 change the nebula wash, star palette and ambient tint with a slow cross-fade and a named sector banner. Wave 25 closes sector five.",
  },
];

export default function SpecSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ARENA_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section id="spec" className="relative border-t border-steel/25 bg-void">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{ backgroundImage: `url(${panelImg})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div className="relative mx-auto w-full max-w-[1500px] px-5 sm:px-10">
        {/* header band */}
        <div className="grid grid-cols-1 items-end gap-6 border-b border-steel/30 py-12 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="legend text-amber/70">Section Two · Build Specification</p>
            <h2 className="mt-3 font-display text-[clamp(2.2rem,7vw,5rem)] leading-[0.88] tracking-[-0.03em] text-amber-hot">
              THE PROMPT THAT<br />BUILT THIS CABINET
            </h2>
          </div>
          <p className="max-w-sm text-[12px] leading-relaxed text-amber/60">
            Everything above was produced from the brief below. It is written the way an operator's
            manual is written — measurable, ordered and free of adjectives that cannot be tested.
            Copy it, paste it into Arena, and it will build the same game.
          </p>
        </div>

        {/* prompt + manual */}
        <div className="grid grid-cols-1 gap-10 py-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="flex items-center justify-between border border-steel/40 border-b-0 bg-graphite/60 px-4 py-2.5">
              <p className="legend text-amber/70">arena-prompt.txt</p>
              <button
                onClick={copy}
                className="border border-amber/50 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.22em] text-amber transition-colors hover:bg-amber hover:text-void focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                {copied ? "Copied ✓" : "Copy prompt"}
              </button>
            </div>
            <pre className="thin-scroll max-h-[560px] overflow-auto border border-steel/40 bg-black/45 p-5 text-[11px] leading-[1.85] whitespace-pre-wrap text-amber/75">
              {ARENA_PROMPT}
            </pre>
          </div>

          <div>
            <p className="legend mb-4 text-amber/70">Operator's Notes</p>
            <ol>
              {MANUAL_ROWS.map((row) => (
                <li
                  key={row.n}
                  className="group grid grid-cols-[2.4rem_1fr] gap-4 border-t border-steel/30 py-5 transition-colors hover:bg-amber/[0.05]"
                >
                  <span className="font-display text-[15px] leading-none text-amber/35 transition-colors group-hover:text-amber">
                    {row.n}
                  </span>
                  <div>
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-amber-hot">{row.title}</h3>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-amber/58">{row.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8 border border-steel/40 bg-graphite/50 p-5">
              <p className="legend text-amber/70">Control Map</p>
              <dl className="mt-3 space-y-2 text-[11px]">
                {[
                  ["Steer / Thrust", "WASD · Arrow keys · Left-half touch stick · Mouse or Hybrid Aim (setting)"],
                  ["Fire", "Space · Ctrl · Hold right half of screen · Auto (setting)"],
                  ["Cycle weapon", "Tab / Q · 1–8 direct · On-screen WEAPON button"],
                  ["Missiles", "E · On-screen MISSILE button"],
                  ["Pause", "P or Esc"],
                  ["Instant restart", "R (pause & game over)"],
                  ["Mute audio", "♪ toggle, top-right of the bezel"],
                  ["Weapon shop", "SHOP bezel button · Pause → Weapon Shop · Level-up intermission"],
                  ["Settings", "Pause → Settings (also on the start screen)"],
                  ["Diagnostics", "Pause → Service Code unlocks the dev console"],
                  ["Dev Console", "Press ` (backquote) — only works after the service code is entered"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 border-b border-steel/20 pb-2">
                    <dt className="uppercase tracking-[0.16em] text-amber/50">{k}</dt>
                    <dd className="text-right text-amber-hot/90">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-steel/30 py-8">
          <p className="legend text-amber/40">
            Helios Drift · Vector Arcade System · Built with a hand-written canvas engine, React &amp; framer-motion
          </p>
          <a
            href="#top"
            className="border border-steel/50 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-amber/70 transition-colors hover:border-amber hover:bg-amber/10"
          >
            ↑ Back to the cabinet
          </a>
        </div>
      </div>
    </section>
  );
}

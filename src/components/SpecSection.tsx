import { useState } from "react";
import panelImg from "../assets/panel.jpg";
import ARENA_PROMPT from "./arena-prompt.txt?raw";

const MANUAL_ROWS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Inertia is the verb",
    body: "The ship never stops where you expect it to. Every decision — lining up a shot, dodging a drone bolt, drifting through a credit field — is really a decision about momentum. Thrust changes momentum; drag only softens it.",
  },
  {
    n: "02",
    title: "The armory owns weapon progression",
    body: "Level-up cards are stats only. Pulse, Scatter, Seeker, Ricochet, Flak, Arc, Beam and Rail live in the credit shop; buy a weapon to unlock it, then buy each of its six levels. The detail panel compares current and upgraded stats before you spend. Tab cycles, 1–8 selects, and the in-play hotbar shows every installed level.",
  },
  {
    n: "03",
    title: "Credits are a build language",
    body: "Credit shards arrive more often and in larger caches. Spend them on stat-rack rerolls, weapon purchases and weapon levels, or deploy the permanent Salvage Drone chassis. The base drone is intentionally weak; the real decision is whether to lean into red offense, ice support or amber utility attachments.",
  },
  {
    n: "04",
    title: "The drone has a hardpoint",
    body: "The chassis always has a tiny level-zero cannon. Once another weapon is bought, the Drone Hardpoint can mount any owned weapon the player is not currently using. The mounted armament changes the silhouette and stays attached through rebuilds; the drone's copy is intentionally weaker than the ship's.",
  },
  {
    n: "05",
    title: "Special rocks arrive on a schedule",
    body: "The five sectors compress the trait schedule: rare homers can tease from wave 3, homing enters at 6, bouncers at 11, explosives at 16 and fast rocks at 21. Traits still pass to every shard, with smaller effects on smaller fragments.",
  },
  {
    n: "06",
    title: "The beam has a cost",
    body: "The continuous beam emitter is the highest sustained damage in the game and the only weapon with an overheat gauge. Push it to 100% heat and it locks out until it cools to 15%.",
  },
  {
    n: "07",
    title: "Sentinels hunt, wardens punish",
    body: "Sentinels are the small fast ones — they orbit, flip direction unpredictably, lead your velocity, side-step shots and burst-fire mid-run. Wardens are the big silhouettes that only come with the late dreadnoughts: heavy bolts on a long cooldown, more hull, slower evasions. Both telegraph every shot with a charging muzzle glow.",
  },
  {
    n: "08",
    title: "Rocks tell you when they are dying",
    body: "Every asteroid carries pre-generated fracture seams. They open and glow molten as damage accumulates, so you can read a rock's remaining health from its surface instead of a health bar.",
  },
  {
    n: "09",
    title: "Assist, not autopilot",
    body: "Shots search a narrow cone, lead the target by its own velocity, then bend a fraction of the way toward the solution with a hard five-degree cap. Enough to reward a rough line; never enough to take the shot for you.",
  },
  {
    n: "10",
    title: "Death is a restart, not a menu",
    body: "R from the game-over screen (or a single tap on touch) drops you straight back into wave one with the run fully reset. High scores persist in localStorage, top ten, corrupt-data safe.",
  },
  {
    n: "11",
    title: "A dreadnought every five waves",
    body: "Bosses land on waves 5, 10, 15, 20 and 25. Each fifth wave replaces the field with its sector's dreadnought; phase changes still arrive at 66% and 33% HP, and MK5 on wave 25 remains the final main-run fight.",
  },
  {
    n: "12",
    title: "The map remembers where you are",
    body: "Each boss closes a five-wave sector. Waves 6, 11, 16 and 21 change the nebula wash, star palette and ambient tint with a slow cross-fade and a named sector banner. Wave 25 closes sector five.",
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
        style={{
          backgroundImage: `url(${panelImg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="relative mx-auto w-full max-w-[1500px] px-5 sm:px-10">
        {/* header band */}
        <div className="grid grid-cols-1 items-end gap-6 border-b border-steel/30 py-12 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="legend text-amber/70">Section Two · Build Specification</p>
            <h2 className="mt-3 font-display text-[clamp(2.2rem,7vw,5rem)] leading-[0.88] tracking-[-0.03em] text-amber-hot">
              THE PROMPT THAT
              <br />
              BUILT THIS CABINET
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
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-amber-hot">
                      {row.title}
                    </h3>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-amber/58">{row.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8 border border-steel/40 bg-graphite/50 p-5">
              <p className="legend text-amber/70">Control Map</p>
              <dl className="mt-3 space-y-2 text-[11px]">
                {[
                  [
                    "Steer / Thrust",
                    "WASD · Arrow keys · Left-half touch stick · Mouse or Hybrid Aim (setting)",
                  ],
                  ["Fire", "Space · Ctrl · Hold right half of screen · Auto (setting)"],
                  ["Cycle weapon", "Tab / Q · 1–8 direct · On-screen WEAPON button"],
                  ["Missiles", "E · On-screen MISSILE button"],
                  ["Pause", "P or Esc"],
                  ["Instant restart", "R (pause & game over)"],
                  ["Mute audio", "♪ toggle, top-right of the bezel"],
                  [
                    "Weapon shop",
                    "SHOP bezel button · Pause → Weapon Shop · Level-up intermission",
                  ],
                  ["Settings", "Pause → Settings (also on the start screen)"],
                  ["Diagnostics", "Pause → Service Code unlocks the dev console"],
                  [
                    "Dev Console",
                    "Press ` (backquote) — only works after the service code is entered",
                  ],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-4 border-b border-steel/20 pb-2"
                  >
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
            Helios Drift · Vector Arcade System · Built with a hand-written canvas engine, React
            &amp; framer-motion
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

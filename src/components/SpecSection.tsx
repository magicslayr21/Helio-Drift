import { useState } from "react";
import panelImg from "../assets/panel.jpg";
import ARENA_PROMPT from "./arena-prompt.txt?raw";

const MANUAL_ROWS = [
  {
    n: "01",
    title: "Fly the drift",
    body: "Thrust builds momentum. Leave room to turn, dodge incoming fire, and collect credits.",
  },
  {
    n: "02",
    title: "Build your loadout",
    body: "Buy and upgrade weapons in the shop. Level-up cards improve ship stats; credits also pay for rerolls and the Salvage Drone.",
  },
  {
    n: "03",
    title: "Equip your drone",
    body: "Mount an owned weapon you are not using, then add offense, support, or utility modules. A destroyed drone rebuilds at the next wave.",
  },
  {
    n: "04",
    title: "Survive five sectors",
    body: "A dreadnought arrives every five waves. Homing, bouncing, explosive, and fast asteroids appear as you advance. Glowing fractures show rock damage.",
  },
  {
    n: "05",
    title: "Pick up where you left off",
    body: "Your run saves automatically in this browser. Reopen the game to continue with your wave, hull, weapons, credits, and upgrades. Death clears that run immediately; high scores remain.",
  },
];

export default function SpecSection({ developer }: { developer: boolean }) {
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
            <p className="legend text-amber/70">Section Two · Flight Manual</p>
            <h2 className="mt-3 font-display text-[clamp(2.2rem,7vw,5rem)] leading-[0.88] tracking-[-0.03em] text-amber-hot">
              KNOW YOUR SHIP
              <br />
              SURVIVE THE BELT
            </h2>
          </div>
          <p className="max-w-sm text-[12px] leading-relaxed text-amber/60">
            Flight notes, controls, and the essentials for your next run.
          </p>
        </div>

        {/* prompt + manual */}
        <div className="grid grid-cols-1 gap-8 py-8">
          <div className="grid gap-8 lg:grid-cols-2">
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
            </div>
            <div id="controls" className="self-start border border-steel/40 bg-graphite/50 p-5">
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

        {developer && (
          <details className="border border-steel/40 bg-graphite/40">
            <summary className="cursor-pointer px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-amber focus-visible:outline-amber">
              Arena Prompt · Developer
            </summary>
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
          </details>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-steel/30 py-8">
          <p className="legend text-amber/40">Helios Drift · Vector Arcade System</p>
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

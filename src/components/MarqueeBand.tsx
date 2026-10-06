import { HeliosMark } from "./Masthead";
import { STAT_UPGRADES, WEAPON_ORDER } from "../game/balance";
import marqueeImg from "../assets/marquee.jpg";

const STATS: { k: string; v: string; n: string }[] = [
  {
    k: "Arsenal",
    v: "08",
    n: "Pulse · Scatter · Seeker · Ricochet · Flak · Arc · Beam · Rail — six levels each",
  },
  {
    k: "Upgrades",
    v: String(STAT_UPGRADES.length + WEAPON_ORDER.length).padStart(2, "0"),
    n: `${STAT_UPGRADES.length} stacking stat upgrades plus ${WEAPON_ORDER.length} weapon tracks`,
  },
  {
    k: "Sectors",
    v: "06",
    n: "The map recolours after every dreadnought — five bosses, one final Core",
  },
  { k: "Target", v: "60", n: "Frames per second, desktop and mobile, capped particles" },
];

export default function MarqueeBand() {
  return (
    <section className="relative w-full overflow-hidden border-y border-steel/25">
      {/* full-bleed marquee art, tinted into the palette */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${marqueeImg})`,
          backgroundSize: "cover",
          backgroundPosition: "center 38%",
        }}
      />
      <div className="absolute inset-0 bg-void/72" />
      <div
        className="absolute inset-0 mix-blend-color"
        style={{
          background:
            "linear-gradient(120deg, rgba(255,176,58,0.42), rgba(7,9,17,0.2) 55%, rgba(111,231,255,0.28))",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/50 to-transparent" />

      <div className="relative mx-auto w-full max-w-[1500px] px-5 py-16 sm:px-10 sm:py-24">
        <div className="flex items-start gap-5">
          <HeliosMark size={44} className="mt-1 shrink-0 text-amber/80" />
          <div className="max-w-2xl">
            <p className="legend text-amber/70">Design Principle</p>
            <h2 className="mt-3 font-display text-[clamp(1.9rem,5.2vw,3.6rem)] leading-[0.94] tracking-[-0.028em] text-amber-hot">
              INERTIA IS THE VERB.
            </h2>
            <p className="mt-5 max-w-xl text-[12.5px] leading-[1.9] text-amber/72 sm:text-[13.5px]">
              Everything in Helios Drift is a decision about momentum — lining up a shot, dodging a
              magenta bolt, drifting through a field of credit shards before it scatters. Boost
              exists to erase momentum, not to go fast. The upgrade rack exists so that by wave six
              your ship handles like a different machine than the one you started with.
            </p>
          </div>
        </div>

        {/* engraved spec plate */}
        <dl className="mt-14 grid grid-cols-2 gap-px border border-steel/35 bg-steel/25 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.k} className="bg-void/80 px-5 py-7 transition-colors hover:bg-void/50">
              <dt className="legend text-amber/55">{s.k}</dt>
              <dd className="mt-2 font-display text-[clamp(2.1rem,5vw,3.1rem)] leading-none text-amber">
                {s.v}
              </dd>
              <dd className="mt-3 text-[11px] leading-relaxed text-amber/50">{s.n}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div
        className="relative h-[5px] w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,176,58,0.85) 0px, rgba(255,176,58,0.85) 14px, rgba(7,9,17,0) 14px, rgba(7,9,17,0) 30px)",
        }}
      />
    </section>
  );
}

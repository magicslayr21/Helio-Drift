/**
 * Hand-drawn vector identity for HELIOS DRIFT.
 * Everything here is real <svg> path data so the mark scales,
 * recolours and reverses to a single colour without any raster art.
 */
export function HeliosMark({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Helios Drift vector mark"
    >
      {/* outer shield / asteroid facet */}
      <path
        d="M32 2.5 L57.5 17.25 L57.5 46.75 L32 61.5 L6.5 46.75 L6.5 17.25 Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
        opacity="0.55"
      />
      {/* inner facet lines — give the mark its engineered, engraved feel */}
      <path d="M32 2.5 L32 12 M57.5 46.75 L48.5 41.7 M6.5 46.75 L15.5 41.7" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />

      {/* orbital ring */}
      <ellipse
        cx="32"
        cy="33"
        rx="23"
        ry="9.5"
        transform="rotate(-28 32 33)"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.5"
      />

      {/* the ship */}
      <path
        d="M32 13.5 L45.2 47.5 L32 40.2 L18.8 47.5 Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M32 22 L32 39" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />

      {/* engine trail */}
      <path d="M27.5 43.5 L24.5 54 M32 45 L32 57 M36.5 43.5 L39.5 54" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />

      {/* two drifting rocks */}
      <path d="M12 20 l4.6 -2.2 3 3.4 -1.6 4 -4.4 0.6 -2.6 -3.2 z" fill="currentColor" opacity="0.7" />
      <path d="M52 42 l4 -2 2.6 3 -1.4 3.6 -4 0.5 -2.2 -2.8 z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

export default function Masthead() {
  return (
    <header className="relative w-full border-b border-steel/25">
      {/* hazard stripe rule */}
      <div
        className="h-[5px] w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,176,58,0.85) 0px, rgba(255,176,58,0.85) 14px, rgba(7,9,17,0) 14px, rgba(7,9,17,0) 30px)",
        }}
      />

      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-5 sm:px-10">
        <a href="#top" className="group flex items-center gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber">
          <HeliosMark size={52} className="text-amber transition-transform duration-500 group-hover:rotate-[24deg]" />
          <span>
            <span className="block font-display text-[clamp(1.15rem,3vw,1.75rem)] leading-none tracking-[-0.02em] text-amber-hot">
              HELIOS DRIFT
            </span>
            <span className="legend mt-1.5 block text-amber/55">Vector Arcade System · Model HD-79</span>
          </span>
        </a>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a href="#spec" className="legend text-amber/55 transition-colors hover:text-amber">
            Build Spec
          </a>
          <a href="#spec" className="legend text-amber/55 transition-colors hover:text-amber">
            Control Map
          </a>
          <span className="hidden items-center gap-2 border border-steel/40 px-3 py-1.5 md:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-magenta" />
            <span className="legend text-amber/60">Cabinet Online</span>
          </span>
        </nav>
      </div>
    </header>
  );
}

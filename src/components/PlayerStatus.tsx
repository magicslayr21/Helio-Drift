import { Heart, Rocket } from "lucide-react";
import { MAX_WEAPON_LEVEL, WEAPON_DEFS } from "../game/balance";
import type { Hud, WeaponId } from "../game/types";

// Silhouettes follow each weapon's firing pattern so colour is not the only cue.
const WEAPON_ICONS: Record<WeaponId, { color: string; path: string }> = {
  pulse: { color: "#ffe0a3", path: "M11 29V15h10v14M12 11V3m8 8V3M16 20v5" },
  spread: {
    color: "#ffad66",
    path: "M12 29 14 20h4l2 9M16 15V3M10 16 5 5m17 11 5-11M6 20l-4-5m24 5 4-5",
  },
  seeker: { color: "#ff8fb0", path: "M12 23V12l4-8 4 8v11ZM12 18l-5 7h5m8-7 5 7h-5M14 27v3m4-3v3" },
  ricochet: { color: "#6fe7ff", path: "m3 26 12-9-6-7L26 4m-7-1 7 1-1 7M3 30h8" },
  flak: {
    color: "#ff7759",
    path: "M12 29V19h8v10M16 13V3M10 14 4 8m18 6 6-6M7 20H2m23 0h5M12 7l-1-3m9 3 1-3",
  },
  arc: { color: "#c59aff", path: "M18 2 7 18h8l-1 12 11-17h-8ZM3 10l3 2m20 10 3 2" },
  laser: { color: "#ff4d8d", path: "M11 30V21h10v9M16 18V1M11 16V4m10 12V4M8 21h16" },
  rail: { color: "#b4f4ce", path: "M8 29V8m16 21V8M12 29V15m8 14V15M16 25V2m-4 5 4-5 4 5" },
};

function Bar({
  label,
  value,
  max,
  color,
  large = false,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  large?: boolean;
}) {
  const amount = Math.max(0, Math.min(max, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={amount}
      className={`${large ? "h-4 sm:h-5" : "h-2"} w-full bg-black/35 ring-1 ring-white/15`}
    >
      <div
        className="h-full transition-[width] duration-200"
        style={{
          width: `${max > 0 ? (amount / max) * 100 : 0}%`,
          background: color,
          boxShadow: `0 0 10px ${color}66`,
        }}
      />
    </div>
  );
}

export function PlayerStatus({ hud }: { hud: Hud }) {
  const weapon = WEAPON_DEFS[hud.primary];
  const icon = WEAPON_ICONS[hud.primary];
  return (
    <div
      aria-label="Player status"
      className="pointer-events-none absolute right-3 top-3 w-64 max-w-[calc(100%-1.5rem)] space-y-3 text-amber-hot drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)] sm:right-5 sm:top-5 sm:w-80"
    >
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
            <Heart className="h-5 w-5 text-amber" aria-hidden="true" />
            Health
          </span>
          <span className="font-display text-xl leading-none sm:text-2xl">
            {hud.hull}
            <span className="text-sm text-amber/75"> / {hud.maxHull}</span>
          </span>
        </div>
        <Bar label="Health" value={hud.hull} max={hud.maxHull} color="#ffb03a" large />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider">Level {hud.level}</span>
          <span className="text-ice">{Math.floor((hud.xp / hud.xpNext) * 100)}% XP</span>
        </div>
        <Bar label="Experience" value={hud.xp} max={hud.xpNext} color="#6fe7ff" />
      </div>
      <div
        className="flex items-center gap-2"
        aria-label={`Equipped ${weapon.name}, weapon level ${hud.weaponLevel}`}
        style={{ color: icon.color }}
      >
        <svg
          data-weapon={hud.primary}
          viewBox="0 0 32 32"
          className="h-9 w-9 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={icon.path} />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="truncate">{weapon.short}</span>
            <span className="shrink-0">LV {hud.weaponLevel}</span>
          </p>
          <div
            className="flex h-2 gap-1"
            role="meter"
            aria-label="Weapon level"
            aria-valuemin={0}
            aria-valuemax={MAX_WEAPON_LEVEL}
            aria-valuenow={hud.weaponLevel}
          >
            {Array.from({ length: MAX_WEAPON_LEVEL }, (_, i) => (
              <span
                key={i}
                className="flex-1 ring-1 ring-white/15"
                style={{ background: i < hud.weaponLevel ? icon.color : "rgba(0,0,0,.35)" }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-magenta">
        <Rocket className="h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider">Missiles</span>
            <span>
              {hud.missiles}/{hud.maxMissiles}
            </span>
          </div>
          <div
            className="flex h-2 gap-1"
            role="meter"
            aria-label="Missiles"
            aria-valuemin={0}
            aria-valuemax={hud.maxMissiles}
            aria-valuenow={hud.missiles}
          >
            {Array.from({ length: Math.max(1, hud.maxMissiles) }, (_, i) => (
              <span key={i} className="flex-1 bg-black/35 ring-1 ring-white/15">
                <span
                  className="block h-full bg-magenta transition-[width] duration-150"
                  style={{
                    width:
                      i < hud.missiles
                        ? "100%"
                        : i === hud.missiles
                          ? `${Math.max(0, Math.min(1, hud.missileCharge)) * 100}%`
                          : "0%",
                    opacity: i < hud.missiles ? 1 : 0.55,
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

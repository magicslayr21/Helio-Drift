import { Heart, Rocket } from "lucide-react";
import { weaponMaxLevel, WEAPON_DEFS } from "../game/balance";
import type { Hud } from "../game/types";
import { WeaponIcon, WEAPON_ICONS } from "./ShopIcons";

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
        <WeaponIcon id={hud.primary} />
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
            aria-valuemax={weaponMaxLevel(hud.primary)}
            aria-valuenow={hud.weaponLevel}
          >
            {Array.from({ length: weaponMaxLevel(hud.primary) }, (_, i) => (
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

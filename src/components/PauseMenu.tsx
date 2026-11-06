import type { ReactNode } from "react";
import type { Hud, WeaponId } from "../game/types";
import { WEAPON_DEFS, weaponMaxLevel } from "../game/balance";
import { LevelPips } from "./LevelPips";

export function PauseMenu({
  hud,
  onSelectWeapon,
  onResume,
  onShop,
  onSettings,
  onDeveloper,
  onReturn,
  onLeaderboard,
  devUnlocked,
  devOpen,
  returnLabel = "Save & return to menu",
  leaderboardLabel = "Global Leaderboard",
  footer = "P or Esc to resume · Save & return keeps your run",
  arsenalLabel = "Arsenal · Tab / Q to cycle · 1 / 2 quick slots",
  subtitle,
  extra,
}: {
  hud: Pick<Hud, "wave" | "level" | "owned" | "primary" | "boosts" | "credits">;
  onSelectWeapon: (id: WeaponId) => void;
  onResume: () => void;
  onShop: () => void;
  onSettings: () => void;
  onDeveloper: () => void;
  onReturn: () => void;
  onLeaderboard: () => void;
  devUnlocked: boolean;
  devOpen: boolean;
  returnLabel?: string;
  leaderboardLabel?: string;
  footer?: string;
  arsenalLabel?: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="w-[min(520px,90%)] border border-steel/50 plate p-6 sm:p-7">
      <div className="flex items-end justify-between">
        <div>
          <p className="legend">System State</p>
          <h2
            id="flight-pause-title"
            className="mt-1 font-display text-[clamp(1.8rem,5vw,2.6rem)] leading-none text-amber-hot"
          >
            PAUSED
          </h2>
        </div>
        <p className="legend text-right text-amber/50">
          Wave {String(hud.wave).padStart(2, "0")} · Lvl {String(hud.level).padStart(2, "0")}
        </p>
      </div>

      {subtitle && <p className="legend mt-3 text-amber/55">{subtitle}</p>}
      <div className="mt-5 border-y border-steel/30 py-3">
        <p className="legend mb-2">{arsenalLabel}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {hud.owned.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelectWeapon(o.id)}
              className={`flex items-center justify-between gap-2 border px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                o.id === hud.primary
                  ? "border-amber bg-amber/10"
                  : "border-steel/40 hover:border-amber/60"
              }`}
            >
              <span className="text-[10px] uppercase tracking-[0.16em] text-amber-hot">
                {WEAPON_DEFS[o.id].short}
              </span>
              <LevelPips level={o.level} max={weaponMaxLevel(o.id)} color="#ffb03a" />
            </button>
          ))}
        </div>
      </div>

      {/* boost ledger: every stat card taken, and what they add up to */}
      <div className="mt-4 border border-steel/35 bg-black/25 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="legend">Boosts Unlocked</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-amber/55">
            {hud.boosts.totalStacks} stack{hud.boosts.totalStacks === 1 ? "" : "s"} ·{" "}
            {hud.boosts.taken.length} type{hud.boosts.taken.length === 1 ? "" : "s"}
          </p>
        </div>
        {hud.boosts.taken.length === 0 ? (
          <p className="mt-2 text-[10px] leading-relaxed text-amber/35">
            No stat upgrades yet — level up to draw your first rack.
          </p>
        ) : (
          <>
            <div className="thin-scroll mt-2 flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto">
              {hud.boosts.taken.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 border border-steel/40 bg-graphite/60 px-2 py-1"
                >
                  <span className="text-[9px] uppercase tracking-[0.1em] text-amber-hot">
                    {b.name}
                  </span>
                  <span className="text-[9px] text-amber/50">
                    ×{b.level}/{b.max}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-2.5 border-t border-steel/25 pt-2">
              <p className="legend mb-1.5 text-amber/50">Combined effect</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {hud.boosts.totals.map((t) => (
                  <div
                    key={t.label}
                    className="flex items-baseline justify-between gap-2 border-b border-steel/20 pb-0.5 text-[10px]"
                  >
                    <dt className="truncate uppercase tracking-[0.1em] text-amber/42">{t.label}</dt>
                    <dd className="shrink-0 text-amber-hot">{t.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={onResume}
          autoFocus
          className="col-span-2 border-2 border-amber bg-amber px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
        >
          Resume
        </button>
        <button
          onClick={onShop}
          className="col-span-2 border border-ice/60 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-ice transition-colors hover:bg-ice/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ice"
        >
          Weapon Shop · {hud.credits} CR
        </button>
        <button
          onClick={onSettings}
          className="border border-steel/60 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
        >
          Settings
        </button>
        <button
          onClick={onDeveloper}
          className={`border px-4 py-3 text-[11px] uppercase tracking-[0.24em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
            devUnlocked
              ? "border-magenta/60 text-magenta hover:bg-magenta/10"
              : "border-steel/60 text-amber/80 hover:border-amber hover:bg-amber/10"
          }`}
        >
          {devUnlocked ? (devOpen ? "Hide Console" : "Dev Console") : "Service Code"}
        </button>
        <button
          onClick={onReturn}
          className="w-full border border-ice/50 py-3 text-[10px] uppercase tracking-[0.2em] text-ice hover:bg-ice/10"
        >
          {returnLabel}
        </button>
        <button
          onClick={onLeaderboard}
          className="w-full border border-ice/50 py-3 text-[10px] uppercase tracking-[0.2em] text-ice hover:bg-ice/10"
        >
          {leaderboardLabel}
        </button>
      </div>
      {extra}
      <p className="legend mt-4 text-center text-amber/40">{footer}</p>
    </div>
  );
}

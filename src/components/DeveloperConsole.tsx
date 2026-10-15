import { useState, type ReactNode } from "react";
import { DevWindow } from "./DevWindow";
import {
  SALVAGE_UPGRADE_ORDER,
  SALVAGE_UPGRADES,
  STAT_UPGRADES,
  WEAPON_ORDER,
  WEAPON_DEFS,
} from "../game/balance";
import type { Game } from "../game/engine";
import type { DeveloperCommand, DeveloperEnemy } from "../game/developer-command";

export type DeveloperView = Pick<
  Game,
  "p" | "stacks" | "salvageDrone" | "boss" | "shower" | "god" | "score" | "credits"
>;
export function DeveloperConsole({
  view,
  send,
  onClose,
  onRestart,
}: {
  view: DeveloperView;
  send: (command: DeveloperCommand) => void;
  onClose: () => void;
  onRestart?: () => void;
  multiplayer?: boolean;
}) {
  const [page, setPage] = useState<1 | 2>(1);
  const [count, setCount] = useState(1);
  const [size, setSize] = useState<1 | 2 | 3>(2);
  const btn = (label: string, command: DeveloperCommand, active = false) => (
    <DevBtn key={label} label={label} active={active} onClick={() => send(command)} />
  );
  return (
    <DevWindow>
      <div className="flex items-center justify-between border-b border-steel/30 pb-2">
        <p className="legend text-magenta">Dev Console · P{page} · Press ` to Toggle</p>
        <div className="flex items-center gap-1">
          <DevBtn
            label={page === 1 ? "P2 →" : "← P1"}
            ariaLabel="Switch developer console page"
            onClick={() => setPage(page === 1 ? 2 : 1)}
          />
          <DevBtn label="X" ariaLabel="Close developer console" onClick={onClose} />
        </div>
      </div>
      {page === 1 ? (
        <div className="mt-2.5 space-y-2.5">
          <DevRow label="Score">
            {[-1000, 1000, 10000].map((amount) =>
              btn(amount === -1000 ? "-1k" : amount === 1000 ? "+1k" : "+10k", {
                action: "adjust",
                field: "score",
                amount,
              }),
            )}
          </DevRow>
          <DevRow label="Credits">
            {[-100, 100, 1000].map((amount) =>
              btn(amount === -100 ? "-100" : amount === 100 ? "+100" : "+1k", {
                action: "adjust",
                field: "credits",
                amount,
              }),
            )}
          </DevRow>
          <DevRow label="Health">
            {btn("-25", { action: "adjust", field: "hull", amount: -25 })}
            {btn("+25", { action: "adjust", field: "hull", amount: 25 })}
            {btn("Max", { action: "heal" })}
          </DevRow>
          <DevRow label="Kill All">
            {btn("Clear Field", { action: "clear" })}
            {btn("Boss", { action: "killBoss" }, !!view.boss)}
          </DevRow>
          <DevRow label="Wave">
            {btn("Next", { action: "nextWave" })}
            {btn("+5", { action: "advance", waves: 5 })}
          </DevRow>
          <DevRow label="Boss">
            {[1, 2, 3, 4, 5, 6].map((mk) =>
              btn(`MK${mk}`, { action: "boss", mk }, !!view.boss?.suffix.startsWith(`MK${mk}`)),
            )}
          </DevRow>
          <DevRow label="Spawn count">
            <input
              aria-label="Spawn count"
              type="number"
              min={1}
              max={50}
              step={1}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))
              }
              className="w-16 border border-steel bg-void px-2 py-1 text-amber"
            />
            <span className="text-[10px] text-muted">1–50 · boom cap: 6</span>
          </DevRow>
          <DevRow label="Spawn size">
            {([1, 2, 3] as const).map((s) => (
              <DevBtn
                key={s}
                label={s === 1 ? "Small" : s === 2 ? "Medium" : "Large"}
                active={s === size}
                onClick={() => setSize(s)}
              />
            ))}
          </DevRow>
          <DevRow label="Mob">
            {(
              [
                ["none", "Norm"],
                ["homing", "Homer"],
                ["bounce", "Bounce"],
                ["boom", "Boom"],
                ["fast", "Fast"],
              ] as const
            ).map(([kind, label]) => btn(label, { action: "rock", kind, count, size }))}
            {(
              [
                ["sentinel", "Sentinel"],
                ["warden", "Warden"],
                ["spiker", "Spiker"],
                ["tetherSentinel", "Tether Sentinel"],
                ["mineWarden", "Mine Warden"],
                ["riftSpiker", "Rift Spiker"],
              ] as [DeveloperEnemy, string][]
            ).map(([kind, label]) => btn(label, { action: "enemy", kind, count, size }))}
          </DevRow>
          <DevRow label="Shower">
            {btn(
              view.shower.active ? "Running" : "Start",
              { action: "shower", mode: "start" },
              view.shower.active,
            )}
            {btn("Long", { action: "shower", mode: "long" })}
            {btn("Stop", { action: "shower", mode: "stop" })}
          </DevRow>
          <DevRow label="Meteorite">
            {[1, 6, 15].map((n) =>
              btn(`×${n}`, { action: "rock", kind: "meteorite", count: n, size }),
            )}
            {btn("Meteor", { action: "rock", kind: "meteor", count: 1, size })}
          </DevRow>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          <DevRow label="Max All">
            {btn("God Build", { action: "maxAll" })}
            {btn("Max weapons", { action: "weapons" })}
          </DevRow>
          <div className="space-y-1 border-t border-steel/25 pt-2">
            <div className="flex items-center justify-between gap-1">
              <span className="legend text-amber/50">Stat Upgrades</span>
              <span className="flex gap-1">
                {btn("+1 All", { action: "stacks", mode: "add" })}
                {btn("Max", { action: "stacks", mode: "max" })}
                {btn("Zero", { action: "stacks", mode: "zero" })}
              </span>
            </div>
            {STAT_UPGRADES.map((u) => {
              const level = view.stacks[u.id] ?? 0;
              return (
                <div key={u.id} className="flex items-center gap-1">
                  <span
                    title={`${u.desc} (max ${u.max})`}
                    className="min-w-0 flex-1 truncate text-[9px] uppercase tracking-[0.06em] text-amber/65"
                  >
                    {u.name}
                  </span>
                  <span
                    className={`w-9 shrink-0 text-right text-[9px] ${level > 0 ? "text-amber-hot" : "text-amber/30"}`}
                  >
                    {level}/{u.max}
                  </span>
                  <DevBtn
                    label="−"
                    onClick={() =>
                      send({ action: "stack", id: u.id, level: Math.max(0, level - 1) })
                    }
                  />
                  <DevBtn
                    label="+"
                    disabled={level >= u.max}
                    onClick={() => send({ action: "stack", id: u.id, level: level + 1 })}
                  />
                  {btn("M", { action: "stack", id: u.id, level: u.max }, level >= u.max)}
                </div>
              );
            })}
          </div>
          <DevRow label="Level">
            {[1, 5].map((n) => btn(`+${n}`, { action: "level", count: n }))}
          </DevRow>
          <DevRow label="Weapon">
            {WEAPON_ORDER.map((id) =>
              btn(
                WEAPON_DEFS[id].short.slice(0, 4),
                { action: "weapon", id },
                view.p.primary === id,
              ),
            )}
          </DevRow>
          <DevRow label="Wpn Lvl">
            {btn("+1", { action: "weaponLevel", mode: "add" })}
            {btn("Max", { action: "weaponLevel", mode: "max" })}
            {btn("All", { action: "weaponLevel", mode: "all" })}
          </DevRow>
          <DevRow label="Drone">
            {btn("Buy", { action: "drone" })}
            {[1, 2, 3].map((n) => btn(`${n}x`, { action: "droneCount", count: n }))}
            {btn("HP 1", { action: "droneHp", hp: 1 })}
            {btn("HP Max", { action: "droneHp", hp: 9999 })}
          </DevRow>
          <DevRow label="D Lv">
            {SALVAGE_UPGRADE_ORDER.map((id) => (
              <DevBtn
                key={id}
                label={`${SALVAGE_UPGRADES[id].name} ${view.salvageDrone.upgrades[id]}/${SALVAGE_UPGRADES[id].max}`}
                disabled={view.salvageDrone.upgrades[id] >= SALVAGE_UPGRADES[id].max}
                onClick={() =>
                  send({ action: "droneUpgrade", id, level: view.salvageDrone.upgrades[id] + 1 })
                }
              />
            ))}
          </DevRow>
          <DevRow label="D Build">
            {btn("Max", { action: "droneBuild", mode: "max" })}
            {btn("Reset", { action: "droneBuild", mode: "reset" })}
            {btn("Die", { action: "droneBuild", mode: "kill" })}
          </DevRow>
          <DevRow label="D Wpn">
            {btn("Base", { action: "droneWeapon", id: null }, view.salvageDrone.weapon == null)}
            {WEAPON_ORDER.map((id) =>
              btn(
                WEAPON_DEFS[id].short.slice(0, 3),
                { action: "droneWeapon", id },
                view.salvageDrone.weapon === id,
              ),
            )}
          </DevRow>
          <DevRow label="Misc">
            {btn("Missiles", { action: "missiles" })}
            {btn("God", { action: "god" }, view.god)}
            {onRestart && <DevBtn label="Restart" onClick={onRestart} />}
          </DevRow>
        </div>
      )}
    </DevWindow>
  );
}
function DevRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-1.5">
      <span className="legend mt-1 w-[54px] shrink-0 text-amber/45">{label}</span>
      <div className="flex flex-wrap justify-end gap-1">{children}</div>
    </div>
  );
}
function DevBtn({
  label,
  onClick,
  active,
  disabled,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const tone = disabled
    ? "cursor-not-allowed border-steel/25 text-amber/25"
    : active
      ? "border-magenta bg-magenta/25 text-magenta"
      : "border-steel/50 text-amber/70 hover:border-amber hover:text-amber-hot";
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`border px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-magenta ${tone}`}
    >
      {label}
    </button>
  );
}

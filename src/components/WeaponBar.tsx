import { useEffect, useState } from "react";
import { WEAPON_DEFS, WEAPON_ORDER } from "../game/balance";
import type { WeaponId } from "../game/types";
import "./WeaponBar.css";

const KEY = "helios-weapon-slots-v1";
/** Personal quick slots: ownership and the active hardpoint still belong to the game. */
export function WeaponBar({
  owned,
  active,
  blocked,
  onSelect,
  enabled = true,
}: {
  owned: { id: WeaponId; level: number }[];
  active: WeaponId;
  blocked?: WeaponId | null;
  onSelect: (id: WeaponId) => void;
  enabled?: boolean;
}) {
  const [preferred, setPreferred] = useState<(WeaponId | null)[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (Array.isArray(saved))
        return [0, 1].map((i) => (WEAPON_ORDER.includes(saved[i]) ? saved[i] : null));
    } catch {
      /* Optional preferences. */
    }
    return [active, null];
  });
  const available = owned.filter((w) => w.level > 0 && w.id !== blocked);
  const first = available.find((w) => w.id === preferred[0])?.id ?? available[0]?.id ?? null;
  const second =
    available.find((w) => w.id === preferred[1] && w.id !== first)?.id ??
    available.find((w) => w.id !== first)?.id ??
    null;
  const slots = [first, second];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!enabled || event.repeat || !["Digit1", "Digit2"].includes(event.code)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const weapon = event.code === "Digit1" ? first : second;
      if (weapon) onSelect(weapon);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [enabled, first, second, onSelect]);
  return (
    <div className="weapon-bar" aria-label="Equipped weapons">
      {slots.map((weapon, index) => (
        <div key={index} className={weapon === active ? "is-active" : ""}>
          <button
            disabled={!enabled || !weapon}
            aria-pressed={weapon === active}
            onClick={() => weapon && onSelect(weapon)}
          >
            <small>
              {index + 1} · {index === 0 ? "Primary" : "Secondary"}
            </small>
            <strong>{weapon ? WEAPON_DEFS[weapon].short : "Empty slot"}</strong>
          </button>
          <select
            aria-label={`Choose ${index === 0 ? "primary" : "secondary"} weapon`}
            disabled={!enabled || available.length < index + 1}
            value={weapon ?? ""}
            onChange={(event) => {
              const next = [...slots];
              const selected = event.target.value as WeaponId;
              if (next[1 - index] === selected) next[1 - index] = next[index];
              next[index] = selected;
              setPreferred(next);
              try {
                localStorage.setItem(KEY, JSON.stringify(next));
              } catch {
                /* Session still works. */
              }
              onSelect(selected);
            }}
          >
            {!weapon && <option value="">Acquire another weapon</option>}
            {available.map((w) => (
              <option key={w.id} value={w.id}>
                {WEAPON_DEFS[w.id].name} · Lv {w.level}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

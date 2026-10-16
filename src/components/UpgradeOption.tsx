import type { CSSProperties } from "react";
import type { UpgradeCard } from "../game/types";
import { STAT_UPGRADES } from "../game/balance";
import "./UpgradeScreen.css";

// Original vector marks share the ship's angular, instrument-panel styling.
const MARKS: Record<string, { path: string; color: string; benefit: string }> = {
  range: {
    path: "M6 16a10 10 0 0 1 20 0M10 16a6 6 0 0 1 12 0M16 16l8-8M5 23h22M9 27h14",
    color: "#6fe7ff",
    benefit: "+13.3% RANGE",
  },
  overclock: {
    path: "M5 11h12l-4 5h14M5 21h12l-4-5M21 7l6 4-6 4M21 17l6 4-6 4",
    color: "#ffb03a",
    benefit: "+9% FIRE RATE",
  },
  hollow: {
    path: "M12 24V12l4-7 4 7v12zM9 27h14M5 14l3 2M24 16l3-2M6 7l3 3M23 10l3-3",
    color: "#ff9168",
    benefit: "+12% DAMAGE",
  },
  thruster: {
    path: "M10 19l2-12h8l2 12zM10 19h12M13 23l3 5 3-5M6 12v9M26 12v9",
    color: "#6fe7ff",
    benefit: "+9% THRUST",
  },
  hull: {
    path: "M16 4l11 6v10l-11 8L5 20V10zM16 10v12M10 16h12",
    color: "#91e7b0",
    benefit: "+18 MAX HEALTH",
  },
  armor: {
    path: "M16 4l11 5-2 12-9 7-9-7L5 9zM11 12l5 3 5-3M11 18l5 3 5-3",
    color: "#91e7b0",
    benefit: "−12% DAMAGE TAKEN",
  },
  twin: {
    path: "M6 25V12l4-7 4 7v13zM18 25V12l4-7 4 7v13zM6 20h8M18 20h8",
    color: "#c5a2ff",
    benefit: "+1 PROJECTILE",
  },
  pierce: {
    path: "M4 16h24M22 10l6 6-6 6M10 7v6M10 19v6M17 7v6M17 19v6",
    color: "#c5a2ff",
    benefit: "+1 TARGET PIERCED",
  },
  crit: {
    path: "M12 5H5v7M20 5h7v7M5 20v7h7M27 20v7h-7M16 10l2 4 4 2-4 2-2 4-2-4-4-2 4-2z",
    color: "#ff7d9b",
    benefit: "+20% CRIT CHANCE",
  },
};

export function UpgradeIcon({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d={MARKS[id]?.path ?? "M16 5l11 11-11 11L5 16zM10 16h12M16 10v12"} />
    </svg>
  );
}

export function UpgradeOption({
  card,
  index = 0,
  onChoose,
}: {
  card: UpgradeCard;
  index?: number;
  onChoose: () => void;
}) {
  const definition = STAT_UPGRADES.find((entry) => entry.id === card.id);
  const max = definition?.max ?? card.level + 1;
  const mark = MARKS[card.id];
  return (
    <button
      type="button"
      className={`upgrade-option upgrade-option--${card.rarity}`}
      style={
        {
          "--upgrade-color": mark?.color ?? "#ffb03a",
          "--upgrade-delay": `${index * 85}ms`,
        } as CSSProperties
      }
      onClick={onChoose}
      aria-label={`${card.name}. ${definition?.desc ?? card.desc} ${card.level ? `Level ${card.level + 1} of ${max}` : "New upgrade"}.`}
    >
      <span className="upgrade-option-top">
        <span>{card.tag}</span>
        <span className="upgrade-rarity">{card.rarity}</span>
      </span>
      <span className="upgrade-icon">
        <UpgradeIcon id={card.id} />
      </span>
      <span className="upgrade-benefit">{mark?.benefit ?? card.tag}</span>
      <span className="upgrade-name">{card.name}</span>
      <span className="upgrade-description">{definition?.desc ?? card.desc}</span>
      <span className="upgrade-option-foot">
        <span>{card.level === 0 ? "NEW SYSTEM" : `LEVEL ${card.level} → ${card.level + 1}`}</span>
        <span className="upgrade-pips" aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <i
              key={i}
              className={i < card.level ? "is-owned" : i === card.level ? "is-next" : ""}
            />
          ))}
        </span>
      </span>
      <span className="upgrade-install">
        INSTALL UPGRADE <span aria-hidden="true">↗</span>
      </span>
    </button>
  );
}

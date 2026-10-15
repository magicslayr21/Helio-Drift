import type { SalvageUpgradeId, WeaponId } from "../game/types";

// Reuse the flight HUD silhouettes so weapons are recognisable in every menu.
export const WEAPON_ICONS: Record<WeaponId, { color: string; path: string }> = {
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

export function WeaponIcon({
  id,
  className = "h-9 w-9 shrink-0",
}: {
  id: WeaponId;
  className?: string;
}) {
  return (
    <svg
      data-weapon={id}
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={WEAPON_ICONS[id].path} />
    </svg>
  );
}

type ShopIconId = "weapons" | "drone" | "missiles" | SalvageUpgradeId;

const SHOP_PATHS: Record<ShopIconId, string> = {
  weapons: "M7 28V13h7v15m4 0V13h7v15M10.5 13V4M21.5 13V4M4 22h24M14 7h4M14 11h4",
  drone:
    "m16 6 7 7v9l-7 5-7-5v-9ZM12 15h8v5h-8ZM9 14 3 11v10l6-2m14-5 6-3v10l-6-2M16 6V2m-3 27v2m6-4v4",
  missiles: "M11 24V12l5-9 5 9v12ZM11 17l-5 7v4l5-3m10-8 5 7v4l-5-3M14 28v3m4-3v3M13 12h6",
  twinCannons: "M5 27V14h8v13M19 27V14h8v13M9 14V5m14 9V5M3 30h12m2 0h12M16 8v10m-4-5h8",
  overcharge: "M10 3h12v4h4v22H6V7h4ZM18 9l-7 9h5l-2 7 8-11h-5Z",
  piercing: "M3 9h19l-4-4m4 4-4 4M29 23H10l4-4m-4 4 4 4M6 6v6m20 8v6M11 9h3m4 14h3",
  armor: "m16 3 11 5v10l-5 7-6 4-6-4-5-7V8Zm0 5-6 3v6l3 4 3 2 3-2 3-4v-6Z",
  repairPulse: "M11 4h10v7h7v10h-7v7H11v-7H4V11h7ZM1 16h3m24 0h3M16 1v3m0 24v3",
  shield: "m16 3 11 5v10l-5 7-6 4-6-4-5-7V8ZM11 16h10m-5-5v10M2 28l5-3m18 0 5 3",
  magnet: "M5 4h7v13l4 4 4-4V4h7v15l-6 8H11l-6-8ZM5 10h7m8 0h7M12 30h8",
  scan: "M16 16 28 4M16 6a10 10 0 1 0 10 10M16 1A15 15 0 1 0 31 16M16 12v8m-4-4h8M24 4h4v4",
  speed: "M10 23V12l6-9 6 9v11Zm0-8-5 7h5m12-7 5 7h-5M13 26v5m6-5v5M16 13v6",
};

export function ShopIcon({
  id,
  className = "h-6 w-6 shrink-0",
}: {
  id: ShopIconId;
  className?: string;
}) {
  return (
    <svg
      data-shop-icon={id}
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SHOP_PATHS[id]} />
    </svg>
  );
}

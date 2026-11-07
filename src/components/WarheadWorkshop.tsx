import type { CSSProperties } from "react";
import { WARHEAD_PARTS, WARHEAD_SLOTS } from "../game/balance";

const ROMAN = { 1: "I", 2: "II", 3: "III" } as const;
import type {
  BuildTiers,
  ForgePartInfo,
  ForgeShopInfo,
  GuidanceId,
  MissileBuild,
  WarheadTier,
  PayloadId,
  TriggerId,
  WarheadPartId,
} from "../game/types";
import "./WarheadWorkshop.css";

const RARITY_COLOR = {
  default: "#c9c2b3",
  common: "#ffb03a",
  rare: "#6fe7ff",
  epic: "#ff3d6e",
} as const;

/** Original line marks for every Workshop part (32 × 32, stroked). */
const PART_PATHS: Record<WarheadPartId, string> = {
  blast:
    "M16 3v7M16 22v7M3 16h7M22 16h7M6.8 6.8l5 5M20.2 20.2l5 5M25.2 6.8l-5 5M11.8 20.2l-5 5M13 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  cluster:
    "M13 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0M14.5 6a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M14.5 26a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5.5 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M23.5 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5.5 21a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M23.5 21a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  gravity: "M14 16a2 2 0 1 1 4 0a5 5 0 1 1-9 0a8 8 0 1 1 15 3.5a11 11 0 0 1-19.5 3",
  emp: "M18 4l-8 13h6l-2 11 8-13h-6zM6 9a12 12 0 0 0 0 14M26 9a12 12 0 0 1 0 14",
  incendiary:
    "M16 3c5 7 9 10 9 16a9 9 0 0 1-18 0c0-4 2-7 5-9 0 3 1 6 4 6-2-4-1-9 0-13zM16 28a3.5 3.5 0 0 1-3.5-3.5c0-2 2-3.5 3.5-5.5 1.5 2 3.5 3.5 3.5 5.5A3.5 3.5 0 0 1 16 28",
  direct: "M3 16h23M20 10l6 6-6 6M3 12v8M9 13v6",
  corkscrew: "M3 16c2.5-8 5.5-8 7 0s4.5 8 7 0 4.5-8 7 0M24 16h5M26 13l3 3-3 3",
  relay:
    "M4 24l11-14 13 9M2 24a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M26 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  orbit: "M6 16a10 10 0 1 0 20 0a10 10 0 1 0-20 0M16 12l3.5 7-3.5-2-3.5 2zM24.5 8l2-2.5",
  impact: "M3 16h16M14 11l5 5-5 5M24 5v22M27 9v14",
  proximity:
    "M3 16h11M10 12l4 4-4 4M18 10a8 8 0 0 1 0 12M22 7a12 12 0 0 1 0 18M26 4a16 16 0 0 1 0 24",
  chain: "M3 20l11-4-11-4 3 4zM17 14l9-2.5-9-2.5 2.5 2.5zM14 16l3-2M17 24l9-2.5-9-2.5 2.5 2.5z",
  delayed: "M7 17a9 9 0 1 0 18 0a9 9 0 1 0-18 0M16 12v5l3 3M13 4h6M16 4v4M24 8l2-2",
  solarFlare:
    "M12 16a4 4 0 1 0 8 0a4 4 0 1 0-8 0M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M24.5 7.5l-2.8 2.8M10.3 21.7l-2.8 2.8M20 12c4-3 8-2 9 1",
  cryo: "M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13M16 8l-3-3M16 8l3-3M16 24l-3 3M16 24l3 3M9 12.5l-4 0M23 19.5l4 0",
  boomerang: "M5 9c6 0 10 2 11 7s5 7 11 7M5 9l4 3.5M5 9l3.5-4M27 23l-4 1M27 23l-2-3.5",
  siphon: "M4 7h24l-9 10v8l-6 3V17zM10 11h12M16 3v2",
};

export function WarheadPartIcon({ id }: { id: WarheadPartId }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PART_PATHS[id]} />
    </svg>
  );
}

/* ------------------------------------------------------------ schematic */

/**
 * Side-on cutaway of the assembled Heliodart. The trigger shapes the nose,
 * the payload fills the warhead chamber, guidance changes the airframe, and
 * the plume burns at the tail. Each region is tinted by its fitted part.
 */
export function WarheadSchematic({ build, tiers }: { build: MissileBuild; tiers?: BuildTiers }) {
  const pay = WARHEAD_PARTS[build.payload].color;
  const gui = WARHEAD_PARTS[build.guidance].color;
  const tri = WARHEAD_PARTS[build.trigger].color;
  return (
    <svg
      className="warhead-schematic"
      viewBox="0 0 440 170"
      role="img"
      aria-label={`Assembled missile: ${WARHEAD_PARTS[build.payload].name} payload, ${WARHEAD_PARTS[build.guidance].name} guidance, ${WARHEAD_PARTS[build.trigger].name} trigger.`}
      style={{ "--pay": pay, "--gui": gui, "--tri": tri } as CSSProperties}
    >
      <defs>
        <linearGradient id="wh-plume" x1="0" x2="1">
          <stop offset="0" stopColor={pay} stopOpacity="0" />
          <stop offset="0.6" stopColor={pay} stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="wh-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2636" />
          <stop offset="0.5" stopColor="#15121f" />
          <stop offset="1" stopColor="#0c0a13" />
        </linearGradient>
        <radialGradient id="wh-chamber">
          <stop offset="0" stopColor={pay} stopOpacity="0.55" />
          <stop offset="1" stopColor={pay} stopOpacity="0.05" />
        </radialGradient>
      </defs>
      {/* blueprint grid */}
      <g className="wh-grid">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="170" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 40 + 5} x2="440" y2={i * 40 + 5} />
        ))}
      </g>
      {/* plume */}
      <path className="wh-plume" d="M118 76 Q60 85 20 85 Q60 85 118 94 Z" fill="url(#wh-plume)" />
      <path className="wh-plume-core" d="M118 81 Q90 85 66 85 Q90 85 118 89 Z" fill="#fff" />
      <Guidance id={build.guidance} color={gui} />
      {/* fuselage */}
      <path
        d="M118 72 H330 L340 85 L330 98 H118 L112 85 Z"
        fill="url(#wh-hull)"
        stroke={gui}
        strokeWidth="1.4"
      />
      {/* section seams */}
      <path d="M210 72v26M300 72v26" stroke="#ffffff22" />
      <Payload id={build.payload} color={pay} />
      <Trigger id={build.trigger} color={tri} />
      {/* callouts */}
      <Callout
        x={255}
        y={72}
        tx={255}
        ty={22}
        label="PAYLOAD"
        name={build.payload}
        color={pay}
        tier={tiers?.payload}
      />
      <Callout
        x={165}
        y={98}
        tx={165}
        ty={150}
        label="GUIDANCE"
        name={build.guidance}
        color={gui}
        tier={tiers?.guidance}
      />
      <Callout
        x={360}
        y={98}
        tx={380}
        ty={150}
        label="TRIGGER"
        name={build.trigger}
        color={tri}
        tier={tiers?.trigger}
      />
    </svg>
  );
}

function Callout(props: {
  x: number;
  y: number;
  tx: number;
  ty: number;
  label: string;
  name: WarheadPartId;
  color: string;
  tier?: WarheadTier;
}) {
  const above = props.ty < props.y;
  return (
    <g className="wh-callout">
      <path
        d={`M${props.x} ${props.y} L${props.tx} ${props.ty + (above ? 14 : -14)}`}
        stroke={props.color}
        strokeDasharray="2 3"
      />
      <circle cx={props.x} cy={props.y} r="2.2" fill={props.color} />
      <text x={props.tx} y={props.ty + (above ? 0 : 0)} textAnchor="middle" fill="#9297a5">
        {props.label}
      </text>
      <text
        x={props.tx}
        y={props.ty + 11}
        textAnchor="middle"
        fill={props.color}
        className="wh-callout-name"
      >
        {WARHEAD_PARTS[props.name].name.toUpperCase()}
        {props.tier ? ` · ${ROMAN[props.tier]}` : ""}
      </text>
    </g>
  );
}

function Payload({ id, color }: { id: PayloadId; color: string }) {
  return (
    <g className="wh-payload">
      <rect x="214" y="75" width="82" height="20" rx="3" fill="url(#wh-chamber)" />
      {id === "blast" &&
        [226, 244, 262, 280].map((x) => (
          <path key={x} d={`M${x} 78 l7 7 -7 7`} stroke={color} strokeWidth="1.6" fill="none" />
        ))}
      {id === "cluster" &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <circle
            key={i}
            className="wh-bomblet"
            cx={226 + (i % 3) * 22}
            cy={i < 3 ? 80 : 90}
            r="3.4"
            fill={color}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      {id === "gravity" && (
        <g className="wh-spin" style={{ transformOrigin: "255px 85px" }}>
          <path
            d="M255 85 m-2 0 a2 2 0 1 1 4 0 a5 5 0 1 1 -9 0 a8 8 0 1 1 15 2"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
          />
          <circle cx="255" cy="85" r="2.5" fill="#0c0a13" stroke={color} />
        </g>
      )}
      {id === "emp" && (
        <path
          className="wh-crackle"
          d="M218 85 l8 -7 6 12 7 -12 7 12 7 -12 7 12 7 -12 7 12 7 -12 6 7"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
        />
      )}
      {id === "solarFlare" && (
        <g className="wh-spin" style={{ transformOrigin: "255px 85px" }}>
          <circle cx="255" cy="85" r="5.5" fill={color} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <path
              key={i}
              d={`M${255 + Math.cos((i * Math.PI) / 4) * 8} ${85 + Math.sin((i * Math.PI) / 4) * 8} L${255 + Math.cos((i * Math.PI) / 4) * 12} ${85 + Math.sin((i * Math.PI) / 4) * 12}`}
              stroke={color}
              strokeWidth="1.5"
            />
          ))}
        </g>
      )}
      {id === "cryo" &&
        [228, 248, 268, 286].map((x, i) => (
          <path
            key={x}
            className="wh-bomblet"
            d={`M${x} ${85 - 6} l5 3 0 6 -5 3 -5 -3 0 -6z`}
            fill="none"
            stroke={color}
            strokeWidth="1.3"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      {id === "incendiary" &&
        [228, 246, 264, 282].map((x, i) => (
          <path
            key={x}
            className="wh-flame"
            d={`M${x} 93 c-4 -4 -3 -9 0 -14 c3 5 4 10 0 14z`}
            fill={color}
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
    </g>
  );
}

function Guidance({ id, color }: { id: GuidanceId; color: string }) {
  if (id === "orbit")
    return (
      <g className="wh-guidance">
        {/* annular ring-wing around the mid-body */}
        <ellipse cx="160" cy="85" rx="14" ry="30" fill="none" stroke={color} strokeWidth="2" />
        <ellipse cx="160" cy="85" rx="9" ry="24" fill="none" stroke={color} strokeOpacity="0.35" />
        <path d="M124 72 L112 56 L132 72 M124 98 L112 114 L132 98" fill={color} opacity="0.7" />
      </g>
    );
  if (id === "relay")
    return (
      <g className="wh-guidance">
        <path d="M150 72 L118 44 L170 72 M150 98 L118 126 L170 98" fill={color} opacity="0.85" />
        {/* relay mast: a forward antenna with a pulsing emitter */}
        <path d="M200 72 L214 48 M214 48 l10 -4" stroke={color} strokeWidth="1.5" fill="none" />
        <circle className="wh-ping" cx="224" cy="44" r="3" fill={color} />
      </g>
    );
  if (id === "boomerang")
    return (
      <g className="wh-guidance">
        {/* curved, crescent wings that bring it home */}
        <path
          d="M178 72 Q150 66 122 40 Q140 62 150 72 M178 98 Q150 104 122 130 Q140 108 150 98"
          fill={color}
          opacity="0.85"
        />
        <path d="M290 72 L280 62 L276 72 M290 98 L280 108 L276 98" fill={color} opacity="0.7" />
      </g>
    );
  const wide = id === "corkscrew";
  return (
    <g className="wh-guidance">
      <path
        d={
          wide
            ? "M160 72 L126 50 L140 50 L180 72 M160 98 L126 120 L140 120 L180 98"
            : "M150 72 L118 46 L172 72 M150 98 L118 124 L172 98"
        }
        fill={color}
        opacity="0.85"
      />
      {/* canards */}
      <path d="M290 72 L280 62 L276 72 M290 98 L280 108 L276 98" fill={color} opacity="0.7" />
      {wide && (
        <g className="wh-rifling">
          {[128, 146, 164, 182, 200].map((x) => (
            <path key={x} d={`M${x} 98 L${x + 12} 72`} stroke={color} strokeOpacity="0.45" />
          ))}
        </g>
      )}
    </g>
  );
}

function Trigger({ id, color }: { id: TriggerId; color: string }) {
  return (
    <g className="wh-trigger">
      {id === "impact" && <path d="M330 72 L366 85 L330 98 Z" fill={color} opacity="0.9" />}
      {id === "proximity" && (
        <>
          <path d="M330 72 Q362 72 362 85 Q362 98 330 98 Z" fill={color} opacity="0.85" />
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              className="wh-sense"
              d={`M${372 + i * 10} ${70 - i * 4} a${18 + i * 6} ${18 + i * 6} 0 0 1 0 ${30 + i * 8}`}
              stroke={color}
              fill="none"
              style={{ animationDelay: `${i * 220}ms` }}
            />
          ))}
        </>
      )}
      {id === "chain" && (
        <>
          <path d="M330 72 L364 85 L330 98 Z" fill={color} opacity="0.9" />
          {/* docked mini missile riding under the warhead */}
          <path
            d="M250 104 H300 L310 110 L300 116 H250 L246 110 Z"
            fill="#15121f"
            stroke={color}
            strokeWidth="1.2"
          />
          <path d="M262 104 L254 98 L270 104 M262 116 L254 122 L270 116" fill={color} />
          <path d="M276 98 v6 M290 98 v6" stroke={color} strokeOpacity="0.6" />
        </>
      )}
      {id === "delayed" && (
        <>
          <path d="M330 72 L360 85 L330 98 Z" fill={color} opacity="0.9" />
          {/* grapple barbs and a fuse dial */}
          <path
            d="M352 80 l14 -8 M352 90 l14 8 M358 85 h14"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="318" cy="85" r="8" fill="#0c0a13" stroke={color} />
          <path className="wh-dial" d="M318 85 V79" stroke={color} strokeWidth="1.5" />
        </>
      )}
      {id === "siphon" && (
        <>
          {/* intake funnel that drinks charge back from every blast */}
          <path d="M330 72 L356 64 L356 106 L330 98 Z" fill={color} opacity="0.75" />
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              className="wh-sense"
              d={`M${394 - i * 10} ${70 + i * 3} q-14 15 0 30`}
              stroke={color}
              fill="none"
              style={{ animationDelay: `${i * 200}ms`, animationDirection: "reverse" }}
            />
          ))}
        </>
      )}
      {/* seeker cap glow */}
      <circle cx="336" cy="85" r="4" fill="#ffffff" opacity="0.8" />
    </g>
  );
}

/* ------------------------------------------------------------ forge */

/** What a part does at a tier: Tier I, or the Tier II values (Tier III adds the perk). */
export function partEffect(id: WarheadPartId, tier: WarheadTier) {
  const def = WARHEAD_PARTS[id];
  return tier === 1 ? def.effect : def.tier2;
}

/** The Missile Bay mark: three missiles in a launch cradle. */
const BAY_PATH = "M8 20V10l2-4 2 4v10M14 20V8l2-4 2 4v12M20 20V10l2-4 2 4v10M5 20h22l-2 6H7z";
/** Rows of the Missile Bay stat table, matching missileBayLines() order. */
const BAY_STATS = [
  { label: "Damage", color: "#ff3d6e" },
  { label: "Speed", color: "#6fe7ff" },
  { label: "Amount", color: "#ff5ad8" },
  { label: "Recharge", color: "#91e7b0" },
  { label: "Lock-on", color: "#ffd166" },
];

function TierPips({ tier }: { tier: WarheadTier }) {
  return (
    <span className="forge-tier" aria-label={`Tier ${ROMAN[tier]}`}>
      {[1, 2, 3].map((t) => (
        <i key={t} className={t <= tier ? (tier === 3 ? "is-mastered" : "is-on") : ""} />
      ))}
      <b>{ROMAN[tier]}</b>
    </span>
  );
}

/** Heat toward the next tier; full bars glow, Tier III bars are gold. */
function HeatBar({ info, compact }: { info: ForgePartInfo; compact?: boolean }) {
  const { part, nextHeat, prevHeat, temperReady } = info;
  const done = nextHeat === null;
  const frac = done ? 1 : Math.min(1, Math.max(0, (part.heat - prevHeat) / (nextHeat - prevHeat)));
  return (
    <div className={`forge-mastery ${done ? "is-done" : ""} ${temperReady ? "is-ready" : ""}`}>
      {!compact && (
        <span>
          {done
            ? "MASTERED"
            : temperReady
              ? "HEAT FULL · TEMPER READY"
              : `HEAT → TIER ${ROMAN[(part.tier + 1) as WarheadTier]}`}
          <b>{done ? `${part.kills} kills` : `${Math.floor(part.heat)} / ${nextHeat}`}</b>
        </span>
      )}
      <i>
        <em style={{ width: `${frac * 100}%` }} />
      </i>
    </div>
  );
}

export interface WarheadForgeProps {
  info: ForgeShopInfo;
  credits: number;
  onBay: () => void;
  onUnlock: (id: WarheadPartId) => void;
  onTemper: (id: WarheadPartId) => void;
  onSwap: (index: number) => void;
  onScrap: (index: number) => void;
  onFitStock: (id: WarheadPartId) => void;
  /** co-op: hand a bench part to the teammate */
  onSend?: (index: number) => void;
  teammate?: string;
  disabled?: boolean;
}

/**
 * The Warhead Forge: Missile Bay upgrades for every missile, the three fitted
 * parts with Heat and tempering, the full catalogue, and a two-slot bench.
 */
export function WarheadForge({
  info,
  credits,
  onBay,
  onUnlock,
  onTemper,
  onSwap,
  onScrap,
  onFitStock,
  onSend,
  teammate,
  disabled,
}: WarheadForgeProps) {
  const build: MissileBuild = {
    payload: info.fitted.payload.part.id as PayloadId,
    guidance: info.fitted.guidance.part.id as GuidanceId,
    trigger: info.fitted.trigger.part.id as TriggerId,
  };
  const tiers: BuildTiers = {
    payload: info.fitted.payload.part.tier,
    guidance: info.fitted.guidance.part.tier,
    trigger: info.fitted.trigger.part.tier,
  };
  const partStyle = (id: WarheadPartId) =>
    ({
      "--part-color": WARHEAD_PARTS[id].color,
      "--rarity-color": RARITY_COLOR[WARHEAD_PARTS[id].rarity],
    }) as CSSProperties;
  const temperButton = (entry: ForgePartInfo) => {
    if (entry.temperPrice === null) return null;
    const next = ROMAN[(entry.part.tier + 1) as WarheadTier];
    return (
      <button
        type="button"
        className={`forge-action ${entry.temperReady ? "forge-action--mastery" : "forge-action--rush"}`}
        data-forge-temper={entry.part.id}
        disabled={disabled || credits < entry.temperPrice}
        onClick={() => onTemper(entry.part.id)}
      >
        {entry.temperReady ? `TEMPER → ${next}` : `RUSH → ${next}`} · {entry.temperPrice} CR
      </button>
    );
  };
  return (
    <div className="warhead-workshop">
      <div className="warhead-hero">
        <div className="warhead-hero-copy">
          <p className="shop-eyebrow">WARHEAD FORGE / SALVO LOCK</p>
          <h3>
            FORGE THE WARHEAD<span>.</span>
          </h3>
          <p>
            Upgrade every missile in the Missile Bay, unlock parts from the catalogue, and temper
            them as they heat up from the damage they deal. Rush a temper early for a surcharge.
          </p>
        </div>
        <WarheadSchematic build={build} tiers={tiers} />
      </div>

      <section className="warhead-slot" aria-label="Missile Bay">
        <div className="shop-section-heading">
          <p>
            <span className="warhead-slot-index">01</span> Missile Bay
          </p>
          <span>
            One upgrade for every missile. Each level also makes parts heat{" "}
            {Math.round(info.heatBonus * 100)}% faster and temper{" "}
            {Math.round(info.temperDiscount * 100)}% cheaper (now).
          </span>
        </div>
        {(() => {
          const bay = info.bay;
          const maxed = bay.price === null;
          return (
            <article
              data-bay="missile-bay"
              className={`warhead-card forge-bay-panel ${maxed ? "is-mastered" : ""}`}
              style={{ "--part-color": "#ff5ad8", "--rarity-color": "#ff5ad8" } as CSSProperties}
            >
              <div className="forge-bay-head">
                <span className="warhead-mark">
                  <svg
                    viewBox="0 0 32 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={BAY_PATH} />
                  </svg>
                </span>
                <span>
                  <strong>Missile Bay</strong>
                  <small>
                    LEVEL {bay.level} / {bay.max}
                  </small>
                </span>
                <span className="forge-bay-pips" aria-label={`Level ${bay.level} of ${bay.max}`}>
                  {Array.from({ length: bay.max }, (_, i) => (
                    <i key={i} className={i < bay.level ? "is-on" : ""} />
                  ))}
                </span>
              </div>
              <div className="forge-bay-stats">
                {BAY_STATS.map((stat, k) => {
                  const changing = bay.next && bay.next[k] !== bay.current[k];
                  return (
                    <div
                      key={stat.label}
                      className={`forge-bay-stat ${changing ? "is-changing" : ""}`}
                      style={{ "--stat-color": stat.color } as CSSProperties}
                    >
                      <span>{stat.label}</span>
                      <b>{bay.level ? bay.current[k] : "—"}</b>
                      <em>{bay.next ? `→ ${bay.next[k]}` : "MAX"}</em>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="forge-action forge-bay-buy"
                data-bay-buy="missile-bay"
                disabled={disabled || maxed || credits < (bay.price ?? Infinity)}
                onClick={onBay}
              >
                {maxed ? "MAXED" : `UPGRADE TO LEVEL ${bay.level + 1} · ${bay.price} CR`}
              </button>
            </article>
          );
        })()}
      </section>

      <section className="warhead-slot" aria-label="Fitted parts">
        <div className="shop-section-heading">
          <p>
            <span className="warhead-slot-index">02</span> Fitted
          </p>
          <span>Damage dealt by these parts' warheads heats them toward the next tier.</span>
        </div>
        <div className="forge-fitted">
          {WARHEAD_SLOTS.map((slot) => {
            const entry = info.fitted[slot];
            const { part } = entry;
            const def = WARHEAD_PARTS[part.id];
            return (
              <article
                key={slot}
                data-forge-slot={slot}
                className={`warhead-card forge-fitted-card is-fitted ${part.tier === 3 ? "is-mastered" : ""}`}
                style={partStyle(part.id)}
              >
                <span className="warhead-card-top">
                  <span className="warhead-rarity">{slot}</span>
                  <TierPips tier={part.tier} />
                </span>
                <span className="forge-fitted-head">
                  <span className="warhead-mark">
                    <WarheadPartIcon id={part.id} />
                  </span>
                  <span>
                    <strong>{def.name}</strong>
                    <small>{def.rarity}</small>
                  </span>
                </span>
                <span className="warhead-effect">{partEffect(part.id, part.tier)}</span>
                <span className={`forge-perk ${part.tier === 3 ? "is-on" : ""}`}>
                  <b>{def.perk.name}</b> {def.perk.text}
                </span>
                <HeatBar info={entry} />
                {temperButton(entry)}
              </article>
            );
          })}
        </div>
        {info.stock.length > 0 && (
          <div className="forge-stock">
            {info.stock.map((id) => (
              <button
                type="button"
                key={id}
                data-forge-stock={id}
                className="forge-chip"
                disabled={disabled}
                onClick={() => onFitStock(id)}
              >
                Refit stock {WARHEAD_PARTS[id].name} · free
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="warhead-slot" aria-label="Catalogue">
        <div className="shop-section-heading">
          <p>
            <span className="warhead-slot-index">03</span> Catalogue
          </p>
          <span>
            Every part, always on sale. Rare parts open at wave 3, epic at wave 6. Unlocking fits
            it; the old part goes to the bench.
          </span>
        </div>
        {WARHEAD_SLOTS.map((slot) => (
          <div key={slot} className="forge-catalogue-row">
            <span className="forge-catalogue-slot">{slot}</span>
            <div className="forge-catalogue">
              {info.catalogue
                .filter((entry) => WARHEAD_PARTS[entry.id].slot === slot)
                .map((entry) => {
                  const def = WARHEAD_PARTS[entry.id];
                  const can = !entry.blocked && credits >= entry.price && !disabled;
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      data-unlock={entry.id}
                      className={`warhead-card forge-offer ${entry.owned ? "is-sold" : ""} ${entry.locked ? "is-locked" : ""}`}
                      style={partStyle(entry.id)}
                      disabled={!can}
                      title={def.effect}
                      onClick={() => onUnlock(entry.id)}
                    >
                      {entry.veteran && !entry.owned && (
                        <span className="forge-ribbon">VETERAN −50%</span>
                      )}
                      <span className="warhead-card-top">
                        <span className="warhead-rarity">{def.rarity}</span>
                      </span>
                      <span className="forge-fitted-head">
                        <span className="warhead-mark">
                          <WarheadPartIcon id={entry.id} />
                        </span>
                        <strong>{def.name}</strong>
                      </span>
                      <span className="warhead-effect">{def.effect}</span>
                      <span className="warhead-fit">
                        {entry.owned
                          ? "OWNED"
                          : entry.blocked
                            ? entry.blocked
                            : `UNLOCK · ${entry.price} CR`}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </section>

      <section className="warhead-slot" aria-label="Bench">
        <div className="shop-section-heading">
          <p>
            <span className="warhead-slot-index">04</span> Bench
          </p>
          <span>
            Benched parts keep their tier and warm at half the fitted rate. Swaps are free.
          </span>
        </div>
        <div className="forge-bench">
          {info.bench.map((entry, index) =>
            entry ? (
              <article
                key={index}
                data-bench={index}
                className={`warhead-card forge-bench-card ${entry.part.tier === 3 ? "is-mastered" : ""}`}
                style={partStyle(entry.part.id)}
              >
                <span className="warhead-card-top">
                  <span className="warhead-rarity">{WARHEAD_PARTS[entry.part.id].slot}</span>
                  <TierPips tier={entry.part.tier} />
                </span>
                <span className="forge-fitted-head">
                  <span className="warhead-mark">
                    <WarheadPartIcon id={entry.part.id} />
                  </span>
                  <span>
                    <strong>{WARHEAD_PARTS[entry.part.id].name}</strong>
                    <small>{entry.part.kills} kills</small>
                  </span>
                </span>
                <HeatBar info={entry} />
                <span className="forge-bench-actions">
                  <button
                    type="button"
                    className="forge-action"
                    data-bench-swap={index}
                    disabled={disabled}
                    onClick={() => onSwap(index)}
                  >
                    Swap in
                  </button>
                  {temperButton(entry)}
                  <button
                    type="button"
                    className="forge-action forge-action--scrap"
                    data-bench-scrap={index}
                    disabled={disabled}
                    onClick={() => onScrap(index)}
                  >
                    Scrap +{entry.scrap}
                  </button>
                  {onSend && (
                    <button
                      type="button"
                      className="forge-action"
                      data-bench-send={index}
                      disabled={disabled}
                      onClick={() => onSend(index)}
                    >
                      Send to {teammate ?? "teammate"}
                    </button>
                  )}
                </span>
              </article>
            ) : (
              <div key={index} className="forge-bench-empty">
                EMPTY BENCH SLOT
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

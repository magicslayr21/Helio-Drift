import type { CSSProperties } from "react";
import { WARHEAD_PARTS, WARHEAD_SLOTS } from "../game/balance";
import type {
  GuidanceId,
  MissileBuild,
  PayloadId,
  TriggerId,
  WarheadPartId,
  WarheadSlot,
} from "../game/types";
import "./WarheadWorkshop.css";

const RARITY_COLOR = {
  default: "#c9c2b3",
  common: "#ffb03a",
  rare: "#6fe7ff",
  epic: "#ff3d6e",
} as const;

const SLOT_COPY: Record<WarheadSlot, { index: string; title: string; note: string }> = {
  payload: { index: "01", title: "Payload", note: "What the warhead does when it goes off." },
  guidance: { index: "02", title: "Guidance", note: "How it flies to the lock." },
  trigger: { index: "03", title: "Trigger", note: "When it decides to detonate." },
};

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
export function WarheadSchematic({ build }: { build: MissileBuild }) {
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
      <Callout x={255} y={72} tx={255} ty={22} label="PAYLOAD" name={build.payload} color={pay} />
      <Callout
        x={165}
        y={98}
        tx={165}
        ty={150}
        label="GUIDANCE"
        name={build.guidance}
        color={gui}
      />
      <Callout x={360} y={98} tx={380} ty={150} label="TRIGGER" name={build.trigger} color={tri} />
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
      {/* seeker cap glow */}
      <circle cx="336" cy="85" r="4" fill="#ffffff" opacity="0.8" />
    </g>
  );
}

/* ------------------------------------------------------------ workshop */

export function WarheadWorkshop({
  build,
  onFit,
  disabled,
}: {
  build: MissileBuild;
  onFit: (id: WarheadPartId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="warhead-workshop">
      <div className="warhead-hero">
        <div className="warhead-hero-copy">
          <p className="shop-eyebrow">WARHEAD WORKSHOP / SALVO LOCK</p>
          <h3>
            BUILD THE WARHEAD<span>.</span>
          </h3>
          <p>
            Every missile in your rack launches with this build. Fit one part in each slot; refits
            are free and never touch missiles already in flight.
          </p>
        </div>
        <WarheadSchematic build={build} />
      </div>
      {WARHEAD_SLOTS.map((slot) => {
        const parts = (Object.keys(WARHEAD_PARTS) as WarheadPartId[]).filter(
          (id) => WARHEAD_PARTS[id].slot === slot,
        );
        const copy = SLOT_COPY[slot];
        return (
          <section key={slot} className="warhead-slot" aria-label={`${copy.title} parts`}>
            <div className="shop-section-heading">
              <p>
                <span className="warhead-slot-index">{copy.index}</span> {copy.title}
              </p>
              <span>{copy.note}</span>
            </div>
            <div className="warhead-grid">
              {parts.map((id) => {
                const part = WARHEAD_PARTS[id];
                const fitted = build[slot] === id;
                return (
                  <button
                    type="button"
                    key={id}
                    data-warhead-part={id}
                    aria-pressed={fitted}
                    disabled={disabled}
                    className={`warhead-card ${fitted ? "is-fitted" : ""}`}
                    style={
                      {
                        "--part-color": part.color,
                        "--rarity-color": RARITY_COLOR[part.rarity],
                      } as CSSProperties
                    }
                    onClick={() => {
                      if (!fitted) onFit(id);
                    }}
                  >
                    <span className="warhead-card-top">
                      <span className="warhead-rarity">{part.rarity}</span>
                      <small>{fitted ? "FITTED" : "TIER I"}</small>
                    </span>
                    <span className="warhead-mark">
                      <WarheadPartIcon id={id} />
                    </span>
                    <strong>{part.name}</strong>
                    <span className="warhead-effect">{part.effect}</span>
                    <span className="warhead-fit">
                      {fitted ? "✓ IN THE RACK" : "FIT PART · FREE"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

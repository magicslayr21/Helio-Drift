import type { Drone } from "./types";
import { TAU } from "./math";
import { COOP_CONFIG } from "./simulation/coop-config";

type Point = readonly [number, number];

const HULL = "#090d18";
const HULL_LIGHT = "#141b2e";
const DANGER = "#ff3d6e";

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly Point[], s: number) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
  ctx.closePath();
}

function mirrored(half: readonly Point[]): Point[] {
  // `half` runs nose → tail along the top edge; mirror it back along the bottom.
  const bottom = half
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => [x, -y] as Point);
  return [...half, ...bottom];
}

/**
 * Tether Sentinel: a slim forked emitter. Two forward prongs cradle a pulsing
 * tether node, a rotating segmented halo marks its shield projector, and swept
 * stabiliser fins keep it reading as a fast escort.
 */
function drawTetherSentinel(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  frame: number,
) {
  const s = r / 24;
  const pulse = 0.5 + Math.sin(frame * 0.11) * 0.5;

  // Segmented shield halo spins independently of the hull heading.
  ctx.save();
  ctx.rotate(frame * 0.03);
  ctx.globalAlpha = 0.35 + pulse * 0.25;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.18, a + 0.12, a + TAU / 6 - 0.32);
    ctx.stroke();
  }
  ctx.restore();

  // Swept stabiliser fins behind the core.
  ctx.fillStyle = HULL;
  for (const side of [-1, 1]) {
    tracePolygon(
      ctx,
      [
        [-2, side * 8],
        [-12, side * 21],
        [-22, side * 22],
        [-15, side * 9],
      ],
      s,
    );
    ctx.fill();
    ctx.stroke();
  }

  // Forked emitter prongs.
  for (const side of [-1, 1]) {
    tracePolygon(
      ctx,
      [
        [-4, side * 5],
        [10, side * 11],
        [26, side * 9],
        [27, side * 5],
        [12, side * 4],
      ],
      s,
    );
    ctx.fill();
    ctx.stroke();
  }

  // Central diamond spine.
  ctx.fillStyle = HULL_LIGHT;
  tracePolygon(
    ctx,
    [
      [14, 0],
      [0, -8],
      [-18, 0],
      [0, 8],
    ],
    s,
  );
  ctx.fill();
  ctx.stroke();

  // Danger ribs keep the shared enemy armor language.
  ctx.strokeStyle = DANGER;
  ctx.lineWidth = 1.5;
  for (const x of [-11, -6]) {
    ctx.beginPath();
    ctx.moveTo(x * s, -(x + 18) * 0.44 * s);
    ctx.lineTo(x * s, (x + 18) * 0.44 * s);
    ctx.stroke();
  }

  // Tether arc crackling between the prong tips.
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45 + pulse * 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(26 * s, -7 * s);
  for (let i = 1; i < 5; i++) {
    const y = -7 + i * 2.8;
    const jitter = Math.sin(frame * 0.6 + i * 2.1) * 2.2;
    ctx.lineTo((25 + jitter) * s, y * s);
  }
  ctx.lineTo(26 * s, 7 * s);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Glowing core and forward node.
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10 + pulse * 8;
  ctx.beginPath();
  ctx.arc(1 * s, 0, 3.2 * s, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(20 * s, 0, (1.8 + pulse * 1.2) * s, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/**
 * Mine Warden: a heavy armored layer. A wide plated hull with a rear rotary
 * mine drum whose loaded pods light up as the next deployment approaches.
 */
function drawMineWarden(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  frame: number,
  readiness: number,
) {
  const s = r / 32;

  // Outer armored hull: blunt prow, shoulder plates, wide rear bay.
  const hull = mirrored([
    [28, 0],
    [22, -9],
    [12, -13],
    [8, -22],
    [-6, -24],
    [-14, -18],
    [-26, -18],
    [-30, -10],
    [-30, 0],
  ]);
  ctx.fillStyle = HULL;
  tracePolygon(ctx, hull, s);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inner armor plate seam.
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  tracePolygon(
    ctx,
    mirrored([
      [22, 0],
      [16, -7],
      [6, -10],
      [2, -17],
      [-6, -18],
      [-10, -13],
      [-10, 0],
    ]),
    s,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Hazard chevrons on the prow.
  ctx.strokeStyle = DANGER;
  ctx.lineWidth = 2;
  for (const x of [8, 14]) {
    ctx.beginPath();
    ctx.moveTo(x * s, -6 * s);
    ctx.lineTo((x + 5) * s, 0);
    ctx.lineTo(x * s, 6 * s);
    ctx.stroke();
  }

  // Shoulder thruster nozzles.
  ctx.strokeStyle = color;
  ctx.fillStyle = HULL_LIGHT;
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(-4 * s, side > 0 ? 17 * s : -21 * s, 8 * s, 4 * s);
    ctx.fill();
    ctx.stroke();
  }

  // Rotary mine drum in the rear bay.
  const drumX = -18 * s,
    drumR = 10 * s;
  ctx.fillStyle = HULL_LIGHT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(drumX, 0, drumR, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const pods = 5;
  const lit = Math.round(readiness * pods);
  const spin = frame * 0.025;
  for (let i = 0; i < pods; i++) {
    const a = spin + (i * TAU) / pods;
    const px = drumX + Math.cos(a) * drumR * 0.6,
      py = Math.sin(a) * drumR * 0.6;
    ctx.beginPath();
    ctx.arc(px, py, 2.4 * s, 0, TAU);
    if (i < lit) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.stroke();
    }
  }

  // Bay hatch glow brightens just before a mine drops.
  const hatch = readiness > 0.85 ? 0.5 + Math.sin(frame * 0.4) * 0.5 : readiness * 0.4;
  ctx.globalAlpha = 0.25 + hatch * 0.75;
  ctx.fillStyle = color;
  ctx.fillRect(-31 * s, -6 * s, 3 * s, 12 * s);
  ctx.globalAlpha = 1;

  // Forward sensor eye.
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(21 * s, 0, 3.5 * s, 2 * s, 0, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/**
 * Rift Spiker: a hovering singularity. A void core wrapped in counter-rotating
 * accretion arcs, ringed by detached crystal shards that flare outward and
 * glow while the gravity pulse charges.
 */
function drawRiftSpiker(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  frame: number,
  spikes: 4 | 8,
  warning: number,
) {
  const charge = Math.min(1, Math.max(0, warning));
  const throb = charge > 0 ? 0.5 + Math.sin(frame * 0.5) * 0.5 : 0;

  // Faint gravity well.
  const well = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6);
  well.addColorStop(0, `rgba(182,140,255,${0.18 + charge * 0.22})`);
  well.addColorStop(1, "rgba(182,140,255,0)");
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.6, 0, TAU);
  ctx.fill();

  // Detached crystal shards, one per fired spike, pointing outward.
  const reach = r * (0.72 + charge * 0.22);
  for (let i = 0; i < spikes; i++) {
    const a = (i * TAU) / spikes;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(reach, 0);
    const len = r * (spikes === 8 ? 0.5 : 0.62) * (1 + charge * 0.35);
    const wide = r * (spikes === 8 ? 0.12 : 0.16);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(len * 0.18, -wide);
    ctx.lineTo(0, 0);
    ctx.lineTo(len * 0.18, wide);
    ctx.closePath();
    ctx.fillStyle = HULL;
    ctx.fill();
    ctx.stroke();
    // facet line
    ctx.globalAlpha = 0.5 + charge * 0.5;
    ctx.beginPath();
    ctx.moveTo(len * 0.18, 0);
    ctx.lineTo(len * 0.85, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Armored collar the shards hang from.
  ctx.fillStyle = HULL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i * TAU) / (spikes * 2) + TAU / (spikes * 4);
    const radius = r * (i % 2 ? 0.58 : 0.68);
    const x = Math.cos(a) * radius,
      y = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Counter-rotating accretion arcs.
  ctx.save();
  ctx.rotate(-frame * 0.05);
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.46, a, a + TAU / 3 - 0.6);
    ctx.stroke();
  }
  ctx.rotate(frame * 0.12);
  ctx.strokeStyle = DANGER;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, a, a + Math.PI - 0.9);
    ctx.stroke();
  }
  ctx.restore();

  // Void core with a bright event-horizon rim.
  ctx.fillStyle = "#020308";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.24, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + charge * 16 + throb * 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6 + throb * 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * (0.06 + charge * 0.08), 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Matter streaking inward while the pulse charges.
  if (charge > 0) {
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4 + charge * 0.4;
    for (let i = 0; i < 10; i++) {
      const a = i * 2.39996 + frame * 0.02;
      const t = (frame * 0.035 + i * 0.37) % 1;
      const outer = r * (2.2 - t * 1.6);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.lineTo(Math.cos(a + 0.12) * (outer - r * 0.3), Math.sin(a + 0.12) * (outer - r * 0.3));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/** Co-op specialists keep the cabinet's vector armor but have distinct silhouettes. */
export function renderSpecialist(
  ctx: CanvasRenderingContext2D,
  d: Drone,
  frame: number,
  spikes: 4 | 8 = 4,
) {
  if (!d.coop) return false;
  const kind = d.coop.kind,
    r = d.r;
  const color =
    d.flash > 0
      ? "#ffffff"
      : kind === "tetherSentinel"
        ? "#6fe7ff"
        : kind === "mineWarden"
          ? "#ffb03a"
          : "#b68cff";
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(kind === "riftSpiker" ? frame * 0.012 : d.angle);
  ctx.strokeStyle = color;
  ctx.fillStyle = HULL;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  if (kind === "tetherSentinel") {
    drawTetherSentinel(ctx, r, color, frame);
  } else if (kind === "mineWarden") {
    const c = COOP_CONFIG.mineWarden;
    const readiness = Math.min(1, Math.max(0, 1 - d.coop.timer / c.deploymentMax));
    drawMineWarden(ctx, r, color, frame, readiness);
  } else {
    const warning = d.coop.warning / COOP_CONFIG.riftSpiker.telegraphSeconds;
    drawRiftSpiker(ctx, r, color, frame, spikes, warning);
  }
  ctx.restore();
  if (kind === "riftSpiker" && d.coop.warning > 0) {
    ctx.save();
    ctx.strokeStyle = "#b68cff";
    ctx.fillStyle = "#b68cff0c";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(d.x, d.y, COOP_CONFIG.riftSpiker.pulseRadius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  const bar = r * 2;
  ctx.fillStyle = "#070911";
  ctx.fillRect(d.x - bar / 2, d.y - r * 1.65 - 8, bar, 4);
  ctx.fillStyle = color;
  ctx.fillRect(d.x - bar / 2, d.y - r * 1.65 - 8, bar * Math.max(0, d.hp / d.maxHp), 4);
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    kind === "tetherSentinel"
      ? "TETHER / SHIELD"
      : kind === "mineWarden"
        ? "MINE WARDEN"
        : "RIFT SPIKER",
    d.x,
    d.y + r * 1.7 + 10,
  );
  ctx.restore();
  return true;
}

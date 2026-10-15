import type { Drone } from "./types";
import { TAU } from "./math";
import { COOP_CONFIG } from "./simulation/coop-config";

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
  ctx.fillStyle = "#090d18";
  ctx.lineWidth = 2;
  if (kind === "tetherSentinel" || kind === "mineWarden") {
    // Preserve the original swept Sentinel and horned Warden armor profiles.
    const warden = kind === "mineWarden";
    const s = r / 21;
    const points = warden
      ? [
          [30, 0],
          [10, -8],
          [14, -19],
          [-4, -16],
          [-14, -20],
          [-20, -9],
          [-13, 0],
          [-20, 9],
          [-14, 20],
          [-4, 16],
          [14, 19],
          [10, 8],
        ]
      : [
          [22, 0],
          [6, -13],
          [-16, -11],
          [-10, 0],
          [-16, 11],
          [6, 13],
        ];
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ff3d6e";
    for (const rib of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(-10 * s, rib * 7 * s);
      ctx.lineTo(8 * s, rib * 4.5 * s);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(6 * s, 0, warden ? 6 * s : 3 * s, 3 * s, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      if (warden) {
        // Paired mine drums sit inside the familiar mandibles.
        ctx.arc(-3 * s, side * 11 * s, 4 * s, 0, TAU);
      } else {
        // Twin shield emitters extend the swept wings without replacing the hull.
        ctx.moveTo(-12 * s, side * 13 * s);
        ctx.lineTo(0, side * 18 * s);
        ctx.lineTo(8 * s, side * 14 * s);
      }
      ctx.stroke();
    }
  } else {
    const warning = d.coop.warning / COOP_CONFIG.riftSpiker.telegraphSeconds;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * TAU) / (spikes * 2),
        radius = i % 2 ? r * 0.56 : r * (1.2 + warning * 0.3);
      const x = Math.cos(a) * radius,
        y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-frame * 0.035);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-3, -r * 0.26, 6, r * 0.52);
    ctx.fillRect(-r * 0.26, -3, r * 0.52, 6);
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

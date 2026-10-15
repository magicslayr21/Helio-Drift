import type { Drone } from "./types";
import { TAU } from "./math";
import { COOP_CONFIG } from "./simulation/coop-config";

/** Co-op specialists keep the cabinet's vector armor but have distinct silhouettes. */
export function renderSpecialist(ctx: CanvasRenderingContext2D, d: Drone, frame: number) {
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
  if (kind === "tetherSentinel") {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      const x = Math.cos(a) * r * 0.8,
        y = Math.sin(a) * r * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 4;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(r * 0.55, -r * 0.27);
      ctx.lineTo(r * 1.3, -r * 0.18);
      ctx.lineTo(r * 1.5, 0);
      ctx.lineTo(r * 1.3, r * 0.18);
      ctx.lineTo(r * 0.55, r * 0.27);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.35, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-3, -3, 6, 6);
    ctx.setLineDash([5, 9]);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, frame * 0.02, frame * 0.02 + TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (kind === "mineWarden") {
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * TAU) / 3);
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.42);
      ctx.lineTo(r * 1.3, -r * 0.34);
      ctx.lineTo(r * 1.5, 0);
      ctx.lineTo(r * 1.3, r * 0.34);
      ctx.lineTo(r * 0.2, r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.95, 0, r * 0.18, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "#ff3d6e";
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.moveTo(r * 0.53 + j * 4, -r * 0.24);
        ctx.lineTo(r * 0.4 + j * 4, 0);
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.restore();
    }
    ctx.fillStyle = "#171321";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4);
  } else {
    const warning = d.coop.warning / COOP_CONFIG.riftSpiker.telegraphSeconds;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i * TAU) / 24,
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

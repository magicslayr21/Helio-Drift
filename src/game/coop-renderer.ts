import { Game } from "./engine";
import { coopCamera } from "./coop-camera";
import { COOP_CONFIG } from "./simulation/coop-config";
import { THEMES } from "./balance";
import type { CoopWireState } from "./network/wire-state";
import type { CoopPlayerId } from "./simulation/coop-types";
import type { Player, Bullet } from "./types";

/** A presentation-only instance of the same renderer used by the campaign. */
export class CoopRenderer extends Game {
  private room: CoopWireState | null = null;
  private localId: CoopPlayerId = "p1";
  private lastWorldFrame = -1;
  private lastWorldAt = 0;
  private camera = { x: 0, y: 0, scale: 1 };

  constructor(canvas: HTMLCanvasElement) {
    super(
      canvas,
      { onHud() {}, onMode() {} },
      { headless: true, width: COOP_CONFIG.arena.width, height: COOP_CONFIG.arena.height },
    );
    this.makeStars();
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    try {
      this.settings.shake =
        JSON.parse(localStorage.getItem("helios-settings-v1") ?? "{}").shake ?? true;
    } catch {
      /* optional preference */
    }
    this.mode = "playing";
  }

  draw(state: CoopWireState, localId: CoopPlayerId, predicted: Player | null) {
    if (!state.campaign) return;
    this.room = state;
    this.localId = localId;
    // This is a presentation instance: no collision sets or persistence clone needed.
    this.w = state.campaign.w ?? 1000;
    this.h = state.campaign.h ?? 700;
    Object.assign(this, state.campaign);
    this.bullets = state.campaign.bullets as unknown as Bullet[];
    this.theme = THEMES[this.themeIdx];
    if (this.frame !== this.lastWorldFrame) {
      this.lastWorldFrame = this.frame;
      this.lastWorldAt = performance.now();
    }
    this.decayShake((performance.now() - this.lastWorldAt) / 1000);
    // Prediction is only position/heading. Health, weapons and beam state remain authoritative.
    if (predicted && !state.players[localId].disabled) {
      const ship = state.players[localId].ship;
      Object.assign(ship, {
        x: predicted.x,
        y: predicted.y,
        angle: predicted.angle,
        thrusting: predicted.thrusting,
      });
    }
    this.bindView(localId);
    this.render();
    this.renderTeammateIndicator();
  }

  worldPoint(x: number, y: number) {
    return { x: this.camera.x + x / this.camera.scale, y: this.camera.y + y / this.camera.scale };
  }

  resizeDisplay() {
    const shell = this.canvas.parentElement;
    if (!shell || !shell.clientWidth || !shell.clientHeight) return;
    const width = shell.clientWidth,
      height = shell.clientHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const density = window.devicePixelRatio || 1;
    const pixels = Math.round(width * density),
      rows = Math.round(height * density);
    if (this.canvas.width !== pixels || this.canvas.height !== rows) {
      this.canvas.width = pixels;
      this.canvas.height = rows;
    }
  }

  override prepareFrame(ctx: CanvasRenderingContext2D) {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.camera = coopCamera(width, height, this.w, this.h, this.p);
    const scale = this.camera.scale;
    const density = this.canvas.width / width;
    this.dpr = scale * density;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      this.dpr,
      0,
      0,
      this.dpr,
      -this.camera.x * this.dpr,
      -this.camera.y * this.dpr,
    );
  }

  private renderTeammateIndicator() {
    if (!this.room) return;
    const teammate = this.room.players[this.localId === "p1" ? "p2" : "p1"];
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    const x = (teammate.ship.x - this.camera.x) * this.camera.scale,
      y = (teammate.ship.y - this.camera.y) * this.camera.scale;
    if (x >= 12 && x <= width - 12 && y >= 12 && y <= height - 12) return;
    const px = Math.max(30, Math.min(width - 30, x)),
      py = Math.max(30, Math.min(height - 30, y));
    const ctx = this.ctx,
      density = this.canvas.width / width;
    ctx.save();
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(y - py, x - px));
    ctx.fillStyle = teammate.disabled ? "#ff3d6e" : "#6fe7ff";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-Math.atan2(y - py, x - px));
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(teammate.callsign + (teammate.disabled ? " / REVIVE" : ""), 0, 18);
    ctx.restore();
  }

  private bindView(id: CoopPlayerId) {
    const pilot = this.room!.players[id];
    this.p = pilot.ship;
    this.salvageDrone = pilot.drone;
    this.salvageClones = pilot.campaign?.salvageClones ?? [];
    this.god = pilot.campaign?.god ?? false;
    this.beamAngle = pilot.campaign?.beamAngle ?? pilot.ship.angle;
    this.credits = pilot.credits;
  }

  override forEachPilot(action: () => void) {
    if (!this.room) return;
    for (const id of ["p1", "p2"] as const) {
      this.bindView(id);
      action();
    }
    this.bindView(this.localId);
  }

  override renderPilot(ctx: CanvasRenderingContext2D) {
    super.renderPilot(ctx);
    const pilot = Object.values(this.room!.players).find((p) => p.ship === this.p)!;
    ctx.save();
    ctx.strokeStyle = pilot.disabled ? "#ff3d6e" : pilot.id === "p1" ? "#ffb03a" : "#6fe7ff";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      pilot.callsign + (pilot.disabled ? " · HOLD F TO REVIVE" : ""),
      this.p.x,
      this.p.y - 32,
    );
    if (pilot.disabled) {
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(this.p.x, this.p.y, 28, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(this.p.x, this.p.y, 24, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  }
}

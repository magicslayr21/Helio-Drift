import { Game } from "./engine";
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

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, { onHud() {}, onMode() {} }, { headless: true, width: 1000, height: 700 });
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
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "#6fe7ff";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    for (const tether of state.tethers) {
      const source = this.drones.find((d) => d.id === tether.sourceId),
        target = state.players[tether.targetPlayerId].ship;
      if (!source) continue;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  resizeDisplay() {
    const shell = this.canvas.parentElement;
    if (!shell) return;
    const width = Math.min(shell.clientWidth, (shell.clientHeight * this.w) / this.h);
    if (!width) return;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${(width * this.h) / this.w}px`;
    this.dpr = (width / this.w) * Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.round(this.w * this.dpr);
    if (this.canvas.width !== pixels) {
      this.canvas.width = pixels;
      this.canvas.height = Math.round(this.h * this.dpr);
    }
  }

  private bindView(id: CoopPlayerId) {
    const pilot = this.room!.players[id];
    this.p = pilot.ship;
    this.salvageDrone = pilot.drone;
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

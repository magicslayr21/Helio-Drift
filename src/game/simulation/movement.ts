import { GAME_CONFIG } from "../game-config";
import { clamp, wrapAngle } from "../math";
import type { Player } from "../types";

export interface FlightIntent {
  /** Absolute world-space aim; omitted for classic turn controls. */
  aimAngle?: number;
  /** Multiplier applied to the ship's turn speed when following aimAngle. */
  aimTurnMultiplier?: number;
  /** Classic steering direction in the range -1..1. */
  turn?: number;
  /** Forward thrust strength in the range 0..1. */
  forward?: number;
  /** World-space movement used by hybrid mouse/WASD controls. */
  moveX?: number;
  moveY?: number;
  /** Touch steering retains the campaign's slightly stronger thrust. */
  thrustMultiplier?: number;
}

export interface ArenaBounds {
  width: number;
  height: number;
  wrapMargin?: number;
}

/**
 * Pure player movement shared by the canvas client and future authoritative host.
 * Input gathering, audio, particles and rendering deliberately stay outside.
 */
export function stepPlayerMovement(
  player: Player,
  intent: FlightIntent,
  dt: number,
  bounds: ArenaBounds,
) {
  const step = Math.max(0, dt);
  player.thrusting = false;

  if (intent.aimAngle !== undefined) {
    const rate = player.turn * (intent.aimTurnMultiplier ?? 1);
    player.angle += clamp(wrapAngle(intent.aimAngle - player.angle), -rate * step, rate * step);
  } else {
    player.angle += clamp(intent.turn ?? 0, -1, 1) * player.turn * step;
  }

  const moveX = intent.moveX ?? 0;
  const moveY = intent.moveY ?? 0;
  if (moveX !== 0 || moveY !== 0) {
    const length = Math.hypot(moveX, moveY) || 1;
    player.vx += (moveX / length) * player.thrust * step;
    player.vy += (moveY / length) * player.thrust * step;
    player.thrusting = true;
  } else if ((intent.forward ?? 0) > 0) {
    const thrust = clamp(intent.forward ?? 0, 0, 1) * (intent.thrustMultiplier ?? 1);
    player.vx += Math.cos(player.angle) * player.thrust * thrust * step;
    player.vy += Math.sin(player.angle) * player.thrust * thrust * step;
    player.thrusting = true;
  }

  const drag = Math.pow(GAME_CONFIG.player.movementDragPerFrame, step * 60);
  player.vx *= drag;
  player.vy *= drag;
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > player.maxSpeed) {
    player.vx = (player.vx / speed) * player.maxSpeed;
    player.vy = (player.vy / speed) * player.maxSpeed;
  }
  player.x += player.vx * step;
  player.y += player.vy * step;

  const margin = bounds.wrapMargin ?? 44;
  if (player.x < -margin) player.x += bounds.width + margin * 2;
  if (player.x > bounds.width + margin) player.x -= bounds.width + margin * 2;
  if (player.y < -margin) player.y += bounds.height + margin * 2;
  if (player.y > bounds.height + margin) player.y -= bounds.height + margin * 2;
}

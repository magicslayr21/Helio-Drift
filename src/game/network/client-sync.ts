import { clamp, wrapAngle } from "../math";
import { COOP_FIXED_DT } from "../simulation/coop-config";
import type { CoopPlayerId } from "../simulation/coop-types";
import { stepPlayerMovement } from "../simulation/movement";
import type { Player } from "../types";
import type { AuthoritativeSnapshot, ClientInputMessage } from "./protocol";
import type { CoopWireState } from "./wire-state";

export interface ClientFlightSample {
  moveX: number;
  moveY: number;
  aimAngle: number;
  fire?: boolean;
  missile?: boolean;
  interact?: boolean;
}

interface PendingInput {
  message: ClientInputMessage;
  dt: number;
}

const replayInput = (
  ship: Player,
  message: ClientInputMessage,
  dt: number,
  width: number,
  height: number,
  timeScale = 1,
) => {
  for (let step = 0; step < 2; step++) {
    timeScale += (1 - timeScale) * Math.min(1, (dt / 2) * 7);
    stepPlayerMovement(
      ship,
      {
        moveX: message.moveX,
        moveY: message.moveY,
        aimAngle: message.aimAngle,
        aimTurnMultiplier: 3.2,
      },
      (dt / 2) * timeScale,
      { width, height },
    );
  }
};

/** Client-only movement prediction. Combat always remains authoritative. */
export class ClientPrediction {
  readonly playerId: CoopPlayerId;
  private readonly width: number;
  private readonly height: number;
  private sequence = 0;
  private pending: PendingInput[] = [];
  private predictedShip: Player | null = null;
  private timeScale = 1;
  private disabled = false;

  constructor(playerId: CoopPlayerId, width: number, height: number) {
    this.playerId = playerId;
    this.width = width;
    this.height = height;
  }

  get ship(): Player | null {
    return this.predictedShip ? structuredClone(this.predictedShip) : null;
  }

  get pendingCount() {
    return this.pending.length;
  }

  sample(input: ClientFlightSample, dt = COOP_FIXED_DT): ClientInputMessage {
    const message: ClientInputMessage = {
      type: "input",
      sequence: ++this.sequence,
      moveX: clamp(Number.isFinite(input.moveX) ? input.moveX : 0, -1, 1),
      moveY: clamp(Number.isFinite(input.moveY) ? input.moveY : 0, -1, 1),
      aimAngle: wrapAngle(Number.isFinite(input.aimAngle) ? input.aimAngle : 0),
      fire: Boolean(input.fire),
      missile: Boolean(input.missile),
      interact: Boolean(input.interact),
    };
    const safeDt = clamp(Number.isFinite(dt) ? dt : COOP_FIXED_DT, 0, 0.1);
    this.pending.push({ message, dt: safeDt });
    if (this.predictedShip && !this.disabled)
      replayInput(this.predictedShip, message, safeDt, this.width, this.height, this.timeScale);
    return message;
  }

  reconcile(snapshot: AuthoritativeSnapshot) {
    const authoritative = snapshot.state.players[this.playerId].ship;
    this.predictedShip = structuredClone(authoritative);
    this.timeScale = snapshot.state.campaign?.timeScale ?? 1;
    this.disabled = snapshot.state.players[this.playerId].disabled;
    const acknowledgement = snapshot.acknowledgements[this.playerId];
    this.sequence = Math.max(this.sequence, acknowledgement);
    this.pending = this.pending.filter((entry) => entry.message.sequence > acknowledgement);
    for (const entry of this.pending) {
      if (!this.disabled)
        replayInput(
          this.predictedShip,
          entry.message,
          entry.dt,
          this.width,
          this.height,
          this.timeScale,
        );
    }
    return this.ship;
  }
}

const interpolateAngle = (from: number, to: number, alpha: number) =>
  from + wrapAngle(to - from) * alpha;

function interpolatePositions(from: CoopWireState, to: CoopWireState, alpha: number) {
  const state = structuredClone(from);
  for (const id of ["p1", "p2"] as const) {
    const left = from.players[id].ship;
    const right = to.players[id].ship;
    state.players[id].ship.x = left.x + (right.x - left.x) * alpha;
    state.players[id].ship.y = left.y + (right.y - left.y) * alpha;
    state.players[id].ship.angle = interpolateAngle(left.angle, right.angle, alpha);
  }
  for (const key of [
    "rocks",
    "enemies",
    "projectiles",
    "hostileProjectiles",
    "hazards",
    "mines",
    "pickups",
  ] as const) {
    const rightById = new Map(to[key].map((entity) => [entity.id, entity]));
    for (const entity of state[key]) {
      const right = rightById.get(entity.id);
      if (!right) continue;
      entity.x += (right.x - entity.x) * alpha;
      entity.y += (right.y - entity.y) * alpha;
    }
  }
  if (state.boss && to.boss && state.boss.id === to.boss.id) {
    state.boss.x += (to.boss.x - state.boss.x) * alpha;
    state.boss.y += (to.boss.y - state.boss.y) * alpha;
  }
  state.tick = Math.round(from.tick + (to.tick - from.tick) * alpha);
  if (state.campaign && to.campaign) {
    for (const key of ["rocks", "drones", "bullets", "pickups"] as const) {
      const targets = new Map(to.campaign[key].map((entity) => [entity.id, entity]));
      for (const entity of state.campaign[key]) {
        const target = targets.get(entity.id);
        if (!target) continue;
        entity.x += (target.x - entity.x) * alpha;
        entity.y += (target.y - entity.y) * alpha;
        if ("rot" in entity && "rot" in target)
          entity.rot = interpolateAngle(entity.rot, target.rot, alpha);
        if ("angle" in entity && "angle" in target)
          entity.angle = interpolateAngle(entity.angle, target.angle, alpha);
      }
    }
    const boss = state.campaign.boss,
      target = to.campaign.boss;
    if (boss && target && boss.id === target.id) {
      boss.x += (target.x - boss.x) * alpha;
      boss.y += (target.y - boss.y) * alpha;
      boss.rot = interpolateAngle(boss.rot, target.rot, alpha);
    }
    const world = state.campaign;
    const dt = ((to.campaign.frame - world.frame) / 60) * alpha * world.timeScale;
    world.frame += (to.campaign.frame - world.frame) * alpha;
    for (const p of world.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    for (const text of world.texts) {
      text.y += text.vy * dt;
      text.life -= dt;
    }
    for (const ring of world.rings) {
      ring.r += (ring.max - ring.r) * Math.min(1, dt * 8);
      ring.life -= dt;
    }
    for (const arc of world.arcs) arc.life -= dt;
    world.particles = world.particles.filter((p) => p.life > 0);
    world.texts = world.texts.filter((p) => p.life > 0);
    world.rings = world.rings.filter((p) => p.life > 0);
    world.arcs = world.arcs.filter((p) => p.life > 0);
    for (const id of ["p1", "p2"] as const) {
      const drone = state.players[id].drone,
        target = to.players[id].drone;
      drone.x += (target.x - drone.x) * alpha;
      drone.y += (target.y - drone.y) * alpha;
      drone.angle = interpolateAngle(drone.angle, target.angle, alpha);
    }
  }
  return state;
}

/** Small ordered snapshot buffer used by the future renderer at serverTick - interpolationDelay. */
export class SnapshotInterpolator {
  private snapshots: AuthoritativeSnapshot[] = [];

  constructor(private readonly capacity = 30) {}

  get size() {
    return this.snapshots.length;
  }

  push(snapshot: AuthoritativeSnapshot) {
    const existing = this.snapshots.findIndex((entry) => entry.serverTick === snapshot.serverTick);
    if (existing >= 0) this.snapshots.splice(existing, 1);
    this.snapshots.push(structuredClone(snapshot));
    this.snapshots.sort((left, right) => left.serverTick - right.serverTick);
    if (this.snapshots.length > this.capacity) {
      this.snapshots.splice(0, this.snapshots.length - this.capacity);
    }
  }

  sample(renderTick: number): CoopWireState | null {
    if (this.snapshots.length === 0) return null;
    const rightIndex = this.snapshots.findIndex((snapshot) => snapshot.serverTick >= renderTick);
    if (rightIndex <= 0) {
      const snapshot = rightIndex === 0 ? this.snapshots[0] : this.snapshots.at(-1)!;
      return structuredClone(snapshot.state);
    }
    const left = this.snapshots[rightIndex - 1];
    const right = this.snapshots[rightIndex];
    const span = Math.max(1, right.serverTick - left.serverTick);
    const alpha = clamp((renderTick - left.serverTick) / span, 0, 1);
    return interpolatePositions(left.state, right.state, alpha);
  }
}

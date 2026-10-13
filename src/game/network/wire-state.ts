import type { CoopMatchState } from "../simulation/coop-types";

/** Public room DTO. Deterministic RNG and persistence internals never cross the socket. */
export type CoopWireState = Omit<
  CoopMatchState,
  "seed" | "randomState" | "clockAccumulator" | "nextEntityId"
>;

export function createWireState(state: CoopMatchState): CoopWireState {
  const fullCampaign = Boolean(state.campaign);
  const wire = {
    version: state.version,
    tick: state.tick,
    phase: state.phase,
    players: structuredClone(state.players),
    team: structuredClone(state.team),
    rocks: fullCampaign ? [] : structuredClone(state.rocks),
    enemies: fullCampaign ? [] : structuredClone(state.enemies),
    projectiles: fullCampaign ? [] : structuredClone(state.projectiles),
    hostileProjectiles: fullCampaign ? [] : structuredClone(state.hostileProjectiles),
    hazards: fullCampaign ? [] : structuredClone(state.hazards),
    tethers: structuredClone(state.tethers),
    mines: fullCampaign ? [] : structuredClone(state.mines),
    pickups: fullCampaign ? [] : structuredClone(state.pickups),
    boss: structuredClone(state.boss),
    campaign: structuredClone(state.campaign),
  };
  // Clients render native entities; do not duplicate them in the retired DTO arrays.
  // Millipixel precision is ample for presentation; room checkpoints retain full precision.
  if (wire.campaign) {
    wire.campaign.nextId = 0;
    wire.campaign.bullets.forEach((b) => {
      b.hitIds = [];
      // Collision history and damage metadata are server-only. Omitted optional
      // fields are not read by the campaign renderer.
      delete b.damageCause;
      delete b.weapon;
      delete b.ownerId;
    });
    wire.campaign.particles = wire.campaign.particles.slice(0, 100);
  }
  roundPresentation(wire);
  return wire;
}

function roundPresentation(value: object) {
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    const item = object[key];
    if (typeof item === "number") object[key] = Math.round(item * 1000) / 1000;
    else if (item && typeof item === "object") roundPresentation(item);
  }
}

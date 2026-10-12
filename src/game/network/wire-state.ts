import type { CoopMatchState } from "../simulation/coop-types";

/** Public room DTO. Deterministic RNG and persistence internals never cross the socket. */
export type CoopWireState = Omit<
  CoopMatchState,
  "seed" | "randomState" | "clockAccumulator" | "nextEntityId"
>;

export function createWireState(state: CoopMatchState): CoopWireState {
  return {
    version: state.version,
    tick: state.tick,
    phase: state.phase,
    players: structuredClone(state.players),
    team: structuredClone(state.team),
    rocks: structuredClone(state.rocks),
    enemies: structuredClone(state.enemies),
    projectiles: structuredClone(state.projectiles),
    hostileProjectiles: structuredClone(state.hostileProjectiles),
    hazards: structuredClone(state.hazards),
    pickups: structuredClone(state.pickups),
    boss: structuredClone(state.boss),
  };
}

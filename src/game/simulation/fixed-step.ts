import { COOP_CONFIG, COOP_FIXED_DT } from "./coop-config";

export interface FixedStepSnapshot {
  tick: number;
  accumulator: number;
}

/** Deterministic accumulator shared by local tests and the future room host. */
export class FixedStepRunner {
  tick = 0;
  private accumulator = 0;

  advance(elapsedSeconds: number, step: (dt: number, tick: number) => void) {
    const elapsed = Math.max(0, Math.min(COOP_CONFIG.maximumCatchUpSeconds, elapsedSeconds));
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator + Number.EPSILON >= COOP_FIXED_DT) {
      this.accumulator -= COOP_FIXED_DT;
      this.tick++;
      step(COOP_FIXED_DT, this.tick);
      steps++;
    }
    return steps;
  }

  snapshot(): FixedStepSnapshot {
    return { tick: this.tick, accumulator: this.accumulator };
  }

  restore(snapshot: FixedStepSnapshot) {
    if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) throw new Error("Invalid tick");
    if (
      !Number.isFinite(snapshot.accumulator) ||
      snapshot.accumulator < 0 ||
      snapshot.accumulator >= COOP_FIXED_DT
    )
      throw new Error("Invalid fixed-step accumulator");
    this.tick = snapshot.tick;
    this.accumulator = snapshot.accumulator;
  }
}

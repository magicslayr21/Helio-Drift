/** Platform-neutral random source for browser and authoritative Worker simulations. */
export interface RandomSource {
  next(): number;
}

/** Uses the host's cryptographically unimportant game randomness. */
export const systemRandom: RandomSource = {
  next: () => Math.random(),
};

/**
 * Small deterministic PRNG suitable for replayable game simulation.
 * The seed is normalized to an unsigned 32-bit value; zero is valid.
 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  snapshot() {
    return this.state;
  }

  restore(state: number) {
    this.state = state >>> 0;
  }
}

export const randomBetween = (random: RandomSource, minimum: number, maximum: number) =>
  minimum + random.next() * (maximum - minimum);

export const randomInteger = (random: RandomSource, minimum: number, maximum: number) =>
  Math.floor(randomBetween(random, minimum, maximum + 1));

export const randomChance = (random: RandomSource, probability: number) =>
  random.next() < Math.max(0, Math.min(1, probability));

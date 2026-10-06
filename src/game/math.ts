/* Small math helpers shared across the game. */

export const TAU = Math.PI * 2;
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a: number) => ((a + Math.PI * 3) % TAU) - Math.PI;

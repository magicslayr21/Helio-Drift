import { GAME_CONFIG } from "../game-config";

/** Shared 25-wave campaign schedule used by every simulation host. */
export const RUN_PACING = {
  finalWave: GAME_CONFIG.waves.wavesPerBoss * 5,
  sectorLength: GAME_CONFIG.waves.wavesPerBoss,
  legacyScale: GAME_CONFIG.asteroids.scaledWaveMultiplier,
  meteorShowersAfterWave: GAME_CONFIG.waves.showerAfterWave,
  sentinelBurstsFromWave: 8,
  lateWardenFromWave: 21,
  lateWardenToWave: 24,
  traitWaves: {
    homing: GAME_CONFIG.asteroids.traits.homing.unlockWave,
    bounce: GAME_CONFIG.asteroids.traits.bounce.unlockWave,
    boom: GAME_CONFIG.asteroids.traits.boom.unlockWave,
    fast: GAME_CONFIG.asteroids.traits.fast.unlockWave,
  },
  creditsPerWaveBase: GAME_CONFIG.waves.waveCreditsBase,
  creditsPerWaveStep: GAME_CONFIG.waves.waveCreditsPerWave,
} as const;

export function maxSentinels(wave: number) {
  const thresholds = GAME_CONFIG.enemies.sentinels.countWaveThresholds;
  const caps = GAME_CONFIG.enemies.sentinels.waveCaps;
  const index = thresholds.filter((threshold) => wave > threshold).length;
  return caps[index] ?? caps[caps.length - 1];
}

export function sentinelWaveCount(wave: number) {
  const thresholds = GAME_CONFIG.enemies.sentinels.countWaveThresholds;
  const counts = GAME_CONFIG.enemies.sentinels.countPerBand;
  const index = thresholds.filter((threshold) => wave > threshold).length;
  return counts[index] ?? counts[counts.length - 1];
}

export function sectorForWave(wave: number) {
  if (wave >= 21) return 4;
  if (wave >= 16) return 3;
  if (wave >= 11) return 2;
  if (wave >= 6) return 1;
  return 0;
}

export function isBossWave(wave: number) {
  return wave > 0 && wave <= RUN_PACING.finalWave && wave % RUN_PACING.sectorLength === 0;
}

export function bossMkForWave(wave: number) {
  return Math.max(1, Math.min(5, Math.ceil(wave / RUN_PACING.sectorLength)));
}

/** Equivalent point on the former 50-wave tuning curve. */
export function scaledWave(wave: number) {
  return wave * RUN_PACING.legacyScale;
}

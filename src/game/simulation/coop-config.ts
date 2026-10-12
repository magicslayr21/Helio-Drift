export const COOP_CONFIG = {
  tickRate: 30,
  snapshotRate: 15,
  maximumCatchUpSeconds: 0.25,
  maximumPlayers: 2,
  arena: { width: 1000, height: 700 },
  difficulty: {
    enemyPressure: 1.5,
    bossHealth: 1.2,
    enemyDamage: 1.15,
  },
  revive: {
    range: 92,
    holdSeconds: 3,
    healthFraction: 0.4,
    cooldownSeconds: 8,
  },
  overdrive: {
    maximum: 100,
    damageChargeScale: 0.15,
    nearbyChargeMultiplier: 1.15,
    nearbyRange: 300,
    durationSeconds: 8,
    damageMultiplier: 1.2,
    fireRateMultiplier: 1.2,
  },
} as const;

export const COOP_FIXED_DT = 1 / COOP_CONFIG.tickRate;

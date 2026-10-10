export const UPDATE_LOG = [
  {
    version: "0.3.0-alpha.1",
    date: "2026-10-10",
    title: "Guardian signal",
    items: [
      "Pause now offers Save & return instead of Restart Run. Global Leaderboard moves from Settings to Pause; the menu still shows the live preview and full leaderboard.",
      "This update archive opens from the menu, its version number, and Settings. Versions follow major.minor.patch-alpha.N.",
      "Release checks now verify gameplay and matching update-log versions before Pages builds. The leaderboard backend accepts Guardian Link telemetry; redeploy the Worker when upgrading.",
      "Three original, quiet synthesized scores: Quiet Orbit for flight, Dreadnought Approach for MK1–5, and Omega Wake for MK6. Music has its own saved toggle in Settings and stops while paused or hidden.",
      "Upgraded Pulse Cannon damage growth reduced from 15% to 12% per level. All rare and epic weapons gain damage. Common weapons cap at level 3, rares at 4, and epics remain at 6; common stat upgrades also cap at 3.",
      "Targeting Optics is rare, with three upgrades: +20 percentage points critical chance and +0.1× critical damage each, reaching 66% chance and 2.5× total damage.",
      "Small homing asteroids move 50% faster (117 px/s). Fast asteroids gain 20% HP, now 1.8× ordinary asteroid HP, and accelerate as they lose health, up to 50% above their normal speed.",
      "MK3 / MK4 / MK5 / MK6 health is now 14,000 / 22,000 / 28,000 / 37,000. Every boss defeat clears remaining asteroids, escorts, and hostile projectiles and stops active meteor showers.",
      "MK6's half-health raid launches only medium meteors at 300 px/s across the screen's height instead of a fast cone from the boss.",
      "Twin Cannons becomes Adaptive Arsenal: each upgrade adds one projectile to any drone cannon, one Arc chain, or +20% Beam DPS.",
      "Piercing Rounds becomes Synchronized Feeders: each upgrade adds 5% pilot and 10% drone attack speed, with equivalent Beam DPS. Existing upgrades carry over; bonus drone piercing is replaced.",
      "Magnet Coil gains +90 collection range per level, stronger attraction, and repair-kit collection. Wide Scan adds +150 target range, +60 salvage range, and +50 support range per level, including Arc and Beam mounts.",
      "Repair Pulse requires both pilot and drone to avoid damage for five seconds while nearby. Levels heal 1 HP every 1 second / 0.75 seconds, then 2 HP every 0.5 seconds at max. Hits or leaving support range reset the healing cadence.",
      "New Guardian Link redirects 20% / 35% / 50% of post-armor player damage to a nearby drone's HP. Absorption cannot exceed the drone's remaining HP and ends when it is destroyed.",
      "Existing saves migrate to the new upgrade limits; boss and fast-asteroid HP keep their remaining health percentage. Fixes include repair timing, stat rebuilds, and safe menu input while viewing updates.",
    ],
  },
  {
    version: "0.2.0-alpha.1",
    date: "Previous release",
    title: "Flight deck",
    items: [
      "New launch menu with Continue Run, confirmed New Run, callsign editing, and a global leaderboard preview. Reopening the game returns to the menu.",
      "Removed the bottom status strip, moved sector progress to the top HUD, and introduced alpha semantic versioning.",
      "Corrected Sentinel aiming and increased Spiker attack rate by 1.2× and projectile speed by 1.5×.",
    ],
  },
] as const;

export const UPDATE_LOG = [
  {
    version: "0.6.0-alpha.1",
    date: "2026-10-15",
    title: "A wider frontier",
    sections: [
      {
        title: "CO-OP FLIGHT",
        items: [
          "Full-screen playfield with a wider view and teammate edge markers.",
          "Fixed asteroids streaking across the map when wrapping at edges.",
          "Redesigned flight deck, rooms, records, settings and end-of-run screens.",
        ],
      },
      {
        title: "SPECIALIST ENEMIES",
        items: [
          "Tether Sentinels now shield nearby asteroids and enemies; bosses stay unshielded.",
          "Distinct new hulls for Tether Sentinels and Mine Wardens.",
          "Co-op-only Rift Spiker: spiral volleys and a warned gravity pulse.",
          "Rift Spiker added to the co-op developer console.",
        ],
      },
      {
        title: "ARSENAL & VISIBILITY",
        items: [
          "Ship visibility slider adds glow and hull fill.",
          "Reduced Railgun aim assist while retaining gentle correction.",
          "Beam width scales with level; redline heat adds red beams and 35% damage.",
          "New common Range upgrade: up to 40% more weapon and drone reach.",
        ],
      },
    ],
  },
  {
    version: "0.5.6-alpha.1",
    date: "2026-10-15",
    title: "Shared flight controls and co-op records",
    sections: [
      {
        title: "MULTIPLAYER",
        items: [
          "Campaign pause layout, arsenal and boost ledger in co-op.",
          "Weapon selection and shop purchases work during shared pause.",
          "Full draggable developer console with field and loadout controls.",
          "Inspect both pilots’ stats, edit team records and delete co-op runs.",
        ],
      },
      { title: "CAMPAIGN", items: ["Tether Sentinel and Mine Warden added to developer spawns."] },
    ],
  },
  {
    version: "0.5.5-alpha.1",
    date: "2026-10-14",
    title: "A unified Helios flight deck",
    sections: [
      {
        title: "MULTIPLAYER",
        items: [
          "Amber controls, charcoal panels and illuminated corners across multiplayer.",
          "Restyled pause menu with a clear resume action and countdown.",
          "Developer console styled as the Helios service bay.",
          "Room browser refreshed with patrol rows and a signal-search display.",
        ],
      },
    ],
  },
  {
    version: "0.5.4-alpha.1",
    date: "2026-10-14",
    title: "Co-op flight deck and reliability",
    sections: [
      {
        title: "MULTIPLAYER",
        items: [
          "Stalled connections now time out and retry automatically.",
          "Fixed sockets getting stuck while closing.",
          "Reconnects recover after network changes and returning to the game.",
          "Fixed competing tabs repeatedly disconnecting each other.",
          "Slow reconnect requests no longer invalidate newer connection tickets.",
          "Added clearer connection status and a Reconnect button.",
          "Released multiplayer styling and callsign editing in the lobby.",
          "Dismissible warning about possible multiplayer progress wipes.",
          "Escape opens shared pause without leaving the match.",
          "Pause includes settings, leaderboards, game details and update notes.",
          "Authorized developer console; assisted runs stay off the leaderboard.",
        ],
      },
      {
        title: "FLIGHT & LOADOUT",
        items: [
          "Weapon bar restored with two customizable quick slots.",
          "Press 1 or 2 to equip your chosen primary or secondary weapon.",
          "Green salvage drone chassis.",
          "Slower early meteor showers; full speed from wave 21.",
        ],
      },
    ],
  },
  {
    version: "0.5.3-alpha.1",
    date: "2026-10-14",
    title: "Co-op controls and clarity",
    sections: [
      {
        title: "MULTIPLAYER",
        items: [
          "Fixed the Deploy dialog blocking movement and Escape-to-pause.",
          "Movement keys work after clicking HUD buttons.",
          "Flight controls regain focus when entering or resuming a match.",
          "Touch movement releases correctly outside its button.",
          "Sharper canvas on high-density displays and smaller windows.",
          "Resolution updates when switching displays or zooming.",
        ],
      },
    ],
  },
  {
    version: "0.5.2-alpha.1",
    date: "2026-10-13",
    title: "Co-op flight improvements",
    sections: [
      {
        title: "MULTIPLAYER",
        items: [
          "Smoother rendering and controls with less snapshot processing.",
          "Sharper display resolution and a larger flight area.",
          "More campaign particle effects visible in co-op.",
          "Either pilot can pause both players for up to 30 seconds.",
          "Resume or leave from the shared pause menu.",
        ],
      },
    ],
  },
  {
    version: "0.5.1-alpha.1",
    date: "2026-10-13",
    title: "Campaign gameplay in co-op",
    sections: [
      {
        title: "SHARED GAMEPLAY",
        items: [
          "Co-op now uses the original campaign combat and artwork.",
          "Campaign weapons, enemy AI, boss phases, and meteor showers restored in co-op.",
          "Campaign upgrade choices and paid rerolls added to the co-op shop.",
          "Revives, Overdrive, separate equipment, and co-op escorts retained.",
        ],
      },
      {
        title: "SMOOTHER FLIGHT",
        items: [
          "Campaign effects, weapon sounds, and boss music now follow the shared battle.",
          "Movement prediction follows campaign slow motion.",
          "Larger room saves preserve boss attacks and individual pilot timers.",
        ],
      },
    ],
  },
  {
    version: "0.5.0-alpha.1",
    date: "2026-10-13",
    title: "Online Co-op Expansion",
    sections: [
      {
        title: "ONLINE DEPLOYMENT",
        items: [
          "Private rooms, room-code joining, public patrols, browsing, and Quick Join added.",
          "Ready-up, secure reconnects, individual callsigns, and two-player flight added.",
          "Developer authorization is required to host during closed alpha; anyone can join.",
        ],
      },
      {
        title: "CO-OP CAMPAIGN",
        items: [
          "The full 25-wave campaign and optional MK6 challenge support two pilots.",
          "Each pilot has separate hull, credits, weapons, upgrades, missiles, and drone.",
          "Shared Overdrive, proximity revives, sector directives, and co-op scaling added.",
        ],
      },
      {
        title: "ENEMIES & BOSSES",
        items: [
          "Sentinels, Wardens, Spikers, asteroid mutations, and MK1–MK6 target either pilot.",
          "Tether Sentinels and Mine Wardens add new team-focused hazards to later waves.",
          "Boss defeats clear the battlefield and co-op victory or failure is synchronized.",
        ],
      },
      {
        title: "FLIGHT DECK & RECORDS",
        items: [
          "The co-op HUD shows teammate hull, directives, Overdrive, shops, and results.",
          "Distinct pilot accents and keyboard, pointer, and touch controls support shared flight.",
          "Server-authored co-op results use a separate global leaderboard.",
        ],
      },
    ],
  },
  {
    version: "0.4.2-alpha.1",
    date: "2026-10-12",
    title: "Run saving & callsigns",
    items: [
      "Failed first saves now retry; Save & Return warns if storage fails.",
      "Older tabs cannot overwrite newer run progress.",
      "Latest progress syncs on menu return and checkpoint recovery.",
      "Rejected leaderboard reports stay queued for retry.",
      "Guardian Link reports work with older leaderboard servers.",
      "Campaign requires a saved callsign beside the launch buttons.",
    ],
  },
  {
    version: "0.4.1-alpha.1",
    date: "2026-10-11",
    title: "Update log refresh",
    items: [
      "Cleaner release layout with a fixed header and latest-release badge.",
      "Shorter bullet points across all release notes.",
    ],
  },
  {
    version: "0.4.0-alpha.1",
    date: "2026-10-11",
    title: "Deploy menu & music",
    items: [
      "New Deploy button and full-screen mode selector.",
      "Custom mode icons, hover highlights, and mobile layout.",
      "Campaign offers Continue Run and confirmed New Run.",
      "Back and Escape work throughout deployment.",
      "Multiplayer, Extras, and Unlimited marked as unreleased.",
      "New exploration and MK6 soundtracks; all music slightly louder.",
      "MK6’s second phase adds louder, distorted music.",
    ],
  },
  {
    version: "0.3.0-alpha.1",
    date: "2026-10-10",
    title: "Drone upgrades & balance",
    items: [
      "Save & Return replaces Restart Run; leaderboard moved to Pause.",
      "Update log added to the menu and Settings.",
      "Release checks and Guardian Link leaderboard support added.",
      "Original flight and boss music with a separate Settings toggle.",
      "Pulse Cannon upgrade damage reduced; rare and epic weapons buffed.",
      "Weapon level caps: common 3, rare 4, epic 6. Common stat caps: 3.",
      "Targeting Optics: rare, 3 levels, up to 66% crit chance and 2.5× damage.",
      "Small homing asteroids move 50% faster.",
      "Fast asteroids gain 20% HP and speed up as health drops.",
      "MK3–6 HP increased to 14k / 22k / 28k / 37k.",
      "Boss defeats clear enemies, hostile shots, and meteor showers.",
      "MK6’s mid-fight raid sends medium meteors across the screen at 300 px/s.",
      "Adaptive Arsenal replaces Twin Cannons and boosts any drone weapon.",
      "Synchronized Feeders replaces piercing: +5% pilot / +10% drone attack speed per level.",
      "Magnet Coil improves collection; Wide Scan extends targeting and support range.",
      "Repair Pulse heals nearby after 5 seconds without damage; up to 2 HP every 0.5 seconds.",
      "Guardian Link redirects 20–50% of damage to a nearby drone.",
      "Existing saves updated; repair timing, stat rebuilds, and menu input fixed.",
    ],
  },
  {
    version: "0.2.0-alpha.1",
    date: "Previous release",
    title: "Flight deck",
    items: [
      "New menu with saved runs, callsign editing, and leaderboard preview.",
      "Reopening the game returns to the menu.",
      "Bottom status bar removed; sector progress moved to the top.",
      "Alpha version numbering added.",
      "Sentinel aiming fixed.",
      "Spiker attack rate increased 1.2×; shot speed increased 1.5×.",
    ],
  },
] as const;

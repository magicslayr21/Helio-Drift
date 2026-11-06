# Helios Drift

Helios Drift is a browser arcade game built with React, TypeScript, Vite, and a
hand-written HTML canvas game engine. The editable application source is in
`src/`, grouped by UI components, game systems, assets, and small utilities.

## Run the game

Requirements: Node.js 22.12 or newer and npm.

From the repository root:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite (usually `http://localhost:5173`).
Press **Start Run** to play. `P` or `Esc` pauses the game.

## Build and preview

```sh
npm run build
npm run preview
```

Vite writes a self-contained production page to `dist/index.html`.

## Gameplay tests

```sh
npm run game:test
```

Runs headless engine checks for weapons, asteroids, boss abilities, damage,
spawning, and camera feedback. Requires Node.js 24.

## Formatting

Format the editable source and project configuration with:

```sh
npm run format
```

Check formatting without changing files with:

```sh
npm run format:check
```

The checked-in root `helios-drift.html` is a generated, bundled standalone
export. Edit the source under `src/` and regenerate the production build instead
of editing that bundle by hand.

## Global leaderboard

Run `npm run leaderboard:dev` alongside `npm run dev` to use the shared SQLite
leaderboard locally. Open it from the main menu or settings to choose a callsign,
browse the furthest runs, or use authenticated developer moderation.

Publishing requires a persistent Node.js 24 API host and the GitHub Actions variable
`VITE_LEADERBOARD_URL`. See [leaderboard setup and operation](docs/leaderboard.md)
for deployment, storage, moderation, and test instructions.

## Online co-op

The two-player campaign uses a separate Cloudflare Worker with MatchRoom and LobbyIndex Durable
Objects. Local commands, release checks, migrations, security controls, cost planning, staged
deployment, and rollback are documented in the
[online co-op release runbook](docs/multiplayer-deployment.md). Production deployment requires a
separate explicit approval. During closed alpha, only players with the developer code can create a
room; anyone can browse, Quick Join, join by code, or reconnect.

Campaign and co-op now run the same `Game` combat methods and canvas renderer. The co-op adapter
supplies two pilot contexts, seeded room randomness, revives, Overdrive, and room snapshots.
When changing core gameplay, edit the campaign engine or its balance tables; do not introduce a
second weapon, enemy, or boss implementation. See the runbook's **Updating to shared campaign
gameplay** section for the multiplayer Worker update required by `0.5.1-alpha.1`.

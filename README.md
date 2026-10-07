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

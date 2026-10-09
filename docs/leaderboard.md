# Global leaderboard

The game remains a static Vite application on GitHub Pages. A separate Node.js 24 API stores shared records in SQLite. No database credentials or moderation code are included in the game bundle.

## Local development

Use Node.js 24, then run these commands in separate terminals from the repository root:

```sh
npm ci
npm run leaderboard:dev
```

```sh
npm run dev
```

Vite forwards `/api` to the service on port 8787. The database is kept in the ignored `server/data/` directory. Leave `VITE_LEADERBOARD_URL` unset for this workflow. Open **Global Leaderboard** from the main menu or settings. The local development moderation code is `dev`.

```sh
npm run leaderboard:test
npm run build
```

The API uses only Node's built-in modules; there are no backend packages to install. `GET /api/health` checks its availability. See [server API documentation](../server/README.md) for endpoint and validation details.

## Publish the API and connect GitHub Pages

### Render deployment

The repository includes [`render.yaml`](../render.yaml), which provisions one
Node.js 24 service, a 1 GB persistent disk, a database health check, and a generated
private moderation code. **The Starter service and persistent disk are paid**;
review Render's pricing before approving the deployment.

1. Commit and push `render.yaml` to your GitHub repository. In the Render dashboard,
   choose **New → Blueprint**, connect `magicslayr21/Helio-Drift`, and select `main`.
   Review and deploy the blueprint.
2. Once the service is healthy, copy its assigned HTTPS address from Render.
   Open `<service-address>/api/health`; it must return `{"ok":true}`.
3. In GitHub, open this repository's **Settings → Secrets and variables → Actions
   → Variables** and set `VITE_LEADERBOARD_URL` to `<service-address>/api`.
4. In **Actions**, run the **Deploy to GitHub Pages** workflow. This rebuild is
   required because Vite embeds the API address at build time.
5. Open the published game in two independent browsers, submit a run, and confirm
   both show the same leaderboard. Restart the Render service and confirm the run
   remains. Retrieve `LEADERBOARD_ADMIN_CODE` privately from Render's environment
   settings when you need the game's **Developer Access** moderation controls.

Keep the disk attached and the service at one instance. The blueprint does not
enable forwarded-IP trust; requests use the default conservative rate limiting.
Do not put the generated moderation code into GitHub variables or frontend code.

### Other hosts

The API needs a running Node.js service and persistent disk. GitHub Pages alone cannot run it. The included `server.Dockerfile` can be used with a container host, or start `node server/index.mjs` directly on a Node.js 24 host.

1. Deploy the API with these environment settings:
   - `NODE_ENV=production`
   - `PORT=8787` (or the port assigned by the host)
   - `LEADERBOARD_DB=/data/leaderboard.sqlite`
   - `LEADERBOARD_ORIGINS=https://magicslayr21.github.io`
   - `LEADERBOARD_ADMIN_CODE`: a private code of at least 12 characters, set securely in the host's secret settings. Do not use the public cabinet code `dev`.
2. Attach a persistent writable volume to `/data`. Keep the SQLite database, WAL, and SHM files on the same volume. Run one API instance against that local volume. Multiple replicas require a shared database design instead.
3. Configure an HTTPS public hostname and health check `/api/health`. If a trusted host proxy supplies the client's address, set `LEADERBOARD_TRUST_PROXY=1`; only enable this where the proxy controls the forwarded headers.
4. Set the GitHub repository **Actions variable** `VITE_LEADERBOARD_URL` to the complete public API base, for example `https://leaderboard.example.com/api`. It is a public URL, not a secret. The Pages workflow passes it into Vite.
5. Run the Pages deployment workflow or push the completed change to `main`. Confirm that two independent browsers see the same entries, and that the private moderation code can manage them.

For a local container build:

```sh
docker build -f server.Dockerfile -t helio-leaderboard .
```

Use your host's secret and volume configuration when running the image. The service refuses to start in production with missing or insecure moderation credentials. Back up the database through SQLite's backup facility, or stop the service while copying the database and its accompanying files; do not copy a live database file alone.

Without a configured API URL, the published game continues to play and the leaderboard displays an availability message. A successful local build does not deploy the API or populate this repository variable.

## Player identity and records

Each browser receives a random pilot ID and private submission token. The browser keeps them in local storage; public lists never expose the token. This identifies a pilot on that browser, rather than a cross-device account. Clearing browser storage creates a new pilot. Usernames are display names and may be shared by different pilots.

Players can set their callsign in the leaderboard. Server-side filtering replaces offensive or invalid names with safe names such as StarDestroyer or NebulaRider. Names use 2–24 letters, digits, spaces, underscores, or hyphens; the filter also checks common spelling evasions. Moderators can correct anything the filter misses.

The public board shows each pilot's furthest non-deleted run. Ranking uses progress first (MK6 cleared, MK6 reached, regular sectors), then wave, score, and credits, with a stable tie break. Pagination exposes all pilots, not just a fixed top ten. Credits are the run's current/final balance, not lifetime earnings. Runs modified through the developer console are labelled assisted.

The game sends a detached snapshot about every 15 seconds and at death, victory, restart, and page exit. The board refreshes every 30 seconds while visible and when focus returns. Connection failures never pause or block combat. A bounded browser queue retains the latest report for up to 12 runs and retries failed requests. Closing a browser cannot guarantee a final network delivery; saved pending reports are retried next time the game opens. SQLite stores reports across API restarts, and revisions reject stale updates.

Death and victory snapshots are frozen so effects after a run ends do not inflate its recorded score. A victory after MK5 can continue into MK6 under the same run ID. Existing local saves gain a stable leaderboard identity when resumed; elapsed time before this feature was installed is unavailable for those older saves.

## Developer moderation

Enter the private server moderation code through **Developer Access** in settings or the leaderboard. Successful verification grants an expiring in-memory session. Actions beside each record allow viewing detailed equipment, stat upgrades, drone upgrades, duration and cause of death, editing the callsign or summary, and deleting the run with confirmation.

The public cabinet code still opens the local developer console. It cannot grant production leaderboard access; the server checks the private code on every moderation request. A moderator edit locks that record against later client overwrites. Deletions retain a tombstone so queued reports cannot restore a removed record. If that pilot has another eligible run, their next-best run becomes visible. Moderator callsign edits apply to that record.

Run data comes from the browser. The API validates types, limits, ownership, revisions, and permissions, but it cannot prove that a modified game client played honestly. This is a community leaderboard, not server-verified competitive scoring.

# Free-tier global leaderboard setup

This deploys the leaderboard to **Cloudflare Workers + D1**. The game continues to
run on GitHub Pages. D1 keeps scores when the Worker restarts or is redeployed.
You do not need Render, a paid server, a domain, or a GitHub secret for this setup.

Choose the **Workers Free** plan. Workers and D1 have usage and storage limits;
this is free within those limits, not unlimited hosting. Review the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
You do not need to upgrade to a paid plan to follow this guide. If free quotas are
exhausted, leaderboard requests can fail until the quota resets; the game still runs.

The code is prepared, but your Cloudflare account must create the live database,
deploy the Worker, and set its private moderation code. The all-zero database ID
in `wrangler.jsonc` is a placeholder, not an existing database.

## 1. Create your account and get the code

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   and verify your email. Open **Workers & Pages** if Cloudflare asks what you want
   to build. You can skip adding a website/domain.
2. Install [Node.js 24](https://nodejs.org/) and [Git](https://git-scm.com/downloads)
   on your computer. Open Terminal (macOS/Linux) or PowerShell (Windows).
3. Run these commands one line at a time:

   ```sh
   git clone https://github.com/magicslayr21/Helio-Drift.git
   cd Helio-Drift
   npm ci
   ```

   If you already have this repository locally, open its folder and pull the
   latest `main` before running `npm ci`. Keep your own uncommitted work safe.

All remaining terminal commands run from the `Helio-Drift` folder.

## 2. Connect Cloudflare and create the database

```sh
npx wrangler login
```

This opens your browser. Sign into your Cloudflare account and approve Wrangler's
access. Return to the terminal when it confirms you are logged in. Do not paste
Cloudflare passwords or API tokens into chat or repository files.

```sh
npx wrangler d1 create helio-drift-leaderboard
```

Wrangler prints a database ID similar to
`12345678-abcd-1234-abcd-123456789012`. Open **`wrangler.jsonc`** in a text editor
and replace only the all-zero `database_id` with your actual ID. If Wrangler offers
to update the configuration automatically, accept and verify that the binding
is still named **`DB`** and `migrations_dir` is **`worker/migrations`**.

The database ID is not a password. Keep the existing Worker name, database name,
and origin settings. If the database already exists, get its ID from
`npx wrangler d1 list` instead of creating another one.

## 3. Deploy the API and set your moderation code

```sh
npm run cf:deploy
```

This applies the database migrations, then deploys the Worker. Approve the
migration prompt if shown. On your first deployment, Cloudflare may ask you to
choose a free `workers.dev` subdomain; choose one and continue.

The terminal prints your public address, similar to:

```text
https://helio-drift-leaderboard.your-subdomain.workers.dev
```

Save your actual address. Next, set the private moderation code:

```sh
npx wrangler secret put LEADERBOARD_ADMIN_CODE
```

At the hidden prompt, paste a long, unique code from your password manager
(12–256 characters) and press Enter. Keep a private copy: this is the code you
enter in the game's **Developer Access** to moderate leaderboard records.
Never put it in `VITE_*`, GitHub Actions variables, or `wrangler.jsonc`.

Until this secret is set, the Worker deliberately returns an unavailable response.
No Cloudflare credentials are included in the game.

## 4. Check the API

Open your actual Worker address with `/api/health` added in a browser:

```text
https://helio-drift-leaderboard.your-subdomain.workers.dev/api/health
```

It should show:

```json
{ "ok": true }
```

Opening `/api/leaderboard` should return an empty `entries` list before anyone
submits a run. Opening just the base address returns “Endpoint not found”; that
is normal because this service is an API, not the game website.

## 5. Connect your published game

1. Open [the GitHub repository](https://github.com/magicslayr21/Helio-Drift).
2. Select **Settings → Secrets and variables → Actions → Variables**.
3. Create or edit the **repository variable** named **`VITE_LEADERBOARD_URL`**.
4. Set its value to your actual Worker address **ending in `/api`**, for example:

   ```text
   https://helio-drift-leaderboard.your-subdomain.workers.dev/api
   ```

   This is a public URL, so use a variable, not a secret. Do not add `/health`.

5. Open **Actions → Deploy to GitHub Pages → Run workflow**, select **main**, and
   run it. Wait for the workflow to finish successfully. Changing the variable
   alone does not update the existing game build.
6. Open [Helio Drift](https://magicslayr21.github.io/Helio-Drift/), refresh the page,
   play a run, and open **Global Leaderboard**. Check it in a second browser or
   private window: both should show the same record.

You can now use the leaderboard. Deployment is complete only after these live
checks pass; local tests do not create a public service.

## Updates, backups, and troubleshooting

- **Future API updates:** keep your real database ID in `wrangler.jsonc` (it is safe
  to commit), pull the updated code, run `npm ci`, then `npm run cf:deploy` again.
  Applied migrations are tracked; running the command again does not clear scores.
  Pushing to GitHub alone rebuilds the game but does not redeploy the Worker.
- **Back up scores:** run
  `npx wrangler d1 export DB --remote --output leaderboard-backup.sql`.
  Store the backup privately outside the repository; it contains player data and
  authentication hashes. D1 also offers Time Travel recovery subject to your plan.
- **“Configuration is incomplete”:** run the secret command from step 3. The code
  must be at least 12 characters. Use the same Cloudflare account and Worker name.
- **Database/table errors:** verify the database ID and run
  `npx wrangler d1 migrations apply DB --remote`. Local migrations do not initialize
  the live database.
- **Healthy API, unavailable game board:** verify the GitHub variable includes
  `/api`, rerun the Pages workflow, and refresh the game.
- **“This origin is not allowed”:** `LEADERBOARD_ORIGINS` must include your exact
  game origin, currently `https://magicslayr21.github.io`, without `/Helio-Drift/`
  or a trailing slash. Change `wrangler.jsonc` and redeploy if you move the game.
- **Too many developer login attempts:** wait 15 minutes. Login limits persist
  across Worker restarts. Rotating the code does not instantly revoke existing
  two-hour moderation sessions; sign out or clear `admin_sessions` in D1 if needed.
- **Free usage limits:** check Workers and D1 usage in the Cloudflare dashboard.
  Snapshots, ranking queries, indexes, and metadata updates all consume quota;
  the number of players you can support depends on play time and stored runs.
- **Existing Render deployment:** this starts a separate empty database. It does
  not import old Render/SQLite records automatically. Back up and migrate existing
  data before switching if you have any. If you previously activated paid Render
  resources, switching the game URL does not cancel them.

## Local development and verification

The original `npm run leaderboard:dev` still works with local Node/SQLite. To test
the Cloudflare version locally instead, create an ignored `.dev.vars` file:

```dotenv
LEADERBOARD_ADMIN_CODE=local-only-code-change-me
LEADERBOARD_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Then run:

```sh
npm run cf:migrate:local
npm run cf:dev
```

In another terminal run `npm run dev`. Leave `VITE_LEADERBOARD_URL` unset locally;
Vite forwards `/api` to port 8787. Run either backend on that port, not both.
Local D1 data lives in ignored `.wrangler/` storage and is separate from production.

```sh
npm run leaderboard:test
npm run cf:test
npm run typecheck
npm run build
```

The Cloudflare tests use the real local Workers runtime and D1 emulator, without a
Cloudflare login. Both backends run the same API contract tests. Additional Worker
tests cover concurrent writes/deletions, persisted login throttling, and missing
secrets. Scheduled maintenance removes expired sessions and rate-limit buckets.
Only secret-salted identifiers for registration/login limits are stored in D1;
ordinary request limits are best-effort per Worker isolate.

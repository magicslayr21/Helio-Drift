# Online co-op release runbook

Online co-op uses a separate Cloudflare Worker and two SQLite-backed Durable Object classes. The
existing leaderboard Worker remains separate; both Workers bind the same D1 database only so an
authoritative match can insert its final co-op result. The browser cannot submit co-op scores.

This is a reviewable deployment plan, not proof of a deployment. No command in Milestone 8 changes
remote Cloudflare resources. Run the production section only after an explicit release approval.

## Service map

| Component                   | Configuration                        | Responsibility                                        |
| --------------------------- | ------------------------------------ | ----------------------------------------------------- |
| GitHub Pages                | `.github/workflows/deploy-pages.yml` | Static React client                                   |
| Leaderboard Worker          | `wrangler.jsonc`                     | Player profiles and read-only single/co-op rankings   |
| Multiplayer Worker          | `wrangler.multiplayer.jsonc`         | Lobby HTTP API and WebSocket routing                  |
| `MatchRoom` Durable Object  | multiplayer migration `v1`           | One authoritative 30 Hz match per room code           |
| `LobbyIndex` Durable Object | multiplayer migration `v2`           | Serialized public-room discovery and Quick Join       |
| D1 `DB` binding             | `worker/migrations/`                 | Existing leaderboard tables plus additive `coop_runs` |

The two Wrangler files must keep the same D1 database ID, but they must keep different Worker names.
Do not bind live rooms to the leaderboard Worker or reuse either Durable Object class name for a
different service.

## Updating to shared campaign gameplay

`0.5.2-alpha.1` also needs **both** the frontend and multiplayer Worker update for the shared
30-second pause. Either pilot can pause or resume; the server freezes combat and all gameplay
timers, retains the deadline on reconnect, and automatically resumes without catching up paused
time. Repeated pause requests do not extend the deadline. No database migration is required.

Rendering now avoids full-world copies per frame, scales the canvas to display density, and uses
more of the viewport. Room snapshots are built once per broadcast instead of redundantly every
tick. The full bounded particle list is sent; the old 100-particle wire truncation is removed.
The 4 KB incoming-message limit applies only to player commands, not outgoing world snapshots.
Increasing that limit or buying a larger packet allowance does not improve graphics resolution;
large snapshots still cost bandwidth and take time to parse. No account-specific plan change is
required by this update.

`0.5.1-alpha.1` runs the original campaign engine on the multiplayer Worker and uses the original
campaign renderer in both browsers. Publish **both the frontend and multiplayer Worker** for this
update. The leaderboard Worker, D1 schema, database binding, existing secrets, and service URLs do
not need changes.

After the source changes are available in your checkout, run these commands from the repository
folder in PowerShell:

```powershell
git pull --ff-only
npm.cmd ci
npx.cmd wrangler login
npx.cmd wrangler deploy --config wrangler.multiplayer.jsonc
```

Wrangler login is only needed if the current machine is not already authenticated. Publish the
matching frontend through the normal GitHub Pages workflow and refresh both browsers. A new
frontend connected to an older Worker displays an update-required message rather than an empty
arena. Prefer finishing active matches before this deployment so both pilots reload together.

Room checkpoints now store the native campaign world in an atomic group of bounded storage values.
Existing room checkpoints remain readable: pilot equipment, health, credits, wave, enemy health,
and live projectiles migrate. Attacks from the retired simulation resume using native campaign
behaviour. New checkpoints preserve the full native boss script, timers, and seeded replay state.
No manual storage migration or room reset is required.

## Account, variables, and secrets

The Cloudflare account that owns the current `helio-drift-leaderboard` D1 database must perform the
deployment. A `workers.dev` address is enough; a paid domain is optional.

Public configuration:

- `LEADERBOARD_ORIGINS` in `wrangler.jsonc`: comma-separated allowed frontend origins.
- `MULTIPLAYER_ORIGINS` in `wrangler.multiplayer.jsonc`: the same exact origins. Origins do not
  contain paths or trailing slashes.
- GitHub Actions variable `VITE_LEADERBOARD_URL`: leaderboard Worker URL ending in `/api`.
- GitHub Actions variable `VITE_MULTIPLAYER_URL`: multiplayer Worker URL ending in `/api`.
- D1 `database_id`: an identifier, not a secret. Both Wrangler files currently reference the
  existing project database.

Private configuration:

- `LEADERBOARD_ADMIN_CODE` is the only required Worker secret. Set it on the leaderboard Worker
  with `npx wrangler secret put LEADERBOARD_ADMIN_CODE`. During closed alpha, this code unlocks
  private or public room creation for a two-hour browser session. Never use a `VITE_*` name for it.
- Both Workers share D1 so the multiplayer service can validate the leaderboard-issued session
  without receiving or storing the raw developer code. Browsing, Quick Join, room-code joining,
  and reconnecting remain open to all players.
- Reconnect tokens are random bearer capabilities returned once, hashed before Durable Object
  storage, and scoped to one player slot.

Do not commit `.dev.vars`, Cloudflare API tokens, database exports, reconnect tokens, or admin
sessions. Wrangler login or a narrowly scoped CI token supplies deployment authority.

## Local setup

Requirements are Node.js 24, npm, and Chromium for the two-browser smoke test. On Windows
PowerShell, use `npm.cmd`/`npx.cmd` if the execution policy blocks `npm.ps1`.

```sh
npm ci
npm run cf:migrate:local
npm run multiplayer:migrate:local
```

Create an ignored `.dev.vars` for the leaderboard Worker:

```dotenv
LEADERBOARD_ADMIN_CODE=local-only-code-change-me
LEADERBOARD_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Then use three terminals:

```sh
npm run cf:dev
npm run multiplayer:dev
npm run dev
```

Vite proxies `/api` to port 8787 and `/multiplayer-api` to port 8788. Leave both `VITE_*_URL`
variables unset for local development. Local Wrangler data is ignored and never touches production.

Release checks:

```sh
npm run typecheck
npm run game:test
npm run leaderboard:test
npm run cf:test
npm run multiplayer:test
npm run multiplayer:browser-test
npm run build
npm run format:check
```

`multiplayer:browser-test` starts isolated temporary services on available ports and drives two
independent Chromium browser contexts through private create/join, ready-up, live flight,
refresh/reconnect, and leave. Set `CHROME_PATH` if Chromium is not in a standard location.

## Measured release envelope

Measurements below were collected for the shared campaign implementation in the local
Cloudflare/Chromium test environment on 13 October 2026. They are regression baselines, not a promise
of Cloudflare edge latency or player skill.

- A deterministic two-pilot reference loadout cleared waves 1–25 in **14.16 simulated minutes**.
  This test gives pilots perfect positioning, continuous engagement, and immunity; it is not a
  prediction of actual play time. The previous 33.89-minute benchmark belonged to the retired
  alternate simulation. MK6 remains optional after campaign completion.
- A ten-minute accelerated two-pilot soak remained finite and within all hard entity ceilings.
- Native cap-pressure snapshots remain below the **192 KiB** release ceiling. The test checks
  simulation, serialization, and entity limits using actual campaign entities.
- Full campaign traversal includes all five bosses and the MK6 ending. Every weapon is compared
  directly against the single-player engine.
- The two-browser smoke verifies the original campaign renderer draws both pilots, plus
  refresh/reconnect and explicit leave with no page exceptions.

Hard per-room ceilings are 96 rocks, 32 enemies, 256 friendly projectiles, 256 hostile projectiles,
48 hazards, 8 tethers, 8 mines, and 96 pickups. Normal waves remain well below these values. At the
ceiling, the theoretical snapshot stream is about 5.9 MB/s per room (192 KiB × 15 Hz × two
clients); normal snapshots are much smaller. Monitor egress and snapshot size before raising caps.

## Expected cost

Cloudflare pricing and free allowances change, so verify the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), and
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before approval.

For capacity planning, one 30-minute match produces approximately:

- one active MatchRoom for 1,800 seconds;
- 54,000 simulation ticks, executed in memory rather than as separate HTTP requests;
- up to 27,000 snapshots per client at 15 Hz;
- roughly one atomic room checkpoint per second while connected, split across multiple bounded
  storage values for larger native worlds;
- one idempotent D1 result insert at completion; and
- a small number of lobby, ticket, join, heartbeat, and reconnect operations.

The main cost driver is active Durable Object duration/CPU plus WebSocket message volume, not D1
result storage. Eight local rooms are only a correctness/load sample and not a production capacity
claim. Start on the lowest suitable plan, set billing alerts, and use Cloudflare analytics to insert
current request, duration, egress, storage, and D1 rates into the estimates above. Free service is
possible only while the account's current Workers, Durable Objects, and D1 allowances cover actual
usage; do not promise that every 25–35 minute run will remain free.

## Security and abuse controls

- Cloudflare terminates TLS. Production clients must use HTTPS/WSS.
- CORS rejects unlisted browser origins. CORS is not authentication; room tokens remain required.
- Room creation requires a current developer session during closed alpha. Joining public or
  private rooms does not require the developer code.
- Room codes are discovery handles, not credentials. Reconnect tokens are hashed at rest and socket
  tickets are short-lived and one-use.
- A Durable Object assigns command ownership from the authenticated socket. Client-supplied player
  IDs, scores, damage, movement beyond normalized input, and result reports are not trusted.
- Rooms atomically enforce two slots. Input is limited to 90 messages/second and 4 KiB/message;
  malformed, stale, oversized, rate-flooded, and ownership-spoofed messages have regression tests.
- Public lobby records contain only bounded discovery summaries. Private rooms never enter the
  index. Completed co-op rows contain callsigns and match statistics, so database exports are
  private operational data.
- Keep Cloudflare's platform DDoS protections enabled. If abuse appears, add edge rate rules around
  room creation/join before weakening in-room validation.

## Observability and alerts

Use Cloudflare Worker, Durable Object, and D1 analytics for request failures, CPU/duration, active
rooms, storage, and D1 errors. During a staged release, tail each Worker separately:

```sh
npx wrangler tail --config wrangler.jsonc
npx wrangler tail --config wrangler.multiplayer.jsonc
```

The multiplayer Worker logs lobby synchronization and result-write failures without tokens or
payload bodies. Never add reconnect tokens, authorization headers, socket tickets, admin codes, or
full D1 rows to logs. Alert or stop rollout on sustained 5xx responses, elevated WebSocket closes,
result-write retries, CPU-limit events, abnormal room-creation rates, or D1 quota/errors.

Health checks:

```text
https://<leaderboard-worker>/api/health
https://<multiplayer-worker>/api/health
```

Also verify `/api/leaderboard/coop`, one private two-browser room, one public room, Quick Join,
refresh/reconnect, explicit leave, and one authoritative test result before widening access.

## Production deployment plan (approval required)

1. Freeze changes, run every release check above, and record the commit SHA.
2. Export a D1 backup outside the repository:

   ```sh
   npx wrangler d1 export DB --remote --config wrangler.jsonc --output helio-drift-pre-coop.sql
   ```

3. Apply the additive D1 migrations. `0002_coop_leaderboard.sql` creates only `coop_runs` and its
   ranking index; it does not rewrite single-player rows:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
   ```

4. Deploy the leaderboard Worker so the read-only co-op ranking endpoint is available:

   ```sh
   npx wrangler deploy --config wrangler.jsonc
   ```

5. Deploy the multiplayer Worker. Wrangler applies Durable Object migrations `v1` (`MatchRoom`)
   and `v2` (`LobbyIndex`) as part of the first publish:

   ```sh
   npx wrangler deploy --config wrangler.multiplayer.jsonc
   ```

6. Check both health endpoints and exercise a private room directly against the Worker. Do not
   publish the frontend if either backend check fails.
7. Set GitHub Actions variables `VITE_LEADERBOARD_URL` and `VITE_MULTIPLAYER_URL` to their respective
   Worker origins ending in `/api`. Run the Pages workflow for the approved SHA.
8. Run the live two-browser checks, then public listing and Quick Join. Monitor the staged release
   before advertising the mode.

The leaderboard migration should precede the multiplayer Worker because a completed match writes to
`coop_runs`. The multiplayer Worker should precede the frontend because a configured client exposes
the online flow immediately.

## Custom domains

`workers.dev` hosts require no domain purchase. For a custom API domain, add it in Cloudflare's
Worker settings (or a reviewed Wrangler route), issue the certificate through Cloudflare, then add
the frontend's exact origin to both origin variables. Update both GitHub `VITE_*_URL` variables and
rebuild Pages. A custom domain changes routing, not the D1 or Durable Object data.

## Rollback

1. Stop new exposure first: roll the Pages deployment back to the previously approved artifact or
   rebuild the prior commit with its prior `VITE_*` variables.
2. Use Cloudflare's Worker version rollback for the leaderboard and multiplayer Workers if their
   code is at fault. Keep Durable Object class bindings/migration history present; deleting a class
   is not a safe rollback.
3. Do **not** drop `coop_runs` to roll back. The migration is additive and can remain unused. Restore
   the D1 export only for confirmed database corruption, because a restore can discard newer runs.
4. Existing rooms may be incompatible with older room code. Prefer draining active rooms before a
   multiplayer rollback; otherwise announce that reconnectable sessions can be lost.
5. Re-run health, leaderboard, single-player, and private-room smoke checks after rollback.

Single-player saves are browser-local and isolated from co-op room state, so disabling or rolling
back multiplayer does not require a save migration.

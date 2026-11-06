# Helio Drift global leaderboard API

For Cloudflare Workers + D1 hosting on the free tier, follow
[the Cloudflare setup guide](../docs/cloudflare.md). The Worker in `worker/index.mjs`
implements this API with the same validation and moderation rules. This document's
Node process, filesystem, proxy, and disk settings apply to the original server.

The game sends small run snapshots to this independent service. SQLite persists
identities, run snapshots, moderation changes and deletion tombstones. A board
page includes each player's furthest undeleted run, ranked by MK6 clear, MK6
attempt, ordinary sectors, then wave, score and remaining credits. Run ID breaks
ties deterministically. An active run can appear before it ends.

## Run locally

Requires Node.js 24 or newer; the API has no npm dependencies.

```sh
node server/index.mjs
node --test server/test/*.test.mjs
```

The frontend's development `/api` proxy targets port 8787. Start the Vite frontend
separately with `npm run dev`. In development the API developer code defaults to
`dev`; use `LEADERBOARD_ADMIN_CODE` to change it.

## Production configuration

Host this API on a Node server with HTTPS and a **persistent disk**. GitHub Pages
can host the game's static frontend, but cannot run this API or store its database.
Set the frontend build variable `VITE_LEADERBOARD_URL` to its public HTTPS URL,
including `/api`, and configure the frontend's exact origin on the API.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production` | Enables production defaults and requires a private developer code. |
| `LEADERBOARD_ADMIN_CODE` | Production secret, at least 12 characters; cannot be `dev`. Enter it in the leaderboard developer prompt. Never place it in `VITE_*`, committed files or frontend bundles. |
| `LEADERBOARD_DB` | SQLite file on a persistent writable volume; default `server/data/leaderboard.sqlite`. |
| `LEADERBOARD_ORIGINS` | Comma-separated exact frontend origins, no paths or trailing slash. Production default: `https://magicslayr21.github.io`. Development also allows localhost and 127.0.0.1 on ports 5173, 4173 and 8787. |
| `PORT` | HTTP port, default `8787`. |
| `HOST` | Bind address, default `0.0.0.0`. |
| `LEADERBOARD_TRUST_PROXY=1` | Use the last `X-Forwarded-For` address for rate limits. Enable only when a trusted reverse proxy appends the real connecting address and direct access is blocked. Otherwise leave unset. |

Use one API instance per SQLite database volume. SQLite WAL mode supports
concurrent requests within that instance; separate ephemeral disks do not form
a shared leaderboard. Back up the database with SQLite's backup mechanism or
stop the API and copy the database file and its `-wal`/`-shm` companions together.
Health monitoring can use `GET /api/health`.

Local developer mode in the game does not grant remote administrator access. The
leaderboard validates the configured private code on the API, then issues a
two-hour session. Codes are compared in constant time; only hashes of bearer
tokens are stored. Administrator sessions can be explicitly signed out.

## API

JSON requests require `Content-Type: application/json`. Bearer tokens go only in
the `Authorization: Bearer …` header. Bodies are capped at 16 KiB. Errors return
`{ "error": "message" }` with an appropriate HTTP status.

| Method and path | Authentication | Request / response |
| --- | --- | --- |
| `GET /api/health` | Public | `{ok:true}` after checking the database. |
| `POST /api/players` | Public | `{username}` → `{playerId, playerToken, username}` (201). Empty names get a safe placeholder. |
| `PATCH /api/players/me` | Player token | `{username}` → `{username}`. |
| `PUT /api/runs/:runId` | Owning player's token | `RunReport` → `{accepted:boolean}`. |
| `GET /api/leaderboard?offset=0&limit=25` | Public | `{entries,total,updatedAt}`, with global ranks and no credentials. Maximum page size 100. |
| `POST /api/admin/session` | Private code in body | `{code}` → `{token,expiresAt}`. |
| `DELETE /api/admin/session` | Admin token | `{signedOut:true}`. |
| `GET /api/admin/runs/:runId` | Admin token | `RunDetails`, including weapons, upgrades, drone build, death cause, duration, timestamps and moderation state. |
| `PATCH /api/admin/runs/:runId` | Admin token | Any of `username, score, credits, wave, level, stage, status` → `{entry}`. |
| `DELETE /api/admin/runs/:runId` | Admin token | `{deleted:true}`. |

TypeScript payload definitions live in `src/leaderboard/types.ts`. Numbers must
be finite integers: score and credits 0–1e12, wave and level 1–1e6, sector 1–7,
duration 0–31,536,000 seconds, upgrade/weapon levels 0–1000. Weapon and upgrade IDs
are allowlisted against the game's IDs. `mk6-cleared` requires `victory` status.

Revisions increase monotonically. Stale or duplicate snapshots return
`accepted:false`. Dead, abandoned and MK6-cleared runs are finalized; an ordinary
victory can continue into MK6. Progress, score and duration cannot move backwards;
credits can decrease when purchases are made. The assisted marker is sticky.
Every moderation edit locks that run against later player overwrites. A moderator
name change is a per-run override, so later player profile edits cannot undo it.
Deletion keeps a tombstone to prevent delayed requests resurrecting the run; if
that player has another undeleted run, their next-best run appears on the board.

Names permit 2–24 ASCII letters, digits, spaces, underscores and hyphens. The
server checks offensive fragments after Unicode decomposition, lookalike and
leet substitutions, removal of separators and repeated-letter matching. Invalid
or flagged names receive a varied safe name such as `StarDestroyer` or
`NebulaRider`. Name filtering is deliberately conservative and can be maintained
in `server/moderation.mjs`; no finite word filter recognizes every offensive
phrase or future evasion. Moderators can correct names from the board.

Rate limits apply to registration, username changes, snapshot writes, public
reads, developer logins and moderation requests. Temporary IP buckets stay in
memory and are not written to the database. No email, real name, device
fingerprint or client IP is part of a run record.

Player identity is a browser-held bearer token, without an account recovery
system. Clearing browser storage or changing devices creates a new identity.
Usernames need not be unique. Back up the database to preserve identity bindings.
The API validates data and ownership but a browser game is not an authoritative
anti-cheat system: someone controlling their client can fabricate plausible run
data. Developer-assisted runs are labelled, and moderators can inspect or remove
suspicious entries.

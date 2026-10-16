# Release maintenance

For every future user-facing gameplay, balance, UI, audio, or service change,
update `src/game/update-log.ts` as part of the same change. Keep descriptions
accurate to implemented behavior and preserve earlier entries. The newest entry
must match `package.json` and `package-lock.json`; use
`MAJOR.MINOR.PATCH-alpha.N` while the game remains in alpha.

Run `npm run typecheck`, `npm run game:test`, and `npm run build` for game changes.
Changes to leaderboard report fields also need the shared API contract tests:
`npm run leaderboard:test` and `npm run cf:test`. Never alter the user's
Cloudflare database binding to satisfy tests. Test migrations for existing saves
when introducing new persisted fields or changing upgrade limits.

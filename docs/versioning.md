# Game versions

The version displayed in the game comes from `package.json`. Vite embeds it in
both local and production builds; GitHub Actions build numbers no longer replace
it. The current release is `0.3.0-alpha.1`.

Use `MAJOR.MINOR.PATCH-alpha.N` while the game is in alpha.

For every user-facing change, add accurate release notes to
`src/game/update-log.ts`. Keep older entries and make the newest version match
both package files. The menu and Settings read this shared archive. The gameplay
test suite checks version agreement, and the Pages workflow runs it before
publishing. Record gameplay, audio, UI, balance, and service changes together.

- Major: a breaking release or major milestone.
- Minor: a new feature release, such as drone modules and music.
- Patch: fixes and small balance corrections.
- Alpha number: successive prereleases of the same planned version.

For example, `0.3.0-alpha.2` is the next prerelease of 0.3.0, while
`0.3.1-alpha.1` begins a patch release. Update both package files with:

```sh
npm version 0.3.1-alpha.1 --no-git-tag-version
```

On PowerShell use `npm.cmd` instead of `npm`. Commit the resulting package changes
and deploy the game. When alpha ends, choose the next release version without the
`-alpha.N` suffix.

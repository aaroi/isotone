# Move to Isotone

Isotone replaces the `iso-iterate` package starting with 0.4.0. The package name,
CLI command, browser script, and variant directory change. The exported APIs,
`.iteration-feedback.json`, and `/api/iteration/*` endpoints stay the same.

These commands require `isotone@0.4.0` to have been published. Renaming the
repository alone does not make them available on npm. Existing installations
continue to work until you choose to migrate.

## Migrate an existing project

Stop its development server. Save your current work and make a separate backup
of ignored local data, especially `.iso-iterate/` and your notes file. Run from
the project you want to migrate:

```sh
npx isotone@0.4.0 migrate
```

This previews the changes without writing files. Review the plan, then apply it:

```sh
npx isotone@0.4.0 migrate --write
```

The migration replaces the dependency with the running Isotone version in the
same dependency section, updates supported imports and setup references, and
moves `.iso-iterate/` to `.isotone/`, including local variant overrides. It
preserves note contents and existing source edits. Variant base snapshots are
updated for the renamed references; variants that were already stale remain
stale.

In a Git checkout, the plan covers tracked supported text files across the
checkout and local variant files. It skips dependencies, build outputs,
symlinks, lockfiles, and feedback data. Review custom or untracked integration
files separately. If both data directories or both dependency names exist,
resolve that conflict before retrying; the command does not merge them.

Run the package-manager install command printed by the migration. It does not
install packages or rewrite the lockfile itself. When manager detection is
ambiguous, choose explicitly with `--manager npm|pnpm|yarn|bun`. Use `--json` to
give a coding agent a structured plan or result.

Review the diff and commit the manifest, lockfile, and source changes together.
Keep local notes and variants out of Git. Restart the development server, reopen
the app on the same origin, and confirm that notes and variant previews remain
available. Run the project's checks and verify that its production build does
not include the panel.

## Manual migration

For a setup the command cannot recognize:

1. Replace `iso-iterate` with `isotone@0.4.0` in the same dependency section and
   run your package manager's install command.
2. Change package imports such as `iso-iterate/vite` to `isotone/vite`; keep
   exported names such as `iteration`, `IterationPanel`, and `mountIteration`.
3. Change CLI commands to `isotone`, standalone script URLs to `/isotone.js`, and
   environment variables to `ISOTONE_UPDATE_CHECK` and `ISOTONE_VARIANT`.
4. Move `.iso-iterate/` to `.isotone/` and update custom paths and ignore rules.
   Keep `.iteration-feedback.json` and any custom notes filename unchanged.
5. Update the project's agent instructions, restart, and check the integration.

If variant override files import the old package, prefer the migration command:
it also updates the corresponding stored base snapshots. A manual import-only
edit can make those variants appear stale; review and sync them before promotion.

Do not run both versions of the panel at once or delete the old package's data
to fix a migration problem. Restore your backup if needed and compare the
printed plan with your custom setup.

## Browser data

On the same browser origin, Isotone carries over the previous default storage
keys for offline notes, drafts, and knob selections. Notes merge by ID; current
Isotone entries win a collision. Current drafts and knob values also take
precedence. An old entry is removed only after the migrated value has been
written and read back successfully. Custom storage keys stay unchanged.

Keep the same browser profile and development URL until pending notes have
reached the project's notes file. A different port, host, or protocol has separate
browser storage; neither the CLI migration nor a package update can read it.

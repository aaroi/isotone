# Move a project to Isotone

For the few projects using `iso-iterate`, make the rename in each project with
its coding agent. The package and CLI are now `isotone`; the exported API names,
`.iteration-feedback.json`, and `/api/iteration/*` stay the same.

1. Stop the development server. Save your current work and back up ignored
   `.iso-iterate/` data and the notes file.
2. Replace the `iso-iterate` dependency with `isotone` in the same dependency
   section. Run the project's package manager so it updates its lockfile.
3. Change package imports (for example, `iso-iterate/vite` to `isotone/vite`),
   CLI commands, standalone script URLs (`/isotone.js`), environment variables
   (`ISOTONE_UPDATE_CHECK` and `ISOTONE_VARIANT`), and agent instructions.
   Keep API names such as `iteration`, `IterationPanel`, and `mountIteration`.
4. Move the entire `.iso-iterate/` directory to `.isotone/`, including
   `knobs.json`, `active.json`, and any local variants. Update ignore rules,
   including a `.git/info/exclude` entry for `.isotone/active.json` if the
   old active file was ignored there. Check each variant preview
   before promotion: a stored base snapshot containing the old package import
   can appear stale after the rename. Recreate or sync that variant against the
   renamed source rather than promoting it blindly. Leave
   `.iteration-feedback.json` and custom notes filenames unchanged.
5. Review the diff, run the project's checks, restart its development server,
   and confirm the panel, existing notes, and variants. Keep the panel and
   endpoints out of production builds.

On the same browser origin, Isotone carries forward the previous default
storage keys for offline notes, drafts, and knob selections. A different host,
port, or browser profile has separate storage. Custom keys stay unchanged.

Use `isotone@0.4.1` or newer. The older 0.4.0 package includes a one-time
`migrate` command but also has note-saving bugs fixed in 0.4.1; use this guide
for the work repositories. Existing `iso-iterate` versions remain installable.

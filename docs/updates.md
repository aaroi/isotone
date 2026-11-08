# Updates

Your project controls its installed version. Isotone checks for a newer release
in the background and lets you hand the upgrade to your coding agent, or copy the
exact command; it never installs packages, runs that command, or changes a
manifest or lockfile itself.

The Vite plugin and standalone server check the public npm `latest` tag at most
once per day while their per-user cache (`~/.cache/isotone`, or `$XDG_CACHE_HOME/isotone`) is retained. Checks take at
most five seconds, do not delay server startup, and fail quietly offline. Failed
attempts are cached too. CI and tests skip automatic checks. The registry request
contains the public package name; it sends no notes, routes, project paths,
source files, installed-version telemetry or credentials.

## In the panel

When a newer release is out, a quiet line next to the pill reads "Isotone 1.2.0
is available". It opens a small dialog: the versions from → to, and **Ask agent
to update**. Below it, **Copy prompt** copies a ready-to-paste request for an
agent that is not reading notes, and **Command** shows the raw upgrade command
and the directory to run it in.

**Ask agent to update** files an update note. It sits in the Feedback list with
the other notes, on every page, tagged "Update", and reaches your agent through
`npx isotone --json` like any other note. It concerns the whole project, so it is
also listed for every route (`npx isotone <route> --json`). The dialog then reads "Update
requested". Deleting the note cancels the request.

The dev server builds the note from its own update check: the versions, the
upgrade command and the directory, and the note's text, "Update Isotone 1.1.3 →
1.2.0". The browser only asks for it, and the notes endpoint refuses an update
request or an edit to an update note, so a page cannot put a command in front of
your agent. At most one update note is open; a newer release updates it.

Because the notes file is a plain file in the project, every reader checks the
request again before showing it, and drops it if anything is off:

- `update.to` is a strict SemVer version (`1.2.0`, `1.2.0-rc.1`, no build
  metadata);
- `update.command` is exactly the command `check-update` builds for
  `update.manager` and that version (the three forms are in the
  [agent guide](agent-guide.md#update-notes));
- `update.cwd` is an existing directory inside the notes file's project (the
  Git checkout that holds it, or its directory outside Git), after symlinks.

A dropped request leaves an ordinary note, which an agent treats as context.

The note carries a structured `update` field next to its text:

```json
{
  "feedback": "Update Isotone 1.1.3 → 1.2.0",
  "update": {
    "from": "1.1.3",
    "to": "1.2.0",
    "command": "pnpm add -D --exact isotone@1.2.0",
    "cwd": "/path/to/app",
    "manager": "pnpm",
    "changelog": "https://github.com/aaroi/isotone/blob/v1.2.0/CHANGELOG.md"
  },
  "updateHint": "An update note is the user's request to upgrade Isotone. …",
  "doneCommand": "npx isotone --done <id>"
}
```

The [agent guide](agent-guide.md#update-notes) says how the agent carries it out.

The button needs a notes endpoint and a command Isotone can name. When it
cannot name one (Bun, competing lockfiles, an optional or peer dependency, or
the Isotone source checkout), the dialog explains why instead.

## Update notes without asking

```ts
isotone({ checkForUpdates: 'note' });
```

```sh
npx isotone serve --update-note
```

With `checkForUpdates: 'note'` (`serveIsotone` takes the same value), the dev
server files the update note by itself the first time it sees a new version,
once per version for each notes file. If you don't want that version, delete the
note; it is not filed again until a newer release. The versions already offered
are remembered in the same per-user cache directory as the daily check. The
default stays as it is: a notice, with the button.

## Checking and upgrading

Check explicitly from the project directory:

```sh
npx isotone check-update
npx isotone check-update --json
```

This compares the running CLI version (use the project's own, not
`npx isotone@latest`) with npm's `latest` tag, bypassing the daily cache. It
exits 0 when the check succeeds, update or not, and 1 when it cannot check.

It suggests a command pinned to the version it found, such as
`pnpm add -D --exact isotone@1.2.0`, for the project's `packageManager` or
lockfile and the manifest that declares Isotone, keeping a production
dependency a production one. Pass `--manager npm|pnpm|yarn` when competing
lockfiles make that ambiguous; Bun, optional and peer dependencies need a manual
upgrade, and a Yarn workspace root needs the Yarn version in `packageManager`.
Run it from the displayed directory, restart the dev server, check the app, and
commit the manifest and lockfile together. The lookup reads public npm and never
your registry credentials.

## Turn off automatic checks

Vite:

```ts
isotone({ checkForUpdates: false });
```

Standalone:

```sh
npx isotone serve --no-update-check
```

`serveIsotone` also accepts `checkForUpdates: false`. Turning checks off also
turns off update notes. Set
`ISOTONE_UPDATE_CHECK=0` to disable automatic checks for either adapter.
The explicit `check-update` command remains available. Manually mounted panels
only show update information when given an `updateEndpoint` supplied by a local
server; they do not contact npm from the browser. GET on that endpoint returns
the cached check, and POST files the update note.

## Why nothing installs by itself

There is deliberately no mode that installs updates silently: a compromised or
broken release would land in every project unreviewed, one developer's dev
server would rewrite the lockfile for the whole team, and a dev server would
restart mid-work. An update note keeps a person in the loop at the cost of one
click, and the agent's diff can be reviewed.

A lockfile pins the installed version: `npm ci` and publishing a new release
change nothing, and `npm update` stays within the declared range (`^1.0.0`
stays below `2.0.0`). Only an explicit install of a new version changes it. An
installed version ahead of the `latest` tag is reported as ahead, never
downgraded. Existing installations keep working offline; there is no remotely
enforced minimum version.

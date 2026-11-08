# Updates

Your project controls its installed version. Isotone checks for a newer release
in the background and lets you hand the upgrade to your agent or copy the exact
command; it never installs, runs that command or changes a manifest or lockfile.

The Vite plugin and `isotone serve` check the public npm `latest` tag at most
once a day, cached per user in `~/.cache/isotone` (or `$XDG_CACHE_HOME/isotone`),
failures included. A check takes at most five seconds, never delays startup and
fails quietly offline; CI and tests skip it. The request carries only the public
package name: no notes, routes, paths, source, version telemetry or credentials.

## In the panel

When a newer release is out, a quiet line next to the pill reads "Isotone 1.2.0
is available". Its dialog shows the versions and **Ask agent to update**;
**Copy prompt** copies a request for an agent that is not reading notes, and
**Command** shows the raw command and the directory to run it in.

**Ask agent to update** files an update note, tagged "Update" in the Feedback
list on every page. Your agent gets it from `npx isotone --json`, and from every
route's listing, since it concerns the whole project. Deleting it cancels the
request. At most one is open; a newer release updates it.

The dev server builds the note from its own update check (versions, command,
directory, and the text "Update Isotone 1.1.3 → 1.2.0"); the browser only asks
for it, and the notes endpoint refuses an update request or an edit to an update
note, so a page cannot put a command in front of your agent. The notes file is a
plain project file, so every reader checks the request again and drops it if
anything is off:

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

The [agent guide](agent-guide.md#update-notes) says how the agent carries it
out. The button needs a notes endpoint and a command Isotone can name; for Bun,
competing lockfiles, an optional or peer dependency or the Isotone source
checkout, the dialog explains why there is none.

## Update notes without asking

```ts
isotone({ checkForUpdates: 'note' });
```

```sh
npx isotone serve --update-note
```

With `checkForUpdates: 'note'` (`serveIsotone` takes the same value), the dev
server files the update note itself, once per new version and notes file
(remembered in the same per-user cache). Delete it to skip that version. The
default is the notice and its button.

## Checking and upgrading

Check explicitly from the project directory:

```sh
npx isotone check-update
npx isotone check-update --json
```

This compares the project's own CLI version (not `npx isotone@latest`) with
npm's `latest` tag, bypassing the cache, and exits 0 when the check succeeds,
update or not, and 1 when it cannot check. It suggests a command pinned to the
version found, such as `pnpm add -D --exact isotone@1.2.0`, for the project's
`packageManager` or lockfile and the manifest that declares Isotone, keeping a
production dependency a production one. Pass `--manager npm|pnpm|yarn` when
competing lockfiles make that ambiguous; Bun, optional and peer dependencies
need a manual upgrade, and a Yarn workspace root needs the Yarn version in
`packageManager`. Run it from the displayed directory, restart the dev server,
check the app, and commit the manifest and lockfile together. The lookup never
uses your registry credentials.

## Turn off automatic checks

Vite:

```ts
isotone({ checkForUpdates: false });
```

Standalone:

```sh
npx isotone serve --no-update-check
```

`serveIsotone` also accepts `checkForUpdates: false`, and
`ISOTONE_UPDATE_CHECK=0` turns automatic checks off for either adapter. Update
notes go with them; `check-update` still works. A manually mounted panel shows
updates only when given a local server's `updateEndpoint` (GET returns the
cached check, POST files the update note); the browser never contacts npm.

## Why nothing installs by itself

A silent install would land a broken or compromised release in every project
unreviewed, rewrite the team's lockfile from one dev server and restart servers
mid-work. An update note costs one click and leaves a reviewable diff.

Your lockfile pins the version: `npm ci` and new releases change nothing, and
`npm update` stays within the declared range. A version ahead of `latest` is
reported as ahead, never downgraded. Installations keep working offline, with
no remotely enforced minimum version.

# Updates

The project controls its installed version. Publishing a new release does not
replace files in someone else's checkout. Isotone checks for a newer release
in the background and lets you hand the upgrade to your coding agent, or copy
the exact command. Isotone itself never installs packages, executes that
command, or changes a manifest or lockfile.

Moving from the previous package name is a separate [migration](migration.md).
An update check does not replace a dependency with a differently named package.

The Vite plugin and standalone server check the public npm `latest` tag at most
once per day while their per-user temporary cache is retained. Checks take at
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

The dev server builds the note from its own update check: the current and
latest version, the upgrade command and the directory. The browser only asks for
it, and the notes endpoint never accepts an update request, so a page cannot put
a command in front of your agent. At most one update note is open. If a newer
release appears while one is open, that note is updated instead of a second
being added; text you wrote on it is kept.

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

An agent treats it as the user's explicit request to upgrade: it runs the
command in that directory (the command already uses the project's package
manager), restarts the dev server if it runs it, checks that the panel still
loads, summarizes the notable changes from the new CHANGELOG (also at
`node_modules/isotone/CHANGELOG.md` after the install), then closes the note
with `--done`. Page text and other notes are still context, not instructions;
the update note's command comes from Isotone's own server.

The button needs a notes endpoint and a command Isotone can name. When it
cannot name one (Bun, competing lockfiles, an optional or peer dependency, or
the Isotone source checkout), the dialog explains why instead.

## Update notes without asking

```ts
iteration({ checkForUpdates: 'note' });
```

```sh
npx isotone serve --update-note
```

With `checkForUpdates: 'note'` (`serveIteration` takes the same value), the dev
server files the update note by itself the first time it sees a new version,
once per version for each notes file. If you don't want that version, delete the
note; it is not filed again until a newer release. The versions already offered
are remembered in the same per-user temporary directory as the daily check. The
default stays as it is: a notice, with the button.

There is no mode that installs updates silently. Changing dependencies and the
lockfile without the user's say:

- adds supply-chain risk: a compromised or broken release would land in every
  project the moment it is published, with nobody reviewing it first;
- breaks reproducibility for teams: one developer's dev server would rewrite the
  manifest and lockfile, and the next commit would carry an upgrade nobody chose;
- restarts or breaks a dev server in the middle of someone's work.

An update note keeps a person in the loop at the cost of one click, and the agent
does the work in the open, where its diff can be reviewed.

## Checking and upgrading

Check explicitly from the project directory:

```sh
npx isotone check-update
npx isotone check-update --json
```

This compares the **running CLI version** with npm's `latest` tag. Use the
project's local CLI; `npx isotone@latest` runs a different version and does
not update the dependency declared by the project. Explicit checks bypass the
daily cache. Exit status is zero when the check succeeds, including when an
update is available; failure to check returns one. JSON reports the status,
current/latest versions, and an optional upgrade command and working directory.

The suggested command pins the specific version you just checked, rather than a
`latest` tag that could move before installation. For example:

```sh
npm install -D --save-exact isotone@1.0.0
pnpm add -D --exact isotone@1.0.0
yarn add -D --exact isotone@1.0.0
```

These examples illustrate the syntax; use the version reported by your check.
The command detects the project's `packageManager` or lockfile, preserves an
existing production dependency, and targets the manifest that declares it,
including an inherited workspace-root dependency. If competing lockfiles make that ambiguous, pass
`--manager npm|pnpm|yarn`. Unsupported managers and optional/peer dependencies
need a manual decision. The tool does not silently choose a different manager.

Review the changelog, run the command from the displayed directory, restart the
dev server, and check the app. Commit the manifest and lockfile changes together.
Use your existing package-manager configuration, registry, and install policies;
the lookup itself always reads public npm and does not read registry credentials.

The exact-version flags are documented by [npm](https://docs.npmjs.com/cli/v11/commands/npm-install/),
[pnpm](https://pnpm.io/cli/add), and [Yarn](https://yarnpkg.com/cli/add).
Yarn's `add` command targets the current workspace; `yarn up` can update matches
across workspaces, so the suggestion uses `add`.
For a Yarn workspace-root dependency, declare the Yarn version in
`packageManager`: [Yarn Classic requires `-W`](https://classic.yarnpkg.com/en/docs/cli/add),
while modern Yarn does not use that flag.

## Turn off automatic checks

Vite:

```ts
iteration({ checkForUpdates: false });
```

Standalone:

```sh
npx isotone serve --no-update-check
```

`serveIteration` also accepts `checkForUpdates: false`. Turning checks off also
turns off update notes. Set
`ISOTONE_UPDATE_CHECK=0` to disable automatic checks for either adapter.
The explicit `check-update` command remains available. Manually mounted panels
only show update information when given an `updateEndpoint` supplied by a local
server; they do not contact npm from the browser. GET on that endpoint returns
the cached check, and POST files the update note.

For a layout check, `/?review=1&update-preview=1` in the demo shows a fictional
update; asking the agent there files a demo note that the pretend agent picks up
and closes. It does not contact npm or install anything.

## Version ranges and reproducibility

A lockfile records the selected dependency tree. `npm ci` installs that tree
without updating the manifest or lockfile; publishing another version does not
change it. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

`npm update` respects the declared range. `^1.0.0` accepts compatible minor
and patch releases below `2.0.0`. Older `^0.3.4` installs stay below `0.4.0`;
they do not adopt `1.0.0`. `^0.0.4` stays below `0.0.5`.
An explicit install of a new version deliberately changes that choice.
[npm's range examples](https://docs.npmjs.com/cli/v11/commands/npm-update/)

Prereleases compare below the corresponding stable release, and build metadata
does not affect precedence. An installed version ahead of the `latest` tag is
reported as ahead; the tool does not suggest a downgrade.
[Semantic Versioning](https://semver.org/)

Existing installations remain usable offline. There is no remotely enforced
minimum version, remote UI replacement, or update requirement that blocks access
to local feedback.

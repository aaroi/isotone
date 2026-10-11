# Updates

The project controls its installed version. Publishing a new release does not
replace files in someone else's checkout. Isotone checks for a newer release
in the background and offers the exact command to review and run. It never
installs packages, executes that command, or changes a manifest or lockfile.

Moving from the previous package name is a separate [migration](migration.md).
An update check does not replace a dependency with a differently named package.

The Vite plugin and standalone server check the public npm `latest` tag at most
once per day while their per-user temporary cache is retained. Checks take at
most five seconds, do not delay server startup, and fail quietly offline. Failed
attempts are cached too. CI and tests skip automatic checks. The registry request
contains the public package name; it sends no notes, routes, project paths,
source files, installed-version telemetry or credentials.

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
npm install -D --save-exact isotone@0.4.2
pnpm add -D --exact isotone@0.4.2
yarn add -D --exact isotone@0.4.2
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

`serveIteration` also accepts `checkForUpdates: false`. Set
`ISOTONE_UPDATE_CHECK=0` to disable automatic checks for either adapter.
The explicit `check-update` command remains available. Manually mounted panels
only show update information when given an `updateEndpoint` supplied by a local
server; they do not contact npm from the browser.

## Version ranges and reproducibility

A lockfile records the selected dependency tree. `npm ci` installs that tree
without updating the manifest or lockfile; publishing another version does not
change it. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

`npm update` respects the declared range. Before 1.0, `^0.3.4` accepts patch
releases below `0.4.0`; it does not adopt `0.4.0`. `^0.0.4` stays below `0.0.5`.
An explicit install of a new version deliberately changes that choice.
[npm's range examples](https://docs.npmjs.com/cli/v11/commands/npm-update/)

Prereleases compare below the corresponding stable release, and build metadata
does not affect precedence. An installed version ahead of the `latest` tag is
reported as ahead; the tool does not suggest a downgrade.
[Semantic Versioning](https://semver.org/)

Existing installations remain usable offline. There is no remotely enforced
minimum version, remote UI replacement, or update requirement that blocks access
to local feedback.

# Releasing

Every change merged into `main` is published to npm. The `publish.yml`
workflow prepares a version, checks the resulting main commit, publishes its
tested archive through npm's trusted publisher, then creates the matching
GitHub Release. No npm login or manual GitHub Release is needed.

If a merged change already raises `package.json` above the published version,
the workflow uses that version (for example, `1.0.0`). Otherwise it increments
the published patch version and commits the version and changelog to `main`.
The bot commit dispatches the same workflow at the new commit so npm provenance
points to the exact source used for the archive. A failed build or publication
stops the release; fix the issue and rerun `Publish main` on `main`.

## Keep private content out

Keep demo content fictional, and local feedback and scratch files out of Git and
npm; the archive's source maps contain source text. Keep the MIT notice and the
[third-party license notices](third-party-notices.md).

## Before merging

1. Record notable changes under `Unreleased` in the changelog. If Unreleased
   adds a feature or changes what users or agents type, read or import, raise
   the minor version in `package.json` in that PR. Breaking changes ship as a
   minor too, with what users must do under `### What you need to know`; a
   major version is a deliberate maintainer decision, never required by a
   change set. Routine fixes get the automatic patch. Preserve the lockfile's
   resolved versions unless the release intentionally changes dependencies.
   `pnpm check:release` (the `release guard` check, and the first step of
   `Publish main`) enforces the minor: only `### Fixed` and `### Security`
   headings (or `- fix:` notes) under Unreleased may ship as a patch. Any other
   heading, such as `### What you need to know`, `### Changed` or `### Removed`,
   or a `- feat:` or `- change:` note, fails it until `package.json` is above
   the published minor.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm check:package` and
   `pnpm smoke` (which confirms a production Vite build contains no panel).
   Inspect both themes in the demo.
3. Inspect `npm pack --dry-run --json`. Expect the built entries, declarations,
   source maps, documentation and licenses. Check that the README preview image
   exists and uses fictional content.
4. Try the PR's demo preview (Vercel links it in a PR comment),
   including on a phone, and confirm the demo shows any user-facing change.
5. Merge the reviewed PR. Monitor `Publish main` until the npm version and
   GitHub Release appear. A green PR check alone does not prove publication.
   Vercel then deploys [isotone.vercel.app](https://isotone.vercel.app) from
   `main`.

`Publish main` runs in four jobs. `check` builds and tests the prepared main
commit, runs the packed-package check, then packs and uploads the archive.
`smoke` downloads that archive and installs it into fresh Vite 5, 6, 7 and 8
apps (React 18 and 19); it runs after packing so the third-party code it
installs cannot change what publishes, and `scripts/smoke.mjs` only installs
versions published at least seven days earlier. `publish` checks the archive's
SHA-256 against the one `check` recorded and publishes it with provenance; it is
the only job with OIDC permission, and it installs nothing and runs no project
scripts. `release` tags the commit and creates the GitHub Release.

CI builds and tests on Node 22, 24 and 26 (and on Windows, not yet required,
where POSIX-only tests skip), runs types, lint, knip and the coverage floors
once, runs the packed-package check (with its size budgets) on every leg, the
release guard, actionlint and zizmor on the workflows, and the same packed
smoke test. A weekly `Mutation testing` run fails when Stryker's score drops
below the `break` threshold in `stryker.config.json`.

## GitHub settings outside the repository

No commit can make these account-side settings. Do them once, in order.

1. **Open a pull request and get it green** so the check names below exist
   (they appear in the ruleset picker only after one run).
2. **Ruleset on `main`** (Settings → Rules → Rulesets): `main`, Active, the
   default branch, with Restrict deletions and Block force pushes; bypass:
   Repository admin. This is applied. Requiring pull requests or status checks
   would also stop the `prepare` job's version commit (`git push origin
   HEAD:main`), and a personal repository cannot list the github-actions app as
   a bypass actor, so those wait until the release stops committing to `main`
   or pushes with a deploy key that the ruleset can bypass. The checks to require
   then are every `check (…)` leg (Ubuntu Node 22, 24 and 26, Windows Node 24),
   `packed smoke (oldest and newest Vite and React)`, `release guard` and
   `workflow lint`, with branches required to be up to date.
3. **Tag ruleset** `release tags` on `v*`: Restrict deletions, Restrict updates,
   Block force pushes; bypass: Repository admin. This is applied; creating a tag
   is not restricted, so the `release` job still tags each version.
4. **`npm` environment** (Settings → Environments → New environment → `npm`):
   deployment branches and tags → Selected branches → `main`; optionally add
   yourself as a required reviewer to approve each publish. In the same change,
   set Environment to `npm` on the trusted publisher in npm (isotone → Settings
   → Trusted publishing) and add `environment: npm` under `runs-on` in the
   `publish` job of `.github/workflows/publish.yml`. A mismatch between the two
   makes `npm publish` fail with E404.
5. **Actions** (Settings → Actions → General), optional: workflow permissions
   read-only by default (the workflows declare what they need), and allow only
   actions from GitHub, verified creators and `pnpm/action-setup`.
6. **Code security**: enable Dependabot alerts and security updates;
   `.github/dependabot.yml` only covers version updates.

## Demo deployment outside the repository

The hosted demo deploys through the Vercel project's Git connection to this
repository; npm publication does not depend on it.
[The development guide](development.md#hosted-demo) covers previews and
preview protection.

## npm setup outside the repository

In the package's npm settings, verify the trusted publisher names the intended
GitHub owner, repository and **`publish.yml`**. Allow direct `npm publish`; new
configurations can default to staged publishing only. The trusted publisher's
environment must match the `publish` job's `environment:` (none until the `npm`
environment above is set up). An existing working publisher does not need
replacing. A new configuration must complete its
first publish within two days. The workflow uses GitHub-hosted runners, Node 24,
and checks for npm 11.5.1 or newer. No long-lived publish token is needed.
See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

Provenance needs the repository and package to be public, and `package.json`'s
repository URL to match the publishing repository. Local checks cannot verify
account-side configuration.

After publishing, verify the new version, README image, exports and provenance
on npm, then try the documented quick start in a clean project.

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

1. Record notable changes under `Unreleased` in the changelog. If they add a
   feature or change what users or agents type, read or import, raise the minor
   in `package.json` in that PR (the major for a break that needs user action);
   routine fixes get the automatic patch. Keep the lockfile's resolved versions
   unless the release means to change dependencies. `pnpm check:release` (the
   `release guard` check, and the first step of `Publish main`) enforces the
   minor: only `### Fixed` and `### Security` headings (or `- fix:` notes) may
   ship as a patch, and any other heading or a `- feat:` or `- change:` note
   fails until `package.json` is above the published minor. The major stays
   your call.
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
   Vercel then deploys the demo from `main` through its own Git connection,
   independent of npm ([previews](development.md#hosted-demo)).

The release check job builds and tests the prepared main commit, runs
`pnpm smoke` and creates an archive; a separate job, the only one with OIDC
permission, downloads and publishes it with provenance without installing
dependencies or running project scripts. CI tests on Node 22, 24 and 26 (and on
Windows, not yet required, where POSIX-only tests skip), runs types, lint, knip
and the coverage floors once, `pnpm check:package` on every leg, the release
guard, actionlint and zizmor on the workflows, and `pnpm smoke`.

## GitHub settings outside the repository

These are account-side settings no commit can make. Do them once.

1. **Ruleset on `main`** (Settings → Rules → Rulesets → New branch ruleset):
   name `main`, Enforcement Active, target the default branch. Turn on Restrict
   deletions, Block force pushes, Require a pull request before merging (0
   approvals is fine for a solo maintainer), and Require status checks to pass
   with `check (ubuntu-latest, Node 22)`, `check (ubuntu-latest, Node 24)`,
   `check (ubuntu-latest, Node 26)`, `release guard`, `workflow lint` and
   `packed smoke (oldest and newest Vite and React)`; they appear in the picker
   after one run on a pull request. Add `check (windows-latest, Node 24)` once it
   is green and its `continue-on-error` line is removed from `ci.yml`. Tick
   Require branches to be up to date. Add Repository admin to the bypass list,
   and the github-actions app only if `Publish main` then fails at
   `git push origin HEAD:main` with a rule violation (the `prepare` job pushes
   the version commit directly).
2. **Release tags**: a tag ruleset named `release tags`, targeting `v*`, with
   Restrict deletions, Restrict updates and Block force pushes. Bypass:
   github-actions (the `release` job creates the tag) and Repository admin.
3. **`npm` environment** (Settings → Environments → New environment → `npm`):
   deployment branches and tags → Selected branches → `main`. Optionally add
   yourself as a required reviewer to approve each publish. In the same change,
   set Environment to `npm` on the trusted publisher in npm (isotone → Settings
   → Trusted publishing) and add `environment: npm` under `runs-on` in the
   `publish` job of `.github/workflows/publish.yml`. Do both together: a
   mismatch makes `npm publish` fail with E404.
4. Optionally, in Settings → Actions → General, make workflow permissions
   read-only by default (the workflows declare what they need) and allow only
   actions from GitHub, verified creators and `pnpm/action-setup`.
5. In Settings → Code security, enable Dependabot alerts and security updates;
   `.github/dependabot.yml` only covers version updates.

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

Provenance needs a public repository and package, and `package.json`'s
repository URL must match the publishing repository; local checks cannot verify
any of this.

After publishing, verify the new version, README image, exports and provenance
on npm, then try the documented quick start in a clean project.

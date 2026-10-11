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

## Before making the repository public

Review the tracked tree and Git history, including deleted files, for private
notes, credentials, internal URLs, screenshots and personal machine paths.
Check the actual npm archive too: source maps contain source text. Keep demo
content fictional and keep local feedback and scratch files out of Git and npm.
A clean current tree does not prove that old commits are suitable for publication.

Keep the MIT copyright notice and [third-party license notices](third-party-notices.md). Public author
attribution and the intended repository/package links are deliberate; do not
remove them as part of privacy cleanup. If history needs cleanup, agree on that
separately before changing it or opening the repository.

## Before merging

1. Record notable changes under `Unreleased` in the changelog. Set an explicit
   package version in the PR only for a major or minor release; routine changes
   receive an automatic patch version. Preserve the lockfile's resolved versions
   unless the release intentionally changes dependencies.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm check:package`.
   Inspect both themes in the demo and confirm a production Vite build contains
   no panel. Manual integrations must also guard their endpoints in production.
3. Inspect `npm pack --dry-run --json`. Expect the built entries, declarations,
   source maps, documentation and licenses. Check that the README preview image
   exists and uses fictional content.
4. Merge the reviewed PR. Monitor `Publish main` until the npm version and
   GitHub Release appear. A green PR check alone does not prove publication.

The release check job builds and tests the prepared main commit, then creates an
archive. A separate job downloads that archive and publishes it with provenance.
Only that job has OIDC permission; it does not install dependencies or run project
scripts. CI also checks the packed runtime on Node 20 and full development checks
on Node 22 and 24.

## npm setup outside the repository

In the package's npm settings, verify the trusted publisher names the intended
GitHub owner, repository and **`publish.yml`**. Allow direct `npm publish`; new
configurations can default to staged publishing only. This workflow has no GitHub
environment name, so the configured publisher must not require one. An existing
working publisher does not need replacing. A new configuration must complete its
first publish within two days. The workflow uses GitHub-hosted runners, Node 24,
and checks for npm 11.5.1 or newer. No long-lived publish token is needed.
See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

The intended repository and package must be public for provenance, and
`package.json`'s repository URL must match the publishing repository. Opening the
repository and changing npm settings are separate maintainer actions. The local
checks do not verify account-side configuration or prove that publication will
succeed. See [npm's provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).

After publishing, verify the new version, README image, exports and provenance
on npm, then try the documented quick start in a clean project.

## First release under the Isotone name

Renaming the GitHub repository does not rename an npm package or change existing
installs. npm requires publishing under the new name. Keep `iso-iterate`
available so its existing lockfiles remain installable; deprecate it only after
the new package and migration have been verified. See npm's
[rename guidance](https://docs.npmjs.com/unpublishing-packages-from-the-registry/)
and [deprecation guidance](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/).

Before tagging the first release, confirm that the publishing account can use
`isotone`. A registry 404 or an unpublished-package record does not establish
ownership or permission to publish. A successful local build establishes neither.
If npm does not offer settings for the new package yet, establish it using an
authenticated, maintainer-approved first publication before relying on its
trusted publisher. Do not create a release tag on the assumption that the old
package's publisher configuration applies to the new name.

Configure the new package's publisher for `aaroi/isotone` and `publish.yml`, and
verify its repository metadata. Then test both a clean install and the
[migration](migration.md) in a copy of an existing project. Only after those pass,
an authorized maintainer can set the old package's deprecation message:

```sh
npm deprecate iso-iterate "Renamed to isotone. Migration: https://github.com/aaroi/isotone/blob/main/docs/migration.md"
```

Deprecation displays guidance during installation; it does not migrate files,
change dependencies, or remove existing installations. Do not unpublish the old
package as part of the rename.

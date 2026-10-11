# Releasing

A push runs CI; it does not publish. Publishing a stable GitHub Release starts
`.github/workflows/publish.yml`. Its tag must be exactly `v` followed by the
version in `package.json`. Prereleases are skipped.

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

## Prepare a release

1. Update the package version and changelog. Preserve the lockfile's resolved
   versions unless the release intentionally changes dependencies.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm check:package`.
   Inspect both themes in the demo and confirm a production Vite build contains
   no panel. Manual integrations must also guard their endpoints in production.
3. Inspect `npm pack --dry-run --json`. Expect the built entries, declarations,
   source maps, documentation and licenses. Check that the README preview image
   exists and uses fictional content.
4. After approval to release, commit the reviewed changes and publish a GitHub
   Release at `v<version>`. Do not reuse a version already published to npm.

The release check job rebuilds and tests the tagged checkout, then creates an
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

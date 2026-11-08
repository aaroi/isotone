// @ts-check
// Fails when CHANGELOG.md's Unreleased section holds more than fixes while
// package.json's version is not above the published minor. Without it the
// release workflow would publish features or breaking changes as a patch.
//
//   node scripts/check-release.mjs [<published version>]
//
// With no argument it asks npm for the published version. Patch-level notes
// sit under `### Fixed` or `### Security` (or start with `- fix:`); any other
// heading under Unreleased, such as `### What you need to know`, `### Changed`
// or `### Removed`, or a bullet starting with `- feat:` or `- change:`, needs at
// least a minor version bump. docs/releasing.md documents the convention.
import { readFileSync } from 'node:fs';

import { npm } from './npm.mjs';

const PATCH_HEADINGS = new Set(['fixed', 'security']);

/** @param {string} value */
const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Expected a stable version, received ${JSON.stringify(value)}`);
  return match.slice(1).map(Number);
};

/** @param {string} changelog */
function unreleased(changelog) {
  const start = changelog.indexOf('\n## Unreleased\n');
  if (start === -1) throw new Error('CHANGELOG.md needs an Unreleased section');
  const body = changelog.slice(start + '\n## Unreleased\n'.length);
  const end = body.indexOf('\n## ');
  return end === -1 ? body : body.slice(0, end);
}

/** The reasons the Unreleased notes need a minor release, if any. @param {string} notes */
function featureLevel(notes) {
  const reasons = [];
  for (const line of notes.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] && !PATCH_HEADINGS.has(heading[1].toLowerCase())) reasons.push(`"### ${heading[1]}"`);
    const prefix = /^- (feat|change)\b/.exec(line);
    if (prefix) reasons.push(`a "- ${prefix[1]}" note`);
  }
  return [...new Set(reasons)];
}

const published = process.argv[2] ?? npm(['view', 'isotone', 'version']);
const [major = 0, minor = 0] = parseVersion(JSON.parse(readFileSync('package.json', 'utf8')).version);
const [publishedMajor = 0, publishedMinor = 0] = parseVersion(published);
const reasons = featureLevel(unreleased(readFileSync('CHANGELOG.md', 'utf8')));
const raised = major > publishedMajor || (major === publishedMajor && minor > publishedMinor);

if (reasons.length && !raised) {
  process.stderr.write(
    `CHANGELOG.md's Unreleased section has ${reasons.join(', ')}, which needs a minor or major release, ` +
      `but package.json's version is not above the published ${published.trim()}'s minor. ` +
      `Raise the version in package.json (docs/releasing.md, "Before merging").\n`,
  );
  process.exit(1);
}
process.stdout.write(
  reasons.length ? `Unreleased needs a minor release and package.json raises it.\n` : 'Unreleased holds only patch-level notes.\n',
);

// Fails when a change touches package.json's version without the maintainer's
// approval. Every merge into main ships as the next patch, whatever its
// changelog notes say; a minor or a major is the maintainer's deliberate
// choice, never something a change set requires or a contributor or agent
// decides.
//
//   node scripts/check-release.mjs [<base version>] [--minor-approved]
//
// The base version is the one in package.json where the change branched from
// main; with none given it is read from git. Comparing with main and not with
// npm keeps other pull requests passing while a version waits to be published.
// CI passes `--minor-approved` when the pull request carries the
// `minor-release` label (.github/workflows/ci.yml). docs/releasing.md
// documents the convention.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @param {string} value */
const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Expected a stable version, received ${JSON.stringify(value)}`);
  return match[0];
};

/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fromGit = () => JSON.parse(git(['show', `${git(['merge-base', 'HEAD', 'origin/main'])}:package.json`])).version;

const args = process.argv.slice(2);
const unknown = args.find((arg) => arg.startsWith('--') && arg !== '--minor-approved');
if (unknown) throw new Error(`Unknown option ${unknown}`);
const approved = args.includes('--minor-approved');
const base = parseVersion(args.find((arg) => !arg.startsWith('--')) ?? fromGit());
const version = parseVersion(JSON.parse(readFileSync('package.json', 'utf8')).version);

if (version !== base && !approved) {
  process.stderr.write(
    `package.json's version is ${version}, but main has ${base}. ` +
      `Every merge ships as the next patch, which the release workflow sets: leave the version as main has it. ` +
      `Only the maintainer decides a minor or major release, by raising the version and adding the "minor-release" ` +
      `label to the pull request (docs/releasing.md, "Before merging").\n`,
  );
  process.exit(1);
}
process.stdout.write(version === base ? 'Ships as the next patch.\n' : `The maintainer approved changing the version to ${version}.\n`);

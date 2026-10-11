import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const published = process.argv[2];
const parseVersion = (value) => {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value ?? '')) {
    throw new Error(`Expected a stable version, received ${JSON.stringify(value)}`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Version has an unsafe numeric part: ${value}`);
  }
  return parts;
};

const packageFile = 'package.json';
const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
const current = parseVersion(packageJson.version);
const latest = parseVersion(published);
const compare = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const matchingTag = execFileSync('git', ['tag', '--list', `v${packageJson.version}`], {
  encoding: 'utf8',
}).trim();
const hasCurrentTag = matchingTag === `v${packageJson.version}`;
const base = compare(current, latest) > 0 ? current : latest;
const target = !hasCurrentTag && compare(current, latest) > 0
  ? packageJson.version
  : `${base[0]}.${base[1]}.${base[2] + 1}`;

if (packageJson.version !== target) {
  packageJson.version = target;
  writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);
}

const changelogFile = 'CHANGELOG.md';
const changelog = readFileSync(changelogFile, 'utf8');
if (!changelog.startsWith('# Changelog\n\n## Unreleased\n')) {
  throw new Error('CHANGELOG.md needs an Unreleased section');
}

if (!changelog.includes(`\n## ${target}\n`)) {
  const nextHeading = changelog.indexOf('\n## ', '# Changelog\n\n## Unreleased\n'.length);
  const rest = nextHeading === -1 ? '' : changelog.slice(nextHeading + 1);
  const pending = changelog
    .slice('# Changelog\n\n## Unreleased\n'.length, nextHeading === -1 ? undefined : nextHeading)
    .trim();
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
  const notes = pending || `- ${subject}`;
  writeFileSync(changelogFile, `# Changelog\n\n## Unreleased\n\n## ${target}\n\n${notes}\n\n${rest}`);
}

process.stdout.write(`${target}\n`);

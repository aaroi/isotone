// Prepare an agent trial: pack this checkout and create three fresh fixture apps.
//
//   node scripts/trial/prepare.mjs <outDir>
//
// Builds and packs Isotone into <outDir> (path in <outDir>/tarball.txt), copies
// the Vite + React, Next.js App Router and plain HTML fixtures from
// scripts/trial/fixtures, installs their own dependencies from the registry
// (network required) and commits each as a fresh Git repository. Isotone itself
// is not installed: that is the agent's job. See scripts/trial/README.md.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { npm } from '../npm.mjs';
import { FIXTURES, fixturesDir, git, must, repoRoot } from './lib.mjs';

const [outArg] = process.argv.slice(2);
if (!outArg) {
  console.error('Usage: node scripts/trial/prepare.mjs <outDir>');
  process.exit(1);
}
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const taken = FIXTURES.filter((name) => existsSync(join(outDir, name)));
if (taken.length) {
  console.error(`${outDir} already has ${taken.join(', ')}; pick a new directory so every trial starts fresh.`);
  process.exit(1);
}

console.log('Building and packing Isotone from', repoRoot);
must('pnpm', ['build'], { cwd: repoRoot });
const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', outDir], { cwd: repoRoot }));
const tarball = join(outDir, packed.filename);
writeFileSync(join(outDir, 'tarball.txt'), `${tarball}\n`);

const apps = [];
for (const name of FIXTURES) {
  const app = join(outDir, name);
  console.log(`\n${name}: copying and installing its dependencies`);
  cpSync(join(fixturesDir, name), app, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  if (manifest.dependencies || manifest.devDependencies) {
    npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: app, stdio: 'inherit' });
  }
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'Fixture app'],
  ]) {
    const result = git(app, args);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${app}: ${result.stderr}`);
  }
  apps.push(app);
}

console.log(`\nTarball: ${tarball}`);
console.log('Fixtures:');
for (const app of apps) console.log(`  ${app}`);
console.log(`\nNext: run an agent in each fixture with the setup prompt in scripts/trial/README.md, then`);
console.log('  node scripts/trial/score.mjs <fixture> setup --transcript <file.jsonl> --table <results.md>');

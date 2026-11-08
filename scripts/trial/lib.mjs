// Helpers shared by the agent-trial scripts (scripts/trial/*.mjs). Not shipped.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const fixturesDir = join(repoRoot, 'scripts', 'trial', 'fixtures');

/** The three fixture apps, by directory name under scripts/trial/fixtures. */
export const FIXTURES = ['vite-react', 'next-app', 'plain-html'];

/** Run a command and return { status, stdout, stderr }; never throws on a non-zero exit. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) return { status: 127, stdout: '', stderr: String(result.error.message) };
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Run a command, inheriting stdio, and throw if it fails. */
export function must(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

/** Git with a fixed identity, so commits work on a machine without one. */
export function git(cwd, args) {
  return run('git', ['-c', 'user.name=Isotone trial', '-c', 'user.email=trial@example.invalid', ...args], { cwd });
}

/** Every file under `dir`, recursively, skipping directories named in `skip`. */
export function walk(dir, skip = new Set()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, skip) : [path];
  });
}

/** Where the trial keeps its own bookkeeping in a fixture: inside .git, so the agent never sees it in the tree. */
export function trialStateFile(fixtureDir) {
  return join(fixtureDir, '.git', 'isotone-trial.json');
}

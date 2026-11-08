/**
 * When a project's files last changed, for `--done`: closing a note while no
 * file changed since it was written (or since `--working`) means the fix never
 * landed, the usual cause being an edit that failed earlier in a chained
 * command. In a Git work tree only changed, untracked and newly committed
 * files count, so a dev server's own output stays out; elsewhere a bounded
 * walk skips dependencies, build output and dot-directories.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Past this many candidate files the answer is "changed": a guard must never block on a guess. */
const MAX_FILES = 20_000;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

/**
 * The latest modification time, in ms, of a file under `root` that `ignore`
 * does not exclude; 0 when there is none, Infinity when it cannot tell.
 */
export function latestChange(root: string, ignore: (file: string) => boolean): number {
  const top = git(root, ['rev-parse', '--show-toplevel'])?.trim();
  if (top) {
    const listed = git(top, ['ls-files', '-z', '--modified', '--others', '--exclude-standard']);
    if (listed !== null) {
      const head = Number(git(top, ['log', '-1', '--format=%ct'])?.trim()) * 1000;
      const files = [...new Set(listed.split('\0').filter(Boolean))];
      if (files.length > MAX_FILES) return Number.POSITIVE_INFINITY;
      let latest = Number.isFinite(head) ? head : 0;
      for (const file of files) {
        const abs = join(top, file);
        if (ignore(abs)) continue;
        // A deleted file is a change too, of unknown age.
        latest = Math.max(latest, mtime(abs) ?? Number.POSITIVE_INFINITY);
      }
      return latest;
    }
  }
  return walk(root, ignore);
}

function walk(root: string, ignore: (file: string) => boolean): number {
  let latest = 0;
  let seen = 0;
  const queue = [root];
  for (let dir = queue.pop(); dir !== undefined; dir = queue.pop()) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > MAX_FILES) return Number.POSITIVE_INFINITY;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && (!entry.name.startsWith('.') || entry.name === '.isotone')) queue.push(abs);
      } else if (entry.isFile() && !ignore(abs)) latest = Math.max(latest, mtime(abs) ?? 0);
    }
  }
  return latest;
}

function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

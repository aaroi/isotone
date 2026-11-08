/**
 * Whether a project's files changed, for `--done`: closing a note while no
 * file changed means the fix never landed, the usual cause being an edit that
 * failed earlier in a chained command.
 *
 * In a Git work tree, `--working` records a {@link snapshot}: HEAD plus every
 * staged, unstaged, untracked and deleted path with a hash of its contents.
 * `--done` compares it with a fresh one, so a staged edit, a revert and a
 * deleted untracked file all count. Without a snapshot (no `--working`, or no
 * Git) {@link latestChange} falls back to modification times.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Past this many candidate files the answer is "changed": a guard must never block on a guess. */
const MAX_FILES = 20_000;
/** A file larger than this is fingerprinted by size and time instead of its contents. */
const MAX_HASHED_BYTES = 4 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

/**
 * A short fingerprint of the Git work tree that contains `root`, leaving out
 * the paths `ignore` excludes; null outside Git or past {@link MAX_FILES}.
 */
export function snapshot(root: string, ignore: (file: string) => boolean): string | null {
  const top = gitTop(root);
  if (!top) return null;
  const status = git(top, ['status', '--porcelain=v2', '-z', '--branch', '--no-renames', '--untracked-files=all']);
  if (status === null) return null;
  const entries = status.split('\0').filter(Boolean);
  if (entries.length > MAX_FILES) return null;
  const hash = createHash('sha256');
  for (const entry of entries.sort()) {
    if (entry.startsWith('# ')) {
      // Of the headers only HEAD matters: a commit is a change.
      if (entry.startsWith('# branch.oid ')) hash.update(`${entry}\n`);
      continue;
    }
    const abs = join(top, statusPath(entry));
    if (ignore(abs)) continue;
    // The entry carries the index's hash, so staging an edit changes it too.
    hash.update(`${entry}\0${contents(abs)}\n`);
  }
  return hash.digest('hex').slice(0, 32);
}

/** The path in a `git status --porcelain=v2 --no-renames` entry: after 8 fields, 10 for a conflict, 1 untracked. */
function statusPath(entry: string): string {
  const skip = entry[0] === '1' ? 8 : entry[0] === 'u' ? 10 : 1;
  let at = 0;
  for (let i = 0; i < skip; i++) at = entry.indexOf(' ', at) + 1;
  return entry.slice(at);
}

function contents(file: string): string {
  try {
    const stats = statSync(file);
    if (!stats.isFile()) return 'other';
    if (stats.size > MAX_HASHED_BYTES) return `${stats.size}:${stats.mtimeMs}`;
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return 'gone';
  }
}

/**
 * The latest modification time, in ms, of a file under `root` that `ignore`
 * does not exclude; 0 when there is none, Infinity when it cannot tell. In
 * Git every tracked and untracked file counts (a restored file is new too),
 * plus the HEAD commit time; Git-ignored files never do. Elsewhere a bounded
 * walk skips dependencies, build output and dot-directories.
 */
export function latestChange(root: string, ignore: (file: string) => boolean): number {
  const top = gitTop(root);
  const listed = top ? git(top, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) : null;
  if (!top || listed === null) return walk(root, ignore);
  const files = [...new Set(listed.split('\0').filter(Boolean))];
  if (files.length > MAX_FILES) return Number.POSITIVE_INFINITY;
  const head = Number(git(top, ['log', '-1', '--format=%ct'])?.trim()) * 1000;
  let latest = Number.isFinite(head) ? head : 0;
  for (const file of files) {
    const abs = join(top, file);
    if (ignore(abs)) continue;
    // A deleted file is a change too, of unknown age.
    latest = Math.max(latest, mtime(abs) ?? Number.POSITIVE_INFINITY);
  }
  return latest;
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

export function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function gitTop(root: string): string | null {
  return git(root, ['rev-parse', '--show-toplevel'])?.trim() || null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

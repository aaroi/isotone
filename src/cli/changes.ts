/**
 * Whether a project's files changed, for `--done`: closing a note while no
 * file changed means the fix never landed, the usual cause being an edit that
 * failed earlier in a chained command.
 *
 * In a Git work tree, `--working` records a {@link snapshot}: HEAD plus every
 * staged, unstaged, untracked and deleted path with a hash of its contents.
 * `--done` compares it with a fresh one, so a staged edit, a revert and a
 * deleted untracked file all count. Without a snapshot (no `--working`, or no
 * Git) {@link latestChange} falls back to modification times. Both also read
 * the `own` paths Isotone manages (variant copies, knobs) whether or not Git
 * ignores them, so a fix made only there counts.
 *
 * Any change counts, not only one near the note: a fix often lands away from
 * the element's own component (a stylesheet, a token, a parent), so a check
 * by path would refuse real fixes and teach agents to pass `--force`. Instead
 * `--done` names the files it counted ({@link snapshotChanges}, else
 * {@link changedSince}), so an unrelated
 * edit (another agent's, the user's) is seen for what it is.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { realPath } from '../node/fs/paths';

/** Past this many candidate files the answer is "changed": a guard must never block on a guess. */
const MAX_FILES = 20_000;
/** A file larger than this is fingerprinted by size and time instead of its contents. */
const MAX_HASHED_BYTES = 4 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

/** Past this many files a snapshot keeps its fingerprint only, so a note stays small; `--done` then goes by modification times to name them. */
const MAX_RECORDED = 200;

/**
 * The work tree as `--working` saw it: one fingerprint to compare, and what
 * names the files a change touched, HEAD's commit and each file's own
 * fingerprint (null past {@link MAX_RECORDED}).
 */
export interface Snapshot {
  hash: string;
  head: string | null;
  files: Record<string, string> | null;
}

/**
 * A short fingerprint of the Git work tree that contains `root`, and of the
 * files under `own`, leaving out the paths `ignore` excludes; null outside Git
 * or past {@link MAX_FILES}.
 */
export function snapshot(root: string, ignore: (file: string) => boolean, own: string[] = []): Snapshot | null {
  const top = gitTop(root);
  if (!top) return null;
  const status = git(top, ['status', '--porcelain=v2', '-z', '--branch', '--no-renames', '--untracked-files=all']);
  if (status === null) return null;
  const entries = status.split('\0').filter(Boolean);
  if (entries.length > MAX_FILES) return null;
  const hash = createHash('sha256');
  const files: Record<string, string> = {};
  let head: string | null = null;
  const add = (abs: string, line: string) => {
    hash.update(`${line}\n`);
    files[abs] = createHash('sha256').update(line).digest('hex').slice(0, 16);
  };
  for (const entry of entries.sort()) {
    if (entry.startsWith('# ')) {
      // Of the headers only HEAD matters: a commit is a change.
      if (entry.startsWith('# branch.oid ')) {
        hash.update(`${entry}\n`);
        const oid = entry.slice('# branch.oid '.length);
        head = /^[0-9a-f]+$/.test(oid) ? oid : null;
      }
      continue;
    }
    const abs = join(top, statusPath(entry));
    if (ignore(abs)) continue;
    // The entry carries the index's hash, so staging an edit changes it too.
    add(abs, `${entry}\0${contents(abs)}`);
  }
  const managed = filesUnder(own);
  if (managed === null) return null;
  for (const abs of managed) if (!ignore(abs)) add(abs, `own ${abs}\0${contents(abs)}`);
  return {
    hash: hash.digest('hex').slice(0, 32),
    head,
    files: Object.keys(files).length > MAX_RECORDED ? null : files,
  };
}

/**
 * The files whose state differs between two snapshots, absolute and sorted:
 * those either one saw with another fingerprint or not at all, and those the
 * commits between their HEADs touched. Null when either kept no file list.
 */
export function snapshotChanges(
  root: string,
  ignore: (file: string) => boolean,
  before: Omit<Snapshot, 'hash'>,
  after: Snapshot,
): string[] | null {
  if (!before.files || !after.files) return null;
  const found = new Set<string>();
  for (const file of new Set([...Object.keys(before.files), ...Object.keys(after.files)]))
    if (before.files[file] !== after.files[file]) found.add(file);
  const top = gitTop(root);
  if (top && before.head && after.head && before.head !== after.head) {
    const diff = git(top, ['diff', '--name-only', '-z', before.head, after.head]);
    if (diff === null) return null;
    for (const file of diff.split('\0').filter(Boolean)) if (!ignore(join(top, file))) found.add(join(top, file));
  }
  return found.size > MAX_FILES ? null : [...found].sort();
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
 * The latest modification time, in ms, of a file under `root` or `own` that
 * `ignore` does not exclude; 0 when there is none, Infinity when it cannot
 * tell. In Git every tracked and untracked file counts (a restored file is
 * new too), plus the HEAD commit time; other Git-ignored files never do.
 * Elsewhere a bounded walk skips dependencies, build output and dot-directories.
 */
export function latestChange(root: string, ignore: (file: string) => boolean, own: string[] = []): number {
  const managed = filesUnder(own);
  if (managed === null) return Number.POSITIVE_INFINITY;
  let latest = 0;
  for (const abs of managed) if (!ignore(abs)) latest = Math.max(latest, mtime(abs) ?? 0);
  return Math.max(latest, projectChange(root, ignore));
}

function projectChange(root: string, ignore: (file: string) => boolean): number {
  const top = gitTop(root);
  const files = top ? gitFiles(top) : null;
  if (!top || files === null) {
    let latest = 0;
    return walk(root, ignore, (_, time) => {
      latest = Math.max(latest, time);
    })
      ? latest
      : Number.POSITIVE_INFINITY;
  }
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

/**
 * The files a change since `since` came from, as {@link latestChange} sees
 * them: modified after it (under `root` or `own`), deleted, or in a commit
 * made since. Absolute and sorted; null past {@link MAX_FILES}, as there.
 */
export function changedSince(root: string, ignore: (file: string) => boolean, own: string[], since: number): string[] | null {
  const found = new Set<string>();
  const managed = filesUnder(own);
  if (managed === null) return null;
  for (const abs of managed) if (!ignore(abs) && (mtime(abs) ?? 0) > since) found.add(abs);
  const top = gitTop(root);
  const files = top ? gitFiles(top) : null;
  if (!top || files === null) {
    const whole = walk(root, ignore, (abs, time) => {
      if (time > since) found.add(abs);
    });
    return whole ? [...found].sort() : null;
  }
  if (files.length > MAX_FILES) return null;
  // Commit times are whole seconds: one in the second `since` falls in is taken for older.
  const after = new Date((Math.floor(since / 1000) + 1) * 1000).toISOString();
  const log = git(top, ['log', `--since=${after}`, '--name-only', '--format=', '-z']) ?? '';
  const committed = new Set(log.split(/[\0\n]/).filter(Boolean));
  for (const file of new Set([...files, ...committed])) {
    const abs = join(top, file);
    const time = mtime(abs);
    if (!ignore(abs) && (time === null || time > since || committed.has(file))) found.add(abs);
  }
  return [...found].sort();
}

/** The tracked and untracked files Git does not ignore, from the work tree's root; null when Git cannot say. */
function gitFiles(top: string): string[] | null {
  const listed = git(top, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return listed === null ? null : [...new Set(listed.split('\0').filter(Boolean))];
}

/** Visits each file under `root` with its modification time; false past {@link MAX_FILES}. */
function walk(root: string, ignore: (file: string) => boolean, visit: (file: string, time: number) => void): boolean {
  let seen = 0;
  // Walk the long path, as the ignore list holds it (Windows can name a folder both ways).
  const queue = [realPath(root)];
  for (let dir = queue.pop(); dir !== undefined; dir = queue.pop()) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > MAX_FILES) return false;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && (!entry.name.startsWith('.') || entry.name === '.isotone')) queue.push(abs);
      } else if (entry.isFile() && !ignore(abs)) visit(abs, mtime(abs) ?? 0);
    }
  }
  return true;
}

/** Every file at or under `paths`, sorted; null past {@link MAX_FILES}. */
function filesUnder(paths: string[]): string[] | null {
  const files: string[] = [];
  const queue = [...paths];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      if (mtime(path) !== null) files.push(path);
      continue;
    }
    for (const entry of entries) {
      const abs = join(path, entry.name);
      if (entry.isDirectory()) queue.push(abs);
      else if (entry.isFile()) files.push(abs);
    }
    if (files.length > MAX_FILES) return null;
  }
  return files.sort();
}

export function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** The work tree's root, named the way the `ignore` callers name their own
 *  files: on Windows git prints `C:/Users/runneradmin/…` where node may hold
 *  `C:\\Users\\RUNNER~1\\…`, and only the native realpath agrees with both. */
function gitTop(root: string): string | null {
  const top = git(root, ['rev-parse', '--show-toplevel'])?.trim();
  if (!top) return null;
  try {
    return realPath(top);
  } catch {
    return top;
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

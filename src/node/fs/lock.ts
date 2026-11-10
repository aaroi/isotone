/**
 * A cross-process lock for read-modify-write of a JSON file, shared by the
 * CLI, the dev servers and Blast.
 *
 * The lock is `<file>.lock`, holding `{ pid, host, token }`. It is created by
 * hard-linking a fully written temporary file to that name, so another process
 * never sees it empty or half written. The owner removes it only while it
 * still holds its own token.
 *
 * A lock left behind by a process that died is taken over, but never on the
 * strength of one read: the PID in a lock can belong to a process that has
 * just released it and exited, while a new owner has already created the
 * next lock. So a lock counts as abandoned only once it is older than
 * {@link SETTLE_MS} and its owner is gone (or it is older than
 * {@link ABANDONED_MS} whatever it holds, which covers PID reuse, another
 * user's process and another machine or container). The takeover itself
 * runs under a second lock, `<lock>.steal`, and renames the old lock aside.
 * A writer that created its lock while a takeover was running does not use
 * it, and every writer checks that the lock still holds its token before it
 * starts: so the lock the takeover renamed, even one that appeared after it
 * was judged, is never in use, and at most one writer ever proceeds.
 *
 * Temporary and stale files a killed writer left beside the file are swept
 * by the next writer once they are a minute old.
 */
import { randomUUID } from 'node:crypto';
import { closeSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** How long a lock is never taken over, whatever it holds. Every critical
 *  section is a small synchronous read and write, far shorter than this. */
const SETTLE_MS = 1_000;
/** A lock this old is taken over even when its PID looks alive. */
const ABANDONED_MS = 30_000;
/** A takeover in progress is this short; one older than this was interrupted. */
const STEAL_ABANDONED_MS = 5_000;
/** A temporary file this old beside the store belongs to a writer that died. */
const LEFTOVER_MS = 60_000;

/** How long the CLI waits for another writer by default. */
const CLI_LOCK_WAIT_MS = 2_000;
/** How long a dev server waits before answering 503: it must not freeze its
 *  event loop on someone else's lock. */
export const SERVER_LOCK_WAIT_MS = 250;

/** Another writer holds the lock past the wait budget. Servers answer 503. */
export class LockBusyError extends Error {
  constructor(file: string) {
    super(`Local store is busy: ${file}. Retry after the other writer finishes.`);
    this.name = 'LockBusyError';
  }
}

export interface FileLockOptions {
  /** How long to wait for another writer, in ms. Default {@link CLI_LOCK_WAIT_MS}. */
  waitMs?: number;
}

interface LockOwner {
  pid: number;
  host: string;
  token: string;
}

/** Serialize read-modify-write across the CLI and the dev server. A dead
 * process's lock is recoverable; a busy store fails without discarding data. */
export function withFileLock<T>(file: string, work: () => T, options: FileLockOptions = {}): T {
  const lock = `${file}.lock`;
  let token: string;
  try {
    mkdirSync(dirname(file), { recursive: true });
    token = acquire(lock, file, options.waitMs ?? CLI_LOCK_WAIT_MS);
  } catch (error) {
    // Only an existing lock means busy; a permission or read-only failure
    // would never clear by waiting, so it is reported as what it is.
    if (error instanceof LockBusyError) throw error;
    throw new Error(`Cannot lock the local store ${file}: ${(error as Error).message}`, { cause: error });
  }
  try {
    sweepLeftovers(file);
    return work();
  } finally {
    release(lock, token);
  }
}

function acquire(lock: string, file: string, waitMs: number): string {
  const deadline = Date.now() + waitMs;
  const owner: LockOwner = { pid: process.pid, host: hostname(), token: randomUUID() };
  let pause = 2;
  while (true) {
    if (claim(lock, owner)) return owner.token;
    takeOverIfAbandoned(lock);
    if (claim(lock, owner)) return owner.token;
    if (Date.now() >= deadline) throw new LockBusyError(file);
    sleep(Math.min(pause, Math.max(1, deadline - Date.now())));
    pause = Math.min(pause * 2, 25);
  }
}

/**
 * Create the lock and keep it only when it is safe to use: no takeover is
 * running (one could rename this new lock aside, judging it the old one),
 * and the lock still holds this owner's token.
 */
function claim(lock: string, owner: LockOwner): boolean {
  if (!create(lock, JSON.stringify(owner))) return false;
  if (!takeoverRunning(lock) && readOwner(lock)?.token === owner.token) return true;
  release(lock, owner.token);
  return false;
}

/** Whether `<lock>.steal` is held; one left by a takeover that died is removed. */
function takeoverRunning(lock: string): boolean {
  const steal = `${lock}.steal`;
  const age = ageOf(steal);
  if (age === null) return false;
  if (age < STEAL_ABANDONED_MS) return true;
  rmSync(steal, { force: true });
  return false;
}

/** Create `path` holding `contents` in one step, or false when it exists. */
function create(path: string, contents: string): boolean {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      // A filesystem without hard links: an exclusive create, then the
      // contents. A reader can see it empty for a moment, which the
      // takeover rule tolerates by waiting SETTLE_MS.
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS' && code !== 'EXDEV') throw error;
      return createExclusive(path, contents);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** How many times, 5ms apart, an exclusive create is retried on Windows before EPERM counts as a real refusal. */
const DELETE_PENDING_TRIES = 20;

function createExclusive(path: string, contents: string): boolean {
  let fd: number;
  for (let attempt = 1; ; attempt++) {
    try {
      fd = openSync(path, 'wx', 0o600);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      // Windows keeps a file another process just deleted until its last handle
      // closes, and refuses to create over it with EPERM for those few milliseconds.
      if (code !== 'EPERM' || process.platform !== 'win32' || attempt >= DELETE_PENDING_TRIES) throw error;
      sleep(5);
    }
  }
  try {
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Identity of one lock file: a replacement is a new inode or a new mtime. */
function identity(path: string): string | null {
  try {
    const stat = statSync(path, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.size}`;
  } catch {
    return null;
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>;
    if (typeof value.token !== 'string' || typeof value.host !== 'string') return null;
    if (typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0) return null;
    return value as LockOwner;
  } catch {
    // Empty, half written by an older version, or not ours: no owner to ask.
    return null;
  }
}

function ageOf(path: string): number | null {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Whether the lock at `path` was left behind by a writer that is gone. */
function isAbandoned(path: string): boolean {
  const age = ageOf(path);
  if (age === null || age < SETTLE_MS) return false;
  if (age >= ABANDONED_MS) return true;
  const owner = readOwner(path);
  if (!owner) return true; // Unreadable after SETTLE_MS: its writer never finished.
  if (owner.host !== hostname()) return false; // Another machine's PIDs mean nothing here.
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    // EPERM: alive, under another user. Only age can free it.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Remove an abandoned lock. Takeovers are serialized by `<lock>.steal`, and
 * the lock is renamed aside before it is removed. Whatever was renamed is
 * dropped, even a lock created after it was judged: its writer saw the
 * takeover running, or will find its token gone, and does not use it.
 */
function takeOverIfAbandoned(lock: string): void {
  const before = identity(lock);
  if (before === null || !isAbandoned(lock)) return;
  const steal = `${lock}.steal`;
  if (!create(steal, String(process.pid))) {
    takeoverRunning(lock);
    return;
  }
  try {
    if (identity(lock) !== before || !isAbandoned(lock)) return;
    const aside = `${lock}.${randomUUID()}.stale`;
    try {
      renameSync(lock, aside);
    } catch {
      return; // Released meanwhile.
    }
    rmSync(aside, { force: true });
  } finally {
    rmSync(steal, { force: true });
  }
}

/** Remove `<file>.<uuid>.tmp` and `.stale` files a killed writer left. */
function sweepLeftovers(file: string): void {
  const dir = dirname(file);
  const prefix = `${basename(file)}.`;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix) || !/\.(tmp|stale)$/.test(name)) continue;
      const age = ageOf(join(dir, name));
      if (age !== null && age >= LEFTOVER_MS) rmSync(join(dir, name), { force: true });
    }
  } catch {
    /* Housekeeping only. */
  }
}

/** Remove the lock only while it is still ours: one taken over after
 *  {@link ABANDONED_MS} belongs to its new owner. */
function release(lock: string, token: string): void {
  if (readOwner(lock)?.token === token) rmSync(lock, { force: true });
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

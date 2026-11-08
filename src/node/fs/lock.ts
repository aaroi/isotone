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
 * runs under a second lock, renames the old lock aside, and checks that it
 * renamed the very file it judged; anything else is put back.
 */
import { randomUUID } from 'node:crypto';
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

/** How long a lock is never taken over, whatever it holds. Every critical
 *  section is a small synchronous read and write, far shorter than this. */
const SETTLE_MS = 1_000;
/** A lock this old is taken over even when its PID looks alive. */
const ABANDONED_MS = 30_000;
/** A takeover in progress is this short; one older than this was interrupted. */
const STEAL_ABANDONED_MS = 5_000;

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
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = acquire(lock, file, options.waitMs ?? CLI_LOCK_WAIT_MS);
  try {
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
    if (create(lock, JSON.stringify(owner))) return owner.token;
    takeOverIfAbandoned(lock);
    if (create(lock, JSON.stringify(owner))) return owner.token;
    if (Date.now() >= deadline) throw new LockBusyError(file);
    sleep(Math.min(pause, Math.max(1, deadline - Date.now())));
    pause = Math.min(pause * 2, 25);
  }
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

function createExclusive(path: string, contents: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
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
 * the lock is renamed aside before it is judged final: if what moved is not
 * the file that was judged, it is a live owner's new lock, and goes back.
 */
function takeOverIfAbandoned(lock: string): void {
  const before = identity(lock);
  if (before === null || !isAbandoned(lock)) return;
  const steal = `${lock}.steal`;
  if (!create(steal, String(process.pid))) {
    const age = ageOf(steal);
    if (age !== null && age >= STEAL_ABANDONED_MS) rmSync(steal, { force: true });
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
    if (identity(aside) !== before) {
      try {
        linkSync(aside, lock);
      } catch {
        /* Someone took the free name: they own the lock now. */
      }
    }
    rmSync(aside, { force: true });
  } finally {
    rmSync(steal, { force: true });
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

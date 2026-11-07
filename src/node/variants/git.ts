/** Git blob hashing and three-way merges against the base an override was made from. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A failed lookup is an answer here (`null`), not something to print. */
const GIT_QUIET: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

/**
 * `git hash-object` looks up the repository from its cwd, not from the
 * path it's hashing, so every call here runs with cwd set to the file's own
 * directory — always inside the right repo regardless of where the caller's
 * process happens to be.
 */
export function blobOf(absPath: string): string | null {
  try {
    return execFileSync('git', ['hash-object', '--no-filters', '-w', absPath], {
      cwd: dirname(absPath),
      encoding: 'utf8',
      stdio: GIT_QUIET,
    }).trim();
  } catch {
    return null;
  }
}

/** Whether git ignores the file (an untracked file a `.gitignore` covers).
 *  Outside a repository nothing is ignored. */
export function isGitIgnored(absPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', absPath], { cwd: dirname(absPath), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function currentBlob(absPath: string): string | null {
  try {
    return execFileSync('git', ['hash-object', '--no-filters', absPath], {
      cwd: dirname(absPath),
      encoding: 'utf8',
      stdio: GIT_QUIET,
    }).trim();
  } catch {
    return null;
  }
}

/** Git blob hashing is just a header and the file bytes. Existing bases tell
 * us the repository's hash format, avoiding a process per file on every poll. */
export function hashFile(file: string, base: string | null): string | null {
  if (base === null) return null;
  try {
    const contents = readFileSync(file);
    return createHash(base.length === 64 ? 'sha256' : 'sha1')
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest('hex');
  } catch {
    return null;
  }
}

export function catFile(cwd: string, hash: string): string | null {
  try {
    return execFileSync('git', ['cat-file', '-p', hash], { cwd, encoding: 'utf8', stdio: GIT_QUIET });
  } catch {
    return null; // the blob isn't reachable (gc'd, or never written)
  }
}

/** Runs `git merge-file -p <override> <base> <current>`, capturing stdout
 *  whether it exits clean (0) or with conflict markers. execFileSync throws
 *  on a nonzero exit, but the thrown error still carries stdout and the exit
 *  status, so both are read from there. `status` is null when git never
 *  ran to completion (killed by a signal, or not found). */
export function mergeFile(
  overrideAbs: string,
  baseAbs: string,
  currentAbs: string,
): {
  status: number | null;
  stdout: string;
} {
  try {
    const stdout = execFileSync(
      'git',
      ['merge-file', '-p', '-L', 'variant', '-L', 'base', '-L', 'default', overrideAbs, baseAbs, currentAbs],
      { encoding: 'utf8', stdio: GIT_QUIET },
    );
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    return { status: e.status ?? null, stdout: e.stdout ?? '' };
  }
}

/** `git merge-file` exits with the number of conflicts it left, so 1..127
 *  is a conflicted merge whose stdout still carries the whole file (with
 *  markers). 128 and up, or no status at all, is git failing outright. */
export function isConflictStatus(status: number | null): boolean {
  return status !== null && status >= 1 && status <= 127;
}

/** The base a later sync merges from has to be in git's object store. A file
 *  git does not track yet is in there only if this writes it. */
export function recordBase(absPath: string, hash: string): string {
  return blobOf(absPath) ?? hash;
}

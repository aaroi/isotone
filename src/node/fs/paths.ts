/**
 * The one "is this path inside that directory" guard. Callers say which
 * guarantee they need: a lexical comparison, or one that follows symlinks.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** `relative()` puts you outside the base with a leading `..` (or, on a
 *  different drive on Windows, an absolute path back out) — either way the
 *  caller asked for something outside the tree we're allowed to touch. */
export function isEscaping(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * `path` as Git and Vite name it: symlinks resolved (macOS's /var is
 * /private/var) and, on Windows, 8.3 short names expanded (`RUNNER~1` is
 * `runneradmin`), which only the native call does. Falls back to the
 * JavaScript one where the native call fails (some Windows RAM and network
 * drives answer EISDIR). Throws when `path` does not exist.
 */
export function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return realpathSync(path);
  }
}

/** POSIX-ify a path node gave us as platform-native (a no-op on POSIX,
 *  where `sep` already is `/`; keeps manifest keys portable regardless). */
export function toPosixPath(p: string): string {
  return p.split(sep).join('/');
}

/** The path with every existing ancestor's symlinks resolved, including for
 *  a not-yet-created file beneath a symlinked directory. */
export function canonicalPath(path: string): string {
  let existing = resolve(path);
  while (dirname(existing) !== existing) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      existing = dirname(existing);
    }
  }
  return resolve(realpathSync(existing), relative(existing, resolve(path)));
}

/**
 * Whether `path` is `base` itself or below it; never a sibling whose name
 * merely starts the same (`src-old` under `src`). With `realpath`, both sides
 * are compared after resolving symlinks through their existing ancestors, so
 * a lexical child that is a symlink to somewhere else does not count.
 */
export function isWithin(base: string, path: string, options: { realpath?: boolean } = {}): boolean {
  const rel = options.realpath ? relative(canonicalPath(base), canonicalPath(path)) : relative(base, path);
  return !isEscaping(rel);
}

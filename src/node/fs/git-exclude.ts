/**
 * Keep Isotone's local files out of Git through the repository's own
 * `.git/info/exclude`, so a project needs no `.gitignore` edit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { isEscaping } from './paths';

/**
 * Ensure the feedback file path, and the lock and temporary files written
 * beside it, are ignored by git via the repo-local
 * `.git/info/exclude` (never committed), so a consumer needs no `.gitignore`
 * edit. Idempotent and non-destructive; never fails the dev server.
 */
export function ensureFileIgnored(file: string): void {
  try {
    // Resolve through symlinks so the path is comparable with git's answer,
    // which is already canonical (macOS's /var → /private/var, for one).
    // The file, and `.isotone/` before the first note, may not exist yet.
    const absolute = canonical(resolve(file));
    let dir = dirname(absolute);
    while (!existsSync(dir)) dir = dirname(dir);
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      // Outside a repo git writes "fatal: not a git repository" to stderr, and
      // inheriting it prints that over the server's own startup banner. The
      // throw is the signal we act on; the message is noise.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pattern = excludePattern(gitRoot, absolute);
    if (!pattern) return;
    const infoExclude = excludeFile(dir);
    const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf8') : '';
    // The file and its side files: `.lock`, a takeover's lock, a crashed write's `.tmp`.
    const missing = [pattern, `${pattern}.*`].filter((p) => !hasExcludePattern(existing, p));
    if (!missing.length) return;
    const marker = existing && !existing.endsWith('\n') ? '\n' : '';
    // One comment header per exclude file, however many patterns land under it.
    const heading = '# isotone (local dev feedback loop)';
    const comment = existing.includes(heading) ? '' : `${heading}\n`;
    mkdirSync(dirname(infoExclude), { recursive: true });
    writeFileSync(infoExclude, `${existing}${marker}${comment}${missing.map((p) => `${p}\n`).join('')}`);
  } catch {
    // A stray dev-only feedback file is non-fatal if we can't ignore it.
  }
}

/** `path` through symlinks, for as much of it as exists. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}

/**
 * Like {@link ensureFileIgnored}, for a directory: the pattern gets a trailing
 * slash so it matches the tree, not a file of the same name. Used for the
 * overlay variants directory when a host opts out of committing it.
 */
export function ensureDirIgnored(dir: string): void {
  try {
    const absolute = realpathSync(resolve(dir));
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: absolute,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const base = excludePattern(gitRoot, absolute);
    if (!base) return;
    const pattern = `${base}/`;
    const infoExclude = excludeFile(absolute);
    const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf8') : '';
    if (hasExcludePattern(existing, pattern) || hasExcludePattern(existing, base)) return;
    const marker = existing && !existing.endsWith('\n') ? '\n' : '';
    mkdirSync(dirname(infoExclude), { recursive: true });
    writeFileSync(infoExclude, `${existing}${marker}# isotone (local overlay variants)\n${pattern}\n`);
  } catch {
    // Non-fatal, as above.
  }
}

/**
 * Where git reads the repo-local exclude file from, asked from `cwd`. Not
 * `<toplevel>/.git/info/exclude`: in a worktree `.git` is a file pointing at
 * the shared repository, and the exclude file lives in that common dir. Git
 * answers relative to the cwd when the file is under it, so resolve.
 */
function excludeFile(cwd: string): string {
  const reported = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return resolve(cwd, reported);
}

/**
 * The gitignore pattern that matches exactly `absolute` from `gitRoot`: its
 * path relative to the root with a leading slash, since a leading slash
 * anchors a pattern to the root of the repository. An absolute filesystem
 * path is read the same way and so matches nothing when the dev server runs
 * in a subdirectory of the checkout. Null when the file is outside the repo,
 * where no exclude entry could cover it.
 */
export function excludePattern(gitRoot: string, absolute: string): string | null {
  const rel = relative(gitRoot, absolute);
  if (!rel || isEscaping(rel)) {
    return null;
  }
  return `/${rel.split(sep).join('/')}`;
}

/** Whether `exclude` already carries `pattern`, with or without the anchor.
 *  A hand-written bare `app/console/x.json` covers the file too (a pattern
 *  with a slash inside it is root-relative either way), so it counts. */
export function hasExcludePattern(exclude: string, pattern: string): boolean {
  const bare = pattern.replace(/^\//, '');
  return exclude.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === bare);
}

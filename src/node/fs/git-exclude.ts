/**
 * Keep Isotone's local files out of Git through the repository's own
 * `.git/info/exclude`, so a project needs no `.gitignore` edit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { basename, dirname, join, type PlatformPath, resolve } from 'node:path';

import { realPath } from './paths';

/**
 * Ensure the feedback file path, and the lock and temporary files written
 * beside it, are ignored by git via the repo-local
 * `.git/info/exclude` (never committed), so a consumer needs no `.gitignore`
 * edit. Idempotent and non-destructive; never fails the dev server.
 */
export function ensureFileIgnored(file: string): void {
  ensureFilesIgnored([file]);
}

/**
 * {@link ensureFileIgnored} for files of one repository, with one git call
 * for all of them: cheap enough for every CLI command, so the
 * files land in the exclude file even when the repository was made after
 * the dev server started.
 */
export function ensureFilesIgnored(files: string[]): void {
  if (!files.length) return;
  try {
    // Resolve through symlinks so the path is comparable with git's answer,
    // which is already canonical (macOS's /var → /private/var, for one; on
    // Windows a long name where the temp dir is `RUNNER~1`).
    // The file, and `.isotone/` before the first note, may not exist yet.
    const absolutes = files.map((file) => canonical(resolve(file)));
    let dir = dirname(absolutes[0] as string);
    while (!existsSync(dir)) dir = dirname(dir);
    const { top, infoExclude } = repoPaths(dir);
    // Each file and its side files: `.lock`, a takeover's lock, a crashed write's `.tmp`.
    const patterns = absolutes.flatMap((absolute) => {
      const pattern = excludePattern(top, absolute);
      return pattern ? [pattern, `${pattern}.*`] : [];
    });
    if (!patterns.length) return;
    const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf8') : '';
    const missing = [...new Set(patterns)].filter((p) => !hasExcludePattern(existing, p));
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
    return realPath(path);
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
    const absolute = realPath(resolve(dir));
    const { top, infoExclude } = repoPaths(absolute);
    const base = excludePattern(top, absolute);
    if (!base) return;
    const pattern = `${base}/`;
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
 * The repository's top level, canonical, and where git reads its exclude file
 * from, asked from `cwd` in one call; throws outside a repository. Not
 * `<toplevel>/.git/info/exclude`: in a worktree `.git` is a file pointing at
 * the shared repository, and the exclude file lives in that common dir. Git
 * answers relative to the cwd when the file is under it, so resolve.
 */
function repoPaths(cwd: string): { top: string; infoExclude: string } {
  const [top = '', exclude = ''] = execFileSync('git', ['rev-parse', '--show-toplevel', '--git-path', 'info/exclude'], {
    cwd,
    encoding: 'utf8',
    // Outside a repo git writes "fatal: not a git repository" to stderr, and
    // inheriting it prints that over the server's own startup banner. The
    // throw is the signal we act on; the message is noise.
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .split(/\r?\n/);
  return { top: canonical(top), infoExclude: resolve(cwd, exclude) };
}

/**
 * The gitignore pattern that matches exactly `absolute` from `gitRoot`: its
 * path relative to the root with a leading slash, since a leading slash
 * anchors a pattern to the root of the repository. An absolute filesystem
 * path is read the same way and so matches nothing when the dev server runs
 * in a subdirectory of the checkout. Null when the file is outside the repo,
 * where no exclude entry could cover it. On Windows git names the root with
 * forward slashes (`C:/repo`) and node the file with backslashes; `paths`
 * is the platform's path module, swappable so a test can check that on any OS.
 */
export function excludePattern(gitRoot: string, absolute: string, paths: PlatformPath = path): string | null {
  const rel = paths.relative(gitRoot, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${paths.sep}`) || paths.isAbsolute(rel)) {
    return null;
  }
  return `/${rel.split(paths.sep).join('/')}`;
}

/** Whether `exclude` already carries `pattern`, with or without the anchor.
 *  A hand-written bare `app/console/x.json` covers the file too (a pattern
 *  with a slash inside it is root-relative either way), so it counts. */
export function hasExcludePattern(exclude: string, pattern: string): boolean {
  const bare = pattern.replace(/^\//, '');
  return exclude.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === bare);
}

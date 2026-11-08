import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A new Git repository in a temporary directory, with a committer identity
 * so tests can commit, added to `dirs` for the test file's own cleanup.
 * Returned by its canonical path, the one git and Vite print: macOS's /var
 * is /private/var, and Windows's temp dir is the 8.3 short name `RUNNER~1`,
 * which only the native realpath expands. `canonical: false` returns the
 * path as the OS names the temp dir instead, for a test of that mismatch.
 */
export function tempGitRepo(prefix: string, dirs: string[], { canonical = true }: { canonical?: boolean } = {}): string {
  const raw = mkdtempSync(join(tmpdir(), prefix));
  const root = canonical ? realpathSync.native(raw) : raw;
  dirs.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

/** A notes file path in a new temporary directory, added to `dirs` for cleanup. */
export function tempNotesFile(dirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'isotone-'));
  dirs.push(dir);
  return join(dir, 'notes.json');
}

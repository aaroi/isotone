import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A new Git repository in a temporary directory, with a committer identity
 * so tests can commit. Its canonical path (macOS's /var is /private/var) is
 * added to `dirs` for the test file's own cleanup.
 */
export function tempGitRepo(prefix: string, dirs: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
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

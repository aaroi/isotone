import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureDirIgnored,
  ensureFileIgnored,
  excludePattern,
  hasExcludePattern,
  notesResponse,
  readNotes,
  writeNotes,
} from '../src/store';

const dirs: string[] = [];

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'iso-iterate-'));
  dirs.push(dir);
  return join(dir, 'notes.json');
}

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function post(file: string, body: unknown) {
  return notesResponse(file, { method: 'POST', url: '/api/iteration/notes', body });
}

function get(file: string, url: string) {
  return notesResponse(file, { method: 'GET', url });
}

function del(file: string, id: string | null) {
  return notesResponse(file, {
    method: 'DELETE',
    url: `/api/iteration/notes${id ? `?id=${id}` : ''}`,
  });
}

describe('notesResponse', () => {
  it('starts empty, saves, lists by route, deletes', () => {
    const file = tempFile();

    const created = post(file, {
      route: '/projects',
      feedback: 'hello',
      element: null,
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const listed = get(file, '/api/iteration/notes?route=/projects');
    const rows = listed.body as Array<{ id: string; feedback: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback).toBe('hello');
    expect(readNotes(file)).toHaveLength(1);

    expect(del(file, id).status).toBe(200);
    expect(readNotes(file)).toHaveLength(0);
  });

  it('upserts by id instead of duplicating', () => {
    const file = tempFile();
    const first = post(file, { route: '/x', feedback: 'v1', element: null });
    const id = (first.body as { id: string }).id;
    const second = post(file, { id, route: '/x', feedback: 'v2', element: null });
    expect(second.status).toBe(200);
    expect(readNotes(file)).toHaveLength(1);
    expect(readNotes(file)[0].feedback).toBe('v2');
  });

  it('only lists open notes when no route is given', () => {
    const file = tempFile();
    post(file, { route: '/a', feedback: 'hi', element: null });
    post(file, { route: '/b', feedback: 'done me', element: null });
    // Mark /a done the way the CLI does: flip the stored note.
    const all = readNotes(file);
    const first = all.find((n) => n.route === '/a');
    if (first) first.done = true;
    writeNotes(file, all);
    const pending = get(file, '/api/iteration/notes');
    expect(
      (pending.body as Array<{ route: string }>).map((r) => r.route),
    ).toEqual(['/b']);
  });

  it('rejects a POST without feedback and a DELETE without an id', () => {
    const file = tempFile();
    expect(post(file, { route: '/x', feedback: '  ', element: null }).status).toBe(400);
    expect(del(file, null).status).toBe(400);
  });
});

describe('ensureFileIgnored', () => {
  it('is non-destructive outside a git repo', () => {
    expect(() => ensureFileIgnored(tempFile())).not.toThrow();
  });

  it('writes a root-anchored pattern git actually matches from a subdirectory', () => {
    // A dev server started in app/console of a checkout whose root is two
    // levels up: the shape that produced an absolute path in the exclude
    // file, which git reads as root-relative and so never matched.
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-repo-')));
    dirs.push(repo);
    execFileSync('git', ['init', '-q', repo]);
    const consoleDir = join(repo, 'app', 'console');
    mkdirSync(consoleDir, { recursive: true });
    const file = join(consoleDir, '.iteration-feedback.json');
    writeFileSync(file, '[]\n');

    ensureFileIgnored(file);

    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('\n/app/console/.iteration-feedback.json\n');
    expect(exclude).not.toContain(repo);
    // The proof is git's own verdict, not the file's contents.
    const ignored = execFileSync('git', ['check-ignore', '--no-index', file], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    expect(ignored).toBe(file);
    expect(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: repo,
        encoding: 'utf8',
      }),
    ).toBe('');

    // Idempotent: a second run adds nothing.
    ensureFileIgnored(file);
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe(exclude);
  });

  it('writes into the exclude file git reports from inside a worktree', () => {
    // In a worktree `.git` is a file pointing at the shared repository, so
    // `<toplevel>/.git/info/exclude` is not a path at all; git keeps the
    // exclude file in the common dir and `--git-path` is how it says where.
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-wt-repo-')));
    dirs.push(repo);
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    writeFileSync(join(repo, 'README'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-wt-')));
    dirs.push(parent);
    const worktree = join(parent, 'checkout');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt', worktree], {
      cwd: repo,
      stdio: 'ignore',
    });

    const file = join(worktree, 'app', '.iteration-feedback.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '[]\n');
    ensureFileIgnored(file);
    const variants = join(worktree, 'app', 'variants');
    mkdirSync(variants, { recursive: true });
    writeFileSync(join(variants, 'x'), '');
    ensureDirIgnored(variants);

    const reported = resolve(
      worktree,
      execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
        cwd: worktree,
        encoding: 'utf8',
      }).trim(),
    );
    // The shared repository's file, not anything under the worktree.
    expect(reported.startsWith(join(repo, '.git'))).toBe(true);
    const exclude = readFileSync(reported, 'utf8');
    expect(exclude).toContain('\n/app/.iteration-feedback.json\n');
    expect(exclude).toContain('\n/app/variants/\n');
    expect(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: worktree,
        encoding: 'utf8',
      }),
    ).toBe('');
  });

  it('recognises an existing relative entry, anchored or bare', () => {
    expect(hasExcludePattern('/app/x.json\n', '/app/x.json')).toBe(true);
    expect(hasExcludePattern('app/x.json\n', '/app/x.json')).toBe(true);
    expect(hasExcludePattern('/Users/me/repo/app/x.json\n', '/app/x.json')).toBe(false);
    expect(hasExcludePattern('/app/x.json.bak\n', '/app/x.json')).toBe(false);
  });

  it('derives the pattern from the git root and refuses files outside it', () => {
    expect(excludePattern('/repo', '/repo/app/console/x.json')).toBe('/app/console/x.json');
    expect(excludePattern('/repo', '/repo/x.json')).toBe('/x.json');
    expect(excludePattern('/repo', '/elsewhere/x.json')).toBeNull();
    expect(excludePattern('/repo', '/repo')).toBeNull();
  });
});

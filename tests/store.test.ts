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
  const dir = mkdtempSync(join(tmpdir(), 'isotone-'));
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
  it('preserves corrupt files instead of treating them as an empty store', () => {
    const file = tempFile();
    for (const contents of ['[{"id":"unfinished"', '{"wrong":"shape"}', '[null]']) {
      writeFileSync(file, contents);
      expect(() => post(file, { route: '/', feedback: 'New note' })).toThrow(/left untouched/);
      expect(() => del(file, 'some-id')).toThrow(/left untouched/);
      expect(readFileSync(file, 'utf8')).toBe(contents);
    }
  });

  it('uses stable client ids for retryable upserts and rejects route collisions', () => {
    const file = tempFile();
    const body = { id: 'client-generated-id', route: '/', feedback: 'Retry me' };
    expect(post(file, body).status).toBe(201);
    expect(post(file, body).status).toBe(200);
    expect(readNotes(file)).toHaveLength(1);
    expect(post(file, { ...body, route: '/another' }).status).toBe(409);
    expect(readNotes(file)[0].route).toBe('/');
  });

  it('reconciles a queued defaults snapshot with the pending server snapshot', () => {
    const file = tempFile();
    post(file, { id: 'server-defaults', route: '/', feedback: '[set-defaults] Old' });
    post(file, { id: 'offline-defaults', route: '/', feedback: '[set-defaults] New' });
    expect(readNotes(file)).toMatchObject([{ id: 'server-defaults', feedback: '[set-defaults] New' }]);
    expect(readNotes(file)).toHaveLength(1);
  });

  it('measures opaque payload limits in UTF-8 bytes, not string length', () => {
    const file = tempFile();
    expect(post(file, { route: '/', feedback: 'Too many bytes', payload: '😀'.repeat(17_000) }).status).toBe(400);
    expect(post(file, { route: '/', feedback: 'Within limit', payload: '😀'.repeat(10_000) }).status).toBe(201);
  });
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

  it('keeps only the latest pending defaults per route, preserving history and ordinary notes', () => {
    const file = tempFile();
    const first = post(file, { route: '/a', feedback: '[set-defaults] old', payload: { variants: 'old' } });
    const id = (first.body as { id: string }).id;
    const initial = readNotes(file)[0];
    writeNotes(file, [initial, { ...initial, id: 'legacy-duplicate' }, { ...initial, id: 'history', done: true }]);
    post(file, { route: '/b', feedback: '[set-defaults] another route' });
    post(file, { route: '/a', feedback: 'Ordinary feedback' });
    const saved = post(file, { route: '/a', feedback: '[set-defaults] new', payload: { variants: 'new' }, viewport: { w: 800, h: 600 } });
    expect(saved.status).toBe(200);
    const pending = readNotes(file).filter(n => !n.done && n.route === '/a' && n.feedback.startsWith('[set-defaults]'));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ feedback: '[set-defaults] new', payload: { variants: 'new' }, viewport: { w: 800, h: 600 } });
    expect(readNotes(file)).toHaveLength(4);
    expect(readNotes(file).find(n => n.id === 'history')?.feedback).toBe('[set-defaults] old');
    expect(pending[0].id).toBe(id);
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
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-repo-')));
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
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-wt-repo-')));
    dirs.push(repo);
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    writeFileSync(join(repo, 'README'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-wt-')));
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

describe('feedback references', () => {
  it('round-trips and validates pending variant removals independently of host payload', () => {
    const file = tempFile();
    const variantAction = { axisId: 'layout', action: 'remove-option', optionId: 'stack' };
    const created = post(file, { route: '/', feedback: '[remove-option] Stack', variantAction, payload: { host: true } });
    const id = (created.body as { id: string }).id;
    expect(get(file, '/api/iteration/notes').body).toMatchObject([{ variantAction, payload: { host: true } }]);
    post(file, { id, route: '/', feedback: 'Keep the same request' });
    expect(readNotes(file)[0]).toMatchObject({ variantAction });
    expect(post(file, { route: '/', feedback: 'Invalid', variantAction: { axisId: 'layout', action: 'remove-option' } }).status).toBe(400);
    del(file, id);
    expect(readNotes(file)).toEqual([]);
  });

  it('round-trips multiple pins and an option reference, and preserves them on legacy edits', () => {
    const file = tempFile();
    const elements = [{ tag: 'button', text: 'One', selector: '#one' }, { tag: 'h1', text: 'Two', selector: '#two' }];
    const variant = { axisId: 'spacing', label: 'Spacing', optionId: 'compact', optionLabel: 'Compact', value: 'compact' };
    const created = post(file, { route: '/', feedback: 'Align', elements, variant, payload: { host: true } });
    const id = (created.body as { id: string }).id;
    expect(readNotes(file)[0]).toMatchObject({ elements, variant, element: elements[0] });
    post(file, { id, route: '/', feedback: 'Align please' });
    expect(readNotes(file)[0]).toMatchObject({ elements, variant, element: elements[0], payload: { host: true } });
    post(file, { id, route: '/', feedback: 'No pins now', elements: [], variant: null });
    expect(readNotes(file)[0]).toMatchObject({ elements: [], variant: null, element: null });
  });
  it('limits the number of pinned elements at the server boundary', () => {
    expect(post(tempFile(), { route: '/', feedback: 'Too many', elements: Array(51).fill({ tag: 'p', text: '', selector: 'p' }) }).status).toBe(400);
  });
});

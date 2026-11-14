import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../../package.json';
import { docPath } from '../../src/cli/docs';
import { runCli, serveBanner } from '../../src/cli/run';
import { captureIo } from '../helpers/cli';
import { tempGitRepo } from '../helpers/fs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

const NOTES = join('.isotone', 'notes.json');
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function write(root: string, file: string, text: string, mtime?: number): void {
  const abs = join(root, file);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
  if (mtime !== undefined) utimesSync(abs, new Date(mtime), new Date(mtime));
}

function notes(
  root: string,
  list: {
    id: string;
    createdAt: string;
    route?: string;
    viewport?: { w: number; h: number };
    variant?: { axisId: string; label: string; optionId?: string; value?: string };
    selections?: Record<string, string>;
  }[],
): void {
  write(
    root,
    NOTES,
    JSON.stringify(list.map((n) => ({ route: '/', feedback: `fix ${n.id}`, done: false, doneAt: null, element: null, ...n }))),
  );
}

function stored(root: string): { id: string; done: boolean }[] {
  return JSON.parse(readFileSync(join(root, NOTES), 'utf8'));
}

/** Named as the OS names the temp dir, not as git does (macOS's /var is
 *  /private/var; Windows's is the short `RUNNER~1`), the way an agent's shell
 *  often holds it: Isotone's own files must still be recognized as its own. */
function repo(): string {
  const root = tempGitRepo('isotone-loop-', dirs, { canonical: false });
  write(root, 'src/App.jsx', 'export default function App() { return <button>Sign up</button>; }\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'app'], { cwd: root });
  return root;
}

describe('--done waits for the fix to land', () => {
  it('refuses in a Git repo while no file changed since the note, and closes once one has', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: new Date(Date.now() + 1000).toISOString() }]);
    // What a chained `sed … && npx isotone --done` leaves when the edit failed.
    const refused = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], refused)).toBe(1);
    expect(refused.text.err).toContain('Not closed: its fix has not landed.');
    expect(refused.text.err).toContain('[aaaa1111] /: no file changed since it was written');
    expect(refused.text.err).toContain('npx isotone --done aaaa1111 --force');
    expect(stored(root)[0]?.done).toBe(false);

    // Isotone's own bookkeeping is not a fix.
    write(root, '.isotone/active.json', '{"active":[]}', Date.now() + 2000);
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(1);

    write(root, 'src/App.jsx', 'export default function App() { return <button>Get started</button>; }\n', Date.now() + 2000);
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);
    expect(stored(root)[0]?.done).toBe(true);
  });

  // Any change counts, since a fix often lands away from the element's component; naming what was
  // counted shows when that was someone else's change.
  it('names the files it counted as the fix', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: new Date(Date.now() + 1000).toISOString() }]);
    write(root, 'README.md', 'unrelated\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('Counted as its fix, changed since the note: README.md.');

    notes(root, [{ id: 'bbbb2222', createdAt: ago(60_000) }]);
    expect(await runCli(['--working', 'bbbb'], captureIo(root))).toBe(0);
    for (const file of ['a.css', 'b.css', 'c.css', 'd.css', 'e.css', 'f.css']) write(root, `src/${file}`, 'a {}\n', Date.now() + 3000);
    expect(await runCli(['variant', 'new', 'hero-a', '--force'], captureIo(root))).toBe(0);
    const json = captureIo(join(root, 'src'));
    expect(await runCli(['--done', 'bbbb', '--json'], json)).toBe(0);
    expect(JSON.parse(json.text.out)).toHaveLength(1);
    // From where the agent runs; a variant is one change; past five, a count.
    expect(json.text.err).toContain('Counted as its fix, changed since --working: ../.isotone/variants/hero-a/, ../README.md, a.css,');
    expect(json.text.err).toContain('b.css, c.css and 3 more.');
    // A staged edit of a file written before is a change no modification time names.
    const fresh = repo();
    write(fresh, 'src/staged.css', 'a {}\n', Date.now() - 120_000);
    notes(fresh, [{ id: 'dddd4444', createdAt: ago(60_000) }]);
    expect(await runCli(['--working', 'dddd'], captureIo(fresh))).toBe(0);
    execFileSync('git', ['add', 'src/staged.css'], { cwd: fresh });
    const staged = captureIo(fresh);
    expect(await runCli(['--done', 'dddd'], staged)).toBe(0);
    expect(staged.text.out).toContain('Counted as its fix: a staged or committed change since --working.');

    // --force counts nothing.
    notes(root, [{ id: 'cccc3333', createdAt: ago(60_000) }]);
    const forced = captureIo(root);
    expect(await runCli(['--done', 'cccc', '--force'], forced)).toBe(0);
    expect(forced.text.out).not.toContain('Counted');
  });

  it('counts a fix that was committed after the note', async () => {
    const root = repo();
    notes(root, [{ id: 'cccc3333', createdAt: ago(60_000) }]);
    write(root, 'src/App.jsx', 'export default () => null;\n');
    execFileSync('git', ['commit', '-q', '-am', 'fix'], { cwd: root });
    expect(await runCli(['--done', 'cccc'], captureIo(root))).toBe(0);
  });

  it('measures from --working, and refuses every id or none', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(120_000) },
      { id: 'bbbb2222', createdAt: ago(120_000) },
    ]);
    // An edit made before the agent started on the note is not its fix.
    write(root, 'src/App.jsx', 'export default () => 1;\n', Date.now() - 60_000);
    expect(await runCli(['--working', 'aaaa'], captureIo(root))).toBe(0);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa', 'bbbb'], io)).toBe(1);
    expect(io.text.err).toContain('[aaaa1111] /: no file changed since you ran --working on it');
    expect(io.text.err).not.toContain('bbbb2222');
    expect(stored(root).map((n) => n.done)).toEqual([false, false]);
  });

  it('closes a note that needed no change with --force, and --force means nothing elsewhere', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: new Date(Date.now() + 1000).toISOString() }]);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa', '--force', '--json'], io)).toBe(0);
    expect(JSON.parse(io.text.out)).toMatchObject([{ id: 'aaaa1111', done: true }]);
    const bad = captureIo(root);
    expect(await runCli(['--undone', 'aaaa', '--force'], bad)).toBe(1);
    expect(bad.text.err).toContain('--force only goes with --done.');
  });

  it('counts a staged edit, a revert and a dropped uncommitted variant after --working', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000) },
      { id: 'bbbb2222', createdAt: ago(60_000) },
      { id: 'cccc3333', createdAt: ago(60_000) },
    ]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root });

    expect(await runCli(['--working', 'aaaa'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default () => 1;\n');
    git('add', 'src/App.jsx');
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);

    // Reverting the staged edit restores the committed file: still a change.
    expect(await runCli(['--working', 'bbbb'], captureIo(root))).toBe(0);
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(1);
    git('restore', '--staged', '--worktree', 'src/App.jsx');
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(0);

    expect(await runCli(['variant', 'new', 'alt', '--route', '/'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'alt', 'src/App.jsx'], captureIo(root))).toBe(0);
    expect(await runCli(['--working', 'cccc'], captureIo(root))).toBe(0);
    // Showing a variant is bookkeeping, not a fix.
    expect(await runCli(['variant', 'use', 'alt'], captureIo(root))).toBe(0);
    expect(await runCli(['--done', 'cccc'], captureIo(root))).toBe(1);
    expect(await runCli(['variant', 'drop', 'alt'], captureIo(root))).toBe(0);
    expect(await runCli(['--done', 'cccc'], captureIo(root))).toBe(0);
  });

  it('counts a fix made only in Git-ignored variant copies or knobs, with or without --working', async () => {
    const root = repo();
    write(root, '.gitignore', '.isotone/variants/\n.isotone/knobs.json\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'ignore'], { cwd: root });
    write(root, '.isotone/variants/b/src/App.jsx', 'export default () => 1;\n', Date.now() - 60_000);
    write(root, '.isotone/knobs.json', '[]', Date.now() - 60_000);
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(1000) },
      { id: 'bbbb2222', createdAt: ago(1000) },
      { id: 'cccc3333', createdAt: ago(1000) },
    ]);

    expect(await runCli(['--working', 'aaaa'], captureIo(root))).toBe(0);
    // Isotone's own lock beside the copies is not a fix.
    write(root, '.isotone/variants/b/variant.json.lock', '{}');
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(1);
    write(root, '.isotone/variants/b/src/App.jsx', 'export default () => 2;\n');
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);

    expect(await runCli(['--working', 'bbbb'], captureIo(root))).toBe(0);
    write(root, '.isotone/knobs.json', '[{"id":"size"}]');
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(0);

    // No --working: the copy's modification time counts.
    write(root, '.isotone/variants/b/src/App.jsx', 'export default () => 3;\n', Date.now() + 2000);
    expect(await runCli(['--done', 'cccc'], captureIo(root))).toBe(0);
  });

  it('counts a commit, and a further edit to a file already modified, after --working', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000) },
      { id: 'bbbb2222', createdAt: ago(60_000) },
    ]);
    // Edit on a clean tree and commit it: the tree is clean again, but HEAD moved.
    expect(await runCli(['--working', 'aaaa'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default () => 1;\n');
    execFileSync('git', ['commit', '-q', '-am', 'fix'], { cwd: root });
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);

    // Git's status line for a file modified before --working does not change on a second edit.
    write(root, 'src/App.jsx', 'export default () => 2;\n');
    expect(await runCli(['--working', 'bbbb'], captureIo(root))).toBe(0);
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(1);
    write(root, 'src/App.jsx', 'export default () => 3;\n');
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(0);
  });

  it('counts a deleted tracked file without --working', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: new Date(Date.now() + 1000).toISOString() }]);
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(1);
    rmSync(join(root, 'src/App.jsx'));
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);
  });

  it('counts a staged or restored file without --working too', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(1000) },
      { id: 'bbbb2222', createdAt: ago(1000) },
    ]);
    write(root, 'src/App.jsx', 'export default () => 1;\n', Date.now() + 2000);
    execFileSync('git', ['add', 'src/App.jsx'], { cwd: root });
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);
    execFileSync('git', ['restore', '--staged', '--worktree', 'src/App.jsx'], { cwd: root });
    expect(await runCli(['--done', 'bbbb'], captureIo(root))).toBe(0);
  });

  it('ignores only the notes file and its own side files, whatever --file is called', async () => {
    const root = repo();
    const file = join(root, 'src/feedback.json');
    writeFileSync(
      file,
      JSON.stringify([{ id: 'aaaa1111', route: '/', feedback: 'x', done: false, doneAt: null, element: null, createdAt: ago(1000) }]),
    );
    write(root, 'src/feedback.blast.json', '{}', Date.now() + 2000);
    write(root, 'src/feedback.json.lock', '{}', Date.now() + 2000);
    expect(await runCli(['--done', 'aaaa', '--file', 'src/feedback.json'], captureIo(root))).toBe(1);
    write(root, 'src/feedback-form.jsx', 'export default () => null;\n', Date.now() + 2000);
    expect(await runCli(['--done', 'aaaa', '--file', 'src/feedback.json'], captureIo(root))).toBe(0);
  });

  it('works without Git, skipping dependencies and build output', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-plain-')));
    dirs.push(root);
    write(root, 'index.html', '<h1>Hi</h1>', Date.now() - 60_000);
    notes(root, [{ id: 'aaaa1111', createdAt: ago(1000) }]);
    write(root, 'node_modules/x/index.js', '', Date.now() + 5000);
    write(root, '.next/cache.json', '{}', Date.now() + 5000);
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(1);
    write(root, 'index.html', '<h1>Hello</h1>', Date.now() + 5000);
    expect(await runCli(['--done', 'aaaa'], captureIo(root))).toBe(0);
  });
});

describe('--done and variants', () => {
  it('names variants on the route whose copies lack the fix, and one showing instead of the real file', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000) },
      { id: 'bbbb2222', createdAt: ago(60_000) },
      { id: 'cccc3333', createdAt: ago(60_000), route: '/pricing' },
    ]);
    for (const id of ['hero-left', 'hero-centered']) {
      expect(await runCli(['variant', 'new', id, '--route', '/', '--group', 'hero'], captureIo(root))).toBe(0);
      expect(await runCli(['variant', 'add', id, 'src/App.jsx'], captureIo(root))).toBe(0);
    }
    write(root, 'src/App.jsx', 'export default function App() { return <button>Get started</button>; }\n', Date.now() + 2000);

    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('These variants copy files changed since the note (or --working)');
    expect(io.text.out).toContain('hero-left (src/App.jsx): npx isotone variant sync hero-left');
    expect(io.text.out).toContain('hero-centered (src/App.jsx): npx isotone variant sync hero-centered');

    const listed = captureIo(root);
    expect(await runCli(['variant', 'list', '/'], listed)).toBe(0);
    expect(listed.text.out).toContain('`variant sync <id>` merges the change in: hero-left, hero-centered');

    // JSON keeps stdout one array and says the same on stderr.
    expect(await runCli(['variant', 'use', 'hero-left'], captureIo(root))).toBe(0);
    const json = captureIo(root);
    expect(await runCli(['--done', 'bbbb', '--json'], json)).toBe(0);
    expect(JSON.parse(json.text.out)).toHaveLength(1);
    expect(json.text.err).toContain('npx isotone variant sync hero-left');
    expect(json.text.err).toContain('The reviewer may be looking at one of these copies, without your fix');
    expect(json.text.err).toContain(
      '  hero-left (src/App.jsx): active in .isotone/active.json, which tabs without a pick of their own show',
    );
    expect(json.text.err).not.toContain('hero-centered (src/App.jsx): active');
    // Switching the server's default would move every tab that follows it, so it is not offered.
    expect(json.text.err).not.toContain('variant use default');

    // Another page's note says nothing about these.
    const other = captureIo(root);
    expect(await runCli(['--done', 'cccc'], other)).toBe(0);
    expect(other.text.out).not.toContain('variant sync');
  });

  it('says nothing of an active variant that copies none of the files the fix changed', async () => {
    const root = repo();
    write(root, 'src/index.css', 'body { margin: 0; }\n', Date.now() - 120_000);
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000) }]);
    expect(await runCli(['variant', 'new', 'pricing-featured', '--route', '/'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'pricing-featured', 'src/App.jsx'], captureIo(root))).toBe(0);
    // Another tab's pick, now the server's default.
    expect(await runCli(['variant', 'use', 'pricing-featured'], captureIo(root))).toBe(0);
    write(root, 'src/index.css', 'body { margin: 8px; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).not.toContain('pricing-featured (');
    expect(io.text.out).not.toContain('variant use');
  });

  it("goes by the option a note is about, or the pick it was written with, over the server's default", async () => {
    const root = repo();
    const about = (optionId: string) => ({ axisId: 'hero', label: 'Hero', optionId });
    // "Feedback on this selector" names no option, only the tab's pick as `value`.
    const picked = (value: string) => ({ axisId: 'hero', label: 'Hero', value });
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000), variant: about('default') },
      { id: 'bbbb2222', createdAt: ago(60_000), variant: about('hero-centered') },
      { id: 'cccc3333', createdAt: ago(60_000), variant: picked('default') },
      { id: 'dddd4444', createdAt: ago(60_000), variant: picked('hero-centered') },
    ]);
    for (const id of ['hero-left', 'hero-centered']) {
      expect(await runCli(['variant', 'new', id, '--route', '/', '--group', 'hero'], captureIo(root))).toBe(0);
      expect(await runCli(['variant', 'add', id, 'src/App.jsx'], captureIo(root))).toBe(0);
    }
    expect(await runCli(['variant', 'use', 'hero-left'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default function App() { return <button>Start</button>; }\n', Date.now() + 2000);

    // Written on Default: the page showed the real file, whatever the server's default says.
    const onDefault = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], onDefault)).toBe(0);
    expect(onDefault.text.out).toContain('hero-left (src/App.jsx): npx isotone variant sync hero-left');
    expect(onDefault.text.out).not.toContain('The reviewer may be looking');

    const onCentered = captureIo(root);
    expect(await runCli(['--done', 'bbbb'], onCentered)).toBe(0);
    expect(onCentered.text.out).toContain('  hero-centered (src/App.jsx): the note is about this option');
    expect(onCentered.text.out).not.toContain('hero-left (src/App.jsx): active');

    const pickedDefault = captureIo(root);
    expect(await runCli(['--done', 'cccc'], pickedDefault)).toBe(0);
    expect(pickedDefault.text.out).not.toContain('The reviewer may be looking');

    const pickedCentered = captureIo(root);
    expect(await runCli(['--done', 'dddd'], pickedCentered)).toBe(0);
    expect(pickedCentered.text.out).toContain('  hero-centered (src/App.jsx): picked when the note was written');
  });

  it('sends a copy with no recorded base to a comparison by hand, not to variant sync', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000) }]);
    expect(await runCli(['variant', 'new', 'hero-old', '--route', '/'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'hero-old', 'src/App.jsx'], captureIo(root))).toBe(0);
    // What a copy made outside a Git repository records.
    const manifest = join(root, '.isotone', 'variants', 'hero-old', 'variant.json');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    parsed.files['src/App.jsx'].base = null;
    writeFileSync(manifest, JSON.stringify(parsed));
    write(root, 'src/App.jsx', 'export default function App() { return <button>Go</button>; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).not.toContain('variant sync hero-old');
    expect(io.text.out).toContain(
      'so `variant sync` cannot merge the fix. Compare each with its real file by hand:\n  hero-old (src/App.jsx)',
    );
  });

  it('names an active copy of a stylesheet whatever the note was on, since every tab follows it', async () => {
    const root = repo();
    write(root, 'src/index.css', 'body { margin: 0; }\n', Date.now() - 120_000);
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000), variant: { axisId: 'theme', label: 'Theme', value: 'default' } }]);
    expect(await runCli(['variant', 'new', 'theme-dark', '--route', '/', '--group', 'theme'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'theme-dark', 'src/index.css'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'use', 'theme-dark'], captureIo(root))).toBe(0);
    write(root, 'src/index.css', 'body { margin: 8px; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('  theme-dark (src/index.css): active in .isotone/active.json, which every tab follows for a stylesheet');
    // A tab already on Default still shows the copy until Default is the latest pick.
    expect(io.text.out).toContain('(a stylesheet: once Default is the latest pick in any tab)');
  });

  it('sends a copy with no recorded base to a comparison by hand, and offers no sync without Git', async () => {
    const root = repo();
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000) },
      { id: 'bbbb2222', createdAt: ago(60_000) },
    ]);
    for (const id of ['old', 'new']) {
      expect(await runCli(['variant', 'new', id, '--route', '/'], captureIo(root))).toBe(0);
      expect(await runCli(['variant', 'add', id, 'src/App.jsx'], captureIo(root))).toBe(0);
    }
    // What Isotone 1.5.0 recorded for a copy made outside a repository.
    const manifest = join(root, '.isotone/variants/old/variant.json');
    const old = JSON.parse(readFileSync(manifest, 'utf8'));
    old.files['src/App.jsx'].base = null;
    writeFileSync(manifest, JSON.stringify(old));
    write(root, 'src/App.jsx', 'export default function App() { return <button>Get started</button>; }\n', Date.now() + 2000);

    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('new (src/App.jsx): npx isotone variant sync new');
    // One list, by hand, for copies with no base (see the test above): the merge's combined wording.
    expect(io.text.out).toContain('Compare each with its real file by hand:\n  old (src/App.jsx)');
    expect(io.text.out).not.toContain('variant sync old');

    vi.stubEnv('PATH', '');
    try {
      const noGit = captureIo(root);
      expect(await runCli(['--done', 'bbbb'], noGit)).toBe(0);
      expect(noGit.text.out).toContain('  new (src/App.jsx)\n');
      expect(noGit.text.out).toContain('Git is not installed, so `variant sync` cannot merge the change in');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // #61 trusts a note's own pick over .isotone/active.json because a live tab keeps its own; #63 tells
  // the setups apart. Where picks are shared (no React, Vite 5, `live: false`), every tab shows
  // active.json, whatever the note was written on.
  it('names an active copy every tab shows where picks are shared, whatever the note was written on', async () => {
    const root = repo();
    write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '^7.0.0', vue: '^3.5.0' } }));
    write(root, 'vite.config.ts', "import { isotone } from 'isotone/vite';\nexport default { plugins: [isotone()] };\n");
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000), variant: { axisId: 'hero', label: 'Hero', optionId: 'default' } }]);
    for (const id of ['hero-left', 'hero-centered']) {
      expect(await runCli(['variant', 'new', id, '--route', '/', '--group', 'hero'], captureIo(root))).toBe(0);
      expect(await runCli(['variant', 'add', id, 'src/App.jsx'], captureIo(root))).toBe(0);
    }
    // Picked after the note was written: in this setup it changed every tab.
    expect(await runCli(['variant', 'use', 'hero-left'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default function App() { return <button>Start</button>; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('  hero-left (src/App.jsx): active in .isotone/active.json, which every tab shows here');
    expect(io.text.out).not.toContain('hero-centered (src/App.jsx): active');
    expect(io.text.out).toContain('since `variant use` moves every tab here.');
  });

  // Next runs no Vite plugin, so no copy is served (#63): the page shows the fix, whatever is active,
  // and a copy made there anyway (--force) needs no sync.
  it('says nothing of variants where nothing serves them', async () => {
    const root = repo();
    write(root, 'package.json', JSON.stringify({ dependencies: { next: '16.0.0', react: '^19.0.0' } }));
    write(root, 'next.config.ts', 'export default {};\n');
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000), variant: { axisId: 'hero', label: 'Hero', optionId: 'hero-left' } }]);
    expect(await runCli(['variant', 'new', 'hero-left', '--route', '/', '--group', 'hero', '--force'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'hero-left', 'src/App.jsx', '--force'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'use', 'hero-left', '--force'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default function App() { return <button>Start</button>; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).not.toContain('variant sync');
    expect(io.text.out).not.toContain('The reviewer may be looking');
  });

  // #69 records the picks a note was written under. In live switching (#61) those are the tab's own,
  // so a note pinned to an element (about no selector) still says which copy its reviewer saw.
  it('names the copy a note was written under, from its selections, though active.json moved on', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000), selections: { hero: 'hero-left' } }]);
    for (const id of ['hero-left', 'hero-centered']) {
      expect(await runCli(['variant', 'new', id, '--route', '/', '--group', 'hero'], captureIo(root))).toBe(0);
      expect(await runCli(['variant', 'add', id, 'src/App.jsx'], captureIo(root))).toBe(0);
    }
    // Another tab went back to Default since.
    expect(await runCli(['variant', 'use', 'default'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default function App() { return <button>Start</button>; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('  hero-left (src/App.jsx): picked when the note was written');
    expect(io.text.out).not.toContain('hero-centered (src/App.jsx): picked');
  });

  // #69's listing names a pick that is a variant's id, read with listVariants; #66 leaves 1.5.0's
  // copies without a base, which listVariants still lists.
  it("says a note's pick ran a variant copy, even one with no recorded base", async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000), selections: { hero: 'hero-left' } }]);
    expect(await runCli(['variant', 'new', 'hero-left', '--route', '/', '--group', 'hero'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'hero-left', 'src/App.jsx'], captureIo(root))).toBe(0);
    const manifest = join(root, '.isotone/variants/hero-left/variant.json');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    parsed.files['src/App.jsx'].base = null;
    writeFileSync(manifest, JSON.stringify(parsed));
    const io = captureIo(root);
    expect(await runCli([], io)).toBe(0);
    expect(io.text.out).toContain(
      '⊙ selections: hero=hero-left (the page showed these, not the defaults; source lines may be lines of the active variant copy)',
    );
  });

  it('names copies on the route that still hold conflict markers', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(60_000) }]);
    expect(await runCli(['variant', 'new', 'hero', '--route', '/'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'hero', 'src/App.jsx'], captureIo(root))).toBe(0);
    writeFileSync(join(root, '.isotone/variants/hero/src/App.jsx'), '<<<<<<< variant\na\n=======\nb\n>>>>>>> real\n');
    write(root, 'src/App.jsx', 'export default function App() { return <button>Join</button>; }\n', Date.now() + 2000);
    const io = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], io)).toBe(0);
    expect(io.text.out).toContain('These copies still hold conflict markers');
    // A path to open, in the platform's own separators.
    expect(io.text.out).toContain(`  hero: ${join('.isotone', 'variants', 'hero', 'src', 'App.jsx')}`);
  });

  it('names only copies of files changed since --working on the note', async () => {
    const root = repo();
    write(root, 'src/App.css', 'button { color: red; }\n');
    notes(root, [
      { id: 'aaaa1111', createdAt: ago(60_000) },
      { id: 'bbbb2222', createdAt: ago(60_000) },
    ]);
    expect(await runCli(['variant', 'new', 'hero-split', '--route', '/'], captureIo(root))).toBe(0);
    expect(await runCli(['variant', 'add', 'hero-split', 'src/App.jsx'], captureIo(root))).toBe(0);
    expect(await runCli(['--working', 'aaaa'], captureIo(root))).toBe(0);
    write(root, 'src/App.jsx', 'export default () => 1;\n');
    const first = captureIo(root);
    expect(await runCli(['--done', 'aaaa'], first)).toBe(0);
    expect(first.text.out).toContain('hero-split (src/App.jsx)');

    // Note B's fix touched only the stylesheet: the stale copy is not its business.
    expect(await runCli(['--working', 'bbbb'], captureIo(root))).toBe(0);
    write(root, 'src/App.css', 'button { color: blue; }\n', Date.now() + 5000);
    const second = captureIo(root);
    expect(await runCli(['--done', 'bbbb'], second)).toBe(0);
    expect(second.text.out).not.toContain('variant sync');
  });
});

describe('from a subdirectory', () => {
  it("finds the app's notes file above it and says which one, on stderr", async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(1000) }]);
    const io = captureIo(join(root, 'src'));
    expect(await runCli(['--json'], io)).toBe(0);
    expect(JSON.parse(io.text.out)).toMatchObject([{ id: 'aaaa1111' }]);
    expect(io.text.err).toContain(`Notes: ${join('..', NOTES)}`);
    write(root, 'src/App.jsx', 'export default () => 1;\n', Date.now() + 2000);
    expect(await runCli(['--done', 'aaaa'], captureIo(join(root, 'src')))).toBe(0);
    expect(stored(root)[0]?.done).toBe(true);
  });
});

describe('what an agent reads', () => {
  it('prints the version', async () => {
    for (const flag of ['--version', '-v']) {
      const io = captureIo(repo());
      expect(await runCli([flag], io)).toBe(0);
      expect(io.text.out).toBe(`${version}\n`);
    }
  });

  it('labels the viewport and leaves the reply fingerprint out of the record', async () => {
    const root = repo();
    notes(root, [{ id: 'aaaa1111', createdAt: ago(1000), viewport: { w: 1280, h: 800 } }]);
    expect(await runCli(['--reply', 'aaaa', 'Which button?'], captureIo(root))).toBe(0);
    const listed = captureIo(root);
    expect(await runCli([], listed)).toBe(0);
    expect(listed.text.out).toContain('· viewport 1280×800)');
    const json = captureIo(root);
    expect(await runCli(['--json'], json)).toBe(0);
    const [record] = JSON.parse(json.text.out);
    expect(record.reply).toEqual({ text: 'Which button?', at: expect.any(String) });
  });

  it('has init say the real design is the Default, and how a busy port is handled', async () => {
    const vite = repo();
    write(vite, 'vite.config.js', 'export default {};\n');
    const overlay = captureIo(vite);
    expect(await runCli(['init'], overlay)).toBe(0);
    expect(overlay.text.out.replace(/\s+/g, ' ')).toContain(
      'the real file stays as it is and is the selector’s Default, and you add two file variants in one group, each different from it.',
    );
    const plain = captureIo(repo());
    expect(await runCli(['init'], plain)).toBe(0);
    expect(plain.text.out.replace(/\s+/g, ' ')).toContain('`tag` line for that port: paste it in step 2 as printed.');
    const next = repo();
    write(next, 'next.config.js', 'module.exports = {};\n');
    const nextIo = captureIo(next);
    expect(await runCli(['init'], nextIo)).toBe(0);
    expect(nextIo.text.out.replace(/\s+/g, ' ')).toContain('`panel` URL for that port: use it as the src in step 2.');
  });

  it('has serve print the loader tag for the port it listens on', () => {
    const lines = serveBanner({ url: 'http://127.0.0.1:4177', bundleUrl: 'http://127.0.0.1:4177/isotone.js' }, '/app/notes.json');
    const tag = lines.find((line) => line.startsWith('  tag    '));
    expect(tag).toContain("src:'http://127.0.0.1:4177/isotone.js'");
    expect(tag).toContain('location.hostname');
  });

  it('prints guide paths that exist, wherever the package is installed', () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-docs-')));
    dirs.push(project);
    const app = join(project, 'apps/web');
    mkdirSync(app, { recursive: true });
    // Hoisted to the workspace root: a relative path up to it.
    const hoisted = join(project, 'node_modules/isotone');
    expect(docPath(app, 'docs/agent-guide.md', hoisted)).toBe('../../node_modules/isotone/docs/agent-guide.md');
    // An npx cache outside the project: absolute, in the platform's separators.
    const npx = resolve('/cache/_npx/1/node_modules/isotone');
    expect(docPath(app, 'docs/agent-guide.md', npx)).toBe(join(npx, 'docs', 'agent-guide.md'));
    // In the project's own node_modules (a pnpm symlink, say): the short path.
    write(app, 'node_modules/isotone/docs/agent-guide.md', '# Agent guide');
    expect(docPath(app, 'docs/agent-guide.md', '/elsewhere')).toBe('node_modules/isotone/docs/agent-guide.md');
  });
});

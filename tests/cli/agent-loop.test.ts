import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

function notes(root: string, list: { id: string; createdAt: string; route?: string; viewport?: { w: number; h: number } }[]): void {
  write(
    root,
    NOTES,
    JSON.stringify(list.map((n) => ({ route: '/', feedback: `fix ${n.id}`, done: false, doneAt: null, element: null, ...n }))),
  );
}

function stored(root: string): { id: string; done: boolean }[] {
  return JSON.parse(readFileSync(join(root, NOTES), 'utf8'));
}

function repo(): string {
  const root = tempGitRepo('isotone-loop-', dirs);
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
    expect(json.text.err).toContain('Active now, so the page shows its copy instead of the real file: hero-left.');

    // Another page's note says nothing about these.
    const other = captureIo(root);
    expect(await runCli(['--done', 'cccc'], other)).toBe(0);
    expect(other.text.out).not.toContain('variant sync');
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
    expect(io.text.out).toContain('  hero: .isotone/variants/hero/src/App.jsx');
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
    // An npx cache outside the project: absolute.
    expect(docPath(app, 'docs/agent-guide.md', '/cache/_npx/1/node_modules/isotone')).toBe(
      '/cache/_npx/1/node_modules/isotone/docs/agent-guide.md',
    );
    // In the project's own node_modules (a pnpm symlink, say): the short path.
    write(app, 'node_modules/isotone/docs/agent-guide.md', '# Agent guide');
    expect(docPath(app, 'docs/agent-guide.md', '/elsewhere')).toBe('node_modules/isotone/docs/agent-guide.md');
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run';
import type { StyleEdit } from '../src/core/style';
import { notesResponse, readNotes } from '../src/store';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'isotone-style-'));
  dirs.push(dir);
  return dir;
}

const post = (file: string, body: unknown) => notesResponse(file, { method: 'POST', url: '/api/iteration/notes', body });

const element = { tag: 'article', text: 'Active projects', selector: '#cards > article:nth-child(1)', attributes: { class: 'card' } };
const styleEdits: StyleEdit[] = [{
  selector: element.selector,
  classes: ['card'],
  changes: [
    { property: 'padding-top', from: '18px', to: '24px', rule: '.cards article', declared: 'padding: var(--card-padding, 18px)', tokens: { '--card-padding': '18px' }, matches: ['--space-6'] },
    { property: 'border-radius', from: '11px', to: '16px' },
  ],
}];

describe('style edits in the note store', () => {
  it('round-trips, keeps the diff on a text-only edit, and removes it with an empty list', () => {
    const file = join(tempDir(), 'notes.json');
    const created = post(file, { route: '/', feedback: 'Roomier cards', elements: [element], styleEdits });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(readNotes(file)[0].styleEdits).toEqual(styleEdits);
    expect(notesResponse(file, { method: 'GET', url: '/api/iteration/notes' }).body).toMatchObject([{ styleEdits }]);

    post(file, { id, route: '/', feedback: 'Roomier cards, please' });
    expect(readNotes(file)[0].styleEdits).toEqual(styleEdits);

    post(file, { id, route: '/', feedback: 'Never mind the styles', styleEdits: [] });
    expect(readNotes(file)[0]).not.toHaveProperty('styleEdits');
  });

  it('rejects a non-list and drops malformed entries', () => {
    const file = join(tempDir(), 'notes.json');
    expect(post(file, { route: '/', feedback: 'x', styleEdits: { selector: 'p' } }).status).toBe(400);
    post(file, { route: '/', feedback: 'y', styleEdits: [{ selector: 'p', changes: [{ property: 'color' }] }, ...styleEdits] });
    expect(readNotes(file)[0].styleEdits).toEqual(styleEdits);
  });

  it('leaves notes without style edits exactly as before', () => {
    const file = join(tempDir(), 'notes.json');
    post(file, { route: '/', feedback: 'Plain note', elements: [element] });
    expect(readNotes(file)[0]).not.toHaveProperty('styleEdits');
  });
});

describe('the opt-in flag', () => {
  it('reaches the served mount call only when enabled', async () => {
    const { serveIteration } = await import('../src/serve/index');
    const on = await serveIteration({ file: join(tempDir(), 'notes.json'), port: 0, checkForUpdates: false, experimental: { styleEditor: true } });
    const off = await serveIteration({ file: join(tempDir(), 'notes.json'), port: 0, checkForUpdates: false });
    try {
      const tail = async (url: string) => (await (await fetch(url)).text()).slice(-2000);
      expect((await tail(on.bundleUrl)).includes('"experimental":{"styleEditor":true}')).toBe(true);
      expect((await tail(off.bundleUrl)).includes('"experimental"')).toBe(false);
    } finally {
      await on.close();
      await off.close();
    }
  });
});

describe('style edits in the CLI', () => {
  function io(cwd: string) {
    const text = { out: '', err: '' };
    return { cwd, stdout: { write: (s: string) => { text.out += s; } }, stderr: { write: (s: string) => { text.err += s; } }, text };
  }
  function seed() {
    const dir = tempDir();
    writeFileSync(join(dir, '.iteration-feedback.json'), JSON.stringify([
      { id: 'style-note-1', route: '/', feedback: 'Style: padding-top 18px → 24px', element, elements: [element], styleEdits,
        done: false, doneAt: null, createdAt: new Date().toISOString() },
      { id: 'plain-note-1', route: '/', feedback: 'Plain', element: null, done: false, doneAt: null, createdAt: new Date().toISOString() },
    ]));
    return dir;
  }

  it('prints each change under its element with the rule, tokens and a hint to use the project’s styling', async () => {
    const dir = seed();
    const cli = io(dir);
    expect(await runCli([], cli)).toBe(0);
    const out = cli.text.out;
    expect(out).toContain('    classes: card');
    expect(out).toContain('    style: padding-top 18px → 24px  (rule .cards article; declared padding: var(--card-padding, 18px); --card-padding: 18px; to equals --space-6)');
    expect(out).toContain('    style: border-radius 11px → 16px');
    expect(out).toMatch(/rather than adding inline styles/);
    expect(out.indexOf('style: padding-top')).toBeGreaterThan(out.indexOf('↳ <article> "Active projects"'));
  });

  it('keeps the structured diff in --json and adds a hint only to notes that carry one', async () => {
    const dir = seed();
    const cli = io(dir);
    expect(await runCli(['--json'], cli)).toBe(0);
    const records = JSON.parse(cli.text.out) as Record<string, unknown>[];
    const styled = records.find((r) => r.id === 'style-note-1');
    const plain = records.find((r) => r.id === 'plain-note-1');
    expect(styled?.styleEdits).toEqual(styleEdits);
    expect(styled?.styleHint).toMatch(/project's own styling/);
    expect(plain).not.toHaveProperty('styleHint');
    expect(plain).not.toHaveProperty('styleEdits');
    expect(JSON.parse(readFileSync(join(dir, '.iteration-feedback.json'), 'utf8'))).toHaveLength(2);
  });
});

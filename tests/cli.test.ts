import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

/** A real git repo, since `variant add`/`sync` hash blobs through `git`. */
function tempRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-cli-')));
  dirs.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function commit(root: string, file: string, contents: string): void {
  const abs = join(root, file);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contents);
  execFileSync('git', ['add', file], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
}

/** An in-memory `CliIO` that captures everything runCli writes, so tests
 *  assert on output the same way a person reading a terminal would. */
function makeIo(cwd: string) {
  const text = { out: '', err: '' };
  return {
    cwd,
    stdout: { write: (s: string) => { text.out += s; } },
    stderr: { write: (s: string) => { text.err += s; } },
    text,
  };
}

describe('notes (unchanged default behaviour)', () => {
  it('prints "No open iteration notes" for an empty file', async () => {
    const root = tempRepo();
    const io = makeIo(root);
    const code = await runCli([], io);
    expect(code).toBe(0);
    expect(io.text.out).toContain('No open iteration notes');
  });

  it('rejects an unknown option instead of listing notes', async () => {
    const io = makeIo(tempRepo());
    expect(await runCli(['--bogus'], io)).toBe(1);
    expect(io.text.err).toContain('Unknown option "--bogus"');
    expect(io.text.out).toBe('');
  });
});

describe('--help', () => {
  it('prints the command surface for the root, variant, init and serve', async () => {
    const root = tempRepo();
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const io = makeIo(root);
      expect(await runCli(argv, io)).toBe(0);
      expect(io.text.out).toContain('isotone serve');
      expect(io.text.out).toContain('isotone init');
    }
    const variant = makeIo(root);
    expect(await runCli(['variant', '--help'], variant)).toBe(0);
    expect(variant.text.out).toContain('variant promote <id> [--force]');
    expect(variant.text.out).toContain('--group <id>');
    expect(variant.text.out).toContain('variant off <id>');
    expect(variant.text.out).toContain('variant group <id> <groupId>');
    expect(variant.text.out).toContain('variant use default [<groupId>]');
    const init = makeIo(root);
    expect(await runCli(['init', '--help'], init)).toBe(0);
    expect(init.text.out).toContain('--approach <name>');
    const serve = makeIo(root);
    expect(await runCli(['serve', '--help'], serve)).toBe(0);
    expect(serve.text.out).toContain('--port 4123');
  });

  it('bare `variant` prints the same help and exits 1', async () => {
    const io = makeIo(tempRepo());
    expect(await runCli(['variant'], io)).toBe(1);
    expect(io.text.out).toContain('variant list');
  });
});

describe('variant', () => {
  it('runs new -> add -> list -> use -> sync (noop) -> path -> promote', async () => {
    const root = tempRepo();
    commit(root, 'src/Hero.tsx', 'export const Hero = () => "hello";\n');

    let io = makeIo(root);
    expect(
      await runCli(
        ['variant', 'new', 'bold-cta', '--label', 'Bold CTA', '--route', '/pricing'],
        io,
      ),
    ).toBe(0);
    expect(io.text.out).toContain('created "bold-cta"');

    io = makeIo(root);
    expect(await runCli(['variant', 'add', 'bold-cta', 'src/Hero.tsx'], io)).toBe(0);
    expect(io.text.out).toContain('added 1 file(s) to "bold-cta"');
    expect(existsSync(join(root, '.isotone/variants/bold-cta/src/Hero.tsx'))).toBe(true);

    io = makeIo(root);
    expect(await runCli(['variant', 'list'], io)).toBe(0);
    expect(io.text.out).toContain('bold-cta');
    expect(io.text.out).toContain('Bold CTA');
    expect(io.text.out).toContain('/pricing');

    io = makeIo(root);
    expect(await runCli(['variant', 'use', 'bold-cta'], io)).toBe(0);
    expect(io.text.out).toContain('active: "bold-cta"');

    // Nothing changed since add, so sync is a no-op: everything is unchanged.
    io = makeIo(root);
    expect(await runCli(['variant', 'sync', 'bold-cta'], io)).toBe(0);
    expect(io.text.out).toContain('merged: none');
    expect(io.text.out).toContain('conflicts: none');
    expect(io.text.out).toContain('unchanged: src/Hero.tsx');

    io = makeIo(root);
    expect(await runCli(['variant', 'path', 'bold-cta', 'src/Hero.tsx'], io)).toBe(0);
    expect(io.text.out.trim()).toBe(join(root, '.isotone/variants/bold-cta/src/Hero.tsx'));

    io = makeIo(root);
    expect(await runCli(['variant', 'promote', 'bold-cta'], io)).toBe(0);
    expect(io.text.out).toContain('promoted "bold-cta"');
    expect(existsSync(join(root, '.isotone/variants/bold-cta'))).toBe(false);
  });

  it('adds and removes a tracked file', async () => {
    const root = tempRepo();
    commit(root, 'src/a.ts', 'export const a = 1;\n');
    await runCli(['variant', 'new', 'v1'], makeIo(root));

    const addIo = makeIo(root);
    expect(await runCli(['variant', 'add', 'v1', 'src/a.ts'], addIo)).toBe(0);
    expect(addIo.text.out).toContain('added 1 file(s)');

    const rmIo = makeIo(root);
    expect(await runCli(['variant', 'rm', 'v1', 'src/a.ts'], rmIo)).toBe(0);
    expect(rmIo.text.out).toContain('removed "src/a.ts" from "v1"');
  });

  it('promote takes --force before the id as well as after it', async () => {
    const root = tempRepo();
    commit(root, 'src/a.ts', 'export const a = 1;\n');
    await runCli(['variant', 'new', 'f'], makeIo(root));
    await runCli(['variant', 'add', 'f', 'src/a.ts'], makeIo(root));
    // The real file moves on, so an unforced promote refuses as stale.
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2;\n');
    expect(await runCli(['variant', 'promote', 'f'], makeIo(root))).toBe(1);

    // `--force` first used to be read as the id.
    const io = makeIo(root);
    expect(await runCli(['variant', 'promote', '--force', 'f'], io)).toBe(0);
    expect(io.text.out).toContain('promoted "f"');
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('drops a variant, and refuses one that does not exist', async () => {
    const root = tempRepo();
    await runCli(['variant', 'new', 'drop-me'], makeIo(root));
    const io = makeIo(root);
    expect(await runCli(['variant', 'drop', 'drop-me'], io)).toBe(0);
    expect(io.text.out).toContain('dropped "drop-me"');
    expect(existsSync(join(root, '.isotone/variants/drop-me'))).toBe(false);

    const again = makeIo(root);
    expect(await runCli(['variant', 'drop', 'drop-me'], again)).toBe(1);
    expect(again.text.err).toContain('No variant "drop-me"');
  });

  it('use default writes an empty active set', async () => {
    const root = tempRepo();
    await runCli(['variant', 'new', 'v1'], makeIo(root));
    await runCli(['variant', 'use', 'v1'], makeIo(root));
    const io = makeIo(root);
    expect(await runCli(['variant', 'use', 'default'], io)).toBe(0);
    expect(io.text.out).toContain('active: default');
    expect(
      JSON.parse(readFileSync(join(root, '.isotone/active.json'), 'utf8')).active,
    ).toEqual([]);
  });

  it('use activates alongside other groups and replaces only its own siblings', async () => {
    const root = tempRepo();
    commit(root, 'src/Table.tsx', 'export const Table = () => "rows";\n');
    commit(root, 'src/Settings.tsx', 'export const Settings = () => "form";\n');
    // Two table variants share a file, so they are one group without saying so.
    await runCli(['variant', 'new', 'table-dense'], makeIo(root));
    await runCli(['variant', 'add', 'table-dense', 'src/Table.tsx'], makeIo(root));
    await runCli(['variant', 'new', 'table-striped'], makeIo(root));
    await runCli(['variant', 'add', 'table-striped', 'src/Table.tsx'], makeIo(root));
    // Two settings variants touch different files and are grouped by name.
    await runCli(['variant', 'new', 'settings-tabs', '--group', 'settings'], makeIo(root));
    await runCli(['variant', 'add', 'settings-tabs', 'src/Settings.tsx'], makeIo(root));
    await runCli(
      ['variant', 'new', 'settings-side', '--group', 'settings', '--group-label', 'Settings'],
      makeIo(root),
    );
    const active = () =>
      JSON.parse(readFileSync(join(root, '.isotone/active.json'), 'utf8')).active;

    expect(await runCli(['variant', 'use', 'table-dense'], makeIo(root))).toBe(0);
    let io = makeIo(root);
    expect(await runCli(['variant', 'use', 'settings-tabs'], io)).toBe(0);
    expect(io.text.out).toContain('active: "settings-tabs" (also active: "table-dense")');
    expect(active()).toEqual(['table-dense', 'settings-tabs']);

    // A sibling takes its group's slot; the other group stays.
    io = makeIo(root);
    expect(await runCli(['variant', 'use', 'table-striped'], io)).toBe(0);
    expect(active()).toEqual(['settings-tabs', 'table-striped']);
    expect(await runCli(['variant', 'use', 'settings-side'], makeIo(root))).toBe(0);
    expect(active()).toEqual(['table-striped', 'settings-side']);

    // list marks every active variant and shows the group.
    io = makeIo(root);
    expect(await runCli(['variant', 'list'], io)).toBe(0);
    const rows = io.text.out.trim().split('\n');
    expect(rows[0]).toMatch(/^ID\s+LABEL\s+GROUP\s+ROUTE/);
    expect(rows.filter((r) => r.trimEnd().endsWith('*')).map((r) => r.split(/\s+/)[0])).toEqual([
      'table-striped',
      'settings-side',
    ]);
    expect(rows.find((r) => r.startsWith('settings-tabs'))).toContain('settings');
    expect(rows.find((r) => r.startsWith('table-dense'))).toContain('table-dense+table-striped');

    // use default <group> clears one group; off clears one variant.
    io = makeIo(root);
    expect(await runCli(['variant', 'use', 'default', 'settings'], io)).toBe(0);
    expect(io.text.out).toContain('active: default for settings (also active: "table-striped")');
    expect(active()).toEqual(['table-striped']);
    io = makeIo(root);
    expect(await runCli(['variant', 'use', 'default', 'nope'], io)).toBe(1);
    expect(io.text.err).toContain('No group "nope"');
    io = makeIo(root);
    expect(await runCli(['variant', 'off', 'table-striped'], io)).toBe(0);
    expect(io.text.out).toContain('off: "table-striped"');
    expect(active()).toEqual([]);
    expect(await runCli(['variant', 'off', 'nope'], makeIo(root))).toBe(1);
  });

  it('group puts an existing variant into a group and the manifest carries it', async () => {
    const root = tempRepo();
    await runCli(['variant', 'new', 'a'], makeIo(root));
    await runCli(['variant', 'new', 'b'], makeIo(root));
    let io = makeIo(root);
    expect(await runCli(['variant', 'group', 'a', 'layout'], io)).toBe(0);
    expect(io.text.out).toContain('"a" is now in group layout');
    io = makeIo(root);
    expect(await runCli(['variant', 'group', 'b', 'layout', '--label', 'Layout'], io)).toBe(0);
    const manifest = (id: string) =>
      JSON.parse(readFileSync(join(root, `.isotone/variants/${id}/variant.json`), 'utf8'));
    expect(manifest('a').group).toBe('layout');
    expect(manifest('a').groupLabel).toBeUndefined();
    expect(manifest('b')).toMatchObject({ group: 'layout', groupLabel: 'Layout' });

    io = makeIo(root);
    expect(await runCli(['variant', 'list'], io)).toBe(0);
    expect(io.text.out.split('\n').filter((r) => r.includes('layout'))).toHaveLength(2);

    expect(await runCli(['variant', 'group', 'a', 'Bad Group'], makeIo(root))).toBe(1);
    expect(await runCli(['variant', 'group', 'nope', 'layout'], makeIo(root))).toBe(1);
    expect(await runCli(['variant', 'group', 'a'], makeIo(root))).toBe(1);
  });

  it('new --group records the group and refuses a bad one', async () => {
    const root = tempRepo();
    const io = makeIo(root);
    expect(
      await runCli(
        ['variant', 'new', 'tabs', '--group', 'settings', '--group-label', 'Settings layout'],
        io,
      ),
    ).toBe(0);
    expect(io.text.out).toContain('created "tabs" in group settings');
    const manifest = JSON.parse(
      readFileSync(join(root, '.isotone/variants/tabs/variant.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ group: 'settings', groupLabel: 'Settings layout' });
    const bad = makeIo(root);
    expect(await runCli(['variant', 'new', 'x', '--group', 'Not Ok'], bad)).toBe(1);
    expect(bad.text.err).toContain('Invalid group id');
    expect(existsSync(join(root, '.isotone/variants/x'))).toBe(false);
  });

  it('--dir overrides the variants directory', async () => {
    const root = tempRepo();
    const io = makeIo(root);
    expect(await runCli(['variant', '--dir', 'custom-variants', 'new', 'v1'], io)).toBe(0);
    expect(existsSync(join(root, 'custom-variants/v1/variant.json'))).toBe(true);
    expect(existsSync(join(root, '.isotone/variants/v1'))).toBe(false);
  });

  it('new --note copies route and element from the matching note', async () => {
    const root = tempRepo();
    writeFileSync(
      join(root, '.iteration-feedback.json'),
      JSON.stringify([
        {
          id: 'note-aaaa1111',
          route: '/pricing',
          feedback: 'make it pop',
          element: { tag: 'button', text: 'Buy', selector: '#buy' },
          done: false,
          doneAt: null,
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    const io = makeIo(root);
    expect(await runCli(['variant', 'new', 'pop-cta', '--note', 'note-aaaa'], io)).toBe(0);

    const listIo = makeIo(root);
    await runCli(['variant', 'list'], listIo);
    expect(listIo.text.out).toContain('pop-cta');
    expect(listIo.text.out).toContain('/pricing');
  });

  describe('error exits', () => {
    it('rejects an unknown variant id with exit 1', async () => {
      const root = tempRepo();
      const io = makeIo(root);
      const code = await runCli(['variant', 'use', 'nope'], io);
      expect(code).toBe(1);
      expect(io.text.err).toContain('No variant "nope"');
    });

    it('rejects a duplicate variant id', async () => {
      const root = tempRepo();
      await runCli(['variant', 'new', 'dup'], makeIo(root));
      const io = makeIo(root);
      const code = await runCli(['variant', 'new', 'dup'], io);
      expect(code).toBe(1);
      expect(io.text.err).toContain('already exists');
    });

    it('rejects an ambiguous --note prefix, same as --done', async () => {
      const root = tempRepo();
      const now = new Date().toISOString();
      writeFileSync(
        join(root, '.iteration-feedback.json'),
        JSON.stringify([
          { id: 'aaa111', route: '/a', feedback: 'x', element: null, done: false, doneAt: null, createdAt: now },
          { id: 'aaa222', route: '/b', feedback: 'y', element: null, done: false, doneAt: null, createdAt: now },
        ]),
      );
      const io = makeIo(root);
      const code = await runCli(['variant', 'new', 'x', '--note', 'aaa'], io);
      expect(code).toBe(1);
      expect(io.text.err).toContain('Ambiguous prefix');
    });

    it('rejects a missing id for new/use/promote/drop', async () => {
      const root = tempRepo();
      expect(await runCli(['variant', 'new'], makeIo(root))).toBe(1);
      expect(await runCli(['variant', 'use'], makeIo(root))).toBe(1);
      expect(await runCli(['variant', 'promote'], makeIo(root))).toBe(1);
      expect(await runCli(['variant', 'drop'], makeIo(root))).toBe(1);
      expect(await runCli(['variant', 'off'], makeIo(root))).toBe(1);
      expect(await runCli(['variant', 'group'], makeIo(root))).toBe(1);
    });
  });
});

describe('init', () => {
  it('detects a Vite host and recommends overlay', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'vite.config.ts'), 'export default {};\n');
    const io = makeIo(root);
    expect(await runCli(['init'], io)).toBe(0);
    expect(io.text.out).toContain('isotone init — Vite');
    expect(io.text.out).toContain('Recommended: overlay');
  });

  it('detects a Next host and recommends serve', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'next.config.ts'), 'export default {};\n');
    const io = makeIo(root);
    expect(await runCli(['init'], io)).toBe(0);
    expect(io.text.out).toContain('isotone init — Next');
    expect(io.text.out).toContain('Recommended: serve');
  });

  it('detects host-owned axes via meta.ts and recommends host', async () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src', 'lab'), { recursive: true });
    writeFileSync(join(root, 'src', 'lab', 'meta.ts'), 'export const defaultOption = "a";\n');
    const io = makeIo(root);
    expect(await runCli(['init'], io)).toBe(0);
    expect(io.text.out).toContain('Recommended: host');
  });

  it('detects host-owned axes via useVariant( in any source file', async () => {
    const root = tempRepo();
    mkdirSync(join(root, 'app', 'widgets'), { recursive: true });
    writeFileSync(
      join(root, 'app', 'widgets', 'Widget.tsx'),
      'const size = useVariant("size");\nexport default size;\n',
    );
    const io = makeIo(root);
    expect(await runCli(['init'], io)).toBe(0);
    expect(io.text.out).toContain('Recommended: host');
  });

  it('prints a host example and a route handler that name real exports', async () => {
    const root = tempRepo();
    const host = makeIo(root);
    expect(await runCli(['init', '--approach', 'host'], host)).toBe(0);
    expect(host.text.out).toContain("import { createVariantsSource, mountIteration } from 'isotone/react';");
    expect(host.text.out).toContain('mountIteration({ variants: source });');
    expect(host.text.out).not.toContain('myAxes');

    writeFileSync(join(root, 'next.config.ts'), 'export default {};\n');
    const serve = makeIo(root);
    expect(await runCli(['init', '--approach', 'serve'], serve)).toBe(0);
    expect(serve.text.out).toContain("import { serveNotesRequest } from 'isotone/server';");
    expect(serve.text.out).toContain('a Next route handler');
  });

  it('warns when overlay is asked for outside a Vite repo', async () => {
    const io = makeIo(tempRepo());
    expect(await runCli(['init', '--approach', 'overlay'], io)).toBe(0);
    expect(io.text.out).toContain('No vite.config or react-router.config found here.');
  });

  it('never touches vite.config, and --approach overlay --yes writes AGENTS.md and a variants README', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'vite.config.ts'), 'export default {};\n');
    const before = readFileSync(join(root, 'vite.config.ts'), 'utf8');

    const io = makeIo(root);
    expect(await runCli(['init', '--approach', 'overlay', '--yes'], io)).toBe(0);

    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toBe(before);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('## isotone');
    expect(existsSync(join(root, '.isotone/variants/README.md'))).toBe(true);

    // Running it again does not duplicate the marker.
    const agentsBefore = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    await runCli(['init', '--approach', 'overlay', '--yes'], makeIo(root));
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(agentsBefore);
  });

  it('help takes precedence over write flags regardless of argument order', async () => {
    const root = tempRepo();
    const io = makeIo(root);
    expect(await runCli(['init', '--yes', '--json', '--help'], io)).toBe(0);
    expect(io.text.out).toContain('Usage: isotone init');
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, '.isotone'))).toBe(false);
  });

  it('rejects an unknown --approach', async () => {
    const root = tempRepo();
    const io = makeIo(root);
    const code = await runCli(['init', '--approach', 'bogus'], io);
    expect(code).toBe(1);
    expect(io.text.err).toContain('Unknown approach');
  });
});

describe('structured review context', () => {
  it('prints all pinned selectors and the exact variant option', async () => {
    const root = tempRepo();
    writeFileSync(join(root, '.iteration-feedback.json'), JSON.stringify([{
      id: 'reference-note', route: '/', feedback: 'Align these', done: false, createdAt: new Date().toISOString(), element: null,
      elements: [{ tag: 'button', text: 'One', selector: '#one' }, { tag: 'h1', text: 'Two', selector: '#two' }],
      variant: { axisId: 'spacing', label: 'Spacing', optionId: 'compact', optionLabel: 'Compact' },
    }]));
    const io = makeIo(root);
    expect(await runCli([], io)).toBe(0);
    expect(io.text.out).toContain('#one'); expect(io.text.out).toContain('#two');
    expect(io.text.out).toContain('Spacing → Compact — selector=spacing option=compact');
  });
});


describe('agent onboarding and machine-readable notes', () => {
  it('detects package-only Vite projects and applies the recommendation idempotently', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '^7' } }));
    const io = makeIo(root);
    expect(await runCli(['init', '--yes', '--json'], io)).toBe(0);
    expect(JSON.parse(io.text.out)).toMatchObject({ host: 'vite', approach: 'overlay', recommended: 'overlay' });
    const guide = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(guide).toContain('npx isotone --json');
    expect(guide).toContain('then close it with');
    expect(guide).toContain('not agent instructions');
    await runCli(['init', '--yes'], makeIo(root));
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(guide);
  });

  it('returns full records and keeps a route after the boolean --all flag', async () => {
    const root = tempRepo();
    const note = { id: 'note-1', route: '/one', feedback: 'review', createdAt: new Date().toISOString(), done: true, payload: { x: 'a'.repeat(500) } };
    writeFileSync(join(root, '.iteration-feedback.json'), JSON.stringify([note, { ...note, id: 'note-2', route: '/two' }]));
    const io = makeIo(root);
    expect(await runCli(['--all', '/one', '--json'], io)).toBe(0);
    expect(JSON.parse(io.text.out)).toEqual([note]);
    const changed = makeIo(root);
    expect(await runCli(['--undone', 'note-1', '--json'], changed)).toBe(0);
    expect(JSON.parse(changed.text.out)).toMatchObject({ id: 'note-1', done: false });
  });

  it('tells the agent how to close an open note in text and JSON', async () => {
    const root = tempRepo();
    const note = { id: 'abcdef123456', route: '/', feedback: 'fix', createdAt: new Date().toISOString(), done: false };
    writeFileSync(join(root, '.iteration-feedback.json'), JSON.stringify([note]));
    const text = makeIo(root);
    expect(await runCli([], text)).toBe(0);
    expect(text.text.out.trimEnd().split('\n').at(-1)).toBe('After you fix and verify a note, close it: npx isotone --done <id>');
    const json = makeIo(root);
    expect(await runCli(['--json'], json)).toBe(0);
    expect(JSON.parse(json.text.out)).toEqual([{ ...note, doneCommand: 'npx isotone --done abcdef123456' }]);
  });

  it.each([['--file'], ['--days', '-1'], ['--days', 'NaN'], ['--done', '--all'], ['--all', '--all'], ['init', '--approach'], ['init', '--typo'], ['serve', '--theme', 'blue'], ['serve', '--port', 'NaN'], ['serve', '--file']])('rejects incomplete or invalid arguments: %j', async (...args) => {
    const io = makeIo(tempRepo());
    expect(await runCli(args, io)).toBe(1);
    expect(io.text.err).not.toBe('');
  });
});

describe('corrupt feedback file', () => {
  it('fails clearly without overwriting the file', async () => {
    const root = tempRepo();
    const file = join(root, '.iteration-feedback.json');
    writeFileSync(file, '{broken');
    const io = makeIo(root);
    expect(await runCli(['--done', 'a'], io)).toBe(1);
    expect(io.text.err).not.toBe('');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
});

/**
 * Regressions from a field report on 1.1.2: an activation that fails has to
 * say why, a hand-deleted variant must not poison later activations, sync has
 * to work on files git does not track, and a promote leaves its group current.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

import { runCli } from '../../src/cli/run';
import { createOverlayVariantsSource } from '../../src/core/variants';
import { iteration } from '../../src/vite';
import {
  addVariantFile,
  createVariant,
  listVariants,
  promoteVariant,
  readKnobs,
  syncVariant,
  variantDir,
  variantsResponse,
  writeActive,
} from '../../src/node/variants';
import { captureIo } from '../helpers/cli';
import { tempGitRepo } from '../helpers/fs';

const dirs: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = tempGitRepo('isotone-feedback-', dirs);
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

const sink = captureIo;

describe('sync on a file git does not track', () => {
  it('still merges on a second sync, and clears the stale flag each time', () => {
    const root = tempRepo();
    const opts = { root };
    const real = join(root, 'src', 'New.tsx');
    writeFileSync(real, 'one\ntwo\nthree\nfour\nfive\n');
    createVariant(opts, { id: 'v' });
    addVariantFile(opts, 'v', 'src/New.tsx');
    const copy = join(variantDir(opts, 'v'), 'src/New.tsx');
    writeFileSync(copy, 'one\ntwo\nthree\nfour\nVARIANT\n');

    writeFileSync(real, 'ONE\ntwo\nthree\nfour\nfive\n');
    expect(syncVariant(opts, 'v').merged).toEqual(['src/New.tsx']);
    expect(listVariants(opts)[0]?.stale).toEqual([]);

    // The first sync moved the base to a version git was never given.
    writeFileSync(real, 'ONE\nTWO\nthree\nfour\nfive\n');
    expect(syncVariant(opts, 'v').merged).toEqual(['src/New.tsx']);
    expect(readFileSync(copy, 'utf8')).toBe('ONE\nTWO\nthree\nfour\nVARIANT\n');
    expect(listVariants(opts)[0]?.stale).toEqual([]);
  });
});

describe('promote and the rest of its group', () => {
  function group(root: string) {
    const opts = { root };
    writeFileSync(join(root, 'src', 'Ring.tsx'), 'base\n');
    for (const id of ['ring', 'bar']) {
      createVariant(opts, { id, group: 'chart' });
      addVariantFile(opts, id, 'src/Ring.tsx');
    }
    writeFileSync(join(variantDir(opts, 'ring'), 'src/Ring.tsx'), 'ring\n');
    writeFileSync(join(variantDir(opts, 'bar'), 'src/Ring.tsx'), 'bar\n');
    return opts;
  }

  it('leaves siblings current, and a later sync keeps their alternative', () => {
    const root = tempRepo();
    const opts = group(root);
    const { rebased } = promoteVariant(opts, 'ring');
    expect(rebased).toEqual(['bar']);
    expect(listVariants(opts).find((v) => v.id === 'bar')?.stale).toEqual([]);
    expect(syncVariant(opts, 'bar').unchanged).toEqual(['src/Ring.tsx']);
    expect(readFileSync(join(variantDir(opts, 'bar'), 'src/Ring.tsx'), 'utf8')).toBe('bar\n');
  });

  it('keeps a sibling stale when the real file had already moved past it', () => {
    const root = tempRepo();
    const opts = group(root);
    writeFileSync(join(root, 'src', 'Ring.tsx'), 'edited since\n');
    expect(promoteVariant(opts, 'ring', { force: true }).rebased).toEqual([]);
    expect(listVariants(opts).find((v) => v.id === 'bar')?.stale).toEqual(['src/Ring.tsx']);
  });

  it('leaves a variant outside the group stale', () => {
    const root = tempRepo();
    const opts = group(root);
    createVariant(opts, { id: 'other', group: 'toolbar' });
    addVariantFile(opts, 'other', 'src/Ring.tsx');
    promoteVariant(opts, 'ring');
    expect(listVariants(opts).find((v) => v.id === 'other')?.stale).toEqual(['src/Ring.tsx']);
  });
});

describe('two groups over one file', () => {
  it('names both groups in the 409', () => {
    const root = tempRepo();
    const opts = { root };
    writeFileSync(join(root, 'src', 'Toolbar.tsx'), 'x\n');
    createVariant(opts, { id: 'kind', group: 'chart', groupLabel: 'Chart kind toggle' });
    createVariant(opts, { id: 'dense', group: 'toolbar', groupLabel: 'Toolbar' });
    addVariantFile(opts, 'kind', 'src/Toolbar.tsx');
    addVariantFile(opts, 'dense', 'src/Toolbar.tsx');
    const res = variantsResponse(opts, { method: 'POST', url: '/active', body: { active: ['kind', 'dense'] } });
    expect(res.status).toBe(409);
    const { error } = res.body as { error: string };
    for (const part of ['Chart kind toggle', 'Toolbar', 'src/Toolbar.tsx']) expect(error).toContain(part);
  });

  it('warns when `variant add` or `variant group` creates the overlap', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'Toolbar.tsx'), 'export function Toolbar() {}\n');
    await runCli(['variant', 'new', 'kind', '--group', 'chart'], sink(root));
    await runCli(['variant', 'new', 'dense', '--group', 'toolbar'], sink(root));
    await runCli(['variant', 'add', 'kind', 'src/Toolbar.tsx'], sink(root));
    const add = sink(root);
    expect(await runCli(['variant', 'add', 'dense', 'src/Toolbar.tsx'], add)).toBe(0);
    expect(add.text.err).toMatch(/src\/Toolbar\.tsx.*"kind"/);

    const group = sink(root);
    expect(await runCli(['variant', 'group', 'dense', 'chart'], group)).toBe(0);
    expect(group.text.err).toBe('');
    const moved = sink(root);
    expect(await runCli(['variant', 'group', 'dense', 'other'], moved)).toBe(0);
    expect(moved.text.err).toMatch(/"kind"/);
  });
});

describe('`variant add` on a file that cannot hot-swap', () => {
  it('names the exports that will force a reload', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'Chart.tsx'), 'export function Chart() {}\nexport const clampWindowTo = 1;\n');
    await runCli(['variant', 'new', 'v'], sink(root));
    const add = sink(root);
    expect(await runCli(['variant', 'add', 'v', 'src/Chart.tsx'], add)).toBe(0);
    expect(add.text.err).toContain('clampWindowTo');
    expect(add.text.err).toContain('reload');
  });

  it('stays quiet for a file of components', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'Chart.tsx'), 'export function Chart() {}\nexport default Chart;\n');
    await runCli(['variant', 'new', 'v'], sink(root));
    const add = sink(root);
    expect(await runCli(['variant', 'add', 'v', 'src/Chart.tsx'], add)).toBe(0);
    expect(add.text.err).toBe('');
  });
});

describe('`variant sync` output', () => {
  it('keeps git errors out of it and says what to do about a missing base', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'a.ts'), 'a\n');
    await runCli(['variant', 'new', 'v'], sink(root));
    await runCli(['variant', 'add', 'v', 'src/a.ts'], sink(root));
    const manifest = join(root, '.isotone/variants/v/variant.json');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    parsed.files['src/a.ts'].base = '0'.repeat(40);
    writeFileSync(manifest, JSON.stringify(parsed));
    const sync = sink(root);
    await runCli(['variant', 'sync', 'v'], sync);
    expect(sync.text.out).toContain('conflicts: src/a.ts');
    expect(sync.text.out).toMatch(/promote v --force/);
  });
});

describe('the panel, when activation fails', () => {
  it("shows the server's reason", async () => {
    const reason = '"a" (A) and "b" (B) both override src/x.ts; only one can be active';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json({ error: reason }, { status: 409 })
          : Response.json({
              active: [],
              variants: [{ id: 'a', label: 'a', createdAt: '', files: {}, stale: [], missing: [] }],
            }),
      ),
    );
    const source = createOverlayVariantsSource({ endpoint: '/v', getRoute: () => '/', live: null, storage: null, knobRoot: null });
    await source.refresh();
    const axis = source.getAxes()[0];
    source.setSelection(axis?.id ?? '', 'a');
    await vi.waitFor(() => expect(source.getError?.()).toBe(reason));
  });
});

describe('`variant sync` conflict advice', () => {
  it('points at the markers when the copy has them', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'a.ts'), 'one\n');
    await runCli(['variant', 'new', 'v'], sink(root));
    await runCli(['variant', 'add', 'v', 'src/a.ts'], sink(root));
    writeFileSync(join(root, '.isotone/variants/v/src/a.ts'), 'copy\n');
    writeFileSync(join(root, 'src', 'a.ts'), 'real\n');
    const sync = sink(root);
    await runCli(['variant', 'sync', 'v'], sync);
    expect(sync.text.out).toMatch(/resolve the conflict markers in .*src\/a\.ts/);
  });
});

describe('select knobs', () => {
  it('reads them from the knob file and drops one without a usable default', () => {
    const root = tempRepo();
    mkdirSync(join(root, '.isotone'), { recursive: true });
    const options = [
      { id: 'lines', label: 'Lines' },
      { id: 'dots', label: 'Dots' },
    ];
    writeFileSync(
      join(root, '.isotone/knobs.json'),
      JSON.stringify([
        { kind: 'select', id: 'ticks', label: 'Ticks', options, defaultOption: 'lines' },
        { kind: 'select', id: 'bad', label: 'Bad', options, defaultOption: 'nope' },
      ]),
    );
    expect(readKnobs({ root }).map((knob) => knob.id)).toEqual(['ticks']);
  });
});

describe('the dev server', () => {
  async function serve(root: string, live: boolean): Promise<ViteDevServer> {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: { usePolling: true, interval: 20 } },
      plugins: [iteration({ panel: false, variants: { live } }) as never, ...(live ? [{ name: 'react-fixture' }] : [])],
    });
    servers.push(server);
    return server;
  }

  const load = async (server: ViteDevServer, file: string) => (await server.ssrLoadModule(file)) as { value: string };

  /** Resolve once the dev server's file watcher reports changes: touch a
   *  probe file until it sees one, instead of guessing how long its first
   *  scan takes. */
  async function watching(server: ViteDevServer, root: string) {
    const probe = join(root, 'src', 'watch-probe.ts');
    let seen = false;
    const see = (_event: string, file: string) => {
      if (file.endsWith('watch-probe.ts')) seen = true;
    };
    server.watcher.on('all', see);
    try {
      await vi.waitFor(
        () => {
          writeFileSync(probe, `export const probe = ${Date.now()};\n`);
          expect(seen).toBe(true);
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      server.watcher.off('all', see);
    }
  }

  it.each([[true], [false]])('renders a copy added to an active variant, live=%s', async (live) => {
    const root = tempRepo();
    const real = join(root, 'src', 'b.ts');
    writeFileSync(real, "export const value = 'real';\n");
    writeFileSync(join(root, 'src', 'a.ts'), "export const value = 'real a';\n");
    const opts = { root };
    createVariant(opts, { id: 'v' });
    addVariantFile(opts, 'v', 'src/a.ts');
    writeActive(opts, ['v']);

    const server = await serve(root, live);
    await watching(server, root);
    expect((await load(server, '/src/b.ts')).value).toBe('real');

    addVariantFile(opts, 'v', 'src/b.ts');
    writeFileSync(join(variantDir(opts, 'v'), 'src/b.ts'), "export const value = 'copy';\n");
    await vi.waitFor(
      async () => {
        expect((await load(server, '/src/b.ts')).value).toBe('copy');
      },
      { timeout: 3000, interval: 100 },
    );
  });

  it('forgets a variant whose folder was deleted by hand', async () => {
    const root = tempRepo();
    writeFileSync(join(root, 'src', 'a.ts'), "export const value = 'real';\n");
    const opts = { root };
    createVariant(opts, { id: 'gone' });
    addVariantFile(opts, 'gone', 'src/a.ts');
    writeFileSync(join(variantDir(opts, 'gone'), 'src/a.ts'), "export const value = 'copy';\n");
    writeActive(opts, ['gone']);

    const server = await serve(root, true);
    await watching(server, root);
    expect((await load(server, '/src/a.ts')).value).toBe('copy');

    rmSync(variantDir(opts, 'gone'), { recursive: true });
    await vi.waitFor(
      async () => {
        expect((await load(server, '/src/a.ts')).value).toBe('real');
      },
      { timeout: 3000, interval: 100 },
    );
    // What a new page is told is active, which every later pick builds on.
    const config = await server.pluginContainer.load('\0isotone-live');
    expect(JSON.stringify(config)).not.toContain('gone');
  });
});

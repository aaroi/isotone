/**
 * End-to-end check of the Vite adapter, in-process: a real dev server with
 * the plugin registered, serving a real index.html.
 *
 * This is the gate the unit tests could not give us. The plugin's two jobs —
 * injecting the mount script into whatever HTML the host serves, and serving
 * the notes endpoint — both live in `configureServer` middleware, so nothing
 * short of a running server exercises them.
 *
 * The fixture root sits inside the repo so `react` resolves by walking up,
 * and `iso-iterate/react` is aliased to the source the way a consumer's
 * installed copy would resolve it.
 */
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

import { iteration, withNativeFetch, type IterationViteOptions } from '../src/vite/index';
import { NOTES_ENDPOINT } from '../src/store';
import { VARIANTS_ENDPOINT } from '../src/core/variants';
import {
  ACTIVE_FILE,
  addVariantFile,
  createVariant,
  readActive,
  variantDir,
  writeActive,
} from '../src/variants-store';

let server: ViteDevServer;
let root: string;
let notesFile: string;
let origin: string;

beforeAll(async () => {
  root = mkdtempSync(resolve(import.meta.dirname, '..', '.tmp-vite-'));
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>host</title></head><body><div id="app"></div></body></html>',
  );
  notesFile = join(root, 'notes.json');

  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    // watch: null — the fixture never changes. noDiscovery — the virtual
    // module's react imports otherwise schedule a background esbuild
    // prebundle, and close() racing that run was a coin-flip teardown hang
    // (reproduced 50/50 outside vitest; 0/8 with the optimizer off).
    server: { port: 0, host: '127.0.0.1', watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      alias: {
        'iso-iterate/react': resolve(import.meta.dirname, '..', 'src/react/index.ts'),
      },
    },
    plugins: [
      iteration({ file: notesFile }),
      {
        // A stand-in for a framework's SSR handler: the document arrives as
        // Uint8Array chunks through res.write/res.end, with the ETag and
        // Content-Length a real one would send.
        name: 'fixture:streamed-ssr',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/ssr')) return next();
            const encode = (text: string) => new TextEncoder().encode(text);
            const head = '<!doctype html><html><head><title>ssr</title></head><body>';
            const tail = '<main id="ssr">streamed</main></body></html>';
            if (req.headers['if-none-match'] === 'W/"ssr-1"') {
              res.statusCode = 304;
              return res.end();
            }
            res.setHeader('content-type', 'text/html');
            res.setHeader('etag', 'W/"ssr-1"');
            res.setHeader('content-length', String(head.length + tail.length));
            res.write(encode(head));
            res.end(encode(tail));
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  // fetch() keeps its connections alive, and vite's close() waits for open
  // sockets — without this the suite passes and then hangs in teardown.
  (server?.httpServer as import('node:http').Server | null)?.closeAllConnections?.();
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('the Vite adapter, served', () => {
  it('injects the mount script into the host HTML without a source edit', async () => {
    // A browser navigation asks for text/html; injection is gated on that so
    // module and asset responses are never buffered.
    const html = await (
      await fetch(`${origin}/`, { headers: { accept: 'text/html' } })
    ).text();
    // The host's own markup survives...
    expect(html).toContain('<div id="app"></div>');
    // ...and the mount rides in before </body>, carrying real transformed code
    // (an empty script would mean transformRequest silently failed).
    expect(html).toContain('data-iso-iterate-inject');
    const script = html.slice(
      html.indexOf('data-iso-iterate-inject'),
      html.indexOf('</body>'),
    );
    expect(script).toContain('mountIteration');
    expect(script.length).toBeGreaterThan(200);
    // Variants are on by default, so the mount asks for the overlay source.
    expect(script).toContain('overlay');
  });

  it('serves the variants endpoint, path-relative to its mount', async () => {
    const res = await fetch(`${origin}${VARIANTS_ENDPOINT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ variants: [], active: [] });
    const unknown = await fetch(`${origin}${VARIANTS_ENDPOINT}/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: ['nope'] }),
    });
    expect(unknown.status).toBe(404);
    // The shape of a cross-site `no-cors` post: a content type browsers send
    // without a preflight. Refused before the body is looked at.
    const plain = await fetch(`${origin}${VARIANTS_ENDPOINT}/active`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ active: ['nope'] }),
    });
    expect(plain.status).toBe(415);
  });

  it('asks Vite for the mount code on every navigation instead of memoizing it', async () => {
    // The transformed mount code imports the optimized dep with a
    // `?v=<browserHash>` that changes when the optimizer re-runs. A copy
    // memoized at the first request outlives that hash and every later page
    // fetches a URL Vite answers with 504 Outdated Optimize Dep. Vite's own
    // module-graph cache is the memo, and it is what the optimizer
    // invalidates, so each navigation has to go through transformRequest.
    const original = server.transformRequest.bind(server);
    let generation = 0;
    server.transformRequest = (async (url: string, opts?: unknown) => {
      const result = await original(url, opts as undefined);
      if (!result) return result;
      generation += 1;
      return { ...result, code: `${result.code}\n/* gen ${generation} */` };
    }) as typeof server.transformRequest;
    try {
      const first = await (
        await fetch(`${origin}/`, { headers: { accept: 'text/html' } })
      ).text();
      const second = await (
        await fetch(`${origin}/`, { headers: { accept: 'text/html' } })
      ).text();
      expect(first).toContain('/* gen 1 */');
      expect(second).toContain('/* gen 2 */');
      expect(second).not.toContain('/* gen 1 */');
    } finally {
      server.transformRequest = original;
    }
  });

  it('injects into a document streamed as byte chunks, once, at the right length', async () => {
    // React Router, Next and friends pipe a web stream into the node
    // response: Uint8Array chunks, not strings. Stringifying one of those
    // gives a byte list, so the wrapper has to decode; and it must not both
    // pass chunks through and re-send the buffered document at the end.
    const res = await fetch(`${origin}/ssr`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    expect(html.match(/<html/g)).toHaveLength(1);
    expect(html.match(/data-iso-iterate-inject/g)).toHaveLength(1);
    expect(html).toContain('<main id="ssr">streamed</main>');
    expect(html.indexOf('data-iso-iterate-inject')).toBeGreaterThan(html.indexOf('</main>'));
    // The upstream length described the un-injected document.
    const length = res.headers.get('content-length');
    if (length) expect(Number(length)).toBe(new TextEncoder().encode(html).length);
  });

  it('answers a stale conditional request with the full injected document', async () => {
    // The upstream ETag describes bytes the browser never received, and a
    // browser holding a copy from before the plugin existed would otherwise
    // get 304 forever and never see the panel.
    const res = await fetch(`${origin}/ssr`, {
      headers: { accept: 'text/html', 'if-none-match': 'W/"ssr-1"' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('data-iso-iterate-inject');
  });

  it('keeps the browser\'s own fetch for the store, ahead of any app stub', async () => {
    const html = await (
      await fetch(`${origin}/`, { headers: { accept: 'text/html' } })
    ).text();
    const capture = html.indexOf('data-iso-iterate-native');
    expect(capture).toBeGreaterThan(-1);
    // Before anything the app loads: directly inside <head>.
    expect(html.slice(html.indexOf('<head>') + '<head>'.length).startsWith('<script data-iso-iterate-native')).toBe(true);
    expect(html).toContain('window.__isoIterateFetch=window.fetch.bind(window)');
  });

  it('pre-bundles its own panel with the host deps', () => {
    // Otherwise the first navigation discovers it, the optimizer re-runs and
    // the page reloads once more before the panel mounts.
    expect(server.config.optimizeDeps.include).toContain('iso-iterate/react');
  });

  it('resolves a relative notes file against the Vite root, not the cwd', async () => {
    const other = mkdtempSync(resolve(import.meta.dirname, '..', '.tmp-vite-root-'));
    writeFileSync(join(other, 'index.html'), '<html><body></body></html>');
    const relativeServer = await createServer({
      root: other,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [iteration({ file: 'notes/here.json' })],
    });
    try {
      await relativeServer.listen();
      const address = relativeServer.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const created = await fetch(`http://127.0.0.1:${port}${NOTES_ENDPOINT}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: '/', feedback: 'root-relative' }),
      });
      expect(created.status).toBe(201);
      expect(existsSync(join(other, 'notes', 'here.json'))).toBe(true);
    } finally {
      (relativeServer.httpServer as import('node:http').Server | null)?.closeAllConnections?.();
      await relativeServer.close();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('leaves non-HTML requests alone', async () => {
    const res = await fetch(`${origin}/`, { headers: { accept: '*/*' } });
    expect((await res.text())).not.toContain('data-iso-iterate-inject');
  });

  it('serves the notes endpoint against the configured file', async () => {
    const created = await fetch(`${origin}${NOTES_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        route: '/projects',
        feedback: 'the runtime tile blanks for every org but the first',
        element: { tag: 'span', text: 'platform-api', selector: 'td > span' },
        payload: { fixture: 'console' },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect(existsSync(notesFile)).toBe(true);
    const onDisk = JSON.parse(readFileSync(notesFile, 'utf8')) as Array<{
      route: string;
      payload?: unknown;
    }>;
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].route).toBe('/projects');
    expect(onDisk[0].payload).toEqual({ fixture: 'console' });

    const listed = (await (
      await fetch(`${origin}${NOTES_ENDPOINT}?route=/projects`)
    ).json()) as Array<{ id: string; element: { text: string } | null }>;
    expect(listed[0].id).toBe(id);
    expect(listed[0].element?.text).toBe('platform-api');

    const deleted = await fetch(`${origin}${NOTES_ENDPOINT}?id=${id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(JSON.parse(readFileSync(notesFile, 'utf8'))).toHaveLength(0);
  });
});

describe('withNativeFetch', () => {
  it('lands right after <head>, and after <body> when there is no head', () => {
    expect(withNativeFetch('<html><head lang="en"><title>x</title></head><body></body></html>')).toMatch(
      /<head lang="en"><script data-iso-iterate-native>/,
    );
    expect(withNativeFetch('<html><body class="a"><p>x</p></body></html>')).toMatch(
      /<body class="a"><script data-iso-iterate-native>/,
    );
  });

  it('is idempotent and leaves a document with neither alone', () => {
    const once = withNativeFetch('<html><head></head><body></body></html>');
    expect(withNativeFetch(once)).toBe(once);
    expect(withNativeFetch('<p>fragment</p>')).toBe('<p>fragment</p>');
  });
});

/* ── overlay variants, hooks driven directly ─────────────────────────── */

/**
 * The hooks as this file calls them. `iteration()` returns the structural
 * `IterationPlugin` on purpose (see its doc comment), so the test reaches
 * the hooks through a cast rather than vite's `Plugin` type.
 */
interface Hooks {
  configResolved(config: {
    root: string;
    command: 'serve' | 'build';
    assetsInclude: (file: string) => boolean;
  }): void;
  load(id: string): { code: string } | null;
  configureServer(server: FakeServer): void;
  handleHotUpdate(ctx: { file: string; server: FakeServer }): unknown[] | undefined;
}

type Middleware = (
  req: EventEmitter & { method: string; url: string; headers: Record<string, string> },
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void },
  next: () => void,
) => void;

interface FakeServer {
  config: { root: string; logger: { info: ReturnType<typeof vi.fn> } };
  httpServer: null;
  middlewares: { use: ReturnType<typeof vi.fn> };
  watcher: {
    add: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
  moduleGraph: {
    getModulesByFile: ReturnType<typeof vi.fn>;
    invalidateModule: ReturnType<typeof vi.fn>;
  };
  ws: { send: ReturnType<typeof vi.fn> };
  transformRequest: ReturnType<typeof vi.fn>;
}

const repos: string[] = [];

afterEach(() => {
  for (const d of repos) rmSync(d, { recursive: true, force: true });
  repos.length = 0;
  delete process.env.ISO_VARIANT;
});

/** A project that is its own git repo, so the exclude helpers write into
 *  its `.git/info/exclude` and not into this checkout's. */
function tempProject(): { root: string; source: string; override: string; table: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-vite-variants-')));
  repos.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'src'), { recursive: true });
  const source = join(root, 'src', 'Button.tsx');
  writeFileSync(source, 'export const label = "real";\n');
  const table = join(root, 'src', 'Table.tsx');
  writeFileSync(table, 'export const rows = "real";\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });

  createVariant({ root }, { id: 'b', label: 'B' });
  addVariantFile({ root }, 'b', 'src/Button.tsx');
  const override = join(variantDir({ root }, 'b'), 'src', 'Button.tsx');
  writeFileSync(override, 'export const label = "variant b";\n');
  // A second decision over another file, so two variants can be active at once.
  createVariant({ root }, { id: 't', label: 'T' });
  addVariantFile({ root }, 't', 'src/Table.tsx');
  writeFileSync(join(variantDir({ root }, 't'), 'src', 'Table.tsx'), 'export const rows = "variant t";\n');
  return { root, source, override, table };
}

function plugin(root: string, command: 'serve' | 'build', options: IterationViteOptions = {}): Hooks {
  const hooks = iteration(options) as unknown as Hooks;
  hooks.configResolved({ root, command, assetsInclude: () => false });
  return hooks;
}

function fakeServer(root: string): FakeServer {
  return {
    config: { root, logger: { info: vi.fn() } },
    httpServer: null,
    middlewares: { use: vi.fn() },
    watcher: { add: vi.fn(), on: vi.fn(), emit: vi.fn() },
    moduleGraph: { getModulesByFile: vi.fn(() => undefined), invalidateModule: vi.fn() },
    ws: { send: vi.fn() },
    transformRequest: vi.fn(async () => null),
  };
}

/** Run the middleware mounted at `mount` against one request and resolve
 *  with what it answered. Declares a JSON body the way the panel does
 *  unless a test hands in its own headers. */
function request(
  server: FakeServer,
  mount: string,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Promise<{ status: number; body: unknown }> {
  const call = server.middlewares.use.mock.calls.find((c) => c[0] === mount);
  if (!call) throw new Error(`nothing mounted at ${mount}`);
  const handler = call[1] as Middleware;
  const req = Object.assign(new EventEmitter(), { method, url, headers });
  return new Promise((done) => {
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: string) => done({ status: res.statusCode, body: JSON.parse(payload ?? 'null') }),
    };
    handler(req, res, () => done({ status: 0, body: null }));
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
}

describe('overlay variants in load()', () => {
  it('returns the override while its variant is active, the real file otherwise', () => {
    const { root, source } = tempProject();
    const hooks = plugin(root, 'serve');
    // Nothing active yet: load() declines and vite reads the real file.
    expect(hooks.load(source)).toBeNull();

    writeActive({ root }, ['b']);
    const fresh = plugin(root, 'serve');
    expect(fresh.load(source)?.code).toContain('variant b');
    // The dev active id is memoized: a later file change is the watcher's
    // job (covered below), not something load() re-reads every time.
    writeActive({ root }, []);
    expect(fresh.load(source)?.code).toContain('variant b');
  });

  it('strips the query and hash vite decorates module ids with', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve');
    expect(hooks.load(`${source}?v=abc123&t=1`)?.code).toContain('variant b');
    expect(hooks.load(`${source}#frag`)?.code).toContain('variant b');
    // Files the variant does not touch, and paths that are not files at
    // all, are left alone.
    expect(hooks.load(join(root, 'src', 'Other.tsx'))).toBeNull();
    expect(hooks.load('\0virtual:something')).toBeNull();
  });

  it('leaves asset and worker style imports to vite\'s own loaders', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve');
    expect(hooks.load(`${source}?raw`)).toBeNull();
    expect(hooks.load(`${source}?worker`)).toBeNull();
    expect(hooks.load(`${source}?url`)).toBeNull();
  });

  it('never swaps the override itself or anything in node_modules', () => {
    const { root, override } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve');
    expect(hooks.load(override)).toBeNull();
    const dep = join(root, 'node_modules', 'src', 'Button.tsx');
    expect(hooks.load(dep)).toBeNull();
  });

  it('honours ISO_VARIANT in a build and ignores the active file there', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const build = plugin(root, 'build');
    // The dev pointer means nothing to a build: production never selects.
    expect(build.load(source)).toBeNull();
    process.env.ISO_VARIANT = 'b';
    expect(build.load(source)?.code).toContain('variant b');
    process.env.ISO_VARIANT = 'missing';
    expect(build.load(source)).toBeNull();
  });

  it('is inert with variants: false', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve', { variants: false });
    expect(hooks.load(source)).toBeNull();
    const server = fakeServer(root);
    hooks.configureServer(server);
    const mounts = server.middlewares.use.mock.calls.map((c) => c[0]);
    expect(mounts).toContain(NOTES_ENDPOINT);
    expect(mounts).not.toContain(VARIANTS_ENDPOINT);
    expect(server.watcher.add).not.toHaveBeenCalled();
  });

  it('follows variants.root into another package', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    // A sibling dev server whose Vite root is elsewhere points at the
    // project the manifests describe.
    const sibling = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-sibling-')));
    repos.push(sibling);
    const hooks = plugin(sibling, 'serve', { variants: { root } });
    expect(hooks.load(source)?.code).toContain('variant b');
  });

  it('applies overrides when the Vite root is reached through a symlink', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    // Vite keeps `config.root` as configured and realpaths every module id,
    // so a variants root taken from the config verbatim would never contain
    // `source` and no override would ever apply.
    const linkParent = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-link-')));
    repos.push(linkParent);
    const link = join(linkParent, 'app');
    symlinkSync(root, link);
    const hooks = plugin(link, 'serve');
    expect(hooks.load(source)?.code).toContain('variant b');
  });
});

describe('overlay variants in the dev server', () => {
  it('flips the active file and hot-swaps the loaded module on POST /active', async () => {
    const { root, source } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    const mod = { id: '/src/Button.tsx' };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) =>
      f === source ? new Set([mod]) : undefined,
    );
    hooks.configureServer(server);

    // The active file's pattern lands in the project's own exclude, so the
    // panel's first activation does not leave an untracked file.
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain(`/${ACTIVE_FILE}`);

    const listed = await request(server, VARIANTS_ENDPOINT, 'GET', '/');
    expect(listed.status).toBe(200);
    expect((listed.body as { active: unknown }).active).toEqual([]);

    const activated = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] });
    expect(activated.status).toBe(200);
    expect(readActive({ root })).toEqual(['b']);
    // The swap is reported to Vite as an edit of the real file, never as a
    // page reload: Fast Refresh keeps the reviewer's state and open panel.
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(server.ws.send).not.toHaveBeenCalled();
    // The hot update for that reported change goes through, where an
    // ordinary edit of an overridden real file would be dropped.
    expect(hooks.handleHotUpdate({ file: source, server })).toBeUndefined();
    expect(hooks.handleHotUpdate({ file: source, server })).toEqual([]);
    // And load() now serves the override without a restart.
    expect(hooks.load(source)?.code).toContain('variant b');

    // Re-posting the same id is a no-op: nothing reported.
    server.watcher.emit.mockClear();
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] });
    expect(server.watcher.emit).not.toHaveBeenCalled();

    // Back to default: the real file is reported changed again and served.
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: [] });
    expect(readActive({ root })).toEqual([]);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.load(source)).toBeNull();
  });

  it('serves two groups at once and swaps only the files of the group that changed', async () => {
    const { root, source, table } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) =>
      f === source || f === table ? new Set([{ id: f }]) : undefined,
    );
    hooks.configureServer(server);

    const both = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', {
      active: ['b', 't'],
    });
    expect(both.status).toBe(200);
    expect(readActive({ root })).toEqual(['b', 't']);
    expect(hooks.load(source)?.code).toContain('variant b');
    expect(hooks.load(table)?.code).toContain('variant t');
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', table);

    // Dropping one group reports only its file; the other component is
    // left alone, so the reviewer's table keeps its state.
    server.watcher.emit.mockClear();
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['t'] });
    expect(server.watcher.emit).toHaveBeenCalledTimes(1);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.load(source)).toBeNull();
    expect(hooks.load(table)?.code).toContain('variant t');
    // The same set in another order is the same set.
    server.watcher.emit.mockClear();
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['t'] });
    expect(server.watcher.emit).not.toHaveBeenCalled();
  });

  it('refuses two variants over one file with 409 and switches nothing', async () => {
    const { root, source } = tempProject();
    createVariant({ root }, { id: 'b2' });
    addVariantFile({ root }, 'b2', 'src/Button.tsx');
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    hooks.configureServer(server);
    const res = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', {
      active: ['b', 'b2'],
    });
    expect(res.status).toBe(409);
    expect((res.body as { conflict: unknown }).conflict).toEqual(['b', 'b2', 'src/Button.tsx']);
    expect(readActive({ root })).toEqual([]);
    expect(server.watcher.emit).not.toHaveBeenCalled();
    expect(hooks.load(source)).toBeNull();
  });

  it('answers 404 for an unknown id without reloading, and 405 elsewhere', async () => {
    const { root } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    hooks.configureServer(server);
    const missing = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['zzz'] });
    expect(missing.status).toBe(404);
    expect(server.ws.send).not.toHaveBeenCalled();
    const other = await request(server, VARIANTS_ENDPOINT, 'POST', '/', {});
    expect(other.status).toBe(405);
  });

  it('answers 415 to a POST that does not declare a JSON body', async () => {
    const { root } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    hooks.configureServer(server);
    // A cross-site page can fire a `no-cors` form post at localhost with a
    // text/plain or form content type and no preflight; a JSON content type
    // would need one. So the header is the gate, and it must be checked
    // before the body is parsed.
    const plain = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, {
      'content-type': 'text/plain',
    });
    expect(plain.status).toBe(415);
    const form = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
    const missing = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, {});
    expect(missing.status).toBe(415);
    expect(readActive({ root })).toEqual([]);
    expect(server.ws.send).not.toHaveBeenCalled();
    // A charset parameter is still JSON.
    const ok = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, {
      'content-type': 'application/json; charset=utf-8',
    });
    expect(ok.status).toBe(200);
    expect(readActive({ root })).toEqual(['b']);
  });

  it('picks up `variant use` from the CLI through the watcher', async () => {
    const { root, source } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    // The browser has the real file loaded, so the swap has something to
    // report; a file nobody loaded is skipped.
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) =>
      f === source ? new Set([{ id: '/src/Button.tsx' }]) : undefined,
    );
    hooks.configureServer(server);
    const activeFile = join(root, ACTIVE_FILE);
    expect(server.watcher.add).toHaveBeenCalledWith(dirname(activeFile));
    expect(server.watcher.add).toHaveBeenCalledWith(join(root, '.iso-iterate', 'variants'));
    const onAll = server.watcher.on.mock.calls.find((c) => c[0] === 'all')?.[1] as (
      event: string,
      file: string,
    ) => void;
    expect(onAll).toBeTypeOf('function');

    expect(hooks.load(source)).toBeNull();
    writeActive({ root }, ['b']);
    onAll('add', activeFile);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.load(source)?.code).toContain('variant b');
  });

  it('logs the variants dir after the banner when it exists', () => {
    const { root } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    const listeners: Array<() => void> = [];
    (server as unknown as { httpServer: unknown }).httpServer = {
      once: (_event: string, cb: () => void) => listeners.push(cb),
    };
    hooks.configureServer(server);
    for (const cb of listeners) cb();
    const lines = server.config.logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('variants → .iso-iterate/variants  (2 variants)'))).toBe(true);
  });
});

describe('overlay variants in handleHotUpdate()', () => {
  it('maps an override edit to the real source\'s modules while active', () => {
    const { root, source, override } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    const mod = { id: '/src/Button.tsx' };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) =>
      f === source ? new Set([mod]) : undefined,
    );
    expect(hooks.handleHotUpdate({ file: override, server })).toEqual([mod]);
    // The real file's edit is invisible: the browser is showing the override.
    expect(hooks.handleHotUpdate({ file: source, server })).toEqual([]);
    // The manifest is not a module anywhere.
    expect(
      hooks.handleHotUpdate({ file: join(variantDir({ root }, 'b'), 'variant.json'), server }),
    ).toEqual([]);
    // Files the variant does not touch go through vite's default handling.
    expect(hooks.handleHotUpdate({ file: join(root, 'src', 'Other.tsx'), server })).toBeUndefined();
  });

  it('swallows edits to an inactive variant and leaves the real file to vite', () => {
    const { root, source, override } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    expect(hooks.handleHotUpdate({ file: override, server })).toEqual([]);
    expect(hooks.handleHotUpdate({ file: source, server })).toBeUndefined();
  });
});

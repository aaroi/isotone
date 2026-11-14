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
 * and `isotone/react` is aliased to the source the way a consumer's
 * installed copy would resolve it.
 */
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, normalizePath, type ViteDevServer } from 'vite';

import { withNativeFetch } from '../../src/vite/html-inject';
import { isotone, iteration, type IsotoneViteOptions } from '../../src/vite/index';
import { NOTES_ENDPOINT } from '../../src/node/notes/handler';
import { VARIANTS_ENDPOINT } from '../../src/core/variants';
import { UPDATE_ENDPOINT } from '../../src/node/update/check';
import { ACTIVE_FILE, addVariantFile, createVariant, readActive, variantDir, writeActive } from '../../src/node/variants';
import { tempGitRepo } from '../helpers/fs';

let server: ViteDevServer;
let root: string;
let notesFile: string;
let origin: string;

beforeAll(async () => {
  root = mkdtempSync(resolve(import.meta.dirname, '..', '.tmp-vite-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>host</title></head><body><div id="app"></div></body></html>');
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
        'isotone/react': resolve(import.meta.dirname, '..', 'src/react/index.ts'),
      },
    },
    plugins: [
      isotone({ file: notesFile, theme: 'system' }),
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
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    // The host's own markup survives...
    expect(html).toContain('<div id="app"></div>');
    // ...and the injected loader carries the mount options.
    expect(html).toContain('data-isotone-inject');
    const script = html.slice(html.indexOf('data-isotone-inject'), html.indexOf('</head>'));
    expect(script).toContain('__isotone.mount');
    expect(script).toContain('"theme":"system"');
    expect(script).toContain(UPDATE_ENDPOINT);
    // Blast is a CLI feature: the panel gets no session endpoint.
    expect(script).not.toContain('blast');
    expect(script.length).toBeGreaterThan(200);
    // Variants are on by default, so the mount asks for the overlay source.
    expect(script).toContain('overlay');
  });

  it('injects into <head>, never into the body a react tree owns', async () => {
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('data-isotone-inject');
    // The loader script sits inside <head> (right after the opening tag,
    // sharing it with the native-fetch capture it must run after, and ahead
    // of the host's own head content)...
    const head = html.slice(html.indexOf('<head>') + '<head>'.length, html.indexOf('</head>'));
    expect(head).toMatch(/(^|>)[ \t]*<script type="module" data-isotone-inject>/);
    // ...and nothing between <body> and </body> carries a script tag. A
    // whole-document React Router app hydrates the body; a stray script there
    // makes React 19 warn "Encountered a script tag while rendering React
    // component" and discard the server tree. Head contents are not part of
    // the hydrated body.
    const body = html.slice(html.indexOf('<body'), html.indexOf('</body>') || html.length);
    expect(body).not.toContain('<script');
  });

  it('serves the variants endpoint, path-relative to its mount', async () => {
    const res = await fetch(`${origin}${VARIANTS_ENDPOINT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ variants: [], active: [], knobs: [] });
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

  it('loads an isolated browser bundle without the host framework or optimizer', async () => {
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('/@isotone/panel.js');
    expect(html).not.toContain('isotone/react');
    const bundle = await fetch(`${origin}/@isotone/panel.js`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('javascript');
    const js = await bundle.text();
    expect(js.length).toBeGreaterThan(100_000);
    expect(/^\s*import\s/m.test(js)).toBe(false);
    expect(server.config.optimizeDeps.include).not.toContain('isotone/react');
  });

  it('refuses a page on another localhost port, and accepts the dev server’s own', async () => {
    const port = new URL(origin).port;
    const read = (from: string) => fetch(`${origin}${NOTES_ENDPOINT}`, { headers: { origin: from } });
    for (const from of ['http://127.0.0.1:3000', `http://localhost:${port}`, 'http://127.0.0.1']) {
      expect((await read(from)).status, from).toBe(403);
    }
    expect((await read(origin)).status).toBe(200);
  });

  it('rejects foreign-origin writes and oversized bodies before changing notes', async () => {
    const before = await (await fetch(`${origin}${NOTES_ENDPOINT}`)).json();
    for (const endpoint of [NOTES_ENDPOINT, VARIANTS_ENDPOINT]) {
      const blocked = await fetch(`${origin}${endpoint}`, {
        method: 'POST',
        headers: { origin: 'https://outside.example', 'content-type': 'application/json' },
        body: '{}',
      });
      expect(blocked.status).toBe(403);
      const oversized = await fetch(`${origin}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'x'.repeat(1024 * 1024) }),
      });
      expect(oversized.status).toBe(413);
    }
    expect(await (await fetch(`${origin}${NOTES_ENDPOINT}`)).json()).toEqual(before);
  });

  it('injects into a document streamed as byte chunks, once, at the right length', async () => {
    // React Router, Next and friends pipe a web stream into the node
    // response: Uint8Array chunks, not strings. Stringifying one of those
    // gives a byte list, so the wrapper has to decode; and it must not both
    // pass chunks through and re-send the buffered document at the end.
    const res = await fetch(`${origin}/ssr`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    expect(html.match(/<html/g)).toHaveLength(1);
    expect(html.match(/data-isotone-inject/g)).toHaveLength(1);
    expect(html).toContain('<main id="ssr">streamed</main>');
    // The loader goes in <head>, so it precedes the streamed body content.
    expect(html.indexOf('data-isotone-inject')).toBeLessThan(html.indexOf('<body'));
    // The SSR fixture's own body keeps exactly one <script> (none of iso's).
    expect(html.slice(html.indexOf('<body'), html.indexOf('</body>')).match(/<script/g)).toBeNull();
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
    expect(await res.text()).toContain('data-isotone-inject');
  });

  it("keeps the browser's own fetch for the store, ahead of any app stub", async () => {
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    const capture = html.indexOf('data-isotone-native');
    expect(capture).toBeGreaterThan(-1);
    // Before anything the app loads: directly inside <head>.
    expect(html.slice(html.indexOf('<head>') + '<head>'.length).startsWith('<script data-isotone-native')).toBe(true);
    expect(html).toContain('window.__isotoneFetch=window.fetch.bind(window)');
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
      plugins: [isotone({ file: 'notes/here.json' })],
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

  it('keeps local endpoints without injecting a panel when mounted manually', async () => {
    const other = mkdtempSync(resolve(import.meta.dirname, '..', '.tmp-vite-manual-'));
    writeFileSync(join(other, 'index.html'), '<html><head></head><body>Manual mount</body></html>');
    const manual = await createServer({
      root: other,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [isotone({ panel: false, checkForUpdates: false })],
    });
    try {
      await manual.listen();
      const address = manual.httpServer?.address();
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      const html = await (await fetch(url, { headers: { accept: 'text/html' } })).text();
      expect(html).not.toContain('data-isotone');
      expect(html).not.toContain('/@isotone/panel.js');
      expect(await (await fetch(`${url}${NOTES_ENDPOINT}`)).json()).toEqual([]);
      expect(await (await fetch(`${url}${VARIANTS_ENDPOINT}`)).json()).toEqual({ variants: [], active: [], knobs: [] });
      const update = await fetch(`${url}${UPDATE_ENDPOINT}`);
      expect(update.headers.get('cache-control')).toBe('no-store');
      expect(await update.json()).toMatchObject({ status: 'disabled', upgrade: null });
      expect((await fetch(`${url}${UPDATE_ENDPOINT}`, { method: 'PUT' })).status).toBe(405);
      // With no update to request, asking for the note changes nothing.
      expect(
        (
          await fetch(`${url}${UPDATE_ENDPOINT}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ route: '/', to: '9.9.9', command: 'rm -rf /' }),
          })
        ).status,
      ).toBe(409);
      expect((await fetch(`${url}${UPDATE_ENDPOINT}`, { method: 'POST', headers: { origin: 'https://outside.example' } })).status).toBe(
        403,
      );
      expect(await (await fetch(`${url}${NOTES_ENDPOINT}`)).json()).toEqual([]);
      expect((await fetch(`${url}${UPDATE_ENDPOINT}`, { headers: { origin: 'https://outside.example' } })).status).toBe(403);
    } finally {
      (manual.httpServer as import('node:http').Server | null)?.closeAllConnections?.();
      await manual.close();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('leaves non-HTML requests alone', async () => {
    const res = await fetch(`${origin}/`, { headers: { accept: '*/*' } });
    expect(await res.text()).not.toContain('data-isotone-inject');
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
    expect(onDisk[0]?.route).toBe('/projects');
    expect(onDisk[0]?.payload).toEqual({ fixture: 'console' });

    const listed = (await (await fetch(`${origin}${NOTES_ENDPOINT}?route=/projects`)).json()) as Array<{
      id: string;
      element: { text: string } | null;
    }>;
    expect(listed[0]?.id).toBe(id);
    expect(listed[0]?.element?.text).toBe('platform-api');

    const deleted = await fetch(`${origin}${NOTES_ENDPOINT}?id=${id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(JSON.parse(readFileSync(notesFile, 'utf8'))).toHaveLength(0);
  });
});

describe('iteration (deprecated name)', () => {
  it('is the same plugin as isotone()', () => {
    expect(iteration).toBe(isotone);
  });
});

describe('the notes file from before 1.3', () => {
  const NOTES = '[{"id":"n1","route":"/","feedback":"old","createdAt":"2026-01-01T00:00:00Z"}]';

  it('moves .iteration-feedback.json to .isotone/notes.json when the dev server starts', () => {
    const { root } = tempProject();
    writeFileSync(join(root, '.iteration-feedback.json'), NOTES);
    writeFileSync(join(root, '.iteration-feedback.blast.json'), '{}');
    const build = plugin(root, 'build');
    build.configureServer(fakeServer(root));
    expect(existsSync(join(root, '.iteration-feedback.json'))).toBe(true);

    const server = fakeServer(root);
    plugin(root, 'serve').configureServer(server);
    expect(readFileSync(join(root, '.isotone/notes.json'), 'utf8')).toBe(NOTES);
    expect(existsSync(join(root, '.isotone/notes.blast.json'))).toBe(true);
    expect(existsSync(join(root, '.iteration-feedback.json'))).toBe(false);
    expect(server.config.logger.info).toHaveBeenCalledWith('  isotone  Moved .iteration-feedback.json to .isotone/notes.json.');
  });

  it('leaves a file the config names where it is', () => {
    const { root } = tempProject();
    writeFileSync(join(root, '.iteration-feedback.json'), NOTES);
    plugin(root, 'serve', { file: '.iteration-feedback.json' }).configureServer(fakeServer(root));
    expect(readFileSync(join(root, '.iteration-feedback.json'), 'utf8')).toBe(NOTES);
    expect(existsSync(join(root, '.isotone/notes.json'))).toBe(false);
  });
});

describe('withNativeFetch', () => {
  it('lands right after <head>, and after <body> when there is no head', () => {
    expect(withNativeFetch('<html><head lang="en"><title>x</title></head><body></body></html>')).toMatch(
      /<head lang="en"><script data-isotone-native>/,
    );
    expect(withNativeFetch('<html><body class="a"><p>x</p></body></html>')).toMatch(/<body class="a"><script data-isotone-native>/);
    // A document without a head tag: the app's <header> is not one.
    expect(withNativeFetch('<html><body><header class="top">x</header></body></html>')).toMatch(
      /<body><script data-isotone-native>.*<\/script><header class="top">/,
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
 * The hooks as this file calls them. `isotone()` returns the structural
 * `IsotonePlugin` on purpose (see its doc comment), so the test reaches
 * the hooks through a cast rather than vite's `Plugin` type.
 */
interface Hooks {
  configResolved(config: {
    root: string;
    command: 'serve' | 'build';
    assetsInclude: (file: string) => boolean;
    server: { fs: { strict: boolean } };
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
  config: { root: string; logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } };
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
  delete process.env.ISOTONE_VARIANT;
});

/** A project that is its own git repo, so the exclude helpers write into
 *  its `.git/info/exclude` and not into this checkout's. */
/** A file's module id the way Vite names it: forward slashes, so the same
 *  `C:/…` form on Windows as in Vite's module graph and hot updates. */
function id(...parts: string[]): string {
  return normalizePath(join(...parts));
}

function tempProject(): { root: string; source: string; override: string; table: string } {
  const root = tempGitRepo('isotone-vite-variants-', repos);
  mkdirSync(join(root, 'src'), { recursive: true });
  // Module ids as Vite hands them to plugins: forward slashes on every OS.
  const source = id(root, 'src', 'Button.tsx');
  writeFileSync(source, 'export const label = "real";\n');
  const table = id(root, 'src', 'Table.tsx');
  writeFileSync(table, 'export const rows = "real";\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });

  createVariant({ root }, { id: 'b', label: 'B' });
  addVariantFile({ root }, 'b', 'src/Button.tsx');
  const override = id(variantDir({ root }, 'b'), 'src', 'Button.tsx');
  writeFileSync(override, 'export const label = "variant b";\n');
  // A second decision over another file, so two variants can be active at once.
  createVariant({ root }, { id: 't', label: 'T' });
  addVariantFile({ root }, 't', 'src/Table.tsx');
  writeFileSync(join(variantDir({ root }, 't'), 'src', 'Table.tsx'), 'export const rows = "variant t";\n');
  return { root, source, override, table };
}

function plugin(root: string, command: 'serve' | 'build', options: IsotoneViteOptions = {}): Hooks {
  const hooks = isotone(options) as unknown as Hooks;
  // Vite's own file access check, off: the served tests below cover it.
  hooks.configResolved({ root, command, assetsInclude: () => false, server: { fs: { strict: false } } });
  return hooks;
}

function fakeServer(root: string): FakeServer {
  return {
    config: { root, logger: { info: vi.fn(), warn: vi.fn() } },
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
  remoteAddress = '127.0.0.1',
): Promise<{ status: number; body: unknown }> {
  const call = server.middlewares.use.mock.calls.find((c) => c[0] === mount);
  if (!call) throw new Error(`nothing mounted at ${mount}`);
  const handler = call[1] as Middleware;
  const req = Object.assign(new EventEmitter(), {
    method,
    url,
    headers: { host: 'localhost:5173', ...headers },
    socket: { remoteAddress },
  });
  return new Promise((done) => {
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: string) => {
        let parsed: unknown = payload;
        try {
          parsed = JSON.parse(payload ?? 'null');
        } catch {
          /* The panel bundle, or a plain-text refusal. */
        }
        done({ status: res.statusCode, body: parsed });
      },
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
    expect(hooks.load(id(root, 'src', 'Other.tsx'))).toBeNull();
    expect(hooks.load('\0virtual:something')).toBeNull();
  });

  it("leaves asset and worker style imports to vite's own loaders", () => {
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
    const dep = id(root, 'node_modules', 'src', 'Button.tsx');
    expect(hooks.load(dep)).toBeNull();
  });

  it('honours ISOTONE_VARIANT in a build and ignores the active file there', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const build = plugin(root, 'build');
    // The dev pointer means nothing to a build: production never selects.
    expect(build.load(source)).toBeNull();
    process.env.ISOTONE_VARIANT = 'b';
    expect(build.load(source)?.code).toContain('variant b');
    process.env.ISOTONE_VARIANT = 'missing';
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
    const sibling = realpathSync.native(mkdtempSync(join(tmpdir(), 'isotone-sibling-')));
    repos.push(sibling);
    const hooks = plugin(sibling, 'serve', { variants: { root } });
    expect(hooks.load(source)?.code).toContain('variant b');
  });

  it.skipIf(process.platform === 'win32')('applies overrides when the Vite root is reached through a symlink', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    // Vite keeps `config.root` as configured and realpaths every module id,
    // so a variants root taken from the config verbatim would never contain
    // `source` and no override would ever apply.
    const linkParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'isotone-link-')));
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
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source ? new Set([mod]) : undefined));
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
    // Vite reports the change in its own normalized form (forward slashes
    // on Windows), which has to find the swap all the same.
    expect(hooks.handleHotUpdate({ file: source.replace('/src/', '/src/./'), server })).toBeUndefined();
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
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source || f === table ? new Set([{ id: f }]) : undefined));
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

  it('answers only this machine, even when the dev server is exposed on the network', async () => {
    const { root } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    (server.config as { server?: unknown }).server = { allowedHosts: ['.dev.example'] };
    hooks.configureServer(server);
    const json = { 'content-type': 'application/json' };
    const note = { route: '/', feedback: 'From the network' };
    // A phone or laptop on the same Wi-Fi, whatever Host it claims.
    expect((await request(server, NOTES_ENDPOINT, 'POST', '/', note, json, '192.168.1.20')).status).toBe(403);
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, { host: 'localhost:5173' }, '::ffff:192.168.1.20')).status).toBe(
      403,
    );
    // A rebinding page's own name is refused; Vite's allowed hosts are not.
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, { host: 'rebind.attacker.example' })).status).toBe(403);
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, { host: 'app.dev.example' })).status).toBe(200);
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, {}, '::1')).status).toBe(200);
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
    const plain = await request(
      server,
      VARIANTS_ENDPOINT,
      'POST',
      '/active',
      { active: ['b'] },
      {
        'content-type': 'text/plain',
      },
    );
    expect(plain.status).toBe(415);
    const form = await request(
      server,
      VARIANTS_ENDPOINT,
      'POST',
      '/active',
      { active: ['b'] },
      {
        'content-type': 'application/x-www-form-urlencoded',
      },
    );
    expect(form.status).toBe(415);
    const missing = await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, {});
    expect(missing.status).toBe(415);
    // Only the media type counts: a JSON-looking parameter keeps a form's type.
    const smuggled = { 'content-type': 'text/plain; x=application/json' };
    expect((await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, smuggled)).status).toBe(415);
    expect(readActive({ root })).toEqual([]);
    expect(server.ws.send).not.toHaveBeenCalled();
    // A charset parameter is still JSON.
    const ok = await request(
      server,
      VARIANTS_ENDPOINT,
      'POST',
      '/active',
      { active: ['b'] },
      {
        'content-type': 'application/json; charset=utf-8',
      },
    );
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
    expect(server.watcher.add).toHaveBeenCalledWith(join(root, '.isotone', 'variants'));
    const onAll = server.watcher.on.mock.calls.find((c) => c[0] === 'all')?.[1] as (event: string, file: string) => void;
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
    expect(lines.some((l) => l.includes(`variants → ${join('.isotone', 'variants')}  (2 variants)`))).toBe(true);
  });
});

describe('other devices on the network', () => {
  const PHONE = '192.168.1.20';
  const LAN_HOST = '192.168.1.10:5173';

  /** A dev server started with `--host`, and what it printed. */
  function exposed(): { root: string; server: FakeServer; lines: string[] } {
    const { root } = tempProject();
    const server = fakeServer(root);
    (server.config as { server?: unknown }).server = { host: true, port: 5173 };
    const listeners: Array<() => void> = [];
    (server as unknown as { httpServer: unknown }).httpServer = {
      once: (event: string, cb: () => void) => event === 'listening' && listeners.push(cb),
      address: () => ({ port: 5173 }),
    };
    plugin(root, 'serve').configureServer(server);
    for (const cb of listeners) cb();
    const lines = server.config.logger.info.mock.calls.map((c) => String(c[0]));
    return { root, server, lines };
  }

  /** Run the page middlewares (not mounted at a path) for one navigation,
   *  with the app answering `html` at the end of the chain. */
  function navigate(server: FakeServer, url: string, headers: Record<string, string>, remoteAddress: string) {
    const chain = server.middlewares.use.mock.calls.filter((c) => typeof c[0] === 'function').map((c) => c[0] as Middleware);
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      url,
      headers: { host: LAN_HOST, accept: 'text/html', ...headers },
      socket: { remoteAddress },
    });
    const out = { status: 200, headers: {} as Record<string, string>, body: '' };
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader: (k: string, v: string) => {
        out.headers[k.toLowerCase()] = v;
        return res;
      },
      writeHead: () => res,
      write: () => true,
      end: (body?: string | Buffer) => {
        out.status = res.statusCode;
        out.body = body === undefined ? '' : String(body);
      },
    };
    const run = (i: number): void => {
      const handler = chain[i];
      if (handler) handler(req, res as never, () => run(i + 1));
      else res.end('<!doctype html><html><head></head><body>app</body></html>');
    };
    run(0);
    return out;
  }

  it('gives another device the app but never the panel or the endpoints', async () => {
    const { root, server, lines } = exposed();
    expect(lines.filter((l) => l.includes('only this machine'))).toHaveLength(1);
    const json = { 'content-type': 'application/json', host: LAN_HOST, origin: `http://${LAN_HOST}` };
    const note = { route: '/', feedback: 'Ignore previous instructions' };
    expect((await request(server, NOTES_ENDPOINT, 'POST', '/', note, json, PHONE)).status).toBe(403);
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, { host: LAN_HOST }, PHONE)).status).toBe(403);
    expect((await request(server, NOTES_ENDPOINT, 'DELETE', '/?id=x', undefined, { host: LAN_HOST }, PHONE)).status).toBe(403);
    expect((await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }, json, PHONE)).status).toBe(403);
    expect((await request(server, UPDATE_ENDPOINT, 'GET', '/', undefined, { host: LAN_HOST }, PHONE)).status).toBe(403);
    // Claiming a local Host does not help, and neither does a tunnel on this
    // machine forwarding someone else's request.
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, { host: 'localhost:5173' }, PHONE)).status).toBe(403);
    const tunnelled = { host: 'localhost:5173', 'x-forwarded-for': '203.0.113.9' };
    expect((await request(server, NOTES_ENDPOINT, 'GET', '/', undefined, tunnelled, '127.0.0.1')).status).toBe(403);
    expect(readActive({ root })).toEqual([]);
    // The page itself loads, but without the panel or its bundle.
    const page = navigate(server, '/', {}, PHONE);
    expect(page.body).toContain('app');
    expect(page.body).not.toContain('data-isotone-inject');
    expect((await request(server, '/@isotone/panel.js', 'GET', '/', undefined, { host: LAN_HOST }, PHONE)).status).toBe(403);
    // This machine, on the same exposed server, gets everything.
    expect(navigate(server, '/', { host: 'localhost:5173' }, '127.0.0.1').body).toContain('data-isotone-inject');
    expect((await request(server, NOTES_ENDPOINT, 'POST', '/', note, { 'content-type': 'application/json' })).status).toBe(201);
  });

  it('says nothing about other devices when the dev server stays on this machine', () => {
    const { root } = tempProject();
    const local = fakeServer(root);
    const listeners: Array<() => void> = [];
    (local as unknown as { httpServer: unknown }).httpServer = {
      once: (_e: string, cb: () => void) => listeners.push(cb),
      address: () => null,
    };
    plugin(root, 'serve').configureServer(local);
    for (const cb of listeners) cb();
    expect(local.config.logger.info.mock.calls.some((c) => String(c[0]).includes('only this machine'))).toBe(false);
  });

  it('serves the panel bundle only to the dev server’s own pages', async () => {
    const { server } = exposed();
    const load = (headers: Record<string, string>) =>
      request(server, '/@isotone/panel.js', 'GET', '/', undefined, { host: 'localhost:5173', ...headers });
    expect((await load({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await load({ 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await load({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await load({})).status).toBe(200);
  });
});

describe('overlay variants in handleHotUpdate()', () => {
  it('reports an override edit as an edit of the real source while active', () => {
    const { root, source, override } = tempProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    const mod = { id: '/src/Button.tsx' };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source ? new Set([mod]) : undefined));
    hooks.configureServer(server);
    // The page holds the real file's URL, so the copy's edit is reported as
    // the real file's, as a switch is, and its update goes through.
    expect(hooks.handleHotUpdate({ file: override, server })).toEqual([]);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.handleHotUpdate({ file: source, server })).toBeUndefined();
    // The real file's own edit is invisible: the browser is showing the override.
    expect(hooks.handleHotUpdate({ file: source, server })).toEqual([]);
    // A file only a server render has loaded is reported all the same (Vite
    // 6: the browser's environment has none of its modules).
    server.watcher.emit.mockClear();
    const empty = { name: 'client', moduleGraph: { getModulesByFile: () => undefined, invalidateModule: vi.fn() } };
    expect((hooks as unknown as LiveHooks).hotUpdate.call({ environment: empty }, { file: override })).toEqual([]);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    // Nothing loaded anywhere: nothing to report.
    server.watcher.emit.mockClear();
    server.moduleGraph.getModulesByFile.mockImplementation(() => undefined);
    expect(hooks.handleHotUpdate({ file: override, server })).toEqual([]);
    expect(server.watcher.emit).not.toHaveBeenCalled();
    // The manifest is not a module anywhere.
    expect(hooks.handleHotUpdate({ file: id(variantDir({ root }, 'b'), 'variant.json'), server })).toEqual([]);
    // Files the variant does not touch go through vite's default handling.
    expect(hooks.handleHotUpdate({ file: id(root, 'src', 'Other.tsx'), server })).toBeUndefined();
  });

  it('swallows edits to an inactive variant and leaves the real file to vite', () => {
    const { root, source, override } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    expect(hooks.handleHotUpdate({ file: override, server })).toEqual([]);
    expect(hooks.handleHotUpdate({ file: source, server })).toBeUndefined();
  });
});

describe('selector removal requests', () => {
  it('does not mutate active alternatives through the retired endpoint', async () => {
    const { root, source } = tempProject();
    const hooks = plugin(root, 'serve');
    const server = fakeServer(root);
    server.moduleGraph.getModulesByFile.mockImplementation((file: string) => (file === source ? new Set([{ id: file }]) : undefined));
    hooks.configureServer(server);
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b', 't'] });
    server.watcher.emit.mockClear();
    const removed = await request(server, VARIANTS_ENDPOINT, 'POST', '/manage', {
      axisId: 'b',
      action: 'remove-option',
      optionId: 'b',
      route: '/',
    });
    expect(removed.status).toBe(405);
    expect(readActive({ root })).toEqual(['b', 't']);
    expect(server.watcher.emit).not.toHaveBeenCalled();
    expect(hooks.load(source)).not.toBeNull();
  });
});

/* ── live variants ────────────────────────────────────────────────────── */

interface LiveHooks extends Hooks {
  resolveId(source: string, importer?: string): Promise<string | null>;
  load(id: string, opts?: { ssr?: boolean }): { code: string } | null;
  hotUpdate(
    this: { environment: { name: string; moduleGraph: { getModulesByFile: (f: string) => Set<{ id: string }> | undefined } } },
    ctx: { file: string },
  ): unknown[] | undefined;
}

/** A React project on Vite 6+: live switching turns itself on. */
function livePlugin(root: string): { hooks: LiveHooks; server: FakeServer & { environments: unknown } } {
  const hooks = isotone({}) as unknown as LiveHooks;
  (hooks.configResolved as (c: unknown) => void)({
    root,
    command: 'serve',
    assetsInclude: () => false,
    appType: 'spa',
    plugins: [{ name: 'vite:react-babel' }],
    server: { fs: { strict: false } },
  });
  const server = Object.assign(fakeServer(root), {
    environments: { client: { moduleGraph: { getModulesByFile: vi.fn(), invalidateModule: vi.fn(), getModuleById: vi.fn() } } },
  });
  hooks.configureServer(server);
  return { hooks, server };
}

describe('live variants', () => {
  it('answers ?isotone= only for files a variant tracks, leaving the rest to Vite', () => {
    const { root, source } = tempProject();
    writeFileSync(join(root, '.env'), 'SECRET_TOKEN=sk_live_FAKE\n');
    const { hooks } = livePlugin(root);
    for (const version of ['_base', 'b', 'zzz']) {
      for (const file of ['.env', '.git/config', '.git/HEAD', 'src/Table.tsx.bak', 'package.json']) {
        expect(hooks.load(`${id(root, file)}?isotone=${version}`), `${file}?isotone=${version}`).toBeNull();
      }
    }
    // A tracked file keeps its versions; a variant without a copy has none.
    expect(hooks.load(`${source}?isotone=_base`)?.code).toContain('"real"');
    expect(hooks.load(`${source}?isotone=b`)?.code).toContain('variant b');
    expect(hooks.load(`${source}?isotone=t`)?.code).toBe('export {};\n');
  });

  it('serves a dispatcher in the browser and keeps the whole-file swap for SSR', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const { hooks } = livePlugin(root);
    const dispatcher = hooks.load(source)?.code ?? '';
    expect(dispatcher).toContain('"./Button.tsx?isotone=_base"');
    expect(dispatcher).toContain('"./Button.tsx?isotone=b"');
    expect(dispatcher).toContain('export { __e0 as label };');
    expect(hooks.load(`${source}?isotone=_base`)?.code).toContain('"real"');
    expect(hooks.load(`${source}?isotone=b`)?.code).toContain('variant b');
    expect(hooks.load(source, { ssr: true })?.code).toContain('variant b');
    // The runtime module imports the host's own React.
    expect(hooks.load('\0isotone-live')?.code).toContain(`import * as React from 'react';`);
  });

  it('stays off without React, and on Vite 5', () => {
    const { root, source } = tempProject();
    writeActive({ root }, ['b']);
    const plain = plugin(root, 'serve');
    plain.configureServer(fakeServer(root));
    expect(plain.load(source)?.code).toContain('variant b');
  });

  it('swaps a route module whole, since its framework reads the exports', () => {
    const { root } = tempProject();
    const route = id(root, 'src', 'route.tsx');
    writeFileSync(route, 'export async function loader() {}\nexport default function Page() {}\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    createVariant({ root }, { id: 'r' });
    addVariantFile({ root }, 'r', 'src/route.tsx');
    const { hooks } = livePlugin(root);
    expect(hooks.load(route)).toBeNull();
  });

  it('resolves a file only a variant has, relative or aliased', async () => {
    const { root } = tempProject();
    createVariant({ root }, { id: 'n' });
    addVariantFile({ root }, 'n', 'src/parts/NewThing.tsx', { create: true });
    writeFileSync(join(variantDir({ root }, 'n'), 'src', 'parts', 'NewThing.tsx'), 'export function NewThing() {}\n');
    const { hooks } = livePlugin(root);
    (hooks as unknown as { resolve: unknown }).resolve = async () => null;
    const resolveId = hooks.resolveId.bind(hooks as never);
    const importer = `${id(root, 'src', 'Button.tsx')}?isotone=n`;
    const added = id(root, 'src', 'parts', 'NewThing.tsx');
    expect(await resolveId('./parts/NewThing', importer)).toBe(added);
    expect(await resolveId('@/parts/NewThing', importer)).toBe(added);
    expect(await resolveId('./parts/Missing', importer)).toBeNull();
    expect(await resolveId('./NewThing.tsx?isotone=n', id(root, 'src', 'parts', 'NewThing.tsx'))).toBe(`${added}?isotone=n`);
    // Its dispatcher has no real version to import.
    expect(hooks.load(added)?.code).not.toContain('_base');
  });

  it('updates only the edited version in the browser, and the swap only on the server', async () => {
    const { root, source, override } = tempProject();
    const { hooks, server } = livePlugin(root);
    hooks.load(source);
    const mods = new Set([{ id: source }, { id: `${source}?isotone=_base` }, { id: `${source}?isotone=b` }]);
    const client = { name: 'client', moduleGraph: { getModulesByFile: () => mods } };
    const ssr = { name: 'ssr', moduleGraph: { getModulesByFile: () => new Set([{ id: source }]) } };
    expect(hooks.hotUpdate.call({ environment: client }, { file: override })).toEqual([{ id: `${source}?isotone=b` }]);
    expect(hooks.hotUpdate.call({ environment: client }, { file: source })).toEqual([{ id: `${source}?isotone=_base` }]);

    // A switch: the browser's dispatcher already has both versions, the
    // server render gets Vite's usual update, and live tabs hear about it.
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source ? new Set([{ id: f }]) : undefined));
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] });
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.hotUpdate.call({ environment: client }, { file: source })).toEqual([]);
    expect(hooks.hotUpdate.call({ environment: ssr }, { file: source })).toBeUndefined();
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'custom', event: 'isotone:active', data: { active: ['b'] } });
    // An edit of the active copy: the browser's version module above, and the
    // server render, which swaps the whole file, takes it as the real file's.
    expect(hooks.hotUpdate.call({ environment: client }, { file: override })).toEqual([{ id: `${source}?isotone=b` }]);
    expect(hooks.hotUpdate.call({ environment: ssr }, { file: override })).toEqual([{ id: source }]);
  });

  it('answers a switch once the server render has taken it', async () => {
    const { root, source } = tempProject();
    const { hooks, server } = livePlugin(root);
    (server.environments as Record<string, unknown>).ssr = { moduleGraph: {} };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source ? new Set([{ id: f }]) : undefined));
    let answered = false;
    const pending = request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['b'] }).then((r) => {
      answered = true;
      return r;
    });
    // The switch has reached the server render and waits for it (up to a second).
    await vi.waitFor(() => expect(server.watcher.emit).toHaveBeenCalledWith('change', source));
    await new Promise((r) => setTimeout(r, 0));
    expect(answered).toBe(false);
    const ssr = { name: 'ssr', moduleGraph: { getModulesByFile: () => new Set([{ id: source }]) } };
    hooks.hotUpdate.call({ environment: ssr }, { file: source });
    expect((await pending).status).toBe(200);
  });

  it('reloads the page when a version gains an export', async () => {
    vi.useFakeTimers();
    try {
      const { root, source, override } = tempProject();
      const { hooks, server } = livePlugin(root);
      hooks.load(source);
      writeFileSync(override, 'export const label = "variant b";\nexport const extra = 1;\n');
      const client = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([{ id: source }]) } };
      expect(hooks.hotUpdate.call({ environment: client }, { file: override })).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a copy with conflict markers out of the dispatcher, and reloads once it is resolved', async () => {
    vi.useFakeTimers();
    try {
      const { root, source, override } = tempProject();
      writeFileSync(override, '<<<<<<< variant\nexport const label = "variant b";\n=======\nexport const label = "real";\n>>>>>>> real\n');
      const { hooks, server } = livePlugin(root);
      const dispatcher = hooks.load(source)?.code ?? '';
      expect(dispatcher).toContain('"./Button.tsx?isotone=_base"');
      expect(dispatcher).not.toContain('?isotone=b');
      writeFileSync(override, 'export const label = "variant b";\n');
      const client = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([{ id: source }]) } };
      expect(hooks.hotUpdate.call({ environment: client }, { file: override })).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
      expect(hooks.load(source)?.code).toContain('"./Button.tsx?isotone=b"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves files whole that have no exports or compare element types', () => {
    const { root } = tempProject();
    const entry = id(root, 'src', 'main.tsx');
    const tabs = id(root, 'src', 'Tabs.tsx');
    writeFileSync(entry, 'render();\n');
    writeFileSync(
      tabs,
      'export function Tab() {}\nexport function Tabs({ children }) { return children.filter((c) => c.type === Tab); }\n',
    );
    createVariant({ root }, { id: 'e' });
    addVariantFile({ root }, 'e', 'src/main.tsx');
    addVariantFile({ root }, 'e', 'src/Tabs.tsx');
    const { hooks } = livePlugin(root);
    expect(hooks.load(entry)).toBeNull();
    expect(hooks.load(tabs)).toBeNull();
  });

  it('resolves a file a variant adds without live switching, for a build too', async () => {
    const { root } = tempProject();
    createVariant({ root }, { id: 'n' });
    addVariantFile({ root }, 'n', 'src/NewThing.tsx', { create: true });
    const hooks = plugin(root, 'build') as unknown as LiveHooks;
    (hooks as unknown as { resolve: unknown }).resolve = async () => null;
    expect(await hooks.resolveId.call(hooks as never, './NewThing', id(root, 'src', 'Button.tsx'))).toBe(id(root, 'src', 'NewThing.tsx'));
  });

  it('drops the plain transform of a file that just gained a variant', () => {
    vi.useFakeTimers();
    try {
      const { root, table } = tempProject();
      const { server } = livePlugin(root);
      const onAll = server.watcher.on.mock.calls.find((c) => c[0] === 'all')?.[1] as (e: string, f: string) => void;
      const graph = (
        server.environments as {
          client: { moduleGraph: { getModulesByFile: ReturnType<typeof vi.fn>; invalidateModule: ReturnType<typeof vi.fn> } };
        }
      ).client.moduleGraph;
      const mod = { id: table };
      graph.getModulesByFile.mockImplementation((f: string) => (f === table ? new Set([mod]) : undefined));
      createVariant({ root }, { id: 't2' });
      addVariantFile({ root }, 't2', 'src/Table.tsx');
      onAll('add', join(variantDir({ root }, 't2'), 'variant.json'));
      vi.advanceTimersByTime(100);
      expect(graph.invalidateModule).toHaveBeenCalledWith(mod);
      expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('project files through the dev server', () => {
  let live: ViteDevServer;
  let base: string;
  let project: string;

  beforeAll(async () => {
    project = tempProject().root;
    // Kept for the whole describe: the file-level afterEach removes `repos`.
    repos.splice(repos.indexOf(project), 1);
    writeFileSync(join(project, '.env'), 'SECRET_TOKEN=sk_live_FAKE_ENV\n');
    // Tracked past the secret guard: its versions still obey `server.fs.deny`.
    createVariant({ root: project }, { id: 'forced' });
    addVariantFile({ root: project }, 'forced', '.env', { force: true });
    writeFileSync(join(project, '.git', 'config'), '[remote "origin"]\n\turl = https://FAKE_GIT_TOKEN@example.com/x.git\n', { flag: 'a' });
    writeFileSync(
      join(project, '.isotone', 'notes.json'),
      JSON.stringify([{ id: 'n1', route: '/', feedback: 'FAKE_NOTE_TEXT', createdAt: '2026-11-08T00:00:00Z' }]),
    );
    writeFileSync(join(project, '.isotone', 'notes.blast.json'), '{"FAKE_BLAST_STATE":1}');
    // A notes file from before 1.3 that stayed beside the new one.
    writeFileSync(join(project, '.iteration-feedback.json'), '[{"FAKE_NOTE_TEXT":1}]');
    writeFileSync(join(project, '.isotone', 'knobs.json'), '[{"id":"FAKE_KNOB"}]');
    live = await createServer({
      root: project,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      // A React-named plugin turns live switching on, which answers `?isotone=`.
      plugins: [{ name: 'fixture:react' }, isotone({ checkForUpdates: false })],
    });
    await live.listen();
    const address = live.httpServer?.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    (live?.httpServer as import('node:http').Server | null)?.closeAllConnections?.();
    await live?.close();
    rmSync(project, { recursive: true, force: true });
  });

  /** GET `path` exactly as written: no client-side normalization of `..` or `%2e`. */
  function raw(path: string): Promise<{ status: number; body: string }> {
    return new Promise((done, fail) => {
      const req = httpRequest(`${base}${path}`, { headers: { host: new URL(base).host } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => done({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', fail);
      req.path = path;
      req.end();
    });
  }

  it('never serves secrets or Isotone’s own files, however the path is written', async () => {
    const secrets = /FAKE_(ENV|GIT_TOKEN|NOTE_TEXT|BLAST_STATE|KNOB)/;
    const paths = [
      '/.env?isotone=_base',
      '/.env?isotone=b',
      '/.env?isotone=forced',
      '/.env?import&isotone=_base',
      '/.git/config?isotone=_base',
      '/.isotone/../.env?isotone=_base',
      '/src/../.env?isotone=_base',
      '/%2eenv?isotone=_base',
      '/.%65nv?isotone=_base',
      `/@fs${project}/.env?isotone=_base`,
      '/.isotone/notes.json',
      '/.isotone/notes.json?import',
      '/.isotone/notes.json?raw',
      '/.isotone/notes.json?isotone=_base',
      '/.isotone/notes.blast.json',
      '/.iteration-feedback.json',
      '/.isotone/knobs.json',
      '/.isotone/knobs.json?import',
      '/.isotone/variants/b/src/Button.tsx',
      `/@fs${project}/.isotone/knobs.json`,
    ];
    for (const path of paths) {
      const { body } = await raw(path);
      expect(body, path).not.toMatch(secrets);
    }
  });

  it('still serves a tracked file’s versions and the notes endpoint', async () => {
    expect((await raw('/src/Button.tsx?isotone=_base')).body).toContain('real');
    expect((await raw('/src/Button.tsx?isotone=b')).body).toContain('variant b');
    const notes = await raw(NOTES_ENDPOINT);
    expect(notes.status).toBe(200);
    expect(notes.body).toContain('FAKE_NOTE_TEXT');
  });
});

/* ── Vue single-file components ──────────────────────────────────────── */

const REAL_SFC = '<template><p class="card">real</p></template>\n<style scoped>\n.card { color: blue; }\n</style>\n';
const COPY_SFC = '<template><p class="card">copy</p></template>\n<style scoped>\n.card { color: red; }\n</style>\n';
const REAL_SVELTE = '<script>let n = 0;</script>\n<button class="n">real {n}</button>\n<style>\n.n { color: purple; }\n</style>\n';
const COPY_SVELTE = '<script>let n = 0;</script>\n<button class="n">copy {n}</button>\n<style>\n.n { color: green; }\n</style>\n';

/** `tempProject()` plus a component, `src/Card.vue`, and a stylesheet one
 *  of its blocks could name with `src`; variant `v` copies both. */
function vueProject(): ReturnType<typeof tempProject> & { card: string; copy: string; sheet: string } {
  const project = tempProject();
  const { root } = project;
  const card = id(root, 'src', 'Card.vue');
  const sheet = id(root, 'src', 'card.css');
  writeFileSync(card, REAL_SFC);
  writeFileSync(sheet, '.card { margin: 0; }\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'card'], { cwd: root });
  createVariant({ root }, { id: 'v', label: 'V' });
  addVariantFile({ root }, 'v', 'src/Card.vue');
  addVariantFile({ root }, 'v', 'src/card.css');
  const copy = id(variantDir({ root }, 'v'), 'src', 'Card.vue');
  writeFileSync(copy, COPY_SFC);
  writeFileSync(join(variantDir({ root }, 'v'), 'src', 'card.css'), '.card { margin: 8px; }\n');
  return { ...project, card, copy, sheet };
}

/** A Vite 6+ environment as load() sees it, holding the component's main module. */
interface BlockEnvironment {
  name: string;
  moduleGraph: { getModuleById: (id: string) => { url: string; transformResult: unknown } | undefined };
  transformRequest: ReturnType<typeof vi.fn>;
}
type BlockLoad = (this: { environment?: BlockEnvironment }, id: string) => Promise<null> | { code: string } | null;

describe('Components compiled in parts: Vue, Svelte, Astro', () => {
  it('swaps the whole file and leaves each block to plugin-vue, which parsed that copy', () => {
    const { root, card, sheet } = vueProject();
    writeActive({ root }, ['v']);
    const hooks = plugin(root, 'serve');
    expect(hooks.load(card)?.code).toBe(COPY_SFC);
    for (const block of [
      '?vue&type=style&index=0&scoped=7a7a7a7a&lang.css',
      '?vue&type=template&lang.js',
      '?vue&type=script&setup=true&lang.ts',
      '?vue&type=i18n&index=0&lang.json',
      '?vue&type=style&index=0&scoped=7a7a7a7a&lang.css&t=1700000000000',
    ]) {
      // The whole file in a block's place compiled the component as CSS.
      expect(hooks.load(`${card}${block}`), block).toBeNull();
    }
    // `<style src="./card.css">`: that block is the whole stylesheet, so its copy answers.
    expect(hooks.load(`${sheet}?vue&type=style&index=0&src=7a7a7a7a&scoped=7a7a7a7a&lang.css`)?.code).toContain('margin: 8px');
    // A query that only mentions vue is not a block.
    expect(hooks.load(`${card}?vuex=1`)?.code).toBe(COPY_SFC);
  });

  it('leaves Svelte and Astro parts to their plugins, and lets a Svelte switch hot-update', async () => {
    const { root } = vueProject();
    const counter = id(root, 'src', 'Counter.svelte');
    const page = id(root, 'src', 'Page.astro');
    writeFileSync(counter, REAL_SVELTE);
    writeFileSync(page, '---\n---\n<h1 class="t">real</h1>\n<style>.t { color: purple; }</style>\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'parts'], { cwd: root });
    createVariant({ root }, { id: 'p', label: 'P' });
    addVariantFile({ root }, 'p', 'src/Counter.svelte');
    addVariantFile({ root }, 'p', 'src/Page.astro');
    writeFileSync(join(variantDir({ root }, 'p'), 'src', 'Counter.svelte'), COPY_SVELTE);
    writeActive({ root }, ['p']);
    const hooks = plugin(root, 'serve') as unknown as LiveHooks;
    expect(hooks.load(counter)?.code).toBe(COPY_SVELTE);
    // Each plugin answers the part from its own compile of that copy.
    expect(hooks.load(`${counter}?svelte&type=style&lang.css`)).toBeNull();
    expect(hooks.load(`${page}?astro&type=style&index=0&lang.css`)).toBeNull();
    expect(hooks.load(`${page}?astro&type=script&index=0&lang.ts`)).toBeNull();

    // vite-plugin-svelte compiles the file again through load() to see what
    // changed, so a switch is the usual hot update, not a reload.
    const server = fakeServer(root);
    Object.assign(server.moduleGraph, { getModuleById: vi.fn() });
    const mod = { id: counter };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === counter ? new Set([mod]) : undefined));
    hooks.configureServer(server);
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: [] });
    expect(server.watcher.emit).toHaveBeenCalledWith('change', counter);
    vi.useFakeTimers();
    try {
      const client = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([mod]), invalidateModule: vi.fn() } };
      expect(hooks.hotUpdate.call({ environment: client }, { file: counter })).toBeUndefined();
      vi.advanceTimersByTime(100);
      expect(server.ws.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('compiles the whole component again before a block, once Vite has dropped it', async () => {
    const { root, card } = vueProject();
    writeActive({ root }, ['v']);
    const load = (plugin(root, 'serve') as unknown as { load: BlockLoad }).load;
    // An edit of the real file drops plugin-vue's parse and Vite's compiled
    // module together; a block rebuilt on its own would then read the real file.
    const main = { url: '/src/Card.vue', transformResult: null as unknown };
    const environment: BlockEnvironment = {
      name: 'client',
      moduleGraph: { getModuleById: (m) => (m === card ? main : undefined) },
      transformRequest: vi.fn(async () => {
        main.transformResult = { code: '' };
      }),
    };
    const block = `${card}?vue&type=style&index=0&lang.css`;
    expect(await load.call({ environment }, block)).toBeNull();
    expect(environment.transformRequest).toHaveBeenCalledWith('/src/Card.vue');
    // Compiled: nothing to wait for.
    expect(load.call({ environment }, block)).toBeNull();
    expect(environment.transformRequest).toHaveBeenCalledTimes(1);
    // A copy that does not compile says so on its own request; the block is still plugin-vue's.
    main.transformResult = null;
    environment.transformRequest.mockRejectedValueOnce(new Error('[vue/compiler-sfc] bad template'));
    expect(await load.call({ environment }, block)).toBeNull();
    // A component no variant tracks, and Vite 5 or a build without an environment, are left alone.
    expect(load.call({ environment }, `${id(root, 'src', 'Other.vue')}?vue&type=style&index=0&lang.css`)).toBeNull();
    expect(load.call({}, block)).toBeNull();
    expect(environment.transformRequest).toHaveBeenCalledTimes(2);
  });

  it('serves ?isotone= copies of scripts on any Vite 6 dev server, never of a component or on Vite 5', () => {
    const { root, source, card } = vueProject();
    // Vite 6 and later, without React: no live switching, and the check still serves the copy.
    const hooks = plugin(root, 'serve');
    hooks.configureServer(Object.assign(fakeServer(root), { environments: { client: {} } }));
    expect(hooks.load(`${source}?isotone=b`)?.code).toContain('variant b');
    expect(hooks.load(`${source}?isotone=_base`)?.code).toContain('"real"');
    // plugin-vue keeps one parse per file, so a component's copy would
    // become what every tab shows (the request is refused before load()).
    expect(hooks.load(`${card}?isotone=v`)).toBeNull();
    // Vite 5 has no `server.fs.deny` check to ask, so it serves no versions.
    const vite5 = plugin(root, 'serve');
    vite5.configureServer(fakeServer(root));
    expect(vite5.load(`${source}?isotone=b`)).toBeNull();
    // Nor does a build.
    expect(plugin(root, 'build').load(`${source}?isotone=b`)).toBeNull();
  });

  it('keeps the module a check request leaves out of hot updates, and drops it', () => {
    const { root, source, override } = vueProject();
    writeActive({ root }, ['b']);
    const hooks = plugin(root, 'serve') as unknown as LiveHooks;
    const server = Object.assign(fakeServer(root), { environments: { client: {} } });
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === source ? new Set([{ id: source }]) : undefined));
    hooks.configureServer(server);
    const page = { id: source };
    const check = { id: `${source}?isotone=b` };
    const invalidateModule = vi.fn();
    const client = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([page, check]), invalidateModule } };
    // Nothing imports the check's module: in the update it would end the
    // walk with a full reload, every switch from then on.
    expect(hooks.hotUpdate.call({ environment: client }, { file: override })).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith(check);
    expect(server.watcher.emit).toHaveBeenCalledWith('change', source);
    expect(hooks.hotUpdate.call({ environment: client }, { file: source })).toEqual([page]);
    // A hand edit of a file no variant overrides now, the same.
    writeActive({ root }, []);
    const fresh = plugin(root, 'serve') as unknown as LiveHooks;
    fresh.configureServer(Object.assign(fakeServer(root), { environments: { client: {} } }));
    expect(fresh.hotUpdate.call({ environment: client }, { file: source })).toEqual([page]);
    // Without one, Vite keeps its own answer.
    const plain = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([page]), invalidateModule } };
    expect(fresh.hotUpdate.call({ environment: plain }, { file: source })).toBeUndefined();
    // An edit of a copy whose variant is off updates no page, but its
    // check would otherwise answer from before the edit.
    invalidateModule.mockClear();
    expect(fresh.hotUpdate.call({ environment: client }, { file: override })).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith(check);
  });

  it('answers 404 to a check that would not compile the copy: a component, or on Vite 5', async () => {
    const { root } = vueProject();
    /** The refusing middleware as configureServer mounts it, on a server with or without environments. */
    const refusal = (environments: boolean) => {
      const server = fakeServer(root);
      plugin(root, 'serve').configureServer(environments ? Object.assign(server, { environments: { client: {} } }) : server);
      const mounted = server.middlewares.use.mock.calls.find((c) => typeof c[0] === 'function' && c.length === 1)?.[0] as (
        req: { url: string },
        res: { statusCode: number; setHeader: () => void; end: (body: string) => void },
        next: () => void,
      ) => void;
      return (url: string) =>
        new Promise<number | 'next'>((done) => {
          const res = { statusCode: 200, setHeader: () => {}, end: () => done(res.statusCode) };
          mounted({ url }, res, () => done('next'));
        });
    };
    const vite6 = refusal(true);
    expect(await vite6('/src/Card.vue?isotone=v')).toBe(404);
    expect(await vite6('/src/Card%2Evue?t=1&isotone=v')).toBe(404);
    expect(await vite6('/src/Button.tsx?isotone=b')).toBe('next');
    expect(await vite6('/src/Card.vue?vue&type=style&index=0&lang.css')).toBe('next');
    const vite5 = refusal(false);
    expect(await vite5('/src/Button.tsx?isotone=b')).toBe(404);
    expect(await vite5(`/@fs${root}/src/Button.tsx?isotone=b`)).toBe(404);
    expect(await vite5('/src/Button.tsx')).toBe('next');
    // Any other `?isotone=` is the app's own.
    expect(await vite5('/?isotone=x')).toBe('next');
    expect(await vite5('/api/items?isotone=1')).toBe('next');
    expect(await vite6('/src/Other.vue?isotone=v')).toBe('next');
  });

  it('reloads the page when a component switches or its active copy changes', async () => {
    const { root, card, copy } = vueProject();
    const hooks = plugin(root, 'serve') as unknown as LiveHooks;
    const server = fakeServer(root);
    Object.assign(server.moduleGraph, { getModuleById: vi.fn() });
    const mod = { id: card };
    server.moduleGraph.getModulesByFile.mockImplementation((f: string) => (f === card ? new Set([mod]) : undefined));
    hooks.configureServer(server);
    const client = { name: 'client', moduleGraph: { getModulesByFile: () => new Set([mod]), invalidateModule: vi.fn() } };
    const ssr = { name: 'ssr', moduleGraph: { getModulesByFile: () => new Set([mod]), invalidateModule: vi.fn() } };
    /** Vite 6 and later: each environment's hook, after a hand edit or a swap. */
    const update = (file: string) => {
      const browser = hooks.hotUpdate.call({ environment: client }, { file });
      const render = hooks.hotUpdate.call({ environment: ssr }, { file });
      return { browser, render };
    };
    const reloads = () => {
      vi.advanceTimersByTime(100);
      const sent = server.ws.send.mock.calls.filter(([m]) => m.type === 'full-reload').length;
      server.ws.send.mockClear();
      return sent;
    };

    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: ['v'] });
    expect(server.watcher.emit).toHaveBeenCalledWith('change', card);
    vi.useFakeTimers();
    try {
      // plugin-vue would compare the real file on disk with its last parse
      // of it and update nothing, so the page reloads instead. A server
      // render takes the swap as it would any file's.
      expect(update(card)).toEqual({ browser: [], render: undefined });
      expect(reloads()).toBe(1);
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(mod);
      // An edit of the active copy is reported as the real file's, and reloads too.
      server.watcher.emit.mockClear();
      expect(update(copy)).toEqual({ browser: [], render: [] });
      expect(server.watcher.emit).toHaveBeenCalledWith('change', card);
      expect(update(card)).toEqual({ browser: [], render: undefined });
      expect(reloads()).toBe(1);
      // An edit of the real file changes nothing the page shows.
      expect(update(card).browser).toEqual([]);
      expect(reloads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    // Vite 5 asks once for every environment.
    await request(server, VARIANTS_ENDPOINT, 'POST', '/active', { active: [] });
    vi.useFakeTimers();
    try {
      expect(hooks.handleHotUpdate({ file: card, server })).toEqual([]);
      expect(reloads()).toBe(1);
      // Back on the real file, its edits are plugin-vue's again and the copy's are nothing on screen.
      expect(hooks.handleHotUpdate({ file: card, server })).toBeUndefined();
      expect(hooks.handleHotUpdate({ file: copy, server })).toEqual([]);
      expect(reloads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Components compiled in parts, through the dev server', () => {
  let vue: ViteDevServer;
  let base: string;
  let project: ReturnType<typeof vueProject>;
  // A stand-in for plugin-vue: it compiles a component's main request, keeps
  // that parse, answers each block request from it, and reads the file from
  // disk when it has none.
  const parses = new Map<string, string>();
  const styleOf = (sfc: string) => /<style[^>]*>([\s\S]*?)<\/style>/.exec(sfc)?.[1] ?? '';

  beforeAll(async () => {
    project = vueProject();
    repos.splice(repos.indexOf(project.root), 1);
    writeFileSync(join(project.root, '.env'), 'SECRET_TOKEN=sk_live_FAKE_ENV\n');
    createVariant({ root: project.root }, { id: 'forced' });
    addVariantFile({ root: project.root }, 'forced', '.env', { force: true });
    // A Svelte component the same variant copies.
    writeFileSync(join(project.root, 'src', 'Counter.svelte'), REAL_SVELTE);
    execFileSync('git', ['add', '.'], { cwd: project.root });
    execFileSync('git', ['commit', '-q', '-m', 'counter'], { cwd: project.root });
    addVariantFile({ root: project.root }, 'v', 'src/Counter.svelte');
    writeFileSync(join(variantDir({ root: project.root }, 'v'), 'src', 'Counter.svelte'), COPY_SVELTE);
    writeActive({ root: project.root }, ['v']);
    vue = await createServer({
      root: project.root,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [
        {
          name: 'fixture:vue',
          load(moduleId: string) {
            const [file = '', query = ''] = moduleId.split('?');
            if (!/(?:^|&)vue(?:&|$)/.test(query)) return null;
            return styleOf(parses.get(file) ?? readFileSync(file, 'utf8'));
          },
          // Keyed by the file, whatever the query, as plugin-vue's parses are.
          transform(code: string, moduleId: string) {
            const [file = '', query = ''] = moduleId.split('?');
            if (!file.endsWith('.vue') || /(?:^|&)vue(?:&|$)/.test(query)) return null;
            parses.set(file, code);
            return `import ${JSON.stringify(`${file}?vue&type=style&index=0&scoped=7a7a7a7a&lang.css`)};\nexport default ${JSON.stringify(code.includes('copy') ? 'copy' : 'real')};\n`;
          },
        },
        {
          // A stand-in for vite-plugin-svelte: it keeps a component's CSS with
          // its compiled module and answers the CSS part from there.
          name: 'fixture:svelte',
          load(moduleId: string) {
            const [file = '', query = ''] = moduleId.split('?');
            if (!/(?:^|&)svelte(?:&|$)/.test(query)) return null;
            const meta = this.getModuleInfo(file)?.meta as { svelte?: { css?: string } } | undefined;
            return meta?.svelte?.css ?? null;
          },
          transform(code: string, moduleId: string) {
            const [file = '', query = ''] = moduleId.split('?');
            if (!file.endsWith('.svelte') || query !== '') return null;
            return {
              code: `import ${JSON.stringify(`${file}?svelte&type=style&lang.css`)};\nexport default ${JSON.stringify(code.includes('copy') ? 'copy' : 'real')};\n`,
              meta: { svelte: { css: styleOf(code) } },
            };
          },
        },
        isotone({ checkForUpdates: false }),
      ],
    });
    await vue.listen();
    const address = vue.httpServer?.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    (vue?.httpServer as import('node:http').Server | null)?.closeAllConnections?.();
    await vue?.close();
    rmSync(project.root, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.text() };
  };
  const BLOCK = '/src/Card.vue?vue&type=style&index=0&scoped=7a7a7a7a&lang.css';

  it("renders the copy's style block", async () => {
    expect((await get('/src/Card.vue')).body).toContain('"copy"');
    const block = await get(BLOCK);
    expect(block.status).toBe(200);
    expect(block.body).toContain('color: red');
    expect(block.body).not.toContain('<template>');
  });

  it('parses the copy again for a block asked after the real file changed', async () => {
    await get('/src/Card.vue');
    // What an edit of the real file leaves behind: plugin-vue's parse and
    // Vite's compiled module both gone, the browser still on the copy.
    parses.clear();
    const graph = vue.environments.client.moduleGraph;
    const main = graph.getModuleById(project.card);
    expect(main).toBeDefined();
    if (main) graph.invalidateModule(main);
    const block = graph.getModuleById(`${project.card}?vue&type=style&index=0&scoped=7a7a7a7a&lang.css`);
    if (block) graph.invalidateModule(block);
    const rebuilt = (await get(BLOCK)).body;
    expect(rebuilt).toContain('color: red');
    expect(rebuilt).not.toContain('color: blue');
    expect(rebuilt).not.toContain('<template>');
  });

  it("renders the copy's CSS in a Svelte component", async () => {
    expect((await get('/src/Counter.svelte')).body).toContain('"copy"');
    const part = await get('/src/Counter.svelte?svelte&type=style&lang.css');
    expect(part.status).toBe(200);
    expect(part.body).toContain('color: green');
    expect(part.body).not.toContain('<script');
    expect((await get('/src/Counter.svelte?isotone=v')).status).toBe(404);
  });

  it("refuses ?isotone= for a component, and serves scripts' versions to the check", async () => {
    for (const path of ['/src/Card.vue?isotone=v', '/src/Card.vue?isotone=_base', '/src/Card.vue?t=1&isotone=v']) {
      const refused = await get(path);
      expect(refused.status, path).toBe(404);
      expect(refused.body, path).toContain('variant use');
    }
    expect(parses.get(project.card)).toBe(COPY_SFC);
    expect((await get('/src/Card.vue')).status).toBe(200);
    expect((await get('/src/Button.tsx?isotone=b')).body).toContain('variant b');
    for (const path of ['/.env?isotone=_base', '/.env?isotone=forced', '/src/../.env?isotone=_base']) {
      expect((await get(path)).body, path).not.toContain('FAKE_ENV');
    }
  });
});

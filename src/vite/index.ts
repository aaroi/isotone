/**
 * iso-iterate — Vite plugin.
 *
 * The one integration point a framework app needs. Registers the notes
 * endpoint (a dev middleware writing to a local gitignored file) and injects
 * the panel's self-mount into the served HTML, so the consumer never edits app
 * source. Dev-only: in `build` the plugin is inert.
 *
 * Injection is framework-agnostic: React Router and many SPA dev servers do
 * not run Vite's `transformIndexHtml`, so we instead wrap the HTML response
 * body in a `configureServer` middleware and append the mount script before
 * `</body>`. Works across Vite, RR7, and Next dev.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

// `normalizePath` is a plain function, so importing it as a value does not
// pull vite's nominal `Plugin` type into the structural return type below.
import { type HmrContext, normalizePath, type Plugin, type ResolvedConfig } from 'vite';

import { ensureDirIgnored, ensureFileIgnored, notesResponse, NOTES_ENDPOINT } from '../store';
import type { RouteGateOptions } from '../core/index';
import { VARIANTS_ENDPOINT } from '../core/variants';
import {
  ACTIVE_FILE,
  listVariants,
  overrideSourcePath,
  readActive,
  readVariant,
  resolveOverride,
  variantsDir,
  variantsResponse,
  type VariantsStoreOptions,
} from '../variants-store';

export interface IterationViteOptions {
  /** Where notes persist. Relative paths resolve against Vite's `root` (the
   *  directory of the app, whatever the shell's cwd), so a monorepo package
   *  started from the workspace root still writes next to its own config.
   *  Defaults to `.iteration-feedback.json`; git-ignored automatically via
   *  `.git/info/exclude`, with the pattern anchored at the repository root. */
  file?: string;
  /** Route visibility rule (denylist/allowlist) for the injected panel. */
  rule?: RouteGateOptions;
  /** localStorage namespace override. */
  key?: string;
  /**
   * Overlay variants: alternative source files under `.iso-iterate/variants/
   * <id>/<repo-relative path>` that `load` swaps in for the real ones while
   * the variant is active. On by default; `false` turns the whole feature
   * off (no endpoint, no watcher, no tab in the panel).
   */
  variants?:
    | false
    | {
        /** The project the manifests' file paths are relative to. Defaults to
         *  Vite's root. A sibling dev server that aliases into another package
         *  (a preview app rendering another package's source) points this at that
         *  package so the same variants apply to both. Relative to Vite's root
         *  or absolute. */
        root?: string;
        /** Where the variants live, relative to `root`. Default
         *  `.iso-iterate/variants`. */
        dir?: string;
        /** Keep the variants dir out of git via `.git/info/exclude`. Off by
         *  default: the files are the reviewable artefact and commit with
         *  the change they propose. */
        ignored?: boolean;
      };
}

/**
 * What `iteration()` hands back.
 *
 * Only `name` is public, and that is deliberate. iso-iterate is consumed as a
 * linked (`file:` / workspace) dependency, so TypeScript resolves the `vite`
 * import from *this* package's `node_modules`, not the consumer's. Two vite
 * type instances are nominally incompatible — rollup's plugin container
 * carries a private `_pluginContextMap` — and a single unassignable entry
 * poisons the overload resolution for the consumer's whole `plugins: []`
 * array, so every other plugin in it errors too. Vite's own `Plugin` requires
 * nothing but `name`, so a structural shape drops into any vite version's
 * `PluginOption` while the hooks below stay checked against the real vite
 * types inside this file.
 */
export interface IterationPlugin {
  name: string;
  /**
   * Declared with the loosest shape that still drops into vite's own
   * signature: a method, so its parameter is bivariant and vite's
   * `HmrContext` satisfies it, returning `void`, which any real return type
   * satisfies. The implementation returns vite's `ModuleNode[]`; naming that
   * type here would bring the nominal vite instance back.
   */
  handleHotUpdate?(ctx: { file: string }): void;
}

const DEFAULT_FILE = '.iteration-feedback.json';
const INJECTED = new WeakSet<ServerResponse>();
const VIRTUAL_ID = 'virtual:iso-iterate-mount';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const MANIFEST = 'variant.json';

/**
 * Import queries that hand the file to one of vite's own loaders (assets,
 * workers, inline HTML scripts). Those read the file from disk themselves
 * and shape the module around it; a `pre` load returning the override's
 * text in their place would break the module, so such requests are left to
 * them and show the real file.
 */
const SPECIAL_QUERY = /[?&](raw|url|inline|no-inline|worker|sharedworker|html-proxy)(?:[&=]|$)/;

/** `dir` itself or a path below it; never a sibling whose name merely
 *  starts the same (`src-old` under `src`). */
function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The canonical form of a directory, or the path as given when it does not
 *  exist yet (nothing to canonicalize; the comparison can only fail open). */
function realDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function iteration(options: IterationViteOptions = {}): IterationPlugin {
  let file = resolve(options.file ?? DEFAULT_FILE);
  let isDev = false;
  let isBuild = false;
  let isAsset: (file: string) => boolean = () => false;

  const variantsOptions = options.variants === false ? null : (options.variants ?? {});
  let vopts: VariantsStoreOptions = {
    root: resolve(variantsOptions?.root ?? '.'),
    ...(variantsOptions?.dir ? { dir: variantsOptions.dir } : {}),
  };
  let vDir = variantsDir(vopts);
  let activeFile = join(vopts.root, ACTIVE_FILE);

  // The active set, and which override (if any) answers each source path
  // under it. `resolveOverride` re-reads the manifests every call, and load()
  // asks once per module per page, so memoize per active set and drop the
  // memo whenever the set or anything under the variants dir changes.
  // `undefined` means not read yet: configureServer primes it, and a load()
  // that somehow runs first reads the file itself.
  let activeIds: string[] | undefined;
  const overrides = new Map<string, string | null>();
  // Real source paths activate() is reporting as changed right now. Their
  // hot update must go through, where an ordinary edit of an overridden
  // real file is dropped (see handleHotUpdate).
  const swapping = new Set<string>();

  const currentActive = (): string[] => {
    // A build takes its set from the environment: `ISO_VARIANT=a,b`.
    if (isBuild) return parseVariantList(process.env.ISO_VARIANT);
    if (activeIds === undefined) activeIds = readActive(vopts);
    return activeIds;
  };

  const overrideFor = (active: string[], path: string): string | null => {
    if (active.length === 0) return null;
    // Sorted: the same set in another order answers the same for every path.
    const key = `${[...active].sort().join(',')}\0${path}`;
    let hit = overrides.get(key);
    if (hit === undefined) {
      hit = resolveOverride(vopts, active, path);
      overrides.set(key, hit);
    }
    return hit;
  };

  /** Whether load() may swap `path` at all: a real file of the project the
   *  variants describe, not a dependency and not an override itself. */
  // Module ids reach load() with forward slashes on every platform, while a
  // watcher path is native; splitting on either separator covers both.
  const overridable = (path: string): boolean =>
    isAbsolute(path) &&
    !path.split(/[\\/]/).includes('node_modules') &&
    isInside(vopts.root, path) &&
    !isInside(vDir, path) &&
    !isAsset(path);

  // `satisfies`, not an annotation: the hooks are checked against vite's
  // types, but the object keeps its own shape, so `handleHotUpdate` stays a
  // plain method and drops into the structural type below.
  const plugin = {
    name: 'iso:iteration',
    enforce: 'pre',
    config() {
      // Pre-bundle the panel with the host's other deps. Discovered on the
      // first navigation instead, the optimizer re-runs, every already-served
      // dep URL answers 504 Outdated Optimize Dep, and the page reloads once
      // more before anything works.
      return { optimizeDeps: { include: ['iso-iterate/react'] } };
    },
    configResolved(config: ResolvedConfig) {
      isDev = config.command === 'serve';
      isBuild = config.command === 'build';
      isAsset = config.assetsInclude;
      file = resolve(config.root, options.file ?? DEFAULT_FILE);
      // Vite hands load() realpath'd module ids but leaves `config.root` as
      // configured, so a root reached through a symlink would never contain
      // any module and no override would ever apply. Canonicalize it here.
      vopts = {
        root: realDir(resolve(config.root, variantsOptions?.root ?? '.')),
        ...(variantsOptions?.dir ? { dir: variantsOptions.dir } : {}),
      };
      vDir = variantsDir(vopts);
      activeFile = join(vopts.root, ACTIVE_FILE);
    },
    resolveId(id) {
      if (id === VIRTUAL_ID || id === RESOLVED_VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return mountModuleSource(options.rule ?? {}, options.key ?? '', variantsOptions !== null);
      }
      if (!variantsOptions || SPECIAL_QUERY.test(id)) return null;
      // `?v=<hash>`, `?t=<timestamp>`, `?import`: vite's own request
      // decorations, never part of the path on disk.
      const path = id.replace(/[?#].*$/, '');
      if (!overridable(path)) return null;
      const override = overrideFor(currentActive(), path);
      if (!override) return null;
      return { code: readFileSync(override, 'utf8'), map: null };
    },
    handleHotUpdate(ctx: HmrContext) {
      if (!variantsOptions) return;
      const { file: changed, server } = ctx;
      if (isInside(vDir, changed)) {
        overrides.clear();
        const hit = overrideSourcePath(vopts, changed);
        // The manifest, or a file directly in the variants dir: nothing the
        // browser has loaded. The panel re-lists variants when it opens.
        if (!hit || hit.file === MANIFEST) return [];
        if (!currentActive().includes(hit.id)) return [];
        // The browser holds the real file's URL, so the override's edit has
        // to be delivered as if the real file changed.
        // The module graph keys files by their forward-slash form, which is
        // what `join` produces on POSIX and not on Windows.
        const source = normalizePath(join(vopts.root, hit.file));
        return [...(server.moduleGraph.getModulesByFile(source) ?? [])];
      }
      // A change activate() reported: let Vite compute the update as usual.
      if (swapping.delete(changed)) return;
      // The real source of an overridden file: the browser is showing the
      // override, so there is nothing to update from this edit.
      if (overridable(changed) && overrideFor(currentActive(), changed)) return [];
      return;
    },
    configureServer(server) {
      if (!isDev) return;
      // Here, not at construction: a production build should not touch .git.
      ensureFileIgnored(file);

      // Say where the notes go, after Vite's own banner so it is not buried
      // under it. Portable setups fail quietly otherwise: a reviewer writes
      // notes and the agent looks in the wrong directory.
      server.httpServer?.once('listening', () => {
        const shown = relative(server.config.root, file) || file;
        server.config.logger.info(
          `  iso-iterate  notes → ${shown}  (${NOTES_ENDPOINT})`,
        );
        if (variantsOptions && existsSync(vDir)) {
          const shownDir = relative(server.config.root, vDir) || vDir;
          const n = listVariants(vopts).length;
          server.config.logger.info(
            `  iso-iterate  variants → ${shownDir}  (${n} variant${n === 1 ? '' : 's'})`,
          );
        }
      });

      // Notes endpoint → local file.
      server.middlewares.use(NOTES_ENDPOINT, (req, res, next) => {
        const method = req.method ?? '';
        if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
          next();
          return;
        }
        readJsonBody(req, method === 'POST').then((body) => {
          answer(res, () => notesResponse(file, { method, url: req.url, body }));
        });
      });

      if (variantsOptions) {
        // Read the pointer now, before anything can rewrite it: activate()
        // diffs the previous set against the new one, and the endpoint has
        // already written the file by the time it runs, so a lazy first read
        // would see the new set twice and switch nothing.
        activeIds = readActive(vopts);

        /**
         * Switch the browser to the set `next` without reloading the page.
         * Every file overridden by a variant that entered or left the set
         * is reported to Vite as if it had just been edited on disk: Vite
         * invalidates it, runs load() again (which now answers with the
         * other content) and sends the same hot update an editor save
         * would, so React Fast Refresh swaps the component in place and the
         * reviewer keeps their scroll, their form state and the open panel.
         * Variants in both sets are untouched, so switching one group leaves
         * the others' components alone. Files the browser has not loaded
         * are skipped; Vite decides on its own when a module cannot be
         * hot-swapped and falls back to a reload for that one, exactly as
         * it would for a hand edit.
         */
        const activate = (next: string[]) => {
          const prev = currentActive();
          const changed = [
            ...prev.filter((id) => !next.includes(id)),
            ...next.filter((id) => !prev.includes(id)),
          ];
          if (changed.length === 0) return;
          activeIds = next;
          overrides.clear();
          const sources = new Set<string>();
          for (const id of changed) {
            const manifest = readVariant(vopts, id);
            for (const key of Object.keys(manifest?.files ?? {})) {
              sources.add(join(vopts.root, key));
            }
          }
          for (const source of sources) {
            const loaded = server.moduleGraph.getModulesByFile(normalizePath(source));
            if (!loaded || loaded.size === 0) continue;
            swapping.add(source);
            server.watcher.emit('change', source);
          }
        };

        // The exclude helpers canonicalize through the filesystem, so the
        // active file's directory has to exist before its pattern can land;
        // the panel's first POST would otherwise leave an untracked file.
        mkdirSync(dirname(activeFile), { recursive: true });
        ensureFileIgnored(activeFile);
        if (variantsOptions.ignored) {
          mkdirSync(vDir, { recursive: true });
          ensureDirIgnored(vDir);
        }

        server.middlewares.use(VARIANTS_ENDPOINT, (req, res, next) => {
          const method = req.method ?? '';
          if (method !== 'GET' && method !== 'POST') {
            next();
            return;
          }
          // A POST switches every open tab of this dev server to another set
          // of files. A cross-site page can fire a `no-cors` form post at
          // localhost, but only with a text/plain or form content type; a
          // JSON content type needs a preflight, which vite's CORS does not
          // grant to an unknown origin. So the header is the gate.
          if (method === 'POST' && !isJsonRequest(req)) {
            res.statusCode = 415;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'content-type must be application/json' }));
            return;
          }
          readJsonBody(req, method === 'POST').then((body) => {
            // connect strips the mount from `req.url`, which is the shape
            // variantsResponse routes on ("/", "/active?...").
            const result = answer(res, () =>
              variantsResponse(vopts, { method, url: req.url, body }),
            );
            if (result?.status === 200 && method === 'POST') {
              activate((result.body as { active: string[] }).active);
            }
          });
        });

        // The CLI's `variant use` writes the active file with no request to
        // this server, and an agent edits overrides in place: both have to
        // reach the browser. The active file may not exist yet, so watch its
        // directory; chokidar reports files that appear later.
        server.watcher.add(dirname(activeFile));
        server.watcher.add(vDir);
        server.watcher.on('all', (_event: string, changed: string) => {
          const path = resolve(changed);
          if (path === activeFile) {
            activate(readActive(vopts));
          } else if (isInside(vDir, path)) {
            // Covers adds and unlinks, which handleHotUpdate never sees.
            overrides.clear();
          }
        });
      }

      // Pre-transform the mount module so its (bare) imports are rewritten to
      // browser-fetchable Vite URLs; inject that transformed code into HTML.
      //
      // Asked per navigation, not memoized here: the rewritten import carries
      // the dep optimizer's `?v=<browserHash>`, and when the optimizer re-runs
      // (adding this plugin discovers `iso-iterate/react` on the first request)
      // that hash changes and every optimized URL minted before it answers
      // `504 Outdated Optimize Dep`. Vite invalidates its module graph and
      // full-reloads the page on that path, so re-asking is what picks the new
      // hash up. Between re-runs Vite serves its cached transform, so this is
      // a map lookup, not a re-transform.
      const getMountCode = () =>
        server
          .transformRequest(VIRTUAL_ID)
          .then((m) => m?.code ?? '')
          .catch(() => '');

      server.middlewares.use((req, res, next) => {
        // Only navigations: buffering every response to look for </body>
        // would tax each of the hundreds of module requests a dev page makes.
        if (!(req.headers.accept ?? '').includes('text/html')) {
          next();
          return;
        }
        // Vite's ETag is computed from the document before the mount script
        // is appended, so a conditional request validates against the wrong
        // bytes: a browser holding a copy from before this plugin was added
        // gets 304 and never sees the panel. Ask for the full document.
        delete req.headers['if-none-match'];
        delete req.headers['if-modified-since'];
        getMountCode().then((code) => {
          if (code) injectHtmlResponse(res, code);
          next();
        });
      });
    },
  } satisfies Plugin;

  return plugin;
}

/** `ISO_VARIANT=a, b` → `['a', 'b']`; unset or blank → `[]`. */
function parseVariantList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Whether the request declares a JSON body (`application/json`, with or
 *  without a charset parameter). */
function isJsonRequest(req: IncomingMessage): boolean {
  const type = req.headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().includes('application/json');
}

/** Buffer a request body and parse it as JSON when asked; a malformed body
 *  becomes `undefined` so the store answers 400 instead of the server
 *  throwing. */
function readJsonBody(req: IncomingMessage, parse: boolean): Promise<unknown> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (!parse) {
        done(undefined);
        return;
      }
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        done(undefined);
      }
    });
  });
}

/**
 * Write a store response, or a 500 when the store throws. A store that
 * cannot write (permissions, a read-only mount) must still answer, or the
 * panel's request hangs and the reviewer sees nothing; a 500 sends a note
 * to the localStorage fallback. Returns the response so the caller can act
 * on a success, `null` on a throw.
 */
function answer(
  res: ServerResponse,
  respond: () => { status: number; headers: Record<string, string>; body: unknown },
): { status: number; body: unknown } | null {
  try {
    const { status, headers, body } = respond();
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
    return { status, body };
  } catch (cause) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: String(cause) }));
    return null;
  }
}

/** Source for the virtual mount module: a static import Vite resolves. */
/**
 * Source for the virtual mount module.
 *
 * The panel is imported only once the page has fired `load`, never
 * statically. The host's own entry loads `react-dom` through the same
 * optimized dep URL this module would, and `react-dom` registers with the
 * Fast Refresh hook at evaluation time. React Router's entry is an async
 * module script; when this smaller graph evaluated first, `react-dom` ran
 * before the refresh runtime had installed its hook, the renderer never
 * registered, and every hot update on the page, a hand edit or a variant
 * switch, re-evaluated modules without React re-rendering anything. After
 * `load` every host script has run, so the host decides the order and the
 * panel merely appears a moment later.
 */
function mountModuleSource(rule: RouteGateOptions, key: string, variants: boolean): string {
  return `
    const start = () => import('iso-iterate/react').then(({ mountIteration }) => {
      const prev = window.__isoIteration?.off;
      if (typeof prev === 'function') prev();
      window.__isoIteration = {
        off: mountIteration({
          endpoint: ${JSON.stringify(NOTES_ENDPOINT)},
          key: ${JSON.stringify(key)},
          rule: ${JSON.stringify(rule)},${variants ? "\n          variants: 'overlay'," : ''}
        }),
      };
    });
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  `;
}

function injectHtmlResponse(res: ServerResponse, code: string): void {
  if (INJECTED.has(res)) return;
  INJECTED.add(res);

  // Buffer the whole document and send it once from `end`. Passing chunks
  // through as they arrive would mean re-sending the document to inject, and
  // a streamed SSR body (React Router, Next) is chunked anyway, so nothing is
  // lost by waiting for `</body>`. Only navigations reach here (see the
  // `accept` check above), so this never buffers an SSE or module response.
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const originalSetHeader = res.setHeader.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  const chunks: Buffer[] = [];
  let buffering = true;

  // Web-stream adapters hand `res.write` a Uint8Array, which is neither a
  // string nor a Buffer; `chunk.toString('utf8')` on one yields a
  // comma-separated byte list, so wrap it instead of stringifying it.
  const toBuffer = (chunk: unknown): Buffer | null => {
    if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    return null;
  };

  // The injected script changes the bytes, so an upstream `Content-Length`
  // (Vite's `send`, a framework's own header) would truncate the document at
  // the original size, and an upstream `ETag` would describe a document the
  // browser never receives. Drop both; the response goes chunked and the
  // browser revalidates every time, which a dev page should anyway.
  const STRIPPED = new Set(['content-length', 'etag', 'last-modified']);
  const isLength = (name: string) => STRIPPED.has(name.toLowerCase());
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    isLength(name) ? res : originalSetHeader(name, value)) as ServerResponse['setHeader'];
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    const headers = rest[rest.length - 1];
    if (Array.isArray(headers)) {
      rest[rest.length - 1] = headers.filter((entry, i, all) => {
        // Either [[k, v], ...] or a flat [k, v, k, v, ...] list.
        if (Array.isArray(entry)) return !isLength(String(entry[0]));
        const key = i % 2 === 0 ? entry : all[i - 1];
        return !isLength(String(key));
      });
    } else if (headers && typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (isLength(key)) delete (headers as Record<string, unknown>)[key];
      }
    }
    return originalWriteHead(status, ...(rest as []));
  }) as unknown as ServerResponse['writeHead'];

  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (!buffering) return originalWrite(chunk as string, ...(rest as []));
    const buf = toBuffer(chunk);
    if (buf) chunks.push(buf);
    const cb = rest.find((r): r is () => void => typeof r === 'function');
    if (cb) queueMicrotask(cb);
    return true;
  }) as unknown as ServerResponse['write'];

  res.end = ((...args: unknown[]) => {
    const buf = toBuffer(args[0]);
    if (buf) chunks.push(buf);
    const cb = args.find((a): a is () => void => typeof a === 'function');
    buffering = false;
    const body = Buffer.concat(chunks).toString('utf8');
    if (body.includes('<html') && body.includes('</body>')) {
      const script = `<script type="module" data-iso-iterate-inject>${code}</script>`;
      if (!res.headersSent) originalSetHeader('Cache-Control', 'no-store');
      return originalEnd(
        withNativeFetch(body).replace('</body>', `${script}</body>`),
        cb,
      );
    }
    return originalEnd(Buffer.concat(chunks), cb);
  }) as unknown as ServerResponse['end'];
}

/**
 * A one-line script as early in the document as possible that keeps a
 * reference to the browser's own `fetch`. Apps replace `window.fetch` for
 * their own reasons — a preview app answering its backend calls, a mock
 * layer, an auth shim — and a stub that answers 404 to anything it does not
 * know would swallow the panel's saves; the store then falls back to
 * localStorage and the reviewer's notes look lost. The store prefers this
 * reference when it exists. Placed right after `<head>` (or `<body>` when
 * there is no head) so it runs before any app module.
 */
export function withNativeFetch(html: string): string {
  if (html.includes('__isoIterateFetch')) return html;
  const capture =
    '<script data-iso-iterate-native>window.__isoIterateFetch=window.fetch.bind(window)</script>';
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${capture}${html.slice(at)}`;
  }
  const body = html.match(/<body[^>]*>/i);
  if (body?.index !== undefined) {
    const at = body.index + body[0].length;
    return `${html.slice(0, at)}${capture}${html.slice(at)}`;
  }
  return html;
}

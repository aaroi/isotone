/**
 * Getting the panel into the page: the mount module, and the response hook
 * that adds it (and the live variant store) to every HTML navigation.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RouteGateOptions } from '../core/routes';
import type { IsotoneShortcut, IsotoneTheme } from '../core/types';
import { readBundle } from '../node/bundle';
import { isFromThisMachine, nodeRequestFacts } from '../node/http';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { UPDATE_ENDPOINT } from '../node/update/check';

const BUNDLE_PATH = '/@isotone/panel.js';
const INJECTED = new WeakSet<ServerResponse>();

/** Load after the host has mounted, without importing its React or HMR runtime. */
export function mountModuleSource(
  rule: RouteGateOptions,
  key: string,
  variants: boolean,
  shortcut?: IsotoneShortcut | false,
  theme?: IsotoneTheme,
  compareShortcut?: IsotoneShortcut | false,
): string {
  const config = JSON.stringify({
    endpoint: NOTES_ENDPOINT,
    updateEndpoint: UPDATE_ENDPOINT,
    key,
    shortcut,
    compareShortcut,
    theme,
    rule,
    ...(variants ? { variants: 'overlay' } : {}),
  }).replace(/</g, '\\u003c');
  return `
    const start = () => {
      const mount = () => window.__isotone.mount(${config});
      if (window.__isotone) return mount();
      const script = document.createElement('script');
      script.src = ${JSON.stringify(BUNDLE_PATH)};
      script.onload = mount;
      document.head.appendChild(script);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  `;
}

type Use = {
  (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown;
  (path: string, handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown;
};

/** Only this machine gets the panel; another device gets the app alone. */
const local = (req: IncomingMessage): boolean => isFromThisMachine(nodeRequestFacts(req));

/**
 * Serve the panel to the dev server's pages: the bundle, and the scripts
 * added to every HTML navigation. `mount` is the mount module, or null when
 * the host mounts the panel itself; `head` is the live variant store, when
 * there is one. A device on the network gets the store, which the app's
 * modules need, but never the panel.
 */
export function servePanel(use: Use, mount: string | null, head: (() => string) | null): void {
  if (mount === null && head === null) return;
  if (mount !== null) {
    // A self-contained bundle keeps the panel out of the host's dependency
    // graph and works in React, Vue, Svelte and plain Vite apps alike. Only
    // the page itself loads it: another site's <script> is cross-site.
    use(BUNDLE_PATH, (req, res) => {
      const site = req.headers['sec-fetch-site'];
      const allowed = local(req) && (site === undefined || site === 'same-origin' || site === 'none');
      res.statusCode = allowed ? 200 : 403;
      res.setHeader('content-type', allowed ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(allowed ? readBundle() : 'isotone loads only into this dev server’s own pages');
    });
  }
  use((req, res, next) => {
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
    injectHtmlResponse(res, local(req) ? mount : null, head ?? undefined);
    next();
  });
}

function injectHtmlResponse(res: ServerResponse, code: string | null, head: () => string | null = () => null): void {
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
    if (body.includes('<html') && (HEAD_OPEN.test(body) || body.includes('</body>'))) {
      const script = code === null ? '' : `<script type="module" data-isotone-inject>${code}</script>`;
      // Classic, not a module: it runs during parsing, before any module.
      const store = head();
      const early = store ? `<script data-isotone-live>${store.replace(/<\/script/gi, '<\\/script')}</script>` : '';
      if (!res.headersSent) originalSetHeader('Cache-Control', 'no-store');
      return originalEnd(withNativeFetch(injectIntoHead(body, `${early}${script}`)), cb);
    }
    return originalEnd(Buffer.concat(chunks), cb);
  }) as unknown as ServerResponse['end'];
}

/**
 * Put the mount loader script in `<head>`, after the opening head tag. React
 * never hydrates head contents it receives as part of a server document —
 * `<head>` is a special host that React replaces wholesale, unlike `<body>`,
 * and any stray script inside it is inert for React — so this cannot trip the
 * "script tag while rendering React component" warning or the hydration
 * discard that follows it in a whole-document React Router app. Falls back to
 * just before `</head>`, then just before `</body>` for a fragment without a
 * head, then appends, matching what `withNativeFetch` does below.
 */
/** The opening head tag, and not `<header>`. */
const HEAD_OPEN = /<head(?=[\s/>])[^>]*>/i;

function injectIntoHead(html: string, script: string): string {
  const head = html.match(HEAD_OPEN);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${script}${html.slice(at)}`;
  }
  const headEnd = html.match(/<\/head>/i);
  if (headEnd?.index !== undefined) {
    return `${html.slice(0, headEnd.index)}${script}${html.slice(headEnd.index)}`;
  }
  const body = html.match(/<body[^>]*>/i);
  if (body?.index !== undefined) {
    const at = body.index + body[0].length;
    return `${html.slice(0, at)}${script}${html.slice(at)}`;
  }
  return `${html}${script}`;
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
  if (html.includes('__isotoneFetch')) return html;
  const capture = '<script data-isotone-native>window.__isotoneFetch=window.fetch.bind(window)</script>';
  const head = html.match(HEAD_OPEN);
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

/**
 * Getting the panel into the page: the mount module, and the response hook
 * that adds it (and the live variant store) to every HTML navigation.
 */
import type { ServerResponse } from 'node:http';

import type { RouteGateOptions } from '../core/routes';
import type { IterationShortcut, IterationTheme } from '../core/types';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { UPDATE_ENDPOINT } from '../node/update/check';

export const BUNDLE_PATH = '/@isotone/panel.js';
const INJECTED = new WeakSet<ServerResponse>();

/** Load after the host has mounted, without importing its React or HMR runtime. */
export function mountModuleSource(
  rule: RouteGateOptions,
  key: string,
  variants: boolean,
  shortcut?: IterationShortcut | false,
  theme?: IterationTheme,
): string {
  const config = JSON.stringify({
    endpoint: NOTES_ENDPOINT,
    updateEndpoint: UPDATE_ENDPOINT,
    key,
    shortcut,
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

export function injectHtmlResponse(res: ServerResponse, code: string | null, head: () => string | null = () => null): void {
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
    if (body.includes('<html') && (body.includes('<head') || body.includes('</body>'))) {
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
function injectIntoHead(html: string, script: string): string {
  const head = html.match(/<head[^>]*>/i);
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

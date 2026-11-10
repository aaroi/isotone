/**
 * isotone — the standalone dev server.
 *
 * The plug-and-play path. Run it in the repo you are reviewing and it owns the
 * notes file, serves the endpoint, and hands out the panel as a single script
 * so the host app needs no build integration at all:
 *
 *   npx isotone serve
 *   # then, in dev only, one line in the host's HTML:
 *   <script src="http://127.0.0.1:4123/isotone.js" defer></script>
 *
 * Running it inside the repo is what keeps a note unambiguous: the process that
 * owns the file is the checkout the agent is working in, so a route and a
 * selector always point somewhere. Nothing about which port served the page has
 * to be mapped back to a repo.
 *
 * The Vite plugin remains the two-line convenience for a Vite host; this is for
 * every other runtime, and for a page whose dev server you cannot configure at
 * all (paste the bookmarklet the index page prints).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';

import type { RouteGateOptions } from '../core/routes';
import type { IsotoneTheme } from '../core/types';
import { checkRequest, isLoopback, nodeRequestFacts, readNodeJson, sendFailure, writeResponse } from '../node/http';
import { ensureFileIgnored } from '../node/fs/git-exclude';
import { notesResponse, NOTES_ENDPOINT } from '../node/notes/handler';
import { SERVER_ENDPOINT, serverOwner, urlHost } from '../node/serve-owner';
import type { ExperimentFlags } from '../core/experiments';
import { VARIANTS_ENDPOINT } from '../core/variants';
import { readKnobs } from '../node/variants';

import { readBundle } from '../node/bundle';
import { serveMountOptions } from './mount-config';
import { DEFAULT_PORT, guardedScriptTag } from '../core/tag';
import { startUpdateCheck, UPDATE_ENDPOINT } from '../node/update/check';
import { autoUpdateNote, updateResponse } from '../node/update/note';

const BUNDLE_PATH = '/isotone.js';

export interface ServeIsotoneOptions {
  /** Background npm notice, at most once a day. false disables the check;
   *  'note' also files an update note for your agent once per new version. */
  checkForUpdates?: boolean | 'note';
  /** Project directory for the suggested update command and for
   *  `.isotone/knobs.json`. Defaults to the notes directory. */
  projectRoot?: string;
  /** Defaults to auto (page background); system follows the OS preference. */
  theme?: IsotoneTheme;
  /** Where notes persist. Git-ignored automatically via `.git/info/exclude`. */
  file: string;
  /** Defaults to 4123. */
  port?: number;
  /** Defaults to 127.0.0.1 — a dev loop has no business on 0.0.0.0. */
  host?: string;
  /** Route visibility rule handed to the panel. */
  rule?: RouteGateOptions;
  /** localStorage namespace for the panel. */
  key?: string;
  /** Experiments to turn on; `.isotone/experiments.json` in the project wins over this. */
  experimental?: ExperimentFlags;
}

export interface ServedIsotone {
  port: number;
  url: string;
  bundleUrl: string;
  close(): Promise<void>;
}

/**
 * Only localhost may talk to this server.
 *
 * The endpoint writes a file, and a wide-open `*` would let any page you happen
 * to visit post notes into the repo you are reviewing. Restricting the allowed
 * origin to loopback keeps a drive-by from a public site out while leaving
 * every real dev origin (any localhost port, http or https) working.
 */
function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const { hostname, protocol } = new URL(origin);
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
    return loopback && (protocol === 'http:' || protocol === 'https:') ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Whether a page on another site is loading the bundle: a `<script>` tag
 * sends no Origin, so the browser's `Sec-Fetch-Site` says where it came
 * from, and a cross-site load must name a loopback page in its Origin or
 * Referer (another localhost port is a different site to the browser).
 */
function isForeignLoad(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] !== 'cross-site') return false;
  const page = req.headers.origin ?? req.headers.referer;
  return allowedOrigin(typeof page === 'string' ? page : undefined) === null;
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = allowedOrigin(req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

/** The bundle plus the mount call, with the config the server itself knows. */
function bundleWithMount(origin: string, opts: ServeIsotoneOptions, projectRoot: string): string {
  const config = JSON.stringify(serveMountOptions(origin, projectRoot, opts));
  return `${readBundle()}\n;window.__isotone&&window.__isotone.mount(${config});\n`;
}

function bookmarklet(origin: string): string {
  return `javascript:(function(){var s=document.createElement('script');s.src=${JSON.stringify(
    `${origin}${BUNDLE_PATH}`,
  )};s.defer=true;document.body.appendChild(s);})()`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function indexPage(origin: string, file: string): string {
  const tag = guardedScriptTag(`${origin}${BUNDLE_PATH}`);
  const mark = bookmarklet(origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Isotone</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; }
  :root {
    --bg: #0d0d10; --card: #131317; --line: rgba(255,255,255,.09);
    --fg: #ececf1; --muted: #8f8f9a; --faint: #5f5f6a;
    --sans: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
  }
  body { background: var(--bg); color: var(--fg); font: 14px/1.6 var(--sans);
         -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 540px; margin: 0 auto; padding: 12vh 24px 8vh; }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 9999px; background: #4ade80;
         box-shadow: 0 0 10px rgba(74,222,128,.5); }
  h1 { font-family: var(--mono); font-size: 14px; font-weight: 500; letter-spacing: .02em; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 40px; }
  .sub code, p.note code { font-family: var(--mono); font-size: 11.5px; color: var(--fg); }
  h2 { font-family: var(--mono); font-size: 10.5px; font-weight: 500;
       letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
       margin: 32px 0 10px; }
  .card { background: var(--card); border: 1px solid var(--line);
          border-radius: 12px; padding: 13px 16px; }
  .card.row { display: flex; align-items: center; gap: 14px; }
  .card pre { font-family: var(--mono); font-size: 12px; line-height: 1.7;
              color: var(--fg); overflow-x: auto; white-space: pre;
              scrollbar-width: none; min-width: 0; }
  .card.row pre { flex: 1; }
  .card pre::-webkit-scrollbar { display: none; }
  .card pre .c { color: var(--faint); }
  .copy { flex: none; font-family: var(--mono); font-size: 10px;
          color: var(--faint); background: none; padding: 4px 9px;
          border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
  .copy:hover { color: var(--fg); border-color: rgba(255,255,255,.2); }
  p.note { color: var(--muted); font-size: 12.5px; margin-top: 10px; }
  a.bm { display: inline-flex; align-items: center; gap: 8px; margin-top: 2px;
         padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px;
         background: var(--card); color: var(--fg); text-decoration: none;
         font-family: var(--mono); font-size: 12px; }
  a.bm:hover { border-color: rgba(255,255,255,.2); }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line);
           font-family: var(--mono); font-size: 10.5px; color: var(--faint);
           line-height: 2; overflow-wrap: anywhere; }
</style>
</head>
<body>
<div class="wrap">
  <header><span class="dot"></span><h1>Isotone</h1></header>
  <p class="sub">Serving the feedback loop on <code>${escapeHtml(origin)}</code>.</p>

  <h2>Script for your dev pages</h2>
  <div class="card row">
    <pre>${escapeHtml(tag)}</pre>
    <button type="button" class="copy" data-c="${escapeHtml(tag)}"
      onclick="navigator.clipboard.writeText(this.dataset.c);this.textContent='copied';setTimeout(()=>this.textContent='copy',1200)">copy</button>
  </div>
  <p class="note">It loads the panel only on localhost, so it stays inert if the page ships.
  Behind a development flag, a plain <code>&lt;script src="${escapeHtml(origin + BUNDLE_PATH)}" defer&gt;</code> works too.</p>

  <h2>Bookmarklet — drag to your bookmarks bar</h2>
  <a class="bm" href="${escapeHtml(mark)}">✎ Isotone</a>

  <footer>
    notes → ${escapeHtml(file)}<br>
    loopback origins only
  </footer>
</div>
</body>
</html>
`;
}

/** Start the server. Resolves once it is listening. */
export function serveIsotone(opts: ServeIsotoneOptions): Promise<ServedIsotone> {
  const file = resolve(opts.file);
  const projectRoot = resolve(opts.projectRoot ?? dirname(file));
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? '127.0.0.1';
  if (!isLoopback(host)) throw new Error('isotone serve binds only to localhost, 127.0.0.1 or ::1.');
  ensureFileIgnored(file);
  const updates = startUpdateCheck(projectRoot, opts.checkForUpdates !== false);
  if (opts.checkForUpdates === 'note') void updates.ready.then(() => autoUpdateNote(file, updates.getSnapshot())).catch(() => {});

  // The port we were ASKED for is not necessarily the one we got: 0 means "any
  // free port". The panel's endpoint has to be the bound one or the bundle
  // ships a URL that answers nothing.
  let boundPort = port;

  const server: Server = createServer((req, res) => {
    cors(req, res);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';
    const origin = `http://${urlHost(host)}:${boundPort}`;
    try {
      checkRequest({ ...nodeRequestFacts(req), loopbackOrigins: true });
    } catch (error) {
      sendFailure(res, error);
      return;
    }

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (path === UPDATE_ENDPOINT) {
      // POST asks for the update note, built from this server's own check.
      (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
        .then((body) => {
          writeResponse(res, () => updateResponse(file, updates.getSnapshot(), { method, body }));
        })
        .catch((error) => sendFailure(res, error));
      return;
    }

    // Whose server this is, so another checkout's `serve` and notes CLI can
    // tell a port held by this checkout from one held by theirs.
    if (path === SERVER_ENDPOINT && method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(serverOwner(projectRoot, file)));
      return;
    }

    if (path === BUNDLE_PATH && method === 'GET') {
      if (isForeignLoad(req)) {
        res.statusCode = 403;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('isotone loads only into pages on this machine');
        return;
      }
      let body: string;
      try {
        body = bundleWithMount(origin, opts, projectRoot);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(String(err instanceof Error ? err.message : err));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(body);
      return;
    }

    if (path === VARIANTS_ENDPOINT || path.startsWith(`${VARIANTS_ENDPOINT}/`)) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (path === VARIANTS_ENDPOINT && method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify({ variants: [], active: [], knobs: readKnobs({ root: projectRoot }) }));
      } else {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'isotone serve has knobs only; file variants need the Vite plugin' }));
      }
      return;
    }

    if (path === NOTES_ENDPOINT) {
      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
        res.statusCode = 405;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
        .then((body) => {
          writeResponse(res, () => notesResponse(file, { method, url: req.url, body }));
        })
        .catch((error) => sendFailure(res, error));
      return;
    }

    if (path === '/' && method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(indexPage(origin, file));
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
  });

  server.once('close', updates.dispose);
  return new Promise((ok, fail) => {
    server.once('error', (error) => {
      updates.dispose();
      fail(error);
    });
    server.listen(port, host, () => {
      const actual = server.address();
      boundPort = typeof actual === 'object' && actual ? actual.port : port;
      const url = `http://${urlHost(host)}:${boundPort}`;
      ok({
        port: boundPort,
        url,
        bundleUrl: `${url}${BUNDLE_PATH}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

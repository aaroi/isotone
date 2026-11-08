/**
 * isotone/server — the notes and variants endpoints for any Request runtime.
 *
 * `serveNotesRequest` and `serveVariantsRequest` take a `Request` (a Next
 * route handler, Bun.serve, a Vercel function) and apply the endpoint rules;
 * `notesResponse` and `variantsResponse` are the unguarded handlers under
 * them, and `readNotes` reads the notes file from a script. No React and no
 * Vite here. tests/package/exports.test.ts lists every name.
 */
import { checkRequest, type HandlerResponse, httpFailure, readWebJson } from '../node/http';
import { notesResponse } from '../node/notes/handler';
import { type VariantsStoreOptions, variantsResponse } from '../node/variants';
import { VARIANTS_ENDPOINT } from '../core/variants';

export { notesResponse, type NotesRequest, type NotesResponse } from '../node/notes/handler';
export { readNotes, type StoredNote } from '../node/notes/store';
export { variantsResponse, type VariantsStoreOptions } from '../node/variants';

export interface ServeRequestOptions {
  /**
   * Accept requests from any loopback page (localhost, 127.0.0.1, [::1]) on
   * any port. Needed when the app's dev server and this API listen on
   * different ports, since the page's origin then never matches the API host.
   * Off by default: only the API's own origin is accepted.
   */
  loopbackOrigins?: boolean;
  /**
   * Answer even when `NODE_ENV` is `production`. Off by default: the handler
   * reads and writes a file in the project, which a deployed app has no
   * business exposing, so a production runtime gets a 404 instead. Set it only
   * for a deliberate, access-controlled review deployment.
   */
  allowProduction?: boolean;
  /**
   * The client's address, where the runtime exposes it (Bun's
   * `server.requestIP(request)`, a Node socket's `remoteAddress`). With it,
   * other machines are refused whatever `Host` they send.
   */
  remoteAddress?: string;
  /**
   * Let other devices on the network in, such as a phone you review on. Off
   * by default: only this machine's names and addresses are accepted. Anyone
   * on that network can then read and write your notes.
   */
  allowNetwork?: boolean;
}

/** The gate for a `Request`, with what the adapter was told about its sender. */
function checkWebRequest(request: Request, url: URL, options: ServeRequestOptions): void {
  checkRequest({
    origin: request.headers.get('origin'),
    host: url.host,
    forwardedFor: request.headers.get('x-forwarded-for'),
    forwarded: request.headers.get('forwarded'),
    ...(options.remoteAddress !== undefined ? { remoteAddress: options.remoteAddress } : {}),
    loopbackOrigins: options.loopbackOrigins,
    network: options.allowNetwork,
  });
}

/** The answer a production runtime gets unless the host opted in. */
function refusedInProduction(options: ServeRequestOptions): HandlerResponse | null {
  if (options.allowProduction || !isProductionRuntime()) return null;
  return {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: { error: 'isotone is development-only; this endpoint is off because NODE_ENV is production' },
  };
}

/**
 * Whether this process runs as a production build. Only an explicit
 * `NODE_ENV=production` counts: test runners and hand-started dev servers
 * often leave it unset, and every common production runtime (`next start`,
 * Vercel, Netlify, most container images) sets it.
 */
function isProductionRuntime(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

/**
 * A convenience Next-compatible adapter: given a `Request`/`NextRequest` and the
 * `file`, return a `NextResponse`-shaped `{ status, headers, body }`. Frameworks
 * that expose a `(req, res)` pair call `notesResponse` and render it directly.
 */
export async function serveNotesRequest(file: string, request: Request, options: ServeRequestOptions = {}): Promise<HandlerResponse> {
  const refused = refusedInProduction(options);
  if (refused) return refused;
  try {
    const url = new URL(request.url);
    checkWebRequest(request, url, options);
    const body = request.method === 'POST' ? await readWebJson(request) : undefined;
    return notesResponse(file, {
      method: request.method,
      url: `${url.pathname}?${url.searchParams.toString()}`,
      body,
    });
  } catch (error) {
    return httpFailure(error);
  }
}

/**
 * Like {@link serveNotesRequest}, for the variants endpoint: given a
 * `Request` whose path ends with `VARIANTS_ENDPOINT` (or a sub-path of it,
 * such as `.../active`), strip the mount prefix before handing the rest to
 * `variantsResponse`, which routes on the path relative to the mount.
 */
export async function serveVariantsRequest(
  opts: VariantsStoreOptions,
  request: Request,
  options: ServeRequestOptions = {},
): Promise<HandlerResponse> {
  const refused = refusedInProduction(options);
  if (refused) return refused;
  try {
    const url = new URL(request.url);
    checkWebRequest(request, url, options);
    const body = request.method === 'POST' ? await readWebJson(request) : undefined;
    const mounted = url.pathname.startsWith(VARIANTS_ENDPOINT) ? url.pathname.slice(VARIANTS_ENDPOINT.length) : url.pathname;
    return variantsResponse(opts, {
      method: request.method,
      url: `${mounted || '/'}?${url.searchParams.toString()}`,
      body,
    });
  } catch (error) {
    return httpFailure(error);
  }
}

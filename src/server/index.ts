/**
 * iso-iterate — server.
 *
 * The transport-agnostic side of the loop: the file store and a pure request
 * handler that any dev runtime (Vite middleware, Next route handler, Bun.serve,
 * Vercel function, plain `node:http`) can render. No React and no Vite here —
 * keep this subpath framework-free.
 */

export {
  ensureFileIgnored,
  notesResponse,
  readNotes,
  writeNotes,
  NOTES_ENDPOINT,
  PAYLOAD_MAX,
} from '../store';
import { notesResponse } from '../store';
export type {
  NotesRequest,
  NotesResponse,
  StoredNote,
} from '../store';

export {
  ACTIVE_FILE,
  DEFAULT_VARIANTS_DIR,
  listVariants,
  readActive,
  variantsResponse,
  writeActive,
} from '../variants-store';
import { variantsResponse } from '../variants-store';
import type { VariantsStoreOptions } from '../variants-store';
export type { VariantsStoreOptions } from '../variants-store';
export { VARIANTS_ENDPOINT } from '../core/variants';
import { VARIANTS_ENDPOINT } from '../core/variants';

/**
 * A convenience Next-compatible adapter: given a `Request`/`NextRequest` and the
 * `file`, return a `NextResponse`-shaped `{ status, headers, body }`. Frameworks
 * that expose a `(req, res)` pair call `notesResponse` and render it directly.
 */
export async function serveNotesRequest(
  file: string,
  request: Request,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  let body: unknown;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }
  const url = new URL(request.url);
  return notesResponse(file, {
    method: request.method,
    url: `${url.pathname}?${url.searchParams.toString()}`,
    body,
  });
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
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  let body: unknown;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }
  const url = new URL(request.url);
  const mounted = url.pathname.startsWith(VARIANTS_ENDPOINT)
    ? url.pathname.slice(VARIANTS_ENDPOINT.length)
    : url.pathname;
  return variantsResponse(opts, {
    method: request.method,
    url: `${mounted || '/'}?${url.searchParams.toString()}`,
    body,
  });
}

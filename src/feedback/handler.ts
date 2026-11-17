import { type FeedbackBrowser, type FeedbackEntry, MAX_AUTHOR, MAX_FEEDBACK_BODY, MAX_RELEASE } from '../core/feedback';
import { NOTE_ID } from '../core/id';
import { MAX_FEEDBACK_LENGTH, MAX_ROUTE, PAYLOAD_MAX } from '../core/limits';
import type { IsotoneElement } from '../core/types';
import { elementOf, selectionsOf, variantOf, viewportOf, withinPayloadCap } from '../core/validate';

/** Where records are kept. `postgres(url)` and `postgresStore(client)` are stores; so is any object like this. */
export interface FeedbackStore {
  /**
   * Stores a record. One whose `id` is already stored replaces it when the
   * stored `keyHash` equals this one (the writer edited their note, or the
   * panel sent it again), and must change nothing otherwise: answer `false`
   * then, and the route refuses the request. A throw or rejection answers 500
   * and the panel retries later.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: a store that answers nothing, like an `async` function with no return, accepted the record.
  save(entry: FeedbackEntry, request: Request): void | boolean | Promise<void | boolean>;
  /**
   * Removes the record with this `id` and `keyHash`, when the writer deletes
   * their note. A record that is not there, or has another key, is left alone
   * without an error. A store without it refuses deletes.
   */
  remove?(id: string, keyHash: string, request: Request): void | Promise<void>;
}

export interface FeedbackOptions {
  /** Where records go: `postgres(url)` from `isotone/postgres`,
   *  `postgresStore(client)`, or an object of your own. */
  store: FeedbackStore;
  /**
   * Who sent the request, from the app's own session. The answer is saved as
   * the record's `identity`, beside the name the reviewer typed. Answer
   * `null` or nothing for a visitor the app does not know.
   */
  identify?: (request: Request) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * The origins whose pages may post, such as `['https://staging.example.com']`.
   * By default a page must be on the host the request names (its `Host`, or
   * the `X-Forwarded-Host` a proxy sets). Name the origins when the app's
   * pages are on another host than this route (the route then answers their
   * CORS preflight; export it for `OPTIONS` too), or where those headers
   * cannot be trusted: no proxy overwrites what a client sends, or the site
   * is reachable only inside a network.
   */
  origins?: readonly string[];
}

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

/**
 * The handler for the host's feedback route: `export const POST = feedback({ store })`.
 *
 * It answers POST only (and the preflight of the `origins` it is given), and only writes: a note is stored, replaced or
 * removed, never read back. Replacing or removing one takes the secret its
 * writer's browser holds. A page on another origin is refused, and so is a
 * body that is not JSON, which a cross-site form cannot send. Every field is
 * bounded before the store sees it. Who may reach the route at all is the
 * host's to decide, in the code around this handler.
 */
export function feedback(options: FeedbackOptions): (request: Request) => Promise<Response> {
  const store = options?.store;
  if (typeof store?.save !== 'function') throw new TypeError('feedback() needs a store with a save function');
  const answer = async (request: Request): Promise<Response> => {
    let entry: FeedbackEntry | null;
    let id: string;
    let keyHash: string;
    try {
      if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { allow: 'POST' });
      checkOrigin(request, options.origins);
      // Made storable before anything is checked, so a name of nothing but NUL is no name.
      const body = wellFormed(await readJson(request));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refused(400, 'a JSON object is required');
      const b = body as Record<string, unknown>;
      if (typeof b.id !== 'string' || !NOTE_ID.test(b.id)) {
        throw new Refused(400, 'id must be 1-64 letters, digits, - or _, not starting with -');
      }
      if (typeof b.key !== 'string' || !NOTE_KEY.test(b.key)) throw new Refused(400, 'key must be 16-128 letters, digits, - or _');
      id = b.id;
      keyHash = await sha256(b.key);
      entry = b.remove === true ? null : entryOf(b, id, keyHash, request);
    } catch (error) {
      if (error instanceof Refused) return json(error.status, { error: error.message });
      // Whatever else a hostile body trips over is the body's fault, not the server's.
      return json(400, { error: 'the feedback could not be read' });
    }
    try {
      if (!entry) {
        // A refusal of this request for good, so the panel says so instead of asking again.
        if (typeof store.remove !== 'function') return json(400, { error: 'this feedback store does not remove notes' });
        await store.remove(id, keyHash, request);
        // The same answer whether or not a row went: a wrong key learns nothing.
        return json(200, { id });
      }
      const identity = await options.identify?.(request);
      if (typeof identity === 'string' && identity.trim()) entry.identity = wellFormed(identity.trim().slice(0, 300));
      if ((await store.save(entry, request)) === false) return json(409, { error: 'this note was written with another key' });
    } catch (error) {
      // The host's logs are the only place this can be seen; the browser gets no detail.
      console.error(`[isotone] Could not ${entry ? 'save' : 'remove'} feedback:`, error);
      return json(500, { error: `Could not ${entry ? 'save' : 'remove'} feedback.` });
    }
    return json(201, { id });
  };
  if (!options.origins) return answer;
  // Named origins may be other sites than the route's own (an app at one host, its API at
  // another), so their pages are told they may post: the preflight is answered and every
  // answer names the origin. No credentials cross: `identify` sees no cookie from them.
  return async (request) => {
    const origin = request.headers.get('origin');
    const named = origin !== null && isAllowed(origin, options.origins ?? []);
    const cors: Record<string, string> = named ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    if (request.method === 'OPTIONS' && named) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        },
      });
    }
    const response = await answer(request);
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  };
}

/** Whether a page's origin is one of the named ones; capitals or a trailing slash in the list do not matter. */
function isAllowed(origin: string, allowed: readonly string[]): boolean {
  try {
    const page = new URL(origin);
    if (page.protocol !== 'http:' && page.protocol !== 'https:') return false;
    return allowed.some((entry) => {
      try {
        return new URL(entry.trim()).origin === page.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** The secret a browser keeps per note: long enough not to be guessed. */
const NOTE_KEY = /^[A-Za-z0-9_-]{16,128}$/;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A browser names the page's origin on every POST. With `origins` it must be
 * one of them; without, it must be this host, which behind a proxy is the
 * forwarded one. A request without an Origin is not from a page (curl, a
 * server), which no origin check can stop.
 */
function checkOrigin(request: Request, allowed: readonly string[] | undefined): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let host: string;
  try {
    if (allowed && isAllowed(origin, allowed)) return;
    const page = new URL(origin);
    host = allowed || (page.protocol !== 'http:' && page.protocol !== 'https:') ? '' : page.host;
  } catch {
    host = '';
  }
  if (!host) throw new Refused(403, 'origin not allowed');
  // A chain of proxies lists every host it forwarded for, the public one among them.
  const forwarded = (request.headers.get('x-forwarded-host') ?? '').split(',');
  const hosts = [new URL(request.url).host, request.headers.get('host'), ...forwarded];
  if (!hosts.some((name) => name?.trim().toLowerCase() === host)) throw new Refused(403, 'origin not allowed');
}

async function readJson(request: Request): Promise<unknown> {
  const media = (request.headers.get('content-type') ?? '').replace(/;.*$/s, '').trim().toLowerCase();
  if (media !== 'application/json') throw new Refused(415, 'content-type must be application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new Refused(400, 'a JSON body is required');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_FEEDBACK_BODY) {
      await reader.cancel().catch(() => {});
      throw new Refused(413, 'request body too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new Refused(400, 'the body is not valid JSON');
  }
}

/** The record in a request body: required fields checked, the rest bounded or dropped. */
function entryOf(b: Record<string, unknown>, id: string, keyHash: string, request: Request): FeedbackEntry {
  const author = typeof b.author === 'string' ? b.author.trim() : '';
  if (!author) throw new Refused(400, 'author is required');
  if (author.length > MAX_AUTHOR) throw new Refused(400, `author must be at most ${MAX_AUTHOR} characters`);
  const text = typeof b.feedback === 'string' ? b.feedback.trim() : '';
  if (!text) throw new Refused(400, 'feedback is required');
  if (text.length > MAX_FEEDBACK_LENGTH) throw new Refused(400, `feedback must be at most ${MAX_FEEDBACK_LENGTH} characters`);
  // A path on this site and nothing else: not `//other.site`, and no character a link or a log would trip on.
  if (typeof b.route !== 'string' || !/^\/(?!\/)[^\\\p{Cc}]*$/u.test(b.route))
    throw new Refused(400, 'route must be a path starting with /');
  if (b.route.length > MAX_ROUTE) throw new Refused(400, `route must be at most ${MAX_ROUTE} characters`);
  if (b.elements !== undefined && (!Array.isArray(b.elements) || b.elements.length > 50)) {
    throw new Refused(400, 'elements must be an array of at most 50 elements');
  }
  if (b.payload !== undefined && !withinPayloadCap(b.payload)) {
    throw new Refused(400, `payload exceeds ${PAYLOAD_MAX} bytes or is not serializable`);
  }
  // Written offline, a record keeps its time, but never one ahead of the server's clock or
  // older than a note could have waited in a browser.
  const sent = typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : Number.NaN;
  const now = Date.now();
  const written = Number.isFinite(sent) && sent <= now && sent >= now - MAX_WAIT_MS ? sent : now;
  const url = pageUrl(b.url);
  const variant = variantOf(b.variant);
  const selections = selectionsOf(b.selections);
  const viewport = viewportOf(b.viewport);
  const release = typeof b.release === 'string' ? b.release.trim().slice(0, MAX_RELEASE) : '';
  return {
    id,
    keyHash,
    createdAt: new Date(written).toISOString(),
    author,
    feedback: text,
    route: b.route,
    ...(url ? { url } : {}),
    elements: ((b.elements as unknown[] | undefined) ?? [])
      .map((element) => elementOf(element))
      .filter((el): el is IsotoneElement => el !== null),
    ...(variant ? { variant } : {}),
    ...(selections ? { selections } : {}),
    ...(viewport ? { viewport } : {}),
    browser: browserOf(b.browser, request.headers.get('user-agent')),
    ...(release ? { release } : {}),
    ...(b.payload !== undefined ? { payload: b.payload } : {}),
  };
}

/** The longest a note waits in a browser before it gives up, with a day's slack for clocks. */
const MAX_WAIT_MS = 8 * 24 * 60 * 60 * 1000;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NUL = String.fromCharCode(0);

/**
 * The same value with every string made storable: half of a cut emoji becomes
 * U+FFFD and NUL is dropped. Text is cut by length in the browser and here,
 * which can split a character, and a database refuses both.
 */
function wellFormed<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE, '\uFFFD').split(NUL).join('') as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [wellFormed(key), wellFormed(item)])) as T;
  }
  return value;
}

/** An http(s) address without its hash, or nothing. */
function pageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_ROUTE * 2) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    url.username = '';
    url.password = '';
    // Measured as stored: percent-encoding makes a short address long.
    return url.href.length > MAX_ROUTE * 2 ? undefined : url.href;
  } catch {
    return;
  }
}

function browserOf(value: unknown, userAgent: string | null): FeedbackBrowser {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const out: FeedbackBrowser = {};
  if (userAgent) out.userAgent = userAgent.slice(0, 500);
  if (typeof v.language === 'string' && v.language) out.language = v.language.slice(0, 35);
  if (typeof v.timezone === 'string' && v.timezone) out.timezone = v.timezone.slice(0, 64);
  const screen = viewportOf(v.screen);
  if (screen) out.screen = screen;
  if (typeof v.pixelRatio === 'number' && v.pixelRatio > 0 && v.pixelRatio <= 16) out.pixelRatio = Math.round(v.pixelRatio * 100) / 100;
  if (v.colorScheme === 'light' || v.colorScheme === 'dark') out.colorScheme = v.colorScheme;
  if (typeof v.touch === 'boolean') out.touch = v.touch;
  return out;
}

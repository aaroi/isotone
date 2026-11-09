/**
 * What went wrong on the page shortly before a note was written: uncaught
 * errors, unhandled promise rejections and failed requests. A reviewer writes
 * "this flashes an error sometimes"; the agent reading the note later has no
 * console. Only passive listeners: `console` is never wrapped, so the host's
 * own log lines keep their source locations. Failed requests come from the
 * browser's resource timings, which report a status in Chromium and recent
 * Firefox only; elsewhere, and for a request that never got an answer, only
 * failed images, scripts and stylesheets are seen.
 */
import type { NoteDiagnostics } from './types';

/** How far back a note looks. Older trouble belongs to something else. */
const WINDOW_MS = 5 * 60 * 1000;
/** Entries kept of each kind, the newest. */
const KEEP = 5;
const MAX_MESSAGE = 300;

interface Seen {
  at: number;
  count: number;
}
type ErrorEntry = Seen & { message: string; source?: string };
type RequestEntry = Seen & { url: string; status?: number };

/**
 * A URL as a note may carry it: no query or fragment, where tokens live, and
 * relative to the page's origin when it shares one.
 */
function plainUrl(raw: string, origin: string): string {
  try {
    const url = new URL(raw, origin);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return `${url.protocol}…`;
    // `webpack-internal:`, `file:` and the like have no origin to speak of.
    const from = url.origin === 'null' ? url.protocol : url.origin === origin ? '' : url.origin;
    return `${from}${url.pathname}`.slice(0, MAX_MESSAGE);
  } catch {
    return '';
  }
}

/** Add an entry, or count a repeat; either way it becomes the newest, and the oldest falls off. */
function remember<T extends Seen>(list: T[], entry: T, same: (a: T) => boolean): T {
  const at = list.findIndex(same);
  const known = at < 0 ? undefined : list.splice(at, 1)[0];
  const kept = known ? Object.assign(known, { count: known.count + 1, at: entry.at }) : entry;
  list.push(kept);
  if (list.length > KEEP) list.shift();
  return kept;
}

/**
 * A message as a note may carry it: on one line, cut, and with the query and
 * fragment taken off anything URL-shaped in it (up to the next space), since
 * that is where tokens ride. Not a scrubber: a secret a page puts in the words of its own error
 * stays there.
 */
function plainMessage(message: string): string {
  // Cut first: an error can embed a whole response body, and this runs inside the page's own error dispatch.
  return message
    .slice(0, MAX_MESSAGE * 4)
    .replace(/((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#]*)[?#]\S*/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** Browser noise that says nothing about the page: an opaque cross-origin error, a benign layout notice. */
const NOISE = /^(?:Script error\.?|ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.?))$/i;

export interface DiagnosticsRecorder {
  /** The recent trouble, or undefined when the page has been quiet. */
  recent(now?: number): NoteDiagnostics | undefined;
  stop(): void;
}

/**
 * Start listening on `view`. One recorder per panel; `stop` removes every
 * listener. `own` names the panel's own endpoints, whose answers are not the
 * page's trouble. A handler here runs inside the host's event dispatch, so
 * none may throw.
 */
export function recordDiagnostics(view: Window, own: readonly (string | undefined)[] = []): DiagnosticsRecorder {
  const errors: ErrorEntry[] = [];
  const requests: RequestEntry[] = [];
  const origin = view.location.origin;
  const ours = own.flatMap((endpoint) => (endpoint ? [plainUrl(endpoint, origin).replace(/\/$/, '')] : [])).filter(Boolean);

  const addError = (message: string, source?: string) => {
    const text = plainMessage(message);
    if (text && !NOISE.test(text))
      remember(errors, { message: text, source, at: Date.now(), count: 1 }, (e) => e.message === text && e.source === source);
  };
  const addRequest = (raw: string, status?: number) => {
    const url = plainUrl(raw, origin);
    // The panel's own polling is not the page's trouble.
    if (!url || url.includes('/api/isotone/') || ours.some((endpoint) => url === endpoint || url.startsWith(`${endpoint}/`))) return;
    // A failed image raises an error at itself and shows up as a 404 too: one entry, with the status.
    const known = requests.find((r) => r.url === url);
    if (known && Date.now() - known.at < 2000 && (known.status === undefined) !== (status === undefined)) {
      known.status ??= status;
      known.at = Date.now();
      return;
    }
    remember(requests, { url, status, at: Date.now(), count: 1 }, (r) => r.url === url && r.status === status);
  };

  const text = (value: unknown): string => {
    try {
      return String(value);
    } catch {
      return 'Error';
    }
  };
  const quietly = (handle: (event: Event) => void) => (event: Event) => {
    try {
      handle(event);
    } catch {
      // Never add an error of our own to the page's.
    }
  };
  const onError = quietly((event: Event) => {
    const error = event as ErrorEvent;
    // An element that failed to load (img, script, link) raises a plain event at itself.
    if (event.target && event.target !== view && !(typeof error.message === 'string' && error.message)) {
      const target = event.target as { src?: unknown; href?: unknown; closest?: (selector: string) => unknown };
      if (target.closest?.('[data-isotone]')) return;
      const url = typeof target.src === 'string' ? target.src : typeof target.href === 'string' ? target.href : '';
      if (url) addRequest(url);
      return;
    }
    const file = error.filename ? plainUrl(error.filename, origin) : '';
    addError(error.message || text(error.error ?? 'Error'), file ? `${file}:${error.lineno ?? 0}` : undefined);
  });
  const onRejection = quietly((event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason as { message?: unknown; name?: unknown } | undefined;
    const message = reason && typeof reason.message === 'string' ? `${text(reason.name ?? 'Error')}: ${reason.message}` : text(reason);
    addError(`Unhandled rejection: ${message}`);
  });
  // Capture, so element load errors, which do not bubble, are seen too.
  view.addEventListener('error', onError, true);
  view.addEventListener('unhandledrejection', onRejection);

  let observer: PerformanceObserver | undefined;
  try {
    const Observer = (view as unknown as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    if (Observer) {
      observer = new Observer((list) => {
        for (const entry of list.getEntries()) {
          const status = (entry as PerformanceResourceTiming).responseStatus;
          if (typeof status === 'number' && status >= 400) addRequest(entry.name, status);
        }
      });
      observer.observe({ type: 'resource', buffered: false });
    }
  } catch {
    observer = undefined;
  }

  return {
    recent(now = Date.now()) {
      const fresh = <T extends Seen>(list: T[]) => list.filter((entry) => now - entry.at <= WINDOW_MS);
      const stamp = <T extends Seen>({ at, count, ...rest }: T) => ({
        ...rest,
        at: new Date(at).toISOString(),
        ...(count > 1 ? { count } : {}),
      });
      const recentErrors = fresh(errors).map(stamp);
      const recentRequests = fresh(requests).map(stamp);
      if (!recentErrors.length && !recentRequests.length) return undefined;
      return {
        ...(recentErrors.length ? { errors: recentErrors } : {}),
        ...(recentRequests.length ? { requests: recentRequests } : {}),
      } as NoteDiagnostics;
    },
    stop() {
      view.removeEventListener('error', onError, true);
      view.removeEventListener('unhandledrejection', onRejection);
      observer?.disconnect();
    },
  };
}

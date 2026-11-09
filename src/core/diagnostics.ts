/**
 * What went wrong on the page shortly before a note was written: uncaught
 * errors, unhandled promise rejections and failed requests. A reviewer writes
 * "this flashes an error sometimes"; the agent reading the note later has no
 * console. Only passive listeners: `console` is never wrapped, so the host's
 * own log lines keep their source locations.
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
    return `${url.origin === origin ? '' : url.origin}${url.pathname}`.slice(0, MAX_MESSAGE);
  } catch {
    return '';
  }
}

function remember<T extends Seen>(list: T[], entry: T, same: (a: T) => boolean): void {
  const known = list.find(same);
  if (known) {
    known.count++;
    known.at = entry.at;
    return;
  }
  list.push(entry);
  if (list.length > KEEP) list.shift();
}

export interface DiagnosticsRecorder {
  /** The recent trouble, or undefined when the page has been quiet. */
  recent(now?: number): NoteDiagnostics | undefined;
  stop(): void;
}

/** Start listening on `view`. One recorder per panel; `stop` removes every listener. */
export function recordDiagnostics(view: Window): DiagnosticsRecorder {
  const errors: ErrorEntry[] = [];
  const requests: RequestEntry[] = [];
  const origin = view.location.origin;

  const addError = (message: string, source?: string) => {
    const text = message.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
    if (text) remember(errors, { message: text, source, at: Date.now(), count: 1 }, (e) => e.message === text && e.source === source);
  };
  const addRequest = (raw: string, status?: number) => {
    const url = plainUrl(raw, origin);
    // The panel's own polling is not the page's trouble.
    if (url && !url.includes('/api/isotone/'))
      remember(requests, { url, status, at: Date.now(), count: 1 }, (r) => r.url === url && r.status === status);
  };

  const onError = (event: Event) => {
    const error = event as ErrorEvent;
    // An element that failed to load (img, script, link) raises a plain event at itself.
    if (event.target && event.target !== view && !(typeof error.message === 'string' && error.message)) {
      const target = event.target as { src?: unknown; href?: unknown; isConnected?: boolean };
      const url = typeof target.src === 'string' ? target.src : typeof target.href === 'string' ? target.href : '';
      if (url) addRequest(url);
      return;
    }
    const file = error.filename ? plainUrl(error.filename, origin) : '';
    addError(error.message || String(error.error ?? 'Error'), file ? `${file}:${error.lineno ?? 0}` : undefined);
  };
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason as { message?: unknown; name?: unknown } | undefined;
    const message = reason && typeof reason.message === 'string' ? `${String(reason.name ?? 'Error')}: ${reason.message}` : String(reason);
    addError(`Unhandled rejection: ${message}`);
  };
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

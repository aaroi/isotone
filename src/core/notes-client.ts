import { FEEDBACK_STORAGE_KEY, readBrowserStorage } from './browser-storage';
import { createNoteId } from './id';
import { MAX_FEEDBACK_LENGTH } from './limits';
import { request } from './request';
import type { IsotoneElement, IsotoneNote, IsotoneStoreConfig, NoteContext } from './types';

/* ---------------------------------------------------------------------------
 * Store: client transport for the notes. The Vite plugin serves the endpoint
 * (same-origin, dev-only); a `localStorage` fallback keeps notes when the
 * dev server is unreachable. The endpoint and storage namespace are
 * configurable so multi-app origins don't collide.
 * ------------------------------------------------------------------------- */

/** Where the last `saveNote` landed; `null` before the first one. */
export type SaveLocation = 'server' | 'local';

type Viewport = { w: number; h: number };

const newestFirst = (a: IsotoneNote, b: IsotoneNote) => b.createdAt.localeCompare(a.createdAt);
const isDefaultsRequest = (feedback: string) => feedback.startsWith('[set-defaults]');

function parseLocal(raw: string | null): IsotoneNote[] {
  try {
    const items = JSON.parse(raw ?? '[]') as IsotoneNote[];
    if (
      !Array.isArray(items) ||
      !items.every(
        (note) =>
          note &&
          typeof note.id === 'string' &&
          typeof note.route === 'string' &&
          typeof note.feedback === 'string' &&
          typeof note.createdAt === 'string',
      )
    )
      throw new Error('Invalid notes');
    return items
      .map((i) => ({ ...i, done: i.done ?? false }))
      .map((i) => ({
        ...i,
        element: i.element ?? null,
      }));
  } catch (cause) {
    throw new Error('Could not read local feedback. Browser storage has been left untouched.', { cause });
  }
}

/** The server's notes, with the ones this browser still holds in place of their server copies. */
function merge(remote: IsotoneNote[], local: IsotoneNote[]): IsotoneNote[] {
  const pendingIds = new Set(local.map((note) => note.id));
  return [...remote.filter((note) => !pendingIds.has(note.id)), ...local];
}

/**
 * The notes kept in `localStorage`: every note when there is no endpoint, and
 * otherwise the backlog the server has not acknowledged yet.
 */
function createLocalNotes(key: string) {
  function all(): IsotoneNote[] {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      return [];
    }
    return parseLocal(readBrowserStorage(storage, key));
  }

  function write(items: IsotoneNote[]) {
    window.localStorage.setItem(key, JSON.stringify(items));
  }

  /** Drops the exact snapshot the server acknowledged; a newer local edit of the note stays. */
  function acknowledge(item: IsotoneNote): void {
    const current = all();
    const snapshot = JSON.stringify(item);
    const remaining = current.filter((note) => note.id !== item.id || JSON.stringify(note) !== snapshot);
    if (remaining.length !== current.length) write(remaining);
  }

  function save(
    route: string,
    feedback: string,
    element: IsotoneElement | null,
    id: string | null,
    payload?: unknown,
    viewport?: Viewport,
    context?: NoteContext,
  ): string {
    const notes = all();
    let savedId: string;
    const defaultsRequest = isDefaultsRequest(feedback);
    const existing = id
      ? notes.find((f) => f.id === id && f.route === route)
      : defaultsRequest
        ? notes.filter((n) => !n.done && n.route === route && isDefaultsRequest(n.feedback)).sort(newestFirst)[0]
        : undefined;
    if (existing) {
      if (defaultsRequest && !id) {
        delete existing.elements;
        delete existing.variant;
        delete existing.variantAction;
        delete existing.payload;
      }
      existing.feedback = feedback;
      existing.element = element;
      if (payload !== undefined) existing.payload = payload;
      if (defaultsRequest) {
        existing.createdAt = new Date().toISOString();
        if (viewport) existing.viewport = viewport;
      }
      if (context) Object.assign(existing, context);
      if (existing.elements) existing.element = existing.elements[0] ?? null;
      savedId = existing.id;
    } else {
      savedId = id ?? createNoteId();
      notes.push({
        id: savedId,
        route,
        feedback,
        element,
        done: false,
        createdAt: new Date().toISOString(),
        ...(viewport ? { viewport } : {}),
        ...(payload !== undefined ? { payload } : {}),
        ...context,
        ...(context?.elements ? { element: context.elements[0] ?? null } : {}),
      });
    }
    write(defaultsRequest ? notes.filter((n) => n.id === savedId || n.done || n.route !== route || !isDefaultsRequest(n.feedback)) : notes);
    return savedId;
  }

  return { all, write, acknowledge, save };
}

type LocalNotes = ReturnType<typeof createLocalNotes>;

/**
 * Answers to a backlog POST that will never change: the note itself is
 * invalid. Others (403 host, 404, 409 full file, 429) can pass once the
 * server or its notes file changes, so those notes stay queued.
 */
const NEVER_ACCEPTED = new Set([400, 413, 415]);

/** Pushes the local backlog to the server, one run at a time: a second call joins the run in flight. */
function createBacklogSync(endpoint: string | null, local: LocalNotes): () => Promise<void> {
  let migration: Promise<void> | null = null;

  async function flush(): Promise<void> {
    if (!endpoint) return;
    const backlog = local.all();
    if (backlog.length === 0) return;
    for (const item of backlog) {
      // Notes saved by an older client may exceed today's server limit.
      // Keep them in the browser, but let valid notes behind them sync.
      if (item.feedback.trim().length > MAX_FEEDBACK_LENGTH) continue;
      let rejected = null as { status: number; error: unknown } | null;
      const saved = await request(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            createdAt: item.createdAt,
            route: item.route,
            feedback: item.feedback,
            element: item.element ?? null,
            ...(item.elements !== undefined ? { elements: item.elements } : {}),
            ...(item.variant !== undefined ? { variant: item.variant } : {}),
            ...(item.variantAction !== undefined ? { variantAction: item.variantAction } : {}),
            ...(item.styleEdits !== undefined ? { styleEdits: item.styleEdits } : {}),
            ...(item.payload !== undefined ? { payload: item.payload } : {}),
            ...(item.viewport ? { viewport: item.viewport } : {}),
          }),
        },
        async (res) => {
          if (!res.ok) {
            if (res.status >= 400 && res.status < 500) {
              rejected = { status: res.status, error: ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error };
            }
            return null;
          }
          return (await res.json()) as { id?: unknown };
        },
      );
      if (!saved || typeof saved.id !== 'string' || !saved.id) {
        if (rejected) {
          // A note the server can never accept is dropped, once and loudly,
          // instead of being posted again on every poll.
          if (NEVER_ACCEPTED.has(rejected.status)) {
            local.acknowledge(item);
            console.warn(
              `Isotone dropped a saved note the server rejects (${rejected.status}${typeof rejected.error === 'string' ? `: ${rejected.error}` : ''}).`,
              item,
            );
          }
          continue;
        }
        return; // A transient failure or missing acknowledgement stops the retry.
      }
      // A save may have happened while the request was in flight. Remove
      // only the exact snapshot acknowledged by the server, never the queue.
      local.acknowledge(item);
    }
  }

  return () => {
    migration ??= flush().finally(() => {
      migration = null;
    });
    return migration;
  };
}

/**
 * Posts one note. Resolves to the id the server acknowledged, or `null` when
 * the server is unreachable, failed, or sent no id, so the caller keeps the
 * note locally. A validation error throws: it needs a correction, not a
 * permanently stuck queue.
 */
async function postNote(endpoint: string, body: Record<string, unknown>): Promise<string | null> {
  let res: Response | undefined;
  let result: { id?: unknown; error?: unknown } | null;
  try {
    result = await request(
      endpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      async (response) => {
        res = response;
        if (!response.ok && response.status >= 500) throw new Error(`Saving Isotone note failed (${response.status})`);
        return (await response.json().catch((error) => {
          if (response.ok) throw error;
          return null;
        })) as { id?: unknown; error?: unknown } | null;
      },
    );
  } catch {
    if (res && !res.ok && res.status < 500) throw new Error(`Saving Isotone note failed (${res.status})`);
    return null;
  }
  if (!res?.ok) {
    throw new Error(`Saving Isotone note failed (${res?.status})${typeof result?.error === 'string' ? `: ${result.error}` : ''}`);
  }
  if (!result || typeof result.id !== 'string' || !result.id) return null;
  return result.id;
}

export function createIsotoneStore(cfg: IsotoneStoreConfig = {}) {
  const endpoint = cfg.endpoint ?? null;
  const local = createLocalNotes(cfg.key ?? FEEDBACK_STORAGE_KEY);
  const syncBacklog = createBacklogSync(endpoint, local);
  let lastSave: SaveLocation | null = null;

  async function readRemote(url: string): Promise<IsotoneNote[]> {
    await syncBacklog().catch(() => {});
    const pending = local.all();
    try {
      const remote = await request(url, undefined, async (res) => {
        if (!res.ok) throw new Error(`Loading Isotone notes failed (${res.status})`);
        return (await res.json()) as IsotoneNote[];
      });
      return merge(remote, pending);
    } catch (error) {
      if (pending.length) return pending;
      throw error;
    }
  }

  /** Notes for one route, or every note on every route when `route` is omitted. */
  async function listNotes(route?: string): Promise<IsotoneNote[]> {
    const notes = !endpoint
      ? local.all()
      : await readRemote(route === undefined ? `${endpoint}?all=1` : `${endpoint}?route=${encodeURIComponent(route)}`);
    return notes.filter((note) => route === undefined || note.route === route).sort(newestFirst);
  }

  /**
   * The open notes on every route, but cheaply: `rev` is the revision of the
   * last answer, and an unchanged server replies with no rows (`notes: null`).
   * Older servers ignore `rev` and return the list, which counts as changed.
   * Notes this browser kept while the server was away are pushed first, and
   * stay in the result until the server has them. Failures throw, so the
   * caller can back off.
   */
  async function pollNotes(rev: string | null): Promise<{ rev: string | null; notes: IsotoneNote[] | null }> {
    if (!endpoint) return { rev: null, notes: local.all().filter((n) => !n.done) };
    if (local.all().length) await syncBacklog().catch(() => {});
    const pending = local.all();
    const data = await request(`${endpoint}?rev=${encodeURIComponent(rev ?? '')}`, undefined, async (res) => {
      if (!res.ok) throw new Error(`Loading Isotone notes failed (${res.status})`);
      return (await res.json()) as IsotoneNote[] | { rev?: unknown; unchanged?: unknown; notes?: unknown };
    });
    if (Array.isArray(data)) return { rev: null, notes: merge(data, pending) };
    const next = typeof data?.rev === 'string' ? data.rev : null;
    // The panel already holds its own local saves, so an unchanged server means
    // nothing to replace.
    if (data?.unchanged === true && next !== null) return { rev: next, notes: null };
    if (!Array.isArray(data?.notes)) throw new Error('Unexpected notes response');
    return { rev: next, notes: merge(data.notes as IsotoneNote[], pending) };
  }

  /** Every still-open note across all routes, newest first. */
  async function pendingNotes(): Promise<IsotoneNote[]> {
    const notes = endpoint ? await readRemote(endpoint) : local.all();
    return notes.filter((note) => !note.done).sort(newestFirst);
  }

  async function saveNote(
    route: string,
    feedback: string,
    element: IsotoneElement | null,
    id: string | null,
    /** Opaque host context, attached only when the caller sends it. */
    payload?: unknown,
    /** Window size at write time; attached on create only. */
    viewport?: Viewport,
    context?: NoteContext,
  ): Promise<string> {
    if (feedback.trim().length > MAX_FEEDBACK_LENGTH) {
      throw new RangeError(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
    }
    if (!endpoint) {
      const savedId = local.save(route, feedback, element, id, payload, viewport, context);
      lastSave = 'local';
      return savedId;
    }
    // Stable across a lost response and its retry: the server treats this as
    // an upsert, so reconnecting cannot create a second copy of the note.
    const savedId = id ?? (isDefaultsRequest(feedback) ? null : createNoteId());
    const pendingBefore = local.all().find((note) => note.id === savedId);
    const serverId = await postNote(endpoint, {
      id: savedId,
      route,
      feedback,
      element,
      ...context,
      ...(payload !== undefined ? { payload } : {}),
      ...(viewport ? { viewport } : {}),
    });
    if (serverId === null) {
      const localId = local.save(route, feedback, element, savedId, payload, viewport, context);
      lastSave = 'local';
      return localId;
    }
    if (pendingBefore) local.acknowledge(pendingBefore);
    lastSave = 'server';
    return serverId;
  }

  async function deleteNote(id: string): Promise<void> {
    if (!endpoint) {
      local.write(local.all().filter((f) => f.id !== id));
      return;
    }
    const res = await request(`${endpoint}?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Deleting Isotone note failed (${res.status})`);
    const pending = local.all();
    if (pending.some((note) => note.id === id)) local.write(pending.filter((note) => note.id !== id));
  }

  return {
    listNotes,
    pollNotes,
    pendingNotes,
    saveNote,
    deleteNote,
    endpoint,
    /** Where the last save landed, for the panel's sync notice. */
    get lastSave(): SaveLocation | null {
      return lastSave;
    },
    get hasUnsyncedNotes(): boolean {
      return local.all().length > 0;
    },
  };
}

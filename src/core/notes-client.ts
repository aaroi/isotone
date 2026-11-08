import { FEEDBACK_STORAGE_KEY, readBrowserStorage } from './browser-storage';
import { createNoteId } from './id';
import { MAX_FEEDBACK_LENGTH } from './limits';
import { request } from './request';
import type { IterationElement, IterationNote, NoteContext } from './types';

/* ---------------------------------------------------------------------------
 * Store: client transport for the notes. The Vite plugin serves the endpoint
 * (same-origin, dev-only); a `localStorage` fallback keeps notes when the
 * dev server is unreachable. The endpoint and storage namespace are
 * configurable so multi-app origins don't collide.
 * ------------------------------------------------------------------------- */

export interface IterationStoreConfig {
  /** Absolute or same-origin URL of the notes endpoint. Must be set (by the
   *  Vite plugin's `isotone()` options or a framework preset) for a shared
   *  file-backed store; when omitted, only localStorage persists. */
  endpoint?: string | null;
  /** localStorage namespace. Default-scoped to the package; set it per hosted
   *  app when two apps share an origin. */
  key?: string;
}

/** Where the last `saveNote` landed; `null` before the first one. */
export type SaveLocation = 'server' | 'local';

export function createIterationStore(cfg: IterationStoreConfig = {}) {
  const endpoint = cfg.endpoint ?? null;
  const key = cfg.key ?? FEEDBACK_STORAGE_KEY;
  let lastSave: SaveLocation | null = null;
  let migration: Promise<void> | null = null;

  function parseLocal(raw: string | null): IterationNote[] {
    try {
      const items = JSON.parse(raw ?? '[]') as IterationNote[];
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

  function localAll(): IterationNote[] {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      return [];
    }
    return parseLocal(readBrowserStorage(storage, key));
  }

  function localWrite(items: IterationNote[]) {
    window.localStorage.setItem(key, JSON.stringify(items));
  }

  function acknowledge(item: IterationNote): void {
    const current = localAll();
    const snapshot = JSON.stringify(item);
    const remaining = current.filter((note) => note.id !== item.id || JSON.stringify(note) !== snapshot);
    if (remaining.length !== current.length) localWrite(remaining);
  }

  async function flushLocalBacklog(): Promise<void> {
    if (!endpoint) return;
    const backlog = localAll();
    if (backlog.length === 0) return;
    for (const item of backlog) {
      // Notes saved by an older client may exceed today's server limit.
      // Keep them in the browser, but let valid notes behind them sync.
      if (item.feedback.trim().length > MAX_FEEDBACK_LENGTH) continue;
      let rejected = false;
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
            ...(item.payload !== undefined ? { payload: item.payload } : {}),
            ...(item.viewport ? { viewport: item.viewport } : {}),
          }),
        },
        async (res) => {
          if (!res.ok) {
            rejected = res.status >= 400 && res.status < 500;
            return null;
          }
          return (await res.json()) as { id?: unknown };
        },
      );
      if (!saved || typeof saved.id !== 'string' || !saved.id) {
        if (rejected) continue;
        return; // A transient failure or missing acknowledgement stops the retry.
      }
      // A save may have happened while the request was in flight. Remove
      // only the exact snapshot acknowledged by the server, never the queue.
      acknowledge(item);
    }
  }

  function migrateLocalBacklog(): Promise<void> {
    migration ??= flushLocalBacklog().finally(() => {
      migration = null;
    });
    return migration;
  }

  async function readRemote(url: string): Promise<IterationNote[]> {
    await migrateLocalBacklog().catch(() => {});
    const local = localAll();
    try {
      const remote = await request(url, undefined, async (res) => {
        if (!res.ok) throw new Error(`Loading iteration notes failed (${res.status})`);
        return (await res.json()) as IterationNote[];
      });
      const pendingIds = new Set(local.map((note) => note.id));
      return [...remote.filter((note) => !pendingIds.has(note.id)), ...local];
    } catch (error) {
      if (local.length) return local;
      throw error;
    }
  }

  /** Notes for one route, or every note on every route when `route` is omitted. */
  async function listNotes(route?: string): Promise<IterationNote[]> {
    if (!endpoint) {
      return localAll()
        .filter((i) => route === undefined || i.route === route)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return (await readRemote(route === undefined ? `${endpoint}?all=1` : `${endpoint}?route=${encodeURIComponent(route)}`))
      .filter((note) => route === undefined || note.route === route)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * The open notes on every route, but cheaply: `rev` is the revision of the
   * last answer, and an unchanged server replies with no rows (`notes: null`).
   * Older servers ignore `rev` and return the list, which counts as changed.
   * Notes this browser kept while the server was away are pushed first, and
   * stay in the result until the server has them. Failures throw, so the
   * caller can back off.
   */
  async function pollNotes(rev: string | null): Promise<{ rev: string | null; notes: IterationNote[] | null }> {
    if (!endpoint) return { rev: null, notes: localAll().filter((n) => !n.done) };
    if (localAll().length) await migrateLocalBacklog().catch(() => {});
    const local = localAll();
    const data = await request(`${endpoint}?rev=${encodeURIComponent(rev ?? '')}`, undefined, async (res) => {
      if (!res.ok) throw new Error(`Loading iteration notes failed (${res.status})`);
      return (await res.json()) as IterationNote[] | { rev?: unknown; unchanged?: unknown; notes?: unknown };
    });
    if (Array.isArray(data)) return { rev: null, notes: merge(data, local) };
    const next = typeof data?.rev === 'string' ? data.rev : null;
    // The panel already holds its own local saves, so an unchanged server means
    // nothing to replace.
    if (data?.unchanged === true && next !== null) return { rev: next, notes: null };
    if (!Array.isArray(data?.notes)) throw new Error('Unexpected notes response');
    return { rev: next, notes: merge(data.notes as IterationNote[], local) };
  }

  function merge(remote: IterationNote[], local: IterationNote[]): IterationNote[] {
    const pendingIds = new Set(local.map((note) => note.id));
    return [...remote.filter((note) => !pendingIds.has(note.id)), ...local];
  }

  /** Every still-open note across all routes, newest first. */
  async function pendingNotes(): Promise<IterationNote[]> {
    if (!endpoint) {
      return localAll()
        .filter((i) => !i.done)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return (await readRemote(endpoint)).filter((note) => !note.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function saveLocal(
    route: string,
    feedback: string,
    element: IterationElement | null,
    id: string | null,
    payload?: unknown,
    viewport?: { w: number; h: number },
    context?: NoteContext,
  ): string {
    const all = localAll();
    let savedId: string;
    const defaultsRequest = feedback.startsWith('[set-defaults]');
    const existing = id
      ? all.find((f) => f.id === id && f.route === route)
      : defaultsRequest
        ? all
            .filter((n) => !n.done && n.route === route && n.feedback.startsWith('[set-defaults]'))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
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
      all.push({
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
    localWrite(
      defaultsRequest
        ? all.filter((n) => n.id === savedId || n.done || n.route !== route || !n.feedback.startsWith('[set-defaults]'))
        : all,
    );
    return savedId;
  }

  async function saveNote(
    route: string,
    feedback: string,
    element: IterationElement | null,
    id: string | null,
    /** Opaque host context, attached only when the caller sends it. */
    payload?: unknown,
    /** Window size at write time; attached on create only. */
    viewport?: { w: number; h: number },
    context?: NoteContext,
  ): Promise<string> {
    if (feedback.trim().length > MAX_FEEDBACK_LENGTH) {
      throw new RangeError(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
    }
    if (!endpoint) {
      const savedId = saveLocal(route, feedback, element, id, payload, viewport, context);
      lastSave = 'local';
      return savedId;
    }
    // Stable across a lost response and its retry: the server treats this as
    // an upsert, so reconnecting cannot create a second copy of the note.
    const savedId = id ?? (feedback.startsWith('[set-defaults]') ? null : createNoteId());
    const pendingBefore = localAll().find((note) => note.id === savedId);
    const saveOffline = () => {
      const localId = saveLocal(route, feedback, element, savedId, payload, viewport, context);
      lastSave = 'local';
      return localId;
    };
    let res: Response | undefined;
    let result: { id?: unknown; error?: unknown } | null;
    try {
      result = await request(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: savedId,
            route,
            feedback,
            element,
            ...context,
            ...(payload !== undefined ? { payload } : {}),
            ...(viewport ? { viewport } : {}),
          }),
        },
        async (response) => {
          res = response;
          if (!response.ok && response.status >= 500) throw new Error(`Saving iteration note failed (${response.status})`);
          return (await response.json().catch((error) => {
            if (response.ok) throw error;
            return null;
          })) as { id?: unknown; error?: unknown } | null;
        },
      );
    } catch {
      if (res && !res.ok && res.status < 500) throw new Error(`Saving iteration note failed (${res.status})`);
      return saveOffline();
    }
    // Validation errors require a correction, not a permanently stuck queue.
    if (!res?.ok) {
      throw new Error(`Saving iteration note failed (${res?.status})${typeof result?.error === 'string' ? `: ${result.error}` : ''}`);
    }
    if (!result || typeof result.id !== 'string' || !result.id) return saveOffline();
    if (pendingBefore) acknowledge(pendingBefore);
    lastSave = 'server';
    return result.id;
  }

  async function deleteNote(id: string): Promise<void> {
    if (!endpoint) {
      localWrite(localAll().filter((f) => f.id !== id));
      return;
    }
    const res = await request(`${endpoint}?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Deleting iteration note failed (${res.status})`);
    const local = localAll();
    if (local.some((note) => note.id === id)) localWrite(local.filter((note) => note.id !== id));
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
      return localAll().length > 0;
    },
  };
}

/**
 * isotone — core.
 *
 * The framework-agnostic half of the internal feedback loop. Holds the note
 * model, the element descriptor, the dev-store client (file-backed via a Vite
 * plugin, `localStorage` fallback), and the route visibility matcher. This
 * module has no React and no Vite dependency and is fully unit-testable in a
 * `node` env.
 */
import { request } from './request';
import { FEEDBACK_STORAGE_KEY, readBrowserStorage, writeBrowserStorage } from './browser-storage';
import { MAX_FEEDBACK_LENGTH } from './limits';
import { createNoteId } from './id';

/** A UI element picked with the panel's selector mode. */
export interface IterationElement {
  /** Lowercase tag name, e.g. "button". */
  tag: string;
  /** Trimmed text-content snippet (may be empty for visual elements). */
  text: string;
  /** Best-effort CSS path for locating the element in code. */
  selector: string;
}

/** A durable reference to a selector or one of its options, not a DOM path. */
export interface VariantReference {
  axisId: string;
  label: string;
  optionId?: string;
  optionLabel?: string;
  value?: string;
}

export interface VariantRemoval {
  axisId: string;
  action: 'remove-option' | 'remove-axis' | 'keep-default';
  optionId?: string;
}

export interface NoteContext {
  /** Pending instruction: deleting its note cancels it before the agent acts. */
  variantAction?: VariantRemoval;
  elements?: IterationElement[];
  variant?: VariantReference | null;
}

/** A note written in the panel, read and answered by the coding agent. */
export interface IterationNote extends NoteContext {
  id: string;
  /** The route the note was written on, e.g. "/projects". */
  route: string;
  feedback: string;
  element: IterationElement | null;
  done: boolean;
  doneAt?: string | null;
  createdAt: string;
  /** The window size the note was written at — layout feedback only means
   *  something at the breakpoint it was seen on. */
  viewport?: { w: number; h: number };
  /** Host-specific context the store round-trips without interpreting — see
   *  `StoredNote.payload`. */
  payload?: unknown;
}

/** The minimal structural surface the descriptor builder needs from a DOM
 *  node. `children` is `readonly` so both a real `HTMLCollection` and a plain
 *  test array satisfy it; the builder materializes it with `Array.from`. */
export interface NodeLike {
  tagName: string;
  id?: string | null;
  parentElement?: NodeLike | null;
  children?: readonly NodeLike[];
  textContent?: string | null;
  /** One-based child position, when the adapter can provide it cheaply. */
  indexInParent?: number;
}

/**
 * Best-effort descriptor of a picked element for locating it in code. Walks
 * up the tree collecting `#id` (preferred) or `tag:nth-child(n)` segments up
 * to a shallow depth, stopping at `BODY` or the depth cap. Kept framework-free
 * so it is unit-testable.
 */
export function describeIterationElement(
  el: NodeLike,
  maxDepth = 4,
): IterationElement {
  const parts: string[] = [];
  let node: NodeLike | null | undefined = el;
  let depth = 0;
  while (node && node.tagName !== "BODY" && depth < maxDepth) {
    if (node.id) {
      // Escape every code point: valid for leading digits, punctuation and
      // framework-generated ids without depending on the host's CSS global.
      const id = Array.from(node.id, (c) => `\\${c.codePointAt(0)?.toString(16)} `).join('');
      parts.unshift(`#${/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(node.id) ? node.id : id}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const parent: NodeLike | null | undefined = node.parentElement;
    if (parent) {
      const index = node.indexInParent ?? Array.from(parent.children ?? []).indexOf(node) + 1;
      if (index > 0) part += `:nth-child(${index})`;
    }
    parts.unshift(part);
    node = parent;
    depth++;
  }
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
    selector: parts.join(" > "),
  };
}

/** Lazy DOM views: describing one element never walks unrelated subtrees. */
export function elementAsNode(el: Element): NodeLike {
  const cache = new WeakMap<Element, NodeLike>();
  const view = (n: Element | null | undefined): NodeLike | null => {
    if (!n) return null;
    const cached = cache.get(n);
    if (cached) return cached;
    const created: NodeLike = {
      tagName: n.tagName,
      id: n.id || null,
      get textContent() { return n.textContent; },
      get parentElement() { return view(n.parentElement); },
      get children() { return Array.from(n.children, (child) => view(child) as NodeLike); },
      get indexInParent() {
        let index = 1;
        for (let sibling = n.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
        return index;
      },
    };
    cache.set(n, created);
    return created;
  };
  const root = view(el);
  if (root === null) {
    throw new Error('unreachable: a real element always maps to a view');
  }
  return root;
}

/** A matcher over a console route: include a page only when it is not hidden
 *  (denylist) or, when a visible list is given, only when it matches. */
export interface RouteGateOptions {
  /** Exact routes (or prefixes ending in `*`) to NEVER show the panel on,
   *  e.g. the auth flow. Defaults to the auth/login/error pages. */
  hidden?: string[];
  /** When set, visible only on these routes/prefixes (allowlist). Overrides
   *  `hidden` — used when a repo wants an explicit allow-list. */
  visible?: string[];
  /** Prefixes always barred regardless of `visible` (e.g. `/api`, `/auth`). */
  alwaysHidden?: string[];
}

const DEFAULT_HIDDEN = ["/login", "/logout", "/register", "/error", "/_error"];

function matchRoutePattern(route: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return route.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith("/")) return route.startsWith(pattern);
  return route === pattern || route.startsWith(`${pattern}/`);
}

/** Whether the panel may mount on the given route. Pure and unit-testable. */
export function isRouteVisible(route: string, rule: RouteGateOptions = {}): boolean {
  const hidden = rule.hidden ?? DEFAULT_HIDDEN;
  const alwaysHidden = rule.alwaysHidden ?? ["/api", "/auth", "/login"];
  // A prefix match on the "always" list is unconditionally hidden — the panel
  // must never appear on auth or API surfaces regardless of allow-list.
  for (const p of alwaysHidden) {
    if (route === p || route.startsWith(`${p}/`)) return false;
  }
  if (rule.visible && rule.visible.length > 0) {
    return rule.visible.some((v) => matchRoutePattern(route, v));
  }
  return !hidden.some((h) => matchRoutePattern(route, h));
}

/* ---------------------------------------------------------------------------
 * Store: client transport for the notes. The Vite plugin serves the endpoint
 * (same-origin, dev-only); a `localStorage` fallback keeps notes when the
 * dev server is unreachable. The endpoint and storage namespace are
 * configurable so multi-app origins don't collide.
 * ------------------------------------------------------------------------- */

export interface IterationStoreConfig {
  /** Absolute or same-origin URL of the notes endpoint. Must be set (by the
   *  Vite plugin's `iteration()` options or a framework preset) for a shared
   *  file-backed store; when omitted, only localStorage persists. */
  endpoint?: string | null;
  /** localStorage namespace. Default-scoped to the package; set it per hosted
   *  app when two apps share an origin. */
  key?: string;
}

/** Where the last `saveNote` landed; `null` before the first one. */
export type SaveLocation = "server" | "local";

export function createIterationStore(cfg: IterationStoreConfig = {}) {
  const endpoint = cfg.endpoint ?? null;
  const key = cfg.key ?? FEEDBACK_STORAGE_KEY;
  let lastSave: SaveLocation | null = null;
  let migration: Promise<void> | null = null;

  function parseLocal(raw: string | null): IterationNote[] {
    try {
      const items = JSON.parse(raw ?? '[]') as IterationNote[];
      if (!Array.isArray(items) || !items.every((note) => note && typeof note.id === 'string' &&
        typeof note.route === 'string' && typeof note.feedback === 'string' && typeof note.createdAt === 'string')) throw new Error('Invalid notes');
      return items.map((i) => ({ ...i, done: i.done ?? false })).map((i) => ({
        ...i,
        element: i.element ?? null,
      }));
    } catch (cause) {
      throw new Error('Could not read local feedback. Browser storage has been left untouched.', { cause });
    }
  }

  function localAll(): IterationNote[] {
    let storage: Storage;
    try { storage = window.localStorage; } catch { return []; }
    return parseLocal(readBrowserStorage(storage, key, (current, previous) => {
      const merged = new Map([...parseLocal(previous), ...parseLocal(current)].map(note => [note.id, note]));
      return JSON.stringify([...merged.values()]);
    }));
  }

  function localWrite(items: IterationNote[]) {
    writeBrowserStorage(window.localStorage, key, JSON.stringify(items));
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
      const saved = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      }, async (res) => {
        if (!res.ok) {
          rejected = res.status >= 400 && res.status < 500;
          return null;
        }
        return await res.json() as { id?: unknown };
      });
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
    migration ??= flushLocalBacklog().finally(() => { migration = null; });
    return migration;
  }

  async function readRemote(url: string): Promise<IterationNote[]> {
    await migrateLocalBacklog().catch(() => {});
    const local = localAll();
    try {
      const remote = await request(url, undefined, async (res) => {
        if (!res.ok) throw new Error(`Loading iteration notes failed (${res.status})`);
        return await res.json() as IterationNote[];
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
    return (await readRemote(
      route === undefined ? `${endpoint}?all=1` : `${endpoint}?route=${encodeURIComponent(route)}`,
    )).filter((note) => route === undefined || note.route === route)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Every still-open note across all routes, newest first. */
  async function pendingNotes(): Promise<IterationNote[]> {
    if (!endpoint) {
      return localAll()
        .filter((i) => !i.done)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return (await readRemote(endpoint)).filter((note) => !note.done)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const existing = id ? all.find((f) => f.id === id && f.route === route) : defaultsRequest ? all.filter(n => !n.done && n.route === route && n.feedback.startsWith('[set-defaults]')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
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
    localWrite(defaultsRequest ? all.filter(n => n.id === savedId || n.done || n.route !== route || !n.feedback.startsWith('[set-defaults]')) : all);
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
      lastSave = "local";
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
      result = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedId,
          route,
          feedback,
          element,
          ...context,
          ...(payload !== undefined ? { payload } : {}),
          ...(viewport ? { viewport } : {}),
        }),
      }, async (response) => {
        res = response;
        if (!response.ok && response.status >= 500) throw new Error(`Saving iteration note failed (${response.status})`);
        return await response.json().catch((error) => {
          if (response.ok) throw error;
          return null;
        }) as { id?: unknown; error?: unknown } | null;
      });
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
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Deleting iteration note failed (${res.status})`);
    const local = localAll();
    if (local.some((note) => note.id === id)) localWrite(local.filter((note) => note.id !== id));
  }

  return {
    listNotes,
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
export * from './variants';

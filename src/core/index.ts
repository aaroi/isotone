/**
 * iso-iterate — core.
 *
 * The framework-agnostic half of the internal feedback loop. Holds the note
 * model, the element descriptor, the dev-store client (file-backed via a Vite
 * plugin, `localStorage` fallback), and the route visibility matcher. This
 * module has no React and no Vite dependency and is fully unit-testable in a
 * `node` env.
 */

/** A UI element picked with the panel's selector mode. */
export interface IterationElement {
  /** Lowercase tag name, e.g. "button". */
  tag: string;
  /** Trimmed text-content snippet (may be empty for visual elements). */
  text: string;
  /** Best-effort CSS path for locating the element in code. */
  selector: string;
}

/** A note written in the panel, read and answered by the coding agent. */
export interface IterationNote {
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
      parts.unshift(`#${node.id}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const parent: NodeLike | null | undefined = node.parentElement;
    const siblings = parent ? Array.from(parent.children ?? []) : [];
    if (parent && siblings.length > 0) {
      const index = siblings.indexOf(node);
      if (index >= 0) part += `:nth-child(${index + 1})`;
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

/** Adapt a real DOM `Element` to the descriptor's duck-typed surface.
 *  `parentElement` back-links are cached BEFORE a node's children are built so
 *  the parent→child→parent climb terminates. Only the parent chain of the
 *  picked element and each ancestor's immediate siblings is materialized. */
export function elementAsNode(el: Element): NodeLike {
  const cache = new WeakMap<Element, NodeLike>();
  const view = (n: Element | null | undefined): NodeLike | null => {
    if (!n) return null;
    const cached = cache.get(n);
    if (cached) return cached;
    const created: NodeLike = {
      tagName: n.tagName,
      id: n.id || null,
      textContent: n.textContent,
      parentElement: null,
      children: [],
    };
    cache.set(n, created);
    created.parentElement = view(n.parentElement);
    created.children = Array.from(n.children ?? []).map(view).filter(
      (c): c is NodeLike => c !== null,
    );
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

/**
 * The browser's own fetch when the Vite plugin captured it before any app
 * code ran (`window.__isoIterateFetch`), else whatever `fetch` is now. An
 * app that stubs `window.fetch` — a preview app answering its own backend, a
 * mock layer — would otherwise answer the panel's requests too.
 */
const request: typeof fetch = (input, init) => {
  const native = (
    globalThis as { __isoIterateFetch?: typeof fetch }
  ).__isoIterateFetch;
  return (native ?? globalThis.fetch)(input, init);
};

export function createIterationStore(cfg: IterationStoreConfig = {}) {
  const endpoint = cfg.endpoint ?? null;
  const key = cfg.key ?? "iso-iterate-feedback";
  let lastSave: SaveLocation | null = null;

  function localAll(): IterationNote[] {
    try {
      const items = JSON.parse(
        window.localStorage.getItem(key) ?? "[]",
      ) as IterationNote[];
      return items.map((i) => ({ ...i, done: i.done ?? false })).map((i) => ({
        ...i,
        element: i.element ?? null,
      }));
    } catch {
      return [];
    }
  }

  function localWrite(items: IterationNote[]) {
    window.localStorage.setItem(key, JSON.stringify(items));
  }

  async function migrateLocalBacklog(): Promise<void> {
    if (!endpoint) return;
    const backlog = localAll();
    if (backlog.length === 0) return;
    for (const item of backlog) {
      const res = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: item.route,
          feedback: item.feedback,
          element: item.element ?? null,
          ...(item.payload !== undefined ? { payload: item.payload } : {}),
          ...(item.viewport ? { viewport: item.viewport } : {}),
        }),
      });
      if (!res.ok) return; // keep backlog, retry next time
    }
    window.localStorage.removeItem(key);
  }

  async function listNotes(route: string): Promise<IterationNote[]> {
    if (!endpoint) {
      return localAll()
        .filter((i) => i.route === route)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    await migrateLocalBacklog().catch(() => {});
    const res = await request(`${endpoint}?route=${encodeURIComponent(route)}`);
    if (!res.ok) throw new Error(`Loading iteration notes failed (${res.status})`);
    return (await res.json()) as IterationNote[];
  }

  /** Every still-open note across all routes, newest first. */
  async function pendingNotes(): Promise<IterationNote[]> {
    if (!endpoint) {
      return localAll()
        .filter((i) => !i.done)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    await migrateLocalBacklog().catch(() => {});
    const res = await request(endpoint);
    if (!res.ok) throw new Error(`Loading iteration notes failed (${res.status})`);
    return (await res.json()) as IterationNote[];
  }

  function saveLocal(
    route: string,
    feedback: string,
    element: IterationElement | null,
    id: string | null,
    payload?: unknown,
    viewport?: { w: number; h: number },
  ): string {
    const all = localAll();
    let savedId: string;
    const existing = id ? all.find((f) => f.id === id) : undefined;
    if (existing) {
      existing.feedback = feedback;
      existing.element = element;
      savedId = existing.id;
    } else {
      savedId = crypto.randomUUID();
      all.push({
        id: savedId,
        route,
        feedback,
        element,
        done: false,
        createdAt: new Date().toISOString(),
        ...(viewport ? { viewport } : {}),
        ...(payload !== undefined ? { payload } : {}),
      });
    }
    localWrite(all);
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
  ): Promise<string> {
    if (!endpoint) {
      lastSave = "local";
      return saveLocal(route, feedback, element, id, payload, viewport);
    }
    try {
      const res = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          route,
          feedback,
          element,
          ...(payload !== undefined ? { payload } : {}),
          ...(viewport ? { viewport } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Saving iteration note failed (${res.status})`);
      lastSave = "server";
      return ((await res.json()) as { id: string }).id;
    } catch {
      // Dev server blipped: never lose the note — stash in localStorage. The
      // next `listNotes` flushes the backlog once the endpoint is reachable.
      // `lastSave` tells the panel, so the reviewer knows the note has not
      // reached the file yet rather than finding out from the agent.
      lastSave = "local";
      return saveLocal(route, feedback, element, id, payload, viewport);
    }
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
  };
}
export * from './variants';

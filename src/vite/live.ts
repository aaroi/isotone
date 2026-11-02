/**
 * Live overlay variants: switching without recompiling anything.
 *
 * In live mode the plugin serves every overridden script file as a small
 * dispatcher module. It imports each version of the file (the real one and
 * every variant's copy) under its own module id, `<file>?isotone=<id>`, and
 * re-exports one binding per name, chosen in the browser:
 *
 * - a component becomes a wrapper that renders the active version, so a
 *   switch is a re-render;
 * - a value that is the same in every version passes through untouched;
 * - any other value (a hook, a function, a constant, a context) is fixed when
 *   the page loads. A switch that changes one reloads the page, with the
 *   selection already in the URL, because React cannot swap a hook under a
 *   mounted component.
 *
 * Which variants a tab shows lives in that tab: in `?v=` when the reviewer
 * picked something there, otherwise in `.isotone/active.json`, which the
 * server injects into every page as the default.
 *
 * The browser code below is written as plain functions without outer
 * references, serialized with `Function.prototype.toString` into an inline
 * script and a virtual module. That keeps the host's React the one the
 * wrappers use, and keeps the functions testable as ordinary code.
 */

/** What the store needs from the server, per page load. */
export interface LiveConfig {
  /** Variant groups in panel order, each a decision with its members. */
  groups: { id: string; members: string[] }[];
  /** The server's active set: `.isotone/active.json` when the page was served. */
  active: string[];
  /** The page may be server-rendered, so a pinned mismatch has to reach the server. */
  ssr: boolean;
  /** The variants endpoint, for the SSR sync. */
  endpoint: string;
}

/** The store's public surface, also used by the panel's overlay source. */
export interface LiveStore {
  readonly version: 1;
  /** The selection this tab shows. */
  readonly active: string[];
  /** The set the server rendered this page with, for hydration. Fixed for
   *  the life of the page. */
  readonly server: string[];
  /** Whether this tab's selection comes from its URL. */
  readonly explicit: boolean;
  subscribe(listener: () => void): () => void;
  /** Register a loaded file: its versions (`null` for the real file) and
   *  whether any of its exports is fixed at load. */
  register(key: string, ids: (string | null)[], pinned: boolean): void;
  /** Whether switching to `next` needs a page reload. */
  needsReload(next: string[]): boolean;
  /**
   * Switch this tab to `next` and write it to the URL. Returns true when the
   * page has to reload to show it; the caller reloads once the server knows
   * the new set (an SSR page renders from it).
   */
  select(next: string[]): boolean;
  /** The server's default changed. Tabs without their own pick follow it. */
  follow(next: string[]): void;
  reload(): void;
}

/** The query that marks one version of a file. The real file is `_base`, a
 *  name no variant id can take. */
export const VERSION_QUERY = 'isotone';
export const BASE_VERSION = '_base';
export const LIVE_MODULE = 'virtual:isotone/live';
export const RESOLVED_LIVE_MODULE = '\0isotone-live';
/** Sent over Vite's HMR channel when the server's active set changes. */
export const ACTIVE_EVENT = 'isotone:active';

/**
 * Create the tab's store on `win`, or return the one already there. Runs as
 * an inline `<head>` script before any module, so every dispatcher sees the
 * same selection while the page evaluates.
 */
export function liveStore(win: Window & { __isotoneLive?: LiveStore }, cfg: LiveConfig): LiveStore {
  if (win.__isotoneLive && win.__isotoneLive.version === 1) return win.__isotoneLive;
  const PARAM = 'v';
  const DEFAULT = 'default';
  const groups = cfg.groups;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const listeners = new Set<() => void>();
  const files = new Map<string, { ids: (string | null)[]; pinned: boolean }>();
  const history = win.history;
  const replace = history.replaceState;
  const push = history.pushState;

  const readParam = (search: string): string | null => {
    for (const part of search.replace(/^\?/, '').split('&')) {
      const at = part.indexOf('=');
      const key = at < 0 ? part : part.slice(0, at);
      if (decodeURIComponent(key) === PARAM) return decodeURIComponent((at < 0 ? '' : part.slice(at + 1)).replace(/\+/g, ' '));
    }
    return null;
  };
  /** Our picks from `?v=` (null when it names none of our groups) and the
   *  pairs that belong to someone else, kept when the param is rewritten. */
  const parse = (search: string): { picks: string[] | null; foreign: string[] } => {
    const raw = readParam(search);
    if (raw === null) return { picks: null, foreign: [] };
    const foreign: string[] = [];
    const picks = new Map<string, string>();
    for (const pair of raw.split(',')) {
      if (!pair) continue;
      const at = pair.indexOf(':');
      const group = at < 0 ? undefined : byId.get(pair.slice(0, at));
      const value = at < 0 ? '' : pair.slice(at + 1);
      if (group && (value === DEFAULT || group.members.includes(value))) picks.set(group.id, value);
      else foreign.push(pair);
    }
    if (picks.size === 0) return { picks: null, foreign };
    return { picks: [...picks.values()].filter((value) => value !== DEFAULT), foreign };
  };
  const search = (set: string[]): string => {
    const { foreign } = parse(win.location.search);
    const mine: string[] = [];
    for (const group of groups) {
      const pick = group.members.find((member) => set.includes(member));
      if (pick) mine.push(`${group.id}:${pick}`);
    }
    const value = [...foreign, ...mine].join(',');
    const kept = win.location.search.replace(/^\?/, '').split('&').filter((part) => {
      if (!part) return false;
      const at = part.indexOf('=');
      return decodeURIComponent(at < 0 ? part : part.slice(0, at)) !== PARAM;
    });
    if (value) kept.push(`${PARAM}=${encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2C/gi, ',')}`);
    return kept.length ? `?${kept.join('&')}` : '';
  };
  const writeUrl = (set: string[]) => {
    const next = `${win.location.pathname}${search(set)}${win.location.hash}`;
    if (next !== `${win.location.pathname}${win.location.search}${win.location.hash}`) {
      replace.call(history, history.state, '', next);
    }
  };

  const fromUrl = parse(win.location.search).picks;
  const server = cfg.active.slice();
  let active = fromUrl ?? server.slice();
  let explicit = fromUrl !== null;
  let reloading = false;

  const versionOf = (ids: (string | null)[], set: string[]): string | null => {
    for (const id of ids) if (id !== null && set.includes(id)) return id;
    return null;
  };
  const needsReload = (from: string[], to: string[]): boolean => {
    for (const file of files.values()) {
      if (file.pinned && versionOf(file.ids, from) !== versionOf(file.ids, to)) return true;
    }
    return false;
  };
  const emit = () => { for (const listener of listeners) listener(); };
  const reload = () => { reloading = true; win.location.reload(); };

  // A server-rendered page rendered the server's set. When a link opens this
  // tab on another set and a fixed export differs, hydration would mix the
  // two: tell the server, then reload once. Only a fresh navigation does
  // this. A reload (the dev server's, or the reviewer's in a tab whose pick
  // another tab has since overridden) hydrates with a recoverable mismatch
  // instead, so two tabs never take the server back and forth.
  let syncing = false;
  const freshLoad = (): boolean => {
    try {
      // The timing entry can be missing while the document is still being
      // parsed; the legacy field is there from the start.
      const entry = win.performance.getEntriesByType('navigation')[0] as { type?: string } | undefined;
      if (entry?.type) return entry.type !== 'reload';
      return (win.performance as { navigation?: { type?: number } }).navigation?.type !== 1;
    } catch {
      return true;
    }
  };
  const syncServer = () => {
    if (syncing || !freshLoad()) return;
    syncing = true;
    const key = 'isotone:live-sync';
    const target = JSON.stringify(active);
    try {
      const last = JSON.parse(win.sessionStorage.getItem(key) ?? 'null') as { target: string; at: number } | null;
      if (last && last.target === target && Date.now() - last.at < 10_000) return;
      win.sessionStorage.setItem(key, JSON.stringify({ target, at: Date.now() }));
    } catch {
      return;
    }
    const send = (win as unknown as { __isotoneFetch?: typeof fetch }).__isotoneFetch ?? win.fetch.bind(win);
    send(`${cfg.endpoint}/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }).then((res) => { if (res.ok) reload(); }, () => {});
  };

  // A client-side navigation pushes a URL without `?v=`. Keep the tab's pick
  // in its address bar so a copied link still shows what the tab shows.
  const keep = (original: typeof push) => function (this: History, ...args: Parameters<typeof push>) {
    const result = original.apply(this, args);
    if (explicit && parse(win.location.search).picks === null) writeUrl(active);
    return result;
  };
  history.pushState = keep(push);
  history.replaceState = keep(replace);
  win.addEventListener('popstate', () => {
    if (explicit) writeUrl(active);
  });

  const store: LiveStore = {
    version: 1,
    get active() { return active; },
    get server() { return server; },
    get explicit() { return explicit; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    register(key, ids, pinned) {
      files.set(key, { ids, pinned });
      // Only while the page first loads: a module that runs again later (a
      // hot update) is past hydration, and the server has moved on since.
      if (cfg.ssr && pinned && win.document.readyState !== 'complete' &&
        versionOf(ids, active) !== versionOf(ids, server)) {
        queueMicrotask(syncServer);
      }
    },
    needsReload(next) {
      return needsReload(active, next);
    },
    select(next) {
      if (reloading) return true;
      const reloadNeeded = needsReload(active, next);
      active = next.slice();
      explicit = next.length > 0;
      writeUrl(active);
      if (reloadNeeded) return true;
      emit();
      return false;
    },
    follow(next) {
      if (explicit || reloading) return;
      const same = next.length === active.length && next.every((id) => active.includes(id));
      if (same) return;
      const reloadNeeded = needsReload(active, next);
      active = next.slice();
      if (reloadNeeded) reload();
      else emit();
    },
    reload,
  };
  win.__isotoneLive = store;
  return store;
}

/** The React side of a dispatcher: one binding per export name. */
export interface LiveBinder {
  file(key: string, ids: (string | null)[], modules: Record<string, unknown>[], names: string[]): Record<string, unknown>;
}

/**
 * Build the binder over the host's React and the tab's store. Runs inside the
 * virtual module, which imports React the way the host's own code does.
 */
export function liveBinder(
  React: {
    createElement: (type: unknown, props: unknown) => unknown;
    forwardRef: (render: (props: unknown, ref: unknown) => unknown) => unknown;
    useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, get: () => T, getServer?: () => T) => T;
    version: string;
  },
  store: LiveStore,
): LiveBinder {
  const MEMO = Symbol.for('react.memo');
  const FORWARD = Symbol.for('react.forward_ref');
  const LAZY = Symbol.for('react.lazy');
  const refAsProp = Number.parseInt(React.version, 10) >= 19;
  const BUILTIN = new Set(['length', 'name', 'prototype', 'caller', 'arguments', 'displayName',
    '$$typeof', 'render', 'type', 'compare', '_payload', '_init']);

  const isClass = (value: unknown): boolean =>
    typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
  const isComponent = (name: string, value: unknown): boolean => {
    if (typeof value === 'function') {
      const proto = (value as { prototype?: { isReactComponent?: unknown } }).prototype;
      if (proto?.isReactComponent) return true;
      if (isClass(value)) return false;
      return /^[A-Z]/.test(name === 'default' ? (value as { name?: string }).name ?? '' : name);
    }
    if (!value || typeof value !== 'object') return false;
    const tag = (value as { $$typeof?: unknown }).$$typeof;
    return tag === MEMO || tag === FORWARD || tag === LAZY;
  };

  return {
    file(key, ids, modules, names) {
      // The version a selection shows: the active variant that has this
      // file, else the real file, else (a file only variants add) the first.
      const pick = (set: string[]): number => {
        const hit = ids.findIndex((id) => id !== null && set.includes(id));
        if (hit >= 0) return hit;
        const base = ids.indexOf(null);
        return base >= 0 ? base : 0;
      };
      const out: Record<string, unknown> = {};
      let pinned = false;
      for (const name of names) {
        const values = modules.map((mod) => mod[name]);
        const first = values[0];
        if (values.every((value) => value === first)) {
          out[name] = first;
          continue;
        }
        const defined = values.filter((value) => value !== undefined);
        if (defined.length > 0 && defined.every((value) => isComponent(name, value))) {
          const render = (props: Record<string, unknown>, ref?: unknown) => {
            const index = React.useSyncExternalStore(
              store.subscribe,
              () => pick(store.active),
              () => pick(store.server),
            );
            const component = values[index];
            if (component == null) return null;
            return React.createElement(component, ref == null ? props : { ...props, ref });
          };
          const wrapper = (refAsProp ? (props: Record<string, unknown>) => render(props) : React.forwardRef(render as (p: unknown, r: unknown) => unknown)) as Record<string, unknown>;
          const label = name === 'default'
            ? (defined[0] as { displayName?: string; name?: string }).displayName ?? (defined[0] as { name?: string }).name ?? 'Variant'
            : name;
          if (typeof wrapper === 'function') Object.defineProperty(wrapper, 'name', { value: label });
          wrapper.displayName = label;
          // Compound components (`Card.Header`) read from the active version.
          const statics = new Set<string>();
          for (const value of defined) {
            for (const prop of Object.getOwnPropertyNames(value)) if (!BUILTIN.has(prop)) statics.add(prop);
          }
          for (const prop of statics) {
            if (prop in wrapper && !Object.getOwnPropertyDescriptor(wrapper, prop)?.configurable) continue;
            Object.defineProperty(wrapper, prop, {
              configurable: true,
              enumerable: true,
              get: () => (values[pick(store.active)] as Record<string, unknown> | undefined)?.[prop],
            });
          }
          out[name] = wrapper;
          continue;
        }
        pinned = true;
        out[name] = values[pick(store.active)];
      }
      store.register(key, ids, pinned);
      return out;
    },
  };
}

/** The inline `<head>` script that creates the tab's store. */
export function liveStoreScript(cfg: LiveConfig): string {
  return `(${liveStore.toString()})(window, ${safeJson(cfg)});`;
}

/** The virtual module the dispatchers import. `fallback` configures a store
 *  for a page whose HTML did not pass through the plugin. */
export function liveRuntimeModule(fallback: LiveConfig): string {
  return [
    `import * as React from 'react';`,
    `const store = (${liveStore.toString()})(window, ${safeJson(fallback)});`,
    `export const live = (${liveBinder.toString()})(React, store);`,
    `if (import.meta.hot) import.meta.hot.on(${JSON.stringify(ACTIVE_EVENT)}, (data) => store.follow(data.active));`,
    '',
  ].join('\n');
}

/**
 * The module served in place of a file with variants. `versions` lists the
 * real file (`null`) and each variant that has a copy, in a fixed order;
 * `names` is every export any version has.
 */
export function dispatcherModule(
  key: string,
  basename: string,
  versions: (string | null)[],
  names: string[],
): string {
  const lines = [`import { live as __isotone } from ${JSON.stringify(LIVE_MODULE)};`];
  versions.forEach((id, i) => {
    const spec = `./${basename}?${VERSION_QUERY}=${id ?? BASE_VERSION}`;
    lines.push(`import * as __v${i} from ${JSON.stringify(spec)};`);
  });
  lines.push(
    `const __f = __isotone.file(${JSON.stringify(key)}, ${JSON.stringify(versions)}, [${versions.map((_, i) => `__v${i}`).join(', ')}], ${JSON.stringify(names)});`,
  );
  names.forEach((name, i) => {
    lines.push(`const __e${i} = __f[${JSON.stringify(name)}];`);
    lines.push(name === 'default' ? `export default __e${i};` : `export { __e${i} as ${name} };`);
  });
  lines.push('');
  return lines.join('\n');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

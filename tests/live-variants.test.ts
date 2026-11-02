// @vitest-environment jsdom
/**
 * Live overlay variants in the browser: the tab's store (selection, `?v=`,
 * reload decisions) and the binder that turns each version's exports into
 * one binding. Both run here exactly as the page runs them, serialized
 * through `toString`, so a reference to anything outside the function fails
 * these tests.
 */
import * as React from 'react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dispatcherModule,
  type LiveConfig,
  type LiveStore,
  liveBinder,
  liveStore,
  liveStoreScript,
} from '../src/vite/live';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: LiveConfig = {
  groups: [
    { id: 'nav', members: ['picker-a', 'picker-b'] },
    { id: 'hooks', members: ['hook-x'] },
  ],
  active: [],
  ssr: false,
  endpoint: '/api/iteration/variants',
};

type LiveWindow = Window & { __isotoneLive?: LiveStore };

// Each store patches history; a page has one, so every test starts from these.
const PUSH = history.pushState;
const REPLACE = history.replaceState;

/** A fresh store, built the way the injected script builds it. */
function makeStore(url = '/', cfg: Partial<LiveConfig> = {}): LiveStore {
  history.pushState = PUSH;
  history.replaceState = REPLACE;
  history.replaceState(null, '', url);
  delete (window as LiveWindow).__isotoneLive;
  new Function(liveStoreScript({ ...CONFIG, ...cfg }))();
  const store = (window as LiveWindow).__isotoneLive;
  if (!store) throw new Error('no store');
  return store;
}

const here = () => `${location.pathname}${location.search}`;

describe('the live store', () => {
  let push: typeof history.pushState;
  let replace: typeof history.replaceState;
  beforeEach(() => {
    push = history.pushState;
    replace = history.replaceState;
  });
  afterEach(() => {
    history.pushState = push;
    history.replaceState = replace;
    delete (window as LiveWindow).__isotoneLive;
  });

  it('starts from the server default when the URL names none of its groups', () => {
    const store = makeStore('/?v=headline:b', { active: ['picker-a'] });
    expect(store.active).toEqual(['picker-a']);
    expect(store.explicit).toBe(false);
    expect(store.server).toEqual(['picker-a']);
  });

  it('takes the tab selection from ?v=, unmentioned groups at default', () => {
    const store = makeStore('/?v=nav:picker-b', { active: ['hook-x'] });
    expect(store.active).toEqual(['picker-b']);
    expect(store.explicit).toBe(true);
  });

  it('reads an explicit default and ignores options a group does not have', () => {
    expect(makeStore('/?v=nav:default', { active: ['picker-a'] }).active).toEqual([]);
    expect(makeStore('/?v=nav:nope', { active: ['picker-a'] }).explicit).toBe(false);
  });

  it('writes picks to ?v= in group order and keeps other params and pairs', () => {
    const store = makeStore('/items?tab=2&v=headline:b#top');
    store.select(['hook-x', 'picker-a']);
    expect(location.search).toBe('?tab=2&v=headline:b,nav:picker-a,hooks:hook-x');
    expect(location.hash).toBe('#top');
    store.select([]);
    expect(location.search).toBe('?tab=2&v=headline:b');
    expect(store.explicit).toBe(false);
  });

  it('switches components in place and asks for a reload only for fixed exports', () => {
    const store = makeStore('/');
    const seen = vi.fn();
    store.subscribe(seen);
    store.register('src/Picker.tsx', [null, 'picker-a', 'picker-b'], false);
    store.register('src/use-label.ts', [null, 'hook-x'], true);
    expect(store.select(['picker-b'])).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.needsReload(['picker-b', 'hook-x'])).toBe(true);
    expect(store.select(['picker-b', 'hook-x'])).toBe(true);
    // The URL already carries the pick for the reload to read.
    expect(here()).toBe('/?v=nav:picker-b,hooks:hook-x');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps ?v= through client-side navigation', () => {
    const store = makeStore('/');
    store.select(['picker-a']);
    history.pushState({ idx: 1 }, '', '/computers');
    expect(here()).toBe('/computers?v=nav:picker-a');
    expect(history.state).toEqual({ idx: 1 });
    history.replaceState(null, '', '/databases?sort=name');
    expect(here()).toBe('/databases?sort=name&v=nav:picker-a');
  });

  it('follows the server default only while the tab has no pick of its own', () => {
    const own = makeStore('/?v=nav:picker-a');
    own.follow(['picker-b']);
    expect(own.active).toEqual(['picker-a']);
    // What the server rendered this page with does not move.
    expect(own.server).toEqual([]);

    const loose = makeStore('/');
    const seen = vi.fn();
    loose.subscribe(seen);
    loose.follow(['picker-b']);
    expect(loose.active).toEqual(['picker-b']);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(here()).toBe('/');
  });

  it('is created once per page, however many copies of the script run', () => {
    const store = makeStore('/');
    expect(liveStore(window as LiveWindow, CONFIG)).toBe(store);
  });

  it('tells the server and reloads once when an SSR page rendered other fixed code', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    (window as { __isotoneFetch?: unknown }).__isotoneFetch = fetch;
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload, pathname: '/', search: '?v=hooks:hook-x', hash: '' } });
    const ready = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    try {
      sessionStorage.clear();
      delete (window as LiveWindow).__isotoneLive;
      const store = liveStore(window as LiveWindow, { ...CONFIG, ssr: true });
      store.register('src/use-label.ts', [null, 'hook-x'], true);
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(fetch).toHaveBeenCalledWith('/api/iteration/variants/active', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ active: ['hook-x'] }),
      }));
      // A second load that still disagrees does not loop.
      delete (window as LiveWindow).__isotoneLive;
      const again = liveStore(window as LiveWindow, { ...CONFIG, ssr: true });
      again.register('src/use-label.ts', [null, 'hook-x'], true);
      await new Promise((r) => setTimeout(r, 10));
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      ready.mockRestore();
      Object.defineProperty(window, 'location', { configurable: true, value: location });
      delete (window as { __isotoneFetch?: unknown }).__isotoneFetch;
    }
  });
});

describe('the live store on a reload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as LiveWindow).__isotoneLive;
  });

  it('leaves the server alone when a reload disagrees, so tabs cannot take turns', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    (window as { __isotoneFetch?: unknown }).__isotoneFetch = fetch;
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntryList);
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    try {
      sessionStorage.clear();
      const store = makeStore('/?v=hooks:hook-x', { ssr: true });
      store.register('src/use-label.ts', [null, 'hook-x'], true);
      await new Promise((r) => setTimeout(r, 10));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      delete (window as { __isotoneFetch?: unknown }).__isotoneFetch;
    }
  });
});

describe('the live store after load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as LiveWindow).__isotoneLive;
  });

  it('does not sync when a module registers again after a hot update', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    (window as { __isotoneFetch?: unknown }).__isotoneFetch = fetch;
    try {
      sessionStorage.clear();
      const store = makeStore('/?v=nav:picker-a', { ssr: true });
      store.follow(['hook-x']);
      store.register('src/use-label.ts', [null, 'hook-x'], true);
      await new Promise((r) => setTimeout(r, 10));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      delete (window as { __isotoneFetch?: unknown }).__isotoneFetch;
    }
  });
});

describe('the live binder', () => {
  let root: Root;
  let host: HTMLElement;
  let push: typeof history.pushState;
  let replace: typeof history.replaceState;
  beforeEach(() => {
    push = history.pushState;
    replace = history.replaceState;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    history.pushState = push;
    history.replaceState = replace;
    delete (window as LiveWindow).__isotoneLive;
  });

  /** Bind through the serialized binder, as the virtual module does. */
  function bind(store: LiveStore, ids: (string | null)[], modules: Record<string, unknown>[], names: string[]) {
    const make = new Function(`return (${liveBinder.toString()})`)() as typeof liveBinder;
    return make(React as unknown as Parameters<typeof liveBinder>[0], store).file('src/Picker.tsx', ids, modules, names);
  }

  it('re-renders the active version of a component and leaves the rest of the tree alone', () => {
    const store = makeStore('/');
    const base = { Picker: () => createElement('b', null, 'base') };
    const a = { Picker: () => createElement('b', null, 'A') };
    const out = bind(store, [null, 'picker-a'], [base, a], ['Picker']);
    let renders = 0;
    function Counter() {
      const [n, setN] = React.useState(0);
      renders++;
      return createElement('button', { type: 'button', onClick: () => setN(n + 1) }, String(n));
    }
    act(() => root.render(createElement('div', null, createElement(Counter), createElement(out.Picker as React.FC))));
    act(() => host.querySelector('button')?.click());
    expect(host.textContent).toBe('1base');
    const before = renders;
    act(() => { store.select(['picker-a']); });
    expect(host.textContent).toBe('1A');
    expect(renders).toBe(before);
  });

  it('passes identical values through and fixes differing non-components at load', () => {
    const store = makeStore('/?v=nav:picker-a');
    const register = vi.spyOn(store, 'register');
    const shared = { size: 20 };
    const out = bind(store, [null, 'picker-a'], [
      { PAGE: 20, config: shared, useLabel: () => 'base' },
      { PAGE: 20, config: shared, useLabel: () => 'a' },
    ], ['PAGE', 'config', 'useLabel']);
    expect(out.PAGE).toBe(20);
    expect(out.config).toBe(shared);
    expect((out.useLabel as () => string)()).toBe('a');
    expect(register).toHaveBeenCalledWith('src/Picker.tsx', [null, 'picker-a'], true);
  });

  it('treats classes as values and memo or forwardRef components as components', () => {
    const store = makeStore('/');
    class Client {}
    class Other {}
    const MemoA = React.memo(() => createElement('i', null, 'memo base'));
    const MemoB = React.memo(() => createElement('i', null, 'memo a'));
    const register = vi.spyOn(store, 'register');
    const classes = bind(store, [null, 'picker-a'], [{ Client }, { Client: Other }], ['Client']);
    expect(classes.Client).toBe(Client);
    expect(register).toHaveBeenLastCalledWith('src/Picker.tsx', [null, 'picker-a'], true);
    const out = bind(store, [null, 'picker-a'], [{ Card: MemoA }, { Card: MemoB }], ['Card']);
    expect(register).toHaveBeenLastCalledWith('src/Picker.tsx', [null, 'picker-a'], false);
    act(() => root.render(createElement(out.Card as React.FC)));
    expect(host.textContent).toBe('memo base');
    act(() => { store.select(['picker-a']); });
    expect(host.textContent).toBe('memo a');
  });

  it('forwards refs and reads compound statics from the active version', () => {
    const store = makeStore('/');
    const Header = () => createElement('h1', null, 'base header');
    const AHeader = () => createElement('h1', null, 'a header');
    const Card = Object.assign((props: { ref?: React.Ref<HTMLElement> }) => createElement('section', { ref: props.ref }, 'base'), { Header });
    const ACard = Object.assign((props: { ref?: React.Ref<HTMLElement> }) => createElement('section', { ref: props.ref }, 'a'), { Header: AHeader });
    const out = bind(store, [null, 'picker-a'], [{ Card }, { Card: ACard }], ['Card']);
    const Wrapped = out.Card as React.FC<{ ref?: React.Ref<HTMLElement> }> & { Header: React.FC };
    const ref = React.createRef<HTMLElement>();
    act(() => root.render(createElement(Wrapped, { ref })));
    expect(ref.current?.tagName).toBe('SECTION');
    expect(Wrapped.Header).toBe(Header);
    act(() => { store.select(['picker-a']); });
    expect(Wrapped.Header).toBe(AHeader);
  });

  it('renders nothing for a component the active version does not have', () => {
    const store = makeStore('/');
    const out = bind(store, [null, 'picker-a'], [{ Badge: () => createElement('i', null, 'badge') }, {}], ['Badge']);
    act(() => root.render(createElement(out.Badge as React.FC)));
    expect(host.textContent).toBe('badge');
    act(() => { store.select(['picker-a']); });
    expect(host.textContent).toBe('');
  });
});

describe('dispatcherModule', () => {
  it('imports every version beside the file and re-exports each name', () => {
    const code = dispatcherModule('src/Picker.tsx', 'Picker.tsx', [null, 'picker-a'], ['Picker', 'default', 'delete']);
    expect(code).toContain(`import * as __v0 from "./Picker.tsx?isotone=_base";`);
    expect(code).toContain(`import * as __v1 from "./Picker.tsx?isotone=picker-a";`);
    // Component-shaped names exist before the module runs, for import cycles.
    expect(code).toContain('export function Picker(props, ref)');
    expect(code).toContain('Picker = __f["Picker"];');
    expect(code).toContain('export default function __isotoneDefault(props, ref)');
    expect(code).toContain('__isotoneDefault = __f["default"];');
    expect(code).toContain('export { __e2 as delete };');
  });

  it('runs as a module, and a stand-in taken before it ran still renders', async () => {
    const store = makeStore('/');
    const binder = liveBinder(React as unknown as Parameters<typeof liveBinder>[0], store);
    const code = dispatcherModule('src/Picker.tsx', 'Picker.tsx', [null, 'picker-a'], ['Picker', 'PAGE'])
      .replace(/^import \{ live as __isotone \}.*$/m, 'const __isotone = globalThis.__liveBinder;')
      .replace(/^import \* as __v0 .*$/m, 'const __v0 = globalThis.__v0;')
      .replace(/^import \* as __v1 .*$/m, 'const __v1 = globalThis.__v1;');
    const g = globalThis as Record<string, unknown>;
    g.__liveBinder = binder;
    g.__v0 = { Picker: () => createElement('b', null, 'base'), PAGE: 20 };
    g.__v1 = { Picker: () => createElement('b', null, 'A'), PAGE: 20 };
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    const mod = await import(/* @vite-ignore */ url) as { Picker: React.FC; PAGE: number };
    expect(mod.PAGE).toBe(20);
    expect((mod.Picker as { displayName?: string }).displayName).toBe('Picker');
    delete g.__liveBinder; delete g.__v0; delete g.__v1;
  });
});

describe('the binder after the review', () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as LiveWindow).__isotoneLive;
  });
  const bindAs = (key: string, store: LiveStore, ids: (string | null)[], modules: Record<string, unknown>[], names: string[]) =>
    liveBinder(React as unknown as Parameters<typeof liveBinder>[0], store).file(key, ids, modules, names);

  it('renders through the stand-in a cycle captured early', () => {
    const store = makeStore('/');
    const out = bindAs('src/Picker.tsx', store, [null, 'picker-a'], [
      { Picker: () => createElement('b', null, 'base') },
      { Picker: () => createElement('b', null, 'A') },
    ], ['Picker']);
    const render = (out as unknown as { __isotoneRender: (n: string, p: object) => unknown }).__isotoneRender;
    function StandIn(props: object) { return render('Picker', props) as React.ReactElement; }
    act(() => root.render(createElement(StandIn)));
    expect(host.textContent).toBe('base');
    act(() => { store.select(['picker-a']); });
    expect(host.textContent).toBe('A');
  });

  it('treats an anonymous default export in a JSX file as a component', () => {
    const store = makeStore('/');
    const register = vi.spyOn(store, 'register');
    bindAs('src/Card.tsx', store, [null, 'picker-a'], [{ default: () => null }, { default: () => null }], ['default']);
    expect(register).toHaveBeenLastCalledWith('src/Card.tsx', [null, 'picker-a'], false);
    bindAs('src/config.ts', store, [null, 'picker-a'], [{ default: () => 1 }, { default: () => 2 }], ['default']);
    expect(register).toHaveBeenLastCalledWith('src/config.ts', [null, 'picker-a'], true);
  });

  it('picks by the order of the active set, as the server does', () => {
    const store = makeStore('/?v=nav:picker-b,hooks:hook-x');
    const out = bindAs('src/shared.ts', store, [null, 'hook-x', 'picker-b'], [{ v: 0 }, { v: 1 }, { v: 2 }].map((m) => ({ value: m })), ['value']);
    expect((out.value as { v: number }).v).toBe(2);
  });
});

describe('the store with a malformed query', () => {
  afterEach(() => { delete (window as LiveWindow).__isotoneLive; });
  it('ignores escapes it cannot decode', () => {
    const store = makeStore('/?%E0=1&v=nav:picker-a');
    expect(store.active).toEqual(['picker-a']);
    store.select(['picker-b']);
    expect(location.search).toBe('?%E0=1&v=nav:picker-b');
  });
});

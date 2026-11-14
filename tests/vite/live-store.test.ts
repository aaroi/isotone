/**
 * The live store's and binder's less common paths: back/forward, following
 * the server, the SSR sync's failure modes, odd query strings and older
 * React. live-variants.test.ts runs the common paths through the serialized
 * script, as the page does; these call the functions directly, which runs the
 * same code (and lets coverage see it).
 */
import * as React from 'react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LiveConfig, type LiveStore, liveBinder, liveStore } from '../../src/vite/live';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LiveWindow = Window & { __isotoneLive?: LiveStore; __isotoneFetch?: typeof fetch };
const win = window as LiveWindow;
const CONFIG: LiveConfig = {
  groups: [
    { id: 'nav', members: ['picker-a', 'picker-b'] },
    { id: 'hooks', members: ['hook-x'] },
  ],
  active: [],
  ssr: false,
  conflicted: [],
  endpoint: '/api/isotone/variants',
};
const PUSH = history.pushState;
const REPLACE = history.replaceState;
const LOCATION = window.location;

function store(url = '/', cfg: Partial<LiveConfig> = {}): LiveStore {
  history.pushState = PUSH;
  history.replaceState = REPLACE;
  history.replaceState(null, '', url);
  delete win.__isotoneLive;
  return liveStore(win, { ...CONFIG, ...cfg });
}
const here = () => `${location.pathname}${location.search}`;

/** Replace `location.reload`, which jsdom does not implement. */
function stubReload(search = '') {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...LOCATION, reload, pathname: '/', search, hash: '' } });
  return reload;
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: LOCATION });
  history.pushState = PUSH;
  history.replaceState = REPLACE;
  delete win.__isotoneLive;
  delete win.__isotoneFetch;
  sessionStorage.clear();
});

describe('the address bar', () => {
  // Each store adds a popstate listener for the life of the window, so this
  // file checks only the case where the tab has a pick.
  it('puts the pick back after back/forward drops it', () => {
    const own = store('/');
    own.select(['picker-a']);
    REPLACE.call(history, null, '', '/elsewhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(here()).toBe('/elsewhere?v=nav:picker-a');
  });

  it('reads odd queries without losing anyone else’s parameters', () => {
    expect(store('/?v').explicit).toBe(false);
    expect(store('/?v=,nav:picker-b,').active).toEqual(['picker-b']);
    const mixed = store('/?q=a+b&v=solo,nav:picker-a&&x');
    expect(mixed.active).toEqual(['picker-a']);
    mixed.select(['picker-b']);
    // A pair without a group (`solo`) belongs to someone else and stays.
    expect(here()).toBe('/?q=a+b&x&v=solo,nav:picker-b');
  });

  it('does not rewrite the URL when it already shows the pick', () => {
    const tab = store('/?v=nav:picker-a');
    const replace = vi.spyOn(history, 'replaceState');
    tab.select(['picker-a']);
    expect(replace).not.toHaveBeenCalled();
  });

  it('holds a pick whose copy has conflict markers at Default, keeps the tab its own, and keeps one pair per group', () => {
    const tab = store('/?v=nav:picker-b', { active: ['picker-a'], conflicted: ['picker-b'] });
    // Not shown, and not the other tab's pick either: this tab stays on Default.
    expect(tab.explicit).toBe(true);
    expect(tab.shown).toEqual([]);
    tab.follow(['picker-a']);
    expect(tab.shown).toEqual([]);
    // A pick elsewhere keeps the held pair, to return once the markers go…
    tab.select(['hook-x'], ['hooks']);
    expect(here()).toBe('/?v=nav:picker-b,hooks:hook-x');
    // …a pick of it changes nothing it shows…
    tab.select(['hook-x', 'picker-b'], ['nav']);
    expect(tab.shown).toEqual(['hook-x']);
    expect(here()).toBe('/?v=nav:default,hooks:hook-x');
    // …and a pick in its group replaces it.
    tab.select(['hook-x', 'picker-a'], ['nav']);
    expect(here()).toBe('/?v=nav:picker-a,hooks:hook-x');
  });

  it('never writes a second pair for a group whose value it does not know', () => {
    const tab = store('/?v=nav:gone,solo');
    tab.select(['picker-a'], ['nav']);
    expect(here()).toBe('/?v=solo,nav:picker-a');
  });
});

describe('a hold to compare', () => {
  it('shows another set for a moment without touching the URL, the selection or the server', () => {
    const tab = store('/?v=nav:picker-a');
    const seen = vi.fn();
    tab.subscribe(seen);
    const replace = vi.spyOn(history, 'replaceState');
    const send = vi.fn();
    win.__isotoneFetch = send as unknown as typeof fetch;
    expect(tab.preview([])).toBe(true);
    expect(tab.shown).toEqual([]);
    expect(tab.active).toEqual(['picker-a']);
    expect(tab.explicit).toBe(true);
    expect(tab.preview(null)).toBe(true);
    expect(tab.shown).toEqual(['picker-a']);
    expect(seen).toHaveBeenCalledTimes(2);
    // Ending a preview that is not on notifies nobody.
    tab.preview(null);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(here()).toBe('/?v=nav:picker-a');
    expect(replace).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a set that needs a reload, and a pick ends the preview', () => {
    const tab = store('/?v=hooks:hook-x,nav:picker-a');
    tab.register('src/use-label.ts', [null, 'hook-x'], true);
    expect(tab.preview(['picker-a'])).toBe(false);
    expect(tab.shown).toEqual(['hook-x', 'picker-a']);
    expect(tab.preview(['hook-x'])).toBe(true);
    tab.select(['hook-x', 'picker-b']);
    expect(tab.shown).toEqual(['hook-x', 'picker-b']);
  });
});

describe('following the server', () => {
  it('ignores an unchanged set and reloads when a fixed export changes', () => {
    const reload = stubReload();
    delete win.__isotoneLive;
    const tab = liveStore(win, CONFIG);
    const seen = vi.fn();
    tab.subscribe(seen);
    tab.register('src/use-label.ts', [null, 'hook-x'], true);
    tab.follow([]);
    expect(seen).not.toHaveBeenCalled();
    tab.follow(['hook-x']);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    // While the page reloads, nothing else switches.
    tab.follow(['picker-a']);
    expect(tab.active).toEqual(['hook-x']);
    expect(tab.select(['picker-b'])).toBe(true);
    expect(tab.active).toEqual(['hook-x']);
  });

  it('stops notifying a listener that unsubscribed', () => {
    const tab = store('/');
    const seen = vi.fn();
    const off = tab.subscribe(seen);
    off();
    tab.select(['picker-a']);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('the SSR sync', () => {
  /** A fresh SSR page whose URL pins a fixed export the server did not render. */
  async function load(send: typeof fetch | undefined) {
    const reload = stubReload('?v=hooks:hook-x');
    if (send) win.__isotoneFetch = send;
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    delete win.__isotoneLive;
    liveStore(win, { ...CONFIG, ssr: true }).register('src/use-label.ts', [null, 'hook-x'], true);
    // The sync runs in a microtask and the reload after the fetch settles.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    return reload;
  }

  it('does not reload when the server refuses or cannot be reached', async () => {
    const refused = vi.fn(async () => new Response('{}', { status: 409 }));
    expect(await load(refused)).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(1);
    sessionStorage.clear();
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await load(offline)).not.toHaveBeenCalled();
    expect(offline).toHaveBeenCalledTimes(1);
  });

  it('uses the page’s own fetch when the panel has not installed one', async () => {
    const send = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', send);
    try {
      const reload = await load(undefined);
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith('/api/isotone/variants/active', expect.objectContaining({ method: 'POST' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays put without session storage, since it could not stop a loop', async () => {
    // The page's own storage class: Node 26 has a global Storage of its own that jsdom's window does not use.
    vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const send = vi.fn(async () => new Response('{}'));
    await load(send);
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a reload reported only by the legacy timing field as a reload', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    Object.defineProperty(performance, 'navigation', { configurable: true, value: { type: 1 } });
    try {
      const send = vi.fn(async () => new Response('{}'));
      await load(send);
      expect(send).not.toHaveBeenCalled();
    } finally {
      delete (performance as { navigation?: unknown }).navigation;
    }
  });

  it('treats unreadable navigation timing as a fresh load', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('unsupported');
    });
    const send = vi.fn(async () => new Response('{}'));
    await load(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('the binder', () => {
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
  });

  const bind = (tab: LiveStore, ids: (string | null)[], modules: Record<string, unknown>[], names: string[], react = React) =>
    liveBinder(react as unknown as Parameters<typeof liveBinder>[0], tab).file('src/Picker.tsx', ids, modules, names);

  it('switches class components and names a default export after it', () => {
    const tab = store('/');
    class Base extends React.Component {
      override render() {
        return createElement('b', null, 'class base');
      }
    }
    class Alt extends React.Component {
      override render() {
        return createElement('b', null, 'class a');
      }
    }
    const out = bind(tab, [null, 'picker-a'], [{ default: Base }, { default: Alt }], ['default']);
    expect((out.default as { displayName: string }).displayName).toBe('Base');
    act(() => root.render(createElement(out.default as React.FC)));
    expect(host.textContent).toBe('class base');
    act(() => {
      tab.select(['picker-a']);
    });
    expect(host.textContent).toBe('class a');
  });

  it('wraps components in forwardRef on React 18', () => {
    const forwardRef = vi.fn(React.forwardRef);
    const react18 = { ...React, version: '18.3.1', forwardRef };
    const out = bind(store('/'), [null, 'picker-a'], [{ Card: () => null }, { Card: () => null }], ['Card'], react18 as typeof React);
    expect(forwardRef).toHaveBeenCalledTimes(1);
    expect((out.Card as { displayName: string }).displayName).toBe('Card');
  });

  it('shows the first version of a file only variants add, and renders fixed values through the stand-in', () => {
    const tab = store('/');
    const Only = () => createElement('i', null, 'only');
    const out = bind(
      tab,
      ['picker-a', 'picker-b'],
      [
        { Only, size: 1 },
        { Only: () => null, size: 2 },
      ],
      ['Only', 'size'],
    );
    const render = (out as { __isotoneRender: (name: string, props: object) => unknown }).__isotoneRender;
    act(() => root.render(createElement(() => render('Only', {}) as React.ReactNode)));
    expect(host.textContent).toBe('only');
    expect(out.size).toBe(1);
    expect(render('size', {})).toBeNull();
  });
});

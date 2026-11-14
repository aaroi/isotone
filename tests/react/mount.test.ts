/**
 * The self-mount against a host that puts its own React root on `document`.
 *
 * react-dom dedupes delegated listeners with a marker on the container and,
 * for every non-document container, on the owner document as well. A root
 * created on the document afterwards sees that marker and skips attaching its
 * listeners, so `hydrateRoot(document, …)` in a host that loaded the panel
 * first (React Router 7's default entry.client) ended up with no working
 * onClick anywhere. Both cases below run before any timer fires, so the
 * panel's deferred render stays out of the picture: the bug is in
 * `createRoot` itself, not in what we render.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVariantsSource, mountIsotone } from '../../src/react/index';
import { serveMountOptions } from '../../src/serve/mount-config';

beforeEach(() => {
  // React's act() warns unless the environment declares itself.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Tear the panel down without ever rendering it: `off` before the mount
 *  timer fires makes the mount a no-op, and the unmount runs on its own timer. */
function dispose(off: () => void) {
  off();
  vi.runAllTimers();
}

/** A knob's value in the `:root` rule the panel writes (jsdom does not recompute styles for a CSSOM edit). */
const knobValue = (name: string) => {
  const sheet = document.querySelector<HTMLStyleElement>('style[data-isotone-knobs]')?.sheet;
  return sheet ? (sheet.cssRules[0] as CSSStyleRule).style.getPropertyValue(name) : '';
};

describe('mountIsotone next to a document-level host root', () => {
  it('leaves no react-dom marker on the document', () => {
    const before = Object.getOwnPropertyNames(document);
    const off = mountIsotone({ endpoint: '/api/isotone/notes' });
    expect(Object.getOwnPropertyNames(document)).toEqual(before);
    dispose(off);
  });

  it('a host root created on document afterwards still receives events', async () => {
    const off = mountIsotone({ endpoint: '/api/isotone/notes' });

    const onClick = vi.fn();
    const host = createRoot(document);
    await act(async () => {
      host.render(
        createElement(
          'html',
          null,
          createElement('head', null),
          createElement('body', null, createElement('button', { id: 'go', type: 'button', onClick }, 'go')),
        ),
      );
    });

    const button = document.getElementById('go');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    await act(async () => host.unmount());
    dispose(off);
  });

  it('re-attaches the host (shadow root and panel intact) when the body is replaced', async () => {
    const off = mountIsotone({ endpoint: '/api/isotone/notes' });
    // Let the deferred mount run and the observer take over.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const host = document.querySelector('[data-isotone="root"]');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();

    // A whole-document React app that fails hydration re-renders the body
    // from scratch, dropping any runtime host div the way our host is dropped.
    document.body.replaceChildren();
    // The MutationObserver delivers in a microtask; flush it.
    await act(async () => {});

    // The observer re-appends the SAME host; nothing was re-mounted, so the
    // shadow root survives instead of a duplicate host appearing.
    expect(document.body.contains(host)).toBe(true);
    expect(document.querySelectorAll('[data-isotone="root"]')).toHaveLength(1);
    expect(host?.shadowRoot).not.toBeNull();

    dispose(off);
  });
});

describe('mountIsotone and history', () => {
  it('restores pushState on unmount, but keeps a wrapper a router added after it', async () => {
    const original = window.history.pushState;
    const off = mountIsotone({ endpoint: '/api/isotone/notes' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const ours = window.history.pushState;
    expect(ours).not.toBe(original);
    const seen: unknown[] = [];
    const router = function (this: History, ...args: Parameters<History['pushState']>) {
      seen.push(args[2]);
      return ours.apply(this, args);
    };
    window.history.pushState = router;
    dispose(off);
    expect(window.history.pushState).toBe(router);
    window.history.pushState(null, '', '/after-unmount');
    expect(seen).toEqual(['/after-unmount']);
    expect(window.location.pathname).toBe('/after-unmount');
    window.history.pushState = original;

    const again = mountIsotone({ endpoint: '/api/isotone/notes' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(window.history.pushState).not.toBe(original);
    dispose(again);
    expect(window.history.pushState).toBe(original);
  });
});

describe('mountIsotone and route-scoped knobs', () => {
  it('moves knob values on and off <html> as the router navigates', async () => {
    vi.useRealTimers();
    const knob = { kind: 'color', id: 'header-border', label: 'Header border', defaultColor: '#e5e5e5', swatches: [], route: '/pricing' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).startsWith('/api/isotone/variants') ? { variants: [], active: [], knobs: [knob] } : []),
    }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('isotone:knobs', JSON.stringify({ 'header-border': '#f59e0b' }));
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    const shown = () => knobValue('--knob-header-border');
    window.history.pushState(null, '', '/');

    const off = mountIsotone({ endpoint: '/api/isotone/notes', variants: 'overlay' });
    try {
      await tick();
      await tick();
      // A full load of another route reads the listing and leaves the stored value off.
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/isotone/variants'))).toBe(true);
      expect(shown()).toBe('');

      window.history.pushState(null, '', '/pricing');
      await tick();
      expect(shown()).toBe('#f59e0b');

      window.history.pushState(null, '', '/');
      await tick();
      expect(shown()).toBe('');
      expect(JSON.parse(localStorage.getItem('isotone:knobs') ?? '{}')).toEqual({ 'header-border': '#f59e0b' });

      window.history.replaceState(null, '', '/pricing');
      await tick();
      expect(shown()).toBe('#f59e0b');
    } finally {
      off();
      await tick();
      document.querySelector('style[data-isotone-knobs]')?.remove();
      localStorage.removeItem('isotone:knobs');
      window.history.replaceState(null, '', '/');
      vi.unstubAllGlobals();
    }
  });
});

describe('mountIsotone with a cross-origin variants endpoint', () => {
  it('reads overlay knobs from the endpoint it is given, as isotone serve passes it', async () => {
    vi.useRealTimers();
    const knobsEndpoint = 'http://127.0.0.1:4123/api/isotone/variants';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith(knobsEndpoint)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: [],
            active: [],
            knobs: [{ kind: 'range', id: 'card-radius', label: 'Card radius', min: 0, max: 24, step: 1, defaultValue: 12, unit: 'px' }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

    const off = mountIsotone({
      endpoint: 'http://127.0.0.1:4123/api/isotone/notes',
      variants: 'overlay',
      variantsEndpoint: knobsEndpoint,
    });
    await tick();
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    await act(async () => {
      shadow.querySelector('.isotone-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await tick();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(knobsEndpoint);
    expect(urls.some((url) => url.startsWith('/api/isotone/variants'))).toBe(false);

    off();
    await tick();
    vi.unstubAllGlobals();
  });
});

describe('the panel isotone serve mounts', () => {
  const origin = 'http://127.0.0.1:4123';
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'iso-serve-mount-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  /** Mount what serve's bundle would mount for `root`, answering knobs with `knobs`. */
  async function mountServe(knobs: unknown[]) {
    vi.useRealTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () => (String(input).includes('/api/isotone/variants') ? { variants: [], active: [], knobs } : []),
      })),
    );
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    const off = mountIsotone(serveMountOptions(origin, root, {}));
    await tick();
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const tools = () => Array.from(shadow.querySelectorAll('.isotone-rail-button')).map((b) => b.getAttribute('aria-label'));
    return {
      shadow,
      tools,
      tick,
      off: async () => {
        off();
        await tick();
      },
    };
  }

  it('has a single tool, Feedback, when the project has no knobs', async () => {
    const panel = await mountServe([]);
    expect(panel.tools()).toEqual(['Feedback']);
    await panel.off();
  });

  it('adds Variants for knobs, and its empty list asks for knobs rather than file variants', async () => {
    // A knob for another page leaves this page's list empty.
    const knob = {
      kind: 'range',
      id: 'card-radius',
      label: 'Card radius',
      route: '/elsewhere',
      min: 0,
      max: 24,
      step: 1,
      defaultValue: 12,
      unit: 'px',
    };
    mkdirSync(join(root, '.isotone'));
    writeFileSync(join(root, '.isotone', 'knobs.json'), JSON.stringify([knob]));
    const panel = await mountServe([knob]);
    expect(panel.tools()).toEqual(['Variants', 'Feedback']);
    await act(async () => {
      panel.shadow.querySelector('[aria-label="Variants"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await panel.tick();
    const empty = panel.shadow.querySelector('.isotone-variants-panel .isotone-empty')?.textContent ?? '';
    expect(empty).toContain('No knobs on this page yet');
    expect(empty).toContain('.isotone/knobs.json');
    expect(empty).not.toContain('variants');
    await panel.off();
  });
});

describe('a host source beside the knobs of the server that answers notes', () => {
  const notesEndpoint = 'http://127.0.0.1:4123/api/isotone/notes';
  const knob = { kind: 'range', id: 'card-radius', label: 'Card radius', min: 0, max: 24, step: 1, defaultValue: 12, unit: 'px' };
  const axes = [
    {
      id: 'cta',
      label: 'Hero > Call to action',
      defaultOption: 'join',
      options: [
        { id: 'join', label: 'Join the waitlist' },
        { id: 'start', label: 'Get started' },
      ],
    },
  ];
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  /** Mount `options` with fetch answering knobs, a moved knob in storage, and the panel open on Variants. */
  async function mountWithKnobs(options: Parameters<typeof mountIsotone>[0], stored: Record<string, string> = { 'card-radius': '16' }) {
    vi.useRealTimers();
    localStorage.setItem('isotone:knobs', JSON.stringify(stored));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).includes('/api/isotone/variants') ? { variants: [], active: [], knobs: [knob] } : []),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    const off = mountIsotone(options);
    await tick();
    const shadow = Array.from(document.querySelectorAll('[data-isotone="root"]')).at(-1)?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const click = async (el: Element | null | undefined) => {
      await act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await tick();
    };
    await click(shadow.querySelector('.isotone-fab'));
    await click(shadow.querySelector('.isotone-rail-button[aria-label=Variants]'));
    const button = (text: string) => Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    const posted = () =>
      (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])
        .filter((c) => String(c[0]) === String(options.endpoint) && c[1]?.method === 'POST')
        .map((c) => JSON.parse(String(c[1]?.body)) as Record<string, unknown>)
        // The store retries a first post under its id; one request is one note.
        .filter((note, i, all) => all.findIndex((other) => other.feedback === note.feedback) === i);
    return {
      shadow,
      fetchMock,
      click,
      button,
      posted,
      tick,
      off: async () => {
        off();
        await tick();
      },
    };
  }

  it('lists both, compares both, and files every pick in one note', async () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes, onChange, compare: true });
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: source, getRoute: () => '/pricing' });
    // The knobs come from the same server as the notes.
    expect(panel.fetchMock.mock.calls.map((c) => String(c[0]))).toContain('http://127.0.0.1:4123/api/isotone/variants');
    // Unsectioned first, as the panel always orders them.
    expect(Array.from(panel.shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent)).toEqual([
      'Card radius',
      'Call to action',
    ]);
    expect(knobValue('--knob-card-radius')).toBe('16px');

    await panel.click(panel.button('Get started'));
    expect(onChange).toHaveBeenLastCalledWith({ cta: 'start' });
    // The bar appears for a host source with no saveDefaults of its own, with Compare in it.
    expect(panel.shadow.querySelector('.isotone-vars > .isotone-panel-head')?.getAttribute('data-shown')).toBe('true');
    expect(panel.button('Compare')).toBeDefined();
    expect(panel.shadow.querySelector('.isotone-save-count')?.textContent).toBe('2 picks changed');

    // The key under Escape shows both at their defaults, and puts both back.
    const key = (type: string) =>
      act(async () => {
        document.body.dispatchEvent(new KeyboardEvent(type, { code: 'Backquote', key: '`', bubbles: true, composed: true }));
      });
    await key('keydown');
    expect(onChange).toHaveBeenLastCalledWith({ cta: 'join' }, { preview: true });
    expect(knobValue('--knob-card-radius')).toBe('');
    await key('keyup');
    expect(onChange).toHaveBeenLastCalledWith({ cta: 'start' }, { preview: false });
    expect(knobValue('--knob-card-radius')).toBe('16px');

    await panel.click(panel.button('Make default'));
    expect(panel.posted()).toEqual([
      expect.objectContaining({
        route: '/pricing',
        feedback: '[set-defaults] App selectors: Hero › Call to action → Get started (cta). Knobs: Card radius 16px (card-radius).',
        payload: { variants: 'default', selectors: 'cta:start', knobs: 'card-radius:16' },
      }),
    ]);
    await panel.off();
  });

  it('applies stored knob values on load, before the panel opens', async () => {
    vi.useRealTimers();
    localStorage.setItem('isotone:knobs', JSON.stringify({ 'card-radius': '16' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () => (String(input).includes('/api/isotone/variants') ? { variants: [], active: [], knobs: [knob] } : []),
      })),
    );
    const off = mountIsotone({ endpoint: notesEndpoint, variants: createVariantsSource({ axes }) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(knobValue('--knob-card-radius')).toBe('16px');
    off();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('calls a host’s own saveDefaults and still names its picks, since the note replaces any it filed', async () => {
    const saveDefaults = vi.fn(async (_selections: Record<string, string>) => {});
    const source = createVariantsSource({ axes, selections: { cta: 'start' }, saveDefaults });
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: source });
    await panel.click(panel.button('Make default'));
    expect(saveDefaults).toHaveBeenCalledWith({ cta: 'start' });
    expect(panel.posted()).toEqual([
      expect.objectContaining({
        feedback: '[set-defaults] App selectors: Hero › Call to action → Get started (cta). Knobs: Card radius 16px (card-radius).',
        payload: { variants: 'default', selectors: 'cta:start', knobs: 'card-radius:16' },
      }),
    ]);
    await panel.off();
  });

  it('files no knob that a host selector of the same id hides, and leaves the host’s source with no listeners', async () => {
    const shadowed = createVariantsSource({ axes: [...axes, { ...knob, label: 'App radius', defaultValue: 8 }] as never });
    const subscribe = vi.spyOn(shadowed, 'subscribe');
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: shadowed });
    expect(Array.from(panel.shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent)).toEqual([
      'App radius',
      'Call to action',
    ]);
    await panel.click(panel.button('Make default'));
    expect(panel.posted().at(-1)?.feedback).toBe('[set-defaults] The current defaults stay on this route.');
    const offs = subscribe.mock.results.map((r) => r.value as () => void);
    expect(offs.length).toBeGreaterThan(0);
    await panel.off();
    // Every subscription the panel made through the wrapper is gone: a new one is the only listener.
    const listener = vi.fn();
    shadowed.subscribe(listener);
    shadowed.setSelection('cta', 'start');
    expect(listener).toHaveBeenCalledOnce();
  });

  // #62 leaves out a knob sharing a file group's id; beside a host source (#64), one sharing a host
  // selector's id is left out too, so its stored value no longer styles the page under the host's control.
  it('leaves out a knob whose id one of the host’s selectors has, and says so', async () => {
    const hostRadius = {
      id: 'card-radius',
      label: 'Card radius',
      defaultOption: 'soft',
      options: [
        { id: 'soft', label: 'Soft' },
        { id: 'sharp', label: 'Sharp' },
      ],
    };
    const source = createVariantsSource({ axes: [hostRadius], onChange: () => {} });
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: source, getRoute: () => '/' });
    expect(knobValue('--knob-card-radius')).toBe('');
    expect(Array.from(panel.shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent)).toEqual(['Card radius']);
    expect(panel.button('Sharp')).toBeDefined();
    expect(panel.shadow.querySelector('.isotone-vars-notice')?.textContent).toBe(
      'Left out of .isotone/knobs.json: card-radius, since one of the app’s own selectors has this id, so the panel shows only that selector. Give the knob its own id.',
    );
    // The stored value is kept, for when the knob gets an id of its own.
    expect(JSON.parse(localStorage.getItem('isotone:knobs') ?? '{}')).toEqual({ 'card-radius': '16' });
    await panel.off();
  });

  // 14be786 leaves out a knob whose id a host selector has; a host that loads its selectors after the
  // knobs applied takes the knob off <html> then, and gives it back when the selector goes.
  it('takes a knob off the page when a host selector with its id arrives later, and back when it goes', async () => {
    const source = createVariantsSource({ axes: [], onChange: () => {} });
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: source, getRoute: () => '/' });
    const radius = () => document.documentElement.style.getPropertyValue('--knob-card-radius');
    expect(radius()).toBe('16px');
    await act(async () => {
      source.setAxes([{ id: 'card-radius', label: 'Card radius', defaultOption: 'soft', options: [{ id: 'soft', label: 'Soft' }] }]);
    });
    expect(radius()).toBe('');
    await act(async () => {
      source.setAxes([]);
    });
    expect(radius()).toBe('16px');
    await panel.off();
    // Gone with the mount: a later change of the host's axes no longer reaches the knobs.
    source.setAxes([{ id: 'card-radius', label: 'Card radius', defaultOption: 'soft', options: [{ id: 'soft', label: 'Soft' }] }]);
    expect(radius()).toBe('16px');
  });

  it('reads no knobs beside a notes endpoint that is not an Isotone server, and still files the host’s picks', async () => {
    const source = createVariantsSource({ axes, selections: { cta: 'start' } });
    const panel = await mountWithKnobs({ endpoint: '/review/notes', variants: source });
    expect(panel.fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/isotone/variants'))).toBe(false);
    expect(Array.from(panel.shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent)).toEqual(['Call to action']);
    await panel.click(panel.button('Make default'));
    expect(panel.posted()).toEqual([
      expect.objectContaining({
        feedback: '[set-defaults] App selectors: Hero › Call to action → Get started (cta).',
        payload: { selectors: 'cta:start' },
      }),
    ]);
    await panel.off();
  });
});

// #60 (route-scoped knobs) with #64 (a host source beside knobs) and #62 (a knob sharing a
// file group's id is left out): the route hook reaches the overlay inside the combined source.
describe('route-scoped knobs beside a host source', () => {
  it('moves knob values on and off <html> as the router navigates, and never applies a knob a group shadows', async () => {
    vi.useRealTimers();
    const knobs = [
      { kind: 'color', id: 'header-border', label: 'Header border', defaultColor: '#e5e5e5', swatches: [], route: '/pricing' },
      // Same id as the file variant group below, so the group keeps it (#62).
      { kind: 'range', id: 'hero', label: 'Hero size', min: 0, max: 10, step: 1, defaultValue: 0, unit: 'px' },
    ];
    const variants = [
      { id: 'hero-left', label: 'Left', group: 'hero', files: {}, createdAt: '2026-01-01T00:00:00Z', stale: [], missing: [] },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).includes('/api/isotone/variants') ? { variants, active: [], knobs } : []),
    }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('isotone:knobs', JSON.stringify({ 'header-border': '#f59e0b', hero: '4' }));
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    const html = document.documentElement;
    const border = () => knobValue('--knob-header-border');
    const source = createVariantsSource({
      axes: [{ id: 'cta', label: 'Call to action', defaultOption: 'join', options: [{ id: 'join', label: 'Join' }] }],
      onChange: () => {},
    });
    window.history.pushState(null, '', '/');

    const off = mountIsotone({ endpoint: '/api/isotone/notes', variants: source });
    try {
      await tick();
      await tick();
      // Loaded at mount beside the host's source (#64), and off on another route (#60).
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/isotone/variants'))).toBe(true);
      expect(border()).toBe('');
      expect(knobValue('--knob-hero')).toBe('');

      window.history.pushState(null, '', '/pricing');
      await tick();
      expect(border()).toBe('#f59e0b');
      expect(knobValue('--knob-hero')).toBe('');

      window.history.pushState(null, '', '/');
      await tick();
      expect(border()).toBe('');
      expect(JSON.parse(localStorage.getItem('isotone:knobs') ?? '{}')).toMatchObject({ 'header-border': '#f59e0b' });
    } finally {
      off();
      await tick();
      html.removeAttribute('style');
      localStorage.removeItem('isotone:knobs');
      window.history.replaceState(null, '', '/');
      vi.unstubAllGlobals();
    }
  });
});

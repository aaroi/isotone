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
    expect(document.documentElement.style.getPropertyValue('--knob-card-radius')).toBe('16px');

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
    expect(document.documentElement.style.getPropertyValue('--knob-card-radius')).toBe('');
    await key('keyup');
    expect(onChange).toHaveBeenLastCalledWith({ cta: 'start' }, { preview: false });
    expect(document.documentElement.style.getPropertyValue('--knob-card-radius')).toBe('16px');

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

  it('lets a host that saves its own defaults save them, and files only the knobs', async () => {
    const saveDefaults = vi.fn(async (_selections: Record<string, string>) => {});
    const source = createVariantsSource({ axes, selections: { cta: 'start' }, saveDefaults });
    const panel = await mountWithKnobs({ endpoint: notesEndpoint, variants: source });
    await panel.click(panel.button('Make default'));
    expect(saveDefaults).toHaveBeenCalledWith({ cta: 'start' });
    expect(panel.posted()).toEqual([
      expect.objectContaining({
        feedback: '[set-defaults] Knobs: Card radius 16px (card-radius).',
        payload: { variants: 'default', knobs: 'card-radius:16' },
      }),
    ]);

    // With no knob moved, the host's own request is the only one.
    await panel.off();
    saveDefaults.mockClear();
    const quiet = await mountWithKnobs({ endpoint: notesEndpoint, variants: source }, {});
    expect(quiet.shadow.querySelector('.isotone-save-count')?.textContent).toBe('1 pick changed');
    // Only what this click posts: the store may still resend the earlier panel's note.
    const before = quiet.posted().length;
    await quiet.click(quiet.button('Make default'));
    expect(saveDefaults).toHaveBeenCalledWith({ cta: 'start' });
    expect(
      quiet
        .posted()
        .slice(before)
        .filter((note) => note.id === null),
    ).toEqual([]);
    await quiet.off();
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

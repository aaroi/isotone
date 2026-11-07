// @vitest-environment jsdom
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

import { mountIteration } from '../src/react/index';
import { serveMountOptions } from '../src/serve/mount-config';

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

describe('mountIteration next to a document-level host root', () => {
  it('leaves no react-dom marker on the document', () => {
    const before = Object.getOwnPropertyNames(document);
    const off = mountIteration({ endpoint: '/api/iteration/notes' });
    expect(Object.getOwnPropertyNames(document)).toEqual(before);
    dispose(off);
  });

  it('a host root created on document afterwards still receives events', async () => {
    const off = mountIteration({ endpoint: '/api/iteration/notes' });

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
    const off = mountIteration({ endpoint: '/api/iteration/notes' });
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

describe('mountIteration with a cross-origin variants endpoint', () => {
  it('reads overlay knobs from the endpoint it is given, as isotone serve passes it', async () => {
    vi.useRealTimers();
    const knobsEndpoint = 'http://127.0.0.1:4123/api/iteration/variants';
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
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const off = mountIteration({
      endpoint: 'http://127.0.0.1:4123/api/iteration/notes',
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
    expect(urls.some((url) => url.startsWith('/api/iteration/variants'))).toBe(false);

    off();
    await tick();
    vi.unstubAllGlobals();
  });
});

describe('the panel isotone serve mounts', () => {
  const origin = 'http://127.0.0.1:4123';
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'iso-serve-mount-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  /** Mount what serve's bundle would mount for `root`, answering knobs with `knobs`. */
  async function mountServe(knobs: unknown[]) {
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).includes('/api/iteration/variants') ? { variants: [], active: [], knobs } : []),
    })));
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const off = mountIteration(serveMountOptions(origin, root, {}));
    await tick();
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const tools = () => Array.from(shadow.querySelectorAll('.isotone-rail-button')).map((b) => b.getAttribute('aria-label'));
    return { shadow, tools, tick, off: async () => { off(); await tick(); } };
  }

  it('has a single tool, Feedback, when the project has no knobs', async () => {
    const panel = await mountServe([]);
    expect(panel.tools()).toEqual(['Feedback']);
    await panel.off();
  });

  it('adds Variants for knobs, and its empty list asks for knobs rather than file variants', async () => {
    // A knob for another page leaves this page's list empty.
    const knob = { kind: 'range', id: 'card-radius', label: 'Card radius', route: '/elsewhere', min: 0, max: 24, step: 1, defaultValue: 12, unit: 'px' };
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

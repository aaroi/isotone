// @vitest-environment jsdom
/**
 * The variants surface: the view on its own, and the panel deciding between
 * a Variants / Notes tab bar, variants only, or nothing at all.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VariantAxis } from '../src/core/variants';
import {
  createVariantsSource,
  IterationPanel,
  mountIteration,
  VariantsView,
} from '../src/react/index';

const AXES: VariantAxis[] = [
  {
    id: 'headline',
    label: 'Headline',
    options: [
      { id: 'a', label: 'Plain' },
      { id: 'b', label: 'Bold', hint: 'Heavier weight' },
    ],
    defaultOption: 'a',
  },
  {
    kind: 'range',
    id: 'haze',
    label: 'Haze',
    min: 0,
    max: 1,
    step: 0.1,
    defaultValue: 0.3,
    section: 'motion',
  },
  {
    id: 'tagline',
    label: 'Tagline',
    options: [
      { id: 'x', label: 'Short' },
      { id: 'y', label: 'Long' },
    ],
    defaultOption: 'x',
    showWhen: { axis: 'headline', equals: 'b' },
  },
];

let container: HTMLDivElement;
let root: Root | null = null;

/**
 * Node 25 ships its own `localStorage` global that is unusable without a
 * `--localstorage-file` flag, and vitest's jsdom environment leaves that one
 * in place, so the panel's guarded reads silently fail. A Map-backed Storage
 * lets the tab-memory test observe what the panel writes.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.stubGlobal('localStorage', memoryStorage());
  // The panel lists notes on open; answer with an empty file so the notes
  // path stays quiet and the tests exercise only the variants wiring.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(async () => {
  if (root) {
    const r = root;
    root = null;
    await act(async () => r.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(element: React.ReactElement) {
  root = createRoot(container);
  const r = root;
  await act(async () => r.render(element));
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A control by its own text (not an inline svg's `<title>`) or aria-label. */
function byText(text: string, selector = 'button'): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).find((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .trim();
    return own === text || el.getAttribute('aria-label') === text;
  });
}

function labels(): string[] {
  return Array.from(container.querySelectorAll('.iso-iter-axis-label')).map(
    (el) => el.textContent ?? '',
  );
}

describe('VariantsView', () => {
  it('renders the visible axes and hides the conditional one at default', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));

    expect(labels()).toEqual(['Headline', 'Haze']);
    expect(container.querySelector('.iso-iter-hairline')).not.toBeNull();
    expect(container.querySelector('.iso-iter-range')).not.toBeNull();
    expect(container.querySelector('.iso-iter-axis-value')?.textContent).toBe('30%');
    expect(byText('Revert')).toBeUndefined();
    expect(byText('Bold')?.getAttribute('title')).toBe('Heavier weight');
  });

  it('a segment click selects, reveals the conditional axis, and Revert undoes it', async () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes: AXES, onChange });
    await render(createElement(VariantsView, { source }));

    await click(byText('Bold'));
    expect(source.getSelections().headline).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ headline: 'b' }));
    expect(byText('Bold')?.classList.contains('iso-iter-seg-on')).toBe(true);
    expect(labels()).toEqual(['Headline', 'Haze', 'Tagline']);

    await click(byText('Revert'));
    expect(source.getSelections().headline).toBe('a');
    expect(labels()).toEqual(['Headline', 'Haze']);
    expect(byText('Revert')).toBeUndefined();
  });

  it('the range input writes back through the source', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));

    const range = container.querySelector<HTMLInputElement>('.iso-iter-range');
    if (!range) throw new Error('no range');
    // Through the prototype setter: React's value tracker wraps the instance
    // property, and a plain assignment would leave it thinking nothing changed.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      set?.call(range, '0.7');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(source.getSelections().haze).toBe('0.7');
    expect(container.querySelector('.iso-iter-axis-value')?.textContent).toBe('70%');
  });

  it('Save as defaults hands the selections to the source and reports back', async () => {
    const saveDefaults = vi.fn(async () => {});
    const source = createVariantsSource({ axes: AXES, saveDefaults });
    await render(createElement(VariantsView, { source }));
    await click(byText('Bold'));

    await click(byText('Save as defaults'));
    expect(saveDefaults).toHaveBeenCalledTimes(1);
    expect(saveDefaults).toHaveBeenCalledWith({ headline: 'b', haze: '0.3', tagline: 'x' });
    expect(container.querySelector('.iso-iter-save-state')?.textContent).toBe(
      'Saved for the agent',
    );
  });

  it('a failed save says so', async () => {
    const source = createVariantsSource({
      axes: AXES,
      saveDefaults: async () => {
        throw new Error('nope');
      },
    });
    await render(createElement(VariantsView, { source }));
    await click(byText('Save as defaults'));
    expect(container.querySelector('.iso-iter-save-state')?.textContent).toBe("Couldn't save");
  });

  it('omits the save row when the source cannot save', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    expect(byText('Save as defaults')).toBeUndefined();
  });

  it('calls refresh() once on mount when the source has one', async () => {
    const refresh = vi.fn(async () => {});
    const source = Object.assign(createVariantsSource({ axes: AXES }), { refresh });
    await render(createElement(VariantsView, { source }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders a thumbnail grid when every option has an image', async () => {
    const source = createVariantsSource({
      axes: [
        {
          id: 'hero',
          label: 'Hero',
          options: [
            { id: 'a', label: 'Left', image: 'data:,a' },
            { id: 'b', label: 'Right', image: 'data:,b' },
          ],
          defaultOption: 'a',
        },
      ],
    });
    await render(createElement(VariantsView, { source }));
    expect(container.querySelectorAll('.iso-iter-grid .iso-iter-thumb')).toHaveLength(2);
    expect(container.querySelector('.iso-iter-thumb-on')?.textContent).toBe('Left');
    expect(container.querySelector('.iso-iter-segs')).toBeNull();
  });

  it('renders colour swatches and the custom picker', async () => {
    const source = createVariantsSource({
      axes: [
        {
          kind: 'color',
          id: 'accent',
          label: 'Accent',
          defaultColor: '#ea382e',
          swatches: [
            { id: 'red', label: 'Red', value: '#ea382e' },
            { id: 'blue', label: 'Blue', value: '#3b82f6' },
          ],
        },
      ],
    });
    await render(createElement(VariantsView, { source }));
    expect(container.querySelectorAll('.iso-iter-swatch')).toHaveLength(2);
    expect(container.querySelector('.iso-iter-swatch-on')?.getAttribute('aria-label')).toBe('Red');
    expect(container.querySelector('.iso-iter-picker input[type=color]')).not.toBeNull();
    expect(container.querySelector('.iso-iter-axis-hex')?.textContent).toBe('#ea382e');

    await click(byText('Blue'));
    expect(source.getSelections().accent).toBe('#3b82f6');
    expect(container.querySelector('.iso-iter-swatch-on')?.getAttribute('aria-label')).toBe('Blue');
  });
});

describe('IterationPanel with variants', () => {
  const fab = () => container.querySelector<HTMLButtonElement>('.iso-iter-fab');
  const tabs = () => container.querySelectorAll('[role=tab]');

  it('without an endpoint it is variants only: no tabs, no composer', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    await click(fab());

    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.iso-iter-vars')).not.toBeNull();
    expect(container.querySelector('.iso-iter-textarea')).toBeNull();
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe(
      'Iteration variants',
    );
  });

  it('with both, tabs switch and the choice is remembered per key', async () => {
    const source = createVariantsSource({ axes: AXES });
    const props = {
      route: '/',
      store: { endpoint: '/api/iteration/notes', key: 'app' },
      variants: source,
    };
    await render(createElement(IterationPanel, props));
    await click(fab());

    expect(tabs()).toHaveLength(2);
    // Notes is the default when it is available.
    expect(container.querySelector('.iso-iter-textarea')).not.toBeNull();
    expect(container.querySelector('.iso-iter-vars')).toBeNull();

    await click(byText('Variants', '[role=tab]'));
    expect(container.querySelector('.iso-iter-vars')).not.toBeNull();
    expect(container.querySelector('.iso-iter-textarea')).toBeNull();
    expect(byText('Variants', '[role=tab]')?.getAttribute('aria-selected')).toBe('true');
    expect(window.localStorage.getItem('app::tab')).toBe('variants');

    // A fresh mount under the same key opens on the remembered tab.
    const r = root;
    root = null;
    if (r) await act(async () => r.unmount());
    await render(createElement(IterationPanel, props));
    await click(fab());
    expect(container.querySelector('.iso-iter-vars')).not.toBeNull();
  });

  it('with an endpoint but no axes it is the notes panel as before', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(
      createElement(IterationPanel, {
        route: '/',
        store: { endpoint: '/api/iteration/notes' },
        variants: source,
      }),
    );
    await click(fab());
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.iso-iter-textarea')).not.toBeNull();
    expect(container.querySelector('.iso-iter-vars')).toBeNull();
  });

  it('with neither notes nor axes it renders nothing', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    expect(fab()).toBeNull();
  });

  it('refreshes the source at mount and once per open, and the tab bar appears once axes arrive', async () => {
    // Like the overlay adapter: no axes until refresh() has listed them.
    const inner = createVariantsSource({ axes: [] });
    const refresh = vi.fn(async () => inner.setAxes(AXES));
    const source = Object.assign(inner, { refresh });
    await render(
      createElement(IterationPanel, {
        route: '/',
        store: { endpoint: '/api/iteration/notes' },
        variants: source,
      }),
    );
    // Once at mount, because the source had nothing to show yet.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tabs()).toHaveLength(0);

    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(tabs()).toHaveLength(2);

    await click(fab());
    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('with no endpoint, a source that only has axes after refresh still gets a launcher', async () => {
    // `mountIteration({ variants: 'overlay' })` with no notes endpoint: the
    // panel had nothing to render until the listing arrived, and nothing to
    // trigger the listing but an open, so the launcher never appeared.
    const inner = createVariantsSource({ axes: [] });
    let deliver: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((done) => {
          deliver = () => {
            inner.setAxes(AXES);
            done();
          };
        }),
    );
    const source = Object.assign(inner, { refresh });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fab()).toBeNull();

    await act(async () => deliver());
    expect(fab()).not.toBeNull();
    // Not asked again once it has something to show.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh at mount when the source already has axes', async () => {
    const refresh = vi.fn(async () => {});
    const source = Object.assign(createVariantsSource({ axes: AXES }), { refresh });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('panel refinements for variants-only hosts', () => {
  it('opens on the Variants tab when the host asks, until the reviewer picks', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(
      createElement(IterationPanel, {
        route: '/',
        store: { endpoint: '/api/iteration/notes', key: 'preview' },
        variants: source,
        defaultTab: 'variants',
      }),
    );
    await click(container.querySelector('.iso-iter-fab'));
    expect(container.querySelector('.iso-iter-vars')).not.toBeNull();
    expect(container.querySelector('.iso-iter-textarea')).toBeNull();
  });

  it('labels a variants-only launcher as Variants, with the sliders glyph', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    const button = container.querySelector('.iso-iter-fab');
    expect(button?.getAttribute('aria-label')).toBe('Variants');
    expect(button?.querySelector('title')?.textContent).toBe('Variants');
  });
});

describe('mountIteration variants options', () => {
  beforeEach(() => vi.useFakeTimers());

  it('mounts nothing without an endpoint or a source', () => {
    const off = mountIteration({});
    expect(document.querySelector('[data-iso-iterate="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts nothing for a variants-only source with no axes and no refresh', () => {
    const off = mountIteration({ variants: createVariantsSource({ axes: [] }) });
    expect(document.querySelector('[data-iso-iterate="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts with only a variants source', () => {
    const off = mountIteration({ variants: createVariantsSource({ axes: AXES }) });
    expect(document.querySelector('[data-iso-iterate="root"]')).not.toBeNull();
    off();
    vi.runAllTimers();
    expect(document.querySelector('[data-iso-iterate="root"]')).toBeNull();
  });

  it("'overlay' lists from the variants endpoint on open", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/iteration/variants')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: [
              {
                id: 'bolder',
                label: 'Bolder',
                createdAt: '2026-09-01T00:00:00.000Z',
                files: {},
                stale: [],
                missing: [],
              },
            ],
            active: [],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);

    const off = mountIteration({ endpoint: '/api/iteration/notes', variants: 'overlay' });
    // The mount renders one macrotask later.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const shadow = document.querySelector('[data-iso-iterate="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    await act(async () => {
      shadow.querySelector('.iso-iter-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Let the listing resolve and the panel re-render with the new axis.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/iteration/variants');
    expect(shadow.querySelectorAll('[role=tab]')).toHaveLength(2);

    // Save as defaults on an overlay host files a [set-defaults] note naming
    // the pick, since landing the files is the agent's move.
    await act(async () => {
      shadow
        .querySelector('[role=tab]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const save = Array.from(shadow.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save as defaults',
    );
    expect(save).toBeDefined();
    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    const posted = calls.find(
      (c) => String(c[0]) === '/api/iteration/notes' && c[1]?.method === 'POST',
    );
    expect(posted).toBeDefined();
    const body = JSON.parse(String(posted?.[1]?.body));
    expect(body.feedback).toBe('[set-defaults] The current defaults stay on this route.');
    expect(body.payload).toEqual({ variants: 'default' });

    off();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("'overlay' renders one selector per group and posts the whole active set", async () => {
    vi.useRealTimers();
    // Two decisions on this route: a table style (two variants over one file,
    // grouped by that overlap) and a settings layout (grouped by name), plus
    // one made for another route that must not show.
    const at = '2026-09-01T00:00:00.000Z';
    let active: string[] = ['table-dense'];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/iteration/variants/active' && init?.method === 'POST') {
        active = JSON.parse(String(init.body)).active;
        return { ok: true, status: 200, json: async () => ({ active }) };
      }
      if (url.startsWith('/api/iteration/variants')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: [
              {
                id: 'table-dense',
                label: 'Dense rows',
                route: '/projects',
                element: { tag: 'table', text: '', selector: 'table' },
                createdAt: at,
                files: { 'src/table.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'table-striped',
                label: 'Striped',
                route: '/projects',
                createdAt: at,
                files: { 'src/table.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'settings-tabs',
                label: 'Tabs',
                group: 'settings',
                groupLabel: 'Settings',
                createdAt: at,
                files: { 'src/Settings.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'home-hero',
                label: 'Hero',
                route: '/',
                createdAt: at,
                files: { 'src/Hero.tsx': { base: null } },
                stale: [],
                missing: [],
              },
            ],
            active,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);

    const off = mountIteration({
      endpoint: '/api/iteration/notes',
      variants: 'overlay',
      getRoute: () => '/projects',
    });
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    await tick();
    const shadow = document.querySelector('[data-iso-iterate="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const clickIn = (el: Element | null | undefined) =>
      act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
    const button = (text: string) =>
      Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

    await clickIn(shadow.querySelector('.iso-iter-fab'));
    await tick();
    await clickIn(shadow.querySelector('[role=tab]'));
    const axisLabels = () =>
      Array.from(shadow.querySelectorAll('.iso-iter-axis-label')).map((el) => el.textContent);
    expect(axisLabels()).toEqual(['table.tsx', 'Settings']);
    expect(button('Dense rows')?.classList.contains('iso-iter-seg-on')).toBe(true);
    expect(button('Hero')).toBeUndefined();

    // Picking in one selector keeps the other's pick and posts both.
    await clickIn(button('Tabs'));
    const posts = () =>
      (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])
        .filter((c) => String(c[0]) === '/api/iteration/variants/active')
        .map((c) => JSON.parse(String(c[1]?.body)));
    expect(posts().at(-1)).toEqual({ active: ['table-dense', 'settings-tabs'] });
    await tick();
    expect(button('Tabs')?.classList.contains('iso-iter-seg-on')).toBe(true);
    expect(button('Dense rows')?.classList.contains('iso-iter-seg-on')).toBe(true);

    // A sibling replaces only its own group's member.
    await clickIn(button('Striped'));
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs', 'table-striped'] });

    // Save as defaults names every pick, in panel order, and pins the first.
    await clickIn(button('Save as defaults'));
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    const note = calls.find(
      (c) => String(c[0]) === '/api/iteration/notes' && c[1]?.method === 'POST',
    );
    const body = JSON.parse(String(note?.[1]?.body));
    expect(body.feedback).toBe(
      '[set-defaults] Make the default: "table.tsx: Striped" (table-striped); "Settings: Tabs" (settings-tabs).',
    );
    expect(body.payload).toEqual({ variants: 'table-striped, settings-tabs' });
    expect(body.route).toBe('/projects');

    // Default in one selector drops that group and leaves the other.
    const defaults = Array.from(shadow.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Default',
    );
    await clickIn(defaults[0]);
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs'] });

    off();
    await tick();
  });
});

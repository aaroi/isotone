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
  document.body.style.backgroundColor = '';
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
    return own === text || el.textContent?.trim() === text || el.getAttribute('aria-label') === text;
  });
}

function labels(): string[] {
  return Array.from(container.querySelectorAll('.iso-iter-axis-label')).map(
    (el) => el.textContent ?? '',
  );
}

describe('VariantsView', () => {
  it('names selector groups, announces formatted values, and surfaces activation errors', async () => {
    const base = createVariantsSource({ axes: AXES });
    let message: string | null = 'Could not activate this variant';
    const source = { ...base, getError: () => message };
    await render(createElement(VariantsView, { source }));
    expect(container.querySelector('fieldset')?.getAttribute('aria-label')).toBe('Headline');
    expect(container.querySelector('input[type=range]')?.getAttribute('aria-valuetext')).toBe('30%');
    expect(container.querySelector('[role=alert]')?.textContent).toBe(message);
    message = null;
    await click(byText('Bold'));
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it('updates an open menu when its source removes an option', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    await click(byText('Headline actions'));
    await act(async () => { await source.manage?.({ action: 'remove-axis', axisId: 'headline' }); });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.querySelector('.iso-iter-vars-body')?.hasAttribute('inert')).toBe(false);
  });

  it('renders a large selector set without truncating the available choices', async () => {
    const axes: VariantAxis[] = Array.from({ length: 500 }, (_, i) => ({
      id: `axis-${i}`, label: `Selector ${i} ${'long label '.repeat(20)}`,
      defaultOption: 'a', options: [{ id: 'a', label: 'Default' }, { id: 'b', label: 'Alternative' }],
    }));
    const source = createVariantsSource({ axes });
    await render(createElement(VariantsView, { source }));
    expect(container.querySelectorAll('.iso-iter-axis')).toHaveLength(500);
    const last = container.querySelectorAll<HTMLButtonElement>('.iso-iter-seg')[999];
    await click(last);
    expect(source.getSelections()['axis-499']).toBe('b');
    expect(last.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the visible axes and hides the conditional one at default', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));

    expect(labels()).toEqual(['Headline', 'Haze']);
    expect(container.querySelector('.iso-iter-hairline')).toBeNull();
    expect(container.querySelector('.iso-iter-range')).not.toBeNull();
    expect(container.querySelector('.iso-iter-axis-value')?.textContent).toBe('30%');
    expect(byText('Revert')).toBeUndefined();
    expect(byText('Bold')?.getAttribute('title')).toBeNull();
  });

  it('a segment reveals dependent controls and its own action menu resets it', async () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes: AXES, onChange });
    await render(createElement(VariantsView, { source }));

    await click(byText('Bold'));
    expect(source.getSelections().headline).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ headline: 'b' }));
    expect(byText('Bold')?.classList.contains('iso-iter-seg-on')).toBe(true);
    expect(labels()).toEqual(['Headline', 'Haze', 'Tagline']);

    await click(byText('Headline actions'));
    await click(byText('Reset to default'));
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

  it('shows Save only while visible choices differ from defaults', async () => {
    const source = createVariantsSource({ axes: AXES, saveDefaults: async () => {} });
    await render(createElement(VariantsView, { source }));
    expect(byText('Save as defaults')).toBeUndefined();
    await click(byText('Bold'));
    expect(byText('Save as defaults')).toBeDefined();
    await click(byText('Plain'));
    expect(byText('Save as defaults')).toBeUndefined();
    await act(async () => source.setSelection('tagline', 'y'));
    expect(byText('Save as defaults')).toBeUndefined();
  });

  it('a failed save says so', async () => {
    const source = createVariantsSource({
      axes: AXES,
      saveDefaults: async () => {
        throw new Error('nope');
      },
    });
    await render(createElement(VariantsView, { source }));
    await click(byText('Bold'));
    await click(byText('Save as defaults'));
    expect(container.querySelector('.iso-iter-save-state')?.textContent).toBe('Could not save. Try again.');
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
    expect(container.querySelector('.iso-iter-thumb[aria-pressed=true]')?.textContent).toBe('Left');
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
    expect(container.querySelector('.iso-iter-swatch[aria-pressed=true]')?.getAttribute('aria-label')).toBe('Red');
    expect(container.querySelector('.iso-iter-picker input[type=color]')).not.toBeNull();
    expect(container.querySelector('.iso-iter-axis-value')?.textContent).toBe('#EA382E');

    await click(byText('Blue'));
    expect(source.getSelections().accent).toBe('#3b82f6');
    expect(container.querySelector('.iso-iter-swatch[aria-pressed=true]')?.getAttribute('aria-label')).toBe('Blue');
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

  it('opens both surfaces independently and keeps the draft while switching variants', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/api/iteration/notes' }, variants: source }));
    await click(fab());
    await click(byText('Variants'));
    expect(container.querySelectorAll('.iso-iter-panel[data-open=true]')).toHaveLength(2);
    expect(tabs()).toHaveLength(0);
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('missing composer');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => { setter?.call(textarea, 'Try another direction'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(byText('Bold'));
    expect(textarea.value).toBe('Try another direction');
    await click(byText('Close variants'));
    expect(container.querySelector('.iso-iter-notes-panel')?.getAttribute('data-open')).toBe('true');
    expect(textarea.value).toBe('Try another direction');
  });

  it('grows the composer with text and shrinks after clearing it', async () => {
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/api/iteration/notes' } }));
    await click(fab());
    const field = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!field) throw new Error('missing composer');
    expect(field.style.height).toBe('24px');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, get: () => field.value.split('\n').length * 20 + 4 });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const type = async (value: string) => act(async () => {
      setter?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('One\nTwo\nThree');
    expect(field.style.height).toBe('64px');
    await type('');
    expect(field.style.height).toBe('24px');
  });

  it('remeasures the scroll-through inset when context changes without changing the text', async () => {
    const feedback = 'One\nTwo';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{
      id: 'existing', feedback, route: '/', element: null, done: false, createdAt: '2026-01-01T00:00:00.000Z',
    }] })));
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(fab());
    const field = container.querySelector('textarea');
    if (!field) throw new Error('missing composer');
    Object.defineProperty(field, 'scrollHeight', {
      configurable: true,
      get: () => field.value.split('\n').length * 20 + (field.previousElementSibling?.childElementCount ? 12 : 14),
    });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => { setter?.call(field, feedback); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(field.style.height).toBe('54px');
    await click(container.querySelector('.iso-iter-note-hit'));
    expect(field.value).toBe(feedback);
    expect(field.style.height).toBe('52px');
  });

  it('keeps overflow labels hit-testable and adds titles only while truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{
      id: 'existing', feedback: 'Review this section', route: '/', done: false, createdAt: '2026-01-01T00:00:00.000Z',
      element: { selector: '#section', tag: 'section', text: 'A long pinned section label', rect: { x: 0, y: 0, width: 100, height: 100 } },
    }] })));
    await render(createElement(IterationPanel, { route: '/', variants: createVariantsSource({ axes: AXES }), store: { endpoint: '/notes' } }));
    await click(fab());
    await click(byText('Variants'));
    const labels = Array.from(container.querySelectorAll<HTMLElement>('.iso-iter-axis-label > span, .iso-iter-seg > span, .iso-iter-meta .iso-iter-chip > span'));
    expect(labels.length).toBeGreaterThan(3);
    expect(container.querySelector('.iso-iter-meta .iso-iter-chip > span')).not.toBeNull();
    for (const label of labels) {
      expect(getComputedStyle(label).pointerEvents).not.toBe('none');
      let availableWidth = 60;
      Object.defineProperties(label, {
        scrollWidth: { configurable: true, value: 120 },
        clientWidth: { configurable: true, get: () => availableWidth },
      });
      await act(async () => { label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); });
      expect(label.title).toBe(label.textContent?.trim());
      availableWidth = 160;
      await act(async () => { label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); });
      expect(label.hasAttribute('title')).toBe(false);
    }
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
    expect(container.querySelector('.iso-iter-variants-panel')?.getAttribute('data-open')).toBe('false');
  });

  it('with neither notes nor axes it renders nothing', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    expect(fab()).toBeNull();
  });

  it('refreshes remote axes on mount and reopen', async () => {
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
    expect(container.querySelectorAll('.iso-iter-rail-button')).toHaveLength(2);

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
  it('initially opens variants when requested, with feedback still available', async () => {
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
    expect(container.querySelector('.iso-iter-notes-panel')?.hasAttribute('inert')).toBe(true);
  });

  it('labels a variants-only launcher as Variants, with an icon', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IterationPanel, { route: '/', store: {}, variants: source }));
    const button = container.querySelector('.iso-iter-fab');
    expect(button?.getAttribute('aria-label')).toBe('Variants');
    expect(button?.querySelector('svg')).not.toBeNull();
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
    expect(shadow.querySelectorAll('.iso-iter-rail-button')).toHaveLength(2);

    // An untouched overlay has nothing to promote; the save action stays hidden.
    await act(async () => {
      shadow.querySelector('.iso-iter-rail-button[aria-label=Variants]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(shadow.querySelector('.iso-iter-save')).toBeNull();

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
    await clickIn(shadow.querySelector('.iso-iter-rail-button[aria-label=Variants]'));
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

describe('review dock interactions', () => {
  it.each(['mouse', 'pen'])('expands on %s hover, stays open across the pill and collapses on exit', async pointerType => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' }, variants: createVariantsSource({ axes: AXES }) }));
    const dock = container.querySelector('.iso-iter-root');
    const launcher = container.querySelector('.iso-iter-fab');
    const track = container.querySelector('.iso-iter-rail-track');
    const feedback = container.querySelector('.iso-iter-rail-button[aria-label="Feedback"]');
    async function pointer(type: string, target: Element | null, relatedTarget: EventTarget | null, device = pointerType) {
      const event = new MouseEvent(type, { bubbles: true, relatedTarget });
      Object.defineProperty(event, 'pointerType', { value: device });
      await act(async () => { target?.dispatchEvent(event); });
    }
    await pointer('pointerenter', dock, null, 'touch');
    expect(dock?.getAttribute('data-expanded')).toBe('false');
    await pointer('pointerleave', dock, document.body, 'touch');
    await pointer('pointerenter', dock, null);
    expect(dock?.getAttribute('data-expanded')).toBe('true');
    expect(dock?.getAttribute('data-open')).toBe('false');
    expect(launcher?.getAttribute('aria-hidden')).toBe('true');
    // Moving through the rim/gap to an icon must not collapse the hover target.
    await pointer('pointerout', launcher, track);
    await pointer('pointerover', track, launcher);
    await pointer('pointerout', track, feedback);
    await pointer('pointerover', feedback, track);
    expect(dock?.getAttribute('data-expanded')).toBe('true');
    await pointer('pointerleave', dock, document.body);
    expect(dock?.getAttribute('data-expanded')).toBe('false');
    // Touch/click remains usable without hover capability.
    await click(launcher);
    expect(dock?.getAttribute('data-open')).toBe('true');
  });

  it('replaces the launcher with two tools and collapses after both surfaces close', async () => {
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' }, variants: createVariantsSource({ axes: AXES }), defaultTab: 'variants' }));
    const rail = container.querySelector('.iso-iter-rail');
    const launcher = container.querySelector('.iso-iter-fab');
    expect(rail?.getAttribute('data-expanded')).toBe('false');
    await click(launcher); await click(byText('Feedback'));
    expect(launcher?.getAttribute('aria-hidden')).toBe('true');
    expect(launcher?.getAttribute('tabindex')).toBe('-1');
    expect(rail?.getAttribute('data-tools')).toBe('2');
    await click(byText('Close variants')); await click(byText('Close feedback'));
    expect(rail?.getAttribute('data-expanded')).toBe('false');
    expect(launcher?.getAttribute('aria-hidden')).toBe('false');
  });

  it('keeps selectors usable while removal requests are read, edited and cancelled', async () => {
    let saved: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = [{ ...JSON.parse(String(init.body)), id: 'removal', done: false, createdAt: new Date().toISOString() }];
        return { ok: true, json: async () => ({ id: 'removal' }) };
      }
      if (init?.method === 'DELETE') saved = [];
      return { ok: true, json: async () => saved };
    });
    vi.stubGlobal('fetch', fetchMock);
    const source = createVariantsSource({ axes: AXES });
    source.setSelection('headline', 'b');
    const manage = vi.spyOn(source, 'manage');
    const props = { route: '/', store: { endpoint: '/notes' }, variants: source, defaultTab: 'variants' as const };
    await render(createElement(IterationPanel, props));
    await click(container.querySelector('.iso-iter-fab'));
    await click(byText('Headline actions')); await click(byText('Remove Bold'));
    expect(saved[0].variantAction).toEqual({ axisId: 'headline', action: 'remove-option', optionId: 'b' });
    expect(manage).not.toHaveBeenCalled();
    expect(labels()).toEqual(['Headline', 'Haze', 'Tagline']);
    expect(byText('Cancel removal')).toBeDefined();
    await click(container.querySelector('.iso-iter-note-hit'));
    expect(container.querySelector('textarea')?.value).toContain('Remove “Bold”');
    await typeFeedback('Remove this option after checking the alternative layout.');
    await click(byText('Save edit'));
    expect(saved[0].variantAction).toEqual({ axisId: 'headline', action: 'remove-option', optionId: 'b' });
    expect(saved[0].variant).toMatchObject({ axisId: 'headline', optionId: 'b' });
    expect(saved[0].feedback).toBe('Remove this option after checking the alternative layout.');
    await click(byText('Headline actions'));
    expect(byText('Remove Bold')?.hasAttribute('disabled')).toBe(true);
    await click(byText('Close selector actions'));
    // Persisted requests never hide or mutate the source controls, even on remount.
    await act(async () => root?.unmount()); root = null;
    await render(createElement(IterationPanel, props));
    await click(container.querySelector('.iso-iter-fab'));
    expect(labels()).toEqual(['Headline', 'Haze', 'Tagline']);
    await click(byText('Feedback'));
    await click(byText('Cancel removal'));
    expect(labels()).toEqual(['Headline', 'Haze', 'Tagline']);
    expect(source.getSelections().headline).toBe('b');
    expect(source.getAxes()).toHaveLength(3);
  });

  async function typeFeedback(text: string) {
    const input = container.querySelector('textarea');
    if (!input) throw new Error('no composer');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => { set?.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  it.each(['dark', 'light'] as const)('focuses the full %s composer without hijacking its controls', async (theme) => {
    document.body.style.backgroundColor = theme === 'dark' ? 'black' : 'white';
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.iso-iter-fab'));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    const field = container.querySelector('textarea');
    expect(container.querySelector('.iso-iter-root')?.getAttribute('data-theme')).toBe(theme);
    if (!field) throw new Error('no composer');
    for (const selector of ['.iso-iter-input', '.iso-iter-toolbar']) {
      await act(async () => field.blur());
      await click(container.querySelector(selector));
      expect(document.activeElement).toBe(field);
    }
    await typeFeedback('Keep the selection');
    field.setSelectionRange(2, 6);
    const focus = vi.spyOn(field, 'focus');
    await click(field);
    expect(focus).not.toHaveBeenCalled();
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
    const picker = byText('Select elements');
    await act(async () => picker?.focus());
    await click(picker);
    expect(picker?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(picker);
    expect(focus).not.toHaveBeenCalled();
  });
  it('switches theme without replacing controls or losing review state', async () => {
    const source = createVariantsSource({ axes: AXES, saveDefaults: async () => {} });
    const props = { route: '/', store: { endpoint: '/notes' }, variants: source };
    await render(createElement(IterationPanel, props));
    await click(container.querySelector('.iso-iter-fab'));
    await click(byText('Variants'));
    await click(byText('Bold'));
    await typeFeedback('Keep this draft while changing the theme');
    const input = container.querySelector('textarea');
    const variants = container.querySelector('.iso-iter-variants-panel');
    const rail = container.querySelector('.iso-iter-rail-track');
    for (const theme of ['light', 'dark'] as const) {
      await act(async () => {
        document.body.style.backgroundColor = theme === 'dark' ? 'black' : 'white';
        root?.render(createElement(IterationPanel, props));
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      expect(container.querySelector('.iso-iter-root')?.getAttribute('data-theme')).toBe(theme);
      expect(container.querySelectorAll('.iso-iter-panel[data-open=true]')).toHaveLength(2);
      expect(container.querySelector('textarea')).toBe(input);
      expect(input?.value).toBe('Keep this draft while changing the theme');
      expect(container.querySelector('.iso-iter-variants-panel')).toBe(variants);
      expect(container.querySelector('.iso-iter-rail-track')).toBe(rail);
      expect(source.getSelections().headline).toBe('b');
      expect(byText('Save as defaults')).toBeDefined();
      await click(byText('Headline actions'));
      expect(container.querySelector('.iso-iter-axis-menu')?.getAttribute('data-open')).toBe('true');
      expect(byText('Remove Plain')?.hasAttribute('disabled')).toBe(true);
      // Escape dismisses only the action sheet, preserving both surfaces and draft.
      await act(async () => container.querySelector('.iso-iter-axis-menu button')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(container.querySelector('.iso-iter-axis-menu')?.getAttribute('data-open')).not.toBe('true');
      expect(container.querySelectorAll('.iso-iter-panel[data-open=true]')).toHaveLength(2);
    }
  });
  it('captures the shortcut inside an input, preserves variants, and disables keyboard motion', async () => {
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' }, variants: createVariantsSource({ axes: AXES }), defaultTab: 'variants' }));
    await click(container.querySelector('.iso-iter-fab'));
    const input = document.createElement('input'); document.body.append(input); input.focus();
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); await new Promise(r => requestAnimationFrame(r)); });
    expect(container.querySelectorAll('.iso-iter-panel[data-open=true]')).toHaveLength(2);
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    expect(container.querySelector('.iso-iter-root')?.getAttribute('data-instant')).toBe('true');
    input.remove();
  });
  it('attaches an option reference and keeps variants visible while writing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' }, variants: createVariantsSource({ axes: AXES }), defaultTab: 'variants' }));
    await click(container.querySelector('.iso-iter-fab'));
    await click(byText('Headline actions'));
    await click(byText('Feedback on Bold'));
    expect(container.querySelectorAll('.iso-iter-panel[data-open=true]')).toHaveLength(2);
    expect(container.querySelector('.iso-iter-chip')?.textContent).toContain('Headline / Bold');
    await typeFeedback('A little less heavy');
    vi.stubGlobal('fetch', fetchMock);
    await click(byText('Send note'));
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1].body)).variant).toEqual({ axisId: 'headline', label: 'Headline', optionId: 'b', optionLabel: 'Bold', value: 'a' });
  });
  it('pins several elements in one session, toggles a duplicate off, and saves every target', async () => {
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.iso-iter-fab'));
    const a = document.createElement('button'); a.id = 'one'; a.textContent = 'One';
    const b = document.createElement('button'); b.id = 'two'; b.textContent = 'Two';
    document.body.append(a, b);
    const hit = vi.fn(() => a);
    Object.defineProperty(document, 'elementFromPoint', { value: hit, configurable: true });
    await click(byText('Select elements'));
    await click(a); hit.mockReturnValue(b); await click(b);
    expect(container.querySelectorAll('.iso-iter-chip')).toHaveLength(2);
    await click(b); expect(container.querySelectorAll('.iso-iter-chip')).toHaveLength(1);
    await click(b);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await typeFeedback('Align these two');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) })); vi.stubGlobal('fetch', fetchMock);
    await click(byText('Send note'));
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(call?.[1].body));
    expect(body.elements.map((el: { selector: string }) => el.selector)).toEqual(['#one', '#two']);
    expect(body.element.selector).toBe('#one');
    a.remove(); b.remove();
  });
  it('surfaces a failed removal request without losing options', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source, onManage: async () => { throw new Error('Disk unavailable'); } }));
    await click(byText('Headline actions')); await click(byText('Remove Bold'));
    expect(source.getAxes()).toHaveLength(3);
    expect(container.textContent).toContain('Disk unavailable');
    expect(source.getAxes()).toHaveLength(3);
  });
  it('does not expose destructive source actions without a feedback handler', async () => {
    const mutate = vi.fn();
    const source = createVariantsSource({ axes: AXES, onManage: mutate });
    source.setSelection('headline', 'b');
    await render(createElement(VariantsView, { source }));
    await click(byText('Headline actions'));
    expect(byText('Remove Bold')).toBeUndefined();
    expect(source.getSelections().headline).toBe('b');
    expect(source.getAxes()).toHaveLength(3);
    expect(mutate).not.toHaveBeenCalled();
  });
  it('saves edits to their original route and retains the original host payload', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { id: 'old' } : [{ id: 'old', route: '/other', feedback: 'Old note', element: null, done: false, createdAt: new Date().toISOString(), payload: { old: true } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' }, getPayload: () => ({ new: true }) }));
    await click(container.querySelector('.iso-iter-fab')); await click(container.querySelector('.iso-iter-note-hit'));
    await typeFeedback('Updated note'); await click(byText('Save edit'));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.route).toBe('/other'); expect(body.payload).toBeUndefined();
  });
});


it('pins a focused host control with Space without activating it', async () => {
  await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.iso-iter-fab'));
  await click(byText('Select elements'));
  const target = document.createElement('button');
  target.id = 'keyboard-target'; target.textContent = 'Project actions';
  document.body.append(target);
  target.focus();
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(container.querySelector('.iso-iter-chip')?.textContent).toContain('Project actions');
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true })); });
  expect(container.querySelectorAll('.iso-iter-chip')).toHaveLength(1);
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(container.querySelector('textarea')).toBe(document.activeElement);
  target.remove();
});


it('fades the composer top only after its text has scrolled', async () => {
  await render(createElement(IterationPanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.iso-iter-fab'));
  const field = container.querySelector('textarea');
  if (!field) throw new Error('Missing composer');
  expect(field.dataset.scrolled).toBe('false');
  await act(async () => { field.scrollTop = 36; field.dispatchEvent(new Event('scroll')); });
  expect(field.dataset.scrolled).toBe('true');
  await act(async () => { field.scrollTop = 0; field.dispatchEvent(new Event('scroll')); });
  expect(field.dataset.scrolled).toBe('false');
});

/**
 * The panel deciding between a Variants / Notes tab bar, variants only,
 * or nothing at all, and `mountIsotone`'s variants options.
 */
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVariantsSource, IsotonePanel, mountIsotone } from '../../src/react/index';
import { AXES, byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

describe('IsotonePanel with variants', () => {
  const fab = () => container.querySelector<HTMLButtonElement>('.isotone-fab');
  const tabs = () => container.querySelectorAll('[role=tab]');

  it('without an endpoint it is variants only: no tabs, no composer', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    await click(fab());

    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.isotone-vars')).not.toBeNull();
    expect(container.querySelector('.isotone-textarea')).toBeNull();
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Variants');
  });

  it('opens both surfaces independently and keeps the draft while switching variants', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/api/isotone/notes' }, variants: source }));
    await click(fab());
    await click(byText('Variants'));
    expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
    expect(tabs()).toHaveLength(0);
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('missing composer');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(textarea, 'Try another direction');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Bold'));
    expect(textarea.value).toBe('Try another direction');
    await click(byText('Close variants'));
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
    expect(textarea.value).toBe('Try another direction');
  });

  it('grows the composer with text and shrinks after clearing it', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/api/isotone/notes' } }));
    await click(fab());
    const field = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!field) throw new Error('missing composer');
    expect(field.style.height).toBe('22px');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, get: () => field.value.split('\n').length * 20 + 2 });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const type = async (value: string) =>
      act(async () => {
        setter?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type('One\nTwo\nThree');
    expect(field.style.height).toBe('62px');
    await type('');
    expect(field.style.height).toBe('22px');
  });

  it('remeasures the scroll-through inset when context changes without changing the text', async () => {
    const feedback = 'One\nTwo';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: 'existing',
            feedback,
            route: '/',
            element: null,
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })),
    );
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(fab());
    const field = container.querySelector('textarea');
    if (!field) throw new Error('missing composer');
    Object.defineProperty(field, 'scrollHeight', {
      configurable: true,
      get: () => field.value.split('\n').length * 20 + (field.parentElement?.previousElementSibling?.childElementCount ? 12 : 14),
    });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(field, feedback);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field.style.height).toBe('54px');
    await click(container.querySelector('.isotone-note-hit'));
    expect(field.value).toBe(feedback);
    expect(field.style.height).toBe('52px');
  });

  it('keeps overflow labels hit-testable and adds titles only while truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: 'existing',
            feedback: 'Review this section',
            route: '/',
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            element: {
              selector: '#section',
              tag: 'section',
              text: 'A long pinned section label',
              rect: { x: 0, y: 0, width: 100, height: 100 },
            },
          },
        ],
      })),
    );
    await render(
      createElement(IsotonePanel, { route: '/', variants: createVariantsSource({ axes: AXES }), store: { endpoint: '/notes' } }),
    );
    await click(fab());
    await click(byText('Variants'));
    const labels = Array.from(
      container.querySelectorAll<HTMLElement>('.isotone-axis-label > span, .isotone-seg > span, .isotone-meta .isotone-chip > span'),
    );
    expect(labels.length).toBeGreaterThan(3);
    expect(container.querySelector('.isotone-meta .isotone-chip > span')).not.toBeNull();
    for (const label of labels) {
      expect(getComputedStyle(label).pointerEvents).not.toBe('none');
      let availableWidth = 60;
      Object.defineProperties(label, {
        scrollWidth: { configurable: true, value: 120 },
        clientWidth: { configurable: true, get: () => availableWidth },
      });
      await act(async () => {
        label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      });
      expect(label.title).toBe(label.textContent?.trim());
      availableWidth = 160;
      await act(async () => {
        label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      });
      expect(label.hasAttribute('title')).toBe(false);
    }
  });

  it('with an endpoint but no axes it is the notes panel as before', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes' },
        variants: source,
      }),
    );
    await click(fab());
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.isotone-textarea')).not.toBeNull();
    expect(container.querySelector('.isotone-variants-panel')?.getAttribute('data-open')).toBe('false');
  });

  it('with neither notes nor axes it renders nothing', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    expect(fab()).toBeNull();
  });

  it('refreshes remote axes on mount and reopen', async () => {
    // Like the overlay adapter: no axes until refresh() has listed them.
    const inner = createVariantsSource({ axes: [] });
    const refresh = vi.fn(async () => inner.setAxes(AXES));
    const source = Object.assign(inner, { refresh });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes' },
        variants: source,
      }),
    );
    // Once at mount, because the source had nothing to show yet.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tabs()).toHaveLength(0);

    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.isotone-rail-button')).toHaveLength(2);

    await click(fab());
    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('with no endpoint, a source that only has axes after refresh still gets a launcher', async () => {
    // `mountIsotone({ variants: 'overlay' })` with no notes endpoint: the
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
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
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
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('panel refinements for variants-only hosts', () => {
  it('initially opens variants when requested, with feedback still available', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes', key: 'preview' },
        variants: source,
        defaultTab: 'variants',
      }),
    );
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelector('.isotone-vars')).not.toBeNull();
    expect(container.querySelector('.isotone-notes-panel')?.hasAttribute('inert')).toBe(true);
  });

  it('labels a variants-only launcher as Variants, with an icon', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    const button = container.querySelector('.isotone-fab');
    expect(button?.getAttribute('aria-label')).toBe('Variants');
    expect(button?.querySelector('svg')).not.toBeNull();
  });
});

describe('mountIsotone variants options', () => {
  beforeEach(() => vi.useFakeTimers());

  it('mounts nothing without an endpoint or a source', () => {
    const off = mountIsotone({});
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts nothing for a variants-only source with no axes and no refresh', () => {
    const off = mountIsotone({ variants: createVariantsSource({ axes: [] }) });
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts with only a variants source', () => {
    const off = mountIsotone({ variants: createVariantsSource({ axes: AXES }) });
    expect(document.querySelector('[data-isotone="root"]')).not.toBeNull();
    off();
    vi.runAllTimers();
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
  });

  it("'overlay' lists from the variants endpoint on open", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/isotone/variants')) {
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

    const off = mountIsotone({ endpoint: '/api/isotone/notes', variants: 'overlay' });
    // The mount renders one macrotask later.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    await act(async () => {
      shadow.querySelector('.isotone-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Let the listing resolve and the panel re-render with the new axis.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/isotone/variants');
    expect(shadow.querySelectorAll('.isotone-rail-button')).toHaveLength(2);

    // An untouched overlay has nothing to promote; the save action stays hidden.
    await act(async () => {
      shadow.querySelector('.isotone-rail-button[aria-label=Variants]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(shadow.querySelector('.isotone-save')).toBeNull();

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
      if (url === '/api/isotone/variants/active' && init?.method === 'POST') {
        active = JSON.parse(String(init.body)).active;
        return { ok: true, status: 200, json: async () => ({ active }) };
      }
      if (url.startsWith('/api/isotone/variants')) {
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
                section: 'Account',
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

    const off = mountIsotone({
      endpoint: '/api/isotone/notes',
      variants: 'overlay',
      getRoute: () => '/projects',
    });
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    await tick();
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const clickIn = (el: Element | null | undefined) =>
      act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
    const button = (text: string) => Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

    await clickIn(shadow.querySelector('.isotone-fab'));
    await tick();
    await clickIn(shadow.querySelector('.isotone-rail-button[aria-label=Variants]'));
    const axisLabels = () => Array.from(shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent);
    expect(axisLabels()).toEqual(['table.tsx', 'Settings']);
    // A member's section puts the group's selector under that header.
    expect(Array.from(shadow.querySelectorAll('.isotone-section-toggle span')).map((el) => el.textContent)).toEqual(['Account']);
    expect(button('Dense rows')?.classList.contains('isotone-seg-on')).toBe(true);
    expect(button('Hero')).toBeUndefined();

    // Picking in one selector keeps the other's pick and posts both.
    await clickIn(button('Tabs'));
    const posts = () =>
      (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])
        .filter((c) => String(c[0]) === '/api/isotone/variants/active')
        .map((c) => JSON.parse(String(c[1]?.body)));
    expect(posts().at(-1)).toEqual({ active: ['table-dense', 'settings-tabs'] });
    await tick();
    expect(button('Tabs')?.classList.contains('isotone-seg-on')).toBe(true);
    expect(button('Dense rows')?.classList.contains('isotone-seg-on')).toBe(true);

    // A sibling replaces only its own group's member.
    await clickIn(button('Striped'));
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs', 'table-striped'] });

    // Make default names every pick, in panel order, and pins the first.
    await clickIn(button('Make default'));
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    const note = calls.find((c) => String(c[0]) === '/api/isotone/notes' && c[1]?.method === 'POST');
    const body = JSON.parse(String(note?.[1]?.body));
    expect(body.feedback).toBe(
      '[set-defaults] Make the default: "table.tsx: Striped" (table-striped); "Account › Settings: Tabs" (settings-tabs).',
    );
    expect(body.payload).toEqual({ variants: 'table-striped, settings-tabs' });
    expect(body.route).toBe('/projects');

    // Default in one selector drops that group and leaves the other.
    const defaults = Array.from(shadow.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Default');
    await clickIn(defaults[0]);
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs'] });

    off();
    await tick();
  });
});
